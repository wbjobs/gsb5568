import { Support } from './detect.js';

const PREF_KEY = 'gsb.featurePrefs.v1';
const HISTORY_KEY = 'gsb.switchHistory.v1';
const HISTORY_LIMIT = 100;

function readJSON(key, fallbackValue) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallbackValue;
  } catch (e) {
    return fallbackValue;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* 存储不可用时仅保留内存态 */
  }
}

export class FeatureManager {
  constructor(features) {
    this.features = features;
    this.prefs = readJSON(PREF_KEY, {});
    this.history = readJSON(HISTORY_KEY, []);
    this.states = new Map();
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  emit() {
    this.listeners.forEach((fn) => fn());
  }

  getState(id) {
    return this.states.get(id);
  }

  recordHistory(entry) {
    this.history.unshift({ time: new Date().toISOString(), ...entry });
    if (this.history.length > HISTORY_LIMIT) this.history.length = HISTORY_LIMIT;
    writeJSON(HISTORY_KEY, this.history);
  }

  clearHistory() {
    this.history = [];
    writeJSON(HISTORY_KEY, this.history);
    this.emit();
  }

  savePref(id, pref) {
    if (pref) this.prefs[id] = pref;
    else delete this.prefs[id];
    writeJSON(PREF_KEY, this.prefs);
  }

  async initAll(mountFor) {
    for (const feature of this.features) {
      const support = feature.detect();
      const pref = this.prefs[feature.id];
      let mode;
      let reason = '';
      let auto = true;

      if (pref && pref.manual) {
        if (pref.mode === 'modern' && support.level === Support.NONE) {
          mode = 'fallback';
          reason = '保存的手动选择（现代方案）与当前环境冲突：' + support.reason + '，已自动降级';
          this.recordHistory({
            feature: feature.name, from: 'modern(手动)', to: 'fallback',
            trigger: 'conflict', reason,
          });
        } else {
          mode = pref.mode;
          auto = false;
          reason = '用户手动选择（刷新后保持）';
        }
      } else if (support.level === Support.FULL) {
        mode = 'modern';
        reason = '环境完全支持，自动选择现代方案';
      } else {
        mode = 'fallback';
        reason = support.reason || '现代方案不可用，自动降级';
      }

      const state = {
        feature, support, mode, auto, reason,
        status: 'pending', impl: null, runtimeNote: '',
      };
      this.states.set(feature.id, state);
      await this.activate(state, mountFor(feature.id));
    }
    this.emit();
  }

  async activate(state, mount) {
    const { feature } = state;
    const plan = feature[state.mode];
    mount.innerHTML = '';
    try {
      state.impl = await plan.init(mount);
      state.status = state.mode === 'modern' ? 'ok' : 'degraded';
    } catch (err) {
      const failReason = '「' + plan.label + '」初始化失败：' + (err && err.message ? err.message : String(err));
      if (state.mode === 'modern') {
        state.reason = failReason + '，已自动降级';
        state.mode = 'fallback';
        state.auto = true;
        this.recordHistory({
          feature: feature.name, from: 'modern', to: 'fallback',
          trigger: 'init-failure', reason: failReason,
        });
        mount.innerHTML = '';
        try {
          state.impl = await feature.fallback.init(mount);
          state.status = 'degraded';
        } catch (err2) {
          state.status = 'unavailable';
          state.reason = failReason + '；降级方案也失败：' + (err2 && err2.message ? err2.message : String(err2));
          mount.innerHTML = '';
        }
      } else {
        state.status = 'unavailable';
        state.reason = failReason;
        mount.innerHTML = '';
      }
    }
  }

  async switchTo(id, targetMode, mount) {
    const state = this.states.get(id);
    if (!state || state.mode === targetMode) return { ok: true };

    if (targetMode === 'modern' && state.support.level === Support.NONE) {
      const reason = '冲突：当前环境不支持现代方案（' + (state.support.reason || '检测不通过') + '），已阻止切换';
      this.recordHistory({
        feature: state.feature.name, from: state.mode, to: 'modern(被拒绝)',
        trigger: 'conflict', reason,
      });
      this.emit();
      return { ok: false, conflict: reason };
    }

    const prevMode = state.mode;
    const prevImpl = state.impl;
    let warning = '';
    if (targetMode === 'modern' && state.support.level === Support.PARTIAL) {
      warning = '警告：环境仅部分支持现代方案（' + state.support.reason + '），已按手动要求强制切换';
    }

    try {
      if (prevImpl && typeof prevImpl.destroy === 'function') prevImpl.destroy();
    } catch (e) {
      /* 旧实例销毁失败不阻断切换 */
    }
    state.impl = null;
    state.mode = targetMode;
    state.auto = false;
    state.reason = warning || '用户手动切换';
    state.runtimeNote = '';
    await this.activate(state, mount);

    if (state.status === 'unavailable' && targetMode === 'modern') {
      state.mode = prevMode;
      state.reason = '现代方案初始化失败，已回退到「' + state.feature[prevMode].label + '」';
      await this.activate(state, mount);
    }

    this.savePref(id, { mode: state.mode, manual: true });
    this.recordHistory({
      feature: state.feature.name, from: prevMode, to: state.mode,
      trigger: 'manual', reason: warning || '用户手动切换',
    });
    this.emit();
    return { ok: true, warning };
  }

  async resetToAuto(id, mount) {
    const state = this.states.get(id);
    if (!state) return;
    this.savePref(id, null);
    const support = state.feature.detect();
    state.support = support;
    const target = support.level === Support.FULL ? 'modern' : 'fallback';
    try {
      if (state.impl && typeof state.impl.destroy === 'function') state.impl.destroy();
    } catch (e) { /* ignore */ }
    state.impl = null;
    state.mode = target;
    state.auto = true;
    state.reason = support.level === Support.FULL
      ? '环境完全支持，自动选择现代方案'
      : (support.reason || '现代方案不可用，自动降级');
    await this.activate(state, mount);
    this.recordHistory({
      feature: state.feature.name, from: 'manual', to: target,
      trigger: 'auto', reason: '恢复自动选择',
    });
    this.emit();
  }
}
