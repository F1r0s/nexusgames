require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// --- STATIC JSON DATABASE (Primary — instant, no latency) ---
const GAMES_JSON_FILE = resolveDataFile('games.json');

// --- GOOGLE SHEETS CONFIG (Background refresh only) ---
const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTmd9N77OuTj1k_QFR0hyiqVjxfZvfnYUPO55kUSFN8RyW7MoZNICzc8gGYZuG0uVL_ccPXnG96ltKT/pub?output=csv";
const FALLBACK_FILE = resolveDataFile('fallback_games.csv');

let gamesCache = {
    data: [],
    lastUpdated: 0,
    isFetching: false
};
const CACHE_DURATION = 10 * 60 * 1000; // 10-minute cache (relaxed — JSON file is the source of truth)

function resolveDataFile(fileName) {
    const candidates = [
        path.join(__dirname, fileName),
        path.join(process.cwd(), fileName),
        path.join('/var/task', fileName),  // Vercel serverless root
        path.join(__dirname, '..', fileName),
    ];

    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate)) {
                console.log(`[FILE] Found ${fileName} at: ${candidate}`);
                return candidate;
            }
        } catch (e) {
            // Path doesn't exist, continue
        }
    }

    console.warn(`[FILE] ${fileName} not found in any candidate locations`);
    return candidates[0];
}

// ── Load static games.json first (instant, no network) ──
try {
    if (fs.existsSync(GAMES_JSON_FILE)) {
        console.log(`[INIT] Loading games.json (static database) from: ${GAMES_JSON_FILE}`);
        const jsonData = JSON.parse(fs.readFileSync(GAMES_JSON_FILE, 'utf8'));
        if (Array.isArray(jsonData) && jsonData.length > 0) {
            gamesCache.data = jsonData;
            gamesCache.lastUpdated = Date.now();
            console.log(`[INIT] ✅ Loaded ${gamesCache.data.length} games from games.json.`);
        }
    }
} catch (e) {
    console.error("[INIT] games.json load failed:", e.message);
}

// ── Fallback to CSV if JSON not available ──
if (gamesCache.data.length === 0) {
    try {
        if (fs.existsSync(FALLBACK_FILE)) {
            console.log(`[INIT] No games.json found at ${GAMES_JSON_FILE}. Loading fallback_games.csv from ${FALLBACK_FILE}...`);
            const fallbackText = fs.readFileSync(FALLBACK_FILE, 'utf8');
            gamesCache.data = parseCSV(fallbackText);
            console.log(`[INIT] Loaded ${gamesCache.data.length} games from fallback CSV.`);
        }
    } catch (e) {
        console.error("[INIT] Fallback load failed:", e.message);
    }
}

// ── Final fallback: Mark that Google Sheets should be fetched on first request if still empty ──
if (gamesCache.data.length === 0) {
    console.warn("[INIT] ⚠️ No local data found. Will fetch from Google Sheets on first request.");
    gamesCache.shouldFetchFromSheets = true;
}

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());

// Serve static files (CSS, images, JS, etc.)
app.use(express.static(path.join(__dirname)));

// Explicit route for style.css to guarantee correct serving on Vercel
app.get('/style.css', (req, res) => {
    res.setHeader('Content-Type', 'text/css');
    res.sendFile(path.join(__dirname, 'style.css'));
});

// Minified CSS (used by index.html for better SEO score)
app.get('/style.min.css', (req, res) => {
    res.setHeader('Content-Type', 'text/css');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(path.join(__dirname, 'style.min.css'));
});

// ── VIDEO STREAMING — supports byte-range requests (seek + mobile buffer) ──
app.get('/video/mod-vault-games.mp4', (req, res) => {
    const videoPath = path.join(__dirname, 'Mod vault games.mp4');
    if (!fs.existsSync(videoPath)) {
        return res.status(404).send('Video not found');
    }
    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
        // Partial content — lets the browser seek and buffer efficiently
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 1048576, fileSize - 1);
        const chunkSize = (end - start) + 1;
        const stream = fs.createReadStream(videoPath, { start, end });
        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': 'video/mp4',
            'Cache-Control': 'public, max-age=3600',
        });
        stream.pipe(res);
    } else {
        // Full file download
        res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=3600',
        });
        fs.createReadStream(videoPath).pipe(res);
    }
});

