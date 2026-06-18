// Express를 구동하고 API 요청 처리, 웹 푸시 VAPID 키 관리 및 설정 저장을 담당하는 서버 메인 모듈

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const cheerio = require('cheerio');
const webpush = require('web-push');
const scraper = require('./scraper');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 로컬 테스트용 가상 상품 상태 객체 (메모리 상태 관리)
let mockProductState = {
  status: 'SOLD_OUT', // 'SOLD_OUT' 또는 'AVAILABLE'
  options: [
    { text: '블랙 M', val: 'black_m', isAvailable: false },
    { text: '화이트 L', val: 'white_l', isAvailable: false }
  ]
};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function maskValue(val, visibleLength = 4) {
  if (!val) return '';
  const str = String(val).trim();
  if (str.length <= visibleLength) {
    return '*'.repeat(str.length);
  }
  return str.slice(0, visibleLength) + '*'.repeat(str.length - visibleLength);
}

function getUpdatedValue(newValue, oldValue) {
  const input = newValue ? String(newValue).trim() : '';
  if (!input || input.includes('***')) {
    return oldValue || '';
  }
  return input;
}

function isLikelyCssSelector(value) {
  const input = value ? value.trim() : '';
  if (!input) {
    return false;
  }

  // 1차적으로 CSS 셀렉터 구성 기호가 포함되어 있는지 검사
  const hasSelectorChar = 
    input.startsWith('#') ||
    input.startsWith('.') ||
    input.startsWith('[') ||
    input.includes('>') ||
    input.includes('+') ||
    input.includes('~') ||
    input.includes(':');

  if (!hasSelectorChar) {
    return false;
  }

  // 2차적으로 cheerio 파서를 이용해 유효한 문법인지 직접 검증
  try {
    const $ = cheerio.load('');
    $(input);
    return true;
  } catch (e) {
    // 셀렉터 구문 에러(Unmatched selector 등)가 발생하면 일반 텍스트 매칭으로 전환하도록 false 리턴
    return false;
  }
}

function parseDeviceInfo(userAgent = '') {
  const ua = String(userAgent || '');

  let browser = '브라우저';
  if (/Edg\//.test(ua)) {
    browser = 'Edge';
  } else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) {
    browser = 'Chrome';
  } else if (/Firefox\//.test(ua)) {
    browser = 'Firefox';
  } else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) {
    browser = 'Safari';
  }

  let platform = '알 수 없는 기기';
  if (/iPhone|iPad|iPod/.test(ua)) {
    platform = 'iOS';
  } else if (/Android/.test(ua)) {
    platform = 'Android';
  } else if (/Windows/.test(ua)) {
    platform = 'Windows PC';
  } else if (/Macintosh|Mac OS X/.test(ua)) {
    platform = 'Mac';
  } else if (/Linux/.test(ua)) {
    platform = 'Linux';
  }

  const deviceType = /Mobile|Android|iPhone|iPad|iPod/.test(ua) ? 'mobile' : 'desktop';

  return {
    browser,
    platform,
    deviceType,
    label: `${browser} · ${platform}`
  };
}

function createSubscriptionRecord(subscription, deviceInfo, userAgent) {
  const now = new Date().toISOString();
  return {
    ...subscription,
    deviceInfo: {
      ...parseDeviceInfo(userAgent),
      ...(deviceInfo || {})
    },
    createdAt: subscription.createdAt || now,
    lastSeenAt: now
  };
}

function getSubscriptionId(endpoint = '') {
  return crypto
    .createHash('sha256')
    .update(String(endpoint || ''))
    .digest('hex')
    .slice(0, 16);
}

function getRegisteredDevices(subscriptions = [], currentEndpoint = '') {
  return subscriptions.map((sub, index) => {
    const fallback = parseDeviceInfo('');
    const deviceInfo = {
      ...fallback,
      ...(sub.deviceInfo || {})
    };
    const hasStoredDeviceInfo = Boolean(sub.deviceInfo);

    return {
      id: getSubscriptionId(sub.endpoint),
      order: index + 1,
      label: hasStoredDeviceInfo ? (deviceInfo.label || `${deviceInfo.browser} · ${deviceInfo.platform}`) : `등록된 브라우저 ${index + 1}`,
      browser: deviceInfo.browser,
      platform: deviceInfo.platform,
      deviceType: deviceInfo.deviceType,
      createdAt: sub.createdAt || null,
      lastSeenAt: sub.lastSeenAt || null,
      isCurrent: Boolean(currentEndpoint && sub.endpoint === currentEndpoint)
    };
  });
}

// 0. 레거시 config 및 history 마이그레이션 로직
const configPath = path.join(__dirname, 'config.json');
if (fs.existsSync(configPath)) {
  try {
    const rawData = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(rawData);
    if (parsed && parsed.targetUrl) {
      console.log('[설정 마이그레이션] 레거시 config.json 포맷을 다중 사용자 포맷으로 변환합니다.');
      const newConfigs = {
        "legacy_default_user": {
          ...parsed,
          isMonitoring: true
        }
      };
      fs.writeFileSync(configPath, JSON.stringify(newConfigs, null, 2), 'utf8');
    }
  } catch (e) {
    console.error('[설정 마이그레이션 실패]', e.message);
  }
}

const historyPath = path.join(__dirname, 'history.json');
if (fs.existsSync(historyPath)) {
  try {
    const rawData = fs.readFileSync(historyPath, 'utf8');
    const parsed = JSON.parse(rawData);
    if (Array.isArray(parsed)) {
      console.log('[이력 마이그레이션] 레거시 history.json 포맷을 다중 사용자 포맷으로 변환합니다.');
      const newHistories = {
        "legacy_default_user": parsed
      };
      fs.writeFileSync(historyPath, JSON.stringify(newHistories, null, 2), 'utf8');
    }
  } catch (e) {
    console.error('[이력 마이그레이션 실패]', e.message);
  }
}

