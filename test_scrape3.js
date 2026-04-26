const axios = require('axios');
const cheerio = require('cheerio');

axios.get('https://an1.com/7474-zombie-fire-3d-mod.html')
    .then(res => {
        const $ = cheerio.load(res.data);
        console.log("Breadcrumb:", $('ul[itemscope="itemscope"]').text().trim().replace(/\s+/g, ' '));
        console.log("Categories:", $('span[itemprop="name"]').map((i, el) => $(el).text()).get().join(', '));
    })
    .catch(console.error);
