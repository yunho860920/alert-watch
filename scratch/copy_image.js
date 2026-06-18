const fs = require('fs');
const path = require('path');

const src = 'C:\\Users\\GN\\\\.gemini\\\\antigravity-ide\\\\brain\\\\6e7e13dd-8dd0-4fc3-9005-80bb3d3c8fbf\\\\sleeping_detective_shiba_1781623862884.png';
const dest = 'c:\\\\Users\\\\GN\\\\.alert\\\\public\\\\sleeping_detective_shiba.png';

try {
  fs.copyFileSync(src, dest);
  console.log('Successfully copied sleeping shiba image!');
} catch (err) {
  console.error('Error copying file:', err);
}
