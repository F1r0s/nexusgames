/**
 * scripts/fix-games-json-seo.js
 * ─────────────────────────────
 * Reads the existing games.json and updates every game's `img` field
 * to the SEO-friendly modvault.games/uploads/<slug>.jpg URL.
 * Existing modvault.games URLs are preserved as-is.
 * The `title` field is NEVER modified.
 *
 * Run: node scripts/fix-games-json-seo.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const GAMES_FILE    = path.join(__dirname, '..', 'games.json');
const MODVAULT_PAT  = /^https:\/\/modvault\.games\/uploads\//i;
const BASE_IMG_URL  = 'https://modvault.games/uploads/';

// ── Slug generator (same logic as seo-update-sheets.js) ───────────
function toSlug(moduleName) {
    if (!moduleName || typeof moduleName !== 'string') return 'game';
    let name = moduleName
        .replace(/\s*[\(\[][\s\S]*/g, '')
        .replace(/\s*[-\u2013\u2014]\s*(mod|hack|cheat|unlimited|free|premium|unlocked)[\s\S]*/i, '')
        .trim();
    if (!name) name = moduleName;
    return name
        .replace(/[\u00e0-\u00e5]/g,'a').replace(/[\u00e8-\u00eb]/g,'e').replace(/[\u00ec-\u00ef]/g,'i')
        .replace(/[\u00f2-\u00f6]/g,'o').replace(/[\u00f9-\u00fc]/g,'u').replace(/[\u2122\u00ae\u00a9]/g,'')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g,' ')
        .trim()
        .replace(/\s+/g,'-')
        .replace(/-+/g,'-')
        .replace(/^-+|-+$/g,'');
}

// ── SEO Tags builder ───────────────────────────────────────────────
// The ONLY 3 SEO keywords we append — nothing game-name specific
const MOD_KEYWORDS = ['mod apk', 'mod menu', 'hack'];

// Recognized game-type category words (case-insensitive match)
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
 * Keeps ONLY recognized game-type category tags.
 * Strips game names, mod keywords, and any injected SEO junk.
 * Appends exactly 3 mod keywords: mod apk, mod menu, hack.
 */
function buildSeoTags(existingCategories) {
    // Keep only tags that match known category words
    const original = (existingCategories || [])
        .map(t => (t || '').trim())
        .filter(t => t && VALID_CATEGORIES.has(t.toLowerCase()));

    // Append 3 mod keywords
    const seen  = new Set(original.map(t => t.toLowerCase()));
    const final = [...original];
    for (const kw of MOD_KEYWORDS) {
        if (!seen.has(kw)) { seen.add(kw); final.push(kw); }
    }
    return final;
}

// ── Main ───────────────────────────────────────────────────────────
function run() {
    console.log('📖 Reading games.json…');
    const raw   = fs.readFileSync(GAMES_FILE, 'utf8');
    const games = JSON.parse(raw);
    console.log(`   Found ${games.length} games\n`);

    let updated = 0, skipped = 0;

    for (const game of games) {
        const title = game.title || '';
        if (!title) { skipped++; continue; }

        // Update img if not already a modvault.games URL
        if (!MODVAULT_PAT.test(game.img || '')) {
            const slug   = toSlug(title);
            game.img     = `${BASE_IMG_URL}${slug}.jpg`;
            updated++;
        } else {
            skipped++;
        }

        // Enrich categories with SEO keywords (keep originals, add 3 mod words)
        game.categories = buildSeoTags(game.categories || []);
    }

    fs.writeFileSync(GAMES_FILE, JSON.stringify(games, null, 2), 'utf8');

    console.log(`✅ games.json updated:`);
    console.log(`   • ${updated} img fields updated to modvault.games/uploads/ URLs`);
    console.log(`   • ${skipped} already correct or empty`);
    console.log(`\n📄 Sample outputs:`);
    games.slice(0, 5).forEach(g => {
        console.log(`   "${g.title}"`);
        console.log(`     img: ${g.img}`);
        console.log(`     tags: ${g.categories.slice(0,4).join(', ')}\n`);
    });
}

run();
