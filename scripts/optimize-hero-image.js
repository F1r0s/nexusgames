const axios = require('axios');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const IMAGE_URL = 'https://i.postimg.cc/Znt8nSBW/Background-photo.png';
const OUT_DIR = __dirname;
const DESKTOP_OUT = path.join(OUT_DIR, '..', 'hero-bg.webp');
const MOBILE_OUT = path.join(OUT_DIR, '..', 'hero-bg-mobile.webp');

async function main() {
    try {
        console.log(`Downloading original hero image from ${IMAGE_URL}...`);
        const response = await axios({
            url: IMAGE_URL,
            method: 'GET',
            responseType: 'arraybuffer'
        });
        const buffer = Buffer.from(response.data);
        console.log(`Downloaded image. Size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

        // Create Desktop WebP (1920px width max)
        console.log('Optimizing desktop version...');
        await sharp(buffer)
            .resize({ width: 1920, withoutEnlargement: true })
            .webp({ quality: 80 })
            .toFile(DESKTOP_OUT);
        
        const desktopSize = fs.statSync(DESKTOP_OUT).size;
        console.log(`Desktop version saved: hero-bg.webp (${(desktopSize / 1024).toFixed(2)} KB)`);

        // Create Mobile WebP (800px width max)
        console.log('Optimizing mobile version...');
        await sharp(buffer)
            .resize({ width: 800, withoutEnlargement: true })
            .webp({ quality: 70 })
            .toFile(MOBILE_OUT);

        const mobileSize = fs.statSync(MOBILE_OUT).size;
        console.log(`Mobile version saved: hero-bg-mobile.webp (${(mobileSize / 1024).toFixed(2)} KB)`);

        console.log('Optimization complete!');
    } catch (err) {
        console.error('Error optimizing hero image:', err);
    }
}

main();
