import {
  detectAnimation,
  detectStorage,
  detectNotification,
  detectGeolocation,
  detectClipboard,
} from './detect.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function demoRow(...children) {
  const row = el('div', 'demo-row');
  children.forEach((c) => row.appendChild(c));
  return row;
}

function createWorkerTicker(onTick) {
  const src =
    "let t=null;onmessage=function(e){if(e.data==='start'){if(!t){t=setInterval(function(){postMessage('tick')},16);}}else{clearInterval(t);t=null;}}";
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const worker = new Worker(url);
  worker.onmessage = () => onTick();
  worker.postMessage('start');
  return {
    source: 'Web Worker 定时器',
    stop() {
      worker.postMessage('stop');
      worker.terminate();
      URL.revokeObjectURL(url);
    },
  };
}

function createIntervalTicker(onTick) {
  const id = setInterval(onTick, 16);
  return { source: 'setInterval（Worker 不可用的二级降级）', stop: () => clearInterval(id) };
}

const animationFeature = {
  id: 'animation',
  name: '动画',
  detect: detectAnimation,
  modern: {
    label: 'Web Animations API',
    init(root) {
      const stage = el('div', 'anim-stage');
      const box = el('div', 'anim-box');
      stage.appendChild(box);
      root.appendChild(demoRow(stage));
      const animation = box.animate(
        [
          { transform: 'translateX(0)', background: '#4f8cff' },
          { transform: 'translateX(220px)', background: '#9b59b6' },
          { transform: 'translateX(0)', background: '#4f8cff' },
        ],
        { duration: 2000, iterations: Infinity, easing: 'ease-in-out' }
      );
      const note = el('p', 'demo-note', '由 element.animate() 驱动（合成器线程，性能最优）');
      root.appendChild(note);
      return {
        destroy() {
          animation.cancel();
        },
      };
    },
  },
  fallback: {
    label: '定时器逐帧驱动',
    init(root) {
      const stage = el('div', 'anim-stage');
      const box = el('div', 'anim-box');
      stage.appendChild(box);
      root.appendChild(demoRow(stage));
      let ticker;
      try {
        ticker = createWorkerTicker(() => step());
      } catch (e) {
        ticker = createIntervalTicker(() => step());
      }
      const start = performance.now();
      function step() {
        const t = ((performance.now() - start) % 2000) / 2000;
        const p = t < 0.5 ? t * 2 : (1 - t) * 2;
        box.style.transform = 'translateX(' + (p * 220).toFixed(1) + 'px)';
      }
      const note = el('p', 'demo-note', '由 ' + ticker.source + ' 逐帧修改 style（主线程重绘，性能较差）');
      root.appendChild(note);
      return {
        destroy() {
          ticker.stop();
        },
      };
    },
  },
  diff: [
    ['实现方式', 'element.animate() 声明式关键帧', 'Worker/setInterval 定时器逐帧改 style'],
    ['执行线程', '合成器线程，掉帧少', '主线程，易被阻塞'],
    ['API 要求', 'Web Animations API', '定时器即可，几乎全浏览器可用'],
    ['可维护性', '关键帧声明，易调整', '手动计算位移，逻辑分散'],
  ],
};

const storageFeature = {
  id: 'storage',
  name: '存储',
  detect: detectStorage,
  modern: {
    label: 'IndexedDB',
    async init(root) {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('gsb-compat-demo', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
        req.onblocked = () => reject(new Error('IndexedDB 被阻塞'));
      });
      const input = el('input', 'demo-input');
      input.placeholder = '输入要保存的内容';
      const saveBtn = el('button', 'btn', '保存');
      const loadBtn = el('button', 'btn', '读取');
      const out = el('span', 'demo-output', '（尚未读取）');
      saveBtn.onclick = () => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(input.value, 'note');
        tx.oncomplete = () => { out.textContent = '已保存到 IndexedDB'; };
        tx.onerror = () => { out.textContent = '保存失败：' + tx.error.message; };
      };
      loadBtn.onclick = () => {
        const req = db.transaction('kv', 'readonly').objectStore('kv').get('note');
        req.onsuccess = () => { out.textContent = '读取结果：' + (req.result ?? '（空）'); };
        req.onerror = () => { out.textContent = '读取失败：' + req.error.message; };
      };
      root.appendChild(demoRow(input, saveBtn, loadBtn));
      root.appendChild(demoRow(out));
      return {
        destroy() {
          db.close();
        },
      };
    },
  },
  fallback: {
    label: 'localStorage',
    init(root) {
      const input = el('input', 'demo-input');
      input.placeholder = '输入要保存的内容';
      const saveBtn = el('button', 'btn', '保存');
      const loadBtn = el('button', 'btn', '读取');
      const out = el('span', 'demo-output', '（尚未读取）');
      saveBtn.onclick = () => {
        try {
          localStorage.setItem('gsb-demo-note', input.value);
          out.textContent = '已保存到 localStorage';
        } catch (e) {
          out.textContent = '保存失败：' + e.message;
        }
      };
      loadBtn.onclick = () => {
        out.textContent = '读取结果：' + (localStorage.getItem('gsb-demo-note') ?? '（空）');
      };
      root.appendChild(demoRow(input, saveBtn, loadBtn));
      root.appendChild(demoRow(out));
      return { destroy() {} };
    },
  },
  diff: [
    ['存储容量', '通常数百 MB（按源配额）', '约 5MB'],
    ['数据类型', '结构化对象、二进制', '仅字符串'],
    ['API 模型', '异步事务，不阻塞主线程', '同步读写，可能阻塞'],
    ['索引查询', '支持索引与游标', '仅按键名遍历'],
  ],
};

