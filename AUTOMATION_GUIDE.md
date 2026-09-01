# Nexus Games Automation Guide

This guide describes how to automate the process of adding new games (e.g., in batches of 10) to the Nexus Games library.

## How It Works

The Nexus Games frontend (`index.html`) fetches its game data directly from a **Google Sheet** (published as a CSV). The sheet URL is hardcoded in the `SHEET_URL` variable within the frontend code.

To automate adding games, you do **not** need to modify the website code. Instead, you need to automate adding rows to that specific Google Sheet.

## Best Way to Automate: Google Sheets API

The most robust and scalable way to add games programmatically is by using the **Google Sheets API**. This allows you to write a script (e.g., in Python or Node.js) that can read game data from a source (like a file or another API) and append it to your sheet instantly.

### Prerequisites

1.  **Google Cloud Project**: Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a new project.
2.  **Enable API**: Search for "Google Sheets API" and enable it for your project.
3.  **Service Account**:
    -   Go to "IAM & Admin" > "Service Accounts".
    -   Create a new service account.
    -   Create a JSON key for this account and download it (save as `credentials.json`).
4.  **Share the Sheet**: Open your game database Google Sheet and click "Share". Share it with the `client_email` address found in your `credentials.json` file (give it **Editor** access).

### Automation Script Concept (Python)

You can use a Python script with the `gspread` library to batch-add games.

**1. Install Dependencies:**
```bash
pip install gspread oauth2client
```

**2. Create the Script (`add_games.py`):**

```python
import gspread
from oauth2client.service_account import ServiceAccountCredentials

# --- CONFIGURATION ---
SHEET_NAME = "Nexus Games DB"  # The name of your Google Sheet
# Define the scope of the application
scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]

# Authenticate using the Service Account key
creds = ServiceAccountCredentials.from_json_keyfile_name("credentials.json", scope)
client = gspread.authorize(creds)

# Open the Google Sheet
sheet = client.open(SHEET_NAME).sheet1  # Access the first sheet

# --- DATA TO ADD (Example Batch of 10) ---
# Format: [Name, Version, Size, OS, Tags, Image, Link, Description]
new_games = [
    ["Game 1", "v1.0", "150MB", "Android", "Action, RPG", "https://image.url/1.jpg", "https://download.link/1", "Description for Game 1"],
    ["Game 2", "v2.5", "200MB", "iOS", "Strategy", "https://image.url/2.jpg", "https://download.link/2", "Description for Game 2"],
    # ... Add 8 more games here ...
]

# --- APPEND DATA ---
print(f"Adding {len(new_games)} games to the database...")
sheet.append_rows(new_games)
print("Success! Games have been added.")
```

### Alternative: Low-Code Automation (Zapier / IFTTT)

If you prefer not to write code, you can use automation platforms like **Zapier** or **Make (formerly Integromat)**.

1.  **Trigger**: Set up a trigger (e.g., "New Row in Another Sheet", "New RSS Feed Item", or a "Webform Submission").
2.  **Action**: Choose "Google Sheets" -> "Create Spreadsheet Row".
3.  **Map Fields**: Map the incoming data to the columns in your Nexus Games sheet (Name, Version, Size, etc.).

## Data Structure Reference

Ensure your automated inputs match the columns expected by `index.html`:

| Column | Description | Example |
| :--- | :--- | :--- |
| **Name** | The title of the game. | `Subway Surfers Mod` |
| **Version** | Version string. | `v3.12.0` |
| **Size** | File size. | `150MB` |
| **OS** | Supported platform. | `Android, iOS` |
| **Tags** | Categories (comma-separated). | `Action, Arcade` |
| **Image** | Direct URL to a thumbnail. | `https://imgur.com/...` |
| **Link** | The download/destination link. | `https://mega.nz/...` |
| **Description** | Brief description. | `Unlimited coins/keys...` |
