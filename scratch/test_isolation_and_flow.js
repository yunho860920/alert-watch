// 다중 사용자 격리 동작 및 가상 상품 품절 해제 알림 발송 흐름을 검증하는 테스트 스크립트
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// 환경 설정 복사 및 Mock 설정 초기화
const configPath = path.join(__dirname, '..', 'config.json');
const historyPath = path.join(__dirname, '..', 'history.json');

// 기존 데이터 백업
let backupConfig = null;
let backupHistory = null;
if (fs.existsSync(configPath)) backupConfig = fs.readFileSync(configPath, 'utf8');
if (fs.existsSync(historyPath)) backupHistory = fs.readFileSync(historyPath, 'utf8');

function restoreBackups() {
  if (backupConfig !== null) fs.writeFileSync(configPath, backupConfig, 'utf8');
  else if (fs.existsSync(configPath)) fs.unlinkSync(configPath);

  if (backupHistory !== null) fs.writeFileSync(historyPath, backupHistory, 'utf8');
  else if (fs.existsSync(historyPath)) fs.unlinkSync(historyPath);

  console.log('[테스트] 백업 데이터가 정상 복구되었습니다.');
}

async function run() {
  try {
    console.log('[테스트] 1. 테스트용 임시 config.json 생성 (다중 사용자 격리 테스트)');
    const testConfigs = {
      "test_client_A": {
        "targetUrl": "http://localhost:3000/mock-product",
        "keyword": "품절",
        "cssSelector": "",
        "condition": "disappear",
        "intervalSeconds": 5,
        "alertRepeatCount": 1,
        "alertRepeatIntervalSeconds": 30,
        "subscriptions": [
          {
            "endpoint": "https://fcm.googleapis.com/fcm/send/test_endpoint_A",
            "keys": { "p256dh": "keyA", "auth": "authA" }
          }
        ],
        "isMonitoring": true
      },
      "test_client_B": {
        "targetUrl": "https://gamzabatt.imweb.me/all/?idx=81",
        "keyword": "품절",
        "cssSelector": "",
        "condition": "disappear",
        "intervalSeconds": 10,
        "alertRepeatCount": 2,
        "alertRepeatIntervalSeconds": 30,
        "subscriptions": [],
        "isMonitoring": false
      }
    };
    fs.writeFileSync(configPath, JSON.stringify(testConfigs, null, 2), 'utf8');

    // scraper & server 모듈 로드
    // server.js의 mockProductState와 scraper를 연동하여 확인하기 위해 axios로 실제 구동중인 서버를 호출하여 검증
    const axios = require('axios');

    console.log('[테스트] 2. 구동 중인 로컬 서버 API 호출 및 격리 상태 검증');
    
    // client A의 상태 조회
    const resA = await axios.get('http://localhost:3000/api/status?clientId=test_client_A');
    assert.strictEqual(resA.data.targetUrl, 'http://localhost:3000/mock-product');
    assert.strictEqual(resA.data.intervalSeconds, 5);
    assert.strictEqual(resA.data.registeredDevicesCount, 1);
    console.log('[테스트] client A 상태 조회 성공.');

    // client B의 상태 조회
    const resB = await axios.get('http://localhost:3000/api/status?clientId=test_client_B');
    assert.strictEqual(resB.data.targetUrl, 'https://gamzabatt.imweb.me/all/?idx=81');
    assert.strictEqual(resB.data.intervalSeconds, 10);
    assert.strictEqual(resB.data.registeredDevicesCount, 0);
    console.log('[테스트] client B 상태 조회 성공 (격리 검증 완료).');

    console.log('[테스트] 3. 로컬 Mock 상품 상태 품절(SOLD_OUT)로 설정');
    await axios.post('http://localhost:3000/api/mock-product/toggle', { status: 'SOLD_OUT' });

    // 스크레이퍼 인스턴스에서 감시 로직을 강제로 수행시켜 봅니다.
    // 여기서는 로컬 서버에 띄워진 스크레이퍼 엔진이 주기적으로 돌지만, API를 통해 모니터링 상태를 강제 갱신시키기 위해
    // 서버가 기동하면서 config.json의 변화를 감지하여 갱신했을 것이므로,
    // 현재 client A의 스크랩 상태를 조회합니다.
    const scraperModule = require('../scraper');
    
    console.log('[테스트] 4. 스크레이퍼의 가상 상품 상태 감시 작동 수동 트리거');
    // 테스트용 모니터 기동
    scraperModule.startMonitoring('test_client_A');
    
    // checkCancellation을 트리거하여 품절 상태 확인
    await scraperModule.checkCancellation('test_client_A');
    let statusA = scraperModule.getStatusData('test_client_A');
    console.log(`- client A의 현재 감지된 상태: ${statusA.lastStatus}`);
    assert.strictEqual(statusA.lastStatus, 'SOLD_OUT');

    console.log('[테스트] 5. 로컬 Mock 상품 상태 구매 가능(AVAILABLE)으로 변경');
    await axios.post('http://localhost:3000/api/mock-product/toggle', { status: 'AVAILABLE' });

    console.log('[테스트] 6. 스크레이퍼 재실행 및 상태 전환 트리거 (SOLD_OUT -> AVAILABLE)');
    // 웹 푸시 전송은 실제 FCM 엔드포인트가 가짜라 오류가 나겠지만, scraper 내부적으로 catch하여 기록과 감시는 정상 작동해야 함
    await scraperModule.checkCancellation('test_client_A');
    
    statusA = scraperModule.getStatusData('test_client_A');
    console.log(`- client A의 변경 후 감지된 상태: ${statusA.lastStatus}`);
    assert.strictEqual(statusA.lastStatus, 'AVAILABLE');

    console.log('[테스트] 7. history.json에 이력이 정상 추가되었는지 확인');
    if (!fs.existsSync(historyPath)) {
      throw new Error('history.json 파일이 생성되지 않았습니다.');
    }
    const histories = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    const userHistoryA = histories['test_client_A'] || [];
    console.log(`- client A의 이력 개수: ${userHistoryA.length}`);
    assert.ok(userHistoryA.length > 0, 'client A의 감지 이력이 존재해야 합니다.');
    console.log(`- 감지된 상품 옵션: ${JSON.stringify(userHistoryA[0].detectedOptions)}`);

    // client B에는 이력이 없어야 함
    const userHistoryB = histories['test_client_B'] || [];
    assert.strictEqual(userHistoryB.length, 0, 'client B에는 감지 이력이 없어야 합니다.');
    console.log('[테스트] client A와 B의 이력 격리 검증 완료.');

    console.log('\n[성공] 모든 시나리오 검증 완료: 멀티 브라우저 격리 및 품절 해제 감지 기능이 완벽하게 동작합니다.');

  } catch (err) {
    console.error('\n[실패] 검증 중 에러 발생:', err.message);
    console.error(err.stack);
  } finally {
    // 백업 복구
    restoreBackups();
  }
}

run();
