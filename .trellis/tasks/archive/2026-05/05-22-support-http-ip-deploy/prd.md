# 正式支持 IP + HTTP 直连部署模式

## Goal

让用户在没有域名 / 不想配 HTTPS 的场景下，也能干净地用 IP + HTTP 直连访问 image-playground，
不再「能跑但悄悄丢功能 + console 报错 + 文档不提」。
目标：HTTPS 模式与 HTTP 模式同为一等公民，差异透明告知用户。

## What I already know

- **`Caddyfile`**（已存在）末尾有「本地无域名调试段」`:80 { reverse_proxy app:80 }` 但默认注释，需要用户手动放开。
- **`docker-compose.yml`** 三服务（app / cors-proxy / caddy），caddy 监听 80/443。
- **`src/main.tsx:9-21`** prod 模式无条件 `navigator.serviceWorker.register(...)`，HTTP+IP 下浏览器 reject Promise → `.catch` 落 `console.error('Service worker registration failed:', error)`，UI 无任何提示。
- **`public/sw.js`**：受 `service-worker.md` 三条契约保护，本任务**不能**改 sw.js 主体；改的应该是 sw.js 的**注册策略**和 UI 反馈。
- **secure context 影响**（HTTP + IP 时禁用）：Service Worker / PWA 安装 / `navigator.clipboard.write` / Web Share / `crypto.subtle`（部分）。`localStorage` / IndexedDB / `onPaste` 不受影响。
- **README 「Docker 部署」节**已存在，需要补 HTTP+IP 子节。
- **wrangler 部署路径**（Cloudflare Workers）天然 HTTPS，与本任务无关。

## Assumptions (temporary)

- A1 用户主要用例：内网部署 / VPS 没域名 / 公司 LAN —— 都是「我知道我在做什么，PWA 我不要」的成年人模式，不需要弹模态拦截，给个一行 banner 就好。
- A2 不允许引入新 npm 依赖。所有变化在 Caddyfile / docker-compose.yml / main.tsx / 一个新增小组件 / README。
- A3 service-worker.md 契约 1/2/3/4 不变；只动「是否注册 SW」与「注册失败的 UX」。
- A4 `npm run deploy`（Cloudflare）路径不动。

## Decisions

- **D1 部署形态 = docker compose profile B**：保留默认 `Caddyfile`（HTTPS）；新增 `Caddyfile.lan`（HTTP 监听 :80）。compose 默认 caddy 服务用 HTTPS Caddyfile；额外加 `caddy-lan` 服务挂在 `profiles: [lan]` 下，使用 `Caddyfile.lan`。互斥启动：默认 `docker compose up -d` 走 HTTPS；`docker compose --profile lan up -d` 走 HTTP。
- **D2 App 层 = 静默 skip + UI banner**：`main.tsx` register 前判 `window.isSecureContext`，非安全上下文 skip 注册（不再 console.error）。新增 `InsecureContextBanner.tsx` 顶部一行（与 sidebar 同色调），文案「当前为 HTTP 模式，PWA / 离线 / kill-switch 不可用」+ 关闭按钮；关闭状态写 zustand-persist 的新字段 `dismissedInsecureContextBanner: boolean`，刷新后保持关闭。
- **D3 sslip.io 进阶路径 = 纯文档**：README 「HTTP+IP」子节后追加「进阶：无域名但想要 HTTPS」小节，示范把 `your-domain.com` 替换为 `1.2.3.4.sslip.io` 即可让 Caddy 自动签 cert 走 HTTPS-over-IP。零代码改动。

## Requirements

- R1 新建 `Caddyfile.lan`：`:80 { reverse_proxy app:80 ; encode gzip ; header { -Server } }`，无 HTTPS / 无 ACME / 监听所有访问。
- R2 改 `docker-compose.yml`：现有 `caddy` 服务保持现状；新增 `caddy-lan` 服务（image: caddy:2-alpine）挂 `Caddyfile.lan`，`ports: ["80:80"]`，`profiles: [lan]`（默认不启）；同时给现有 `caddy` 服务加 `profiles: [https, default]` 或等价让默认 profile 启它。两服务互斥：lan profile 启 caddy-lan 不启 caddy；默认 profile 反之。
- R3 改 `src/main.tsx:9-21`：在 `serviceWorker.register` 外层加 `if (window.isSecureContext)` 包裹；非安全上下文 skip，不输出 error。
- R4 新建 `src/components/InsecureContextBanner.tsx`：单行 sticky banner，文案「⚠️ 当前 HTTP 模式，PWA 安装 / 离线访问 / kill-switch 不可用」+ 关闭按钮（×）+ 「了解更多」链接（可选，指向 README 锚点或外链）；`role="status"` + `aria-label`；与 EmptyState/Toast 同 token；仅在 `!window.isSecureContext && !dismissed` 时渲染。
- R5 改 `src/store.ts`：新增 `dismissedInsecureContextBanner: boolean` state + setter；`partialize` 把它加入持久化字段；`mergePersistedStoreState` 处理默认值 `false`。
- R6 改 `src/App.tsx`：在 Header 之上挂 `<InsecureContextBanner />`（不要包在 ErrorBoundary 内，理由：banner 是 recovery surface 性质，不应被 boundary 牵连；参考 `component-guidelines.md::Common Mistake: 把 Toast/ConfirmDialog 包进 ErrorBoundary`）。
- R7 改 `README.md` 「🐳 Docker 部署」节：
  - 顶部加 mode 选择速查（HTTPS / HTTP+IP / sslip.io HTTPS over IP）
  - 新增「HTTP + IP 直连模式」子节：`docker compose --profile lan up -d` + 浏览器访问 `http://<服务器 IP>` + 明示丢失能力
  - 新增「进阶：无域名但想要 HTTPS（sslip.io）」子节：把 Caddyfile 域名换成 `1.2.3.4.sslip.io` 即可
