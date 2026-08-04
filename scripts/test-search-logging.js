require('dotenv').config();
const { GoogleSpreadsheet } = require('google-spreadsheet');
const creds = require('../google-credentials.json');

async function testSearchLogging() {
    const spreadsheetId = process.env.SEARCH_TRACKING_SPREADSHEET_ID || '1Yqyi32SFUBUhT1xGJMseAv8q5ygtqhpREA7yz6ktlb8';
    const query = 'FC 24 Mobile ' + new Date().toLocaleTimeString();
    const countryCode = 'FR';
    const countryName = 'France';

    console.log('🔍 Testing Direct Google Sheets Logging with Country & Abbreviation...');
    try {
        const doc = new GoogleSpreadsheet(spreadsheetId);
        await doc.useServiceAccountAuth(creds);
        await doc.loadInfo();

        const sheet = doc.sheetsByTitle['Searches'] || doc.sheetsByIndex[0];
        const timestamp = new Date().toLocaleString('en-US', { timeZone: 'UTC' }) + ' UTC';

        await sheet.addRow({
            'Timestamp': timestamp,
            'Search Query': query,
            'Country': countryCode,
            'Country Name': countryName
        });
        console.log(`✅ Successfully added row: "${query}" | Country: ${countryCode} | Name: ${countryName}`);
    } catch (err) {
        console.error('❌ Direct sheet logging failed:', err.message);
    }
}

testSearchLogging();
