require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

// --- GOOGLE SHEETS CONFIG ---
const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTmd9N77OuTj1k_QFR0hyiqVjxfZvfnYUPO55kUSFN8RyW7MoZNICzc8gGYZuG0uVL_ccPXnG96ltKT/pub?output=csv";
let gamesCache = {
    data: [],
    lastUpdated: 0,
    isFetching: false
};
const CACHE_DURATION = 15 * 60 * 1000; // 15 Minutes

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS so your frontend (index.html) can talk to this server
app.use(cors());

// Serve the frontend
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Endpoint to get games (Cached)
app.get('/api/games', async (req, res) => {
    const now = Date.now();
    
    // If cache is expired and we aren't already fetching, update it in background
    if ((now - gamesCache.lastUpdated > CACHE_DURATION) && !gamesCache.isFetching) {
        refreshGamesCache();
    }

    // If we have no data at all (first load), wait for the first fetch
    if (gamesCache.data.length === 0) {
        await refreshGamesCache();
    }

    res.json(gamesCache.data);
});

async function refreshGamesCache() {
    if (gamesCache.isFetching) return;
    gamesCache.isFetching = true;
    console.log("[CACHE] Fetching fresh data from Google Sheets...");

    try {
        const response = await axios.get(`${SHEET_URL}&t=${Date.now()}`);
        const csvText = response.data;
        const parsed = parseCSV(csvText);
        
        if (parsed && parsed.length > 0) {
            gamesCache.data = parsed;
            gamesCache.lastUpdated = Date.now();
            console.log(`[CACHE] Successfully cached ${parsed.length} games.`);
        }
    } catch (error) {
        console.error("[CACHE] Error fetching Google Sheets:", error.message);
    } finally {
        gamesCache.isFetching = false;
    }
}

// Helper: CSV Parser (Replicated from frontend logic for consistency)
function parseCSV(csvText) {
    const result = [];
    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < csvText.length; i++) {
        const char = csvText[i];
        const nextChar = csvText[i + 1];

        if (char === '"' && inQuotes && nextChar === '"') {
            currentField += '"';
            i++;
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            currentRow.push(currentField);
            currentField = '';
        } else if ((char === '\r' || char === '\n') && !inQuotes) {
            if (char === '\r' && nextChar === '\n') i++;
            currentRow.push(currentField);
            rows.push(currentRow);
            currentRow = [];
            currentField = '';
        } else {
            currentField += char;
        }
    }
    if (currentRow.length > 0 || currentField !== '') {
        currentRow.push(currentField);
        rows.push(currentRow);
    }

    let headerRowIndex = -1;
    let colMap = { name: -1, ver: -1, size: -1, os: -1, tags: -1, img: -1, link: -1, desc: -1 };

    for(let i=0; i<Math.min(rows.length, 10); i++) {
        const headers = rows[i].map(h => (h||"").trim().toUpperCase());
        const headerStr = headers.join('|');
        if(headerStr.includes("MODULE") || headerStr.includes("NAME") || headerStr.includes("VISUAL")) {
            headerRowIndex = i;
            headers.forEach((h, index) => {
                if(h.includes("MODULE") || h.includes("NAME")) colMap.name = index;
                else if(h.includes("VERSION") || h.includes("BUILD")) colMap.ver = index;
                else if(h.includes("SIZE")) colMap.size = index;
                else if(h.includes("OS") || h.includes("ARCH")) colMap.os = index;
                else if(h.includes("TAGS")) colMap.tags = index;
                else if(h.includes("VISUAL") || h.includes("ASSET") || h.includes("IMAGE")) colMap.img = index;
                else if(h.includes("ACCESS") || h.includes("LINK")) colMap.link = index;
                else if(h.includes("LOG") || h.includes("DESC")) colMap.desc = index;
            });
            break;
        }
    }

    if(headerRowIndex === -1) {
        colMap = { name: 0, ver: 1, size: 2, os: 3, tags: 4, img: 5, link: 6, desc: 7 };
        headerRowIndex = -1; 
    }

    for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const cleanValues = rows[i].map(val => (val||"").trim());
        const title = colMap.name > -1 ? (cleanValues[colMap.name] || "") : "";
        if (!title || title.toUpperCase() === "MODULE NAME" || title.toUpperCase() === "NAME" || title.startsWith("Ex: ")) { 
            continue; 
        }

        const img = (colMap.img > -1 && cleanValues[colMap.img]) ? cleanValues[colMap.img] : "https://placehold.co/400x300?text=No+Image";
        const rawOS = (colMap.os > -1 ? cleanValues[colMap.os] : "") || "android";
        const rawTags = (colMap.tags > -1 ? cleanValues[colMap.tags] : "") || "General";

        result.push({
            id: Date.now() + Math.random(),
            title: title,
            version: (colMap.ver > -1 ? cleanValues[colMap.ver] : "v1.0"),
            size: (colMap.size > -1 ? cleanValues[colMap.size] : "N/A"),
            os: rawOS.toLowerCase().split(',').map(s=>s.trim()),
            categories: rawTags.split(',').map(s=>s.trim()),
            img: img,
            link: (colMap.link > -1 ? cleanValues[colMap.link] : "#"),
            desc: (colMap.desc > -1 ? cleanValues[colMap.desc] : "No description.")
        });
    }
    return result;
}

