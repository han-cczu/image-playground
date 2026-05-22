# Service Worker

> 自写 Service Worker（`public/sw.js`）的缓存策略与逃生通道契约。

---

## 概要

本规范适用于以下场景，**必读**：

- 修改 `public/sw.js`（缓存策略、监听器、版本字符串等任何改动）
- 修改 `scripts/inject-sw-build-id.mjs`（构建后注入 CACHE_NAME 的脚本）
- 修改 `src/main.tsx` 中的 SW 注册逻辑（注册时机、scope、unregister 路径）
- 修改 `package.json` 的 `build` 脚本调用链

本项目刻意不引入 `vite-plugin-pwa` / Workbox 等第三方框架，保持自写 SW 的轻量风格。
对应代价：所有 SW 决策都要靠这份 spec + `public/sw.js` 顶部注释自我约束，没有框架兜底。

---

## 背景 / 事故复盘

### 事故：`image-playground-v0.1.0` 部署后 Chrome 锁死

- 现象：开发者自己在 Chrome 上无法打开 `https://image-playground.diaohan111.workers.dev/`，
  必须手动 `Clear site data` 才能恢复；Edge 端因从未注册过 SW 而完全正常。
- 风险：线上用户不会清缓存，任何一次 SW 翻车都会把已访问过的用户永久锁死。

### 根本原因（三件事叠加）

1. **CACHE_NAME 写死**为 `'image-playground-v0.1.0'`（依赖手动 bump `package.json` 版本号），
   后续部署不改版本号时新旧 SW 用同一个 CACHE_NAME，`activate` 阶段的旧缓存清理逻辑形同虚设。
2. **navigate 分支把 HTML 写回主缓存**（`cache.put('./index.html', copy)`），
   导致旧 HTML 长期驻留缓存，旧 HTML 又引用了新部署已删除的 hashed assets 文件名，
   构成"HTML 命中旧缓存 → 引用文件名 → 404 → 白屏"的死循环。
3. **没有逃生通道**：一旦旧 SW 被注册并锁死浏览器，唯一恢复路径是用户手动清站点数据。

---

## 三条核心契约

### 契约 1：CACHE_NAME 必须由构建脚本注入，每次部署都不同

**Why**：SW 的 `activate` 阶段只会清"非当前 CACHE_NAME"的缓存。若新旧部署 CACHE_NAME 相同，
旧缓存项不会被清理；HTML 与 assets 的版本切换都将失效。

**How**：

- `public/sw.js` 顶部固定写 `const CACHE_NAME = '__CACHE_NAME__'`（字面占位符）。
- `scripts/inject-sw-build-id.mjs` 在 `vite build` 之后把占位符替换为 `image-playground-${gitHash}-${timestamp}`，
  无 git 环境时降级为 `image-playground-nogit-${timestamp}`，保证每次构建都不同。
- `package.json` 的 `build` 脚本严格保持 `tsc -b && vite build && node scripts/inject-sw-build-id.mjs` 的顺序。
- 注入脚本结尾若仍能在 `dist/sw.js` 中找到 `__CACHE_NAME__` 字面量，会 `exit 1` 阻断构建。

**不要**：

- 不要把 CACHE_NAME 改回手动 bump 字面量字符串。
- 不要把注入步骤从 `build` 链中拆走（例如挪进 `deploy` 脚本），否则 `npm run build && wrangler dev` 的本地预览路径会拿到未注入的 SW。

### 契约 2：`index.html` 不写回主缓存

**Why**：HTML 是 hashed assets 的入口索引。一旦 HTML 缓存比 assets 旧一个部署，
HTML 引用的资源文件名（如 `index-abc123.js`）就已经被新部署删除，浏览器返回 404 → 白屏。
保证 HTML 永远走网络是避免该死循环的最小成本方案。

**How**：

- `fetch` 监听器中 `request.mode === 'navigate'` 分支使用纯 `fetch(request).catch(() => caches.match('./index.html'))`。
- **不要在这个分支调用 `cache.put`**。
- 离线兜底由 `install` 阶段 `cache.addAll(['./index.html', ...])` 提供，会在下次部署的 `activate` 时随新 CACHE_NAME 一起刷新。

