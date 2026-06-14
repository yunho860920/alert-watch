// 백엔드 API와 통신해 감시 상태, 설정 저장, 브라우저 알림을 제어하는 스크립트
document.addEventListener('DOMContentLoaded', async () => {
  // 로컬 고유 클라이언트 식별자 관리
  let clientId = localStorage.getItem('alertWatchClientId');
  if (!clientId) {
    clientId = 'client_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now();
    localStorage.setItem('alertWatchClientId', clientId);
  }

  const monitoringPulse = document.getElementById('monitoring-pulse');

  const monitoringText = document.getElementById('monitoring-text');
  const ticketStatusBadge = document.getElementById('ticket-status-badge');
  const heroStatusText = document.getElementById('hero-status-text');
  const lastCheckTime = document.getElementById('last-check-time');
  const checkInterval = document.getElementById('check-interval');
  const nextCheckTime = document.getElementById('next-check-time');
  const registeredDevices = document.getElementById('registered-devices');
  const registeredDeviceList = document.getElementById('registered-device-list');
  const toggleMonitorBtn = document.getElementById('toggle-monitor-btn');
  const clearHistoryBtn = document.getElementById('clear-history-btn');
  const historyListContainer = document.getElementById('history-list-container');

  const settingsUrl = document.getElementById('settings-url');
  const settingsKeyword = document.getElementById('settings-keyword');
  const settingsCssSelector = document.getElementById('settings-css-selector');
  const checkFeasibilityBtn = document.getElementById('check-feasibility-btn');
  const saveSettingsBtn = document.getElementById('save-settings-btn');
  const intervalInput = document.getElementById('settings-interval');
  const alertRepeatCountInput = document.getElementById('settings-alert-repeat-count');
  const alertRepeatIntervalInput = document.getElementById('settings-alert-repeat-interval');
  const diagnosticResult = document.getElementById('diagnostic-result');

  const pushStatusLabel = document.getElementById('push-status-label');
  const pushToggleBtn = document.getElementById('push-toggle-btn');
  const testPushBtn = document.getElementById('test-push-btn');
  const pushOnboardingBanner = document.getElementById('push-onboarding-banner');
  const pushOnboardingTitle = document.getElementById('push-onboarding-title');
  const pushOnboardingDetail = document.getElementById('push-onboarding-detail');
  const pushOnboardingAction = document.getElementById('push-onboarding-action');
  const postSaveAlertHint = document.getElementById('post-save-alert-hint');

  let isBtnLocked = false;
  let serviceWorkerReg = null;
  let currentSubscription = null;
  let lastKnownTargetUrl = '';
  let detectionFieldsResetForUrl = '';
  let lastRawCheckTime = '';
  let localFormattedCheckTime = '';
  let localLastCheckTime = null;
  let lastKnownIntervalSeconds = null;
  let isMonitoringActive = false;
  let lastStatusAlerted = null;
  let hasUnsavedChanges = false;
  let shouldShowPostSaveAlertHint = false;

  function showInAppToast(targetUrl, availableOptions = []) {
    let toast = document.getElementById('in-app-toast');
    if (toast) {
      return;
    }

    toast = document.createElement('div');
    toast.id = 'in-app-toast';
    toast.className = 'in-app-toast';

    const header = document.createElement('div');
    header.className = 'toast-header';

    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.innerHTML = '<i class="fa-solid fa-bell"></i>';

    const title = document.createElement('h4');
    title.className = 'toast-title';
    title.textContent = '🚨 상품 구매 가능 알림!';

    const closeBtnX = document.createElement('button');
    closeBtnX.className = 'toast-close-x';
    closeBtnX.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtnX.onclick = () => dismissInAppToast();

    header.appendChild(icon);
    header.appendChild(title);
    header.appendChild(closeBtnX);

    const body = document.createElement('div');
    body.className = 'toast-body';
    
    let optionText = '';
    if (availableOptions && availableOptions.length > 0) {
      optionText = `감시 대상 상품의 <strong>[${availableOptions.join(', ')}]</strong> 옵션 구매가 가능해졌습니다. 즉시 예매 페이지로 이동하여 구매하세요!`;
    } else {
      optionText = '감시 중인 상품 페이지가 구매 가능한 상태로 변경되었습니다. 즉시 확인해보세요!';
    }
    body.innerHTML = optionText;

    const actions = document.createElement('div');
    actions.className = 'toast-actions';

    const goBtn = document.createElement('a');
    goBtn.className = 'toast-btn primary';
    goBtn.href = targetUrl || '#';
    goBtn.target = '_blank';
    goBtn.innerHTML = '<i class="fa-solid fa-cart-shopping"></i> 즉시 구매하러 이동';
    goBtn.onclick = () => {
      dismissInAppToast();
    };

    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-btn secondary';
    closeBtn.textContent = '닫기';
    closeBtn.onclick = () => dismissInAppToast();

    actions.appendChild(closeBtn);
    actions.appendChild(goBtn);

    toast.appendChild(header);
    toast.appendChild(body);
    toast.appendChild(actions);

    document.body.appendChild(toast);
  }

  function dismissInAppToast() {
    const toast = document.getElementById('in-app-toast');
    if (toast) {
      toast.classList.add('hide-toast');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }
  }

  function parseServerDate(dateStr) {
    if (!dateStr) return null;
    let parsed = new Date(dateStr);
    
    if (dateStr.includes('AM') || dateStr.includes('PM') || dateStr.includes('/')) {
      if (!dateStr.toLowerCase().includes('utc') && !dateStr.toLowerCase().includes('gmt')) {
        const utcParsed = new Date(dateStr + ' UTC');
        if (!isNaN(utcParsed.getTime())) {
          parsed = utcParsed;
        }
      }
    }
    
    if (isNaN(parsed.getTime())) {
      const normalized = dateStr
        .replace('오후', 'PM')
        .replace('오전', 'AM')
        .replace(/\./g, '/');
      parsed = new Date(normalized);
    }
    
    return parsed;
  }

  function getPushState() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      return 'unsupported';
    }

    if (Notification.permission === 'denied') {
      return 'blocked';
    }

    if (currentSubscription) {
      return 'ready';
    }

    return 'inactive';
  }

  function updatePushOnboardingUI() {
    if (!pushOnboardingBanner || !pushOnboardingTitle || !pushOnboardingDetail || !pushOnboardingAction) {
      return;
    }

    const state = getPushState();
    pushOnboardingBanner.className = `push-onboarding-banner ${state}`;
    pushOnboardingAction.disabled = false;

    if (state === 'ready') {
      pushOnboardingBanner.classList.add('hide');
      return;
    }

    pushOnboardingBanner.classList.remove('hide');

    if (state === 'blocked') {
      pushOnboardingTitle.textContent = '브라우저에서 알림 권한이 차단되어 있습니다.';
      pushOnboardingDetail.textContent = '주소창 왼쪽의 사이트 설정에서 알림 권한을 허용한 뒤 다시 시도해 주세요.';
      pushOnboardingAction.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i><span>알림 탭 열기</span>';
      return;
    }

    if (state === 'unsupported') {
      pushOnboardingTitle.textContent = '이 브라우저는 푸시 알림을 지원하지 않습니다.';
      pushOnboardingDetail.textContent = '다른 최신 브라우저에서 접속하면 실시간 알림을 받을 수 있습니다.';
      pushOnboardingAction.innerHTML = '<i class="fa-solid fa-ban"></i><span>지원 안 됨</span>';
      pushOnboardingAction.disabled = true;
      return;
    }

    pushOnboardingTitle.textContent = '이 기기는 아직 알림을 받지 않습니다.';
    pushOnboardingDetail.textContent = '감시가 시작되어도 이 기기에 알림이 오지 않을 수 있습니다.';
    pushOnboardingAction.innerHTML = '<i class="fa-regular fa-bell"></i><span>알림 켜기</span>';
  }

  function renderPostSaveAlertHint() {
    if (!postSaveAlertHint) {
      return;
    }

    const shouldShow = shouldShowPostSaveAlertHint && getPushState() === 'inactive';
    postSaveAlertHint.classList.toggle('hide', !shouldShow);
  }

  function renderNextCheckTime() {
    if (!nextCheckTime) {
      return;
    }

    if (!isMonitoringActive) {
      nextCheckTime.textContent = '-';
      return;
    }

    if (!localLastCheckTime || !lastKnownIntervalSeconds) {
      nextCheckTime.textContent = '대기 중';
      return;
    }

    const elapsedSec = Math.floor((Date.now() - localLastCheckTime) / 1000);
    const remainingSec = Math.max(0, lastKnownIntervalSeconds - elapsedSec);
    nextCheckTime.textContent = remainingSec === 0 ? '곧 확인' : `${remainingSec}초 후`;
  }

  function getClientDeviceInfo() {
    const ua = navigator.userAgent || '';
    let browser = '브라우저';

    if (ua.includes('Edg/')) {
      browser = 'Edge';
    } else if (ua.includes('Chrome/') && !ua.includes('Edg/')) {
      browser = 'Chrome';
    } else if (ua.includes('Firefox/')) {
      browser = 'Firefox';
    } else if (ua.includes('Safari/') && !ua.includes('Chrome/')) {
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

  function formatDeviceTime(value) {
    if (!value) {
      return '등록 시각 정보 없음';
    }

    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return '등록 시각 정보 없음';
    }

    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  }

  function renderRegisteredDevices(devices = []) {
    if (!registeredDeviceList) {
      return;
    }

    registeredDeviceList.innerHTML = '';

    if (!devices.length) {
      const empty = document.createElement('div');
      empty.className = 'registered-device-empty';
      empty.textContent = '아직 등록된 알림 대상이 없습니다. 알림 켜기를 누르면 현재 브라우저가 등록됩니다.';
      registeredDeviceList.appendChild(empty);
      return;
    }

    devices.forEach((device) => {
      const item = document.createElement('div');
      item.className = 'registered-device-item';

      const icon = document.createElement('div');
      icon.className = 'registered-device-icon';
      icon.innerHTML = device.deviceType === 'mobile'
        ? '<i class="fa-solid fa-mobile-screen-button"></i>'
        : '<i class="fa-solid fa-desktop"></i>';

      const copy = document.createElement('div');
      copy.className = 'registered-device-copy';

      const title = document.createElement('strong');
      title.textContent = device.label || `등록된 브라우저 ${device.id || ''}`.trim();

      const meta = document.createElement('span');
      meta.textContent = `마지막 확인: ${formatDeviceTime(device.lastSeenAt || device.createdAt)}`;

      copy.appendChild(title);
      copy.appendChild(meta);

      item.appendChild(icon);
      item.appendChild(copy);

      if (device.isCurrent) {
        const current = document.createElement('span');
        current.className = 'registered-device-current';
        current.textContent = '현재 브라우저';
        item.appendChild(current);
      }

      if (device.id) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'registered-device-remove';
        removeBtn.type = 'button';
        removeBtn.title = '알림 대상 제거';
        removeBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i><span>제거</span>';
        removeBtn.addEventListener('click', () => removeRegisteredDevice(device));
        item.appendChild(removeBtn);
      } else {
        const pending = document.createElement('span');
        pending.className = 'registered-device-pending';
        pending.textContent = '재시작 후 제거 가능';
        item.appendChild(pending);
      }

      registeredDeviceList.appendChild(item);
    });
  }

  async function removeRegisteredDevice(device) {
    if (!device || !device.id || isBtnLocked) {
      return;
    }

    const label = device.label || '선택한 알림 대상';
    const confirmed = confirm(`${label}을(를) 알림 발송 대상에서 제거할까요?`);
    if (!confirmed) {
      return;
    }

    isBtnLocked = true;

    try {
      const response = await fetch(`/api/subscriptions/${encodeURIComponent(device.id)}?clientId=${encodeURIComponent(clientId)}`, {
        method: 'DELETE'
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '알림 대상 제거에 실패했습니다.');
      }

      if (device.isCurrent && currentSubscription) {
        try {
          await currentSubscription.unsubscribe();
        } catch (error) {
          console.warn('[푸시] 현재 브라우저 구독 해제 중 경고.', error);
        }
        currentSubscription = null;
        updatePushUI();
      }

      await updateStatus();
    } catch (error) {
      alert(`알림 대상 제거 실패. ${error.message}`);
    } finally {
      isBtnLocked = false;
    }
  }

  function createRegisteredDeviceFallbacks(count) {
    return Array.from({ length: count }, (_, index) => ({
      id: null,
      order: index + 1,
      label: `등록된 브라우저 ${index + 1}`,
      deviceType: 'desktop',
      createdAt: null,
      lastSeenAt: null,
      isCurrent: false
    }));
  }

  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) {
    try {
      serviceWorkerReg = await navigator.serviceWorker.register('/sw.js');
      currentSubscription = await serviceWorkerReg.pushManager.getSubscription();
      updatePushUI();
    } catch (error) {
      console.error('[서비스워커] 등록 실패.', error);
      pushStatusLabel.textContent = '지원 안 됨';
      pushToggleBtn.disabled = true;
      updatePushOnboardingUI();
    }
  } else {
    pushStatusLabel.textContent = '지원 안 됨';
    pushToggleBtn.disabled = true;
    updatePushOnboardingUI();
  }

  async function updateStatus() {
    try {
      const params = new URLSearchParams({ clientId });
      if (currentSubscription && currentSubscription.endpoint) {
        params.set('currentEndpoint', currentSubscription.endpoint);
      }

      const response = await fetch(`/api/status?${params.toString()}`);
      if (!response.ok) {
        throw new Error('상태 정보를 불러오지 못했습니다.');
      }

      const data = await response.json();
      const currentTargetUrl = normalizeUrl(settingsUrl.value);
      const receivedTargetUrl = normalizeUrl(data.targetUrl);
      const isNewTargetDraft = currentTargetUrl && receivedTargetUrl && currentTargetUrl !== receivedTargetUrl;
      const shouldShowCurrentStatus = !isNewTargetDraft;

      if (receivedTargetUrl) {
        lastKnownTargetUrl = receivedTargetUrl;
      }

      setMonitoringState(data.isMonitoring);
      updateStatusBadge(shouldShowCurrentStatus ? data.lastStatus : 'UNKNOWN', shouldShowCurrentStatus ? data.availableOptions : []);
      renderOptionsList(shouldShowCurrentStatus ? data.allOptions : []);

      if (data.lastCheckTime) {
        if (lastRawCheckTime !== data.lastCheckTime) {
          lastRawCheckTime = data.lastCheckTime;
          localLastCheckTime = Date.now();
          
          const parsed = parseServerDate(data.lastCheckTime);
          if (parsed && !isNaN(parsed.getTime())) {
            localFormattedCheckTime = parsed.toLocaleString();
          } else {
            localFormattedCheckTime = data.lastCheckTime;
          }
        }
        renderLastCheckTime();
      } else {
        lastCheckTime.textContent = '기록 없음';
      }
      lastKnownIntervalSeconds = data.intervalSeconds || null;
      checkInterval.textContent = `${data.intervalSeconds || '-'}초`;
      renderNextCheckTime();
      const registeredDeviceCount = data.registeredDevicesCount || 0;
      const registeredDeviceItems = Array.isArray(data.registeredDevices)
        ? data.registeredDevices
        : createRegisteredDeviceFallbacks(registeredDeviceCount);

      registeredDevices.textContent = `${registeredDeviceCount}개`;
      renderRegisteredDevices(registeredDeviceItems);

      // 최신 품절 해제 감지 이력 동기화
      await updateHistory();

      const currentStatus = shouldShowCurrentStatus ? data.lastStatus : 'UNKNOWN';

      // 즉시 구매 이동 버튼 노출/숨김 및 URL 세팅
      const directBuyBtn = document.getElementById('direct-buy-btn');
      if (directBuyBtn) {
        if (currentStatus === 'AVAILABLE' && data.targetUrl) {
          directBuyBtn.href = data.targetUrl;
          directBuyBtn.style.display = 'inline-flex';
        } else {
          directBuyBtn.style.display = 'none';
        }
      }

      // 인앱 토스트 팝업 제어
      if (currentStatus === 'AVAILABLE') {
        if (lastStatusAlerted !== 'AVAILABLE') {
          showInAppToast(data.targetUrl, data.availableOptions);
          lastStatusAlerted = 'AVAILABLE';
        }
      } else {
        lastStatusAlerted = currentStatus;
        dismissInAppToast();
      }

      // 서버에 저장된 감시 대상 정보가 있고, 사용자가 입력 중인 설정을 덮어쓰지 않도록 수정
      if (!hasUnsavedChanges && data.targetUrl) {
        if (settingsUrl.value !== data.targetUrl) {
          settingsUrl.value = data.targetUrl;
        }
        if (settingsKeyword.value !== data.keyword) {
          settingsKeyword.value = data.keyword || '';
        }
        if (settingsCssSelector.value !== data.cssSelector) {
          settingsCssSelector.value = data.cssSelector || '';
        }
        if (data.condition) {
          const radioCondition = document.getElementById(`condition-${data.condition}`);
          if (radioCondition && !radioCondition.checked) {
            radioCondition.checked = true;
          }
        }
        if (data.intervalSeconds && intervalInput.value !== String(data.intervalSeconds)) {
          intervalInput.value = data.intervalSeconds;
        }
        if (data.alertRepeatCount && alertRepeatCountInput.value !== String(data.alertRepeatCount)) {
          alertRepeatCountInput.value = data.alertRepeatCount;
        }
        if (data.alertRepeatIntervalSeconds && alertRepeatIntervalInput.value !== String(data.alertRepeatIntervalSeconds)) {
          alertRepeatIntervalInput.value = data.alertRepeatIntervalSeconds;
        }
        // 반복 알림 설정 간격 비활성화 상태 업데이트 호출
        if (typeof updateRepeatIntervalState === 'function') {
          updateRepeatIntervalState();
        }
      }
    } catch (error) {
      console.error('[대시보드] 상태 업데이트 실패.', error);
      monitoringPulse.classList.remove('active');
      monitoringText.textContent = '연결 실패';
      isMonitoringActive = false;
      toggleMonitorBtn.className = 'primary-action neutral';
      toggleMonitorBtn.innerHTML = '<i class="fa-solid fa-rotate"></i><span>다시 확인</span>';
      if (nextCheckTime) {
        nextCheckTime.textContent = '연결 실패';
      }
      updateStatusBadge('UNKNOWN');
      renderOptionsList([]);
      renderRegisteredDevices([]);
    }
  }

  function normalizeUrl(url) {
    return String(url || '').trim();
  }

  function resetDetectionFieldsForNewTarget(showMessage = false) {
    const targetUrlVal = normalizeUrl(settingsUrl.value);
    if (!targetUrlVal || !lastKnownTargetUrl || targetUrlVal === lastKnownTargetUrl) {
      return false;
    }

    if (detectionFieldsResetForUrl === targetUrlVal) {
      return false;
    }

    settingsKeyword.value = '';
    settingsCssSelector.value = '';
    document.getElementById('condition-disappear').checked = true;
    detectionFieldsResetForUrl = targetUrlVal;

    if (showMessage) {
      diagnosticResult.className = 'diagnostic-result warning';
      diagnosticResult.textContent = '새 대상 URL이 입력되어 이전 페이지의 상태 키워드와 옵션/선택자를 초기화했습니다. 새 페이지에 맞는 키워드를 입력한 뒤 다시 진단해 주세요.';
      settingsKeyword.focus();
    }

    return true;
  }

  function setMonitoringState(isMonitoring) {
    isMonitoringActive = Boolean(isMonitoring);
    if (isMonitoring) {
      monitoringPulse.classList.add('active');
      monitoringText.textContent = '감시 중';
      toggleMonitorBtn.className = 'primary-action stop running';
      toggleMonitorBtn.innerHTML = '<i class="fa-solid fa-square"></i><span>감시 일시중지</span>';
      renderNextCheckTime();
      return;
    }

    monitoringPulse.classList.remove('active');
    monitoringText.textContent = '일시중지';
    toggleMonitorBtn.className = 'primary-action neutral';
    toggleMonitorBtn.innerHTML = '<i class="fa-solid fa-play"></i><span>감시 시작</span>';
    renderNextCheckTime();
  }

  function updateStatusBadge(status, availableOptions = []) {
    ticketStatusBadge.className = 'badge';

    const SHIBA_UNKNOWN_SVG = `
      <svg viewBox="0 0 100 100" width="72" height="72" xmlns="http://www.w3.org/2000/svg" style="display: block;">
        <style>
          @keyframes sniff {
            0%, 100% { transform: translateY(0px) scale(1); }
            50% { transform: translateY(-1px) scale(1.05); }
          }
          @keyframes headLook {
            0%, 100% { transform: rotate(-5deg) translateX(-2px); }
            50% { transform: rotate(5deg) translateX(2px); }
          }
          @keyframes magnifierSweep {
            0%, 100% { transform: translate(-8px, 2px) rotate(-10deg); }
            50% { transform: translate(8px, 2px) rotate(10deg); }
          }
          @keyframes eyesLook {
            0%, 100% { transform: translateX(-2px); }
            50% { transform: translateX(2px); }
          }
          .check-shiba-head {
            animation: headLook 2s infinite ease-in-out;
            transform-origin: 50px 75px;
          }
          .check-shiba-nose {
            animation: sniff 0.3s infinite ease-in-out;
            transform-origin: 50px 59.5px;
          }
          .check-shiba-eyes {
            animation: eyesLook 2s infinite ease-in-out;
          }
          .check-magnifier {
            animation: magnifierSweep 2s infinite ease-in-out;
            transform-origin: 50px 75px;
          }
        </style>
        <g class="check-shiba-head">
          <!-- Ears -->
          <path d="M 28 42 L 18 16 L 42 30 Z" fill="#E67E22" />
          <path d="M 29 39 L 21 21 L 39 30 Z" fill="#FFD1DC" />
          <path d="M 72 42 L 82 16 L 58 30 Z" fill="#E67E22" />
          <path d="M 71 39 L 79 21 L 61 30 Z" fill="#FFD1DC" />

          <!-- Head Base -->
          <circle cx="50" cy="58" r="23" fill="#E67E22" />
          <!-- Cheeks & Muzzle -->
          <ellipse cx="37" cy="63" rx="12" ry="9" fill="#FFFFFF" />
          <ellipse cx="63" cy="63" rx="12" ry="9" fill="#FFFFFF" />
          <ellipse cx="50" cy="65" rx="9" ry="6" fill="#FFFFFF" />
          
          <!-- Eyebrows -->
          <ellipse cx="39" cy="46" rx="4" ry="2.2" fill="#FFFFFF" />
          <ellipse cx="61" cy="46" rx="4" ry="2.2" fill="#FFFFFF" />

          <!-- Eyes -->
          <g class="check-shiba-eyes">
            <circle cx="40" cy="51.5" r="3.2" fill="#2C3E50" />
            <circle cx="38.8" cy="50.3" r="1.1" fill="#FFFFFF" />
            <circle cx="60" cy="51.5" r="3.2" fill="#2C3E50" />
            <circle cx="58.8" cy="50.3" r="1.1" fill="#FFFFFF" />
          </g>

          <!-- Nose -->
          <ellipse class="check-shiba-nose" cx="50" cy="59.5" rx="2.5" ry="1.6" fill="#2C3E50" />
          <path d="M 47.5 62 Q 50 63.5 52.5 62" stroke="#2C3E50" stroke-width="1.2" fill="none" stroke-linecap="round" />

          <!-- Detective Hat -->
          <path d="M 33 34 C 33 19, 67 19, 67 34 Z" fill="#7D5C45" />
          <path d="M 31 34 Q 50 31 69 34 L 69 36 Q 50 33 31 36 Z" fill="#E65C40" />
          <path d="M 28 38 Q 50 35 72 38 C 70 33, 30 33, 28 38 Z" fill="#6A4B35" />
          <circle cx="50" cy="14" r="2.8" fill="#E65C40" />
        </g>

        <!-- Magnifier -->
        <g class="check-magnifier">
          <line x1="77" y1="77" x2="87" y2="87" stroke="#6A4B35" stroke-width="3.5" stroke-linecap="round" />
          <circle cx="70" cy="70" r="8.5" fill="#FFFFFF" stroke="#34495E" stroke-width="1.8" />
          <circle cx="70" cy="70" r="6.7" fill="#00D2FC" opacity="0.35" />
          <path d="M 67.5 68.5 A 5 5 0 0 1 72.5 67.5" fill="none" stroke="#FFFFFF" stroke-width="0.8" stroke-linecap="round" />
          <circle cx="76" cy="75" r="4.5" fill="#FFFFFF" stroke="#E67E22" stroke-width="1.2" />
        </g>
      </svg>
    `;

    const SHIBA_SOLDOUT_SVG = `
      <svg viewBox="0 0 100 100" width="72" height="72" xmlns="http://www.w3.org/2000/svg" style="display: block;">
        <style>
          @keyframes sleep {
            0%, 100% { transform: translateY(0px) scaleY(1); }
            50% { transform: translateY(1.5px) scaleY(0.97); }
          }
          @keyframes z1 {
            0% { opacity: 0; transform: translate(62px, 42px) scale(0.6); }
            30% { opacity: 1; transform: translate(68px, 32px) scale(0.9); }
            100% { opacity: 0; transform: translate(74px, 18px) scale(1.2); }
          }
          @keyframes z2 {
            0% { opacity: 0; transform: translate(70px, 38px) scale(0.6); }
            30% { opacity: 1; transform: translate(75px, 28px) scale(0.9); }
            100% { opacity: 0; transform: translate(80px, 14px) scale(1.2); }
          }
          .sleep-shiba {
            animation: sleep 3s infinite ease-in-out;
            transform-origin: 50px 80px;
          }
          .zzz-1 {
            animation: z1 3s infinite linear;
          }
          .zzz-2 {
            animation: z2 3s infinite linear 1.5s;
          }
        </style>
        <g class="sleep-shiba">
          <!-- Ears -->
          <path d="M 28 42 L 18 16 L 42 30 Z" fill="#E67E22" />
          <path d="M 29 39 L 21 21 L 39 30 Z" fill="#FFD1DC" />
          <path d="M 72 42 L 82 16 L 58 30 Z" fill="#E67E22" />
          <path d="M 71 39 L 79 21 L 61 30 Z" fill="#FFD1DC" />

          <!-- Head Base -->
          <circle cx="50" cy="58" r="23" fill="#E67E22" />
          <!-- Cheeks & Muzzle -->
          <ellipse cx="37" cy="63" rx="12" ry="9" fill="#FFFFFF" />
          <ellipse cx="63" cy="63" rx="12" ry="9" fill="#FFFFFF" />
          <ellipse cx="50" cy="65" rx="9" ry="6" fill="#FFFFFF" />
          
          <!-- Eyebrows -->
          <ellipse cx="39" cy="46" rx="4" ry="2.2" fill="#FFFFFF" />
          <ellipse cx="61" cy="46" rx="4" ry="2.2" fill="#FFFFFF" />

          <!-- Eyes (Sleeping curves) -->
          <path d="M 35 52 Q 40 56 43 52" stroke="#2C3E50" stroke-width="2.2" fill="none" stroke-linecap="round" />
          <path d="M 57 52 Q 60 56 65 52" stroke="#2C3E50" stroke-width="2.2" fill="none" stroke-linecap="round" />

          <!-- Blush -->
          <circle cx="31" cy="57" r="2" fill="#FF8A9A" opacity="0.6" />
          <circle cx="69" cy="57" r="2" fill="#FF8A9A" opacity="0.6" />

          <!-- Nose & Mouth -->
          <ellipse cx="50" cy="59.5" rx="2.5" ry="1.6" fill="#2C3E50" />
          <path d="M 48 63.5 Q 50 61.5 52 63.5" stroke="#2C3E50" stroke-width="1.2" fill="none" stroke-linecap="round" />

          <!-- Detective Hat -->
          <path d="M 33 34 C 33 19, 67 19, 67 34 Z" fill="#7D5C45" opacity="0.85" />
          <path d="M 31 34 Q 50 31 69 34 L 69 36 Q 50 33 31 36 Z" fill="#E65C40" opacity="0.85" />
          <path d="M 28 38 Q 50 35 72 38 C 70 33, 30 33, 28 38 Z" fill="#6A4B35" opacity="0.85" />
          <circle cx="50" cy="14" r="2.8" fill="#E65C40" opacity="0.85" />
        </g>

        <!-- Zzz Bubbles -->
        <text class="zzz-1" font-family="'Outfit', sans-serif" font-weight="bold" font-size="10" fill="#E2E8F0">Z</text>
        <text class="zzz-2" font-family="'Outfit', sans-serif" font-weight="bold" font-size="13" fill="#A0AEC0">z</text>
      </svg>
    `;

    const SHIBA_AVAILABLE_SVG = `
      <svg viewBox="0 0 100 100" width="72" height="72" xmlns="http://www.w3.org/2000/svg" style="display: block;">
        <style>
          @keyframes happyBounce {
            0% { transform: translateY(0px); }
            100% { transform: translateY(-4px); }
          }
          @keyframes earFlapL {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(-8deg); }
          }
          @keyframes earFlapR {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(8deg); }
          }
          @keyframes star1 {
            0%, 100% { transform: scale(0.4) rotate(0deg); opacity: 0; }
            50% { transform: scale(1) rotate(90deg); opacity: 1; }
          }
          .happy-shiba {
            animation: happyBounce 0.3s infinite alternate ease-in-out;
            transform-origin: 50px 80px;
          }
          .happy-ear-l {
            animation: earFlapL 0.15s infinite alternate ease-in-out;
            transform-origin: 30px 42px;
          }
          .happy-ear-r {
            animation: earFlapR 0.15s infinite alternate ease-in-out;
            transform-origin: 70px 42px;
          }
          .happy-star-1 {
            animation: star1 1.2s infinite ease-in-out;
            transform-origin: 20px 25px;
          }
          .happy-star-2 {
            animation: star1 1.2s infinite ease-in-out 0.6s;
            transform-origin: 80px 25px;
          }
        </style>

        <!-- Stars -->
        <path class="happy-star-1" d="M 20 17 L 22 22 L 27 20 L 23 24 L 25 29 L 20 25 L 15 29 L 17 24 L 13 20 L 18 22 Z" fill="#FFD700" />
        <path class="happy-star-2" d="M 80 17 L 82 22 L 87 20 L 83 24 L 85 29 L 80 25 L 75 29 L 77 24 L 73 20 L 78 22 Z" fill="#FFD700" />

        <g class="happy-shiba">
          <!-- Ears -->
          <g class="happy-ear-l">
            <path d="M 28 42 L 18 16 L 42 30 Z" fill="#E67E22" />
            <path d="M 29 39 L 21 21 L 39 30 Z" fill="#FFD1DC" />
          </g>
          <g class="happy-ear-r">
            <path d="M 72 42 L 82 16 L 58 30 Z" fill="#E67E22" />
            <path d="M 71 39 L 79 21 L 61 30 Z" fill="#FFD1DC" />
          </g>

          <!-- Head Base -->
          <circle cx="50" cy="57" r="23" fill="#E67E22" />
          <!-- Cheeks & Muzzle -->
          <ellipse cx="37" cy="62" rx="12" ry="9" fill="#FFFFFF" />
          <ellipse cx="63" cy="62" rx="12" ry="9" fill="#FFFFFF" />
          <ellipse cx="50" cy="64" rx="9" ry="6" fill="#FFFFFF" />
          
          <!-- Eyebrows -->
          <ellipse cx="39" cy="45" rx="4" ry="2.2" fill="#FFFFFF" />
          <ellipse cx="61" cy="45" rx="4" ry="2.2" fill="#FFFFFF" />

          <!-- Eyes (Happy arches) -->
          <path d="M 35 52 Q 40 47 43 52" stroke="#2C3E50" stroke-width="2.5" fill="none" stroke-linecap="round" />
          <path d="M 57 52 Q 60 47 65 52" stroke="#2C3E50" stroke-width="2.5" fill="none" stroke-linecap="round" />

          <!-- Blush -->
          <circle cx="30" cy="57" r="3" fill="#FF527B" opacity="0.8" />
          <circle cx="70" cy="57" r="3" fill="#FF527B" opacity="0.8" />

          <!-- Nose & Happy Open Mouth -->
          <path d="M 45 62.5 Q 50 72 55 62.5 Z" fill="#E76F51" stroke="#2C3E50" stroke-width="1.5" />
          <path d="M 47.5 62.5 C 48.5 63.5, 49.5 63.5, 50 62.5 C 50.5 63.5, 51.5 63.5, 52.5 62.5" stroke="#2C3E50" stroke-width="1.2" fill="none" stroke-linecap="round" />
          <ellipse cx="50" cy="60" rx="2.5" ry="1.6" fill="#2C3E50" />

          <!-- Detective Hat -->
          <path d="M 33 34 C 33 19, 67 19, 67 34 Z" fill="#7D5C45" />
          <path d="M 31 34 Q 50 31 69 34 L 69 36 Q 50 33 31 36 Z" fill="#E65C40" />
          <path d="M 28 38 Q 50 35 72 38 C 70 33, 30 33, 28 38 Z" fill="#6A4B35" />
          <circle cx="50" cy="14" r="2.8" fill="#E65C40" />
        </g>
      </svg>
    `;

    if (status === 'SOLD_OUT') {
      ticketStatusBadge.classList.add('soldout');
      ticketStatusBadge.innerHTML = `${SHIBA_SOLDOUT_SVG}<span>아직 품절</span>`;
      heroStatusText.textContent = '아직 구매 가능한 신호가 없습니다.';
      return;
    }

    if (status === 'AVAILABLE') {
      ticketStatusBadge.classList.add('available');
      const optionText = availableOptions.length > 0 ? ` · ${availableOptions.join(', ')}` : '';
      ticketStatusBadge.innerHTML = `${SHIBA_AVAILABLE_SVG}<span>구매 가능${optionText}</span>`;
      heroStatusText.textContent = '구매 가능 상태가 감지됐습니다.';
      return;
    }

    ticketStatusBadge.classList.add('unknown');
    ticketStatusBadge.innerHTML = `${SHIBA_UNKNOWN_SVG}<span>확인하는 중</span>`;
    heroStatusText.textContent = '페이지 상태를 확인하는 중입니다.';
  }

  function renderOptionsList(allOptions) {
    const container = document.getElementById('options-list-container');
    if (!container) {
      return;
    }

    container.innerHTML = '';
    if (!allOptions || allOptions.length === 0) {
      return;
    }

    allOptions.forEach((opt) => {
      const chip = document.createElement('span');
      chip.className = `option-chip ${opt.isAvailable ? 'available' : 'soldout'}`;

      const icon = document.createElement('i');
      icon.className = opt.isAvailable ? 'fa-solid fa-circle-check' : 'fa-solid fa-lock';

      const textNode = document.createTextNode(` ${String(opt.text || '').trim()}`);

      chip.appendChild(icon);
      chip.appendChild(textNode);
      container.appendChild(chip);
    });
  }

  function updatePushUI() {
    if (currentSubscription) {
      pushStatusLabel.textContent = '연동 완료';
      pushStatusLabel.className = 'push-label-badge active';
      pushToggleBtn.innerHTML = '<i class="fa-regular fa-bell-slash"></i><span>알림 끄기</span>';
      testPushBtn.disabled = false;
      updatePushOnboardingUI();
      renderPostSaveAlertHint();
      return;
    }

    pushStatusLabel.textContent = '비활성화';
    pushStatusLabel.className = 'push-label-badge';
    pushToggleBtn.innerHTML = '<i class="fa-regular fa-bell"></i><span>알림 켜기</span>';
    testPushBtn.disabled = true;
    updatePushOnboardingUI();
    renderPostSaveAlertHint();
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  pushToggleBtn.addEventListener('click', async () => {
    if (!serviceWorkerReg || isBtnLocked) {
      return;
    }

    isBtnLocked = true;
    pushToggleBtn.disabled = true;

    try {
      if (currentSubscription) {
        const success = await currentSubscription.unsubscribe();
        if (success) {
          currentSubscription = null;
        }
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          throw new Error('브라우저 알림 권한이 거부되었습니다.');
        }

        const response = await fetch('/api/vapid-public-key');
        const { publicKey } = await response.json();
        const applicationServerKey = urlBase64ToUint8Array(publicKey);

        currentSubscription = await serviceWorkerReg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey
        });
      }

      updatePushUI();
      await saveSettings();
    } catch (error) {
      alert(`알림 설정 중 오류가 발생했습니다. ${error.message}`);
    } finally {
      isBtnLocked = false;
      pushToggleBtn.disabled = false;
    }
  });

  if (pushOnboardingAction) {
    pushOnboardingAction.addEventListener('click', () => {
      const state = getPushState();
      if (state === 'inactive') {
        pushToggleBtn.click();
        return;
      }

      if (state === 'blocked') {
        switchTab('history-pane');
      }
    });
  }

  // 사용자가 설정을 변경하기 시작하면 자동 갱신으로 덮어써지지 않도록 플래그 설정
  const inputsToTrack = [
    settingsUrl,
    settingsKeyword,
    settingsCssSelector,
    intervalInput,
    alertRepeatCountInput,
    alertRepeatIntervalInput
  ];
  inputsToTrack.forEach(input => {
    if (input) {
      input.addEventListener('input', () => {
        hasUnsavedChanges = true;
      });
    }
  });

  const conditionRadios = document.querySelectorAll('input[name="settings-condition"]');
  conditionRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      hasUnsavedChanges = true;
    });
  });

  settingsUrl.addEventListener('input', () => {
    resetDetectionFieldsForNewTarget(false);
  });

  function renderDiagnosticCard(data, conditionVal) {
    const statusClass = !data.success ? 'error' : data.isKeywordFound ? 'success' : 'warning';
    const statusLabel = !data.success ? '테스트 실패' : data.isKeywordFound ? '감지 조건 확인' : '확인 필요';
    const iconClass = !data.success ? 'fa-circle-exclamation' : data.isKeywordFound ? 'fa-circle-check' : 'fa-triangle-exclamation';
    const conditionLabel = conditionVal === 'appear' ? '문구가 나타나면 알림' : '문구가 사라지면 알림';
    const accessibleLabel = data.isAccessible === false ? '접근 실패' : `접근 성공${data.statusCode ? ` (${data.statusCode})` : ''}`;
    const keywordLabel = data.isKeywordFound ? '문구 발견됨' : '문구 미발견';
    const nextAction = !data.success
      ? 'URL 또는 사이트 접근 제한을 확인하세요.'
      : data.isKeywordFound
        ? '이 설정으로 저장 및 시작할 수 있습니다.'
        : '문구, 조건, 옵션 필터를 다시 확인하세요.';

    diagnosticResult.className = `diagnostic-card ${statusClass}`;
    diagnosticResult.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'diagnostic-card-header';
    header.innerHTML = `<i class="fa-solid ${iconClass}"></i><span>${statusLabel}</span>`;

    const body = document.createElement('div');
    body.className = 'diagnostic-card-body';

    [
      ['URL 접근', accessibleLabel],
      ['문구 상태', keywordLabel],
      ['알림 조건', conditionLabel],
      ['다음 행동', nextAction],
      ['상세 결과', data.message || '진단 결과 메시지가 없습니다.']
    ].forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'diagnostic-row';

      const labelEl = document.createElement('span');
      labelEl.textContent = label;

      const valueEl = document.createElement('strong');
      valueEl.textContent = value;

      row.appendChild(labelEl);
      row.appendChild(valueEl);
      body.appendChild(row);
    });

    diagnosticResult.appendChild(header);
    diagnosticResult.appendChild(body);
  }

  checkFeasibilityBtn.addEventListener('click', async () => {
    if (resetDetectionFieldsForNewTarget(true)) {
      return;
    }

    const targetUrlVal = settingsUrl.value.trim();
    const keywordVal = settingsKeyword.value.trim();
    const cssSelectorVal = settingsCssSelector.value.trim();

    if (!targetUrlVal || !keywordVal) {
      diagnosticResult.className = 'diagnostic-result warning';
      diagnosticResult.textContent = '진단을 위해 대상 URL과 새 페이지에 맞는 상태 키워드를 입력해 주세요.';
      if (!targetUrlVal) {
        settingsUrl.focus();
      } else {
        settingsKeyword.focus();
      }
      return;
    }

    if (isBtnLocked) {
      return;
    }

    isBtnLocked = true;
    checkFeasibilityBtn.disabled = true;
    checkFeasibilityBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>테스트 중</span>';
    diagnosticResult.textContent = '';
    diagnosticResult.className = 'diagnostic-result hide';

    try {
      const conditionEl = document.querySelector('input[name="settings-condition"]:checked');
      const conditionVal = conditionEl ? conditionEl.value : 'disappear';

      const response = await fetch('/api/check-site', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          clientId: clientId,
          targetUrl: targetUrlVal,
          keyword: keywordVal,
          cssSelector: cssSelectorVal,
          condition: conditionVal
        })
      });

      if (!response.ok) {
        throw new Error('서버 통신에 실패했습니다.');
      }

      const data = await response.json();
      renderDiagnosticCard(data, conditionVal);
    } catch (error) {
      diagnosticResult.classList.remove('hide');
      diagnosticResult.className = 'diagnostic-result error';
      diagnosticResult.textContent = `진단 오류가 발생했습니다. ${error.message}`;
    } finally {
      isBtnLocked = false;
      checkFeasibilityBtn.disabled = false;
      checkFeasibilityBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i><span>정상 작동하는지 테스트해보기</span>';
    }
  });

  async function saveSettings() {
    const targetUrlVal = settingsUrl.value.trim();
    const keywordVal = settingsKeyword.value.trim();
    const cssSelectorVal = settingsCssSelector.value.trim();
    const conditionVal = document.querySelector('input[name="settings-condition"]:checked').value;
    const intervalVal = parseInt(intervalInput.value, 10) || 30;

    if (!targetUrlVal || !keywordVal) {
      throw new Error('감시 URL과 상태 키워드를 모두 입력해 주세요.');
    }

    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        clientId: clientId,
        targetUrl: targetUrlVal,
        keyword: keywordVal,
        cssSelector: cssSelectorVal,
        condition: conditionVal,
        intervalSeconds: intervalVal,
        alertRepeatCount: parseInt(alertRepeatCountInput.value, 10) || 1,
        alertRepeatIntervalSeconds: parseInt(alertRepeatIntervalInput.value, 10) || 30,
        subscription: currentSubscription,
        deviceInfo: currentSubscription ? getClientDeviceInfo() : null
      })
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || '설정 저장에 실패했습니다.');
    }

    hasUnsavedChanges = false;
    await updateStatus();
  }

  saveSettingsBtn.addEventListener('click', async () => {
    if (isBtnLocked) {
      return;
    }

    isBtnLocked = true;
    saveSettingsBtn.disabled = true;
    saveSettingsBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>저장 중</span>';

    try {
      await saveSettings();
      shouldShowPostSaveAlertHint = true;
      renderPostSaveAlertHint();
      alert('알림 설정을 저장하고 감시를 시작했습니다.');
    } catch (error) {
      alert(`설정 저장 실패. ${error.message}`);
    } finally {
      isBtnLocked = false;
      saveSettingsBtn.disabled = false;
      saveSettingsBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i><span>알림 감시 설정 저장 및 시작</span>';
    }
  });

  toggleMonitorBtn.addEventListener('click', async () => {
    if (isBtnLocked) {
      return;
    }

    isBtnLocked = true;
    toggleMonitorBtn.disabled = true;

    const isRunning = toggleMonitorBtn.classList.contains('running');
    const endpoint = isRunning ? '/api/stop' : '/api/start';

    try {
      const response = await fetch(`${endpoint}?clientId=${clientId}`, { method: 'POST' });
      if (!response.ok) {
        throw new Error('상태 제어 요청에 실패했습니다.');
      }
      await updateStatus();
    } catch (error) {
      alert(`모니터링 제어 실패. ${error.message}`);
    } finally {
      isBtnLocked = false;
      toggleMonitorBtn.disabled = false;
    }
  });

  testPushBtn.addEventListener('click', async () => {
    if (!currentSubscription || isBtnLocked) {
      return;
    }

    isBtnLocked = true;
    testPushBtn.disabled = true;
    testPushBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>발송 중</span>';

    try {
      const response = await fetch('/api/test-push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          clientId: clientId,
          subscription: currentSubscription 
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '테스트 알림 발송에 실패했습니다.');
      }
    } catch (error) {
      alert(`테스트 알림 오류. ${error.message}`);
    } finally {
      isBtnLocked = false;
      testPushBtn.disabled = false;
      testPushBtn.innerHTML = '<i class="fa-regular fa-paper-plane"></i><span>테스트</span>';
      updatePushUI();
    }
  });

  function renderLastCheckTime() {
    if (!localLastCheckTime || !localFormattedCheckTime) {
      return;
    }
    const diffMs = Date.now() - localLastCheckTime;
    const diffSec = Math.floor(diffMs / 1000);

    let relativeText = '';
    if (diffSec < 5) {
      relativeText = '방금 전';
    } else if (diffSec < 60) {
      relativeText = `${diffSec}초 전`;
    } else {
      const min = Math.floor(diffSec / 60);
      const sec = diffSec % 60;
      relativeText = `${min}분 ${sec}초 전`;
    }

    lastCheckTime.textContent = `${localFormattedCheckTime} (${relativeText})`;
    renderNextCheckTime();
  }

  // 상대 시간을 실시간으로 1초마다 업데이트
  setInterval(renderLastCheckTime, 1000);
  setInterval(renderNextCheckTime, 1000);

  // 알림 반복 횟수에 따라 간격 필드 활성화/비활성화
  function updateRepeatIntervalState() {
    const count = parseInt(alertRepeatCountInput.value, 10) || 1;
    const intervalLabel = alertRepeatIntervalInput.closest('label');
    if (count <= 1) {
      alertRepeatIntervalInput.disabled = true;
      if (intervalLabel) intervalLabel.style.opacity = '0.45';
    } else {
      alertRepeatIntervalInput.disabled = false;
      if (intervalLabel) intervalLabel.style.opacity = '1';
    }
  }
  alertRepeatCountInput.addEventListener('input', updateRepeatIntervalState);
  updateRepeatIntervalState();

  // 감지 이력 조회 및 렌더링 함수들
  async function updateHistory() {
    if (!historyListContainer) return;
    try {
      const response = await fetch(`/api/history?clientId=${clientId}`);
      if (!response.ok) {
        throw new Error('이력 데이터를 불러올 수 없습니다.');
      }
      const history = await response.json();
      renderHistory(history);
    } catch (error) {
      console.error('[대시보드] 이력 업데이트 실패.', error);
    }
  }

  function renderHistory(history) {
    if (!historyListContainer) return;
    
    if (!history || history.length === 0) {
      historyListContainer.innerHTML = `
        <div class="empty-history">
          <i class="fa-solid fa-clock-rotate-left" style="font-size: 1.5rem; margin-bottom: 8px; color: var(--subtle);"></i>
          <div>감지된 품절 해제 이력이 없습니다.</div>
        </div>
      `;
      return;
    }

    historyListContainer.innerHTML = '';
    history.forEach(item => {
      const historyItem = document.createElement('div');
      historyItem.className = 'history-item';

      const header = document.createElement('div');
      header.className = 'history-item-header';
      
      const timeSpan = document.createElement('span');
      timeSpan.className = 'history-time';
      const itemDate = new Date(item.timestamp);
      timeSpan.textContent = isNaN(itemDate.getTime()) ? item.formattedTime : itemDate.toLocaleString();

      const badge = document.createElement('span');
      badge.className = 'history-badge';
      badge.innerHTML = `<i class="fa-solid fa-circle-check"></i><span>품절 해제</span>`;

      header.appendChild(badge);
      header.appendChild(timeSpan);

      const body = document.createElement('div');
      body.className = 'history-item-body';
      
      const shortUrl = item.targetUrl ? item.targetUrl.substring(0, 50) + (item.targetUrl.length > 50 ? '...' : '') : '링크 없음';
      body.innerHTML = `<div><strong>대상 주소:</strong> <a href="${item.targetUrl}" target="_blank" style="color: var(--accent); text-decoration: none;">${shortUrl}</a></div>`;

      historyItem.appendChild(header);
      historyItem.appendChild(body);

      if (item.detectedOptions && item.detectedOptions.length > 0) {
        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'history-item-options';
        
        item.detectedOptions.forEach(opt => {
          const optTag = document.createElement('span');
          optTag.className = 'history-option-tag';
          optTag.textContent = opt;
          optionsContainer.appendChild(optTag);
        });
        historyItem.appendChild(optionsContainer);
      }

      historyListContainer.appendChild(historyItem);
    });
  }

  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', async () => {
      if (confirm('모든 감시 이력을 삭제하시겠습니까? (삭제된 이력은 복구되지 않습니다)')) {
        try {
          const response = await fetch(`/api/history/clear?clientId=${clientId}`, { method: 'POST' });
          if (!response.ok) {
            throw new Error('이력 비우기에 실패했습니다.');
          }
          await updateHistory();
        } catch (error) {
          alert(`이력 삭제 실패. ${error.message}`);
        }
      }
    });
  }

  updateStatus();
  setInterval(updateStatus, 4000);
});
