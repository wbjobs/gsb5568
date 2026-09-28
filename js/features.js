/*
 * 功能注册表。
 * 每个功能包含：
 *   detect()  -> { level: 'full' | 'partial' | 'none', detail: 检测说明 }
 *   schemes.modern / schemes.legacy -> { label, init(api) }
 *     init 返回 { destroy() } 或其 Promise；初始化失败请抛错/reject，
 *     由方案管理器捕获并自动降级。
 *   compare   -> 方案差异对比表数据
 *
 * api:
 *   mount           演示区 DOM 容器
 *   setStatus(msg)  设置演示区状态提示
 *   runtimeError(msg, suggestFallback)
 *                   报告运行时错误；suggestFallback 为 true 时提供
 *                   “改用降级方案”入口（不自动切换，避免运行期崩溃）
 */
window.FeatureDefs = (function () {
  'use strict';

  /* ---------------- 工具函数 ---------------- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function makeButton(text) {
    var btn = el('button', null, text);
    btn.type = 'button';
    return btn;
  }

  function localStorageWorks() {
    try {
      localStorage.setItem('__compat_probe__', '1');
      localStorage.removeItem('__compat_probe__');
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------------- 1. 动画 ---------------- */

  var animation = {
    id: 'animation',
    name: '动画',
    icon: '\uD83C\uDF9E\uFE0F',

    detect: function () {
      var raf = typeof window.requestAnimationFrame === 'function';
      var worker = typeof window.Worker === 'function';
      if (raf && worker) {
        return { level: 'full', detail: '支持 requestAnimationFrame 与 Web Worker，可在独立线程计算动画' };
      }
      if (raf || worker) {
        return {
          level: 'partial',
          detail: raf
            ? '支持 requestAnimationFrame，但缺少 Web Worker，物理计算只能占用主线程'
            : '支持 Web Worker，但缺少 requestAnimationFrame，无法与屏幕刷新同步'
        };
      }
      return { level: 'none', detail: '缺少 requestAnimationFrame 与 Web Worker，无法运行现代动画' };
    },

    schemes: {
      modern: {
        label: 'Web Worker + requestAnimationFrame + Canvas',
        init: function (api) {
          return new Promise(function (resolve, reject) {
            var canvas = el('canvas', 'anim-stage');
            canvas.width = 560;
            canvas.height = 200;
            api.mount.appendChild(canvas);

            // 以 Blob 方式创建 Worker（file:// 直接打开页面时也尽量可用）
            var workerSrc =
              'var balls=[{x:10,y:15,vx:9,vy:7,r:5},{x:50,y:30,vx:-7,vy:9,r:6.5},{x:80,y:10,vx:6,vy:-8,r:4}];' +
              'setInterval(function(){' +
              '  for(var i=0;i<balls.length;i++){' +
              '    var b=balls[i];' +
              '    b.x+=b.vx*0.16; b.y+=b.vy*0.16;' +
              '    if(b.x<b.r||b.x>100-b.r){b.vx*=-1;}' +
              '    if(b.y<b.r||b.y>60-b.r){b.vy*=-1;}' +
              '    b.x=Math.max(b.r,Math.min(100-b.r,b.x));' +
              '    b.y=Math.max(b.r,Math.min(60-b.r,b.y));' +
              '  }' +
              '  postMessage(balls);' +
              '},16);';

            var blobUrl;
            var worker;
            try {
              blobUrl = URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' }));
              worker = new Worker(blobUrl);
            } catch (e) {
              reject(new Error('Web Worker 创建失败：' + e.message));
              return;
            }

            var latest = null;
            worker.onmessage = function (ev) { latest = ev.data; };

            var ctx = canvas.getContext('2d');
            var stopped = false;
            var rafId = null;
            var colors = ['#2563eb', '#059669', '#d97706'];

            function frame() {
              if (stopped) return;
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              if (latest) {
                for (var i = 0; i < latest.length; i++) {
                  var b = latest[i];
                  ctx.beginPath();
                  ctx.arc(
                    b.x / 100 * canvas.width,
                    b.y / 60 * canvas.height,
                    b.r / 100 * canvas.width,
                    0, Math.PI * 2
                  );
                  ctx.fillStyle = colors[i % colors.length];
                  ctx.fill();
                }
              }
              rafId = window.requestAnimationFrame(frame);
            }
            frame();

            api.setStatus('现代方案运行中：Web Worker 计算物理，requestAnimationFrame 驱动 Canvas 渲染。');
            resolve({
              destroy: function () {
                stopped = true;
                if (rafId != null) window.cancelAnimationFrame(rafId);
                try { worker.terminate(); } catch (e) { /* 忽略 */ }
                if (blobUrl) URL.revokeObjectURL(blobUrl);
              }
            });
          });
        }
      },

      legacy: {
        label: 'setInterval + DOM 定位',
        init: function (api) {
          var stage = el('div', 'anim-stage anim-stage-dom');
          api.mount.appendChild(stage);

          var balls = [
            { x: 10, y: 15, vx: 5, vy: 4 },
            { x: 50, y: 30, vx: -4, vy: 5 },
            { x: 80, y: 10, vx: 3, vy: -4.5 }
          ];
          var dots = balls.map(function (_, i) {
            var dot = el('div', 'ball b' + i);
            stage.appendChild(dot);
            return dot;
          });

          var timer = setInterval(function () {
            for (var i = 0; i < balls.length; i++) {
              var b = balls[i];
              b.x += b.vx * 0.32;
              b.y += b.vy * 0.32;
              if (b.x < 0 || b.x > 96) b.vx *= -1;
              if (b.y < 0 || b.y > 88) b.vy *= -1;
              b.x = Math.max(0, Math.min(96, b.x));
              b.y = Math.max(0, Math.min(88, b.y));
              dots[i].style.left = b.x + '%';
              dots[i].style.top = b.y + '%';
            }
          }, 33);

          api.setStatus('降级方案运行中：setInterval 定时（约 30fps）+ DOM 定位，计算与渲染均在主线程。');
          return {
            destroy: function () { clearInterval(timer); }
          };
        }
      }
    },

    compare: [
      { aspect: '计算线程', modern: 'Web Worker 独立线程，不阻塞交互', legacy: '主线程，动画与页面操作互相挤占' },
      { aspect: '渲染机制', modern: 'requestAnimationFrame + Canvas，与屏幕刷新率同步', legacy: 'setInterval + DOM 定位，固定间隔重排' },
      { aspect: '流畅度', modern: '掉帧少，通常可达 60fps', legacy: '约 30fps，主线程繁忙时卡顿' },
      { aspect: '功耗', modern: '合成器参与，更省电', legacy: '频繁布局与重绘，更耗电' }
    ]
  };

  /* ---------------- 2. 存储 ---------------- */

  function buildNotesUI(api, backend, statusText) {
    var wrap = el('div', 'notes-ui');
    var row = el('div', 'row');
    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '输入一条记录…';
    var addBtn = makeButton('添加');
    var clearBtn = makeButton('清空');
    row.appendChild(input);
    row.appendChild(addBtn);
    row.appendChild(clearBtn);
    wrap.appendChild(row);

    var list = el('ul', 'notes-list');
    wrap.appendChild(list);
    api.mount.appendChild(wrap);

    function render(items) {
      list.innerHTML = '';
      if (!items.length) {
        list.appendChild(el('li', 'empty', '（暂无记录）'));
        return;
      }
      items.forEach(function (item) {
        list.appendChild(el('li', null, item.text));
      });
    }

    function refresh() {
      backend.load().then(render, function (err) {
        api.runtimeError('读取记录失败：' + err.message, true);
      });
    }

    addBtn.addEventListener('click', function () {
      var value = input.value.trim();
      if (!value) return;
      backend.add(value).then(function () {
        input.value = '';
        refresh();
      }, function (err) {
        api.runtimeError('写入记录失败：' + err.message, true);
      });
    });

    clearBtn.addEventListener('click', function () {
      backend.clear().then(refresh, function (err) {
        api.runtimeError('清空记录失败：' + err.message, false);
      });
    });

    api.setStatus(statusText);
    refresh();
    return { destroy: function () { /* 连接由具体 backend 关闭 */ } };
  }

  var storage = {
    id: 'storage',
    name: '存储',
    icon: '\uD83D\uDCBE',

    detect: function () {
      var idb = 'indexedDB' in window;
      var ls = localStorageWorks();
      if (idb) {
        return { level: 'full', detail: '支持 IndexedDB（隐私模式下可能打开失败，届时将自动降级）' };
      }
      if (ls) {
        return { level: 'partial', detail: 'IndexedDB 不可用，仅 localStorage 可用：容量小、只能存字符串' };
      }
      return { level: 'none', detail: 'IndexedDB 与 localStorage 均不可用（隐私模式或存储被禁用）' };
    },

    schemes: {
      modern: {
        label: 'IndexedDB（对象仓库 + 事务）',
        init: function (api) {
          return new Promise(function (resolve, reject) {
            var request;
            try {
              request = indexedDB.open('compat-demo-db', 1);
            } catch (e) {
              reject(new Error('无法调用 IndexedDB：' + e.message));
              return;
            }
            request.onupgradeneeded = function () {
              request.result.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
            };
            request.onerror = function () {
              reject(new Error(request.error ? request.error.message : 'IndexedDB 打开失败'));
            };
            request.onblocked = function () {
              reject(new Error('IndexedDB 被其他标签页占用'));
            };
            request.onsuccess = function () {
              var db = request.result;
              var backend = {
                load: function () {
                  return new Promise(function (res, rej) {
                    var r = db.transaction('notes').objectStore('notes').getAll();
                    r.onsuccess = function () { res(r.result || []); };
                    r.onerror = function () { rej(r.error || new Error('读取失败')); };
                  });
                },
                add: function (text) {
                  return new Promise(function (res, rej) {
                    var r = db.transaction('notes', 'readwrite')
                      .objectStore('notes')
                      .add({ text: text, time: Date.now() });
                    r.onsuccess = function () { res(); };
                    r.onerror = function () { rej(r.error || new Error('写入失败')); };
                  });
                },
                clear: function () {
                  return new Promise(function (res, rej) {
                    var r = db.transaction('notes', 'readwrite').objectStore('notes').clear();
                    r.onsuccess = function () { res(); };
                    r.onerror = function () { rej(r.error || new Error('清空失败')); };
                  });
                }
              };
              var handle = buildNotesUI(api, backend,
                '现代方案运行中：数据保存在 IndexedDB 对象仓库 notes，事务读写，不阻塞主线程。');
              handle.destroy = function () { try { db.close(); } catch (e) { /* 忽略 */ } };
              resolve(handle);
            };
          });
        }
      },

      legacy: {
        label: 'localStorage（键值字符串）',
        init: function (api) {
          var KEY = 'compat-demo-notes';
          if (!localStorageWorks()) {
            throw new Error('localStorage 不可用（隐私模式或存储被禁用）');
          }
          var backend = {
            load: function () {
              try {
                return Promise.resolve(JSON.parse(localStorage.getItem(KEY) || '[]'));
              } catch (e) {
                return Promise.reject(e);
              }
            },
            add: function (text) {
              try {
                var arr = JSON.parse(localStorage.getItem(KEY) || '[]');
                arr.push({ text: text, time: Date.now() });
                localStorage.setItem(KEY, JSON.stringify(arr));
                return Promise.resolve();
              } catch (e) {
                return Promise.reject(new Error(e.name === 'QuotaExceededError' ? '存储容量超限' : e.message));
              }
            },
            clear: function () {
              try {
                localStorage.removeItem(KEY);
                return Promise.resolve();
              } catch (e) {
                return Promise.reject(e);
              }
            }
          };
          return Promise.resolve(buildNotesUI(api, backend,
            '降级方案运行中：数据以 JSON 字符串保存在 localStorage，同步读写，容量约 5MB。'));
        }
      }
    },

    compare: [
      { aspect: '容量', modern: '通常数百 MB', legacy: '约 5MB' },
      { aspect: '数据结构', modern: '对象仓库、索引、事务、结构化数据', legacy: '仅键值对，值只能是字符串' },
      { aspect: '读写方式', modern: '异步 API，不阻塞页面', legacy: '同步 API，阻塞主线程' },
      { aspect: '适用场景', modern: '大量结构化数据、离线应用', legacy: '少量简单数据（配置、偏好）' }
    ]
  };

  /* ---------------- 3. 通知 ---------------- */

  var notification = {
    id: 'notification',
    name: '通知',
    icon: '\uD83D\uDD14',

    detect: function () {
      if (!('Notification' in window)) {
        return { level: 'none', detail: '浏览器不支持 Notification API' };
      }
      if (Notification.permission === 'denied') {
        return { level: 'partial', detail: 'Notification API 存在，但系统通知权限已被拒绝' };
      }
      if (window.isSecureContext === false) {
        return { level: 'partial', detail: 'Notification API 存在，但当前为非安全上下文，系统通知可能被拦截' };
      }
      return { level: 'full', detail: '支持 Notification API，可发送系统级通知' };
    },

    schemes: {
      modern: {
        label: 'Notification API（系统通知中心）',
        init: function (api) {
          if (!('Notification' in window)) {
            throw new Error('Notification API 不存在');
          }
          if (Notification.permission === 'denied') {
            throw new Error('通知权限已被拒绝，无法初始化系统通知（请到浏览器设置中恢复权限）');
          }

          var btn = makeButton('发送系统通知');
          btn.addEventListener('click', function () {
            function show(permission) {
              if (permission !== 'granted') {
                api.runtimeError('用户未授权通知权限（当前：' + permission + '）', true);
                return;
              }
              try {
                new Notification('兼容方案演示', {
                  body: '这是一条来自现代方案的系统通知',
                  tag: 'compat-demo'
                });
                api.setStatus('系统通知已发送，请查看操作系统通知中心。');
              } catch (e) {
                api.runtimeError('通知发送失败：' + e.message, true);
              }
            }
            if (Notification.permission === 'granted') {
              show('granted');
            } else {
              var result = Notification.requestPermission(show);
              if (result && typeof result.then === 'function') result.then(show);
            }
          });
          api.mount.appendChild(btn);
          api.setStatus('现代方案就绪：点击按钮将请求权限并发送系统级通知。');
          return { destroy: function () { /* 无资源需释放 */ } };
        }
      },

      legacy: {
        label: '页面内 Toast 浮层',
        init: function (api) {
          var btn = makeButton('显示页面内提示');
          btn.addEventListener('click', function () {
            var toast = el('div', 'toast', '这是一条来自降级方案的页面内提示（3 秒后自动消失）');
            api.mount.appendChild(toast);
            setTimeout(function () {
              if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 3000);
            api.setStatus('已在页面内展示提示浮层。');
          });
          api.mount.appendChild(btn);
          api.setStatus('降级方案就绪：以页面内浮层模拟通知，无需任何权限。');
          return { destroy: function () { /* 无资源需释放 */ } };
        }
      }
    },

    compare: [
      { aspect: '展示位置', modern: '操作系统通知中心，页面不可见也能提醒', legacy: '仅当前页面内的浮层' },
      { aspect: '权限要求', modern: '需用户授权，可能被拒绝', legacy: '无需任何权限' },
      { aspect: '持久性', modern: '可驻留通知中心，支持点击跳转', legacy: '数秒后自动消失' },
      { aspect: '打扰程度', modern: '系统级弹窗，打扰较强', legacy: '页面内轻提示，打扰较弱' }
    ]
  };

  /* ---------------- 4. 地理位置 ---------------- */

  var CITIES = [
    { name: '北京', lat: 39.9042, lng: 116.4074 },
    { name: '上海', lat: 31.2304, lng: 121.4737 },
    { name: '广州', lat: 23.1291, lng: 113.2644 },
    { name: '深圳', lat: 22.5431, lng: 114.0579 },
    { name: '成都', lat: 30.5728, lng: 104.0668 }
  ];

  var geolocation = {
    id: 'geolocation',
    name: '地理位置',
    icon: '\uD83D\uDCCD',

    detect: function () {
      if (!('geolocation' in navigator)) {
        return { level: 'none', detail: '浏览器不支持 Geolocation API' };
      }
      if (window.isSecureContext === false) {
        return { level: 'partial', detail: 'Geolocation API 存在，但非安全上下文（非 HTTPS/localhost）下浏览器会拒绝定位' };
      }
      return { level: 'full', detail: '支持 Geolocation API，可获取设备位置' };
    },

    schemes: {
      modern: {
        label: 'Geolocation API（GPS/网络定位）',
        init: function (api) {
          if (!('geolocation' in navigator)) {
            throw new Error('Geolocation API 不存在');
          }
          var btn = makeButton('获取当前位置');
          var result = el('div', 'geo-result');
          btn.addEventListener('click', function () {
            api.setStatus('定位中…（最多等待 8 秒）');
            result.textContent = '';
            navigator.geolocation.getCurrentPosition(function (pos) {
              api.setStatus('定位成功。');
              result.textContent =
                '纬度 ' + pos.coords.latitude.toFixed(4) +
                '，经度 ' + pos.coords.longitude.toFixed(4) +
                '（精度约 ' + Math.round(pos.coords.accuracy) + ' 米）';
            }, function (err) {
              api.runtimeError('定位失败：' + err.message + '（当前方案保持不变，页面未受影响）', true);
            }, { timeout: 8000, maximumAge: 60000 });
          });
          api.mount.appendChild(btn);
          api.mount.appendChild(result);
          api.setStatus('现代方案就绪：点击按钮请求设备定位（需用户授权）。');
          return { destroy: function () { /* 无资源需释放 */ } };
        }
      },

      legacy: {
        label: '手动选择城市（预设坐标）',
        init: function (api) {
          var select = document.createElement('select');
          var placeholder = document.createElement('option');
          placeholder.value = '';
          placeholder.textContent = '请选择城市…';
          select.appendChild(placeholder);
          CITIES.forEach(function (city, i) {
            var opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = city.name;
            select.appendChild(opt);
          });
          var result = el('div', 'geo-result');
          select.addEventListener('change', function () {
            var idx = select.value;
            if (idx === '') { result.textContent = ''; return; }
            var city = CITIES[Number(idx)];
            result.textContent = city.name + '：纬度 ' + city.lat + '，经度 ' + city.lng + '（城市级精度）';
            api.setStatus('已使用手动选择的位置。');
          });
          api.mount.appendChild(select);
          api.mount.appendChild(result);
          api.setStatus('降级方案就绪：从预设城市中手动选择位置，无需授权、离线可用。');
          return { destroy: function () { /* 无资源需释放 */ } };
        }
      }
    },

    compare: [
      { aspect: '数据来源', modern: 'GPS / Wi-Fi / 基站网络定位', legacy: '用户手动选择预设城市' },
      { aspect: '精度', modern: '米级', legacy: '城市级' },
      { aspect: '权限要求', modern: '需用户授权，可能被拒绝或超时', legacy: '无需授权' },
      { aspect: '可用性', modern: '依赖设备与安全上下文', legacy: '任何环境（含离线）均可用' }
    ]
  };

  /* ---------------- 5. 剪贴板 ---------------- */

  var clipboard = {
    id: 'clipboard',
    name: '剪贴板',
    icon: '\uD83D\uDCCB',

    detect: function () {
      var api = navigator.clipboard && typeof navigator.clipboard.writeText === 'function';
      if (api && window.isSecureContext !== false) {
        return { level: 'full', detail: '支持 Clipboard API（navigator.clipboard.writeText）' };
      }
      if (api) {
        return { level: 'partial', detail: 'Clipboard API 存在，但非安全上下文下写入会被浏览器拒绝' };
      }
      return { level: 'none', detail: '缺少 navigator.clipboard，需使用 document.execCommand 兜底' };
    },

    schemes: {
      modern: {
        label: 'Clipboard API（异步写入）',
        init: function (api) {
          if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
            throw new Error('navigator.clipboard.writeText 不可用');
          }
          var ta = document.createElement('textarea');
          ta.value = '这段文字来自现代方案（Clipboard API）';
          var btn = makeButton('复制到剪贴板');
          btn.addEventListener('click', function () {
            navigator.clipboard.writeText(ta.value).then(function () {
              api.setStatus('已通过 Clipboard API 写入剪贴板，可以粘贴验证。');
            }, function (err) {
              api.runtimeError('写入剪贴板被拒绝：' + err.message, true);
            });
          });
          api.mount.appendChild(ta);
          api.mount.appendChild(el('div')).appendChild(btn);
          api.setStatus('现代方案就绪：异步写入剪贴板，无需选中 DOM。');
          return { destroy: function () { /* 无资源需释放 */ } };
        }
      },

      legacy: {
        label: 'document.execCommand("copy")（已废弃）',
        init: function (api) {
          var ta = document.createElement('textarea');
          ta.value = '这段文字来自降级方案（execCommand）';
          var btn = makeButton('复制到剪贴板');
          btn.addEventListener('click', function () {
            ta.focus();
            ta.select();
            var ok = false;
            try {
              ok = document.execCommand('copy');
            } catch (e) { /* 忽略，按失败处理 */ }
            if (ok) {
              api.setStatus('已通过 execCommand 复制到剪贴板，可以粘贴验证。');
            } else {
              api.runtimeError('execCommand("copy") 被浏览器拒绝，请手动全选后 Ctrl+C 复制', false);
            }
          });
          api.mount.appendChild(ta);
          api.mount.appendChild(el('div')).appendChild(btn);
          api.setStatus('降级方案就绪：选中文本后调用 execCommand 同步复制。');
          return { destroy: function () { /* 无资源需释放 */ } };
        }
      }
    },

    compare: [
      { aspect: '写入方式', modern: 'navigator.clipboard.writeText，异步 Promise', legacy: 'document.execCommand("copy")，同步' },
      { aspect: '权限模型', modern: '需安全上下文，部分浏览器要求用户授权', legacy: '需先选中文本，部分浏览器会拦截' },
      { aspect: '数据类型', modern: '文本 / 富文本 / 图片', legacy: '仅纯文本' },
      { aspect: '标准状态', modern: 'W3C 标准 API', legacy: '已废弃（deprecated），仅为兼容保留' }
    ]
  };

  return [animation, storage, notification, geolocation, clipboard];
})();