**代价**：离线版本可能落后一个部署。本项目的 trade-off 是"在线 UX 优先于离线"，可接受。

### 契约 3：kill-switch 是单向逃生通道

**Why**：即使有契约 1、2，SW 仍可能因未知 bug 把用户锁死。
必须预留一个"改 1 行常量、部署 1 次、所有用户自动恢复"的紧急通道。

**How**：

- `public/sw.js` 顶部声明 `const KILL_SWITCH = false`。
- 整个 SW 主体被 `if (KILL_SWITCH) { ... } else { ...正常逻辑... }` 包裹。
- 翻车流程：改 `KILL_SWITCH = true` → 部署一次 → 已注册旧 SW 的浏览器下次访问时
  自动 `self.clients.claim()` → `self.registration.unregister()` → `clients.navigate(c.url)` 强制刷新所有 tab → 用户拿到无 SW 拦截的页面。
- 恢复流程：确认全部用户已经过一次 kill-switch 部署后，把 `KILL_SWITCH` 改回 `false` 再部署正常版本。

**activate 内部顺序（关键，不要随手调换）**：

1. `await self.clients.claim()` —— 必须放最前。新 SW 通过 `skipWaiting` 立即激活后并不会自动接管旧 SW 控制的 client，未 claim 时下一步的 `matchAll({ type: 'window' })` 默认只返回**本 SW 已控制的** client（即空数组），navigate 会被空数组吞掉，逃生分支形同虚设。
2. `await self.registration.unregister()` —— 标记注册待删除，下次刷新后该 SW 不再控制任何 client。
3. `await Promise.allSettled(windows.map((c) => c.navigate(c.url)))` —— 强制刷新所有窗口。`matchAll` 同时显式传 `includeUncontrolled: true` 作为 claim 时序窗口的双保险；单个 `Client.navigate()` 在极端场景（client detached、跨源重定向后）可能 reject，必须用 `allSettled` 隔离，否则某个 tab 失败会拒绝整个 `waitUntil` 的 Promise，让其他可救的 tab 都救不回来。

**严格不变量**：

- KILL_SWITCH 默认必须为 `false`，PR 提交前自检。
- kill-switch 分支**绝不**注册 `fetch` 监听器（注册即等于重新获得拦截能力，逃生意义归零）。
- kill-switch 分支必须 `clients.navigate(c.url)` 强制重载，不要省略（否则用户即便 unregister 了也仍在看缓存的旧页面，下一次刷新才生效）。

**已知代价**：kill-switch 部署会强制刷新所有 tab，未保存的画笔/输入会丢失。这是紧急场景的预期行为。

---

### 契约 4：`/sw.js` 在 HTTP 层必须完全跳过条件请求 / 304 短路

`/sw.js` 的客户端逻辑（契约 1-3）只解决「浏览器一旦拿到新 sw.js 就能 install/activate 新版本」的问题。但浏览器**能否拿到新 sw.js** 取决于上一跳的 HTTP 缓存行为。**任何 HTTP 层的 304 / etag / If-Modified-Since 短路都会让 kill-switch 失效**——即使原始服务器已经更新，CDN/反代/浏览器条件请求看到 `ETag` 匹配就返回 304，浏览器拿到的还是旧 sw.js。

**核心规则**：
1. `Cache-Control: no-cache, no-store, must-revalidate`（强制每次走原始服务器）
2. **额外**：禁 ETag 与 Last-Modified 响应头（防止 304 条件请求）
3. **额外**：禁 `If-Modified-Since` 请求转发到上游
4. 任何反代层（CDN / Caddy / nginx / Cloudflare）不能在 `/sw.js` 之上加任何 cache layer

只做规则 1 是**不够的**：no-cache 告诉客户端"必须走原始服务器验证"，但客户端依然会带 `If-None-Match` / `If-Modified-Since` 头，服务器看到匹配仍可能返回 304，客户端就用本地副本——本地副本就是旧 sw.js。

**部署模板**（nginx 示例）：

```nginx
location = /sw.js {
  add_header Cache-Control "no-cache, no-store, must-revalidate" always;
  add_header Pragma "no-cache" always;
  expires 0;
  etag off;                  # 禁响应 ETag
  if_modified_since off;     # 忽略请求 If-Modified-Since
  try_files $uri =404;
}
```

