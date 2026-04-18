/**
 * auto-fetcher.js
 * ───────────────
 * Scrapes ALL games from https://an1.com/games/ (all pages),
 * extracts structured data, and appends ONLY new rows to Google Sheets
 * (deduplication based on Module Name + Version).
 *
 * Run locally:  node auto-fetcher.js
 */

'use strict';

const axios              = require('axios');
const cheerio            = require('cheerio');
const { GoogleSpreadsheet } = require('google-spreadsheet');

// ─────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────
const SPREADSHEET_ID = process.env.SPREADSHEET_ID
    || '1vTmd9N77OuTj1k_QFR0hyiqVjxfZvfnYUPO55kUSFN8RyW7MoZNICzc8gGYZuG0uVL_ccPXnG96ltKT';

const BASE_URL      = 'https://an1.com/games/';
const REQUEST_DELAY = 1500;   // ms between requests (be polite)
const MAX_PAGES     = 999;    // safety cap

// Load local credentials file (local dev)
let localCreds;
try {
    localCreds = require('./google-credentials.json');
} catch {
    console.log('ℹ️  No local google-credentials.json found. Relying on env vars.');
}

// HTTP client shared across all requests
const http = axios.create({
    timeout: 20_000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
    }
});

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Fetch a URL with retry on failure. Returns a Cheerio instance or null. */
async function fetchPage(url, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await http.get(url);
            return cheerio.load(res.data);
        } catch (err) {
            console.warn(`  ⚠ Attempt ${attempt}/${retries} failed for ${url}: ${err.message}`);
            if (attempt < retries) await sleep(REQUEST_DELAY * attempt);
        }
    }
    console.error(`  ✗ Giving up on ${url}`);
    return null;
}

// ─────────────────────────────────────────────────────────────
// DETAIL PAGE  → version, buildData, size, os, arch, tags, dataLog
// ─────────────────────────────────────────────────────────────
async function fetchGameDetails(gameUrl) {
    const fallback = {
        version:      'v1.0',
        buildData:    'N/A',
        size:         'N/A',
        os:           'Android',
        architecture: 'arm64-v8a',
        tags:         'Game, New',
        dataLog:      'No description available.'
    };

    const $ = await fetchPage(gameUrl);
    if (!$) return fallback;

    // Version
    let version = $('span[itemprop="softwareVersion"]').text().trim()
        || $('.version').text().trim()
        || fallback.version;
    if (version && !version.startsWith('v')) version = 'v' + version;

    // Build data – look for any spec row mentioning "build"
    let buildData = fallback.buildData;
    $('ul.app_info li, ul.spec li, .box_app_info li').each((_, li) => {
        const txt = $(li).text().trim();
        if (/build/i.test(txt)) {
            const parts = txt.split(':');
            buildData = (parts[1] || parts[0]).trim();
            return false; // break
        }
    });

    // Size
    let size = $('span[itemprop="fileSize"]').text().trim()
        || $('span.size').text().trim()
        || fallback.size;
    if (!size || size === fallback.size) {
        $('ul.app_info li, ul.spec li, .box_app_info li').each((_, li) => {
            const txt = $(li).text().trim();
            if (/size/i.test(txt)) {
                const m = txt.match(/([\d.]+\s*(MB|GB|KB))/i);
                if (m) { size = m[1]; return false; }
            }
        });
    }

    // OS
    const os = $('span[itemprop="operatingSystem"]').text().trim() || 'Android';

    // Architecture
    let architecture = fallback.architecture;
    $('ul.app_info li, ul.spec li, .box_app_info li').each((_, li) => {
        const txt = $(li).text().trim();
        if (/arch|abi|arm|x86/i.test(txt)) {
            architecture = txt.replace(/^[^:]+:\s*/, '').trim();
            return false;
        }
    });

    // Tags / Genre — breadcrumb position 2: AN1.com › Games › <Genre> › Developer
    const cats = $('span[itemprop="name"]').map((_, el) => $(el).text().trim()).get();
    const genre = cats[2]
        || $('span[itemprop="applicationCategory"]').text().trim()
        || 'Game';
    const tags = `${genre}, New`;

    // Description
    let dataLog = $('div[itemprop="description"]').text().trim()
        || $('meta[name="description"]').attr('content')
        || fallback.dataLog;
    if (dataLog.length > 280) dataLog = dataLog.substring(0, 280).trim() + '…';

    await sleep(REQUEST_DELAY);

    return { version, buildData, size, os, architecture, tags, dataLog };
}

