# SETUP.md — AN1.com → Google Sheets Scraper

Complete step-by-step guide to get `scraper.py` running locally.

---

## 1. Install Python

Make sure you have **Python 3.11+** installed.

```bash
python --version
```

---

## 2. Install Dependencies

```bash
pip install -r requirements.txt
```

---

## 3. Create a Google Cloud Project & Service Account

### 3-A  Create a Project

1. Go to [https://console.cloud.google.com/](https://console.cloud.google.com/)
2. Click the project drop-down at the top → **New Project**
3. Give it a name (e.g. `games-scraper`) → **Create**

### 3-B  Enable the Google Sheets API

1. Inside your new project, open the left menu → **APIs & Services → Library**
2. Search for **Google Sheets API** → click it → **Enable**
3. Also search for **Google Drive API** → **Enable**  
   *(Drive API is needed so gspread can list and open spreadsheets by ID)*

### 3-C  Create a Service Account

1. Left menu → **APIs & Services → Credentials**
2. Click **+ Create Credentials → Service Account**
3. Fill in a name (e.g. `sheets-writer`) → **Create and Continue**
4. Role: **Editor** (or at minimum *Spreadsheets* editor) → **Continue → Done**

### 3-D  Generate & Download the JSON Key

1. On the **Credentials** page, click the service account you just created
2. Go to the **Keys** tab → **Add Key → Create new key → JSON → Create**
3. A file like `games-scraper-abc123.json` will download automatically
4. **Rename it to `google-credentials.json`** and place it in the same folder as `scraper.py`

> ⚠️ **Never commit `google-credentials.json` to Git!**  
> It is already in `.gitignore`. Keep it local.

---

## 4. Create the Google Sheet & Share It

1. Go to [https://sheets.google.com](https://sheets.google.com) and create a new spreadsheet
2. Name the first tab anything you like (the scraper uses the first tab by default)
3. **Add the following headers in row 1** (exact spelling matters):

| A | B | C | D | E | F | G | H | I | J |
|---|---|---|---|---|---|---|---|---|---|
| Module Name | Version | Build Data | Size | OS | Architecture | Tags | Visual Asset | Access Link | Data Log |

4. Copy the **Sheet ID** from the URL bar:  
   `https://docs.google.com/spreadsheets/d/`**`<SHEET_ID>`**`/edit`

5. Open the JSON key file you downloaded; find the field `"client_email"` — it looks like:  
   `sheets-writer@games-scraper-abc123.iam.gserviceaccount.com`

6. In your Google Sheet → **Share** (top-right) → paste that email → give it **Editor** access → **Send**

---

## 5. Configure the Scraper

Open `scraper.py` and update the two constants near the top:

```python
CREDENTIALS_FILE = "google-credentials.json"   # ← already correct if you renamed it
SHEET_ID         = "YOUR_ACTUAL_SHEET_ID_HERE"  # ← paste the ID from step 4
```

Or set it as an environment variable (no code change needed):

```powershell
# Windows PowerShell
$env:GOOGLE_SHEET_ID = "YOUR_ACTUAL_SHEET_ID_HERE"
python scraper.py
```

---

## 6. Run the Scraper

```bash
python scraper.py
```

You should see output like:

```
10:32:01  INFO     ============================================================
10:32:01  INFO     AN1.com → Google Sheets Scraper
10:32:01  INFO     ============================================================
10:32:01  INFO     ── Page 1: https://an1.com/games/
10:32:02  INFO     Found 30 game items on page 1.
10:32:02  INFO       → Shadow Fight 4
...
10:35:44  INFO     ✅ Appended 142 new record(s) to the sheet.
10:35:44  INFO     Done.
```

Re-running it will **not** add duplicates — the scraper checks existing rows first.

---

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `FileNotFoundError: google-credentials.json` | Make sure the JSON key is in the same folder as `scraper.py` |
| `gspread.exceptions.SpreadsheetNotFound` | Check the `SHEET_ID` is correct and the sheet is shared with the service account email |
| `403 PERMISSION_DENIED` | Make sure **Google Sheets API** and **Google Drive API** are both enabled in your project |
| `ModuleNotFoundError` | Run `pip install -r requirements.txt` again |
| Empty data / wrong selectors | AN1.com may have updated its HTML; open a game URL and inspect the page source to update selectors in `scraper.py` |

---

## File Overview

```
Realwebsite/
├── scraper.py                          ← Main Python scraper
├── requirements.txt                    ← Python dependencies
├── google-credentials.json             ← Your private key (LOCAL ONLY, never commit!)
├── SETUP.md                            ← This guide
├── auto-fetcher.js                     ← Node.js fetcher (also updated)
└── .github/
    └── workflows/
        └── daily-scraper.yml           ← GitHub Actions automation
```

---

## 8. GitHub Cloud Automation (GitHub Actions)

The scraper runs **automatically every day at 06:00 UTC** via GitHub Actions.  
You need to add two **Secrets** to your GitHub repository so the workflow can authenticate.

### 8-A  Get your credentials JSON as a single-line string

Open your `google-credentials.json` file and copy its **entire contents**  
(we'll paste this as a secret — GitHub stores it securely and never exposes it in logs).

### 8-B  Add GitHub Secrets

1. Go to your GitHub repository → **Settings → Secrets and variables → Actions**
2. Click **New repository secret** and add these two:

| Secret Name | Value |
|---|---|
| `GCP_CREDENTIALS_JSON` | The full JSON text copied from `google-credentials.json` |
| `GOOGLE_SHEET_ID` | Your Google Sheet ID (the long string from the URL) |

### 8-C  Push your code to GitHub

Make sure `scraper.py`, `requirements.txt`, and `.github/workflows/daily-scraper.yml` are committed and pushed:

```powershell
git add scraper.py requirements.txt .github/workflows/daily-scraper.yml SETUP.md
git commit -m "Add Python scraper with GitHub Actions automation"
git push
```

> ⚠️ **NEVER push `google-credentials.json`** — it is in `.gitignore` to keep it safe.

### 8-D  Test the workflow manually

1. Go to your GitHub repo → **Actions** tab
2. Click **Daily Game Scraper** in the left sidebar
3. Click **Run workflow** → **Run workflow** (green button)
4. Watch the live logs — you should see games being scraped and rows added to your Sheet

### Schedule

The workflow runs automatically at **06:00 UTC every day**.  
To change the schedule, edit the `cron:` line in `.github/workflows/daily-scraper.yml`:

```yaml
# Examples:
- cron: '0 6 * * *'    # Every day at 06:00 UTC
- cron: '0 */6 * * *'  # Every 6 hours
- cron: '0 6 * * 1'    # Every Monday at 06:00 UTC
```
