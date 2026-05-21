# 加固 Service Worker 版本管理与 kill-switch

## Goal

让 `public/sw.js` 在每次部署后能可靠地更新缓存、避免"旧 SW 锁死用户"的事故，
并预留紧急逃生通道（kill-switch），减少未来 SW 翻车的修复成本。

直接动机：本次部署 `https://image-playground.diaohan111.workers.dev/` 后，
开发者自己在 Chrome 上无法打开站点（Edge 正常），原因被定位为
**旧 SW 被注册后命中过期 HTML/资源缓存**，需要手动 Clear site data 才能恢复。
这种事故对线上用户而言是不可接受的（用户不会清缓存）。

## What I already know

### 当前 sw.js 行为（`public/sw.js`，54 行）

- `CACHE_NAME = 'image-playground-v0.1.0'` —— **写死**，不随构建变化
- `install`: 缓存 app shell（`./`, `./index.html`, `./manifest.webmanifest`, `./pwa-icon.svg`），调用 `self.skipWaiting()` 立即接管
- `activate`: 删除所有非当前 CACHE_NAME 的缓存，调用 `self.clients.claim()`
- `fetch`:
  - non-GET / 跨域 → 不拦截
  - navigate 请求（HTML） → **network-first**，但每次响应都 `cache.put('./index.html', copy)`（HTML 会被持续写入缓存）
  - 其他同源 GET → **cache-first**，命中即返回，否则 fetch 并写入缓存
- 没有 `message` 通道、没有 kill-switch、`fetch().catch` 也只在 navigate 分支有

### 项目侧

- `src/main.tsx:9-21` 在 prod 环境注册 `${BASE_URL}sw.js`，dev 环境主动 unregister 所有 SW
- `vite.config.ts:28-31` 已有 `__APP_VERSION__` define 注入 `pkg.version`，但 `pkg.version` 手动维护（当前 0.1.0），**不会自动变**
- `public/sw.js` 是静态资源，**不经过 Vite bundling**，`define` 注入对它无效
- 部署：Cloudflare Workers + assets（`wrangler.jsonc`），SPA fallback
- 域名：`*.workers.dev`，已知会被部分 Chrome 扩展 / Safe Browsing 误伤（这是独立问题，不在本任务范围）

## Assumptions (temporary)

- 用户对站点 PWA / 离线访问能力**没有强需求**——SW 主要价值是加速静态资源加载
- 接受"每次部署后首次访问需要联网拉取新 HTML 与 hashed assets"的代价
- 不引入 vite-plugin-pwa 等重型依赖（保持现有自写 SW 的轻量风格）

## Open Questions

- ~~[BLOCKING] MVP 范围~~ → **已确认：档 B = P0 + kill-switch**
- [DERIVABLE→已答] 如何把 build id 注入到 `public/sw.js`？ → 采用方案 1（postbuild 脚本字符串替换）

## Requirements

### P0（必做）

- **R1. 自动版本化 CACHE_NAME**：每次部署后，新部署的 CACHE_NAME 必须与上一次部署不同，自动化、不依赖手动 bump `package.json`
- **R2. HTML 不长期缓存**：在线时 `index.html` 永远拿网络版本，且 navigate 响应**不再写回主缓存**；离线兜底通过 `install` 时预缓存的版本提供（落后一个部署可接受）
- **R3. 保留 hashed assets 的 cache-first**：JS/CSS/图标等带哈希文件名的资源，行为不变（cache-first，写回缓存）

### Kill-switch（必做）

- **R4. SW 顶部加 `KILL_SWITCH` 常量**：默认 `false`；翻车时改 `true` 部署一次，已注册旧 SW 的用户下次访问会自动 unregister + 重载页面
- **R5. kill-switch 分支不注册 `fetch` 监听器**：彻底放弃拦截，让浏览器走正常网络
- **R6. kill-switch 触发 `clients.navigate(c.url)` 强制重载所有 client**：确保用户拿到的是无 SW 拦截的新页面

## Acceptance Criteria (evolving)

- [ ] AC1: 修改 `pkg.version` 之外，**任意一次构建** dist/sw.js 的 CACHE_NAME 都与上次不同（可用 git commit short hash 或构建时间戳验证）
- [ ] AC2: 在浏览器里访问站点 → 改一处 HTML/JS → 重新部署 → 刷新页面（不清缓存、不开无痕） **能拿到新内容**，不出现白屏 / 引用废文件 404
- [ ] AC3: 把 `KILL_SWITCH` 改为 `true` 重新构建部署后，已注册旧 SW 的浏览器下次访问会自动 unregister，并能正常加载页面（手动验证）
- [ ] AC4: 离线情况下访问站点仍能返回缓存的 `index.html`（保持现有离线能力）

## Definition of Done

- 单元测试：SW 逻辑本身难以 unit-test，但 build-id 注入脚本要有测试
- 手动验证：按 AC2 的流程跑通一次（dev 环境模拟两次部署）
- Lint / typecheck / CI 通过
- 在 `.trellis/spec/frontend/` 下补一条 spec：sw.js 修改清单与避雷点（**why** SW 缓存策略要这么写）
- 部署到 workers.dev 上做一次真实回归（确认 Chrome 不再翻车）

## Out of Scope (explicit)

- 不引入 vite-plugin-pwa / Workbox 等第三方 PWA 框架
- 不做绑定自定义域名（独立工作项，与 SW 无关）
- 不做"新版本可用"的 toast UI 美化（如果 MVP 包含通知，先用最简单的 `confirm()` / 控制台提示，UI 留给后续）
- 不解决 `*.workers.dev` 被广告拦截器 / Safe Browsing 误伤的问题

