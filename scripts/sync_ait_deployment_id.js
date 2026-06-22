const fs = require('fs');
const path = require('path');
const { AppsInTossBundle } = require('@apps-in-toss/ait-format');

const rootDir = path.resolve(__dirname, '..');
const packageJson = require(path.join(rootDir, 'package.json'));
const aitPath = path.join(rootDir, `${packageJson.name}.ait`);
const distAitPath = path.join(rootDir, 'dist', `${packageJson.name}.ait`);
const appJsonPaths = [
  path.join(rootDir, 'app.json'),
  path.join(rootDir, 'dist', 'apps-in-toss', 'app.json')
];

if (!fs.existsSync(aitPath)) {
  throw new Error(`AIT artifact not found: ${aitPath}`);
}

const reader = AppsInTossBundle.reader(new Uint8Array(fs.readFileSync(aitPath)));
const deploymentId = reader.deploymentId;

if (!deploymentId) {
  throw new Error('Could not read deploymentId from the AIT artifact.');
}

for (const appJsonPath of appJsonPaths) {
  if (!fs.existsSync(appJsonPath)) {
    continue;
  }

  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  appJson.deploymentId = deploymentId;
  fs.writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`, 'utf8');
}

fs.mkdirSync(path.dirname(distAitPath), { recursive: true });
fs.copyFileSync(aitPath, distAitPath);

console.log(`Synced deploymentId: ${deploymentId}`);
console.log(`Official AIT artifact: ${aitPath}`);
console.log(`Copied AIT artifact: ${distAitPath}`);
