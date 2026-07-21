/**
 * scripts/fetch-playstore-screenshots.js
 * Scrapes real gameplay screenshots from Google Play Store for games in games.json.
 * Usage: node scripts/fetch-playstore-screenshots.js
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const GAMES_FILE = path.join(__dirname, '..', 'games.json');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const http = axios.create({
    timeout: 12000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
    }
});

function cleanGameTitle(title) {
    if (!title || typeof title !== 'string') return '';
    let name = title
        .replace(/\s*[\(\[][\s\S]*/g, '')
        .replace(/\s*[-–—]\s*(mod|hack|cheat|unlimited|free|premium|unlocked)[\s\S]*/i, '')
        .trim();
    return name || title;
}

async function scrapePlayStoreScreenshots(title) {
    try {
        const cleanName = cleanGameTitle(title);
        const searchUrl = 'https://play.google.com/store/search?q=' + encodeURIComponent(cleanName) + '&c=apps';

        const res = await http.get(searchUrl);
        const $ = cheerio.load(res.data);

        const images = [];
        $('img').each((_, elem) => {
            const src = $(elem).attr('srcset') || $(elem).attr('src') || $(elem).attr('data-src');
            if (src && src.includes('googleusercontent.com')) {
                let cleanSrc = src.split(' ')[0].split('=')[0];
                if (cleanSrc.startsWith('//')) cleanSrc = 'https:' + cleanSrc;
                
                // Exclude tiny icons/avatars (s32, s48, s64, s128, etc.)
                if (!src.includes('=s32') && !src.includes('=s48') && !src.includes('=s64') && !src.includes('=s128')) {
                    const fullResUrl = cleanSrc + '=w720-h405';
                    if (!images.includes(fullResUrl)) {
                        images.push(fullResUrl);
                    }
                }
            }
        });

        // Skip the very first image if it's the app icon, return next 3-4 screenshots
        if (images.length >= 4) {
            return images.slice(1, 5); // Real screenshots
        } else if (images.length >= 2) {
            return images.slice(0, 3);
        }
        return images;
    } catch (e) {
        return [];
    }
}

async function run() {
    console.log('📖 Loading games.json...');
    if (!fs.existsSync(GAMES_FILE)) {
        console.error('❌ games.json not found!');
        return;
    }

    const games = JSON.parse(fs.readFileSync(GAMES_FILE, 'utf8'));
    console.log(`Found ${games.length} total games.`);

    let updatedCount = 0;
    // Process top games (or all games that need real screenshots)
    const targetGames = games.slice(0, 50);

    console.log(`🔍 Fetching real Play Store screenshots for top ${targetGames.length} games...`);

    for (let i = 0; i < targetGames.length; i++) {
        const game = targetGames[i];
        
        // Skip if game already has real googleusercontent screenshots
        if (game.screenshots && game.screenshots.length >= 3 && game.screenshots[0].includes('googleusercontent.com')) {
            continue;
        }

        console.log(`[${i + 1}/${targetGames.length}] Fetching Play Store screenshots for "${game.title}"...`);
        const realScreens = await scrapePlayStoreScreenshots(game.title);

        if (realScreens.length >= 2) {
            game.screenshots = realScreens;
            updatedCount++;
            console.log(`   ✅ Found ${realScreens.length} real screenshots!`);
        } else {
            console.log(`   ⚠️ No additional Play Store screenshots found, using fallbacks.`);
        }

        await sleep(1000);
    }

    fs.writeFileSync(GAMES_FILE, JSON.stringify(games, null, 2), 'utf8');
    console.log(`\n✅ Finished! Updated ${updatedCount} games with real Google Play Store screenshots.`);
}

run();
