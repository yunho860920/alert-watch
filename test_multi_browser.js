// 다중 사용자의 모니어링 환경이 서로 간섭 없이 격리되어 동작하는지 검증하는 테스트 스크립트

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
const CLIENT_A = 'test_client_isolation_A';
const CLIENT_B = 'test_client_isolation_B';

async function runIsolationTest() {
  console.log('[격리 테스트] 다중 사용자 브라우저 격리 검증을 시작합니다.');

  try {
    // 1. Client A 설정 등록 (조건: '품절' 단어가 사라지면 알림)
    console.log('[격리 테스트] Client A 설정을 등록합니다.');
    await axios.post(`${BASE_URL}/api/settings`, {
      clientId: CLIENT_A,
      targetUrl: `${BASE_URL}/mock-product`,
      keyword: '품절',
      condition: 'disappear',
      intervalSeconds: 5
    });

    // 2. Client B 설정 등록 (조건: '존재하지않는키워드'가 사라지면 알림)
    // 이 키워드는 Mock 페이지에 없으므로 Client B는 즉시 AVAILABLE 상태가 되어야 합니다.
    console.log('[격리 테스트] Client B 설정을 등록합니다.');
    await axios.post(`${BASE_URL}/api/settings`, {
      clientId: CLIENT_B,
      targetUrl: `${BASE_URL}/mock-product`,
      keyword: '존재하지않는키워드',
      condition: 'disappear',
      intervalSeconds: 5
    });

    // 3. 잠시 후 각 클라이언트의 상태 조회 및 격리 검증
    console.log('[격리 테스트] 모니터링 주기가 1회 이상 동작할 때까지 6초 대기합니다.');
    await new Promise(resolve => setTimeout(resolve, 6000));

    console.log('[격리 테스트] 각 클라이언트의 상태를 조회합니다.');
    const resA = await axios.get(`${BASE_URL}/api/status?clientId=${CLIENT_A}`);
    const resB = await axios.get(`${BASE_URL}/api/status?clientId=${CLIENT_B}`);

    const statusA = resA.data;
    const statusB = resB.data;

    console.log('\n==================================================');
    console.log(`[Client A] 설정 URL: ${statusA.targetUrl}, 키워드: ${statusA.keyword}, 상태: ${statusA.lastStatus}`);
    console.log(`[Client B] 설정 URL: ${statusB.targetUrl}, 키워드: ${statusB.keyword}, 상태: ${statusB.lastStatus}`);
    console.log('==================================================\n');

    // 검증 1: 두 클라이언트의 설정이 겹치지 않고 정상적으로 격리되어 조회되는지
    if (statusA.keyword !== '품절' || statusB.keyword !== '존재하지않는키워드') {
      throw new Error('실패: 두 클라이언트의 감시 설정(키워드)이 서로 간섭을 주었습니다.');
    }
    console.log('[검증 완료] 1. 두 클라이언트의 설정 정보가 완벽히 독립적으로 저장 및 분리되었습니다.');

    // 검증 2: 두 클라이언트의 감시 상태(lastStatus)가 다르게 유지되고 있는지
    // Client A: '품절'이 페이지에 있으므로 SOLD_OUT 상태 유지
    // Client B: '존재하지않는키워드'가 페이지에 없으므로 AVAILABLE 상태로 변환
    if (statusA.lastStatus !== 'SOLD_OUT' || statusB.lastStatus !== 'AVAILABLE') {
      throw new Error(`실패: 상태 격리가 정상적이지 않습니다. (A: ${statusA.lastStatus}, B: ${statusB.lastStatus})`);
    }
    console.log('[검증 완료] 2. 두 클라이언트의 실시간 모니터링 상태가 상호 영향 없이 독립적으로 제어되고 있습니다.');

    console.log('\n[성공] 모든 격리 및 멀티 브라우저 검증을 통과했습니다!');
  } catch (error) {
    console.error('\n[실패] 격리 검증 실패:', error.message);
    process.exitCode = 1;
  } finally {
    // 4. 테스트 클라이언트 데이터 정리
    cleanupTestData();
  }
}

function cleanupTestData() {
  console.log('[격리 테스트] 테스트용 클라이언트 설정을 정리합니다.');
  const configPath = path.join(__dirname, 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const configs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      let modified = false;
      if (configs[CLIENT_A]) {
        delete configs[CLIENT_A];
        modified = true;
      }
      if (configs[CLIENT_B]) {
        delete configs[CLIENT_B];
        modified = true;
      }
      if (modified) {
        fs.writeFileSync(configPath, JSON.stringify(configs, null, 2), 'utf8');
        console.log('[격리 테스트] 임시 테스트 설정 제거 완료.');
      }
    } catch (e) {
      console.error('[정리 실패] config.json 정리 에러:', e.message);
    }
  }
}

runIsolationTest();