// 1. VAPID 암호화 키 생성 및 세팅 자동화 로직
const envPath = path.join(__dirname, '.env');

let vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
let vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

if (!vapidPublicKey || !vapidPrivateKey) {
  console.log('[보안 설정] 웹 푸시용 VAPID 암호 키 쌍이 식별되지 않아 신규 생성합니다.');
  const keys = webpush.generateVAPIDKeys();
  vapidPublicKey = keys.publicKey;
  vapidPrivateKey = keys.privateKey;

  const envContent = `\n# 웹 푸시 보안 키\nVAPID_PUBLIC_KEY=${vapidPublicKey}\nVAPID_PRIVATE_KEY=${vapidPrivateKey}\n`;
  fs.appendFileSync(envPath, envContent, 'utf8');
  console.log('[보안 설정] 새로운 VAPID 키 쌍이 .env 파일에 안전하게 저장되었습니다.');
}

webpush.setVapidDetails(
  'mailto:alert-admin@example.com',
  vapidPublicKey,
  vapidPrivateKey
);

// 2. VAPID 공개키 서빙 API
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: vapidPublicKey });
});

// 2.5. 외부 모니터링 서비스용 헬스체크 API (UptimeRobot 등)
app.get('/api/health', (req, res) => {
  res.status(200).send('OK');
});

// 3. 현재 상태 및 설정 통합 조회 API
app.get('/api/status', (req, res) => {
  const { clientId, currentEndpoint } = req.query;

  // 에셋 동적 동기화 우회 처리
  const srcSleeping = "C:\\Users\\GN\\.gemini\\antigravity-ide\\brain\\6e7e13dd-8dd0-4fc3-9005-80bb3d3c8fbf\\sleeping_detective_shiba_2d_1781627118802.png";
  const destSleeping = path.join(__dirname, 'public', 'sleeping_detective_shiba_2d.png');
  const srcHappy = "C:\\Users\\GN\\.gemini\\antigravity-ide\\brain\\6e7e13dd-8dd0-4fc3-9005-80bb3d3c8fbf\\happy_detective_shiba_2d_1781627135838.png";
  const destHappy = path.join(__dirname, 'public', 'happy_detective_shiba_2d.png');
  const srcThumbnail = "C:\\Users\\GN\\.gemini\\antigravity-ide\\brain\\e4d8cf32-acc9-4f10-91f5-a9962b383182\\thumbnail_1781675218084.png";
  const destThumbnail = path.join(__dirname, 'public', 'thumbnail.png');
  try {
    if (fs.existsSync(srcSleeping) && !fs.existsSync(destSleeping)) {
      fs.copyFileSync(srcSleeping, destSleeping);
      console.log('[에셋 동적 동기화] sleeping_detective_shiba_2d.png 복사 성공');
    }
    if (fs.existsSync(srcHappy) && !fs.existsSync(destHappy)) {
      fs.copyFileSync(srcHappy, destHappy);
      console.log('[에셋 동적 동기화] happy_detective_shiba_2d.png 복사 성공');
    }
    if (fs.existsSync(srcThumbnail)) {
      fs.copyFileSync(srcThumbnail, destThumbnail);
      console.log('[에셋 동적 동기화] thumbnail.png 복사 성공');
    }
  } catch (e) {
    console.error('[에셋 동적 동기화 실패] 에러:', e.message);
  }

  if (!clientId) {
    return res.status(400).json({ error: 'clientId가 누락되었습니다.' });
  }

  const configPath = path.join(__dirname, 'config.json');
  let configs = {};
  
  if (fs.existsSync(configPath)) {
    try {
      configs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.error('[설정 로딩 실패] config.json 파싱 에러.', e.message);
    }
  }

  const config = configs[clientId] || {};
  const subscriptions = config.subscriptions || [];
  const status = scraper.getStatusData(clientId);
  
  res.json({
    ...status,
    targetUrl: config.targetUrl || status.targetUrl,
    cssSelector: config.cssSelector || '',
    intervalSeconds: config.intervalSeconds || status.intervalSeconds,
    keyword: config.keyword || '품절',
    condition: config.condition || 'disappear',
    alertRepeatCount: config.alertRepeatCount || 1,
    alertRepeatIntervalSeconds: config.alertRepeatIntervalSeconds || 30,
    registeredDevicesCount: subscriptions.length,
    registeredDevices: getRegisteredDevices(subscriptions, currentEndpoint || ''),
    tossUserKeysCount: (config.tossUserKeys || []).length,
    tossUserKeys: config.tossUserKeys || [],
    telegramSetup: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    telegramBotToken: maskValue(process.env.TELEGRAM_BOT_TOKEN, 6),
    telegramChatId: maskValue(process.env.TELEGRAM_CHAT_ID, 4),
    emailSetup: Boolean(process.env.SMTP_HOST && process.env.RECEIVER_EMAIL && process.env.SMTP_USER && process.env.SMTP_PASS),
    smtpHost: process.env.SMTP_HOST || '',
    smtpPort: process.env.SMTP_PORT || '',
    smtpUser: process.env.SMTP_USER || '',
    smtpPass: maskValue(process.env.SMTP_PASS, 2),
    receiverEmail: process.env.RECEIVER_EMAIL || ''
  });
});

