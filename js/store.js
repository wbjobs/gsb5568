/* 持久化层：方案偏好与切换历史，均存于 localStorage，保证刷新后方案保持。 */
window.CompatStore = (function () {
  'use strict';

  var PREF_KEY = 'compat-schemes-v1';
  var HIST_KEY = 'compat-history-v1';
  var MAX_HISTORY = 200;

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  return {
    loadPrefs: function () { return read(PREF_KEY, {}); },
    savePrefs: function (prefs) { write(PREF_KEY, prefs); },
    loadHistory: function () { return read(HIST_KEY, []); },
    addHistory: function (entry) {
      var list = read(HIST_KEY, []);
      list.unshift(entry);
      if (list.length > MAX_HISTORY) list = list.slice(0, MAX_HISTORY);
      write(HIST_KEY, list);
      return list;
    },
    clearHistory: function () {
      try { localStorage.removeItem(HIST_KEY); } catch (e) { /* 忽略 */ }
    },
    clearAll: function () {
      try {
        localStorage.removeItem(PREF_KEY);
        localStorage.removeItem(HIST_KEY);
      } catch (e) { /* 忽略 */ }
    }
  };
})();
