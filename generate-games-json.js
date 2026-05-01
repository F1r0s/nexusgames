/**
 * generate-games-json.js
 * Reads fallback_games.csv and generates games.json (static database).
 * Run: node generate-games-json.js
 */
const fs = require('fs');
const path = require('path');

const FALLBACK_FILE = path.join(__dirname, 'fallback_games.csv');
const OUTPUT_FILE   = path.join(__dirname, 'games.json');

function parseCSV(csvText) {
    if (!csvText) return [];
    const result = [], rows = [];
    let currentRow = [], currentField = '', inQuotes = false;
    csvText = csvText.trim();

    for (let i = 0; i < csvText.length; i++) {
        const char = csvText[i], nextChar = csvText[i + 1];
        if (char === '"') {
            if (inQuotes && nextChar === '"') { currentField += '"'; i++; }
            else { inQuotes = !inQuotes; }
        } else if (char === ',' && !inQuotes) {
            currentRow.push(currentField); currentField = '';
        } else if ((char === '\r' || char === '\n') && !inQuotes) {
            if (char === '\r' && nextChar === '\n') i++;
            if (currentRow.length > 0 || currentField !== '') {
                currentRow.push(currentField); rows.push(currentRow);
            }
            currentRow = []; currentField = '';
        } else {
            currentField += char;
        }
    }
    if (currentRow.length > 0 || currentField !== '') {
        currentRow.push(currentField); rows.push(currentRow);
    }
    if (rows.length === 0) return [];

    let headerRowIndex = -1;
    let colMap = { name: -1, ver: -1, size: -1, os: -1, tags: -1, img: -1, link: -1, desc: -1 };

    for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const row = rows[i].map(h => (h || '').trim().toUpperCase());
        const rowStr = row.join('|');
        if (rowStr.includes('NAME') || rowStr.includes('MODULE') || rowStr.includes('VISUAL')) {
            headerRowIndex = i;
            row.forEach((h, index) => {
                if (h.includes('NAME') || h.includes('MODULE')) colMap.name = index;
                else if (h.includes('VER') || h.includes('BUILD')) colMap.ver = index;
                else if (h.includes('SIZE') || h.includes('MB') || h.includes('GB')) colMap.size = index;
                else if (h.includes('OS') || h.includes('ARCH') || h.includes('SYSTEM')) colMap.os = index;
                else if (h.includes('TAG') || h.includes('CAT')) colMap.tags = index;
                else if (h.includes('VISUAL') || h.includes('IMAGE') || h.includes('ASSET')) colMap.img = index;
                else if (h.includes('LINK') || h.includes('ACCESS') || h.includes('DOWNLOAD')) colMap.link = index;
                else if (h.includes('LOG') || h.includes('DESC') || h.includes('INFO')) colMap.desc = index;
            });
            break;
        }
    }

    if (headerRowIndex === -1) {
        colMap = { name: 0, ver: 1, size: 2, os: 3, tags: 4, img: 5, link: 6, desc: 7 };
    }

    for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const cells = rows[i].map(val => (val || '').trim());
        const title = colMap.name > -1 ? cells[colMap.name] : '';
        if (!title || title.toUpperCase() === 'MODULE NAME' || title.toUpperCase() === 'NAME') continue;

        result.push({
            id: 'g' + i + '_' + Date.now().toString(36),
            title: title,
            version: colMap.ver > -1 ? (cells[colMap.ver] || 'v1.0') : 'v1.0',
            size: colMap.size > -1 ? (cells[colMap.size] || 'N/A') : 'N/A',
            os: (colMap.os > -1 ? (cells[colMap.os] || 'android') : 'android').toLowerCase().split(',').map(s => s.trim()),
            categories: (colMap.tags > -1 ? (cells[colMap.tags] || 'General') : 'General').split(',').map(s => s.trim()),
            img: (colMap.img > -1 && cells[colMap.img]) ? cells[colMap.img] : 'https://placehold.co/400x300?text=No+Image',
            link: colMap.link > -1 ? (cells[colMap.link] || '#') : '#',
            desc: colMap.desc > -1 ? (cells[colMap.desc] || 'No description provided.') : 'No description provided.'
        });
    }
    return result;
}

// Generate
const csvText = fs.readFileSync(FALLBACK_FILE, 'utf8');
const games = parseCSV(csvText);
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(games, null, 2), 'utf8');
console.log(`✅ Generated games.json with ${games.length} games (${(fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1)} KB)`);