// ─────────────────────────────────────────────────────────────
// LISTING PAGES  → iterate all paginated pages
// ─────────────────────────────────────────────────────────────
async function scrapeAllGames() {
    const games  = [];
    let pageUrl  = BASE_URL;

    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
        console.log(`\n── Page ${pageNum}: ${pageUrl}`);

        const $ = await fetchPage(pageUrl);
        if (!$) { console.error('Failed to fetch page. Stopping.'); break; }

        const items = $('.item_app, .game-item, article.app');
        if (!items.length) {
            console.log('No items found on this page — pagination complete.');
            break;
        }

        console.log(`  Found ${items.length} items.`);

        for (const el of items.toArray()) {
            // Title
            const titleEl = $(el).find('.name a span').first()
                || $(el).find('.name a')
                || $(el).find('h2 a, h3 a, .title a');
            const title = $(el).find('.name a span').first().text().trim()
                || $(el).find('.name a').text().trim()
                || 'Unknown';

            // Link
            let link = $(el).find('.name a').attr('href')
                || $(el).find('a[href]').first().attr('href')
                || '';
            if (link && !link.startsWith('http')) link = 'https://an1.com' + link;

            // Icon
            let img = $(el).find('img[src]').first().attr('src') || '';
            if (img && !img.startsWith('http')) img = 'https://an1.com' + img;

            if (!title || !link) continue;

            console.log(`  → ${title}`);
            const d = await fetchGameDetails(link);

            games.push({
                'Module Name':  title,
                'Version':      d.version,
                'Build Data':   d.buildData,
                'Size':         d.size,
                'OS':           d.os,
                'Architecture': d.architecture,
                'Tags':         d.tags,
                'Visual Asset': img,
                'Access Link':  link,
                'Data Log':     d.dataLog
            });
        }

        // Next page
        const nextLink = $('a[rel="next"]').attr('href')
            || $('a:contains("Next")').last().attr('href')
            || $('a:contains("»")').last().attr('href')
            || null;

        if (nextLink) {
            pageUrl = nextLink.startsWith('http') ? nextLink : 'https://an1.com' + nextLink;
            await sleep(REQUEST_DELAY);
        } else {
            console.log('No next-page link — done.');
            break;
        }
    }

    console.log(`\nTotal games scraped: ${games.length}`);
    return games;
}

// ─────────────────────────────────────────────────────────────
// GOOGLE SHEETS  → connect, deduplicate, append
// ─────────────────────────────────────────────────────────────

/** Unique dedup key for a game row (case-insensitive). */
const dedupKey = (name, version) =>
    `${String(name).toLowerCase().trim()}|${String(version).toLowerCase().trim()}`;

async function pushToSheets(games) {
    if (!SPREADSHEET_ID || SPREADSHEET_ID === 'YOUR_SHEET_ID_HERE') {
        console.error('\n❌ ERROR: Please set a valid SPREADSHEET_ID.');
        return;
    }

    console.log('\nConnecting to Google Sheets…');
    const doc = new GoogleSpreadsheet(SPREADSHEET_ID);

    // Auth: env vars (GitHub Actions) → local JSON file
    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
        await doc.useServiceAccountAuth({
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key:  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
        });
    } else if (localCreds) {
        await doc.useServiceAccountAuth(localCreds);
    } else {
        throw new Error('No Google Sheets credentials available!');
    }

    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];

    // Ensure header row
    const headerRow = await sheet.headerValues;
    if (!headerRow || !headerRow.length) {
        await sheet.setHeaderRow([
            'Module Name', 'Version', 'Build Data', 'Size',
            'OS', 'Architecture', 'Tags', 'Visual Asset', 'Access Link', 'Data Log'
        ]);
        console.log('Header row created.');
    }

    // Build dedup set from existing rows
    const existing = await sheet.getRows();
    const existingKeys = new Set(
        existing.map(r => dedupKey(r['Module Name'], r['Version']))
    );
    console.log(`Sheet has ${existingKeys.size} existing entries.`);

    // Filter out duplicates
    const newGames = [];
    for (const g of games) {
        const key = dedupKey(g['Module Name'], g['Version']);
        if (!existingKeys.has(key)) {
            newGames.push(g);
            existingKeys.add(key);   // prevent in-batch dupes
        } else {
            console.log(`  SKIP (duplicate): ${g['Module Name']}`);
        }
    }

    if (!newGames.length) {
        console.log('✅ No new games to add — sheet is already up to date.');
        return;
    }

    await sheet.addRows(newGames);
    console.log(`🎉 Added ${newGames.length} new game(s) to Google Sheets!`);
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────
async function run() {
    try {
        console.log('='.repeat(60));
        console.log('AN1.com → Google Sheets Auto-Fetcher');
        console.log('='.repeat(60));

        const games = await scrapeAllGames();

        if (!games.length) {
            console.error('No games scraped. Exiting.');
            return;
        }

        await pushToSheets(games);
        console.log('\nDone.');
    } catch (err) {
        console.error('\n❌ Fatal error:', err.message || err);
        process.exit(1);
    }
}

run();
