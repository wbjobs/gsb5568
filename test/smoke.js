'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const BASE = require('path').join(__dirname, '..', 'js');

/* ---------- 最小 DOM shim ---------- */
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.className = '';
    this._text = '';
    this.style = {};
    this.listeners = {};
    this.parentNode = null;
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.type = '';
  }
  set textContent(v) { this._text = String(v); this.children.length = 0; }
  get textContent() {
    return this._text + this.children.map(c => c.textContent).join('');
  }
  set innerHTML(v) {
    if (v !== '') throw new Error('shim only supports innerHTML=""');
    this.children.length = 0;
  }
  get innerHTML() { return ''; }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  click() { (this.listeners.click || []).forEach(f => f()); }
  focus() {} select() {}
  getContext() { return { clearRect() {}, beginPath() {}, arc() {}, fill() {}, fillStyle: null }; }
}

function walk(el, pred, out) {
  out = out || [];
  if (pred(el)) out.push(el);
  el.children.forEach(c => walk(c, pred, out));
  return out;
}
const byClass = (root, cls) => walk(root, e => (e.className || '').split(' ').includes(cls));
const byText = (root, tag, text) => walk(root, e => e.tagName === tag.toUpperCase() && e.textContent.includes(text));

function makeLocalStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _map: m
  };
}

function makeEnv(opts) {
  const registry = {};
  ['features', 'history-list', 'reset-btn', 'clear-history'].forEach(id => {
    const e = new El('div'); e.id = id; registry[id] = e;
  });
  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL, Blob, Promise,
    document: { createElement: t => new El(t), getElementById: id => registry[id] },
    localStorage: opts.localStorage || makeLocalStorage(),
    navigator: {},
    isSecureContext: true,
    location: { reload() { sandbox.__reloaded = true; } },
    __registry: registry
  };
  sandbox.window = sandbox;

  if (opts.raf) {
    sandbox.requestAnimationFrame = () => 1;
    sandbox.cancelAnimationFrame = () => {};
  }
  if (opts.worker) {
    sandbox.Worker = class { constructor() {} postMessage() {} terminate() {} };
  }
  if (opts.notification) {
    const N = function () {};
    N.permission = opts.notificationPerm || 'granted';
    N.requestPermission = cb => { if (cb) cb(N.permission); return Promise.resolve(N.permission); };
    sandbox.Notification = N;
  }
  if (opts.geolocation) {
    sandbox.navigator.geolocation = {
      getCurrentPosition(ok, err) {
        setTimeout(() => (opts.geoFails ? err(new Error('用户拒绝了定位请求')) : ok({ coords: { latitude: 1, longitude: 2, accuracy: 10 } })), 0);
      }
    };
  }
  if (opts.clipboard) {
    sandbox.navigator.clipboard = { writeText: () => Promise.resolve() };
  }
  if (opts.indexedDB) {
    sandbox.indexedDB = {
      open() {
        const req = {};
        setTimeout(() => {
          if (opts.idbFails) {
            req.error = new Error('隐私模式下 IndexedDB 被禁用');
            req.onerror && req.onerror();
            return;
          }
          const idbReq = result => {
            const r = { result };
            setTimeout(() => r.onsuccess && r.onsuccess(), 0);
            return r;
          };
          const db = {
            transaction: () => ({ objectStore: () => ({ getAll: () => idbReq([]), add: () => idbReq(), clear: () => idbReq() }) }),
            close() {}
          };
          req.result = { createObjectStore() {} };
          req.onupgradeneeded && req.onupgradeneeded();
          req.result = db;
          req.onsuccess && req.onsuccess();
        }, 0);
        return req;
      }
    };
  }
  vm.createContext(sandbox);
  ['store.js', 'features.js', 'app.js'].forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(BASE, f), 'utf8'), sandbox, { filename: f });
  });
  return sandbox;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  PASS', name); }
  else { failures++; console.log('  FAIL', name, extra || ''); }
}
const cardsOf = env => env.__registry['features'].children;
const badgeOf = (card, cls) => walk(card, e => e.tagName === 'SPAN' && String(e.className || '').split(' ').includes(cls))[0];
const historyOf = env => JSON.parse(env.localStorage.getItem('compat-history-v1') || '[]');

