// 설정 파일(config.json)을 기반으로 어떤 사이트든 키워드 변화를 감시하고 브라우저 웹 푸시를 쏘는 크롤러 모듈

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const webpush = require('web-push');
const { validateUrlForSsrf } = require('./security');
require('dotenv').config();

// 사용자별 모니터링 상태 맵
// activeMonitors: Map<clientId, { monitorInterval, lastStatus, lastCheckTime, errorCount, availableOptions, allOptions, repeatAlertTimer, isMonitoring }>
const activeMonitors = new Map();

function getOrCreateMonitorState(clientId) {
  if (!clientId) return null;
  if (!activeMonitors.has(clientId)) {
    activeMonitors.set(clientId, {
      monitorInterval: null,
      lastStatus: 'UNKNOWN',
      lastCheckTime: null,
      errorCount: 0,
      availableOptions: [],
      allOptions: [],
      repeatAlertTimer: null,
      isMonitoring: false
    });
  }
  return activeMonitors.get(clientId);
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

/**
 * config.json 전체 설정 데이터를 읽어옵니다.
 */
function readAllConfigs() {
  const configPath = path.join(__dirname, 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.error('[감시 모듈] config.json 파싱 실패.', e.message);
    }
  }
  return {};
}

/**
 * 특정 사용자의 설정 데이터를 가져옵니다.
 */
function readConfig(clientId) {
  const configs = readAllConfigs();
  if (clientId && configs[clientId]) {
    return configs[clientId];
  }
  return {
    targetUrl: '',
    keyword: '품절',
    cssSelector: '',
    condition: 'disappear',
    intervalSeconds: 30,
    alertRepeatCount: 1,
    alertRepeatIntervalSeconds: 30,
    subscriptions: []
  };
}

/**
 * 만료되었거나 에러가 발생한 웹 푸시 구독 토큰을 config.json 목록에서 삭제합니다.
 */
function removeBadSubscription(clientId, endpoint) {
  if (!clientId) return;
  const configPath = path.join(__dirname, 'config.json');
  const configs = readAllConfigs();
  const config = configs[clientId];
  if (config && config.subscriptions) {
    config.subscriptions = config.subscriptions.filter(sub => sub.endpoint !== endpoint);
    try {
      fs.writeFileSync(configPath, JSON.stringify(configs, null, 2), 'utf8');
      console.log(`[구독 청소] [${clientId}] 만료된 구독 기기를 제외 처리했습니다. (남은 기기: ${config.subscriptions.length}대)`);
    } catch (e) {
      console.error('[구독 청소 실패] config.json 갱신 중 에러 발생.', e.message);
    }
  }
}

/**
 * 웹 푸시 수신자 전체에게 실시간 취소표 푸시 알림을 발송합니다.
 */
async function sendWebPushNotification(clientId, title, body, url) {
  const config = readConfig(clientId);
  const subs = config.subscriptions || [];

  if (subs.length === 0) {
    console.log(`[푸시 건너뜀] [${clientId}] 등록된 브라우저 기기(구독자)가 없어 알림을 전송하지 않습니다.`);
    return;
  }

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!publicKey || !privateKey) {
    console.error('[푸시 서버 에러] VAPID 키 정보가 누락되어 푸시 메시지를 발송할 수 없습니다.');
    return;
  }

  webpush.setVapidDetails('mailto:alert-admin@example.com', publicKey, privateKey);

  const payload = JSON.stringify({ title, body, url });
  console.log(`[푸시 전송] [${clientId}] 총 ${subs.length}대의 브라우저 기기로 취소표 발생 알림을 발송합니다.`);

  const pushPromises = subs.map(sub => {
    return webpush.sendNotification(sub, payload)
      .catch(err => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          console.warn(`[만료 기기 감지] 만료되거나 삭제된 엔드포인트를 발견했습니다. (Endpoint: ${sub.endpoint})`);
          removeBadSubscription(clientId, sub.endpoint);
        } else {
          console.error('[푸시 개별 오류] 알림 전송에 실패했습니다.', err.message);
        }
      });
  });

  await Promise.all(pushPromises);
}

/**
 * 품절 해제 감지 이력을 파일에 기록합니다. (최근 50개 회전 보존)
 */
