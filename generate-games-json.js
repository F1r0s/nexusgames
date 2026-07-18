/**
 * generate-games-json.js
 * Reads Google Sheets directly using API to generate games.json (static database).
 * Falls back to local fallback_games.csv if Google Sheets API fails.
 * Run: node generate-games-json.js
 */
const fs = require('fs');
const path = require('path');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const FALLBACK_FILE = path.join(__dirname, 'fallback_games.csv');
const OUTPUT_FILE   = path.join(__dirname, 'games.json');

const SPREADSHEET_ID =
    process.env.SPREADSHEET_ID ||
    '1LSSG-LmD2QehsOB_t-I8eeUXNMTJ10neKu3X4MIX4XU';

// ── Credentials Loader ─────────────────────────────────────────────
function loadCredentials() {
    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
        return {
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key:  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
        };
    }
    try {
        return require(path.join(__dirname, 'google-credentials.json'));
    } catch {
        return null;
    }
}

// ── Minimal CSV Parser for Fallback ────────────────────────────────
function parseCSV(csvText) {
    if (!csvText) return [];
    const result = [], rows = [];
    let currentRow = [], currentField = '', inQuotes = false;
    csvText = csvText.trim();

    for (let i = 0; i < csvText.length; i++) {
        const char = csvText[i], nextChar = csvText[i + 1];
        if (char === '"') {
            if (inQuotes && nextChar === '"') { currentField += '"'; i++; }
            else { inQuotes = !inQuotes; }
        } else if (char === ',' && !inQuotes) {
            currentRow.push(currentField); currentField = '';
        } else if ((char === '\r' || char === '\n') && !inQuotes) {
            if (char === '\r' && nextChar === '\n') i++;
            if (currentRow.length > 0 || currentField !== '') {
                currentRow.push(currentField); rows.push(currentRow);
            }
            currentRow = []; currentField = '';
        } else {
            currentField += char;
        }
    }
    if (currentRow.length > 0 || currentField !== '') {
        currentRow.push(currentField); rows.push(currentRow);
    }
    if (rows.length === 0) return [];

    let headerRowIndex = -1;
    let colMap = { name: -1, ver: -1, size: -1, os: -1, tags: -1, img: -1, link: -1, desc: -1 };

    for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const row = rows[i].map(h => (h || '').trim().toUpperCase());
        const rowStr = row.join('|');
        if (rowStr.includes('NAME') || rowStr.includes('MODULE') || rowStr.includes('VISUAL')) {
            headerRowIndex = i;
            row.forEach((h, index) => {
                if (h.includes('NAME') || h.includes('MODULE')) colMap.name = index;
                else if (h.includes('VER') || h.includes('BUILD')) colMap.ver = index;
                else if (h.includes('SIZE') || h.includes('MB') || h.includes('GB')) colMap.size = index;
                else if (h.includes('OS') || h.includes('ARCH') || h.includes('SYSTEM')) colMap.os = index;
                else if (h.includes('TAG') || h.includes('CAT')) colMap.tags = index;
                else if (h.includes('VISUAL') || h.includes('IMAGE') || h.includes('ASSET')) colMap.img = index;
                else if (h.includes('LINK') || h.includes('ACCESS') || h.includes('DOWNLOAD')) colMap.link = index;
                else if (h.includes('LOG') || h.includes('DESC') || h.includes('INFO')) colMap.desc = index;
            });
            break;
        }
    }

    if (headerRowIndex === -1) {
        colMap = { name: 0, ver: 1, size: 2, os: 3, tags: 4, img: 5, link: 6, desc: 7 };
    }

    for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const cells = rows[i].map(val => (val || '').trim());
        const title = colMap.name > -1 ? cells[colMap.name] : '';
        if (!title || title.toUpperCase() === 'MODULE NAME' || title.toUpperCase() === 'NAME') continue;

        result.push({
            id: 'g' + i + '_' + Date.now().toString(36),
            title: title,
            version: colMap.ver > -1 ? (cells[colMap.ver] || 'v1.0') : 'v1.0',
            size: colMap.size > -1 ? (cells[colMap.size] || 'N/A') : 'N/A',
            os: (colMap.os > -1 ? (cells[colMap.os] || 'android') : 'android').toLowerCase().split(',').map(s => s.trim()),
            categories: (colMap.tags > -1 ? (cells[colMap.tags] || 'General') : 'General').split(',').map(s => s.trim()),
            img: (colMap.img > -1 && cells[colMap.img]) ? cells[colMap.img] : 'https://placehold.co/400x300?text=No+Image',
            link: colMap.link > -1 ? (cells[colMap.link] || '#') : '#',
            desc: colMap.desc > -1 ? (cells[colMap.desc] || 'No description provided.') : 'No description provided.'
        });
    }
    return result;
}