// 4. 감시 타겟 설정 변경 및 브라우저 구독 추가 API
app.post('/api/settings', (req, res) => {
  const { clientId, targetUrl, keyword, cssSelector, condition, intervalSeconds, subscription, deviceInfo, alertRepeatCount, alertRepeatIntervalSeconds } = req.body;
  if (!clientId) {
    return res.status(400).json({ error: 'clientId가 누락되었습니다.' });
  }

  const configPath = path.join(__dirname, 'config.json');
  let configs = {};

  if (fs.existsSync(configPath)) {
    try {
      configs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.error('[설정 덮어쓰기] 기존 config.json 로드 실패.', e.message);
    }
  }

  const existingConfig = configs[clientId] || {};
  let config = {
    targetUrl: targetUrl || '',
    keyword: keyword || '품절',
    cssSelector: cssSelector || '',
    condition: condition || 'disappear',
    intervalSeconds: parseInt(intervalSeconds, 10) || 30,
    alertRepeatCount: parseInt(alertRepeatCount, 10) || 1,
    alertRepeatIntervalSeconds: parseInt(alertRepeatIntervalSeconds, 10) || 30,
    subscriptions: existingConfig.subscriptions || [],
    tossUserKeys: existingConfig.tossUserKeys || [],
    isMonitoring: true
  };

  if (subscription && subscription.endpoint) {
    const existingIndex = config.subscriptions.findIndex(sub => sub.endpoint === subscription.endpoint);
    const subscriptionRecord = createSubscriptionRecord(subscription, deviceInfo, req.headers['user-agent']);

    if (existingIndex >= 0) {
      config.subscriptions[existingIndex] = {
        ...config.subscriptions[existingIndex],
        ...subscriptionRecord,
        createdAt: config.subscriptions[existingIndex].createdAt || subscriptionRecord.createdAt
      };
    } else {
      config.subscriptions.push(subscriptionRecord);
      console.log(`[구독 추가] [${clientId}] 새 기기 등록 완료. (총 기기: ${config.subscriptions.length}대)`);
    }
  }

  configs[clientId] = config;

  try {
    fs.writeFileSync(configPath, JSON.stringify(configs, null, 2), 'utf8');
  } catch (e) {
    return res.status(500).json({ error: '설정 저장 중 에러가 발생했습니다.' });
  }

  scraper.stopMonitoring(clientId);
  scraper.startMonitoring(clientId);

  res.json({ message: '모니터링 설정 및 기기 구독이 성공적으로 완료되었습니다.', status: scraper.getStatusData(clientId) });
});

// 4.1. 토스 사용자 알림 등록 API
app.post('/api/toss/register', (req, res) => {
  const { clientId, userKey } = req.body;
  if (!clientId || !userKey) {
    return res.status(400).json({ error: 'clientId와 userKey가 누락되었습니다.' });
  }

  const configPath = path.join(__dirname, 'config.json');
  let configs = {};

  if (fs.existsSync(configPath)) {
    try {
      configs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.error('[토스 등록] config.json 로딩 실패.', e.message);
    }
  }

  const config = configs[clientId] || {
    targetUrl: '',
    keyword: '품절',
    cssSelector: '',
    condition: 'disappear',
    intervalSeconds: 30,
    alertRepeatCount: 1,
    alertRepeatIntervalSeconds: 30,
    subscriptions: [],
    tossUserKeys: [],
    isMonitoring: false
  };

  if (!config.tossUserKeys) {
    config.tossUserKeys = [];
  }

  if (!config.tossUserKeys.includes(userKey)) {
    config.tossUserKeys.push(userKey);
    console.log(`[토스 등록 성공] [${clientId}] 새 토스 userKey가 연동되었습니다: ${userKey}`);
  }

  configs[clientId] = config;

  try {
    fs.writeFileSync(configPath, JSON.stringify(configs, null, 2), 'utf8');
    res.json({ message: '토스 알림 연동이 완료되었습니다.', tossUserKeysCount: config.tossUserKeys.length });
  } catch (e) {
    res.status(500).json({ error: '설정 저장 중 에러가 발생했습니다.' });
  }
});

// 4.2. 토스 사용자 알림 해제 API
app.post('/api/toss/unregister', (req, res) => {
  const { clientId, userKey } = req.body;
  if (!clientId || !userKey) {
    return res.status(400).json({ error: 'clientId와 userKey가 누락되었습니다.' });
  }

  const configPath = path.join(__dirname, 'config.json');
  let configs = {};

  if (fs.existsSync(configPath)) {
    try {
      configs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.error('[토스 해제] config.json 로딩 실패.', e.message);
    }
  }

  const config = configs[clientId];
  if (config && config.tossUserKeys) {
    config.tossUserKeys = config.tossUserKeys.filter(key => key !== userKey);
    configs[clientId] = config;

    try {
      fs.writeFileSync(configPath, JSON.stringify(configs, null, 2), 'utf8');
      console.log(`[토스 해제 성공] [${clientId}] 토스 userKey가 제거되었습니다: ${userKey}`);
      return res.json({ message: '토스 알림 연동이 해제되었습니다.', tossUserKeysCount: config.tossUserKeys.length });
    } catch (e) {
      return res.status(500).json({ error: '설정 저장 중 에러가 발생했습니다.' });
    }
  }
  
  res.status(404).json({ error: '등록된 토스 알림 정보를 찾을 수 없습니다.' });
});