function saveHistory(clientId, detectedOptions) {
  if (!clientId) return;
  const historyPath = path.join(__dirname, 'history.json');
  let histories = {};

  if (fs.existsSync(historyPath)) {
    try {
      histories = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    } catch (e) {
      console.error('[이력 저장 실패] 기존 history.json 파싱 실패.', e.message);
    }
  }

  if (!histories[clientId]) {
    histories[clientId] = [];
  }

  const newRecord = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    formattedTime: new Date().toLocaleString(),
    targetUrl: readConfig(clientId).targetUrl,
    detectedOptions: detectedOptions || []
  };

  histories[clientId].unshift(newRecord);
  
  if (histories[clientId].length > 50) {
    histories[clientId] = histories[clientId].slice(0, 50);
  }

  try {
    fs.writeFileSync(historyPath, JSON.stringify(histories, null, 2), 'utf8');
    console.log(`[이력 저장 완료] [${clientId}] 감지 시각: ${newRecord.formattedTime}`);
  } catch (e) {
    console.error('[이력 저장 실패] history.json 쓰기 실패.', e.message);
  }
}

/**
 * 대상 페이지의 HTML을 읽어 사용자가 정의한 키워드 조건 변화를 감시합니다.
 */
async function checkCancellation(clientId) {
  if (!clientId) return;
  const config = readConfig(clientId);
  const url = config.targetUrl;
  const keyword = config.keyword;
  const cssSelector = config.cssSelector;
  const condition = config.condition;

  if (!url) {
    return;
  }

  const state = getOrCreateMonitorState(clientId);
  const urlSafety = await validateUrlForSsrf(url);
  if (!urlSafety.valid) {
    state.errorCount++;
    console.error(`[감시 보안 차단] [${clientId}] 안전하지 않은 URL 요청을 차단했습니다: ${urlSafety.reason}`);
    return;
  }

  state.lastCheckTime = new Date();
  const activeAvailableOptions = []; // 현재 사이클에서 추출한 구매 가능 옵션
  const activeAllOptions = []; // 현재 사이클에서 추출한 전체 옵션 상태 목록

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000
    });

    const html = response.data;
    errorCount = 0;

    const $ = cheerio.load(html);
    let currentStatus = 'UNKNOWN';

    const optionFilter = cssSelector ? cssSelector.trim() : '';
    const isCssSelector = isLikelyCssSelector(optionFilter);

    // 분기 1: 사용자가 명시적으로 특정 CSS 셀렉터를 지정했을 때
    if (optionFilter && isCssSelector) {
      let targetText = '';
      try {
        targetText = $(optionFilter).text();
      } catch (selectorError) {
        throw new Error(`CSS 셀렉터 문법 오류: ${selectorError.message}`);
      }

      const hasKeyword = targetText.includes(keyword);
      if (condition === 'disappear') {
        currentStatus = hasKeyword ? 'SOLD_OUT' : 'AVAILABLE';
      } else if (condition === 'appear') {
        currentStatus = hasKeyword ? 'AVAILABLE' : 'SOLD_OUT';
      }
      
      const isAvailable = currentStatus === 'AVAILABLE';
      const cleanText = targetText.replace(/[\n\t]/g, '').trim();
      const optionName = cleanText.substring(0, 30) || '지정 영역';
      activeAllOptions.push({ text: optionName, isAvailable: isAvailable });
      if (isAvailable) {
        activeAvailableOptions.push(optionName);
      }
    } 
    // 분기 2: CSS 셀렉터가 생략되었거나 일반 텍스트 옵션 필터가 지정되었을 때
    else {
      const selectElements = $('select');
      let hasOptions = false;
      let hasAvailableOption = false;

      selectElements.each((i, selectEl) => {
        const selectId = $(selectEl).attr('id') || '';
        const selectClass = $(selectEl).attr('class') || '';
        const selectName = $(selectEl).attr('name') || '';

        // 국가 선택, 언어 선택, 브랜드, 카테고리, 검색, 정렬 등 상품 옵션이 확실히 아닌 select 태그 필터링
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

        // 유효 옵션이 30개를 초과하는 경우는 브랜드/카테고리 필터 목록으로 간주하여 제외
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
          if (condition === 'disappear') {
            isMatched = !hasKeyword;
          } else if (condition === 'appear') {
            isMatched = hasKeyword;
          }

          activeAllOptions.push({ text: text, isAvailable: isMatched });
          if (isMatched) {
            hasAvailableOption = true;
            activeAvailableOptions.push(text); // 감시 조건 충족 옵션명 수집
          }
        });
      });

      if (hasOptions) {
        currentStatus = hasAvailableOption ? 'AVAILABLE' : 'SOLD_OUT';
        console.log(`[지능형 감지] [${clientId}] 옵션 드롭다운 분석 완료. 조건 충족 목록: [${activeAvailableOptions.join(', ')}]`);
      } else {
        // 단일 상품 페이지의 경우
        const hasKeyword = html.includes(keyword);
        if (condition === 'disappear') {
          currentStatus = hasKeyword ? 'SOLD_OUT' : 'AVAILABLE';
        } else if (condition === 'appear') {
          currentStatus = hasKeyword ? 'AVAILABLE' : 'SOLD_OUT';
        }

        const isAvailable = currentStatus === 'AVAILABLE';
        activeAllOptions.push({ text: '단일 상품', isAvailable: isAvailable });
        if (isAvailable) {
          activeAvailableOptions.push('단일 상품');
        }
      }
    }

    state.availableOptions = activeAvailableOptions; // 데이터 업데이트
    state.allOptions = activeAllOptions; // 데이터 업데이트

    console.log(`[감시 로그] [${clientId}] ${state.lastCheckTime.toLocaleString()} - 상태: ${currentStatus} (타겟 사이트: ${url})`);

    // 품절 -> 구입 가능 상태 변화 트리거
    if (currentStatus === 'AVAILABLE' && state.lastStatus === 'SOLD_OUT') {
      console.log(`[알림 트리거] [${clientId}] 구입 가능 조건 충족! 웹 푸시 및 토스 스마트 발송 전송을 개시합니다.`);
      
      // 품절 해제 감지 이력을 영구 보관용 파일에 저장
      saveHistory(clientId, activeAvailableOptions);
      
      const title = '🚨 상품 구입 가능 알림!';
      let body = `감시하던 웹페이지 상태가 변경되어 구입이 가능해졌습니다. 즉시 확인하세요!\n링크: ${url}`;
      
      // 구매 가능한 구체적인 옵션이 추출된 경우 푸시 알림 문구에 결합
      if (state.availableOptions.length > 0) {
        body = `감시하던 상품의 [${state.availableOptions.join(', ')}] 옵션 구입이 가능해졌습니다. 즉시 확인하세요!\n링크: ${url}`;
      }

      // 반복 알림 설정 읽기
      const repeatCount = parseInt(config.alertRepeatCount, 10) || 1;
      const repeatIntervalSeconds = parseInt(config.alertRepeatIntervalSeconds, 10) || 30;

      // 기존 반복 알림 타이머가 있으면 취소 후 재시작
      if (state.repeatAlertTimer) {
        clearInterval(state.repeatAlertTimer);
        state.repeatAlertTimer = null;
      }

      // 알림 전송 래퍼 함수 (1회차 및 반복 알림 공통 적용)
      const triggerAllAlertChannels = async () => {
        // A. PWA 웹 푸시 발송
        await sendWebPushNotification(clientId, title, body, url);

        // B. 앱인토스 스마트 발송
        if (config.tossUserKeys && config.tossUserKeys.length > 0) {
          try {
            const notifier = require('./notifier');
            const context = {
              productName: config.keyword || '감시 상품',
              url: url
            };
            for (const userKey of config.tossUserKeys) {
              await notifier.sendTossMessage(userKey, config.templateSetCode, context);
            }
          } catch (tossErr) {
            console.error('[토스 발송 에러] 토스 메시지 발송 실패:', tossErr.message);
          }
        }

        // C. 이메일 및 텔레그램 알림 발송 연동
        try {
          const notifier = require('./notifier');
          const textMsg = `[품절 탐지견 컹컹!] 구입 가능 알림\n\n${body}`;
          const htmlMsg = `<p><strong>[품절 탐지견 컹컹!]</strong> 감시하던 상품의 구입 가능 상태가 감지되었습니다.</p>
                           <p>${body.replace(/\n/g, '<br>')}</p>
                           <p><a href="${url}" target="_blank">즉시 구매하러 이동</a></p>`;
          notifier.sendTelegram(textMsg);
          notifier.sendEmail(title, textMsg, htmlMsg);
        } catch (notifierErr) {
          console.error('[알림 연동 에러] 이메일/텔레그램 발송 실패:', notifierErr.message);
        }
      };

      // 1회차 즉시 발송
      await triggerAllAlertChannels();
      console.log(`[반복 알림] [${clientId}] 1/${repeatCount}회 발송 완료.`);

      if (repeatCount > 1) {
        let sentCount = 1;
        state.repeatAlertTimer = setInterval(async () => {
          sentCount++;
          await triggerAllAlertChannels();
          console.log(`[반복 알림] [${clientId}] ${sentCount}/${repeatCount}회 발송 완료.`);
          if (sentCount >= repeatCount) {
            clearInterval(state.repeatAlertTimer);
            state.repeatAlertTimer = null;
            console.log(`[반복 알림] [${clientId}] 설정된 횟수만큼 발송 완료. 반복 알림을 종료합니다.`);
          }
        }, repeatIntervalSeconds * 1000);
      }
    }

    state.lastStatus = currentStatus;
  } catch (error) {
    state.errorCount++;
    console.error(`[감시 에러] [${clientId}] 대상 페이지 조회 실패. (에러 횟수: ${state.errorCount})`, error.message);
  }
}