// Serve the frontend pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/support.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'support.html'));
});

app.get('/privacy.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'privacy.html'));
});

app.get('/game-mode-guide.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'game-mode-guide.html'));
});

app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml');
    res.sendFile(path.join(__dirname, 'sitemap.xml'));
});

app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.sendFile(path.join(__dirname, 'robots.txt'));
});

// ── FAVICON ROUTES — must be explicit so the catch-all rewrite doesn't swallow them ──
app.get('/favicon.ico', (req, res) => {
    res.setHeader('Content-Type', 'image/x-icon');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.sendFile(path.join(__dirname, 'favicon.ico'));
});

app.get('/favicon.svg', (req, res) => {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.sendFile(path.join(__dirname, 'favicon.svg'));
});

app.get('/favicon-16.png', (req, res) => {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.sendFile(path.join(__dirname, 'favicon-16.png'));
});

app.get('/favicon-32.png', (req, res) => {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.sendFile(path.join(__dirname, 'favicon-32.png'));
});

app.get('/favicon-512.png', (req, res) => {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.sendFile(path.join(__dirname, 'favicon-512.png'));
});

app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/manifest+json');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(path.join(__dirname, 'manifest.json'));
});

// ══════════════════════════════════════════════════════════════
// GAMES API — Serves static JSON (instant) with optional
// background refresh from Google Sheets
// ══════════════════════════════════════════════════════════════
app.get('/api/games', async (req, res) => {
    const queryKey = req.query.key;
    const isManualSync = req.query.sync === 'true' || req.query.refresh === 'true';
    
    // Validate secret if manual sync is requested
    const SYNC_SECRET = process.env.SYNC_SECRET || "default_safe_key_123";
    const isAuthorized = queryKey === SYNC_SECRET;
    const forceSync = isManualSync && isAuthorized;
    
    if (isManualSync && !isAuthorized) {
        console.warn(`[AUTH] Unauthorized sync attempt with key: ${queryKey}`);
    }

    // If no data loaded and this is the first request, fetch from Google Sheets immediately
    if (gamesCache.data.length === 0 && gamesCache.shouldFetchFromSheets) {
        console.log("[API] No data in cache. Fetching from Google Sheets immediately...");
        gamesCache.shouldFetchFromSheets = false; // Only try once per startup
        await refreshFromSheets();
    }

    // Only fetch from Google Sheets if manually triggered with auth
    // Normal user requests always get the cached/static data instantly
    if (forceSync) {
        console.log("[API] Authorized manual sync requested.");
        await refreshFromSheets();
    }

    // Set cache headers — Vercel edge will cache this response
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.json(gamesCache.data);
});

// Background refresh from Google Sheets (only for manual sync)
async function refreshFromSheets() {
    if (gamesCache.isFetching) return;
    gamesCache.isFetching = true;
    console.log("[SYNC] Fetching fresh data from Google Sheets...");

    try {
        const fetchUrl = `${SHEET_URL}&t=${Date.now()}`;
        const response = await axios.get(fetchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/csv'
            },
            timeout: 8000
        });
        
        let csvText = response.data;
        if (!csvText || typeof csvText !== 'string' || csvText.length < 100) {
            console.warn(`[SYNC] Invalid response from Google (length: ${csvText ? csvText.length : 0}). Skipping.`);
            return;
        }

        const parsed = parseCSV(csvText);
        
        if (parsed && parsed.length > 0) {
            gamesCache.data = parsed;
            gamesCache.lastUpdated = Date.now();
            console.log(`[SYNC] ✅ Updated cache with ${parsed.length} games from Google Sheets.`);
            
            // Also save to games.json so next deploy has fresh data
            try {
                fs.writeFileSync(GAMES_JSON_FILE, JSON.stringify(parsed, null, 2), 'utf8');
                console.log("[SYNC] ✅ Saved updated games.json to disk.");
            } catch (writeErr) {
                console.warn("[SYNC] Could not write games.json:", writeErr.message);
            }
        } else {
            console.warn("[SYNC] Parsed data is empty. Check CSV structure.");
        }
    } catch (error) {
        console.error("[SYNC] Error fetching Google Sheets:", error.message);
    } finally {
        gamesCache.isFetching = false;
    }
}