function updateEnvFile(updates) {
  const envPath = path.join(__dirname, '.env');
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  }

  let lines = content.split(/\r?\n/);
  const keysToUpdate = { ...updates };

  lines = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const parts = trimmed.split('=');
      const key = parts[0].trim();
      if (keysToUpdate[key] !== undefined) {
        const val = keysToUpdate[key];
        delete keysToUpdate[key];
        return `${key}=${val}`;
      }
    }
    return line;
  });

  Object.keys(keysToUpdate).forEach(key => {
    const val = keysToUpdate[key];
    lines.push(`${key}=${val}`);
  });

  fs.writeFileSync(envPath, lines.join('\n'), 'utf8');

  Object.keys(updates).forEach(key => {
    process.env[key] = updates[key];
  });
}

// 4.5. 알림 설정(텔레그램, 이메일 SMTP) 변경 API
app.post('/api/settings/notifications', (req, res) => {
  const { 
    telegramBotToken, 
    telegramChatId, 
    smtpHost, 
    smtpPort, 
    smtpUser, 
    smtpPass, 
    receiverEmail 
  } = req.body;

  const updates = {};

  if (telegramBotToken !== undefined) {
    updates['TELEGRAM_BOT_TOKEN'] = getUpdatedValue(telegramBotToken, process.env.TELEGRAM_BOT_TOKEN);
  }
  if (telegramChatId !== undefined) {
    updates['TELEGRAM_CHAT_ID'] = getUpdatedValue(telegramChatId, process.env.TELEGRAM_CHAT_ID);
  }
  if (smtpHost !== undefined) {
    updates['SMTP_HOST'] = smtpHost.trim();
  }
  if (smtpPort !== undefined) {
    updates['SMTP_PORT'] = smtpPort.trim();
  }
  if (smtpUser !== undefined) {
    updates['SMTP_USER'] = smtpUser.trim();
  }
  if (smtpPass !== undefined) {
    updates['SMTP_PASS'] = getUpdatedValue(smtpPass, process.env.SMTP_PASS);
  }
  if (receiverEmail !== undefined) {
    updates['RECEIVER_EMAIL'] = receiverEmail.trim();
  }

  try {
    updateEnvFile(updates);
    console.log('[설정 변경] 알림 채널 구성(.env)이 정상적으로 갱신되었습니다.');
    res.json({ 
      message: '알림 연동 설정이 성공적으로 저장되었습니다.',
      telegramSetup: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      emailSetup: Boolean(process.env.SMTP_HOST && process.env.RECEIVER_EMAIL && process.env.SMTP_USER && process.env.SMTP_PASS)
    });
  } catch (error) {
    console.error('[설정 변경 실패]', error.message);
    res.status(500).json({ error: '알림 설정을 저장하는 중 에러가 발생했습니다.' });
  }
});

// 4.6. 텔레그램 알림 즉시 테스트 API
app.post('/api/test/telegram', async (req, res) => {
  const { botToken, chatId } = req.body;
  const finalToken = getUpdatedValue(botToken, process.env.TELEGRAM_BOT_TOKEN);
  const finalChatId = getUpdatedValue(chatId, process.env.TELEGRAM_CHAT_ID);

  if (!finalToken || !finalChatId) {
    return res.status(400).json({ error: '텔레그램 봇 토큰과 챗 ID를 모두 입력해 주세요.' });
  }

  try {
    const url = `https://api.telegram.org/bot${finalToken}/sendMessage`;
    await axios.post(url, {
      chat_id: finalChatId,
      text: '🤖 [Alert Watch] 텔레그램 알림 연동 테스트에 성공했습니다!'
    });
    res.json({ message: '텔레그램 테스트 메시지가 성공적으로 발송되었습니다.' });
  } catch (error) {
    let errMsg = error.message;
    if (error.response && error.response.data && error.response.data.description) {
      errMsg = error.response.data.description;
    }
    res.status(500).json({ error: `텔레그램 발송 실패: ${errMsg}` });
  }
});

// 4.7. 이메일 알림 즉시 테스트 API
app.post('/api/test/email', async (req, res) => {
  const { smtpHost, smtpPort, smtpUser, smtpPass, receiverEmail } = req.body;
  const finalHost = smtpHost || process.env.SMTP_HOST;
  const finalPort = parseInt(smtpPort, 10) || parseInt(process.env.SMTP_PORT, 10) || 587;
  const finalUser = smtpUser || process.env.SMTP_USER;
  const finalPass = getUpdatedValue(smtpPass, process.env.SMTP_PASS);
  const finalReceiver = receiverEmail || process.env.RECEIVER_EMAIL;

  if (!finalHost || !finalUser || !finalPass || !finalReceiver) {
    return res.status(400).json({ error: '필수 이메일 SMTP 정보(호스트, 계정, 패스워드, 수신자 메일)가 누락되었습니다.' });
  }

  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: finalHost,
      port: finalPort,
      secure: finalPort === 465,
      auth: {
        user: finalUser,
        pass: finalPass
      },
      timeout: 10000
    });

    await transporter.sendMail({
      from: `"Alert Watch" <${finalUser}>`,
      to: finalReceiver,
      subject: '📬 [Alert Watch] 이메일 연동 테스트 메일',
      text: '본 메일은 Alert Watch 이메일 알림 연동이 성공적으로 설정되었음을 알리는 테스트 메일입니다.',
      html: '<p>본 메일은 <strong>Alert Watch</strong> 이메일 알림 연동이 성공적으로 설정되었음을 알리는 테스트 메일입니다.</p>'
    });

    res.json({ message: '이메일 테스트 발송에 성공했습니다.' });
  } catch (error) {
    res.status(500).json({ error: `이메일 발송 실패: ${error.message}` });
  }
});

