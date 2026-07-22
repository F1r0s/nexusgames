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

// Helper: Retries a promise-returning function with exponential backoff
async function withRetry(fn, retries = 5, initialDelay = 2000) {
    let attempt = 0;
    while (true) {
        try {
            return await fn();
        } catch (err) {
            attempt++;
            const status = err.response ? err.response.status : null;
            const isRetryable = !status || status === 503 || status === 500 || status === 429 || status === 502 || status === 504 || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
            if (attempt > retries || !isRetryable) {
                throw err;
            }
            const delay = initialDelay * Math.pow(2, attempt - 1);
            console.warn(`⚠️ Google API/Network call failed (attempt ${attempt}/${retries}): ${err.message}. Retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

/** Check if a row is a glitch/junk game (Android 8.0, 8.1, 9.0, 9 requirements or missing images) */
function isJunkGameRow(title, osStr, tagsStr, img) {
    if (!title || title.toUpperCase() === 'MODULE NAME' || title.toUpperCase() === 'NAME') return true;
    if (!img || img.includes('placehold.co') || img.includes('placeholder')) return true;
    const combined = `${osStr} ${tagsStr} ${title}`.toLowerCase();
    if (/\bandroid\s*(8\.0|8\.1|9\.0|9)\b/i.test(combined) || /\b(8\.0|8\.1|9\.0)\b/i.test(String(osStr))) {
        return true;
    }
    return false;
}

/** Deduplicate games array keeping the cleanest/newest entry per slug/title */
function deduplicateGames(games) {
    const seen = new Map();
    for (const g of games) {
        if (!g || !g.title) continue;
        const key = g.slug || toSlug(g.title);
        if (!seen.has(key)) {
            seen.set(key, g);
        } else {
            const existing = seen.get(key);
            const existingIsPlaceholder = !existing.img || existing.img.includes('placehold.co');
            const newIsPlaceholder = !g.img || g.img.includes('placehold.co');
            if (existingIsPlaceholder && !newIsPlaceholder) {
                seen.set(key, g);
            }
        }
    }
    return Array.from(seen.values());
}

function toSlug(title) {
    if (!title || typeof title !== 'string') return 'game';
    let name = title
        .replace(/\s*[\(\[][\s\S]*/g, '')
        .replace(/\s*[-–—]\s*(mod|hack|cheat|unlimited|free|premium|unlocked)[\s\S]*/i, '')
        .trim();
    if (!name) name = title;
    return name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
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

    for (let i = 1; i < rows.length; i++) {
        const cells = rows[i].map(val => (val || '').trim());
        const title = cells[0] || '';
        if (!title || title.toUpperCase() === 'MODULE NAME' || title.toUpperCase() === 'NAME') continue;

        let version = cells[1] || 'v1.0';
        let size = 'N/A', osStr = 'android', tagsStr = 'General', img = '', link = '#', desc = '';

        if (cells.length >= 9 || (cells[7] && cells[7].startsWith('http'))) {
            size    = cells[3] || cells[2] || 'N/A';
            osStr   = cells[4] || 'android';
            tagsStr = cells[6] || 'General';
            img     = cells[7] || 'https://placehold.co/400x300?text=No+Image';
            link    = cells[8] || '#';
            desc    = cells[9] || 'No description provided.';
        } else {
            size    = cells[2] || 'N/A';
            osStr   = cells[3] || 'android';
            tagsStr = cells[4] || 'General';
            img     = cells[5] || 'https://placehold.co/400x300?text=No+Image';
            link    = cells[6] || '#';
            desc    = cells[7] || 'No description provided.';
        }
        if (isJunkGameRow(title, osStr, tagsStr, img)) continue;

        const osArr = [];
        const lowerOs = osStr.toLowerCase();
        if (lowerOs.includes('ios') || lowerOs.includes('apple')) osArr.push('ios');
        if (lowerOs.includes('android') || lowerOs.includes('apk') || osArr.length === 0) osArr.push('android');

        let categories = tagsStr
            .split(',')
            .map(s => s.trim())
            .filter(c => c && !/^android/i.test(c) && !/^\d+\.?\d*/.test(c) && !/^arm/i.test(c));

        if (categories.length === 0) categories = ['General'];

        const slug = toSlug(title);
        const screenshots = [
            img,
            `https://picsum.photos/seed/${slug}-gameplay1/600/350`,
            `https://picsum.photos/seed/${slug}-gameplay2/600/350`
        ];

        result.push({
            id: 'g' + i + '_' + Date.now().toString(36),
            title: title,
            slug: slug,
            version: version,
            size: size,
            os: osArr,
            categories: categories,
            img: img,
            screenshots: screenshots,
            link: link,
            desc: desc
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
    await withRetry(() => doc.loadInfo());

    const sheet = doc.sheetsByIndex[0];
    const rows = await withRetry(() => sheet.getRows());

    const timestamp = Date.now().toString(36);

    const parsed = rows
        .map((row, i) => {
            const raw = row._rawData || [];
            const title = (raw[0] || '').toString().trim();

            let version = raw[1] ? raw[1].toString().trim() : 'v1.0';
            let size = 'N/A', osStr = 'android', tagsStr = 'General', img = '', link = '#', desc = '';

            // Detect 10-column layout vs 8-column layout
            if (raw.length >= 9 || (raw[7] && raw[7].toString().startsWith('http'))) {
                size    = raw[3] || raw[2] || 'N/A';
                osStr   = raw[4] || 'android';
                tagsStr = raw[6] || 'General';
                img     = raw[7] || 'https://placehold.co/400x300?text=No+Image';
                link    = raw[8] || '#';
                desc    = raw[9] || 'No description provided.';
            } else {
                size    = raw[2] || 'N/A';
                osStr   = raw[3] || 'android';
                tagsStr = raw[4] || 'General';
                img     = raw[5] || 'https://placehold.co/400x300?text=No+Image';
                link    = raw[6] || '#';
                desc    = raw[7] || 'No description provided.';
            }

            if (isJunkGameRow(title, osStr, tagsStr, img)) return null;

            // Build clean OS array
            const osArr = [];
            const lowerOs = osStr.toLowerCase();
            if (lowerOs.includes('ios') || lowerOs.includes('apple')) osArr.push('ios');
            if (lowerOs.includes('android') || lowerOs.includes('apk') || osArr.length === 0) osArr.push('android');

            // Clean Categories
            let categories = tagsStr
                .split(',')
                .map(s => s.trim())
                .filter(c => c && !/^android/i.test(c) && !/^\d+\.?\d*/.test(c) && !/^arm/i.test(c));

            if (categories.length === 0) categories = ['General'];

            const slug = toSlug(title);
            const screenshots = [
                img,
                `https://picsum.photos/seed/${slug}-gameplay1/600/350`,
                `https://picsum.photos/seed/${slug}-gameplay2/600/350`
            ];

            return {
                id: `g${i + 1}_${timestamp}`,
                title: title,
                slug: slug,
                version: version,
                size: size,
                os: osArr,
                categories: categories,
                img: img,
                screenshots: screenshots,
                link: link,
                desc: desc
            };
        })
        .filter(Boolean);

    return deduplicateGames(parsed);
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
            // Web-published CSV fallback with retry
            const SHEET_URL = `https://docs.google.com/spreadsheets/d/e/2PACX-1vTmd9N77OuTj1k_QFR0hyiqVjxfZvfnYUPO55kUSFN8RyW7MoZNICzc8gGYZuG0uVL_ccPXnG96ltKT/pub?output=csv&t=${Date.now()}`;
            const response = await withRetry(() => fetch(SHEET_URL));
            if (!response.ok) throw new Error(`Web-published CSV returned HTTP ${response.status}`);
            const csvText = await response.text();
            games = deduplicateGames(parseCSV(csvText));
            
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
