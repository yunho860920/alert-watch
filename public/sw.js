// 브라우저 백그라운드에서 푸시 이벤트를 대기하고 실시간 알림창을 띄워주는 서비스 워커 스크립트

// 1. 푸시 알림 수신 시 디바이스 화면에 Notification 팝업 노출
self.addEventListener('push', (event) => {
  let data = {
    title: '🚨 취소표 알림!',
    body: '예매 가능 상태로 변경된 웹사이트가 있습니다. 확인해 보세요.',
    url: 'http://localhost:3000'
  };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      // 일반 텍스트 데이터 형식으로 왔을 때 대비 폴백 처리
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/logo.png', // 기본 아이콘 설정 폴백
    badge: '/logo.png',
    vibrate: [200, 100, 200, 100, 200, 100, 400], // 모바일 진동 패턴 설정
    data: {
      url: data.url
    },
    actions: [
      { action: 'open_url', title: '🔗 즉시 예매하러 이동' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// 2. 푸시 알림 클릭 시 예매 대상 페이지 새 창으로 열기 혹은 기존 창 활성화
self.addEventListener('notificationclick', (event) => {
  event.notification.close(); // 우선 알림창을 닫아줍니다.

  let clickUrl = 'http://localhost:3000';
  if (event.notification.data && event.notification.data.url) {
    clickUrl = event.notification.data.url;
  }

  // 예매 사이트 새 탭을 브라우저에 띄우거나, 이미 열려 있는 탭이 있다면 활성화합니다.
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // 정확한 URL 매칭이 있을 경우 포커싱
      for (let i = 0; i < windowClients.length; i++) {
        let client = windowClients[i];
        if (client.url === clickUrl && 'focus' in client) {
          return client.focus();
        }
      }
      // 해당 창이 열려있지 않다면 새 창으로 띄움
      if (clients.openWindow) {
        return clients.openWindow(clickUrl);
      }
    })
  );
});