Caddy 示例：

```
@sw path /sw.js
header @sw Cache-Control "no-cache, no-store, must-revalidate"
header @sw -ETag
header @sw -Last-Modified
```

**Prevention**：任何静态部署平台（Cloudflare Workers Assets / Vercel / Netlify / 自建 nginx/caddy）接入时，**先验证** `/sw.js` 响应头不含 `ETag` / `Last-Modified`，且条件请求始终返回 200 + 新内容。可用：

```bash
# 期望：每次都 200，response body 不同（BUILD_ID 不同）
curl -i https://your-domain/sw.js
curl -i -H 'If-None-Match: "abc"' https://your-domain/sw.js   # 不能返回 304
```

**实证**：commit Docker 部署任务的 `nginx.conf` `location = /sw.js`。

---

## Common Mistake

### Wrong vs Correct

#### ❌ Wrong: 把 `CACHE_NAME` 改回字面量字符串

```javascript
// public/sw.js
const CACHE_NAME = 'image-playground-v0.1.1' // 手动 bump
```

**Symptom**：忘了 bump 版本号时新旧部署 CACHE_NAME 相同，`activate` 阶段不清旧缓存；
即便记得 bump，也违反"每次部署都不同"契约（同一版本号反复部署也会冲突）。

#### ✅ Correct

```javascript
// public/sw.js
const CACHE_NAME = '__CACHE_NAME__' // 由 scripts/inject-sw-build-id.mjs 注入
```

---

#### ❌ Wrong: 在 navigate 分支再加 `cache.put('./index.html', ...)`

```javascript
if (request.mode === 'navigate') {
  event.respondWith(
    fetch(request).then((response) => {
      const copy = response.clone()
      caches.open(CACHE_NAME).then((c) => c.put('./index.html', copy)) // 错
      return response
    }).catch(() => caches.match('./index.html')),
  )
  return
}
```

**Symptom**：HTML 被持续写入缓存，旧 HTML 引用已删除的 hashed assets，白屏 / 404。

#### ✅ Correct

```javascript
if (request.mode === 'navigate') {
  event.respondWith(
    fetch(request).catch(() => caches.match('./index.html')),
  )
  return
}
```

---

#### ❌ Wrong: 删掉 kill-switch 的 `clients.navigate(c.url)`

```javascript
self.addEventListener('activate', (event) => {
  event.waitUntil(self.registration.unregister()) // 只 unregister，不强制刷新
})
```

**Symptom**：旧 SW 已 unregister，但页面仍在内存中由已激活的旧 SW 拦截。
用户除非主动刷新，否则看不到效果——kill-switch 的"自动恢复"语义破产。

#### ✅ Correct

```javascript
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim()
      await self.registration.unregister()
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      await Promise.allSettled(windows.map((c) => c.navigate(c.url)))
    })(),
  )
})
```

---

#### ❌ Wrong: 漏掉 `self.clients.claim()` / 用 `matchAll({ type: 'window' })` 默认参数

```javascript
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.registration.unregister()
      // matchAll 默认只返回本 SW 已控制的 client；新 SW 未 claim 时 = 空数组
      const clients = await self.clients.matchAll({ type: 'window' })
      clients.forEach((c) => c.navigate(c.url))
    })(),
  )
})
```

**Symptom**：旧 SW 仍控制所有打开的 tab，新 SW 没 claim 就调 `matchAll`，结果是空数组，`forEach` 跑空。
所有 tab 仍由"被 unregister 但还在控制 client 的旧 SW"或"未接管 client 的新 SW"占据，
用户只有手动刷新才能恢复——kill-switch 的"自动救援"语义破产。

#### ✅ Correct

先 `await self.clients.claim()`，再 `matchAll`，且显式传 `includeUncontrolled: true`，
并用 `Promise.allSettled` 包裹 `c.navigate(c.url)`，避免单个 tab 失败把整个 `waitUntil` 拒绝。

---

#### ❌ Wrong: `event.waitUntil(async () => { ... })` —— 传 function 而非 Promise

