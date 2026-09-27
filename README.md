# 跨浏览器兼容层演示

同一功能同时支持现代浏览器与旧版浏览器：针对 **动画、存储、通知、地理位置、剪贴板**
提供现代实现与旧版降级实现，纯原生技术（Feature Detection / DOM / IndexedDB / Web Worker），无任何框架。

## 运行

```bash
# 任意静态服务器即可，例如：
python3 -m http.server 8080
# 打开 http://localhost:8080
```

## 功能与验收对照

- **自动选择方案**：`js/detect.js` 对每个功能做特性检测，区分 完全支持 / 部分支持 / 不支持，
  `js/manager.js` 据此自动选择现代或降级方案。
- **手动切换**：每张卡片可切换现代/降级方案；环境完全不支持现代方案时切换被阻止并提示冲突原因；
  部分支持时允许强制切换但给出警告。
- **初始化失败降级**：现代方案 init 抛错（如隐私模式下 IndexedDB 打开失败）会自动降级并记录原因；
  降级方案也失败则标记「不可用」，页面不崩。
- **运行时切换不崩**：切换时先安全销毁旧实例再初始化新实例，失败自动回退。
- **降级原因展示与记录**：卡片上实时展示当前方案与原因；所有切换（含冲突、初始化失败）写入历史面板。
- **方案差异对比**：每张卡片可展开现代/降级方案对比表。
- **刷新后保持**：手动选择持久化到 localStorage；若刷新后环境与保存的手动选择冲突，自动降级并记录。

## 各功能的双方案

| 功能 | 现代方案 | 降级方案 |
| --- | --- | --- |
| 动画 | Web Animations API | Web Worker 定时器逐帧驱动（Worker 不可用时再降为 setInterval） |
| 存储 | IndexedDB | localStorage |
| 通知 | Notification API | 页面内 Toast |
| 地理位置 | Geolocation API | 手动输入坐标 |
| 剪贴板 | Clipboard API | textarea + execCommand("copy") |

## 目录结构

```
index.html        页面结构
css/styles.css    样式
js/detect.js      特性检测（full / partial / none）
js/features.js    五个功能的现代 + 降级实现与差异数据
js/manager.js     方案选择、切换、冲突处理、历史与持久化
js/main.js        UI 渲染与事件绑定
```
