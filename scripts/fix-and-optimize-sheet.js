/**
 * scripts/fix-and-optimize-sheet.js
 * ─────────────────────────────────
 * Fixes misaligned 10-column rows added by legacy auto-fetcher back into the
 * standard 8-column layout, cleans up tags, and clears extra columns (I & J).
 */

'use strict';

const { GoogleSpreadsheet } = require('google-spreadsheet');
const path = require('path');
const { execSync } = require('child_process');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1LSSG-LmD2QehsOB_t-I8eeUXNMTJ10neKu3X4MIX4XU';

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

const VALID_CATEGORIES = new Set([
    'action','adventure','rpg','role-playing','role playing','strategy','puzzle',
    'simulation','simulations','racing','sport','sports','horror','shooter','arcade','fighting',
    'casual','survival','mmorpg','moba','jrpg','gacha','creator','sandbox',
    'hack and slash','multiplayer','new','hot','legendary','match-3','platformer',
    'card','board','trivia','music','educational','stealth','open world',
    'battle royale','tower defense','idle','clicker','farming','cooking','dating sim',
    'vr','augmented reality','word','kids','football','basketball','soccer'
]);

function cleanTags(rawTags) {
    if (!rawTags) return 'General';
    const parts = rawTags.split(',').map(t => t.trim()).filter(Boolean);
    const valid = parts.filter(t => VALID_CATEGORIES.has(t.toLowerCase()));
    if (!valid.length) return 'General';
    return Array.from(new Set(valid)).join(', ');
}

async function main() {
    console.log('🔌 Connecting to Google Sheets…');
    const creds = loadCredentials();
    const doc = new GoogleSpreadsheet(SPREADSHEET_ID);
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();

    const sheet = doc.sheetsByIndex[0];
    const rowCount = sheet.rowCount;
    const colCount = Math.max(sheet.columnCount, 10);
    console.log(`📊 Sheet "${sheet.title}": ${rowCount} rows × ${colCount} columns.`);

    console.log('📦 Loading cells…');
    await sheet.loadCells(`A1:J${rowCount}`);

    let fixedCount = 0;

    for (let r = 1; r < rowCount; r++) {
        const colA = (sheet.getCell(r, 0).value || '').toString().trim();
        if (!colA || colA.toUpperCase() === 'MODULE NAME') continue;

        const colC = (sheet.getCell(r, 2).value || '').toString().trim(); // N/A or Size
        const colF = (sheet.getCell(r, 5).value || '').toString().trim(); // Architecture or Image URL
        const colI = (sheet.getCell(r, 8).value || '').toString().trim(); // Link or empty

        // Detect misaligned 10-column row (colC is 'N/A' and colF is architecture like arm64-v8a or colI is not empty)
        const isMisaligned = (colC.toUpperCase() === 'N/A' && /arm|x86/i.test(colF)) || colI.length > 0;

        if (isMisaligned) {
            const version  = sheet.getCell(r, 1).value || 'v1.0';
            const size     = sheet.getCell(r, 3).value || 'N/A'; // Size was at col 3 (D)
            let os         = sheet.getCell(r, 4).value || 'Android'; // OS was at col 4 (E)
            if (/android/i.test(String(os))) os = 'Android';
            const rawTags  = sheet.getCell(r, 6).value || 'General'; // Tags was at col 6 (G)
            const img      = sheet.getCell(r, 7).value || ''; // Image was at col 7 (H)
            const link     = sheet.getCell(r, 8).value || '#'; // Link was at col 8 (I)
            const desc     = sheet.getCell(r, 9).value || ''; // Desc was at col 9 (J)

            // Re-align into standard 8 columns:
            // Col 0: Module Name (A)
            // Col 1: Version (B)
            // Col 2: Size (C)
            // Col 3: OS (D)
            // Col 4: Tags (E)
            // Col 5: Visual Asset (F)
            // Col 6: Access Link (G)
            // Col 7: Data Log (H)
            sheet.getCell(r, 1).value = version;
            sheet.getCell(r, 2).value = size;
            sheet.getCell(r, 3).value = os;
            sheet.getCell(r, 4).value = cleanTags(String(rawTags));
            sheet.getCell(r, 5).value = img;
            sheet.getCell(r, 6).value = link;
            sheet.getCell(r, 7).value = desc;

            // Clear extra columns 8 (I) & 9 (J)
            sheet.getCell(r, 8).value = '';
            sheet.getCell(r, 9).value = '';

            fixedCount++;
        }
    }

    console.log(`🔧 Fixed and re-aligned ${fixedCount} misaligned rows.`);

    if (fixedCount > 0) {
        console.log('💾 Saving changes to Google Sheets…');
        await sheet.saveUpdatedCells();
        console.log('✅ Google Sheets updated successfully!');
    } else {
        console.log('✅ All rows are already correctly aligned!');
    }
}

main().catch(err => {
    console.error('❌ Error fixing sheet:', err);
    process.exit(1);
});
