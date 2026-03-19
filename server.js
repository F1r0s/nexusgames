require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS so your frontend (index.html) can talk to this server
app.use(cors());

// Serve the frontend
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Cache variables
let cachedResponse = null;
let isFetchingOffers = false;

// Dynamically discovered high-converting instructions
let dynamicHighConvertingPatterns = new Set();

// Hardcoded baseline patterns
const BASE_PATTERNS = [
    "download and install",
    "30 seconds",
    "play until level 5",
    "register an account"
];

// Function to fetch, discover patterns, deduplicate, and rank offers
const updateDailyCache = async () => {
    if (isFetchingOffers) return;
    isFetchingOffers = true;

    console.log("----------------------------------------------------------------");
    console.log("Running Daily Offer Fetch, Analysis, and Caching...");

    try {
        // Use a generic US IP purely for the background task to gather a broad pool of offers
        const analysisIp = '64.233.160.0';
        
        console.log(`[IP DEBUG] Scheduled Fetch using Resolved: ${analysisIp}`);

        // Build the request to the external API
        const apiUrl = 'https://appverification.site/api/v2';
        
        // Fetch a large pool to allow effective De-duplication, Pattern Discovery, & Sorting
        const params = {
            user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            ctype: 3, // CPI + CPA
            max: 100,  // Upstream limit for maximum discovery potential
            ip: analysisIp
        };

        console.log(`Fetching from OGAds API...`);

        // Make the request
        const response = await axios.get(apiUrl, {
            params: params,
            headers: {
                'Authorization': `Bearer ${process.env.LOCKER_API_KEY}`
            }
        });

        console.log("OGAds Response Status:", response.status);

        if (!response.data || !response.data.offers) {
            console.warn("OGAds returned no offers or invalid structure:", response.data);
            return;
        }

        let rawOffers = response.data.offers;
        console.log(`Received ${rawOffers.length} raw offers.`);

        // --- LOGIC: DYNAMIC PATTERN DISCOVERY ---
        let newPatternsAdded = 0;

        // We simulate "checking for new types of offer instructions" by assuming
        // high-payout or high-EPC offers might have converting instructions.
        rawOffers.forEach(offer => {
            const adcopy = (offer.adcopy || "").toLowerCase();
            const payout = parseFloat(offer.payout || 0);

            // If the offer is high value (e.g., > $1.00), its instruction might be a good pattern
            if (payout > 1.0 && adcopy.length > 5) {
                // To avoid caching random full paragraphs, we could use NLP.
                // For this simple implementation, we just cache the exact adcopy string
                // if it's concise, or attempt to extract the first sentence.
                const conciseInstruction = adcopy.split('.')[0].trim();

                if (conciseInstruction.length > 10 && conciseInstruction.length < 50) {
                    if (!dynamicHighConvertingPatterns.has(conciseInstruction) && !BASE_PATTERNS.includes(conciseInstruction)) {
                        dynamicHighConvertingPatterns.add(conciseInstruction);
                        newPatternsAdded++;
                    }
                }
            }
        });

        console.log(`Discovery complete. Added ${newPatternsAdded} new high-converting patterns.`);
        console.log("Current dynamic patterns:", Array.from(dynamicHighConvertingPatterns));

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

        // --- LOGIC: SORTING ---
        const VIP_IDS = [67939, 70489];

        dedupedOffers.sort((a, b) => {
            const getRank = (o) => {
                const name = (o.name || "").toLowerCase();
                const adcopy = (o.adcopy || "").toLowerCase();

                // Rank 0: VIP IDs (Highest Priority)
                if (VIP_IDS.includes(parseInt(o.offerid))) return 0;

                // Rank 1: Specific "Easy" Instructions or dynamically discovered patterns
                let isHighPriority = false;

                // Base hardcoded checks
                if ((adcopy.includes("download and install") && adcopy.includes("30 seconds")) ||
                    adcopy.includes("play until level 5") ||
                    adcopy.includes("register an account")) {
                    isHighPriority = true;
                }

                // Dynamic discovered checks
                if (!isHighPriority) {
                    for (const pattern of dynamicHighConvertingPatterns) {
                        if (adcopy.includes(pattern)) {
                            isHighPriority = true;
                            break;
                        }
                    }
                }

                if (isHighPriority) return 1;

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

        // Store the full formatted response into the cache to maintain metadata (success flags, etc)
        cachedResponse = { ...response.data, offers: dedupedOffers };
        console.log(`Successfully cached ${dedupedOffers.length} ranked offers.`);

    } catch (error) {
        console.error("!!! FETCH ERROR !!!");
        console.error("Message:", error.message);
        if (error.response) {
             console.error("Upstream Data:", error.response.data);
             console.error("Upstream Status:", error.response.status);
        } else {
             console.error("Stack:", error.stack);
        }
    } finally {
        isFetchingOffers = false;
    }
};

// Schedule the task to run every day at midnight (00:00)
cron.schedule('0 0 * * *', () => {
    updateDailyCache();
});

// The Secure Endpoint
app.get('/api/offers', async (req, res) => {
    console.log("----------------------------------------------------------------");
    console.log("Incoming Request to /api/offers");
    console.log("Query Params:", req.query);
    console.log("Headers (User-Agent):", req.headers['user-agent']);

    try {
        const { max } = req.query;

        // Ensure we have some cached data. If empty (e.g., right after startup), fetch them immediately
        if (!cachedResponse && !isFetchingOffers) {
            console.log("Cache is empty, fetching offers directly...");
            await updateDailyCache();
        }

        // If fetch failed or is still ongoing and cache is empty
        if (!cachedResponse) {
             console.log("Cache unavailable. Serving temporary failure response.");
             return res.status(503).json({ success: false, error: "Offers currently unavailable, initializing cache." });
        }

        // Apply the User's Requested Limit (Default to 5)
        const userLimit = parseInt(max) || 5;
        let finalOffers = cachedResponse.offers.slice(0, userLimit);

        console.log(`Sending ${finalOffers.length} final cached offers to client.`);

        // Send the processed data back EXACTLY as it was formatted originally
        const result = { ...cachedResponse, offers: finalOffers };
        res.json(result);

    } catch (error) {
        console.error("!!! ENDPOINT ERROR !!!");
        console.error("Message:", error.message);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// Export the app for Vercel (Serverless)
module.exports = app;

// Only start the server if running locally (not imported)
if (require.main === module) {
    app.listen(PORT, async () => {
        console.log(`\n>>> Secure Server is running at http://localhost:${PORT}`);
        console.log(`>>> Your API Key is hidden safely in the .env file.\n`);

        // Initialize cache on startup
        await updateDailyCache();
    });
}