(async () => {
  /* ===== 环境 A：完全支持 ===== */
  console.log('\n[环境 A] 完全支持：自动选择 + 手动切换 + 刷新保持 + 运行时错误');
  const envA = makeEnv({ raf: true, worker: true, notification: true, geolocation: true, geoFails: true, clipboard: true, indexedDB: true });
  await sleep(50);
  const cardsA = cardsOf(envA);
  check('5 个功能卡片已渲染', cardsA.length === 5);
  check('全部自动选择现代方案', cardsA.every(c => badgeOf(c, 'scheme').textContent === '现代方案'));
  check('全部为自动模式', cardsA.every(c => badgeOf(c, 'mode').textContent === '自动'));

  // 手动切换动画 -> 降级
  const animCard = cardsA[0];
  byClass(animCard, 'controls')[0].children[0].click();
  await sleep(30);
  check('手动切换动画到降级方案生效', badgeOf(animCard, 'scheme').textContent === '降级方案');
  check('模式变为手动', badgeOf(animCard, 'mode').textContent === '手动');
  const prefsA = JSON.parse(envA.localStorage.getItem('compat-schemes-v1'));
  check('方案偏好已持久化', prefsA.animation && prefsA.animation.scheme === 'legacy' && prefsA.animation.mode === 'manual');

  // 运行时连续切换不崩
  let crashed = false;
  try {
    for (let i = 0; i < 6; i++) { byClass(animCard, 'controls')[0].children[0].click(); await sleep(10); }
  } catch (e) { crashed = true; }
  await sleep(50);
  check('运行时连续切换 6 次未崩溃', !crashed);

  // 运行时错误：定位失败 -> 错误提示 + 改用降级方案按钮
  const geoCard = cardsA[3];
  byText(geoCard, 'button', '获取当前位置')[0].click();
  await sleep(30);
  const statusEl = byClass(geoCard, 'status')[0];
  check('定位运行时错误已展示', statusEl.className.includes('error') && statusEl.textContent.includes('运行时错误'));
  check('运行时错误已记录', historyOf(envA).some(h => h.action === '运行时错误'));
  const fbBtn = byClass(geoCard, 'fallback-btn')[0];
  check('提供“改用降级方案”入口', !!fbBtn);
  fbBtn.click();
  await sleep(30);
  check('运行时错误后手动降级生效', badgeOf(geoCard, 'scheme').textContent === '降级方案');
  check('降级原因已记录', historyOf(envA).some(h => h.reason.includes('运行时错误后手动降级')));

  // 刷新保持：同一 localStorage 重新加载
  const envA2 = makeEnv({ raf: true, worker: true, notification: true, geolocation: true, clipboard: true, indexedDB: true, localStorage: envA.localStorage });
  await sleep(50);
  const cardsA2 = cardsOf(envA2);
  check('刷新后动画保持手动降级方案', badgeOf(cardsA2[0], 'scheme').textContent === '降级方案' && badgeOf(cardsA2[0], 'mode').textContent === '手动');
  check('刷新后地理位置保持手动降级方案', badgeOf(cardsA2[3], 'scheme').textContent === '降级方案');
  check('刷新后历史记录保留', historyOf(envA2).length > 0);
  check('恢复动作已记录', historyOf(envA2).some(h => h.action === '恢复方案'));

  // 恢复自动
  byClass(cardsA2[0], 'controls')[0].children[1].click();
  await sleep(30);
  check('恢复自动选择生效', badgeOf(cardsA2[0], 'scheme').textContent === '现代方案' && badgeOf(cardsA2[0], 'mode').textContent === '自动');

  /* ===== 环境 B：IndexedDB 初始化失败 ===== */
  console.log('\n[环境 B] IndexedDB 初始化失败：自动降级');
  const envB = makeEnv({ raf: true, worker: true, notification: true, geolocation: true, clipboard: true, indexedDB: true, idbFails: true });
  await sleep(60);
  const storageCardB = cardsOf(envB)[1];
  check('存储初始化失败后自动降级', badgeOf(storageCardB, 'scheme').textContent === '降级方案');
  check('初始化失败降级已记录原因', historyOf(envB).some(h => h.action === '初始化失败降级' && h.reason.includes('隐私模式')));
  check('降级原因展示在卡片上', byClass(storageCardB, 'reason')[0].textContent.includes('初始化失败'));

  /* ===== 环境 C：全部不支持 ===== */
  console.log('\n[环境 C] 全部不支持：自动降级 + 手动切换冲突');
  const envC = makeEnv({});
  await sleep(50);
  const cardsC = cardsOf(envC);
  check('全部自动使用降级方案', cardsC.every(c => badgeOf(c, 'scheme').textContent === '降级方案'));
  check('支持度标记为不支持/部分支持', cardsC.every(c => ['不支持', '部分支持'].includes(badgeOf(c, 'support').textContent)));
  check('自动降级原因已记录', historyOf(envC).some(h => h.action === '自动降级'));

  // 手动切换冲突：动画 -> 现代（不支持，应被阻止）
  const animCardC = cardsC[0];
  byClass(animCardC, 'controls')[0].children[0].click();
  await sleep(30);
  check('冲突时保持降级方案不变', badgeOf(animCardC, 'scheme').textContent === '降级方案');
  const conflictEl = byClass(animCardC, 'conflict')[0];
  check('冲突提示已展示', conflictEl.hidden === false && conflictEl.textContent.includes('切换冲突'));
  check('冲突已记录', historyOf(envC).some(h => h.action === '手动切换冲突'));

  // 部分支持冲突：存储 -> 现代（允许尝试，初始化失败后自动回退）
  const storageCardC = cardsC[1];
  check('存储为部分支持', badgeOf(storageCardC, 'support').textContent === '部分支持');
  byClass(storageCardC, 'controls')[0].children[0].click();
  await sleep(50);
  check('部分支持时尝试现代方案失败后自动回退', badgeOf(storageCardC, 'scheme').textContent === '降级方案');
  check('部分支持警告已记录', historyOf(envC).some(h => h.action === '手动切换' && h.reason.includes('部分支持')));
  check('回退已记录', historyOf(envC).some(h => h.action === '初始化失败降级'));

  // 差异对比表存在
  check('方案差异对比表已渲染', cardsC.every(c => walk(c, e => e.tagName === 'TBODY').length === 1 && walk(c, e => e.tagName === 'TBODY')[0].children.length >= 4));

  console.log(failures === 0 ? '\n全部通过 ✔' : `\n${failures} 项失败 ✘`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常：', e); process.exit(1); });
