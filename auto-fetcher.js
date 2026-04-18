const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleSpreadsheet } = require('google-spreadsheet');

let creds;
try {
    creds = require('./google-credentials.json');
} catch (e) {
    console.log("No local credentials file found. Relying on environment variables (GitHub Actions).");
}

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1vTmd9N77OuTj1k_QFR0hyiqVjxfZvfnYUPO55kUSFN8RyW7MoZNICzc8gGYZuG0uVL_ccPXnG96ltKT';

// Max new (non-duplicate) games to add per run
const MAX_GAMES_PER_RUN = 5;

// Shuffle an array in place (Fisher-Yates)
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

async function fetchGameDetails(gameUrl) {
    try {
        const res = await axios.get(gameUrl, { timeout: 10000 });
        const $ = cheerio.load(res.data);

        // Title: prefer h1, fall back to og:title, then derive from URL
        let title = $('h1[itemprop="name"]').first().text().trim()
            || $('h1').first().text().trim()
            || $('meta[property="og:title"]').attr('content')
            || '';

        // Strip trailing " MOD APK..." noise from title
        title = title.replace(/\s+MOD\s+APK.*/i, '').trim();

        let version = $('span[itemprop="softwareVersion"]').text().trim() || 'v1.0';
        if (!version.startsWith('v')) version = 'v' + version;

        const size = $('span[itemprop="fileSize"]').text().trim() || '150 MB';

        // Breadcrumb: [0]=AN1.com [1]=Games [2]=Genre
        const cats = $('span[itemprop="name"]').map((i, el) => $(el).text().trim()).get();
        const genre = cats[2] || 'Action';
        const tags = `${genre}, New`;

        // Image: prefer og:image, fall back to itemprop image
        const img = $('meta[property="og:image"]').attr('content')
            || $('img[itemprop="image"]').attr('src')
            || '';

        let desc = $('div[itemprop="description"]').text().trim()
            || $('meta[name="description"]').attr('content')
            || 'Experience an immersive mobile gaming experience.';
        if (desc.length > 250) {
            desc = desc.substring(0, 250).replace(/\n/g, ' ') + '...';
        }

        return { title, version, size, tags, img, desc };
    } catch (e) {
        return null;
    }
}

// Fallback: scrape latest games from AN1.com listing pages (used when no queue sheet exists)
async function scrapeFromAN1(existingTitles) {
    console.log("No Game Queue sheet found. Falling back to AN1.com latest listings...");
    const urls = [];

    // Collect up to 3 pages worth of game links so we have variety
    for (let page = 1; page <= 3; page++) {
        try {
            const pageUrl = page === 1 ? 'https://an1.com/games/' : `https://an1.com/games/page/${page}/`;
            const res = await axios.get(pageUrl, { timeout: 10000 });
            const $ = cheerio.load(res.data);
            $('.item_app').each((i, el) => {
                const link = $(el).find('.name a').attr('href');
                if (link) urls.push(link);
            });
        } catch (e) {
            // If a page fails, just stop collecting more pages
            break;
        }
    }

    shuffle(urls);
    return urls;
}

async function run() {
    if (!SPREADSHEET_ID) {
        console.error("❌ ERROR: SPREADSHEET_ID is not set. Set the environment variable or add your sheet ID to auto-fetcher.js.");
        return;
    }

    console.log("Connecting to Google Sheets...");
    const doc = new GoogleSpreadsheet(SPREADSHEET_ID);

    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
        await doc.useServiceAccountAuth({
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
        });
    } else {
        await doc.useServiceAccountAuth(creds);
    }

    await doc.loadInfo();

    const mainSheet = doc.sheetsByIndex[0];

    // --- Step 1: Read existing titles to build duplicate-check set ---
    await mainSheet.loadHeaderRow();
    const existingRows = await mainSheet.getRows();
    const existingTitles = new Set(
        existingRows.map(row => (row['Module Name'] || '').trim().toLowerCase()).filter(Boolean)
    );
    console.log(`Found ${existingTitles.size} existing games in the sheet.`);

    // --- Step 2: Get the list of URLs to process ---
    let queueUrls = [];
    const queueSheet = doc.sheetsByIndex[1];

    if (queueSheet) {
        // Sheet 2 exists — read user-supplied URLs from the "URL" column
        await queueSheet.loadHeaderRow();
        const queueRows = await queueSheet.getRows();
        queueUrls = queueRows
            .map(row => (row['URL'] || '').trim())
            .filter(url => url.startsWith('http'));
        console.log(`Found ${queueUrls.length} game URLs in the Game Queue (Sheet 2).`);

        if (queueUrls.length === 0) {
            console.log("Game Queue is empty. Add AN1.com game URLs to Sheet 2 (column: URL) to get started.");
            return;
        }

        // Shuffle for random selection each run
        shuffle(queueUrls);
    } else {
        // No queue sheet — fall back to AN1.com scraping with deduplication
        queueUrls = await scrapeFromAN1(existingTitles);
        if (queueUrls.length === 0) {
            console.log("Could not retrieve any game URLs. Exiting.");
            return;
        }
    }

    // --- Step 3: Fetch details and collect non-duplicate games ---
    const newGames = [];

    for (const url of queueUrls) {
        if (newGames.length >= MAX_GAMES_PER_RUN) break;

        console.log(`-> Fetching details for: ${url}`);
        const details = await fetchGameDetails(url);

        if (!details || !details.title) {
            console.log(`   ⚠️  Skipped (could not fetch title from page)`);
            continue;
        }

        const titleKey = details.title.toLowerCase();
        if (existingTitles.has(titleKey)) {
            console.log(`   ⏩  Duplicate, skipping: ${details.title}`);
            continue;
        }

        newGames.push({
            'Module Name': details.title,
            'Version Build': details.version,
            'Data Size': details.size,
            'OS Architecture': 'Android, iOS',
            'Tags': details.tags,
            'Visual Asset': details.img,
            'Access Link': url,
            'Data Log': details.desc
        });

        // Track within this run to avoid adding the same game twice
        existingTitles.add(titleKey);
        console.log(`   ✅ Queued: ${details.title}`);
    }

    // --- Step 4: Write new games to the sheet ---
    if (newGames.length === 0) {
        console.log("\nNo new games to add. All queue items are already in the sheet.");
        return;
    }

    console.log(`\nWriting ${newGames.length} new game(s) to the sheet...`);
    await mainSheet.addRows(newGames);
    console.log(`🎉 SUCCESS! Added ${newGames.length} new game(s) to Google Sheets!`);
}

run().catch(err => {
    console.error("An error occurred during the automation:", err.message || err);
    process.exit(1);
});
