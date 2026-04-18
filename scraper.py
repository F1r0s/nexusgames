"""
scraper.py – an1.com → Google Sheets pipeline
=============================================
Matches your exact Google Sheet column structure:
  Module Name | Version Build | Data Size | OS Architecture | Tags | Visual Asset | Access Link | Data Log

Run locally:  python scraper.py
Install deps: pip install -r requirements.txt
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
CREDENTIALS_FILE = "google-credentials.json"
SHEET_ID = os.getenv(
    "GOOGLE_SHEET_ID",
    "1vTmd9N77OuTj1k_QFR0hyiqVjxfZvfnYUPO55kUSFN8RyW7MoZNICzc8gGYZuG0uVL_ccPXnG96ltKT"
)
SHEET_TAB_INDEX = 0

BASE_URL        = "https://an1.com/games/"
REQUEST_DELAY   = 1.5
REQUEST_TIMEOUT = 20
MAX_PAGES       = 50   # an1.com has ~50 pages of games

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    )
}

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# ── These MUST match your Google Sheet's row 1 headers exactly ──
SHEET_HEADERS = [
    "Module Name",
    "Version Build",
    "Data Size",
    "OS Architecture",
    "Tags",
    "Visual Asset",
    "Access Link",
    "Data Log",
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
# HTTP HELPER
# ─────────────────────────────────────────────
_session = requests.Session()
_session.headers.update(HEADERS)


def fetch(url: str, retries: int = 3) -> Optional[BeautifulSoup]:
    """GET a URL and return BeautifulSoup, or None on failure."""
    for attempt in range(1, retries + 1):
        try:
            resp = _session.get(url, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            return BeautifulSoup(resp.text, "html.parser")
        except requests.RequestException as exc:
            log.warning("Attempt %d/%d failed: %s – %s", attempt, retries, url, exc)
            if attempt < retries:
                time.sleep(REQUEST_DELAY * attempt)
    log.error("Giving up on %s", url)
    return None


# ─────────────────────────────────────────────
# PAGINATION HELPER
# ─────────────────────────────────────────────
def build_page_url(page_num: int) -> str:
    """
    an1.com pagination pattern:
      Page 1: https://an1.com/games/
      Page 2: https://an1.com/games/page/2/
      Page 3: https://an1.com/games/page/3/
    """
    if page_num == 1:
        return "https://an1.com/games/"
    return f"https://an1.com/games/page/{page_num}/"


# ─────────────────────────────────────────────
# DETAIL PAGE PARSER
# ─────────────────────────────────────────────
def parse_detail_page(url: str) -> dict:
    """Scrape a single game page for version, size, OS, tags, description."""
    fallback = {
        "version_build":   "v1.0",
        "data_size":       "N/A",
        "os_architecture": "Android, iOS",
        "tags":            "Game, New",
        "data_log":        "No description available.",
    }

    soup = fetch(url)
    if not soup:
        return fallback

    def txt(selector: str, attr: str = None) -> str:
        el = soup.select_one(selector)
        if not el:
            return ""
        return (el.get(attr) or "").strip() if attr else el.get_text(strip=True)

    # ── Version ──────────────────────────────────────────────────
    version = txt('span[itemprop="softwareVersion"]') or txt('.version')
    if version and not version.startswith("v"):
        version = "v" + version
    version = version or fallback["version_build"]

    # ── Size ─────────────────────────────────────────────────────
    size = txt('span[itemprop="fileSize"]') or txt('span.size')
    if not size:
        for li in soup.select("ul.app_info li, ul.spec li, .box_app_info li"):
            t = li.get_text(" ", strip=True)
            if re.search(r"\bsize\b", t, re.I):
                m = re.search(r"([\d.,]+\s*(MB|GB|KB))", t, re.I)
                if m:
                    size = m.group(1)
                    break
    size = size or fallback["data_size"]

    # ── OS ───────────────────────────────────────────────────────
    os_val = txt('span[itemprop="operatingSystem"]') or "Android, iOS"

    # ── Tags / Genre ─────────────────────────────────────────────
    # Breadcrumb: AN1.com › Games › <Genre> › Developer
    names = [el.get_text(strip=True) for el in soup.select('span[itemprop="name"]')]
    genre = names[2] if len(names) > 2 else (
        txt('span[itemprop="applicationCategory"]') or "Game"
    )
    tags = f"{genre}, New"

    # ── Description ──────────────────────────────────────────────
    desc = (
        txt('div[itemprop="description"]')
        or txt('meta[name="description"]', attr="content")
        or fallback["data_log"]
    )
    if len(desc) > 280:
        desc = desc[:280].rstrip() + "…"

    time.sleep(REQUEST_DELAY)

    return {
        "version_build":   version,
        "data_size":       size,
        "os_architecture": os_val,
        "tags":            tags,
        "data_log":        desc,
    }


# ─────────────────────────────────────────────
# SCRAPE ALL PAGES
# ─────────────────────────────────────────────
def scrape_all_games() -> list[dict]:
    """Iterate all paginated listing pages and return list of game dicts."""
    all_games = []

    for page_num in range(1, MAX_PAGES + 1):
        page_url = build_page_url(page_num)
        log.info("── Page %d: %s", page_num, page_url)

        soup = fetch(page_url)
        if not soup:
            log.error("Failed to fetch page %d. Stopping.", page_num)
            break

        items = soup.select(".item_app, .game-item, article.app")
        if not items:
            log.info("No items found on page %d – pagination complete.", page_num)
            break

        log.info("Found %d items on page %d.", len(items), page_num)

        for item in items:
            # Title
            title_el = (
                item.select_one(".name a span") or
                item.select_one(".name a") or
                item.select_one("h2 a, h3 a, .title a")
            )
            title = title_el.get_text(strip=True) if title_el else "Unknown"

            # Detail page link
            link_el = item.select_one(".name a") or item.select_one("a[href]")
            link = (link_el.get("href") or "") if link_el else ""
            if link and not link.startswith("http"):
                link = "https://an1.com" + link

            # Thumbnail/icon
            img_el = item.select_one("img[src]")
            img = (img_el.get("src") or "") if img_el else ""
            if img and not img.startswith("http"):
                img = "https://an1.com" + img

            if not title or not link:
                continue

            log.info("  → %s", title)
            details = parse_detail_page(link)

            all_games.append({
                "Module Name":     title,
                "Version Build":   details["version_build"],
                "Data Size":       details["data_size"],
                "OS Architecture": details["os_architecture"],
                "Tags":            details["tags"],
                "Visual Asset":    img,
                "Access Link":     link,
                "Data Log":        details["data_log"],
            })

        # Check if a page N+1 exists by verifying the next URL returns items
        # (an1.com returns a 404 or empty page when you go past the last page)
        next_url = build_page_url(page_num + 1)
        probe = fetch(next_url)
        if not probe or not probe.select(".item_app, .game-item, article.app"):
            log.info("Page %d is the last page.", page_num)
            break

        time.sleep(REQUEST_DELAY)

    log.info("Total scraped: %d games", len(all_games))
    return all_games


# ─────────────────────────────────────────────
# GOOGLE SHEETS AUTH
# ─────────────────────────────────────────────
def build_credentials() -> Credentials:
    """Load service-account creds from env var (GitHub) or local JSON file."""
    env_json = os.getenv("GCP_CREDENTIALS_JSON", "").strip()
    if env_json:
        log.info("Auth: using GCP_CREDENTIALS_JSON env var.")
        info = json.loads(env_json)
        return Credentials.from_service_account_info(info, scopes=SCOPES)

    if os.path.exists(CREDENTIALS_FILE):
        log.info("Auth: using local file %s.", CREDENTIALS_FILE)
        return Credentials.from_service_account_file(CREDENTIALS_FILE, scopes=SCOPES)

    raise FileNotFoundError(
        "No credentials found!\n"
        "  GitHub Actions → set secret: GCP_CREDENTIALS_JSON\n"
        f"  Local dev      → place JSON key at: {CREDENTIALS_FILE}"
    )


def connect_sheet() -> gspread.Worksheet:
    creds = build_credentials()
    gc    = gspread.authorize(creds)
    wb    = gc.open_by_key(SHEET_ID)
    ws    = wb.get_worksheet(SHEET_TAB_INDEX)
    log.info("Connected to: '%s'", wb.title)
    return ws


# ─────────────────────────────────────────────
# DEDUPLICATION & PUSH
# ─────────────────────────────────────────────
def ensure_headers(ws: gspread.Worksheet):
    """Write header row if sheet is empty."""
    row1 = ws.row_values(1)
    if not any(row1):
        ws.insert_row(SHEET_HEADERS, index=1)
        log.info("Header row created.")


def get_existing_keys(ws: gspread.Worksheet) -> set:
    """Return dedup keys (module_name|version_build) for all existing rows."""
    all_rows = ws.get_all_values()
    if len(all_rows) <= 1:
        return set()

    header = all_rows[0]
    try:
        name_col = header.index("Module Name")
        ver_col  = header.index("Version Build")
    except ValueError:
        log.warning("Sheet headers not matched – skipping dedup.")
        return set()

    keys = set()
    for row in all_rows[1:]:
        if len(row) > max(name_col, ver_col):
            k = f"{row[name_col].lower().strip()}|{row[ver_col].lower().strip()}"
            keys.add(k)
    return keys


def push_to_sheets(games: list[dict]):
    """Append only new games (not already in the sheet) to Google Sheets."""
    ws = connect_sheet()
    ensure_headers(ws)

    existing = get_existing_keys(ws)
    log.info("Sheet has %d existing entries.", len(existing))

    new_rows = []
    for g in games:
        key = f"{g['Module Name'].lower().strip()}|{g['Version Build'].lower().strip()}"
        if key not in existing:
            # Build row in same order as SHEET_HEADERS
            new_rows.append([g[h] for h in SHEET_HEADERS])
            existing.add(key)
        else:
            log.debug("SKIP duplicate: %s", g["Module Name"])

    if not new_rows:
        log.info("No new games to add – sheet is up to date.")
        return

    ws.append_rows(new_rows, value_input_option="USER_ENTERED")
    log.info("✅ Added %d new game(s) to Google Sheets.", len(new_rows))


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
def main():
    log.info("=" * 55)
    log.info("AN1.com → Google Sheets Scraper")
    log.info("=" * 55)

    games = scrape_all_games()
    if not games:
        log.error("Nothing scraped – exiting.")
        sys.exit(1)

    push_to_sheets(games)
    log.info("Done.")


if __name__ == "__main__":
    main()