// 4-1. 등록된 브라우저 알림 대상 제거 API
app.delete('/api/subscriptions/:subscriptionId', (req, res) => {
  const { subscriptionId } = req.params;
  const { clientId } = req.query;

  if (!clientId) {
    return res.status(400).json({ error: 'clientId가 누락되었습니다.' });
  }

  if (!subscriptionId) {
    return res.status(400).json({ error: '삭제할 알림 대상이 지정되지 않았습니다.' });
  }

  const configPath = path.join(__dirname, 'config.json');
  let configs = {};

  if (fs.existsSync(configPath)) {
    try {
      configs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.error('[구독 삭제] config.json 로딩 실패.', e.message);
      return res.status(500).json({ error: '설정 파일을 읽지 못했습니다.' });
    }
  }

  const config = configs[clientId];
  if (!config || !Array.isArray(config.subscriptions)) {
    return res.status(404).json({ error: '등록된 알림 대상이 없습니다.' });
  }

  const beforeCount = config.subscriptions.length;
  config.subscriptions = config.subscriptions.filter(
    sub => getSubscriptionId(sub.endpoint) !== subscriptionId
  );

  if (config.subscriptions.length === beforeCount) {
    return res.status(404).json({ error: '삭제할 알림 대상을 찾지 못했습니다.' });
  }

  configs[clientId] = config;

  try {
    fs.writeFileSync(configPath, JSON.stringify(configs, null, 2), 'utf8');
  } catch (e) {
    return res.status(500).json({ error: '알림 대상 삭제 중 에러가 발생했습니다.' });
  }

  res.json({
    message: '알림 대상이 제거되었습니다.',
    registeredDevicesCount: config.subscriptions.length,
    registeredDevices: getRegisteredDevices(config.subscriptions)
  });
});

// 5. 모니터링 시작 API
app.post('/api/start', (req, res) => {
  const { clientId } = req.query;
  if (!clientId) {
    return res.status(400).json({ error: 'clientId가 누락되었습니다.' });
  }

  const configPath = path.join(__dirname, 'config.json');
  let configs = {};
  if (fs.existsSync(configPath)) {
    try {
      configs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.error('[시작 API] config.json 로딩 실패.', e.message);
    }
  }

  if (configs[clientId]) {
    configs[clientId].isMonitoring = true;
    try {
      fs.writeFileSync(configPath, JSON.stringify(configs, null, 2), 'utf8');
    } catch (e) {
      console.error('[시작 API] config.json 저장 실패.', e.message);
    }
  }

  scraper.startMonitoring(clientId);
  res.json({ message: '모니터링이 시작되었습니다.', status: scraper.getStatusData(clientId) });
});

// 6. 모니터링 정지 API
app.post('/api/stop', (req, res) => {
  const { clientId } = req.query;
  if (!clientId) {
    return res.status(400).json({ error: 'clientId가 누락되었습니다.' });
  }

  const configPath = path.join(__dirname, 'config.json');
  let configs = {};
  if (fs.existsSync(configPath)) {
    try {
      configs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.error('[정지 API] config.json 로딩 실패.', e.message);
    }
  }

  if (configs[clientId]) {
    configs[clientId].isMonitoring = false;
    try {
      fs.writeFileSync(configPath, JSON.stringify(configs, null, 2), 'utf8');
    } catch (e) {
      console.error('[정지 API] config.json 저장 실패.', e.message);
    }
  }

  scraper.stopMonitoring(clientId);
  res.json({ message: '모니터링이 정지되었습니다.', status: scraper.getStatusData(clientId) });
});

