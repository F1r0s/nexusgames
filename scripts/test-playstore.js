const axios = require('axios');
const cheerio = require('cheerio');

async function getPlayStoreScreenshots(gameTitle) {
    try {
        // Clean game title to get core search name e.g. "One State RP Mod" -> "One State RP"
        let cleanName = gameTitle
            .replace(/\s*[\(\[][\s\S]*/g, '')
            .replace(/\s*[-–—]\s*(mod|hack|cheat|unlimited|free|premium|unlocked)[\s\S]*/i, '')
            .trim();
        if (!cleanName) cleanName = gameTitle;

        const searchUrl = 'https://play.google.com/store/search?q=' + encodeURIComponent(cleanName) + '&c=apps';
        console.log('Searching Play Store for:', cleanName, '->', searchUrl);

        const res = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            timeout: 15000
        });

        const $ = cheerio.load(res.data);
        const images = [];

        // Play store screenshot images are stored in googleusercontent URLs
        // Pattern: https://play-lh.googleusercontent.com/...
        $('img').each((i, elem) => {
            const src = $(elem).attr('srcset') || $(elem).attr('src') || $(elem).attr('data-src');
            if (src && src.includes('googleusercontent.com')) {
                // Get clean image URL base
                let cleanSrc = src.split(' ')[0].split('=')[0];
                if (cleanSrc.startsWith('//')) cleanSrc = 'https:' + cleanSrc;
                if (!images.includes(cleanSrc)) {
                    images.push(cleanSrc);
                }
            }
        });

        console.log(`Found ${images.length} total images for "${cleanName}":`);
        images.slice(0, 15).forEach((url, i) => console.log(`  [${i + 1}] ${url}=w720-h405`));
        return images;
    } catch (err) {
        console.error('Error fetching Play Store screenshots:', err.message);
        return [];
    }
}

getPlayStoreScreenshots('One State RP');