const notificationFeature = {
  id: 'notification',
  name: '通知',
  detect: detectNotification,
  modern: {
    label: 'Notification API',
    init(root) {
      const btn = el('button', 'btn', '发送系统通知');
      const out = el('span', 'demo-output');
      btn.onclick = async () => {
        try {
          let perm = Notification.permission;
          if (perm === 'default') perm = await Notification.requestPermission();
          if (perm !== 'granted') {
            out.textContent = '权限被拒绝（' + perm + '），建议切换到降级方案';
            return;
          }
          new Notification('兼容层演示', { body: '这是一条系统级通知' });
          out.textContent = '系统通知已发送';
        } catch (e) {
          out.textContent = '发送失败：' + e.message;
        }
      };
      root.appendChild(demoRow(btn, out));
      return { destroy() {} };
    },
  },
  fallback: {
    label: '页面内 Toast',
    init(root) {
      const btn = el('button', 'btn', '显示页面内提示');
      btn.onclick = () => {
        const toast = el('div', 'toast', '这是一条页面内 Toast 提示');
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add('toast-show'), 10);
        setTimeout(() => {
          toast.classList.remove('toast-show');
          setTimeout(() => toast.remove(), 300);
        }, 2500);
      };
      root.appendChild(demoRow(btn));
      return { destroy() {} };
    },
  },
  diff: [
    ['展示位置', '操作系统通知中心，页面外可见', '仅当前页面内'],
    ['权限要求', '需要用户授权', '无需权限'],
    ['后台可达', '页面在后台也能提醒', '页面不可见时无效'],
    ['样式控制', '受系统限制', '完全自定义'],
  ],
};

const geolocationFeature = {
  id: 'geolocation',
  name: '地理位置',
  detect: detectGeolocation,
  modern: {
    label: 'Geolocation API',
    init(root) {
      const btn = el('button', 'btn', '获取当前位置');
      const out = el('span', 'demo-output');
      btn.onclick = () => {
        out.textContent = '定位中…';
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            out.textContent =
              '纬度 ' + pos.coords.latitude.toFixed(5) + '，经度 ' + pos.coords.longitude.toFixed(5);
          },
          (err) => {
            out.textContent = '定位失败（code ' + err.code + '）：' + err.message;
          },
          { timeout: 10000 }
        );
      };
      root.appendChild(demoRow(btn, out));
      return { destroy() {} };
    },
  },
  fallback: {
    label: '手动输入坐标',
    init(root) {
      const lat = el('input', 'demo-input');
      lat.placeholder = '纬度，如 39.9042';
      const lng = el('input', 'demo-input');
      lng.placeholder = '经度，如 116.4074';
      const btn = el('button', 'btn', '确认');
      const out = el('span', 'demo-output');
      btn.onclick = () => {
        const la = parseFloat(lat.value);
        const ln = parseFloat(lng.value);
        if (Number.isNaN(la) || Number.isNaN(ln)) {
          out.textContent = '请输入合法数字';
        } else {
          out.textContent = '已采用手动坐标：纬度 ' + la + '，经度 ' + ln;
        }
      };
      root.appendChild(demoRow(lat, lng, btn));
      root.appendChild(demoRow(out));
      return { destroy() {} };
    },
  },
  diff: [
    ['坐标来源', 'GPS/网络自动定位', '用户手动输入'],
    ['精度', '米级到百米级', '取决于用户'],
    ['权限要求', '需要用户授权 + 安全上下文', '无'],
    ['失败场景', '拒绝授权、超时、非 HTTPS', '输入格式错误'],
  ],
};

const clipboardFeature = {
  id: 'clipboard',
  name: '剪贴板',
  detect: detectClipboard,
  modern: {
    label: 'Clipboard API',
    init(root) {
      const input = el('input', 'demo-input');
      input.value = 'https://example.com/compat-demo';
      const btn = el('button', 'btn', '复制');
      const out = el('span', 'demo-output');
      btn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(input.value);
          out.textContent = '已复制（Clipboard API）';
        } catch (e) {
          out.textContent = '复制失败：' + e.message;
        }
      };
      root.appendChild(demoRow(input, btn, out));
      return { destroy() {} };
    },
  },
  fallback: {
    label: 'execCommand("copy")',
    init(root) {
      const input = el('input', 'demo-input');
      input.value = 'https://example.com/compat-demo';
      const btn = el('button', 'btn', '复制');
      const out = el('span', 'demo-output');
      btn.onclick = () => {
        const ta = document.createElement('textarea');
        ta.value = input.value;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try {
          ok = document.execCommand('copy');
        } catch (e) {
          ok = false;
        }
        ta.remove();
        out.textContent = ok ? '已复制（execCommand）' : '复制失败：execCommand 被拒绝';
      };
      root.appendChild(demoRow(input, btn, out));
      return { destroy() {} };
    },
  },
  diff: [
    ['API 模型', '异步 Promise，语义清晰', '同步命令，已废弃但兼容广'],
    ['安全要求', '需安全上下文 + 用户手势', '需用户手势'],
    ['数据类型', '文本/富文本/图片（逐步支持）', '仅文本'],
    ['错误反馈', 'Promise rejection 带原因', '仅返回布尔值'],
  ],
};

export const features = [
  animationFeature,
  storageFeature,
  notificationFeature,
  geolocationFeature,
  clipboardFeature,
];