// ── Google Sheets API Loader ───────────────────────────────────────
async function fetchFromSheetsDirect() {
    const creds = loadCredentials();
    if (!creds) {
        throw new Error('No Google service account credentials found.');
    }

    const doc = new GoogleSpreadsheet(SPREADSHEET_ID);
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();

    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();

    // Map columns dynamically
    const headers = sheet.headerValues;
    const nameKey = headers.find(h => /module|name/i.test(h)) || 'Module Name';
    const verKey  = headers.find(h => /version|ver/i.test(h)) || 'Version';
    const sizeKey = headers.find(h => /size|mb|gb/i.test(h)) || 'Size';
    const osKey   = headers.find(h => /os|system/i.test(h)) || 'OS';
    const tagsKey = headers.find(h => /tag|categor/i.test(h)) || 'Tags';
    const imgKey  = headers.find(h => /visual|asset|image/i.test(h)) || 'Visual Asset';
    const linkKey = headers.find(h => /link|access|download/i.test(h)) || 'Access Link';
    const descKey = headers.find(h => /log|desc|info/i.test(h)) || 'Data Log';

    const timestamp = Date.now().toString(36);

    return rows
        .map((row, i) => {
            const title = (row[nameKey] || '').toString().trim();
            if (!title || title.toUpperCase() === 'MODULE NAME' || title.toUpperCase() === 'NAME') return null;

            return {
                id: `g${i + 1}_${timestamp}`,
                title: title,
                version: row[verKey] ? row[verKey].toString().trim() : 'v1.0',
                size: row[sizeKey] ? row[sizeKey].toString().trim() : 'N/A',
                os: (row[osKey] ? row[osKey].toString() : 'android').toLowerCase().split(',').map(s => s.trim()),
                categories: (row[tagsKey] ? row[tagsKey].toString() : 'General').split(',').map(s => s.trim()),
                img: (row[imgKey] ? row[imgKey].toString().trim() : 'https://placehold.co/400x300?text=No+Image'),
                link: row[linkKey] ? row[linkKey].toString().trim() : '#',
                desc: row[descKey] ? row[descKey].toString().trim() : 'No description provided.'
            };
        })
        .filter(Boolean);
}

// ── Generate Main Function ─────────────────────────────────────────
async function generate() {
    try {
        console.log('Fetching latest data directly from Google Sheets API...');
        let games = [];
        try {
            games = await fetchFromSheetsDirect();
            console.log(`✅ Loaded ${games.length} games directly from Google Sheets API.`);
        } catch (apiErr) {
            console.warn(`⚠️  Google Sheets API load failed (${apiErr.message}). Falling back to cached CSV/web-published CSV...`);
            // Web-published CSV fallback
            const SHEET_URL = `https://docs.google.com/spreadsheets/d/e/2PACX-1vTmd9N77OuTj1k_QFR0hyiqVjxfZvfnYUPO55kUSFN8RyW7MoZNICzc8gGYZuG0uVL_ccPXnG96ltKT/pub?output=csv&t=${Date.now()}`;
            const response = await fetch(SHEET_URL);
            if (!response.ok) throw new Error(`Web-published CSV returned HTTP ${response.status}`);
            const csvText = await response.text();
            games = parseCSV(csvText);
            
            // Save CSV to fallback file
            fs.writeFileSync(FALLBACK_FILE, csvText, 'utf8');
            console.log(`✅ Updated fallback_games.csv from web-published CSV`);
        }

        if (games.length > 0) {
            fs.writeFileSync(OUTPUT_FILE, JSON.stringify(games, null, 2), 'utf8');
            console.log(`✅ Generated games.json with ${games.length} games (${(fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1)} KB)`);
        } else {
            console.error("❌ No games loaded. Aborting update.");
        }
    } catch (err) {
        console.error("❌ Error generating games.json:", err.message);
        process.exit(1);
    }
}

generate();