/**
 * 모니터링을 시작합니다.
 */
function startMonitoring(clientId) {
  if (!clientId) return;
  const state = getOrCreateMonitorState(clientId);
  if (state.isMonitoring) {
    return;
  }

  state.isMonitoring = true;
  const config = readConfig(clientId);
  const intervalSeconds = config.intervalSeconds || 30;

  console.log(`[감시 엔진] [${clientId}] 새로운 설정을 기반으로 모니터링 가동을 시작합니다. (주기: ${intervalSeconds}초)`);
  checkCancellation(clientId);
  
  if (state.monitorInterval) {
    clearInterval(state.monitorInterval);
  }
  state.monitorInterval = setInterval(() => checkCancellation(clientId), intervalSeconds * 1000);
}

/**
 * 모니터링을 정지합니다.
 */
function stopMonitoring(clientId) {
  if (!clientId) return;
  const state = getOrCreateMonitorState(clientId);
  if (!state.isMonitoring) {
    return;
  }

  state.isMonitoring = false;
  if (state.monitorInterval) {
    clearInterval(state.monitorInterval);
    state.monitorInterval = null;
  }
  // 진행 중인 반복 알림 타이머도 함께 정지
  if (state.repeatAlertTimer) {
    clearInterval(state.repeatAlertTimer);
    state.repeatAlertTimer = null;
    console.log(`[반복 알림] [${clientId}] 감시 정지로 인해 반복 알림 타이머를 종료합니다.`);
  }
  console.log(`[감시 엔진] [${clientId}] 모니터링이 안전하게 정지되었습니다.`);
}

