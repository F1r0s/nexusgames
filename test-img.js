const cheerio = require('cheerio');

async function testFullScraper() {
    const res = await fetch('https://mobilegamer.biz/', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' }
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    const articles = [];
    const seenUrls = new Set();

    $('h2, h3').each((i, el) => {
        if (articles.length >= 24) return false;

        const a = $(el).find('a').first();
        const href = a.attr('href');
        const title = $(el).text().trim();

        if (!title || title.length < 15 || !href || !href.startsWith('https://mobilegamer.biz/')) return;
        if (href.includes('/category/') || href.includes('/author/') || href.includes('/privacy') || href.includes('xsolla')) return;

        if (seenUrls.has(href)) return;

        // Find parent container ONLY up 2-3 levels to stay within the article card
        const parent = $(el).parent();
        const grandparent = parent.parent();
        const container = parent.find('img').length ? parent : (grandparent.find('img').length ? grandparent : $(el).closest('article, .post, div'));

        let img = '';
        container.find('img').each((_, imgNode) => {
            if (img) return;
            let candidate = $(imgNode).attr('src') || $(imgNode).attr('data-src') || $(imgNode).attr('data-lazy-src') || '';
            const srcset = $(imgNode).attr('srcset') || $(imgNode).attr('data-srcset');
            if (srcset) {
                const parts = srcset.split(',');
                const highestRes = parts[parts.length - 1].trim().split(' ')[0];
                if (highestRes && highestRes.startsWith('http')) {
                    candidate = highestRes;
                }
            }

            if (candidate && candidate.startsWith('http') && 
                !candidate.includes('logo') && 
                !candidate.includes('google_preferred') && 
                !candidate.includes('Xsolla') && 
                !candidate.includes('banner') && 
                !candidate.includes('avatar') && 
                !candidate.includes('936x180') && 
                !candidate.includes('300x250')) {
                img = candidate;
            }
        });

        if (!img) {
            const slug = title.toLowerCase().replace(/[^a-z0-9]/g, '');
            img = `https://picsum.photos/seed/${slug}/600/380`;
        }

        seenUrls.add(href);

        let excerpt = container.find('p').first().text().trim();
        if (!excerpt || excerpt.length < 20) {
            excerpt = `${title} — Latest mobile gaming news, patch updates, and industry insights on Mod Vault.`;
        }
        if (excerpt.length > 170) {
            excerpt = excerpt.substring(0, 170).trim() + '…';
        }

        const dateStr = container.find('time').text().trim() ||
                        new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        const category = container.find('.cat-links, .category').text().trim() || 'Mobile News';

        articles.push({
            title,
            link: href,
            img,
            date: dateStr,
            category,
            excerpt
        });
    });

    console.log(`✅ Scraped ${articles.length} articles with EXACT MATCHED images!`);
    articles.slice(0, 8).forEach((a, idx) => {
        console.log(`\n[${idx+1}] Title: ${a.title}`);
        console.log(`     Link:  ${a.link}`);
        console.log(`     Img:   ${a.img}`);
    });
}

testFullScraper();
