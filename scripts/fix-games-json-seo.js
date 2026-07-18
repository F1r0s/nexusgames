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
function extractModFeatures(title) {
    const patterns = [
        /unlimited\s+[\w\/&+]+(?:\s*[,\/]\s*[\w\/&+]+)*/gi,
        /mod\s+menu/gi, /god\s+mode/gi, /all\s+unlocked/gi,
        /max\s+level/gi, /free\s+purchase/gi, /anti[-\s]ban/gi,
        /vip\s+unlocked/gi, /premium\s+unlocked/gi, /infinite\s+\w+/gi,
        /aimbot/gi, /teleport/gi, /one[-\s]hit\s+kill/gi,
    ];
    const found = new Set();
    for (const p of patterns) {
        (title.match(p) || []).forEach(m => found.add(m.toLowerCase().trim()));
    }
    return [...found];
}

function buildSeoTags(title, existingCategories) {
    const coreName   = title.replace(/\s*[\(\[].*/g, '').replace(/\s*[-\u2013\u2014]\s*(mod|hack|cheat|unlimited)[\s\S]*/i,'').trim().toLowerCase();
    const features   = extractModFeatures(title);
    const existing   = (existingCategories || []).map(c => c.trim()).filter(Boolean);
    const seen       = new Set(existing.map(t => t.toLowerCase()));
    const final      = [...existing];

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

    return final.slice(0, 12);
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

        // Enrich categories/tags with SEO keywords
        game.categories = buildSeoTags(title, game.categories || []);
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
