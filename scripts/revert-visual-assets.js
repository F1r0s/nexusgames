/**
 * scripts/revert-visual-assets.js
 * ────────────────────────────────────────────────────────────────
 * Restores the original Visual Asset URLs (postimg.cc, cloudinary,
 * an1.com, etc.) from the git-backed original_games_backup.json
 * into BOTH:
 *   1. games.json (local file)
 *   2. Google Sheets "Visual Asset" column
 *
 * Uses loadCells + saveUpdatedCells → single batchUpdate API call.
 * Module Name is NEVER changed. Tags are NOT touched here.
 *
 * Run: node scripts/revert-visual-assets.js
 */

'use strict';

const { GoogleSpreadsheet } = require('google-spreadsheet');
const fs   = require('fs');
const path = require('path');

// ── Config ─────────────────────────────────────────────────────────
const SPREADSHEET_ID =
    process.env.SPREADSHEET_ID ||
    '1LSSG-LmD2QehsOB_t-I8eeUXNMTJ10neKu3X4MIX4XU';

const BACKUP_FILE = path.join(__dirname, 'original_games_backup.json');
const GAMES_FILE  = path.join(__dirname, '..', 'games.json');

// ── Credentials ────────────────────────────────────────────────────
function loadCredentials() {
    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
        return {
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key:  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
        };
    }
    try { return require(path.join(__dirname, '..', 'google-credentials.json')); }
    catch { console.error('❌ No credentials found.'); process.exit(1); }
}

// ── Slug (same logic — used to match sheet rows to backup entries) ──
function toSlug(moduleName) {
    if (!moduleName) return 'game';
    let name = moduleName
        .replace(/\s*[\(\[][\s\S]*/g, '')
        .replace(/\s*[-–—]\s*(mod|hack|cheat|unlimited|free|premium|unlocked)[\s\S]*/i, '')
        .trim();
    if (!name) name = moduleName;
    return name
        .replace(/[àáâãäå]/g,'a').replace(/[èéêë]/g,'e').replace(/[ìíîï]/g,'i')
        .replace(/[òóôõö]/g,'o').replace(/[ùúûü]/g,'u').replace(/[™®©°]/g,'')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g,' ').trim()
        .replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-+|-+$/g,'');
}

// ── Build lookup map: title (normalized) → original img URL ────────
function buildLookup(backupGames) {
    const map = new Map();
    for (const g of backupGames) {
        if (!g.title || !g.img) continue;
        // Skip if the backup itself already had a modvault.games URL (shouldn't happen)
        if (/modvault\.games\/uploads/i.test(g.img)) continue;
        // Key by slug for fuzzy matching
        map.set(toSlug(g.title), g.img);
        // Also key by exact lowercase title for precise match
        map.set(g.title.toLowerCase().trim(), g.img);
    }
    return map;
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║   ModVault — Revert Visual Assets to Originals       ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');

    // 1. Load original backup
    console.log('📖 Loading original backup…');
    const rawBackup   = fs.readFileSync(BACKUP_FILE, 'utf8').replace(/^\uFEFF/, '');
    const backupGames = JSON.parse(rawBackup);
    const lookup      = buildLookup(backupGames);
    console.log(`   ✓ ${lookup.size / 2} original image URLs loaded\n`);

    // ── STEP A: Fix games.json locally ────────────────────────────
    console.log('🔧 Step A — Restoring games.json…');
    const currentGames = JSON.parse(fs.readFileSync(GAMES_FILE, 'utf8'));
    let localFixed = 0;

    for (const game of currentGames) {
        const title = (game.title || '').trim();
        // Try exact title match first, then slug match
        const origImg = lookup.get(title.toLowerCase()) || lookup.get(toSlug(title));
        if (origImg && origImg !== game.img) {
            game.img = origImg;
            localFixed++;
        }
    }

    fs.writeFileSync(GAMES_FILE, JSON.stringify(currentGames, null, 2), 'utf8');
    console.log(`   ✓ Restored ${localFixed} / ${currentGames.length} img fields in games.json\n`);

    // ── STEP B: Fix Google Sheet ───────────────────────────────────
    console.log('🔧 Step B — Restoring Google Sheets Visual Asset column…');
    const creds = loadCredentials();
    const doc   = new GoogleSpreadsheet(SPREADSHEET_ID);
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();

    const sheet    = doc.sheetsByIndex[0];
    const rowCount = sheet.rowCount;
    const colCount = sheet.columnCount;
    console.log(`   Sheet: "${sheet.title}" — ${rowCount} rows\n`);

    // Load all cells
    console.log('   Loading all cells (one read request)…');
    await sheet.loadCells(`A1:${colLetter(colCount)}${rowCount}`);
    console.log('   ✓ Cells loaded\n');

    // Find columns
    let nameCol = -1, imgCol = -1;
    for (let c = 0; c < colCount; c++) {
        const h = (sheet.getCell(0, c).value || '').toString().toUpperCase().trim();
        if (h.includes('MODULE') || h.includes('NAME'))               nameCol = c;
        if (h.includes('VISUAL') || h.includes('ASSET') || h.includes('IMAGE')) imgCol  = c;
    }

    if (nameCol === -1 || imgCol === -1) {
        console.error('❌ Could not find columns!'); process.exit(1);
    }

    console.log(`   Module Name  → col ${nameCol} (${colLetter(nameCol + 1)})`);
    console.log(`   Visual Asset → col ${imgCol}  (${colLetter(imgCol + 1)})\n`);

    // Restore cells in memory
    let sheetFixed = 0, notFound = 0;

    for (let r = 1; r < rowCount; r++) {
        const moduleName = (sheet.getCell(r, nameCol).value || '').toString().trim();
        if (!moduleName) continue;

        const origImg = lookup.get(moduleName.toLowerCase()) || lookup.get(toSlug(moduleName));
        if (!origImg) { notFound++; continue; }

        const imgCell = sheet.getCell(r, imgCol);
        if ((imgCell.value || '').toString() !== origImg) {
            imgCell.value = origImg;
            sheetFixed++;
        }
    }

    console.log(`   ✓ ${sheetFixed} cells to restore | ${notFound} titles not in backup\n`);

    if (sheetFixed > 0) {
        console.log('   Sending batchUpdate (single API call)…');
        await sheet.saveUpdatedCells();
        console.log('   ✓ Google Sheet restored!\n');
    } else {
        console.log('   ✓ Nothing to change in sheet (already restored).\n');
    }

    console.log('╔══════════════════════════════════════════════════════╗');
    console.log(`║  ✅ DONE — games.json: ${String(localFixed).padEnd(4)} fixed               ║`);
    console.log(`║           Sheets:      ${String(sheetFixed).padEnd(4)} cells restored         ║`);
    console.log('╚══════════════════════════════════════════════════════╝\n');
    console.log('📌 Commit and push to deploy the revert.\n');
}

function colLetter(n) {
    let r = '';
    while (n > 0) { n--; r = String.fromCharCode(65 + (n % 26)) + r; n = Math.floor(n / 26); }
    return r || 'A';
}

main().catch(err => {
    console.error('\n❌ Fatal error:', err.message || err);
    process.exit(1);
});