## Technical Notes

### build id 注入 public/sw.js 的候选方案

- **方案 1（推荐）**: postbuild 脚本字符串替换
  - `public/sw.js` 里写 `const CACHE_NAME = '__BUILD_ID__'`
  - 加 `scripts/inject-sw-build-id.mjs`：构建后读 `dist/sw.js`，把占位符替换为 `git rev-parse --short HEAD` 或 `Date.now()`
  - `package.json` 的 `build` 脚本接力调用：`vite build && node scripts/inject-sw-build-id.mjs`
  - 优点：实现简单 ~20 行；无依赖；保持 sw.js 静态文件结构
  - 缺点：dev 环境（vite dev）走不到这里，但本项目 dev 已经主动 unregister SW，无影响
- **方案 2**: 把 sw.js 改成 src/sw.ts，让 Vite 单独 emit
  - 需要配 `rollupOptions.input` 多入口或单独的 build config
  - 优点：能直接吃 `define` 注入
  - 缺点：配置成本高、引入构建复杂度
- **方案 3**: SW 启动时 fetch `/version.json` 决定 CACHE_NAME
  - 优点：完全运行时
  - 缺点：每次启动多一次网络请求；版本切换时序复杂；不推荐

### kill-switch 设计草图

```js
const KILL_SWITCH = false  // 翻车时改 true 部署一次即可
if (KILL_SWITCH) {
  self.addEventListener('install', () => self.skipWaiting())
  self.addEventListener('activate', async (event) => {
    event.waitUntil((async () => {
      await self.registration.unregister()
      const clients = await self.clients.matchAll({ type: 'window' })
      clients.forEach((c) => c.navigate(c.url))
    })())
  })
  // 不注册 fetch 监听
}
```

### 关键参考文件

- `public/sw.js` —— 待改对象
- `src/main.tsx:9-21` —— 注册点（可能需要加 message 通道监听新版本）
- `vite.config.ts:28-31` —— define 注入风格（保持一致性）
- `package.json` `scripts.build` —— postbuild hook 接入点

## Research References

（本任务规模可控、模式成熟，暂不需要 trellis-research 子代理调研。若未来要做"新版本提示 UX"再单独调研 PWA 更新模式）

## Technical Approach

### 1. build id 注入（解决 R1）

- `public/sw.js` 顶部写占位：`const CACHE_NAME = '__CACHE_NAME__'`
- 新增 `scripts/inject-sw-build-id.mjs`：
  - 尝试 `git rev-parse --short HEAD`，失败降级
  - 组合 `${shortHash || 'nogit'}-${Date.now()}` 作为 build id
  - 读 `dist/sw.js`，把 `__CACHE_NAME__` 替换为 `image-playground-${buildId}`
  - 写回 `dist/sw.js`
- `package.json` 的 `build` 改为：`tsc -b && vite build && node scripts/inject-sw-build-id.mjs`（具体接力位置按现有脚本结构）
- 校验：脚本结尾 grep 一下 `dist/sw.js` 中 `__CACHE_NAME__` 是否还存在，残留则 exit 1

### 2. HTML 不写回主缓存（解决 R2）

- 删除 `sw.js` navigate 分支的 `cache.put('./index.html', copy)`
- `install` 时的 `cache.addAll([..., './index.html', ...])` 保留，作为离线兜底
- 后续部署时 `install` 用新 CACHE_NAME 重新 addAll，离线版本随之刷新（落后一个部署可接受）

### 3. kill-switch（解决 R4-R6）

- `sw.js` 顶部：`const KILL_SWITCH = false`
- 用 `if (KILL_SWITCH) { ... return / 跳过常规监听 ... } else { 现有逻辑 }` 包住整个文件
- KILL_SWITCH 分支只注册 `install`（skipWaiting）和 `activate`（unregister + navigate clients），不注册 `fetch`
- 翻车时：把 `KILL_SWITCH` 改 `true` → 部署 → 等用户访问 → 自动救回。确认全部用户救回后，再改 `false` 部署正常版本

### 4. spec 补档

- 新增 `.trellis/spec/frontend/service-worker.md`（或对应索引路径）
- 内容：本次决策的 **why**（旧 SW 锁死事故、CACHE_NAME 必须自动化、HTML 不写回的原因、kill-switch 模板），未来任何人改 SW 前必读

## Decision (ADR-lite)

**Context**: 部署 `image-playground-v0.1.0` 后，Chrome 端因旧 SW 缓存策略问题导致页面无法打开，
Edge 端因从未注册过 SW 而正常。线上风险：任何已访问过站点的用户在下一次 SW 翻车部署时都会被锁死，
且无法自助恢复（普通用户不会清缓存）。

**Decision**: 采用档 B 方案 = build-id 自动注入 CACHE_NAME + HTML 不写回主缓存 + kill-switch 常量。
build id 用 `${git-short-hash}-${timestamp}` 组合（无 git 时降级 timestamp）。
不引入 vite-plugin-pwa，保持自写 SW 的轻量风格。

**Consequences**:
- ✅ 每次部署自然失效旧缓存，HTML 永远新鲜
- ✅ 翻车时有一键逃生通道（改 1 行常量、部署 1 次）
- ✅ 用户的 IndexedDB（图片数据）完全不受影响
- ⚠️ 离线版本可能落后一个部署（在线 UX 优先于离线，接受）
- ⚠️ kill-switch 部署会强制刷新所有 tab，未保存的画笔操作丢失（紧急场景预期行为）
- ⚠️ `public/sw.js` 引入构建后处理步骤，新人贡献时需在 spec 中读到
