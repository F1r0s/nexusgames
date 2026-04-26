const axios = require('axios');
const cheerio = require('cheerio');

axios.get('https://an1.com/games/')
    .then(res => {
        const $ = cheerio.load(res.data);
        console.log("Items count:", $('.item').length);
        console.log($('.item').first().html());
    })
    .catch(console.error);
