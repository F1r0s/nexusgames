"""
scraper.py – an1.com → Google Sheets (5 random games, no duplicates)
"""

import time, json, re, os, logging, sys, random
from typing import Optional
import requests
from bs4 import BeautifulSoup
import gspread
from google.oauth2.service_account import Credentials

# ─── CONFIG ──────────────────────────────────────────────────
CREDENTIALS_FILE = "google-credentials.json"
SHEET_ID = os.getenv(
    "GOOGLE_SHEET_ID",
    "1vTmd9N77OuTj1k_QFR0hyiqVjxfZvfnYUPO55kUSFN8RyW7MoZNICzc8gGYZuG0uVL_ccPXnG96ltKT"
)
SHEET_TAB_INDEX  = 0
GAMES_TO_ADD     = 5       # How many new unique games to add per run
MAX_PAGES        = 50      # an1.com has ~50 pages
REQUEST_DELAY    = 1.5     # seconds between requests
REQUEST_TIMEOUT  = 20

HEADERS_HTTP = {
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

# Must exactly match your Google Sheet row 1
SHEET_HEADERS = [
    "Module Name", "Version Build", "Data Size",
    "OS Architecture", "Tags", "Visual Asset",
    "Access Link", "Data Log",
]

# ─── LOGGING ─────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

# ─── HTTP ────────────────────────────────────────────────────
_session = requests.Session()
_session.headers.update(HEADERS_HTTP)

def fetch(url: str, retries: int = 3) -> Optional[BeautifulSoup]:
    for attempt in range(1, retries + 1):
        try:
            r = _session.get(url, timeout=REQUEST_TIMEOUT)
            r.raise_for_status()
            return BeautifulSoup(r.text, "html.parser")
        except requests.RequestException as e:
            log.warning("Attempt %d/%d – %s: %s", attempt, retries, url, e)
            if attempt < retries:
                time.sleep(REQUEST_DELAY * attempt)
    return None

# ─── PAGE URL ────────────────────────────────────────────────
def page_url(n: int) -> str:
    return "https://an1.com/games/" if n == 1 else f"https://an1.com/games/page/{n}/"

# ─── DETAIL PAGE ─────────────────────────────────────────────
def parse_detail(url: str) -> dict:
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

    def t(sel, attr=None):
        el = soup.select_one(sel)
        if not el: return ""
        return (el.get(attr) or "").strip() if attr else el.get_text(strip=True)

    # Version
    ver = t('span[itemprop="softwareVersion"]') or t('.version')
    if ver and not ver.startswith("v"):
        ver = "v" + ver
    ver = ver or fallback["version_build"]

    # Size
    size = t('span[itemprop="fileSize"]') or t('span.size')
    if not size:
        for li in soup.select("ul.app_info li, ul.spec li, .box_app_info li"):
            txt = li.get_text(" ", strip=True)
            if re.search(r"\bsize\b", txt, re.I):
                m = re.search(r"([\d.,]+\s*(MB|GB|KB))", txt, re.I)
                if m: size = m.group(1); break
    size = size or fallback["data_size"]

    # OS
    os_val = t('span[itemprop="operatingSystem"]') or "Android, iOS"

    # Tags / Genre
    names = [el.get_text(strip=True) for el in soup.select('span[itemprop="name"]')]
    genre = names[2] if len(names) > 2 else (
        t('span[itemprop="applicationCategory"]') or "Game"
    )
    tags = f"{genre}, New"

    # Description
    desc = t('div[itemprop="description"]') or t('meta[name="description"]', attr="content") or fallback["data_log"]
    if len(desc) > 280:
        desc = desc[:280].rstrip() + "…"

    time.sleep(REQUEST_DELAY)
    return {"version_build": ver, "data_size": size, "os_architecture": os_val, "tags": tags, "data_log": desc}

# ─── COLLECT ALL GAMES FROM A SINGLE PAGE ────────────────────
def games_on_page(page_num: int) -> list[dict]:
    soup = fetch(page_url(page_num))
    if not soup:
        return []
    items = soup.select(".item_app, .game-item, article.app")
    results = []
    for item in items:
        title_el = item.select_one(".name a span") or item.select_one(".name a")
        title = title_el.get_text(strip=True) if title_el else ""
        link_el = item.select_one(".name a") or item.select_one("a[href]")
        link = (link_el.get("href") or "") if link_el else ""
        if link and not link.startswith("http"): link = "https://an1.com" + link
        img_el = item.select_one("img[src]")
        img = (img_el.get("src") or "") if img_el else ""
        if img and not img.startswith("http"): img = "https://an1.com" + img
        if title and link:
            results.append({"title": title, "link": link, "img": img})
    return results

# ─── GOOGLE SHEETS ───────────────────────────────────────────
def build_creds() -> Credentials:
    env = os.getenv("GCP_CREDENTIALS_JSON", "").strip()
    if env:
        log.info("Auth: env var GCP_CREDENTIALS_JSON")
        return Credentials.from_service_account_info(json.loads(env), scopes=SCOPES)
    if os.path.exists(CREDENTIALS_FILE):
        log.info("Auth: local file %s", CREDENTIALS_FILE)
        return Credentials.from_service_account_file(CREDENTIALS_FILE, scopes=SCOPES)
    raise FileNotFoundError(
        "No credentials!\n"
        "  GitHub Actions → secret: GCP_CREDENTIALS_JSON\n"
        f"  Local dev      → file:   {CREDENTIALS_FILE}"
    )

def connect_sheet() -> gspread.Worksheet:
    gc = gspread.authorize(build_creds())
    wb = gc.open_by_key(SHEET_ID)
    ws = wb.get_worksheet(SHEET_TAB_INDEX)
    log.info("Connected: '%s'", wb.title)
    return ws

def ensure_headers(ws):
    if not any(ws.row_values(1)):
        ws.insert_row(SHEET_HEADERS, index=1)
        log.info("Headers written.")

def get_existing_keys(ws) -> set:
    rows = ws.get_all_values()
    if len(rows) <= 1: return set()
    try:
        h = rows[0]
        ni, vi = h.index("Module Name"), h.index("Version Build")
    except ValueError:
        return set()
    return {f"{r[ni].lower().strip()}|{r[vi].lower().strip()}" for r in rows[1:] if len(r) > max(ni, vi)}

# ─── MAIN ────────────────────────────────────────────────────
def main():
    log.info("=" * 55)
    log.info("AN1.com → Google Sheets  (5 random unique games)")
    log.info("=" * 55)

    ws = connect_sheet()
    ensure_headers(ws)
    existing_keys = get_existing_keys(ws)
    log.info("Sheet has %d existing entries.", len(existing_keys))

    # Pick random pages to search from
    page_order = list(range(1, MAX_PAGES + 1))
    random.shuffle(page_order)

    new_rows = []

    for page_num in page_order:
        if len(new_rows) >= GAMES_TO_ADD:
            break

        log.info("── Checking page %d …", page_num)
        candidates = games_on_page(page_num)
        if not candidates:
            continue

        # Shuffle within the page too — true randomness
        random.shuffle(candidates)

        for c in candidates:
            if len(new_rows) >= GAMES_TO_ADD:
                break

            # Quick pre-check by title only (before fetching detail)
            title_key_prefix = c["title"].lower().strip()
            if any(k.startswith(title_key_prefix + "|") for k in existing_keys):
                log.debug("Pre-skip (title exists): %s", c["title"])
                continue

            log.info("  → %s", c["title"])
            details = parse_detail(c["link"])

            key = f"{c['title'].lower().strip()}|{details['version_build'].lower().strip()}"
            if key in existing_keys:
                log.info("  SKIP duplicate: %s", c["title"])
                continue

            row = [
                c["title"],
                details["version_build"],
                details["data_size"],
                details["os_architecture"],
                details["tags"],
                c["img"],
                c["link"],
                details["data_log"],
            ]
            new_rows.append(row)
            existing_keys.add(key)
            log.info("  ✔ Queued: %s", c["title"])

        time.sleep(REQUEST_DELAY)

    if not new_rows:
        log.info("No new unique games found this run.")
        return

    ws.append_rows(new_rows, value_input_option="USER_ENTERED")
    log.info("✅ Added %d new game(s) to Google Sheets.", len(new_rows))
    log.info("Done.")

if __name__ == "__main__":
    main()
