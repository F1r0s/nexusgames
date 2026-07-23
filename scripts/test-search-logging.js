require('dotenv').config();
const axios = require('axios');

async function testSearchLogging() {
    const webAppUrl = process.env.SEARCH_LOG_WEBAPP_URL || process.env.SEARCH_TRACKING_WEBAPP_URL;
    const query = 'Test Search ' + new Date().toLocaleTimeString();
    const country = 'US';

    console.log('🔍 Testing Search Logging...');

    if (webAppUrl) {
        console.log(`🌐 Found Apps Script Web App URL: ${webAppUrl}`);
        try {
            console.log('Sending POST request...');
            const res = await axios.post(webAppUrl, JSON.stringify({ query, country }), {
                headers: { 'Content-Type': 'text/plain' },
                timeout: 10000,
                maxRedirects: 5
            });
            console.log('✅ POST Response status:', res.status, res.data);
        } catch (err) {
            console.warn('⚠️ POST failed, trying GET fallback...', err.message);
            try {
                const getUrl = `${webAppUrl}${webAppUrl.includes('?') ? '&' : '?'}query=${encodeURIComponent(query)}&country=${encodeURIComponent(country)}`;
                const res = await axios.get(getUrl, { timeout: 10000, maxRedirects: 5 });
                console.log('✅ GET Response status:', res.status, res.data);
            } catch (getErr) {
                console.error('❌ GET fallback also failed:', getErr.message);
            }
        }
    } else {
        console.log('⚠️ No SEARCH_LOG_WEBAPP_URL found in .env.');
        console.log('Testing local backend endpoint http://localhost:3000/api/log-search ...');
        try {
            const res = await axios.post('http://localhost:3000/api/log-search', { query }, { timeout: 5000 });
            console.log('✅ Server response:', res.data);
        } catch (err) {
            console.error('❌ Local server test failed:', err.response ? err.response.data : err.message);
        }
    }
}

testSearchLogging();
