const fs = require('fs');
const path = require('path');

const src = 'C:\\Users\\GN\\.gemini\\antigravity-ide\\brain\\e4d8cf32-acc9-4f10-91f5-a9962b383182\\media__1781671847728.jpg';
const dest = path.join(__dirname, '..', 'public', 'shiba_detective.jpg');

try {
  fs.copyFileSync(src, dest);
  console.log('Successfully copied to:', dest);
} catch (e) {
  console.error('Copy failed:', e.message);
}
