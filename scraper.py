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
import sys
from typing import Optional

import requests
from bs4 import BeautifulSoup
import gspread
from google.oauth2.service_account import Credentials

# ─────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────
CREDENTIALS_FILE = "google-credentials.json"   # local dev: place your JSON key here

# Sheet ID – read from env var first, then hard-coded fallback
SHEET_ID = os.getenv(
    "GOOGLE_SHEET_ID",
    "1vTmd9N77OuTj1k_QFR0hyiqVjxfZvfnYUPO55kUSFN8RyW7MoZNICzc8gGYZuG0uVL_ccPXnG96ltKT"
)
SHEET_TAB_INDEX = 0   # 0 = first tab

# Scraping behaviour
BASE_URL        = "https://an1.com/games/"
REQUEST_DELAY   = 1.5   # seconds between requests (polite)
REQUEST_TIMEOUT = 20    # seconds per request
MAX_PAGES       = 999   # safety cap – stops when no next-page link found

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    )
}

# Google API scopes
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# ─────────────────────────────────────────────
# LOGGING
# ─────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)


# ─────────────────────────────────────────────
# COLUMN HEADERS  (must match your Sheet's row 1)
# ─────────────────────────────────────────────
SHEET_HEADERS = [
    "Module Name", "Version", "Build Data", "Size",
    "OS", "Architecture", "Tags", "Visual Asset",
    "Access Link", "Data Log",
]


# ─────────────────────────────────────────────
# HTTP HELPER
# ─────────────────────────────────────────────
_session = requests.Session()
_session.headers.update(HEADERS)


