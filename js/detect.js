export const Support = { FULL: 'full', PARTIAL: 'partial', NONE: 'none' };

export const SupportLabel = {
  full: '完全支持',
  partial: '部分支持',
  none: '不支持',
};

function canUseLocalStorage() {
  try {
    const key = '__gsb_probe__';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return true;
  } catch (e) {
    return false;
  }
}

export function detectAnimation() {
  const el = document.createElement('div');
  if (typeof el.animate === 'function') {
    return { level: Support.FULL, reason: '' };
  }
  if (typeof requestAnimationFrame === 'function' || typeof setInterval === 'function') {
    return {
      level: Support.PARTIAL,
      reason: '不支持 Web Animations API（element.animate），降级为定时器逐帧驱动样式',
    };
  }
  return { level: Support.NONE, reason: '既无 Web Animations API 也无定时器能力' };
}

export function detectStorage() {
  if (typeof indexedDB !== 'undefined' && indexedDB !== null) {
    return { level: Support.FULL, reason: '' };
  }
  if (canUseLocalStorage()) {
    return {
      level: Support.PARTIAL,
      reason: 'IndexedDB 不可用（可能被禁用或处于隐私模式），降级为 localStorage（容量小、仅同步 API）',
    };
  }
  return { level: Support.NONE, reason: 'IndexedDB 与 localStorage 均不可用' };
}

export function detectNotification() {
  if (!('Notification' in window)) {
    return { level: Support.NONE, reason: '浏览器不支持 Notification API，降级为页面内 Toast 提示' };
  }
  if (Notification.permission === 'denied') {
    return {
      level: Support.PARTIAL,
      reason: '通知权限已被用户拒绝，现代方案运行时仍会失败，建议使用降级方案',
    };
  }
  return { level: Support.FULL, reason: '' };
}

export function detectGeolocation() {
  if (!('geolocation' in navigator)) {
    return { level: Support.NONE, reason: '浏览器不支持 Geolocation API，降级为手动输入坐标' };
  }
  if (window.isSecureContext === false) {
    return {
      level: Support.PARTIAL,
      reason: '当前不是安全上下文（非 HTTPS/localhost），定位调用会被浏览器拦截',
    };
  }
  return { level: Support.FULL, reason: '' };
}

export function detectClipboard() {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return { level: Support.FULL, reason: '' };
  }
  if (typeof document.execCommand === 'function') {
    return {
      level: Support.PARTIAL,
      reason: 'Clipboard API 不可用（通常因非安全上下文），降级为 textarea + execCommand("copy")',
    };
  }
  return { level: Support.NONE, reason: 'Clipboard API 与 execCommand 均不可用' };
}