// The Secure Endpoint
app.get('/api/offers', async (req, res) => {
    console.log("----------------------------------------------------------------");
    console.log("Incoming Request to /api/offers");
    console.log("Query Params:", req.query);
    console.log("Headers (User-Agent):", req.headers['user-agent']);

    try {
        // 1. Get parameters from the frontend request
        const { user_agent, ip, max } = req.query;

        // OGAds requires a valid IP. 
        // CRITICAL FIX: Vercel/Proxy IP Detection
        // 1. Get the 'x-forwarded-for' header (standard for proxies/Vercel)
        const forwarded = req.headers['x-forwarded-for'];
        let clientIp = null;

        if (forwarded) {
            // The header can contain multiple IPs "client, proxy1, proxy2". We want the FIRST one.
            clientIp = forwarded.split(',')[0].trim();
        }

        // 2. Fallback to frontend-provided IP (if trusted) or connection IP
        if (!clientIp) {
            clientIp = req.query.ip || req.connection.remoteAddress;
        }

        // Normalize IP (remove ::ffff: prefix if present)
        if (clientIp && clientIp.includes('::ffff:')) {
            clientIp = clientIp.replace('::ffff:', '');
        }
        
        // Final Fallback for Localhost Dev Only
        if (!clientIp || clientIp === '::1' || clientIp === '127.0.0.1') {
             console.warn("Using fallback IP for Localhost/Unknown client.");
             clientIp = '64.233.160.0'; // Default to a US IP
        }
        
        console.log(`[IP DEBUG] Header: ${forwarded} | Resolved: ${clientIp}`);

        // 2. Build the request to the external API
        const apiUrl = 'https://appverification.site/api/v2';
        
        // Fetch a larger pool (30) to allow effective De-duplication & Sorting
        // We will slice this down to the user's requested 'max' at the end.
        const params = {
            user_agent: user_agent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            ctype: 3, // CPI + CPA
            max: 30,  // Upstream limit
            ip: clientIp
        };

        console.log(`Fetching from OGAds API...`);

        // 3. Make the request
        const response = await axios.get(apiUrl, {
            params: params,
            headers: {
                'Authorization': `Bearer ${process.env.LOCKER_API_KEY}`
            }
        });

        console.log("OGAds Response Status:", response.status);

        if (!response.data || !response.data.offers) {
            console.warn("OGAds returned no offers or invalid structure:", response.data);
            return res.json(response.data);
        }

        let rawOffers = response.data.offers;
        console.log(`Received ${rawOffers.length} raw offers.`);

        // --- LOGIC: DEDUPLICATION & BOOSTED PRIORITY ---
        const uniqueMap = new Map();

        rawOffers.forEach(offer => {
            const id = offer.offerid;
            // If new, or if current is boosted and stored is not, save it.
            if (!uniqueMap.has(id)) {
                uniqueMap.set(id, offer);
            } else {
                const existing = uniqueMap.get(id);
                if (offer.boosted && !existing.boosted) {
                    uniqueMap.set(id, offer);
                }
            }
        });

        const dedupedOffers = Array.from(uniqueMap.values());
        console.log(`Offers after deduplication: ${dedupedOffers.length}`);

        // --- LOGIC: SORTING (VIP IDs -> 30s Instructions -> CPI Name -> Type -> Payout DESC -> EPC ASC) ---
        // 1. VIP IDs: 67939 (Underdog) & 70489 (WorldWinner)
        // 2. Instructions: "Download and install... run for 30 seconds" (Easiest conversions)
        // 3. Name: Contains "CPI" (Direct Installs)
        // 4. Type: CPI Offers (ctype & 1)
        // 5. Payout: Highest Descending.
        // 6. EPC: Lowest Ascending (Requested "easiest" net EPC).

        const VIP_IDS = [67939, 70489];

        dedupedOffers.sort((a, b) => {
            const getRank = (o) => {
                const name = (o.name || "").toLowerCase();
                const adcopy = (o.adcopy || "").toLowerCase();

                // Rank 0: VIP IDs (Highest Priority)
                if (VIP_IDS.includes(parseInt(o.offerid))) return 0;

                // Rank 1: Specific "Easy" Instructions
                if (adcopy.includes("download and install") && adcopy.includes("30 seconds")) return 1;

                // Rank 2: "CPI" in Name
                if (name.includes("cpi")) return 2;

                // Rank 3: CPI Type (ctype bitmask)
                if (o.ctype & 1) return 3;
                
                // Rank 4: Others
                return 4;
            };

            const rankA = getRank(a);
            const rankB = getRank(b);

            if (rankA !== rankB) return rankA - rankB;

            // Secondary: Payout DESC
            const payoutA = parseFloat(a.payout || 0);
            const payoutB = parseFloat(b.payout || 0);
            if (payoutA !== payoutB) return payoutB - payoutA;

            // Tertiary: EPC ASC (Lowest first as requested)
            const epcA = parseFloat(a.epc || 0);
            const epcB = parseFloat(b.epc || 0);
            return epcA - epcB;
        });

        // 4. Apply the User's Requested Limit (Default to 5)
        const userLimit = parseInt(max) || 5;
        let finalOffers = dedupedOffers.slice(0, userLimit);

        console.log(`Sending ${finalOffers.length} final offers to client.`);

        // 5. Send the processed data back
        const result = { ...response.data, offers: finalOffers };
        res.json(result);

    } catch (error) {
        console.error("!!! PROXY ERROR !!!");
        console.error("Message:", error.message);
        if (error.response) {
             console.error("Upstream Data:", error.response.data);
             console.error("Upstream Status:", error.response.status);
             res.status(error.response.status).json(error.response.data);
        } else {
             console.error("Stack:", error.stack);
             res.status(500).json({ success: false, error: "Internal Server Error" });
        }
    }
});

// Export the app for Vercel (Serverless)
module.exports = app;

// Only start the server if running locally (not imported)
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n>>> Secure Server is running at http://localhost:${PORT}`);
        console.log(`>>> Your API Key is hidden safely in the .env file.\n`);
    });
}
