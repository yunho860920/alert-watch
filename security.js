const dns = require('dns').promises;
const { URL } = require('url');

/**
 * IPv4 주소가 사설/루프백 대역인지 판단합니다.
 */
function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(isNaN)) return false;

  // 127.0.0.0/8 (Loopback)
  if (parts[0] === 127) return true;
  // 10.0.0.0/8 (Private)
  if (parts[0] === 10) return true;
  // 172.16.0.0/12 (Private)
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0/16 (Private)
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 169.254.0.0/16 (Link-local)
  if (parts[0] === 169 && parts[1] === 254) return true;
  // 0.0.0.0/8 (Current network)
  if (parts[0] === 0) return true;

  return false;
}

/**
 * IPv6 주소가 사설/루프백 대역인지 판단합니다.
 */
function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase().trim();

  // 루프백
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  // 미지정 주소
  if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;
  // ULA (Unique Local Address, fc00::/7)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  // Link-Local (fe80::/10)
  if (/^fe[89ab]/i.test(normalized)) return true;

  // IPv4-mapped IPv6 주소 (예: ::ffff:192.168.1.1)
  if (normalized.startsWith('::ffff:')) {
    const ipv4Part = normalized.substring(7);
    if (ipv4Part.includes('.')) {
      return isPrivateIPv4(ipv4Part);
    } else {
      const hexParts = ipv4Part.split(':');
      if (hexParts.length === 2) {
        const high = parseInt(hexParts[0], 16);
        const low = parseInt(hexParts[1], 16);
        if (!isNaN(high) && !isNaN(low)) {
          const ip4 = `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
          return isPrivateIPv4(ip4);
        }
      }
    }
  }

  return false;
}

/**
 * IP 주소가 사설/루프백/링크로컬 대역에 속하는지 검증합니다.
 */
function isPrivateIP(ip) {
  if (!ip) return false;
  if (ip.includes('.')) {
    return isPrivateIPv4(ip);
  }
  if (ip.includes(':')) {
    return isPrivateIPv6(ip);
  }
  return false;
}

/**
 * SSRF(Server-Side Request Forgery)를 차단하기 위해 입력받은 URL을 정밀 검증합니다.
 */
async function validateUrlForSsrf(urlString) {
  try {
    const parsed = new URL(urlString);

    // http, https 프로토콜만 허용
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, reason: 'HTTP/HTTPS 프로토콜만 지원합니다.' };
    }

    const hostname = parsed.hostname;
    if (!hostname) {
      return { valid: false, reason: '유효한 호스트명이 아닙니다.' };
    }

    const lowerHost = hostname.toLowerCase();
    // 호스트명 자체 검사 (localhost 등 직접적인 접근 차단)
    if (
      lowerHost === 'localhost' ||
      lowerHost === 'localhost.localdomain' ||
      lowerHost === 'loopback' ||
      lowerHost.endsWith('.local')
    ) {
      return { valid: false, reason: '로컬 네트워크 대역에 접근할 수 없습니다.' };
    }

    // IP 검사
    // 만약 호스트네임이 이미 IP 형태라면 DNS 룩업 없이 바로 매칭 검사
    if (isPrivateIP(hostname)) {
      return { valid: false, reason: '허용되지 않는 사설 IP 주소입니다.' };
    }

    // DNS 확인
    let addresses = [];
    try {
      // 호스트네임의 모든 IP 버전을 찾음
      const lookupResults = await dns.resolve(hostname).catch(async () => {
        // DNS resolve 실패 시 dns.lookup으로 로컬 hosts 파일 등 조회 재시도
        const lookup = await dns.lookup(hostname, { all: true });
        return lookup.map(l => l.address);
      });
      addresses = Array.isArray(lookupResults) ? lookupResults : [lookupResults];
    } catch (e) {
      // 주소 해석이 전혀 불가능한 도메인은 보안상 차단 처리
      return { valid: false, reason: '도메인 주소 해석 실패 (존재하지 않거나 올바르지 않은 호스트명)' };
    }

    for (const addr of addresses) {
      if (isPrivateIP(addr)) {
        return { valid: false, reason: '조회 주소가 사설 또는 루프백 IP 대역에 바인딩되어 접근이 금지되었습니다.' };
      }
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, reason: '올바른 URL 형식이 아닙니다.' };
  }
}

/**
 * clientId 인자의 포맷이 안전한지 검사합니다.
 */
function isValidClientId(clientId) {
  if (typeof clientId !== 'string') return false;
  return clientId === 'legacy_default_user' || /^client_[a-z0-9]+_\d+$/.test(clientId);
}

module.exports = {
  validateUrlForSsrf,
  isValidClientId,
  isPrivateIP
};