def fetch(url: str, retries: int = 3) -> Optional[BeautifulSoup]:
    """Fetch a URL and return a BeautifulSoup object, or None on failure."""
    for attempt in range(1, retries + 1):
        try:
            resp = _session.get(url, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            return BeautifulSoup(resp.text, "html.parser")
        except requests.RequestException as exc:
            log.warning("Attempt %d/%d failed for %s – %s", attempt, retries, url, exc)
            if attempt < retries:
                time.sleep(REQUEST_DELAY * attempt)
    log.error("Giving up on %s", url)
    return None


# ─────────────────────────────────────────────
# DETAIL PAGE PARSER
# ─────────────────────────────────────────────
def parse_detail_page(url: str) -> dict:
    """Visit a game's detail page and extract all required fields."""
    fallback = {
        "version":      "v1.0",
        "build_data":   "N/A",
        "size":         "N/A",
        "os":           "Android",
        "architecture": "arm64-v8a",
        "tags":         "Game, New",
        "data_log":     "No description available.",
    }

    soup = fetch(url)
    if not soup:
        return fallback

    def text(selector: str, attr: str = None) -> str:
        el = soup.select_one(selector)
        if not el:
            return ""
        return (el.get(attr) or "").strip() if attr else el.get_text(strip=True)

    # Version
    version = text('span[itemprop="softwareVersion"]') or text('.version')
    if version and not version.startswith("v"):
        version = "v" + version
    version = version or fallback["version"]

    # Build data
    build_data = fallback["build_data"]
    for li in soup.select("ul.app_info li, ul.spec li, .box_app_info li"):
        txt = li.get_text(" ", strip=True)
        if re.search(r"\bbuild\b", txt, re.I):
            parts = txt.split(":")
            build_data = parts[-1].strip() if len(parts) > 1 else txt
            break

    # Size
    size = text('span[itemprop="fileSize"]') or text('span.size')
    if not size:
        for li in soup.select("ul.app_info li, ul.spec li, .box_app_info li"):
            txt = li.get_text(" ", strip=True)
            if re.search(r"\bsize\b", txt, re.I):
                m = re.search(r"([\d.]+\s*(MB|GB|KB))", txt, re.I)
                if m:
                    size = m.group(1)
                    break
    size = size or fallback["size"]

    # OS
    os_val = text('span[itemprop="operatingSystem"]') or "Android"

    # Architecture
    arch = fallback["architecture"]
    for li in soup.select("ul.app_info li, ul.spec li, .box_app_info li"):
        txt = li.get_text(" ", strip=True)
        if re.search(r"arch|abi|arm|x86", txt, re.I):
            parts = re.split(r":\s*", txt, 1)
            arch = parts[-1].strip()
            break

    # Tags / Genre (from breadcrumb: AN1.com › Games › <Genre> › Developer)
    names = [el.get_text(strip=True) for el in soup.select('span[itemprop="name"]')]
    genre = names[2] if len(names) > 2 else (
        text('span[itemprop="applicationCategory"]') or "Game"
    )
    tags = f"{genre}, New"

    # Description
    desc = (
        text('div[itemprop="description"]')
        or text('meta[name="description"]', attr="content")
        or fallback["data_log"]
    )
    if len(desc) > 280:
        desc = desc[:280].rstrip() + "…"

    time.sleep(REQUEST_DELAY)

    return {
        "version":      version,
        "build_data":   build_data,
        "size":         size,
        "os":           os_val,
        "architecture": arch,
        "tags":         tags,
        "data_log":     desc,
    }


# ─────────────────────────────────────────────
# LISTING PAGES  (all paginated pages)
# ─────────────────────────────────────────────
def scrape_all_games() -> list[dict]:
    """Walk every listing page and return a list of game dicts."""
    all_games = []
    page_url  = BASE_URL

    for page_num in range(1, MAX_PAGES + 1):
        log.info("── Page %d: %s", page_num, page_url)
        soup = fetch(page_url)
        if not soup:
            log.error("Failed to fetch page %d. Stopping.", page_num)
            break

        items = soup.select(".item_app, .game-item, article.app")
        if not items:
            log.info("No items found – pagination complete.")
            break

        log.info("Found %d items on page %d.", len(items), page_num)

        for item in items:
            # Title
            title = (
                item.select_one(".name a span") or
                item.select_one(".name a") or
                item.select_one("h2 a, h3 a, .title a")
            )
            title = title.get_text(strip=True) if title else "Unknown"

            # Link
            link_el = item.select_one(".name a") or item.select_one("a[href]")
            link = (link_el.get("href") or "") if link_el else ""
            if link and not link.startswith("http"):
                link = "https://an1.com" + link

            # Icon
            img_el = item.select_one("img[src]")
            img = (img_el.get("src") or "") if img_el else ""
            if img and not img.startswith("http"):
                img = "https://an1.com" + img

            if not title or not link:
                continue

            log.info("  → %s", title)

            details = parse_detail_page(link)

            all_games.append({
                "Module Name":  title,
                "Version":      details["version"],
                "Build Data":   details["build_data"],
                "Size":         details["size"],
                "OS":           details["os"],
                "Architecture": details["architecture"],
                "Tags":         details["tags"],
                "Visual Asset": img,
                "Access Link":  link,
                "Data Log":     details["data_log"],
            })

        # Next page
        next_el = (
            soup.select_one('a[rel="next"]') or
            soup.select_one('.pagination a:-soup-contains("Next")') or
            soup.select_one('.next a, a.next')
        )
        if next_el and next_el.get("href"):
            href = next_el["href"]
            page_url = href if href.startswith("http") else "https://an1.com" + href
            time.sleep(REQUEST_DELAY)
        else:
            log.info("No next-page link – done paginating.")
            break

    log.info("Total scraped: %d games", len(all_games))
    return all_games


# ─────────────────────────────────────────────
# GOOGLE SHEETS  – connect, deduplicate, append
# ─────────────────────────────────────────────
def build_credentials() -> Credentials:
    """
    Load service account credentials.
    Priority:
      1. GCP_CREDENTIALS_JSON env var (GitHub Actions)
      2. google-credentials.json file (local dev)
    """
    env_creds = os.getenv("GCP_CREDENTIALS_JSON")
    if env_creds:
        log.info("Using GCP_CREDENTIALS_JSON env var for auth.")
        info = json.loads(env_creds)
        return Credentials.from_service_account_info(info, scopes=SCOPES)

    if os.path.exists(CREDENTIALS_FILE):
        log.info("Using local credentials file: %s", CREDENTIALS_FILE)
        return Credentials.from_service_account_file(CREDENTIALS_FILE, scopes=SCOPES)

    raise FileNotFoundError(
        "No credentials found!\n"
        "  • GitHub Actions: set secret GCP_CREDENTIALS_JSON\n"
        f"  • Local: place your JSON key at '{CREDENTIALS_FILE}'"
    )


def connect_sheet() -> gspread.Worksheet:
    """Authenticate and return the target worksheet."""
    creds  = build_credentials()
    client = gspread.Client(auth=creds)
    client.session = requests.Session()
    client.session.headers.update({"Authorization": f"Bearer {creds.token}"})

    # Use gspread's built-in auth (works with gspread 5.x and 6.x)
    gc = gspread.authorize(creds)
    wb = gc.open_by_key(SHEET_ID)
    ws = wb.get_worksheet(SHEET_TAB_INDEX)
    log.info("Connected to spreadsheet: '%s'", wb.title)
    return ws


def ensure_headers(ws: gspread.Worksheet):
    """Write the header row if the sheet is empty."""
    first_row = ws.row_values(1)
    if not any(first_row):
        ws.insert_row(SHEET_HEADERS, index=1)
        log.info("Header row written.")


def get_existing_keys(ws: gspread.Worksheet) -> set:
    """Return dedup keys (name|version) for all rows already in the sheet."""
    all_rows = ws.get_all_values()
    if len(all_rows) <= 1:
        return set()

    header = all_rows[0]
    try:
        name_col    = header.index("Module Name")
        version_col = header.index("Version")
    except ValueError:
        log.warning("Sheet headers not found – skipping dedup check.")
        return set()

    keys = set()
    for row in all_rows[1:]:
        if len(row) > max(name_col, version_col):
            k = f"{row[name_col].lower().strip()}|{row[version_col].lower().strip()}"
            keys.add(k)
    return keys


def push_to_sheets(games: list[dict]):
    """Append only new (non-duplicate) games to the Google Sheet."""
    ws = connect_sheet()
    ensure_headers(ws)

    existing = get_existing_keys(ws)
    log.info("Sheet has %d existing entries.", len(existing))

    new_rows = []
    for g in games:
        key = f"{g['Module Name'].lower().strip()}|{g['Version'].lower().strip()}"
        if key not in existing:
            new_rows.append([g[h] for h in SHEET_HEADERS])
            existing.add(key)   # prevent in-batch dupes
        else:
            log.debug("SKIP (dup): %s", g["Module Name"])

    if not new_rows:
        log.info("No new games – sheet is already up to date.")
        return

    ws.append_rows(new_rows, value_input_option="USER_ENTERED")
    log.info("✅ Appended %d new game(s) to the sheet.", len(new_rows))


# ─────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────
def main():
    log.info("=" * 55)
    log.info("AN1.com → Google Sheets Scraper")
    log.info("=" * 55)

    games = scrape_all_games()
    if not games:
        log.error("No games scraped – nothing to push.")
        sys.exit(1)

    push_to_sheets(games)
    log.info("Done.")


if __name__ == "__main__":
    main()
