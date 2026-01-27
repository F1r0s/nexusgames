require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS so your frontend (index.html) can talk to this server
app.use(cors());

// The Secure Endpoint
app.get('/api/offers', async (req, res) => {
    try {
        // 1. Get parameters from the frontend request
        const { user_agent, ip, ctype, max } = req.query;

        // 2. Build the request to the external API
        // We inject the API KEY here, on the server side.
        const apiUrl = 'https://appverification.site/api/v2';
        
        const params = {
            user_agent: user_agent,
            ctype: ctype || 1,
            max: max || 6
        };

        // Only add IP if it was provided
        if (ip && ip !== 'unknown') {
            params.ip = ip;
        }

        console.log(`Fetching offers (Type: ${params.ctype})...`);

        // 3. Make the request with the SECRET key
        const response = await axios.get(apiUrl, {
            params: params,
            headers: {
                'Authorization': `Bearer ${process.env.LOCKER_API_KEY}`
            }
        });

        // 4. Send the clean data back to the frontend
        res.json(response.data);

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

app.listen(PORT, () => {
    console.log(`\n>>> Secure Server is running at http://localhost:${PORT}`);
    console.log(`>>> Your API Key is hidden safely in the .env file.\n`);
});
