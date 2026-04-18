"""
scraper.py – an1.com → Google Sheets pipeline
=============================================
Scrapes every game listed on https://an1.com/games/ (all pages),
extracts the required data fields, deduplicates against existing
Sheet rows, and appends only new entries.

Run locally:
    python scraper.py

Dependencies (install first):
    pip install -r requirements.txt
"""

import time
import json
import re
import os
import logging
from dataclasses import dataclass, fields, astuple
from typing import Optional

import requests
from bs4 import BeautifulSoup
import gspread
from google.oauth2.service_account import Credentials

# ─────────────────────────────────────────────
# CONFIGURATION  – edit these two values
# ─────────────────────────────────────────────
CREDENTIALS_FILE = "google-credentials.json"   # path to your Service-Account JSON
SHEET_ID         = os.getenv(
    "GOOGLE_SHEET_ID",
    "1vTmd9N77OuTj1k_QFR0hyiqVjxfZvfnYUPO55kUSFN8RyW7MoZNICzc8gGYZuG0uVL_ccPXnG96ltKT"   # ← replace if different
)
SHEET_TAB_INDEX  = 0          # 0 = first tab in the spreadsheet

# Scraping behaviour
BASE_URL         = "https://an1.com/games/"
REQUEST_DELAY    = 1.5        # polite pause between HTTP calls (seconds)
REQUEST_TIMEOUT  = 20         # seconds before giving up on a single request
MAX_PAGES        = 999        # safety cap – pagination stops when no next-page found anyway
HEADERS          = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    )
}

# Google Sheets OAuth scopes required
SCOPES = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive",
]

# ─────────────────────────────────────────────
# LOGGING
# ─────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


# ─────────────────────────────────────────────
# DATA MODEL
# ─────────────────────────────────────────────
@dataclass
class GameRecord:
    """Represents one row in the Google Sheet."""
    module_name:   str = ""   # Game title
    version:       str = ""   # e.g. v1.4.2
    build_data:    str = ""   # Build / APK build number (if available)
    size:          str = ""   # e.g. 120 MB
    os:            str = ""   # Android / iOS
    architecture:  str = ""   # arm64-v8a, armeabi-v7a, x86, …
    tags:          str = ""   # Comma-separated genre + "New"
    visual_asset:  str = ""   # Icon image URL
    access_link:   str = ""   # Direct URL to the game page
    data_log:      str = ""   # Short description / changelog

    # Spreadsheet column headers (must match the Sheet)
    HEADERS = [
        "Module Name", "Version", "Build Data", "Size",
        "OS", "Architecture", "Tags", "Visual Asset",
        "Access Link", "Data Log",
    ]

    def as_row(self) -> list:
        return [
            self.module_name, self.version, self.build_data,
            self.size, self.os, self.architecture, self.tags,
            self.visual_asset, self.access_link, self.data_log,
        ]

    @property
    def dedup_key(self) -> str:
        """Unique key used to detect duplicate rows."""
        return f"{self.module_name.lower().strip()}|{self.version.lower().strip()}"


# ─────────────────────────────────────────────
# HTTP HELPER
# ─────────────────────────────────────────────
_session = requests.Session()
_session.headers.update(HEADERS)


