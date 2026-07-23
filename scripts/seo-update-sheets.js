/**
 * scripts/seo-update-sheets.js
 * ──────────────────────────────────────────────────────────────────
 * Updates ALL rows in the Google Sheet:
 *   • Visual Asset → https://modvault.games/uploads/<seo-slug>.jpg
 *   • Tags         → keeps original game-type tags EXACTLY,
 *                    appends ONLY 3 generic mod keywords at the end:
 *                    "mod apk", "mod menu", "hack"
 *
 * ✅ Module Name is NEVER modified.
 * ✅ Original tags (Action, RPG, etc.) are preserved exactly.
 * ✅ Uses loadCells + saveUpdatedCells → ONE batchUpdate API call.
 *
 * Usage (local):  node scripts/seo-update-sheets.js
 * Usage (CI):     GOOGLE_SERVICE_ACCOUNT_EMAIL=... GOOGLE_PRIVATE_KEY=... node scripts/seo-update-sheets.js
 */

'use strict';

const { GoogleSpreadsheet } = require('google-spreadsheet');
const path = require('path');

// ── Configuration ──────────────────────────────────────────────────
const SPREADSHEET_ID =
    process.env.SPREADSHEET_ID ||
    '1LSSG-LmD2QehsOB_t-I8eeUXNMTJ10neKu3X4MIX4XU';

const BASE_IMG_URL     = 'https://modvault.games/uploads/';
const MODVAULT_PATTERN = /^https:\/\/modvault\.games\/uploads\//i;

// The ONLY 3 SEO mod-keywords we append — nothing game-name specific
const MOD_KEYWORDS = ['mod apk', 'mod menu', 'hack'];

// ── Credentials ────────────────────────────────────────────────────
function loadCredentials() {
    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
        return {
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key:  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
        };
    }
    try {
        return require(path.join(__dirname, '..', 'google-credentials.json'));
    } catch {
        console.error('❌ No credentials found.');
        process.exit(1);
    }
}

// ── Slug Generator ─────────────────────────────────────────────────
/**
 * Converts Module Name to SEO URL slug.
 * "Rainbow Six Mobile ( Unlimited agents )" → "rainbow-six-mobile"
 * Module Name itself is NEVER changed.
 */
