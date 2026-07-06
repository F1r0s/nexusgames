const fs = require('fs');
const path = require('path');

const filesToUpdate = ['index.html', 'best-games.html'];
const rootDir = path.join(__dirname, '..');

const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

const now = new Date();
const currentMonth = months[now.getMonth()];
const currentYear = now.getFullYear();

// Because the current month is July, and the files might say "June", wait, no. 
// The files currently say "July 2026", and it's July right now. 
// For testing locally today, the current month is July 2026. 
// But the automation runs on the 1st of the month, meaning it will run on Aug 1st.
// So on Aug 1st, it needs to look for "July" and replace with "August".
// Therefore, the script should look for the previous month and replace it with the current month.

let previousMonthIndex = now.getMonth() - 1;
let previousYear = currentYear;
if (previousMonthIndex < 0) {
    previousMonthIndex = 11;
    previousYear--;
}
const previousMonth = months[previousMonthIndex];

console.log(`Updating from ${previousMonth} ${previousYear} to ${currentMonth} ${currentYear}...`);

filesToUpdate.forEach(filename => {
    const filePath = path.join(rootDir, filename);
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        return;
    }
    
    let content = fs.readFileSync(filePath, 'utf-8');
    
    // Replace "Month Year" (e.g. "July 2026") ignoring case
    const regexFull = new RegExp(`${previousMonth}\\s+${previousYear}`, 'gi');
    content = content.replace(regexFull, match => {
        if (match === match.toUpperCase()) return `${currentMonth.toUpperCase()} ${currentYear}`;
        if (match === match.toLowerCase()) return `${currentMonth.toLowerCase()} ${currentYear}`;
        return `${currentMonth} ${currentYear}`;
    });

    // Also replace standalone previous month word if it's acting as a keyword
    if (filename === 'best-games.html') {
        const regexMonthOnly = new RegExp(`\\b${previousMonth}\\b(?!(?:\\s+${previousYear}))`, 'gi');
        content = content.replace(regexMonthOnly, match => {
            if (match === match.toUpperCase()) return currentMonth.toUpperCase();
            if (match === match.toLowerCase()) return currentMonth.toLowerCase();
            return currentMonth;
        });
    }

    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Updated ${filename}`);
});

console.log("Monthly string update completed successfully.");
