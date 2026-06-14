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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
    registeredDevices: getRegisteredDevices(subscriptions, currentEndpoint || '')
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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[서버 구동] http://localhost:${PORT} 에서 관리 서버가 가동되었습니다.`);
  scraper.initAllMonitors();
});
