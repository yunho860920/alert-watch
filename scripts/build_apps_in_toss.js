// 앱인토스 업로드용 정적 번들과 AIT 아카이브를 생성하는 빌드 스크립트
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { randomUUID } = require('crypto');

const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const distDir = path.join(rootDir, 'dist');
const outputDir = path.join(distDir, 'apps-in-toss');
const tempZipPath = path.join(distDir, 'alert-watch-apps-in-toss.zip');
const aitPath = path.join(distDir, 'alert-watch-apps-in-toss.ait');
const rootAppJsonPath = path.join(rootDir, 'app.json');
const packageJson = require(path.join(rootDir, 'package.json'));

const rawServerUrl =
  process.env.APPS_IN_TOSS_SERVER_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  'http://localhost:3000';
const serverUrl = rawServerUrl.replace(/\/+$/, '');
const isLocalServer = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(serverUrl);
const prepareOnly = process.argv.includes('--prepare-only');
const tossNotificationTemplateCode =
  process.env.APPS_IN_TOSS_NOTIFICATION_TEMPLATE_CODE ||
  process.env.TOSS_NOTIFICATION_TEMPLATE_CODE ||
  process.env.TOSS_TEMPLATE_CODE ||
  process.env.TOSS_TEMPLATE_SET_CODE ||
  'ALERT_WATCH_CANCELLATION';

function readRootAppJson() {
  if (!fs.existsSync(rootAppJsonPath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(rootAppJsonPath, 'utf8'));
}

function ensureCleanDir(dir) {
  const resolvedDir = path.resolve(dir);
  if (!resolvedDir.startsWith(rootDir)) {
    throw new Error(`Refusing to remove a path outside the project: ${resolvedDir}`);
  }
  fs.rmSync(resolvedDir, { recursive: true, force: true });
  fs.mkdirSync(resolvedDir, { recursive: true });
}

function copySelectedPublicFiles() {
  const files = [
    'index.html',
    'index.css',
    'app.js',
    'sw.js',
    'logo.png',
    'thumbnail.png',
    'happy_detective_shiba_2d.png',
    'sleeping_detective_shiba_2d.png'
  ];

  for (const file of files) {
    fs.copyFileSync(path.join(publicDir, file), path.join(outputDir, file));
  }
}

function transformAppScript() {
  const appPath = path.join(outputDir, 'app.js');
  let source = fs.readFileSync(appPath, 'utf8');
  const marker = "document.addEventListener('DOMContentLoaded', async () => {\n";
  const injection = `document.addEventListener('DOMContentLoaded', async () => {\n  window.ALERT_WATCH_APPS_IN_TOSS_MODE = true;\n  window.ALERT_WATCH_TOSS_NOTIFICATION_TEMPLATE_CODE = ${JSON.stringify(tossNotificationTemplateCode)};\n  const APPS_IN_TOSS_API_BASE_URL = ${JSON.stringify(serverUrl)};\n  const originalFetch = window.fetch.bind(window);\n  window.fetch = (resource, options) => {\n    if (typeof resource === 'string' && resource.startsWith('/api/')) {\n      return originalFetch(APPS_IN_TOSS_API_BASE_URL + resource, options);\n    }\n    return originalFetch(resource, options);\n  };\n`;

  if (!source.includes(marker)) {
    throw new Error('Could not find the app bootstrap marker in public/app.js.');
  }

  source = source.replace(marker, injection);
  fs.writeFileSync(appPath, source, 'utf8');
}

function transformHtml() {
  const htmlPath = path.join(outputDir, 'index.html');
  let source = fs.readFileSync(htmlPath, 'utf8');
  source = source.replace(
    '</head>',
    `  <meta name="apps-in-toss-api-base-url" content="${serverUrl}">\n</head>`
  );
  fs.writeFileSync(htmlPath, source, 'utf8');
}

function writeManifest() {
  const rootAppJson = readRootAppJson();
  const appJson = {
    schemaVersion: rootAppJson.schemaVersion || '1',
    appId: process.env.APPS_IN_TOSS_APP_ID || rootAppJson.appId || randomUUID(),
    version: packageJson.version,
    sdk: rootAppJson.sdk || {
      minRequiredVersion: '2.0.0'
    },
    permissions: rootAppJson.permissions || [],
    entry: 'index.html',
    deploymentId:
      process.env.APPS_IN_TOSS_DEPLOYMENT_ID ||
      process.env.DEPLOYMENT_ID ||
      rootAppJson.deploymentId ||
      randomUUID()
  };

  const buildManifest = {
    name: 'Alert Watch',
    packageName: packageJson.name,
    appId: appJson.appId,
    deploymentId: appJson.deploymentId,
    version: packageJson.version,
    entry: 'index.html',
    apiBaseUrl: serverUrl,
    notificationTemplateCode: tossNotificationTemplateCode,
    generatedAt: new Date().toISOString(),
    target: 'apps-in-toss',
    files: [
      'app.json',
      'index.html',
      'index.css',
      'app.js',
      'sw.js',
      'logo.png',
      'thumbnail.png',
      'happy_detective_shiba_2d.png',
      'sleeping_detective_shiba_2d.png'
    ],
    note: 'This archive is generated from public/ for the Apps in Toss upload track. Backend APIs are expected to run at apiBaseUrl.'
  };

  fs.writeFileSync(
    rootAppJsonPath,
    `${JSON.stringify(appJson, null, 2)}\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(outputDir, 'ait-manifest.json'),
    `${JSON.stringify(buildManifest, null, 2)}\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(outputDir, 'app.json'),
    `${JSON.stringify(appJson, null, 2)}\n`,
    'utf8'
  );
}

function createAitArchive() {
  fs.rmSync(tempZipPath, { force: true });
  fs.rmSync(aitPath, { force: true });

  const archiveSource = path.join(outputDir, '*');
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      'Compress-Archive',
      '-Path',
      archiveSource,
      '-DestinationPath',
      tempZipPath,
      '-Force'
    ],
    { stdio: 'pipe' }
  );

  fs.copyFileSync(tempZipPath, aitPath);
  fs.rmSync(tempZipPath, { force: true });
}

ensureCleanDir(outputDir);
copySelectedPublicFiles();
transformAppScript();
transformHtml();
writeManifest();
if (!prepareOnly) {
  createAitArchive();
}

console.log(`Apps in Toss bundle: ${outputDir}`);
if (!prepareOnly) {
  console.log(`AIT archive: ${aitPath}`);
}
console.log(`API base URL: ${serverUrl}`);
if (isLocalServer) {
  console.warn('WARNING: APPS_IN_TOSS_SERVER_URL is not set. The AIT file points to localhost and is for local inspection only.');
}
