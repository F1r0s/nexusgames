/**
 * scripts/generate-sitemap.js
 * Automatically generates sitemap.xml with main pages and all game URLs.
 * Usage: node scripts/generate-sitemap.js
 */
const fs = require('fs');
const path = require('path');

const GAMES_FILE   = path.join(__dirname, '..', 'games.json');
const SITEMAP_FILE = path.join(__dirname, '..', 'sitemap.xml');
const DOMAIN       = 'https://www.modvault.games';

function generateSitemap() {
    console.log('Generating sitemap.xml...');

    let games = [];
    if (fs.existsSync(GAMES_FILE)) {
        try {
            games = JSON.parse(fs.readFileSync(GAMES_FILE, 'utf8'));
        } catch (e) {
            console.error('Error reading games.json for sitemap:', e.message);
        }
    }

    const today = new Date().toISOString().split('T')[0];

    const staticPages = [
        { url: '/', priority: '1.0', changefreq: 'daily' },
        { url: '/best-games.html', priority: '0.9', changefreq: 'daily' },
        { url: '/game-mode-guide.html', priority: '0.8', changefreq: 'weekly' },
        { url: '/support.html', priority: '0.7', changefreq: 'monthly' },
        { url: '/privacy.html', priority: '0.5', changefreq: 'yearly' },
    ];

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    // Add static pages
    for (const page of staticPages) {
        xml += `  <url>\n`;
        xml += `    <loc>${DOMAIN}${page.url}</loc>\n`;
        xml += `    <lastmod>${today}</lastmod>\n`;
        xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
        xml += `    <priority>${page.priority}</priority>\n`;
        xml += `  </url>\n`;
    }

    // Add game pages (up to 50,000 URLs max for standard sitemap)
    let addedCount = 0;
    for (const game of games) {
        const slug = game.slug || (game.id ? game.id : null);
        if (!slug) continue;

        xml += `  <url>\n`;
        xml += `    <loc>${DOMAIN}/game/${slug}</loc>\n`;
        xml += `    <lastmod>${today}</lastmod>\n`;
        xml += `    <changefreq>weekly</changefreq>\n`;
        xml += `    <priority>0.8</priority>\n`;
        xml += `  </url>\n`;
        addedCount++;
    }

    xml += `</urlset>\n`;

    fs.writeFileSync(SITEMAP_FILE, xml, 'utf8');
    console.log(`✅ sitemap.xml successfully generated with ${staticPages.length + addedCount} URLs (${addedCount} game pages).`);
}

generateSitemap();
