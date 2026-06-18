const fs = require('fs');
const path = require('path');

const localOriginalLogo = path.join(__dirname, 'public', 'Originals', 'logo.png');
const localOriginalThumbnail = path.join(__dirname, 'public', 'Originals', 'Gemini_Generated_Image_phpovpphpovpphpo.png');

const srcLogo = fs.existsSync(localOriginalLogo) 
  ? localOriginalLogo 
  : "C:\\Users\\GN\\.gemini\\antigravity-ide\\brain\\bf9abc1d-a22b-49c1-b798-33fad237eb1e\\media__1781590021959.jpg";

const srcThumbnail = fs.existsSync(localOriginalThumbnail)
  ? localOriginalThumbnail
  : "C:\\Users\\GN\\.gemini\\antigravity-ide\\brain\\bf9abc1d-a22b-49c1-b798-33fad237eb1e\\media__1781590026464.jpg";

const srcSleeping = "C:\\Users\\GN\\.gemini\\antigravity-ide\\brain\\6e7e13dd-8dd0-4fc3-9005-80bb3d3c8fbf\\sleeping_detective_shiba_2d_1781627118802.png";
const srcHappy = "C:\\Users\\GN\\.gemini\\antigravity-ide\\brain\\6e7e13dd-8dd0-4fc3-9005-80bb3d3c8fbf\\happy_detective_shiba_2d_1781627135838.png";

const destLogo = path.join(__dirname, 'public', 'logo.png');
const destThumbnail = path.join(__dirname, 'public', 'thumbnail.png');
const destSleeping = path.join(__dirname, 'public', 'sleeping_detective_shiba_2d.png');
const destHappy = path.join(__dirname, 'public', 'happy_detective_shiba_2d.png');

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

  // Copy sleeping shiba
  if (fs.existsSync(srcSleeping)) {
    fs.copyFileSync(srcSleeping, destSleeping);
    console.log('Successfully copied sleeping_detective_shiba.png to public/');
  } else {
    console.error('Source sleeping shiba file not found:', srcSleeping);
  }

  // Copy happy shiba
  if (fs.existsSync(srcHappy)) {
    fs.copyFileSync(srcHappy, destHappy);
    console.log('Successfully copied happy_detective_shiba.png to public/');
  } else {
    console.error('Source happy shiba file not found:', srcHappy);
  }

} catch (err) {
  console.error('Error copying files:', err);
}
