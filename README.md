# 浏览器兼容方案演示台

同一功能同时提供**现代实现**与**旧版降级实现**，页面加载时自动检测浏览器能力并选择方案；
支持用户手动切换，并完整记录每次降级的原因。纯原生 HTML/CSS/JS，无任何框架。

## 运行

```bash
# 推荐通过 HTTP 访问（部分 API 要求安全上下文）
python3 -m http.server 8000
# 打开 http://localhost:8000
```

直接双击 `index.html`（file://）也能运行，可借此观察“非安全上下文”下的自动降级行为。

## 功能与方案对照

| 功能 | 现代方案 | 降级方案 |
| --- | --- | --- |
| 动画 | Web Worker 计算 + requestAnimationFrame + Canvas | setInterval + DOM 定位 |
| 存储 | IndexedDB（对象仓库 + 事务） | localStorage（键值字符串） |
| 通知 | Notification API（系统通知） | 页面内 Toast 浮层 |
| 地理位置 | Geolocation API | 手动选择预设城市 |
| 剪贴板 | navigator.clipboard.writeText | document.execCommand("copy") |

## 兼容性处理

- **支持度分级**：`完全支持` / `部分支持` / `不支持` 三级检测（`js/features.js` 中各功能的 `detect()`）。
- **自动选择**：完全支持用现代方案；部分支持/不支持自动降级，并记录原因。
- **手动切换冲突**：目标方案“不支持”时阻止并提示；“部分支持”时警告但允许尝试，失败自动回退。
- **初始化失败降级**：方案初始化抛错/reject（如隐私模式下 IndexedDB 打不开）时自动切换到另一方案。
- **运行时切换不崩**：切换前先安全销毁旧实现（try/catch），新实现初始化全程 Promise 捕获。
- **运行时错误**：如定位被拒、剪贴板写入失败，就地提示并提供“改用降级方案”入口，不擅自切换。
- **降级原因记录**：所有自动降级、手动切换、冲突、初始化失败、运行时错误都写入历史记录（页面底部可查）。
- **刷新保持**：方案偏好与历史记录存于 localStorage，刷新后恢复上次手动选择的方案；若环境变化导致冲突则回退为自动。

## 目录结构

```
index.html        页面骨架
css/style.css     样式
js/store.js       localStorage 持久化（方案偏好 + 历史记录）
js/features.js    5 个功能的检测逻辑、现代/降级实现、差异对比数据
js/app.js         方案管理器（选择/切换/降级/记录）+ UI 渲染
test/smoke.js     Node 冒烟测试（内置最小 DOM shim，无需依赖）
```

## 测试

```bash
node test/smoke.js
```

覆盖：自动选择、手动切换、运行时连续切换、运行时错误降级、初始化失败降级、
手动切换冲突（不支持/部分支持）、刷新后方案保持、差异对比表渲染。