```javascript
self.addEventListener('activate', (event) => {
  event.waitUntil(async () => {
    await self.registration.unregister()
    // ...
  })
})
```

**Symptom**：`waitUntil` 收到的是一个 async 函数对象（不是 Promise），浏览器把它当作已 settled 处理，
activate 立刻被视为完成；真正的 unregister / navigate 跑在 activate 生命周期之外，
浏览器随时可能终止 SW（idle 后会被回收），逃生流程被悄悄阻断。

#### ✅ Correct

```javascript
event.waitUntil(
  (async () => {
    await self.clients.claim()
    await self.registration.unregister()
    // ...
  })(),  // ← 立刻调用得到 Promise
)
```

---

#### ❌ Wrong: kill-switch 分支注册了 fetch 监听

```javascript
if (KILL_SWITCH) {
  self.addEventListener('install', () => self.skipWaiting())
  self.addEventListener('activate', /* unregister */)
  self.addEventListener('fetch', (event) => { /* 任意拦截逻辑 */ }) // 错
}
```

**Symptom**：kill-switch 仍在拦截网络请求，等于"翻车版本 + 多一个 unregister 步骤"，逃生分支彻底失去意义。

#### ✅ Correct

`if (KILL_SWITCH)` 分支**只**注册 `install` 与 `activate`，绝不出现 `addEventListener('fetch', ...)`。

---

## Note: 未来若引入第二个 cache，`caches.match('./index.html')` 需收紧

当前 navigate 离线兜底用的是全局 `caches.match('./index.html')`，会跨所有 cache 命名空间查找。
当前项目只有一个 cache（主 CACHE_NAME），并且 `activate` 阶段会清掉所有非当前 CACHE_NAME 的缓存，
所以全局查找的行为是正确的——查到的一定是当前 CACHE_NAME 里的 `index.html`。

但**若未来引入第二个 cache**（例如 runtime images cache、字体 cache 等独立命名空间），
全局 `caches.match` 可能匹配到非预期 cache 里的旧 `index.html`。届时应改成：

```javascript
caches.open(CACHE_NAME).then((c) => c.match('./index.html'))
```

把查找范围收紧到主 cache。当前阶段不改，避免引入冗余复杂度；该 note 留档以便引入第二个 cache 的 PR 一并处理。

---

## 验证清单（部署前自检）

每次涉及 SW 的 PR 在合并 / 部署前，按以下列表逐条核对：

- [ ] `dist/sw.js` 中 `CACHE_NAME` 已被注入为 `image-playground-<hash>-<ts>` 形式，无 `__CACHE_NAME__` 字面量残留
- [ ] `dist/sw.js` 中 `request.mode === 'navigate'` 分支无 `cache.put` 调用
- [ ] `public/sw.js` 中 `KILL_SWITCH` 默认值为 `false`（除非当前 PR 明确是在执行逃生流程）
- [ ] `public/sw.js` 中 `if (KILL_SWITCH)` 分支无 `self.addEventListener('fetch', ...)`
- [ ] `scripts/inject-sw-build-id.mjs` 单测全过（`npm test`）
- [ ] `npm run build` 成功结束，无 `inject-sw-build-id` 抛错
- [ ] （部署后）在浏览器实际验证 AC2 / AC3 / AC4：能否正常拿到新部署、kill-switch 是否能救回旧 SW、离线是否仍有 index.html 兜底
- [ ] **（HTTP 层）** `curl -i <url>/sw.js` 响应头含 `Cache-Control: no-cache, no-store, must-revalidate`，**不**含 `ETag` / `Last-Modified`；带 `If-None-Match` 的条件请求不能返回 304（契约 4）

---

## 关键参考文件

- `public/sw.js` —— SW 主体（修改前先读完本 spec）
- `scripts/inject-sw-build-id.mjs` —— CACHE_NAME 注入脚本
- `scripts/inject-sw-build-id.test.mjs` —— 注入脚本单测
- `src/main.tsx` —— SW 注册 / dev 环境 unregister 入口
- `package.json` `scripts.build` —— 注入步骤的接力位置
- `.trellis/tasks/05-21-service-worker-kill-switch/prd.md` —— 本规范的事故复盘与决策来源
