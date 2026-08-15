# 小说阅读器

一个简洁优雅的中文小说阅读器，支持 Web、桌面（Electron）和 Android（Capacitor）三端。所有数据仅保存在本机，无账号、无广告、无网络请求（CSP 已锁定）。

## 功能特点

### 核心功能
- **智能章节识别**：流式解析"第X章/回/卷"等中文格式，支持 UTF-8/GBK/GB18030/UTF-16LE/BE 自动检测
- **双模式阅读**：滚动模式（连续章节窗口化渲染）与翻页模式
- **跟手翻页**：翻页模式拖拽跟手（页面随手指移动），释放后判定翻页或回弹；支持平移/淡入动画
- **双指缩放字号**：移动端双指捏合直接调字号
- **自动翻页**：关/慢/中/快四档（8–14 秒/页），适合挂机阅读
- **阅读进度保存**：按章节+段落锚点记录，字号/模式切换后仍能精确定位；快速连点不越界
- **书签系统**：选文加书签、写笔记、一键跳回原文；跨章选文自动绑定真实章节
- **全文搜索**：跨书搜索，结果点击后定位并高亮命中词
- **最近删除**：删除先进回收站（保留 30 天），可单本恢复或撤销，防误删

### 个性化设置
- **5 种主题 + 夜间模式**：手动 / 跟随系统 / 定时（21:00–7:00）自动切换
- **亮度调节**：阅读页亮度滑条（40%–100%）
- **排版**：字号 14–28、行距 3 档、版心 3 档、字体 3 种（宋/黑/楷）
- **自动隐藏工具栏**：沉浸阅读，顶栏显示时间，底部显示章节内进度

### 书库工具
- **继续阅读卡片**：始终展示最近阅读的书
- **排序**：最近阅读 / 书名
- **目录**：章节搜索过滤、当前章节自动居中
- **数据备份**：一键导出/导入全部书籍、书签与进度（JSON）
- **阅读统计**：今日阅读时长
- **防重复导入**：同名同作者自动拦截

## 快速开始

### Web 版本
1. 双击打开 `reader.html`（或 `npm run serve` 局域网访问）
2. 点击右上角"+"导入 .txt 小说
3. 开始阅读

### 桌面版本（Electron）
```bash
cd desktop && npm install && npm start
# 支持拖放 TXT 文件导入（GBK/UTF-8 均可）
```

### Android 版本
双击 `scripts/编译APK.bat`（自动同步 www → `cap copy android` → 编译 → **APK 内资源哈希校验**），或手动：
```bash
npm run sync:www
npx cap copy android
cd android && ./gradlew assembleDebug
node scripts/verify-apk-assets.js   # 校验 root/www/assets/APK 四层一致性
```
任何一层不一致时构建失败，不会覆盖对外安装包。Android Lint 已接入门禁（0 error）。

## 测试

```bash
npm test                 # 全部测试（快速 + E2E + 功能/手势冒烟）
npm run test:quick       # 纯 Node 单元/回归测试（无浏览器依赖）
npm run test:e2e         # 真实 Chrome 端到端（布局、翻页、进度恢复、快捷键）
npm run test:features    # 功能冒烟（备份往返、亮度、夜间、目录过滤、删除确认）
                        # + 移动端手势冒烟（跟手拖拽、回弹、双指缩放、自动翻页）
```

## 技术栈

- **前端**：纯原生 JavaScript（ES6+），零构建、零运行时依赖
- **存储**：IndexedDB（正文/状态/位置）+ localStorage 兜底
- **桌面**：Electron（contextIsolation + 白名单 IPC）
- **移动**：Capacitor（沉浸式状态栏、音量键翻页桥接）
- **CSP**：`connect-src 'none'`，数据不出本机

## 项目结构

```
book read/
├── reader.html           # 应用壳（结构）
├── reader-styles.css     # 全部样式
├── reader-core.js        # 纯逻辑（章节解析/分页/状态迁移），可单测
├── reader-app.js         # 应用控制器（视图/存储/交互）
├── manifest.json         # PWA 清单
├── www/                  # Android 打包资源（由 scripts/sync-www.js 生成）
├── android/              # Capacitor Android 工程
├── desktop/              # Electron 桌面端（main.js / preload.js）
├── scripts/
│   ├── sync-www.js           # 根目录源码 → www 同步（编译 APK 前自动执行）
│   ├── serve.js              # 局域网访问服务
│   ├── 编译APK.bat           # 一键 APK 构建
│   └── *-test.js             # 测试套件（见"测试"）
└── docs/                 # 文档资料
```

## 开发约定

- **修改即生效**：Web 端无构建步骤；改完源码后 `npm run sync:www` 再编译 APK
- **三文件职责**：HTML 结构、CSS 样式、`reader-core.js`（纯函数）+ `reader-app.js`（DOM/状态）
- **改完必须跑 `npm test`**，回归约束见 `scripts/rebuild-regression-tests.js`
- 章节正文只存 IndexedDB（`chapters` store），不要在 state 里携带正文
- 编码检测在 `reader-app.js` 的 `detectFileEncoding`：256KB 样本，UTF-8 替换率超 1% 则按 GBK 解码

## 许可证

MIT License