/**
 * 대시보드 표기용 상태 리턴 함수
 */
function getStatusData(clientId) {
  if (!clientId) return {};
  const config = readConfig(clientId);
  const state = getOrCreateMonitorState(clientId);
  return {
    isMonitoring: state.isMonitoring,
    lastStatus: state.lastStatus,
    lastCheckTime: state.lastCheckTime ? state.lastCheckTime.toLocaleString() : null,
    errorCount: state.errorCount,
    targetUrl: config.targetUrl,
    intervalSeconds: config.intervalSeconds,
    availableOptions: state.availableOptions, // 상세 옵션명 배열 전달
    allOptions: state.allOptions // 전체 옵션 상태 목록 전달
  };
}

/**
 * 서버 시작 시 기존 활성화된 모든 감시 프로세스를 복구합니다.
 */
function initAllMonitors() {
  console.log('[감시 엔진] 기존 감시 프로세스 복구를 개시합니다.');
  const configs = readAllConfigs();
  Object.keys(configs).forEach(clientId => {
    const config = configs[clientId];
    if (config && config.isMonitoring) {
      console.log(`[자동 복구] [${clientId}] 감시를 복구합니다.`);
      startMonitoring(clientId);
    }
  });
}

module.exports = {
  startMonitoring,
  stopMonitoring,
  getStatusData,
  checkCancellation,
  initAllMonitors,
  readConfig
};
