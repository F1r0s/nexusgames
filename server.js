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
    try {
        // 1. Get parameters from the frontend request
        const { user_agent, ip, max } = req.query;

        // OGAds requires a valid IP. 
        // 1. Try frontend provided IP.
        // 2. Try x-forwarded-for (if behind proxy).
        // 3. Try connection remote address.
        // 4. Fallback to a generic valid IP (e.g., Google Public DNS IP) to prevent API crash.
        let clientIp = ip;
        if (!clientIp || clientIp === 'unknown') {
            clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        }
        // Normalize IP (remove ::ffff: prefix if present)
        if (clientIp && clientIp.includes('::ffff:')) {
            clientIp = clientIp.replace('::ffff:', '');
        }
        // Final Fallback if still invalid (Localhost often returns ::1)
        if (!clientIp || clientIp === '::1' || clientIp === '127.0.0.1') {
             console.warn("Using fallback IP for Localhost/Unknown client.");
             clientIp = '64.233.160.0'; // Default to a US IP to ensure offers load
        }

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

        console.log(`Fetching offers for IP: ${params.ip} (Requested Max: ${max || 5})...`);

        // 3. Make the request
        const response = await axios.get(apiUrl, {
            params: params,
            headers: {
                'Authorization': `Bearer ${process.env.LOCKER_API_KEY}`
            }
        });

        if (!response.data || !response.data.offers) {
            return res.json(response.data);
        }

        let rawOffers = response.data.offers;

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

        // --- LOGIC: SORTING (CPI > CPA, then Payout Desc) ---
        const cpiOffers = [];
        const cpaOffers = [];

        dedupedOffers.forEach(offer => {
            // Check bitwise flag: 1 = CPI, 2 = CPA
            if (offer.ctype & 1) {
                cpiOffers.push(offer);
            } else if (offer.ctype & 2) { // Strict check for CPA
                cpaOffers.push(offer);
            }
            // Offers that are neither (e.g. PIN/VID only) are filtered out based on requirements
        });

        // Sort by Payout Descending
        cpiOffers.sort((a, b) => b.payout - a.payout);
        cpaOffers.sort((a, b) => b.payout - a.payout);

        // Merge: CPI First, then CPA
        let finalOffers = [...cpiOffers, ...cpaOffers];

        // 4. Apply the User's Requested Limit (Default to 5)
        const userLimit = parseInt(max) || 5;
        finalOffers = finalOffers.slice(0, userLimit);

        // 5. Send the processed data back
        const result = { ...response.data, offers: finalOffers };
        res.json(result);

    } catch (error) {
        console.error("Proxy Error:", error.message);
        if (error.response) {
             console.error("Data:", error.response.data);
             res.status(error.response.status).json(error.response.data);
        } else {
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
