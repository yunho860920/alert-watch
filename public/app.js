// 백엔드 API와 통신해 감시 상태, 설정 저장, 브라우저 알림을 제어하는 스크립트
document.addEventListener('DOMContentLoaded', async () => {
  const monitoringPulse = document.getElementById('monitoring-pulse');
  const monitoringText = document.getElementById('monitoring-text');
  const ticketStatusBadge = document.getElementById('ticket-status-badge');
  const heroStatusText = document.getElementById('hero-status-text');
  const lastCheckTime = document.getElementById('last-check-time');
  const checkInterval = document.getElementById('check-interval');
  const registeredDevices = document.getElementById('registered-devices');
  const toggleMonitorBtn = document.getElementById('toggle-monitor-btn');

  const settingsUrl = document.getElementById('settings-url');
  const settingsKeyword = document.getElementById('settings-keyword');
  const settingsCssSelector = document.getElementById('settings-css-selector');
  const checkFeasibilityBtn = document.getElementById('check-feasibility-btn');
  const saveSettingsBtn = document.getElementById('save-settings-btn');
  const intervalInput = document.getElementById('settings-interval');
  const diagnosticResult = document.getElementById('diagnostic-result');

  const pushStatusLabel = document.getElementById('push-status-label');
  const pushToggleBtn = document.getElementById('push-toggle-btn');
  const testPushBtn = document.getElementById('test-push-btn');

  let isBtnLocked = false;
  let serviceWorkerReg = null;
  let currentSubscription = null;
  let lastKnownTargetUrl = '';
  let detectionFieldsResetForUrl = '';
  let lastRawCheckTime = '';
  let localFormattedCheckTime = '';
  let localLastCheckTime = null;

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

  if ('serviceWorker' in navigator && 'PushManager' in window) {
    try {
      serviceWorkerReg = await navigator.serviceWorker.register('/sw.js');
      currentSubscription = await serviceWorkerReg.pushManager.getSubscription();
      updatePushUI();
    } catch (error) {
      console.error('[서비스워커] 등록 실패.', error);
      pushStatusLabel.textContent = '지원 안 됨';
      pushToggleBtn.disabled = true;
    }
  } else {
    pushStatusLabel.textContent = '지원 안 됨';
    pushToggleBtn.disabled = true;
  }

  async function updateStatus() {
    try {
      const response = await fetch('/api/status');
      if (!response.ok) {
        throw new Error('상태 정보를 불러오지 못했습니다.');
      }

      const data = await response.json();
      const currentTargetUrl = normalizeUrl(settingsUrl.value);
      const receivedTargetUrl = normalizeUrl(data.targetUrl);
      const isNewTargetDraft = currentTargetUrl && receivedTargetUrl && currentTargetUrl !== receivedTargetUrl;

      if (receivedTargetUrl) {
        lastKnownTargetUrl = receivedTargetUrl;
      }

      setMonitoringState(data.isMonitoring);
      updateStatusBadge(data.lastStatus, data.availableOptions);
      renderOptionsList(data.allOptions);

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
      checkInterval.textContent = `${data.intervalSeconds || '-'}초`;
      registeredDevices.textContent = `${data.registeredDevicesCount || 0}대`;

      if (!settingsUrl.value && data.targetUrl) {
        settingsUrl.value = data.targetUrl;
      }
      if (!isNewTargetDraft && !settingsKeyword.value && data.keyword) {
        settingsKeyword.value = data.keyword;
      }
      if (!isNewTargetDraft && !settingsCssSelector.value && data.cssSelector) {
        settingsCssSelector.value = data.cssSelector;
      }
      if (!isNewTargetDraft && data.condition) {
        const radioCondition = document.getElementById(`condition-${data.condition}`);
        if (radioCondition) {
          radioCondition.checked = true;
        }
      }
      if (!isNewTargetDraft && intervalInput.value === '30' && data.intervalSeconds) {
        intervalInput.value = data.intervalSeconds;
      }
    } catch (error) {
      console.error('[대시보드] 상태 업데이트 실패.', error);
      monitoringPulse.classList.remove('active');
      monitoringText.textContent = '연결 실패';
      toggleMonitorBtn.className = 'primary-action neutral';
      toggleMonitorBtn.innerHTML = '<i class="fa-solid fa-rotate"></i><span>다시 확인</span>';
      updateStatusBadge('UNKNOWN');
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
    if (isMonitoring) {
      monitoringPulse.classList.add('active');
      monitoringText.textContent = '감시 중';
      toggleMonitorBtn.className = 'primary-action stop running';
      toggleMonitorBtn.innerHTML = '<i class="fa-solid fa-square"></i><span>감시 일시중지</span>';
      return;
    }

    monitoringPulse.classList.remove('active');
    monitoringText.textContent = '일시중지';
    toggleMonitorBtn.className = 'primary-action neutral';
    toggleMonitorBtn.innerHTML = '<i class="fa-solid fa-play"></i><span>감시 시작</span>';
  }

  function updateStatusBadge(status, availableOptions = []) {
    ticketStatusBadge.className = 'badge';

    if (status === 'SOLD_OUT') {
      ticketStatusBadge.classList.add('soldout');
      ticketStatusBadge.innerHTML = '<i class="fa-solid fa-lock"></i><span>아직 품절</span>';
      heroStatusText.textContent = '아직 구매 가능한 신호가 없습니다.';
      return;
    }

    if (status === 'AVAILABLE') {
      ticketStatusBadge.classList.add('available');
      const optionText = availableOptions.length > 0 ? ` · ${availableOptions.join(', ')}` : '';
      ticketStatusBadge.innerHTML = `<i class="fa-solid fa-circle-check"></i><span>구매 가능${optionText}</span>`;
      heroStatusText.textContent = '구매 가능 상태가 감지됐습니다.';
      return;
    }

    ticketStatusBadge.classList.add('unknown');
    ticketStatusBadge.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i><span>확인하는 중</span>';
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
      pushStatusLabel.className = 'active';
      pushToggleBtn.innerHTML = '<i class="fa-regular fa-bell-slash"></i><span>알림 끄기</span>';
      testPushBtn.disabled = false;
      return;
    }

    pushStatusLabel.textContent = '비활성화';
    pushStatusLabel.className = '';
    pushToggleBtn.innerHTML = '<i class="fa-regular fa-bell"></i><span>알림 켜기</span>';
    testPushBtn.disabled = true;
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

  settingsUrl.addEventListener('input', () => {
    resetDetectionFieldsForNewTarget(false);
  });

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
      diagnosticResult.classList.remove('hide');
      diagnosticResult.textContent = data.message;

      if (!data.success) {
        diagnosticResult.className = 'diagnostic-result error';
      } else if (data.isKeywordFound) {
        diagnosticResult.className = 'diagnostic-result success';
      } else {
        diagnosticResult.className = 'diagnostic-result warning';
      }
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
        targetUrl: targetUrlVal,
        keyword: keywordVal,
        cssSelector: cssSelectorVal,
        condition: conditionVal,
        intervalSeconds: intervalVal,
        subscription: currentSubscription
      })
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || '설정 저장에 실패했습니다.');
    }

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
      const response = await fetch(endpoint, { method: 'POST' });
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
        body: JSON.stringify({ subscription: currentSubscription })
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
  }

  // 상대 시간을 실시간으로 1초마다 업데이트
  setInterval(renderLastCheckTime, 1000);

  updateStatus();
  setInterval(updateStatus, 4000);
});
