// scraper 모듈이 실제 아임웹 페이지 상태를 정확히 파싱하는지 확인하는 단위 테스트 파일

const scraper = require('./scraper');

async function runTest() {
  console.log('[테스트 시작] 감자밭 크롤러 파싱 테스트를 실행합니다.');
  await scraper.checkCancellation();
  
  const status = scraper.getStatusData();
  console.log('\n======================================');
  console.log('[테스트 결과] 현재 파싱된 모니터링 상태 데이터:');
  console.log(`- 감시 대상 URL: ${status.targetUrl}`);
  console.log(`- 감시 주기: ${status.intervalSeconds}초`);
  console.log(`- 에러 발생 횟수: ${status.errorCount}`);
  console.log(`- 마지막 체크 시간: ${status.lastCheckTime}`);
  console.log(`- 현재 감지된 상태: ${status.lastStatus}`);
  console.log('======================================\n');
  
  if (status.lastStatus === 'SOLD_OUT') {
    console.log('[성공] 감자밭 사이트의 품절 상태("is_soldout":true)를 성공적으로 파싱해냈습니다!');
    process.exit(0);
  } else {
    console.error(`[실패] 예상치 못한 상태가 반환되었습니다. 반환 값: ${status.lastStatus}`);
    process.exit(1);
  }
}

runTest();