def get(url: str, retries: int = 3) -> Optional[BeautifulSoup]:
    """Fetch a URL; return a BeautifulSoup object or None on repeated failure."""
    for attempt in range(1, retries + 1):
        try:
            resp = _session.get(url, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            return BeautifulSoup(resp.text, "html.parser")
        except requests.RequestException as exc:
            log.warning("Attempt %d/%d failed for %s – %s", attempt, retries, url, exc)
            if attempt < retries:
                time.sleep(REQUEST_DELAY * attempt)   # exponential-ish back-off
    log.error("Giving up on %s after %d attempts.", url, retries)
    return None


# ─────────────────────────────────────────────
# DETAIL PAGE PARSER
# ─────────────────────────────────────────────
def parse_detail_page(url: str) -> dict:
    """
    Visit the individual game page and extract:
        version, build_data, size, os, architecture, tags, data_log
    Returns a dict with sensible fallback values on failure.
    """
    fallback = {
        "version":      "v1.0",
        "build_data":   "N/A",
        "size":         "N/A",
        "os":           "Android",
        "architecture": "arm64-v8a",
        "tags":         "Game, New",
        "data_log":     "No description available.",
    }

    soup = get(url)
    if not soup:
        return fallback

    def _text(selector: str, attr: str = None) -> str:
        el = soup.select_one(selector)
        if not el:
            return ""
        return el.get(attr, "").strip() if attr else el.get_text(strip=True)

    # ── Version ──────────────────────────────
    version = (
        _text('span[itemprop="softwareVersion"]')
        or _text('.version')
        or _text('ul.app_info li:has(span:-soup-contains("Version")) span:last-child')
    )
    if version and not version.startswith("v"):
        version = "v" + version
    version = version or fallback["version"]

    # ── Build data ────────────────────────────
    # Look for any spec item that contains "Build" or "APK"
    build_data = ""
    for li in soup.select("ul.app_info li, ul.spec li, .box_app_info li"):
        label = li.get_text(" ", strip=True)
        if re.search(r"\bbuild\b", label, re.I):
            parts = label.split(":")
            build_data = parts[-1].strip() if len(parts) > 1 else label
            break
    build_data = build_data or fallback["build_data"]

    # ── Size ─────────────────────────────────
    size = (
        _text('span[itemprop="fileSize"]')
        or _text('span.size')
        or _text('li:-soup-contains("Size") span:last-child')
    )
    if not size:
        # Generic fallback: grep li items
        for li in soup.select("ul.app_info li, ul.spec li, .box_app_info li"):
            txt = li.get_text(" ", strip=True)
            if re.search(r"\bsize\b", txt, re.I):
                m = re.search(r"([\d.]+\s*(MB|GB|KB))", txt, re.I)
                if m:
                    size = m.group(1)
                    break
    size = size or fallback["size"]

    # ── OS ───────────────────────────────────
    os_val = _text('span[itemprop="operatingSystem"]') or "Android"

    # ── Architecture ─────────────────────────
    arch = ""
    for li in soup.select("ul.app_info li, ul.spec li, .box_app_info li"):
        txt = li.get_text(" ", strip=True)
        if re.search(r"arch|abi|arm|x86", txt, re.I):
            parts = re.split(r"[:]\s*", txt, 1)
            arch = parts[-1].strip()
            break
    arch = arch or fallback["architecture"]

    # ── Tags / Genre ──────────────────────────
    # Breadcrumb path: AN1.com › Games › <Genre> › <Developer>
    names = [el.get_text(strip=True)
             for el in soup.select('span[itemprop="name"]')]
    genre = names[2] if len(names) > 2 else ""
    if not genre:
        genre = _text('span[itemprop="applicationCategory"]') or "Game"
    tags = f"{genre}, New"

    # ── Description ───────────────────────────
    desc = (
        _text('div[itemprop="description"]')
        or _text('meta[name="description"]', attr="content")
        or ""
    )
    # Trim to 280 chars max
    if len(desc) > 280:
        desc = desc[:280].rstrip() + "…"
    data_log = desc or fallback["data_log"]

    time.sleep(REQUEST_DELAY)   # be polite

    return {
        "version":      version,
        "build_data":   build_data,
        "size":         size,
        "os":           os_val,
        "architecture": arch,
        "tags":         tags,
        "data_log":     data_log,
    }


# ─────────────────────────────────────────────
# LISTING PAGE PARSER  (with pagination)
# ─────────────────────────────────────────────
def scrape_all_games() -> list[GameRecord]:
    """
    Walk every paginated listing page at BASE_URL and return a list
    of GameRecord objects with all fields populated.
    """
    all_records: list[GameRecord] = []
    page_url = BASE_URL

    for page_num in range(1, MAX_PAGES + 1):
        log.info("── Page %d: %s", page_num, page_url)
        soup = get(page_url)
        if not soup:
            log.error("Failed to fetch listing page %d. Stopping.", page_num)
            break

        # Each game card on the listing page
        items = soup.select(".item_app, .game-item, article.app")
        if not items:
            log.warning("No game items found on page %d. Stopping pagination.", page_num)
            break

        log.info("Found %d game items on page %d.", len(items), page_num)

        for item in items:
            # Title
            title_el = (
                item.select_one(".name a span")
                or item.select_one(".name a")
                or item.select_one("h2 a, h3 a, .title a")
            )
            title = title_el.get_text(strip=True) if title_el else "Unknown"

            # Link to detail page
            link_el = item.select_one(".name a") or item.select_one("a[href]")
            link = link_el["href"] if link_el and link_el.get("href") else ""
            if link and not link.startswith("http"):
                link = "https://an1.com" + link

            # Icon / thumbnail
            img_el = item.select_one("img[src]")
            img = img_el["src"] if img_el else ""
            if img and not img.startswith("http"):
                img = "https://an1.com" + img

            if not title or not link:
                log.debug("Skipping malformed item: title=%s link=%s", title, link)
                continue

            log.info("  → %s", title)

            # Fetch detail page for additional fields
            details = parse_detail_page(link)

            record = GameRecord(
                module_name=title,
                version=details["version"],
                build_data=details["build_data"],
                size=details["size"],
                os=details["os"],
                architecture=details["architecture"],
                tags=details["tags"],
                visual_asset=img,
                access_link=link,
                data_log=details["data_log"],
            )
            all_records.append(record)

        # ── Find next page link ───────────────────────────────────────
        next_link = (
            soup.select_one('a[rel="next"]')
            or soup.select_one('.pagination a:-soup-contains("Next")')
            or soup.select_one('.pagination a:-soup-contains("»")')
            or soup.select_one('.next a, a.next')
        )
        if next_link and next_link.get("href"):
            next_href = next_link["href"]
            page_url = next_href if next_href.startswith("http") else "https://an1.com" + next_href
            time.sleep(REQUEST_DELAY)
        else:
            log.info("No next-page link found – pagination complete.")
            break

    log.info("Total records scraped: %d", len(all_records))
    return all_records


# ─────────────────────────────────────────────
# GOOGLE SHEETS INTEGRATION
# ─────────────────────────────────────────────
def connect_sheet():
    """Authenticate with Google Sheets and return the target worksheet."""
    # Try JSON file first (local dev), then environment variable (CI)
    creds_json_str = os.getenv("GCP_CREDENTIALS_JSON")

    if creds_json_str:
        log.info("Using GCP_CREDENTIALS_JSON environment variable.")
        creds_info = json.loads(creds_json_str)
        creds = Credentials.from_service_account_info(creds_info, scopes=SCOPES)
    elif os.path.exists(CREDENTIALS_FILE):
        log.info("Using local credentials file: %s", CREDENTIALS_FILE)
        creds = Credentials.from_service_account_file(CREDENTIALS_FILE, scopes=SCOPES)
    else:
        raise FileNotFoundError(
            f"No credentials found. Either set the GCP_CREDENTIALS_JSON env var "
            f"or place your service-account JSON at '{CREDENTIALS_FILE}'."
        )

    gc     = gspread.authorize(creds)
    sheet  = gc.open_by_key(SHEET_ID)
    ws     = sheet.get_worksheet(SHEET_TAB_INDEX)
    log.info("Connected to sheet: '%s' (tab index %d)", sheet.title, SHEET_TAB_INDEX)
    return ws


def ensure_headers(ws: gspread.Worksheet):
    """Create the header row if the sheet is empty."""
    existing = ws.row_values(1)
    if not existing:
        ws.insert_row(GameRecord.HEADERS, index=1)
        log.info("Header row created.")


def get_existing_keys(ws: gspread.Worksheet) -> set[str]:
    """
    Return a set of dedup keys already present in the sheet.
    Key = "module_name|version" (both lower-cased).
    """
    records = ws.get_all_values()
    if len(records) <= 1:
        return set()   # only header (or empty)

    try:
        header = records[0]
        name_idx    = header.index("Module Name")
        version_idx = header.index("Version")
    except ValueError:
        log.warning("Expected columns not found; skipping dedup check.")
        return set()

    keys = set()
    for row in records[1:]:
        if len(row) > max(name_idx, version_idx):
            key = f"{row[name_idx].lower().strip()}|{row[version_idx].lower().strip()}"
            keys.add(key)
    return keys


def push_to_sheets(records: list[GameRecord]):
    """Append only genuinely new records to the Google Sheet."""
    ws = connect_sheet()
    ensure_headers(ws)

    existing_keys = get_existing_keys(ws)
    log.info("Sheet currently has %d existing entries (dedup keys).", len(existing_keys))

    new_rows = []
    for rec in records:
        if rec.dedup_key in existing_keys:
            log.debug("SKIP (duplicate): %s", rec.module_name)
        else:
            new_rows.append(rec.as_row())
            existing_keys.add(rec.dedup_key)   # avoid in-batch duplicates too

    if not new_rows:
        log.info("No new records to add – sheet is already up to date.")
        return

    # Batch-append all new rows in one API call (efficient)
    ws.append_rows(new_rows, value_input_option="USER_ENTERED")
    log.info("✅ Appended %d new record(s) to the sheet.", len(new_rows))


# ─────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────
def main():
    log.info("=" * 60)
    log.info("AN1.com → Google Sheets Scraper")
    log.info("=" * 60)

    # 1. Scrape all games (all pages)
    records = scrape_all_games()

    if not records:
        log.error("No records scraped. Exiting without updating the sheet.")
        return

    # 2. Push to Google Sheets (with deduplication)
    push_to_sheets(records)

    log.info("Done.")


if __name__ == "__main__":
    main()