// Helper: Improved CSV Parser (Resilient to multi-line fields and various header names)
function parseCSV(csvText) {
    if (!csvText) return [];
    
    const result = [];
    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;

    // Handle string cleaned from BOM or whitespace
    csvText = csvText.trim();

    for (let i = 0; i < csvText.length; i++) {
        const char = csvText[i];
        const nextChar = csvText[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                currentField += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            currentRow.push(currentField);
            currentField = '';
        } else if ((char === '\r' || char === '\n') && !inQuotes) {
            if (char === '\r' && nextChar === '\n') i++;
            if (currentRow.length > 0 || currentField !== '') {
                currentRow.push(currentField);
                rows.push(currentRow);
            }
            currentRow = [];
            currentField = '';
        } else {
            currentField += char;
        }
    }
    // Final field/row
    if (currentRow.length > 0 || currentField !== '') {
        currentRow.push(currentField);
        rows.push(currentRow);
    }

    if (rows.length === 0) return [];

    let headerRowIndex = -1;
    let colMap = { name: -1, ver: -1, size: -1, os: -1, tags: -1, img: -1, link: -1, desc: -1 };

    // Find Header Row (More flexible match)
    for(let i=0; i<Math.min(rows.length, 10); i++) {
        const row = rows[i].map(h => (h||"").trim().toUpperCase());
        const rowStr = row.join('|');
        
        // Priority headers to look for
        if(rowStr.includes("NAME") || rowStr.includes("MODULE") || rowStr.includes("VISUAL")) {
            headerRowIndex = i;
            row.forEach((h, index) => {
                if(h.includes("NAME") || h.includes("MODULE")) colMap.name = index;
                else if(h.includes("VER") || h.includes("BUILD")) colMap.ver = index;
                else if(h.includes("SIZE") || h.includes("MB") || h.includes("GB")) colMap.size = index;
                else if(h.includes("OS") || h.includes("ARCH") || h.includes("SYSTEM")) colMap.os = index;
                else if(h.includes("TAG") || h.includes("CAT")) colMap.tags = index;
                else if(h.includes("VISUAL") || h.includes("IMAGE") || h.includes("ASSET")) colMap.img = index;
                else if(h.includes("LINK") || h.includes("ACCESS") || h.includes("DOWNLOAD")) colMap.link = index;
                else if(h.includes("LOG") || h.includes("DESC") || h.includes("INFO")) colMap.desc = index;
            });
            break;
        }
    }

    // Default fallback if no header found
    if(headerRowIndex === -1) {
        console.warn("[CSV] No header row detected, using index-based fallback.");
        colMap = { name: 0, ver: 1, size: 2, os: 3, tags: 4, img: 5, link: 6, desc: 7 };
    }

    // Start parsing from next row
    for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const cells = rows[i].map(val => (val||"").trim());
        const title = colMap.name > -1 ? cells[colMap.name] : "";
        
        // Skip empty or header-copy rows
        if (!title || title.toUpperCase() === "MODULE NAME" || title.toUpperCase() === "NAME") continue;

        result.push({
            id: 'g' + i + '_' + Date.now().toString(36),
            title: title,
            version: colMap.ver > -1 ? (cells[colMap.ver] || "v1.0") : "v1.0",
            size: colMap.size > -1 ? (cells[colMap.size] || "N/A") : "N/A",
            os: (colMap.os > -1 ? (cells[colMap.os] || "android") : "android").toLowerCase().split(',').map(s=>s.trim()),
            categories: (colMap.tags > -1 ? (cells[colMap.tags] || "General") : "General").split(',').map(s=>s.trim()),
            img: (colMap.img > -1 && cells[colMap.img]) ? cells[colMap.img] : "https://placehold.co/400x300?text=No+Image",
            link: colMap.link > -1 ? (cells[colMap.link] || "#") : "#",
            desc: colMap.desc > -1 ? (cells[colMap.desc] || "No description provided.") : "No description provided."
        });
    }

    return result;
}


// Export the app for Vercel (Serverless)
module.exports = app;

// Only start the server if running locally (not imported)
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n>>> Secure Server is running at http://localhost:${PORT}`);
        console.log(`>>> Serving ${gamesCache.data.length} games from static JSON.`);
        console.log(`>>> Your API Key is hidden safely in the .env file.\n`);
    });
}
