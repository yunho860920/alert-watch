const fs = require('fs');
const path = require('path');

const srcLogo = "C:\\Users\\GN\\.gemini\\antigravity-ide\\brain\\bf9abc1d-a22b-49c1-b798-33fad237eb1e\\media__1781590021959.jpg";
const srcThumbnail = "C:\\Users\\GN\\.gemini\\antigravity-ide\\brain\\bf9abc1d-a22b-49c1-b798-33fad237eb1e\\media__1781590026464.jpg";

const destLogo = path.join(__dirname, 'public', 'logo.png');
const destThumbnail = path.join(__dirname, 'public', 'thumbnail.png');

try {
  // Ensure public directory exists
  if (!fs.existsSync(path.join(__dirname, 'public'))) {
    fs.mkdirSync(path.join(__dirname, 'public'));
  }

  // Copy logo
  if (fs.existsSync(srcLogo)) {
    fs.copyFileSync(srcLogo, destLogo);
    console.log('Successfully copied logo.png to public/');
  } else {
    console.error('Source logo file not found:', srcLogo);
  }

  // Copy thumbnail
  if (fs.existsSync(srcThumbnail)) {
    fs.copyFileSync(srcThumbnail, destThumbnail);
    console.log('Successfully copied thumbnail.png to public/');
  } else {
    console.error('Source thumbnail file not found:', srcThumbnail);
  }

} catch (err) {
  console.error('Error copying files:', err);
}
