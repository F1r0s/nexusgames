const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleSpreadsheet } = require('google-spreadsheet');

let creds;
try {
    creds = require('./google-credentials.json');
} catch (e) {
    console.log("No local credentials file found. Relying on environment variables (GitHub Actions).");
}

// ============================================
// 👇 Replace this with your actual Google Sheet ID for Local Testing 👇
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1vTmd9N77OuTj1k_QFR0hyiqVjxfZvfnYUPO55kUSFN8RyW7MoZNICzc8gGYZuG0uVL_ccPXnG96ltKT'; // Fallback to provided SPREADSHEET_ID if found, else placeholder
// ============================================

async function fetchGameDetails(gameUrl) {
    try {
        const res = await axios.get(gameUrl);
        const $ = cheerio.load(res.data);
        
        let version = $('span[itemprop="softwareVersion"]').text().trim() || 'v1.0';
        if (!version.startsWith('v')) version = 'v' + version;
        
        const size = $('span[itemprop="fileSize"]').text().trim() || '150 MB';
        
        const cats = $('span[itemprop="name"]').map((i, el) => $(el).text()).get();
        // cats[0] = "AN1.com", cats[1] = "Games", cats[2] = genre (e.g. "Action"), cats[3] = developer
        // We only want the genre (index 2)
        const genre = cats[2] || 'Action';
        
        // Always add "New" so the green badge shows on the website
        const tags = `${genre}, New`;
        
        let desc = $('div[itemprop="description"]').text().trim() || $('meta[name="description"]').attr('content') || 'Experience an immersive mobile gaming experience that pushes the boundaries of action and strategy. Access the ultimate version now!';
        if (desc.length > 250) {
            desc = desc.substring(0, 250).replace(/\n/g, ' ') + '...';
        }
        
        return { version, size, tags, desc };
    } catch (e) {
        return { version: 'v1.0', size: '150 MB', tags: 'Action, New', desc: 'Start playing this awesome game right now on your mobile device.' };
    }
}

async function scrapeGames() {
    console.log("Fetching latest games from AN1.com...");
    const res = await axios.get('https://an1.com/games/');
    const $ = cheerio.load(res.data);
    
    const games = [];
    const items = $('.item_app').slice(0, 5); // Grab top 5 most recent
    
    for (let i = 0; i < items.length; i++) {
        const el = items[i];
        
        let title = $(el).find('.name a span').text().trim();
        const link = $(el).find('.name a').attr('href');
        const img = $(el).find('.img img').attr('src');
        
        // Remove " (MOD...)" from title to keep it clean (Optional)
        // if(title.includes(' (MOD')) title = title.split(' (MOD')[0];

        console.log(`-> Extracting specifics for: ${title}`);
        const details = await fetchGameDetails(link);
        
        games.push({
            'Module Name': title,
            'Version Build': details.version,
            'Data Size': details.size,
            'OS Architecture': 'Android, iOS', // Always compatible for proxy downloads
            'Tags': details.tags,
            'Visual Asset': img,
            'Access Link': link,
            'Data Log': details.desc
        });
    }
    
    return games;
}

async function pushToSheets(games) {
    if (SPREADSHEET_ID === 'YOUR_SHEET_ID_HERE') {
        console.error("\n❌ ERROR: Please replace 'YOUR_SHEET_ID_HERE' with your actual Google Sheet ID in auto-fetcher.js at line 9");
        return;
    }
    
    console.log("\nConnecting to Google Sheets using credentials...");
    const doc = new GoogleSpreadsheet(SPREADSHEET_ID);
    
    // In GitHub actions, we use environment variables
    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
        await doc.useServiceAccountAuth({
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
        });
    } else {
        // Local execution
        await doc.useServiceAccountAuth(creds);
    }
    
    await doc.loadInfo();
    
    const sheet = doc.sheetsByIndex[0];

    // Load existing rows to check for duplicates by Access Link
    await sheet.loadHeaderRow();
    const existingRows = await sheet.getRows();
    const existingLinks = new Set(existingRows.map(r => (r['Access Link'] || '').trim()));

    const newGames = games.filter(game => {
        const link = (game['Access Link'] || '').trim();
        if (existingLinks.has(link)) {
            console.log(`⏭️  Skipping duplicate: ${game['Module Name']}`);
            return false;
        }
        return true;
    });

    if (newGames.length === 0) {
        console.log("✅ No new games to add — all scraped games already exist in the sheet.");
        return;
    }

    console.log(`Writing ${newGames.length} new game(s) to the sheet (skipped ${games.length - newGames.length} duplicate(s))...`);
    await sheet.addRows(newGames);
    console.log("🎉 SUCCESS! New games added to Google Sheets automatically!");
}

async function run() {
    try {
        const games = await scrapeGames();
        await pushToSheets(games);
    } catch (err) {
        console.error("An error occurred during the automation:", err.message || err);
    }
}

run();