// 7. 웹 푸시 테스트 API
app.post('/api/test-push', async (req, res) => {
  const { subscription } = req.body;
  
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: '구독 토큰이 누락되었습니다.' });
  }

  const payload = JSON.stringify({
    title: '🥔 알림 연동 성공!',
    body: '웹 푸시 알림 연동이 완료되었습니다.',
    url: 'http://localhost:3000'
  });

  try {
    await webpush.sendNotification(subscription, payload);
    res.json({ message: '테스트 푸시가 발송되었습니다.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7.5. 품절 해제 감지 이력 조회 API
app.get('/api/history', (req, res) => {
  const { clientId } = req.query;
  if (!clientId) {
    return res.json([]);
  }

  const historyPath = path.join(__dirname, 'history.json');
  let histories = {};
  
  if (fs.existsSync(historyPath)) {
    try {
      histories = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    } catch (e) {
      console.error('[이력 로드 실패] history.json 파싱 실패.', e.message);
    }
  }
  
  const userHistory = histories[clientId] || [];
  res.json(userHistory);
});

// 7.6. 품절 해제 감지 이력 비우기 API
app.post('/api/history/clear', (req, res) => {
  const { clientId } = req.query;
  if (!clientId) {
    return res.status(400).json({ error: 'clientId가 누락되었습니다.' });
  }

  const historyPath = path.join(__dirname, 'history.json');
  let histories = {};
  if (fs.existsSync(historyPath)) {
    try {
      histories = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    } catch (e) {
      console.error('[이력 초기화] history.json 로딩 실패.', e.message);
    }
  }

  histories[clientId] = [];

  try {
    fs.writeFileSync(historyPath, JSON.stringify(histories, null, 2), 'utf8');
    res.json({ message: '감시 이력이 성공적으로 초기화되었습니다.' });
  } catch (e) {
    res.status(500).json({ error: '이력 초기화 중 에러가 발생했습니다.' });
  }
});

// 7.7. 토스 알림 즉시 테스트 API
app.post('/api/test/toss', async (req, res) => {
  const { userKey } = req.body;
  if (!userKey) {
    return res.status(400).json({ error: '테스트용 토스 userKey가 누락되었습니다.' });
  }

  try {
    const notifier = require('./notifier');
    const success = await notifier.sendTossMessage(userKey, process.env.TOSS_TEMPLATE_SET_CODE, {
      productName: 'Mock 테스트 상품',
      url: 'http://localhost:3000/mock-product'
    });

    if (success) {
      res.json({ message: '토스 테스트 메시지가 정상적으로 요청되었습니다.' });
    } else {
      res.status(500).json({ error: '토스 메시지 발송 요청에 실패했습니다.' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// 에셋 리사이징 및 저장용 임시 API
app.get('/api/temp-thumbnail', (req, res) => {
  res.sendFile("C:\\Users\\GN\\.gemini\\antigravity-ide\\brain\\e4d8cf32-acc9-4f10-91f5-a9962b383182\\thumbnail_1781675218084.png");
});

app.post('/api/save-thumbnail', (req, res) => {
  const { imgData } = req.body;
  if (!imgData) {
    return res.status(400).json({ error: 'imgData가 누락되었습니다.' });
  }
  const base64Data = imgData.replace(/^data:image\/png;base64,/, "");
  const destPath = path.join(__dirname, 'public', 'thumbnail.png');
  fs.writeFileSync(destPath, base64Data, 'base64');
  console.log('[API] 리사이즈된 thumbnail.png가 public/ 폴더에 저장되었습니다.');
  res.json({ success: true });
});


// 8. 감시 대상 사이트의 1회 자가 진단 API (지능형 자동 탐지 고도화)
app.post('/api/check-site', async (req, res) => {
  const { targetUrl, keyword, cssSelector, condition } = req.body;

  if (!targetUrl || !keyword) {
    return res.status(400).json({ error: '진단을 위해 사이트 주소와 키워드를 모두 입력해 주세요.' });
  }

  const activeCondition = condition || 'disappear';

  try {
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000
    });

    const html = response.data;
    const $ = cheerio.load(html);
    let targetText = html;
    let isKeywordFound = false;
    let diagnosticMsg = '';

    const optionFilter = cssSelector ? cssSelector.trim() : '';
    const isCssSelector = isLikelyCssSelector(optionFilter);

    // 분기 A: 사용자가 구체적인 CSS 셀렉터를 지정한 경우
    if (optionFilter && isCssSelector) {
      let elements;
      try {
        elements = $(optionFilter);
      } catch (selectorError) {
        return res.json({
          success: false,
          isAccessible: true,
          statusCode: response.status,
          isKeywordFound: false,
          message: `자가 진단 실패: 입력하신 CSS 셀렉터 문법을 해석할 수 없습니다. 옵션명으로 감시하려면 예: 3Y (98cm)처럼 상품 옵션명을 그대로 입력해 주세요. 오류: ${selectorError.message}`
        });
      }

      if (elements.length === 0) {
        return res.json({
          success: true,
          isAccessible: true,
          statusCode: response.status,
          isKeywordFound: false,
          message: `⚠️ 자가 진단 알림: 사이트 접속에는 성공했으나 입력하신 CSS 셀렉터(${optionFilter})에 해당하는 HTML 요소를 찾을 수 없습니다. 문법을 검토해 주세요.`
        });
      }
      targetText = elements.text();
      isKeywordFound = targetText.includes(keyword);
      diagnosticMsg = ` (지정한 셀렉터 [${optionFilter}] 영역 검사)`;
    } 
    // 분기 B: 셀렉터를 생략했거나 일반 텍스트 옵션 필터가 지정된 경우
    else {
      const selectElements = $('select');
      let hasOptions = false;
      let hasAvailableOption = false;
      const foundOptions = [];

      selectElements.each((i, selectEl) => {
        const selectId = $(selectEl).attr('id') || '';
        const selectClass = $(selectEl).attr('class') || '';
        const selectName = $(selectEl).attr('name') || '';

        // 상품 옵션이 아닌 select 태그 필터링
        const ignoreKeywords = ['country', 'lang', 'brand', 'category', 'sort', 'order', 'filter', 'search', 'link', 'quick', 'navi', 'menu', 'relation'];
        const isIgnore = ignoreKeywords.some(kw => 
          selectClass.toLowerCase().includes(kw) || 
          selectId.toLowerCase().includes(kw) || 
          selectName.toLowerCase().includes(kw)
        );

        if (isIgnore) {
          return;
        }

        const options = $(selectEl).find('option');
        const validOptions = [];

        options.each((j, optionEl) => {
          const val = $(optionEl).attr('value');
          const text = $(optionEl).text().trim();
          
          if (!text) {
            return;
          }

          if (val && val !== '*' && val !== '**' && val !== '' && !text.includes('선택') && !text.includes('---')) {
            validOptions.push({ val, text });
          }
        });

        // 30개 초과 시 브랜드/카테고리 필터로 간주
        if (validOptions.length > 30) {
          return;
        }

        validOptions.forEach(opt => {
          const text = opt.text;

          // 만약 옵션 필터가 지정되어 있고 CSS Selector가 아닌 경우 필터 텍스트 매칭 검사
          if (optionFilter && !isCssSelector) {
            if (!text.includes(optionFilter)) {
              return; // 매칭되지 않는 옵션은 스킵
            }
          }

          hasOptions = true;
          const hasKeyword = text.includes(keyword);
          let isMatched = false;
          if (activeCondition === 'disappear') {
            isMatched = !hasKeyword;
          } else if (activeCondition === 'appear') {
            isMatched = hasKeyword;
          }

          foundOptions.push({ text, isMatched });
          if (isMatched) {
            hasAvailableOption = true;
          }
        });
      });

      if (hasOptions) {
        const total = foundOptions.length;
        const matchedCount = foundOptions.filter(o => o.isMatched).length;
        const conditionDesc = activeCondition === 'disappear' ? `'${keyword}'이(t) 없는 상태` : `'${keyword}'이(가) 포함된 상태`;
        const unavailableCount = total - matchedCount;
        const resultMessage = matchedCount > 0
          ? `✅ 지능형 자가 진단 완료: 정상 작동하는 다중 옵션 페이지입니다.
- 분석 결과: 총 ${total}개의 옵션 중 ${matchedCount}개가 알림 조건(${conditionDesc})을 충족해 구매 가능 상태로 탐지되었습니다.
- 감시 설정 등록 시, 구매 가능한 옵션들의 상태 변화를 자동으로 추적합니다.`
          : `🔒 지능형 자가 진단 완료: 감시 대상 옵션은 현재 품절 상태입니다.
- 분석 결과: 총 ${total}개의 옵션 중 ${unavailableCount}개가 아직 알림 조건(${conditionDesc})을 충족하지 않습니다.
- 이 상태로 저장하면 해당 옵션에서 '${keyword}' 문구가 사라지는 순간 구매 가능으로 감지하고 알림을 보냅니다.`;

        return res.json({
          success: true,
          isAccessible: true,
          statusCode: response.status,
          isKeywordFound: matchedCount > 0, 
          message: resultMessage
        });
      } else {
        // 단일 상품 페이지
        isKeywordFound = html.includes(keyword);
        diagnosticMsg = ' (전체 페이지 본문 검사)';
      }
    }

    return res.json({
      success: true,
      isAccessible: true,
      statusCode: response.status,
      isKeywordFound: isKeywordFound,
      message: isKeywordFound 
        ? `✅ 자가 진단 완료: 정상 감시 가능합니다.${diagnosticMsg}에서 지정하신 키워드 [${keyword}]를 성공적으로 검출했습니다.`
        : `⚠️ 자가 진단 완료: 사이트 접속은 되었으나${diagnosticMsg} 내에서 키워드 [${keyword}]를 발견할 수 없습니다. 대소문자나 품절 문구가 맞는지 확인해 주세요.`
    });
  } catch (error) {
    let failMessage = `❌ 자가 진단 실패: 사이트 접속 불가 (에러: ${error.message})`;
    if (error.response) {
      const code = error.response.status;
      if (code === 403) {
        failMessage = '❌ 자가 진단 실패: 봇 감지 방화벽(HTTP 403 Forbidden)에 의해 접근이 차단되어 감시가 불가능합니다.';
      } else if (code === 404) {
        failMessage = '❌ 자가 진단 실패: 존재하지 않는 페이지 주소(HTTP 404 Not Found)입니다.';
      }
    }
    return res.json({
      success: false,
      isAccessible: false,
      statusCode: error.response ? error.response.status : null,
      isKeywordFound: false,
      message: failMessage
    });
  }
});

// 9. 로컬 테스트용 Mock 상품 상세 페이지 렌더링 라우트
app.get('/mock-product', (req, res) => {
  const anyAvailable = mockProductState.options.some(opt => opt.isAvailable);
  const badgeClass = anyAvailable ? 'available' : 'soldout';
  const badgeText = anyAvailable ? '구매 가능 (AVAILABLE)' : '품절 (SOLD OUT)';
  const optionsHtml = mockProductState.options.map(opt => {
    const text = opt.isAvailable ? `${opt.text} (구매가능)` : `${opt.text} (품절)`;
    return `<option value="${opt.val}">${text}</option>`;
  }).join('\n');

  const html = `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mock Product Page - Alert Watch Test</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    :root {
      --bg-dark: #0d1117;
      --panel-dark: #161b22;
      --border-dark: #30363d;
      --mint: #00f2fe;
      --text-main: #f0f6fc;
      --text-muted: #8b949e;
      --red: #f85149;
      --green: #56d364;
    }
    body {
      background-color: var(--bg-dark);
      color: var(--text-main);
      font-family: 'Inter', -apple-system, sans-serif;
      margin: 0;
      padding: 40px 20px;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      box-sizing: border-box;
    }
    .product-card {
      background: var(--panel-dark);
      border: 1px solid var(--border-dark);
      border-radius: 16px;
      width: 100%;
      max-width: 480px;
      padding: 30px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      position: relative;
    }
    .badge {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 0.8rem;
      font-weight: bold;
      margin-bottom: 15px;
    }
    .badge.soldout {
      background-color: rgba(248, 81, 73, 0.15);
      color: var(--red);
      border: 1px solid rgba(248, 81, 73, 0.3);
    }
    .badge.available {
      background-color: rgba(86, 211, 100, 0.15);
      color: var(--green);
      border: 1px solid rgba(86, 211, 100, 0.3);
    }
    h1 {
      font-size: 1.8rem;
      margin: 0 0 10px 0;
    }
    .price {
      font-size: 1.4rem;
      color: var(--mint);
      font-weight: bold;
      margin-bottom: 25px;
    }
    .image-placeholder {
      background: linear-gradient(135deg, #2b323c, #1f242d);
      border-radius: 12px;
      height: 200px;
      display: flex;
      justify-content: center;
      align-items: center;
      font-size: 4rem;
      color: var(--text-muted);
      margin-bottom: 25px;
      border: 1px solid var(--border-dark);
    }
    .options-label {
      font-size: 0.9rem;
      color: var(--text-muted);
      margin-bottom: 8px;
      display: block;
    }
    select {
      width: 100%;
      padding: 12px;
      background: var(--bg-dark);
      border: 1px solid var(--border-dark);
      color: var(--text-main);
      border-radius: 8px;
      font-size: 1rem;
      outline: none;
      cursor: pointer;
    }
    select:focus {
      border-color: var(--mint);
    }
    .control-panel {
      margin-top: 30px;
      border-top: 1px dashed var(--border-dark);
      padding-top: 20px;
    }
    .control-title {
      font-size: 0.95rem;
      font-weight: bold;
      color: var(--mint);
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .btn-group {
      display: flex;
      gap: 10px;
    }
    button {
      flex: 1;
      padding: 12px;
      border-radius: 8px;
      border: none;
      font-weight: bold;
      cursor: pointer;
      transition: all 0.2s;
    }
    button.btn-soldout {
      background-color: var(--red);
      color: #fff;
    }
    button.btn-soldout:hover {
      opacity: 0.9;
    }
    button.btn-available {
      background-color: var(--green);
      color: #fff;
    }
    button.btn-available:hover {
      opacity: 0.9;
    }
    .home-link {
      display: block;
      text-align: center;
      margin-top: 20px;
      color: var(--text-muted);
      text-decoration: none;
      font-size: 0.85rem;
    }
    .home-link:hover {
      color: var(--mint);
    }
  </style>
</head>
<body>
  <div class="product-card">
    <div class="badge ${badgeClass}">${badgeText}</div>
    <div class="image-placeholder">
      <i class="fa-solid fa-gift"></i>
    </div>
    <h1>Alert Watch 한정판 탐지견 인형</h1>
    <div class="price">49,000원</div>
    
    <span class="options-label">상품 옵션 선택</span>
    <select id="product-option" name="option_select">
      ${optionsHtml}
    </select>

    <!-- Admin / Tester Control Panel -->
    <div class="control-panel">
      <div class="control-title">
        <i class="fa-solid fa-gears"></i>
        <span>테스트 컨트롤러 (품절 유무 설정)</span>
      </div>
      <p style="font-size: 0.8rem; color: var(--text-muted); margin: 0 0 15px 0; line-height: 1.4;">
        여기서 상태를 바꾸면 다음 감시 주기 때 대시보드가 감지하여 푸시 알림을 보냅니다.
      </p>
      <div class="btn-group">
        <button class="btn-soldout" onclick="toggleStatus('SOLD_OUT')">품절 상태로 설정</button>
        <button class="btn-available" onclick="toggleStatus('AVAILABLE')">구매 가능으로 설정</button>
      </div>
    </div>
    
    <a href="/" class="home-link"><i class="fa-solid fa-arrow-left"></i> 대시보드로 돌아가기</a>
  </div>

  <script>
    async function toggleStatus(status) {
      try {
        const res = await fetch('/api/mock-product/toggle', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ status })
        });
        if (res.ok) {
          location.reload();
        } else {
          alert('상태 변경 실패');
        }
      } catch (err) {
        console.error(err);
        alert('서버 통신 실패');
      }
    }
  </script>
</body>
</html>
  `;
  res.send(html);
});

// 10. 로컬 테스트용 Mock 상품 상태 조회 API 라우트
app.get('/api/mock-product/state', (req, res) => {
  return res.json(mockProductState);
});

// 10.5. 로컬 테스트용 Mock 상품 상태 변경 API 라우트
app.post('/api/mock-product/toggle', (req, res) => {
  const { status, optionVal, isAvailable } = req.body;
  if (status === 'SOLD_OUT' || status === 'AVAILABLE') {
    mockProductState.status = status;
    mockProductState.options.forEach(opt => {
      opt.isAvailable = (status === 'AVAILABLE');
    });
    console.log(`[테스트 모듈] Mock 상품 상태가 전체 ${status} 상태로 변경되었습니다.`);
    return res.json({ success: true, status: mockProductState.status, options: mockProductState.options });
  } else if (optionVal !== undefined && isAvailable !== undefined) {
    const opt = mockProductState.options.find(o => o.val === optionVal);
    if (opt) {
      opt.isAvailable = Boolean(isAvailable);
      const anyAvailable = mockProductState.options.some(o => o.isAvailable);
      mockProductState.status = anyAvailable ? 'AVAILABLE' : 'SOLD_OUT';
      console.log(`[테스트 모듈] Mock 상품 옵션 '${opt.text}'가 ${isAvailable ? 'AVAILABLE' : 'SOLD_OUT'} 상태로 변경되었습니다.`);
      return res.json({ success: true, status: mockProductState.status, options: mockProductState.options });
    }
    return res.status(404).json({ error: '해당 옵션을 찾을 수 없습니다.' });
  }
  return res.status(400).json({ error: '유효하지 않은 요청 데이터입니다.' });
});

// 11. 즉시 감시 실행 API 라우트
app.post('/api/monitor/scan-now', async (req, res) => {
  const { clientId } = req.query;
  if (!clientId) {
    return res.status(400).json({ error: 'clientId가 누락되었습니다.' });
  }

  try {
    console.log(`[테스트 모듈] [${clientId}] 즉시 감시(Scan Now) 요청을 수신했습니다.`);
    await scraper.checkCancellation(clientId);
    const status = scraper.getStatusData(clientId);
    return res.json({ success: true, message: '감시가 즉시 실행되었습니다.', status });
  } catch (error) {
    console.error(`[테스트 모듈] [${clientId}] 즉시 감시 실행 중 에러:`, error.message);
    return res.status(500).json({ error: `즉시 감시 실행 실패: ${error.message}` });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[서버 구동] http://localhost:${PORT} 에서 관리 서버가 가동되었습니다.`);
  scraper.initAllMonitors();
});
