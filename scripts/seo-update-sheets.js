/**
 * scripts/seo-update-sheets.js
 * ──────────────────────────────────────────────────────────────────
 * Updates ALL rows in the Google Sheet:
 *   • Visual Asset → https://modvault.games/uploads/<seo-slug>.jpg
 *   • Tags         → enriched with SEO keywords from Module Name
 *
 * ✅ Module Name is NEVER modified.
 * ✅ Rows already having a modvault.games/uploads/ URL are skipped.
 * ✅ Uses loadCells + saveUpdatedCells → ONE batchUpdate API call for
 *    ALL 2500+ changes. No quota issues.
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
        console.error('❌ No credentials found. Provide GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY env vars, or place google-credentials.json in the project root.');
        process.exit(1);
    }
}

// ── Slug Generator ─────────────────────────────────────────────────
/**
 * Converts a Module Name to an SEO-friendly URL slug.
 * "Rainbow Six Mobile ( Unlimited agents , Unlimited money )" → "rainbow-six-mobile"
 * "Clash of Clans [Unlimited Money, Unlimited Gems]"          → "clash-of-clans"
 * Module Name itself is NEVER modified — slug is ONLY used for the img URL.
 */
function toSlug(moduleName) {
    if (!moduleName || typeof moduleName !== 'string') return 'game';
    // Extract core game name before mod descriptor
    let name = moduleName
        .replace(/\s*[\(\[][\s\S]*/g, '')   // strip everything from ( or [ onwards
        .replace(/\s*[-–—]\s*(mod|hack|cheat|unlimited|free|premium|unlocked)[\s\S]*/i, '')
        .trim();
    if (!name) name = moduleName;

    return name
        // Transliterate accented chars
        .replace(/[àáâãäå]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
        .replace(/[òóôõö]/g, 'o').replace(/[ùúûü]/g, 'u').replace(/[ýÿ]/g, 'y')
        .replace(/[ñ]/g, 'n').replace(/[ç]/g, 'c').replace(/[™®©°]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')   // special chars → space
        .trim()
        .replace(/\s+/g, '-')             // spaces → hyphens
        .replace(/-+/g, '-')              // collapse repeated hyphens
        .replace(/^-+|-+$/g, '');         // trim edge hyphens
}

// ── SEO Tags Builder ───────────────────────────────────────────────
function extractModFeatures(moduleName) {
    const patterns = [
        /unlimited\s+[\w\/&+]+(?:\s*[,\/]\s*[\w\/&+]+)*/gi,
        /mod\s+menu/gi, /god\s+mode/gi, /all\s+unlocked/gi,
        /max\s+level/gi, /free\s+purchase/gi, /anti[-\s]ban/gi,
        /vip\s+unlocked/gi, /premium\s+unlocked/gi, /infinite\s+\w+/gi,
        /aimbot/gi, /teleport/gi, /joystick/gi, /one[-\s]hit\s+kill/gi,
        /damage\s+multiplier/gi, /speed\s+hack/gi, /menu\s+mod/gi,
    ];
    const found = new Set();
    for (const p of patterns) {
        (moduleName.match(p) || []).forEach(m => found.add(m.toLowerCase().trim()));
    }
    return [...found];
}

function buildSeoTags(moduleName, existingTags) {
    const coreName = moduleName
        .replace(/\s*[\(\[].*/g, '')
        .replace(/\s*[-–—]\s*(mod|hack|cheat|unlimited)[\s\S]*/i, '')
        .trim().toLowerCase();

    const features = extractModFeatures(moduleName);
    const existing = (existingTags || '').split(',').map(t => t.trim()).filter(Boolean);
    const seen     = new Set(existing.map(t => t.toLowerCase()));
    const final    = [...existing];

    function add(tag) {
        const low = tag.toLowerCase().trim();
        if (!low || low.length > 80 || seen.has(low)) return;
        seen.add(low); final.push(tag.trim());
    }

    add(coreName);
    add(`${coreName} mod`);
    add(`${coreName} mod apk`);
    for (const f of features) add(f);
    add('mod apk'); add('mobile game mod'); add('android mod');

    return final.slice(0, 12).join(', ');
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║   ModVault — SEO Visual Asset & Tags Updater         ║');
    console.log('║   Strategy: loadCells → batchUpdate (1 API call)     ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');

    // 1. Connect
    const creds = loadCredentials();
    console.log('🔌 Connecting to Google Sheets…');
    const doc = new GoogleSpreadsheet(SPREADSHEET_ID);
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();

    const sheet = doc.sheetsByIndex[0];
    const rowCount = sheet.rowCount;
    const colCount = sheet.columnCount;
    console.log(`📊 Sheet: "${sheet.title}" — ${rowCount} rows × ${colCount} cols\n`);

    // 2. Load ALL cells in one request
    //    (1 read API call, no quota issues for reads)
    console.log('📦 Loading all cells (one read request)…');
    await sheet.loadCells(`A1:${colIndexToLetter(colCount)}${rowCount}`);
    console.log('   ✓ All cells loaded\n');

    // 3. Find column indices from header row (row 0)
    let nameCol = -1, imgCol = -1, tagsCol = -1;
    for (let c = 0; c < colCount; c++) {
        const header = (sheet.getCell(0, c).value || '').toString().toUpperCase().trim();
        if (header.includes('MODULE') || header.includes('NAME'))  nameCol  = c;
        if (header.includes('VISUAL') || header.includes('ASSET') || header.includes('IMAGE')) imgCol = c;
        if (header.includes('TAG')   || header.includes('CATEG'))  tagsCol  = c;
    }

    if (nameCol === -1 || imgCol === -1) {
        console.error('❌ Could not locate required columns in header row!');
        // Print header for debugging
        const headers = [];
        for (let c = 0; c < colCount; c++) headers.push(sheet.getCell(0, c).value);
        console.error('   Headers found:', headers.join(' | '));
        process.exit(1);
    }

    console.log('📋 Column mapping:');
    console.log(`   Module Name  → col ${nameCol} (${colIndexToLetter(nameCol + 1)})`);
    console.log(`   Visual Asset → col ${imgCol}  (${colIndexToLetter(imgCol + 1)})`);
    console.log(`   Tags         → col ${tagsCol === -1 ? 'N/A' : tagsCol + ' (' + colIndexToLetter(tagsCol + 1) + ')'}\n`);

    // 4. Iterate rows, update cell values IN MEMORY (no API calls yet)
    let updated = 0, skipped = 0;

    for (let r = 1; r < rowCount; r++) {  // r=0 is the header
        const nameCell = sheet.getCell(r, nameCol);
        const moduleName = (nameCell.value || '').toString().trim();

        // Skip blank rows or header-like rows
        if (!moduleName || /^module\s*name$/i.test(moduleName)) {
            skipped++;
            continue;
        }

        const imgCell  = sheet.getCell(r, imgCol);
        const currentImg = (imgCell.value || '').toString().trim();

        // Skip rows already using the correct modvault.games URL
        if (MODVAULT_PATTERN.test(currentImg)) {
            skipped++;
            continue;
        }

        // Generate values
        const slug   = toSlug(moduleName);
        const newImg = `${BASE_IMG_URL}${slug}.jpg`;

        // Update Visual Asset cell in memory
        imgCell.value = newImg;

        // Update Tags cell in memory (if column exists)
        if (tagsCol !== -1) {
            const tagsCell    = sheet.getCell(r, tagsCol);
            const existingTag = (tagsCell.value || '').toString().trim();
            tagsCell.value    = buildSeoTags(moduleName, existingTag);
        }

        updated++;

        if (updated % 500 === 0) {
            console.log(`   ↳ Prepared ${updated} rows…`);
        }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Cells to update : ${updated} rows × ${tagsCol !== -1 ? 2 : 1} cols = ${updated * (tagsCol !== -1 ? 2 : 1)} cells`);
    console.log(`   Already correct : ${skipped}`);

    if (updated === 0) {
        console.log('\n🎉 All rows already have modvault.games URLs! Nothing to save.');
        return;
    }

    // 5. Save ALL changes in ONE batchUpdate API call
    console.log('\n💾 Sending ONE batchUpdate to Google Sheets (all cells at once)…');
    await sheet.saveUpdatedCells();
    console.log('   ✓ Done!\n');

    console.log('╔══════════════════════════════════════════════════════╗');
    console.log(`║  ✅ SUCCESS — ${String(updated).padEnd(6)} rows updated in Google Sheets  ║`);
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('\n📌 Next: run  node generate-games-json.js  to sync games.json\n');
}

/** Convert 0-based column index to A1 column letter (0→A, 25→Z, 26→AA…) */
function colIndexToLetter(n) {
    let result = '';
    while (n > 0) {
        n--;
        result = String.fromCharCode(65 + (n % 26)) + result;
        n = Math.floor(n / 26);
    }
    return result || 'A';
}

main().catch(err => {
    console.error('\n❌ Fatal error:', err.message || err);
    if (err.stack) console.error(err.stack);
    process.exit(1);
});
