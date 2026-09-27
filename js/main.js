import { features } from './features.js';
import { FeatureManager } from './manager.js';
import { SupportLabel } from './detect.js';

const manager = new FeatureManager(features);
const mounts = new Map();
const cardRefs = new Map();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function statusText(state) {
  if (state.status === 'ok') return '现代方案运行中';
  if (state.status === 'degraded') return '降级方案运行中';
  if (state.status === 'unavailable') return '不可用';
  return '初始化中…';
}

function renderState(id) {
  const state = manager.getState(id);
  const refs = cardRefs.get(id);
  if (!state || !refs) return;

  refs.supportBadge.textContent = SupportLabel[state.support.level];
  refs.supportBadge.className = 'badge support-' + state.support.level;

  refs.planBadge.textContent = statusText(state) + (state.auto ? '（自动）' : '（手动）');
  refs.planBadge.className = 'badge plan-' + state.status;

  refs.planLabel.textContent = state.feature[state.mode]
    ? '当前方案：' + state.feature[state.mode].label
    : '当前方案：无';
  refs.reason.textContent = state.reason ? '原因：' + state.reason : '';

  refs.modernBtn.disabled = state.mode === 'modern' || state.status === 'pending';
  refs.fallbackBtn.disabled = state.mode === 'fallback' || state.status === 'pending';
}

function renderHistory() {
  const list = document.getElementById('history-list');
  list.innerHTML = '';
  if (manager.history.length === 0) {
    list.appendChild(el('li', 'history-empty', '暂无切换记录'));
    return;
  }
  const triggerLabel = {
    auto: '自动', manual: '手动', conflict: '冲突处理',
    'init-failure': '初始化失败降级',
  };
  manager.history.forEach((h) => {
    const li = el('li', 'history-item');
    const time = new Date(h.time).toLocaleString();
    li.textContent =
      '[' + time + '] ' + h.feature + '：' + h.from + ' → ' + h.to +
      '（' + (triggerLabel[h.trigger] || h.trigger) + '）' + (h.reason ? ' — ' + h.reason : '');
    list.appendChild(li);
  });
}

function buildCard(feature) {
  const card = el('section', 'card');
  card.id = 'card-' + feature.id;

  const head = el('div', 'card-head');
  const title = el('h2', 'card-title', feature.name);
  const supportBadge = el('span', 'badge', '');
  const planBadge = el('span', 'badge', '');
  head.appendChild(title);
  head.appendChild(supportBadge);
  head.appendChild(planBadge);
  card.appendChild(head);

  const planLabel = el('p', 'plan-label', '');
  const reason = el('p', 'reason', '');
  card.appendChild(planLabel);
  card.appendChild(reason);

  const msg = el('p', 'conflict-msg');
  msg.hidden = true;
  card.appendChild(msg);

  const controls = el('div', 'controls');
  const modernBtn = el('button', 'btn', '切换到现代方案');
  const fallbackBtn = el('button', 'btn', '切换到降级方案');
  const autoBtn = el('button', 'btn btn-ghost', '恢复自动选择');
  const diffBtn = el('button', 'btn btn-ghost', '方案差异对比');
  controls.appendChild(modernBtn);
  controls.appendChild(fallbackBtn);
  controls.appendChild(autoBtn);
  controls.appendChild(diffBtn);
  card.appendChild(controls);

  const demo = el('div', 'demo');
  card.appendChild(demo);
  mounts.set(feature.id, demo);

  const diffWrap = el('div', 'diff');
  diffWrap.hidden = true;
  const table = el('table', 'diff-table');
  const headRow = document.createElement('tr');
  ['对比项', '现代方案（' + feature.modern.label + '）', '降级方案（' + feature.fallback.label + '）']
    .forEach((t) => {
      const th = document.createElement('th');
      th.textContent = t;
      headRow.appendChild(th);
    });
  table.appendChild(headRow);
  feature.diff.forEach(([aspect, modern, fallback]) => {
    const tr = document.createElement('tr');
    [aspect, modern, fallback].forEach((t) => {
      const td = document.createElement('td');
      td.textContent = t;
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  diffWrap.appendChild(table);
  card.appendChild(diffWrap);

  modernBtn.onclick = async () => {
    msg.hidden = true;
    const result = await manager.switchTo(feature.id, 'modern', demo);
    if (!result.ok) {
      msg.textContent = result.conflict;
      msg.hidden = false;
    } else if (result.warning) {
      msg.textContent = result.warning;
      msg.hidden = false;
    }
  };
  fallbackBtn.onclick = async () => {
    msg.hidden = true;
    await manager.switchTo(feature.id, 'fallback', demo);
  };
  autoBtn.onclick = async () => {
    msg.hidden = true;
    await manager.resetToAuto(feature.id, demo);
  };
  diffBtn.onclick = () => {
    diffWrap.hidden = !diffWrap.hidden;
    diffBtn.textContent = diffWrap.hidden ? '方案差异对比' : '收起差异对比';
  };

  cardRefs.set(feature.id, { supportBadge, planBadge, planLabel, reason, modernBtn, fallbackBtn });
  return card;
}

async function boot() {
  const app = document.getElementById('app');
  const envInfo = document.getElementById('env-info');
  envInfo.textContent =
    'User-Agent：' + navigator.userAgent +
    ' ｜ 安全上下文：' + (window.isSecureContext ? '是' : '否') +
    ' ｜ Worker：' + (typeof Worker !== 'undefined' ? '支持' : '不支持');

  features.forEach((f) => app.appendChild(buildCard(f)));

  document.getElementById('clear-history').onclick = () => manager.clearHistory();
  manager.onChange(() => {
    features.forEach((f) => renderState(f.id));
    renderHistory();
  });

  await manager.initAll((id) => mounts.get(id));
}

boot();
