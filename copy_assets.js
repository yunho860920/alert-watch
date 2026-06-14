const fs = require('fs');
const path = require('path');

const srcLogo = "C:\\Users\\GN\\.gemini\\antigravity-ide\\brain\\5b3dd4d2-84d5-4f7f-bb55-c7a431c67f97\\detective_shiba_icon_left_side_glass_1781235751376.png";
const srcThumbnail = "C:\\Users\\GN\\.gemini\\antigravity-ide\\brain\\5b3dd4d2-84d5-4f7f-bb55-c7a431c67f97\\detective_shiba_thumbnail_1781235648917.png";

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