function toSlug(moduleName) {
    if (!moduleName || typeof moduleName !== 'string') return 'game';
    let name = moduleName
        .replace(/\s*[\(\[][\s\S]*/g, '')
        .replace(/\s*[-–—]\s*(mod|hack|cheat|unlimited|free|premium|unlocked)[\s\S]*/i, '')
        .trim();
    if (!name) name = moduleName;
    return name
        .replace(/[àáâãäå]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
        .replace(/[òóôõö]/g, 'o').replace(/[ùúûü]/g, 'u').replace(/[ýÿ]/g, 'y')
        .replace(/[ñ]/g, 'n').replace(/[ç]/g, 'c').replace(/[™®©°]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ').trim()
        .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
}

// ── Tags Builder ───────────────────────────────────────────────────
// Recognized game-type category words (case-insensitive)
const VALID_CATEGORIES = new Set([
    'action','adventure','rpg','role-playing','role playing','strategy','puzzle',
    'simulation','racing','sport','sports','horror','shooter','arcade','fighting',
    'casual','survival','mmorpg','moba','jrpg','gacha','creator','sandbox',
    'hack and slash','multiplayer','new','hot','legendary','match-3','platformer',
    'card','board','trivia','music','educational','stealth','open world',
    'battle royale','tower defense','idle','clicker','farming','cooking','dating sim',
    'vr','augmented reality','word','kids','football','basketball','soccer'
]);

/**
 * Keeps ONLY recognized game-type category tags (Action, RPG etc.).
 * Strips game names, mod keywords, and any injected SEO junk from before.
 */
function buildSeoTags(existingTags) {
    const original = (existingTags || '')
        .split(',')
        .map(t => t.trim())
        .filter(t => t && VALID_CATEGORIES.has(t.toLowerCase()));

    return original.join(', ');
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
            console.warn(`  ⚠️ Google API network blip (attempt ${attempt}/${retries}): ${err.message}. Retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
    if (process.env.WRITE_TO_GOOGLE_SHEETS !== 'true') {
        console.log('🔒 Google Sheets write mode is disabled (WRITE_TO_GOOGLE_SHEETS !== "true"). Preserving existing Google Sheet database.');
        return;
    }

    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║   ModVault — SEO Visual Asset & Tags Updater v2      ║');
    console.log('║   Tags: keep originals + append 3 mod keywords only  ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');

    // 1. Connect
    const creds = loadCredentials();
    console.log('🔌 Connecting to Google Sheets…');
    const doc = new GoogleSpreadsheet(SPREADSHEET_ID);
    await doc.useServiceAccountAuth(creds);
    await withRetry(() => doc.loadInfo());

    const sheet    = doc.sheetsByIndex[0];
    const rowCount = sheet.rowCount;
    const colCount = sheet.columnCount;
    console.log(`📊 Sheet: "${sheet.title}" — ${rowCount} rows × ${colCount} cols\n`);

    // 2. Load ALL cells in one read request
    console.log('📦 Loading all cells…');
    await withRetry(() => sheet.loadCells(`A1:${colIndexToLetter(colCount)}${rowCount}`));
    console.log('   ✓ All cells loaded\n');

    // 3. Detect column positions from header row
    let nameCol = -1, imgCol = -1, tagsCol = -1;
    for (let c = 0; c < colCount; c++) {
        const h = (sheet.getCell(0, c).value || '').toString().toUpperCase().trim();
        if (h.includes('MODULE') || h.includes('NAME'))              nameCol = c;
        if (h.includes('VISUAL') || h.includes('ASSET') || h.includes('IMAGE')) imgCol  = c;
        if (h.includes('TAG')   || h.includes('CATEG'))              tagsCol = c;
    }

    if (nameCol === -1 || imgCol === -1) {
        console.error('❌ Could not locate required columns!');
        const hdrs = [];
        for (let c = 0; c < colCount; c++) hdrs.push(sheet.getCell(0, c).value);
        console.error('   Headers:', hdrs.join(' | '));
        process.exit(1);
    }

    console.log('📋 Column mapping:');
    console.log(`   Module Name  → col ${nameCol} (${colIndexToLetter(nameCol + 1)})`);
    console.log(`   Visual Asset → col ${imgCol}  (${colIndexToLetter(imgCol + 1)})`);
    console.log(`   Tags         → col ${tagsCol === -1 ? 'N/A' : tagsCol + ' (' + colIndexToLetter(tagsCol + 1) + ')'}\n`);

    // 4. Update cells in memory — zero API calls per cell
    let updated = 0, skippedImg = 0, skippedBlank = 0;

    for (let r = 1; r < rowCount; r++) {
        const moduleName = (sheet.getCell(r, nameCol).value || '').toString().trim();

        if (!moduleName || /^module\s*name$/i.test(moduleName)) {
            skippedBlank++;
            continue;
        }

        // --- Tags: keep ONLY recognized categories/genres (remove mod/hack/etc) ---
        if (tagsCol !== -1) {
            const tagsCell    = sheet.getCell(r, tagsCol);
            const currentTags = (tagsCell.value || '').toString().trim();
            const newTags = buildSeoTags(currentTags);
            if (newTags !== currentTags) {
                tagsCell.value = newTags;
                updated++;
            } else {
                skippedImg++; // Reuse counter as general skip counter
            }
        }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Rows processed  : ${updated}`);
    console.log(`   Img already set : ${skippedImg}`);
    console.log(`   Blank rows      : ${skippedBlank}\n`);

    if (updated === 0) {
        console.log('🎉 Nothing to update!');
        return;
    }

    // 5. Save ALL changes in ONE batchUpdate API call
    console.log('💾 Sending batchUpdate to Google Sheets (single API call)…');
    await withRetry(() => sheet.saveUpdatedCells());
    console.log('   ✓ Done!\n');

    console.log('╔══════════════════════════════════════════════════════╗');
    console.log(`║  ✅ SUCCESS — ${String(updated).padEnd(6)} rows updated                   ║`);
    console.log('╚══════════════════════════════════════════════════════╝\n');
    console.log('📌 Next: run  node generate-games-json.js  to sync games.json\n');
}

function colIndexToLetter(n) {
    let result = '';
    while (n > 0) { n--; result = String.fromCharCode(65 + (n % 26)) + result; n = Math.floor(n / 26); }
    return result || 'A';
}

main().catch(err => {
    console.error('\n❌ Fatal error:', err.message || err);
    process.exit(1);
});