- R8 追加 `service-worker.md` 契约 5：「main.tsx 注册 SW 前必须先 `if (window.isSecureContext)` 检查」（update-spec 阶段）。
- R9 不动 `public/sw.js` / `wrangler.jsonc` / `package.json scripts` / 现有 `Caddyfile` / `nginx.conf` / `cors-proxy.conf`。

## Acceptance Criteria

- [ ] AC1 `docker compose --profile lan up -d` 启动后浏览器访问 `http://<服务器 IP>`（或 `http://localhost`）能加载首页 + 主流程（生成图 / IndexedDB 保存 / 历史显示）正常。
- [ ] AC2 HTTP 模式下 console 无 `Service worker registration failed` 红错（main.tsx skip 注册）。
- [ ] AC3 HTTPS 默认模式（`docker compose up -d`）行为完全不变；window.isSecureContext === true → SW 注册成功 → kill-switch 工作。
- [ ] AC4 HTTP 模式下页面顶部显示一行 InsecureContextBanner，文案明示 PWA / 离线 / kill-switch 不可用；点 × 关闭后刷新仍保持关闭（zustand-persist 生效）。
- [ ] AC5 HTTPS 模式下 InsecureContextBanner **不渲染**（即便 dismissed 状态为 false）。
- [ ] AC6 README 「Docker 部署」节包含三种模式速查：HTTPS（默认）/ HTTP+IP（`--profile lan`）/ sslip.io HTTPS-over-IP（改 Caddyfile）；HTTP 模式明示丢失能力。
- [ ] AC7 现有 146 tests 全绿；新增至少 1 个测试覆盖 store 的 `dismissedInsecureContextBanner` 持久化默认值。
- [ ] AC8 `service-worker.md` 新增契约 5「main.tsx 注册 SW 前必须 isSecureContext 检查」+ 部署前自检清单加一项。

## Definition of Done

- typecheck / `npm run test` / `npm run build` 全绿（146+ 用例）。
- 手测：本地 `docker run -p 8080:80 image-playground` + 浏览器访问 `http://localhost:8080` 看 console 干净。
- 不引入 npm 依赖。
- 不改 sw.js 主体、不改 wrangler.jsonc、不改 package.json。

## Out of Scope (explicit)

- ❌ 自动检测「是否真的在 IP 模式」并切换 Caddyfile（用户手动选）。
- ❌ HTTP 模式下 fallback 实现"假离线"（用 localStorage 缓存 HTML）。
- ❌ 在 HTTP 模式自动尝试升级到 HTTPS（HSTS / upgrade-insecure-requests）。
- ❌ mkcert 自签证书自动化（高级用户自己搞）。
- ❌ Cloudflare Tunnel / Tailscale 类 zero-trust 隧道方案（独立专题）。

## Technical Notes

### 关键文件

- `Caddyfile` —— 反代配置（待 Q1 决定改动形式）
- `docker-compose.yml` —— 可能加 profile
- `src/main.tsx:9-21` —— SW 注册条件
- 可能新增 `src/components/InsecureContextBanner.tsx`（待 Q2）
- `README.md` —— 加 HTTP+IP 子段

### 三种 Caddyfile 形态对比

| 形态 | Caddyfile 写法 | 用法 | 风险 |
|---|---|---|---|
| **A 双 vhost 并存** | `your-domain.com {}` + `:80 {}` 都启用 | 一份 compose 跑两种，谁来就服务谁 | Caddy 拿 cert 失败时 :80 仍能用，但 cert 失败不易察觉 |
| **B docker compose profile** | `--profile lan` 启用 `caddy-lan` 服务用 `Caddyfile.lan`；默认 profile 用 `Caddyfile` | 显式切换；HTTPS / HTTP 两套互斥 | 多一个文件，多一个 compose 概念 |
| **C 文档化** | 用户自己注释/取消注释 | 零侵入 | 用户体验差，容易配错 |

### 三种 main.tsx 策略

| 策略 | 代码改动 | 用户体验 |
|---|---|---|
| **静默 skip** | `if (window.isSecureContext) register else skip` | 干净，但用户不知道丢了什么 |
| **静默 skip + console.info** | 同上 + `console.info('当前为 HTTP 模式，SW/PWA 已禁用')` | console 干净，懂技术的用户能查到 |
| **静默 skip + UI banner** | 同上 + 渲染 `<InsecureContextBanner>` 顶部一行可关闭提示 | 最完整，但侵入 UI |

### service-worker.md 契约影响

- 契约 1/2/3 是 sw.js 内部代码契约 → 本任务不动 sw.js，0 影响
- 契约 4（HTTP 层缓存）→ 本任务不动 nginx.conf，0 影响
- **新增隐含契约**：「main.tsx 注册 SW 之前必须先 isSecureContext 检查」—— 应该追加到 service-worker.md 的契约清单（spec update 阶段做）
