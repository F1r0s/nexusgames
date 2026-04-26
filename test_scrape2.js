const axios = require('axios');
const cheerio = require('cheerio');

axios.get('https://an1.com/7474-zombie-fire-3d-mod.html')
    .then(res => {
        const $ = cheerio.load(res.data);
        console.log("Version:", $('span[itemprop="softwareVersion"]').text().trim());
        console.log("Size:", $('span.size').text().trim() || $('ul.spec li:contains("Size") span').text().trim()); // need to verify selector
        console.log("Tags/Category:", $('span[itemprop="applicationCategory"]').text().trim());
        console.log("HTML Dump of Specs:", $('ul.spec').html() || $('.spec').html() || 
            $('ul.app_spec, .box_app_info, .box_app_info ul').html());
    })
    .catch(console.error);
