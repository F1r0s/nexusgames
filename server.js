require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS so your frontend (index.html) can talk to this server
app.use(cors());

// Serve the frontend
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

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

        // --- LOGIC: SORTING (CPI/CPA First, then Payout Desc) ---
        // Refactored to match requested logic:
        // 1. Primary: Prioritize offers where type is 'CPI' or 'CPA'.
        // 2. Secondary: Sort by 'payout' descending.

        dedupedOffers.sort((a, b) => {
            // Determine priority based on ctype (1=CPI, 2=CPA)
            const isPriorityA = (a.ctype & 1) || (a.ctype & 2);
            const isPriorityB = (b.ctype & 1) || (b.ctype & 2);

            if (isPriorityA && !isPriorityB) return -1;
            if (!isPriorityA && isPriorityB) return 1;

            // Secondary: Payout DESC
            const payoutA = parseFloat(a.payout || 0);
            const payoutB = parseFloat(b.payout || 0);
            return payoutB - payoutA;
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
