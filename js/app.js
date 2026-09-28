/*
 * 方案管理器 + UI。
 * 职责：
 *   - 自动选择：依据 detect() 的支持级别选择现代/降级方案
 *   - 手动切换：处理冲突（不支持时阻止、部分支持时警告并允许尝试）
 *   - 初始化失败：自动降级到另一方案，并记录原因
 *   - 运行时切换：先安全销毁旧实现再初始化新实现，全程 try/catch
 *   - 持久化：方案偏好与历史记录写入 localStorage，刷新后保持
 */
(function () {
  'use strict';

  var defs = window.FeatureDefs;
  var store = window.CompatStore;
  var prefs = store.loadPrefs();

  var SCHEME_LABEL = { modern: '现代方案', legacy: '降级方案' };
  var LEVEL_LABEL = { full: '完全支持', partial: '部分支持', none: '不支持' };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /* ---------------- 历史记录 ---------------- */

  function record(entry) {
    entry.time = new Date().toLocaleString();
    store.addHistory(entry);
    renderHistory();
  }

  function renderHistory() {
    var list = document.getElementById('history-list');
    var items = store.loadHistory();
    list.innerHTML = '';
    if (!items.length) {
      list.appendChild(el('li', 'empty', '暂无记录'));
      return;
    }
    items.forEach(function (e) {
      var li = document.createElement('li');
      [
        ['h-time', e.time],
        ['h-feature', e.feature],
        ['h-action', e.action],
        ['h-flow', (e.from || '-') + ' → ' + (e.to || '-')],
        ['h-reason', e.reason]
      ].forEach(function (pair) {
        li.appendChild(el('span', pair[0], pair[1]));
      });
      list.appendChild(li);
    });
  }

  /* ---------------- 方案激活（含初始化失败降级） ---------------- */

  function activate(rt, scheme, reason, tried) {
    tried = tried || {};
    tried[scheme] = true;

    // 1. 安全销毁旧实现：任何异常都不能影响后续切换
    if (rt.handle && typeof rt.handle.destroy === 'function') {
      try { rt.handle.destroy(); } catch (e) { /* 忽略销毁异常 */ }
    }
    rt.handle = null;
    rt.els.demo.innerHTML = '';
    rt.els.status.className = 'status';
    rt.els.status.textContent = '';
    rt.els.conflict.hidden = true;

    rt.activating = true;
    rt.scheme = scheme;
    rt.reason = reason;
    render(rt);

    // 2. 初始化新实现（同步/异步统一走 Promise，失败即降级）
    Promise.resolve()
      .then(function () { return rt.def.schemes[scheme].init(rt.api); })
      .then(function (handle) {
        rt.handle = handle || {};
        rt.activating = false;
        render(rt);
      })
      .catch(function (err) {
        var msg = (err && err.message) || String(err);
        var other = scheme === 'modern' ? 'legacy' : 'modern';
        record({
          feature: rt.def.name,
          action: '初始化失败降级',
          from: SCHEME_LABEL[scheme],
          to: SCHEME_LABEL[other],
          reason: SCHEME_LABEL[scheme] + '初始化失败：' + msg
        });
        // 手动偏好同步为实际生效方案，保证刷新后不再重复失败
        if (prefs[rt.def.id] && prefs[rt.def.id].mode === 'manual') {
          prefs[rt.def.id].scheme = other;
          store.savePrefs(prefs);
        }
        if (!tried[other]) {
          activate(rt, other,
            SCHEME_LABEL[scheme] + '初始化失败（' + msg + '），已自动降级', tried);
        } else {
          rt.activating = false;
          rt.scheme = null;
          rt.reason = '两种方案均初始化失败，该功能暂不可用';
          render(rt);
        }
      });
  }

  /* ---------------- 自动选择 ---------------- */

  function autoSelect(rt) {
    var s = rt.support;
    var scheme;
    var reason;
    if (s.level === 'full') {
      scheme = 'modern';
      reason = '浏览器完全支持该特性，自动使用现代方案';
    } else if (s.level === 'partial') {
      scheme = 'legacy';
      reason = '部分支持（' + s.detail + '），自动降级';
    } else {
      scheme = 'legacy';
      reason = '不支持（' + s.detail + '），自动使用降级方案';
    }
    if (s.level !== 'full') {
      record({
        feature: rt.def.name,
        action: '自动降级',
        from: '-',
        to: SCHEME_LABEL[scheme],
        reason: reason
      });
    }
    activate(rt, scheme, reason);
  }

  /* ---------------- 手动切换（含冲突处理） ---------------- */

  function manualSwitch(rt, target, customReason) {
    var s = rt.support;

    // 冲突 1：目标方案完全不受支持 → 阻止切换并提示
    if (target === 'modern' && s.level === 'none') {
      rt.els.conflict.hidden = false;
      rt.els.conflict.textContent =
        '切换冲突：' + s.detail + '，现代方案不可用，已保持当前方案。';
      record({
        feature: rt.def.name,
        action: '手动切换冲突',
        from: SCHEME_LABEL[rt.scheme] || '-',
        to: '现代方案',
        reason: '目标方案不受支持：' + s.detail
      });
      return;
    }

    if (target === rt.scheme && !customReason) return;

    // 冲突 2：目标方案仅部分支持 → 警告但允许尝试，失败会自动回退
    var warn = (target === 'modern' && s.level === 'partial')
      ? '；警告：浏览器仅部分支持，可能初始化失败并自动回退'
      : '';

    prefs[rt.def.id] = { mode: 'manual', scheme: target };
    store.savePrefs(prefs);
    record({
      feature: rt.def.name,
      action: '手动切换',
      from: SCHEME_LABEL[rt.scheme] || '-',
      to: SCHEME_LABEL[target],
      reason: (customReason || '用户手动切换') + warn
    });
    activate(rt, target, (customReason || '用户手动选择') + warn);
  }

  /* ---------------- 卡片构建与渲染 ---------------- */

  function buildCard(rt) {
    var def = rt.def;
    var card = el('section', 'card');

    var head = el('div', 'card-head');
    head.appendChild(el('h2', null, def.icon + ' ' + def.name));
    var badges = el('div', 'badges');
    var supportBadge = el('span', 'badge support');
    var schemeBadge = el('span', 'badge scheme');
    var modeBadge = el('span', 'badge mode');
    badges.appendChild(supportBadge);
    badges.appendChild(schemeBadge);
    badges.appendChild(modeBadge);
    head.appendChild(badges);
    card.appendChild(head);

    var supportDetail = el('p', 'support-detail');
    var reason = el('p', 'reason');
    var conflict = el('p', 'conflict');
    conflict.hidden = true;
    card.appendChild(supportDetail);
    card.appendChild(reason);
    card.appendChild(conflict);

    var controls = el('div', 'controls');
    var toggle = el('button');
    toggle.type = 'button';
    var auto = el('button', 'secondary', '恢复自动选择');
    auto.type = 'button';
    controls.appendChild(toggle);
    controls.appendChild(auto);
    card.appendChild(controls);

    var status = el('div', 'status');
    var demo = el('div', 'demo');
    card.appendChild(status);
    card.appendChild(demo);

    var compare = el('details', 'compare');
    compare.appendChild(el('summary', null, '方案差异对比'));
    var table = document.createElement('table');
    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    ['对比项', '现代方案', '降级方案'].forEach(function (t) {
      headRow.appendChild(el('th', null, t));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    def.compare.forEach(function (row) {
      var tr = document.createElement('tr');
      ['aspect', 'modern', 'legacy'].forEach(function (key) {
        tr.appendChild(el('td', null, row[key]));
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    compare.appendChild(table);
    card.appendChild(compare);

    rt.els = {
      card: card,
      supportBadge: supportBadge,
      schemeBadge: schemeBadge,
      modeBadge: modeBadge,
      supportDetail: supportDetail,
      reason: reason,
      conflict: conflict,
      toggle: toggle,
      auto: auto,
      status: status,
      demo: demo
    };

    toggle.addEventListener('click', function () {
      manualSwitch(rt, rt.scheme === 'modern' ? 'legacy' : 'modern');
    });
    auto.addEventListener('click', function () {
      delete prefs[rt.def.id];
      store.savePrefs(prefs);
      record({
        feature: rt.def.name,
        action: '恢复自动',
        from: SCHEME_LABEL[rt.scheme] || '-',
        to: '自动选择',
        reason: '用户恢复自动选择，重新按浏览器能力检测'
      });
      autoSelect(rt);
    });

    document.getElementById('features').appendChild(card);
  }

  function render(rt) {
    var s = rt.support;
    var manual = prefs[rt.def.id] && prefs[rt.def.id].mode === 'manual';

    rt.els.supportBadge.textContent = LEVEL_LABEL[s.level];
    rt.els.supportBadge.className = 'badge support ' + s.level;
    rt.els.supportDetail.textContent = '检测结果：' + s.detail;

    rt.els.schemeBadge.textContent = rt.scheme ? SCHEME_LABEL[rt.scheme] : '不可用';
    rt.els.schemeBadge.className = 'badge scheme ' + (rt.scheme || 'pending');

    rt.els.modeBadge.textContent = manual ? '手动' : '自动';

    rt.els.reason.textContent = rt.reason ? '当前方案说明：' + rt.reason : '';

    rt.els.toggle.textContent = rt.scheme === 'modern' ? '切换到降级方案' : '切换到现代方案';
    rt.els.toggle.disabled = rt.activating || !rt.scheme;
    rt.els.auto.style.display = manual ? '' : 'none';
  }

  /* ---------------- 初始化 ---------------- */

  defs.forEach(function (def) {
    var rt = {
      def: def,
      support: def.detect(),
      scheme: null,
      handle: null,
      reason: '',
      activating: false,
      els: {}
    };

    rt.api = {
      get mount() { return rt.els.demo; },
      setStatus: function (msg) {
        rt.els.status.className = 'status';
        rt.els.status.textContent = msg;
      },
      runtimeError: function (msg, suggestFallback) {
        rt.els.status.className = 'status error';
        rt.els.status.textContent = '运行时错误：' + msg;
        record({
          feature: rt.def.name,
          action: '运行时错误',
          from: SCHEME_LABEL[rt.scheme] || '-',
          to: '-',
          reason: msg
        });
        if (suggestFallback && rt.scheme === 'modern') {
          var btn = el('button', 'fallback-btn', '改用降级方案');
          btn.type = 'button';
          btn.addEventListener('click', function () {
            manualSwitch(rt, 'legacy', '运行时错误后手动降级');
          });
          rt.els.status.appendChild(btn);
        }
      }
    };

    buildCard(rt);

    var pref = prefs[def.id];
    if (pref && pref.mode === 'manual' &&
        (pref.scheme === 'modern' || pref.scheme === 'legacy')) {
      // 刷新后恢复上次手动方案；若环境变化导致冲突则回退为自动
      if (pref.scheme === 'modern' && rt.support.level === 'none') {
        record({
          feature: def.name,
          action: '恢复冲突',
          from: '-',
          to: '自动选择',
          reason: '上次手动选择的现代方案当前不受支持，已回退为自动选择'
        });
        delete prefs[def.id];
        store.savePrefs(prefs);
        autoSelect(rt);
      } else {
        record({
          feature: def.name,
          action: '恢复方案',
          from: '-',
          to: SCHEME_LABEL[pref.scheme],
          reason: '刷新后恢复上次手动选择的方案'
        });
        activate(rt, pref.scheme, '刷新后恢复上次手动选择的方案');
      }
    } else {
      autoSelect(rt);
    }
  });

  document.getElementById('reset-btn').addEventListener('click', function () {
    store.clearAll();
    location.reload();
  });
  document.getElementById('clear-history').addEventListener('click', function () {
    store.clearHistory();
    renderHistory();
  });

  renderHistory();
})();
