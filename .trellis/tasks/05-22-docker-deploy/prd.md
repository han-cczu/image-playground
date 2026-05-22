# Docker 部署支持

## Goal

让 image-playground 可以用 Docker 一键部署到自己的服务器，与现有 Cloudflare Workers 部署并存（`npm run deploy` 路径保留）。
本质是「静态文件托管」——项目无后端、纯 SPA、所有 API 调用浏览器直发。

## What I already know

- **wrangler.jsonc** 配置极简（14 行）：`assets` + SPA fallback，无 Worker code / binding / D1 / KV / R2 / env vars。
- **构建**：`npm run build` = `tsc -b && vite build && node scripts/inject-sw-build-id.mjs`。产物在 `dist/`。
- **dist 已被 gitignore**：Docker copy 路径不会带 stale build。
- **dev-proxy.config.json** 在 .gitignore 里（dev 阶段 vite plugin 代理用），与 prod Docker 无关。
- **Service Worker** (`public/sw.js`)：build 时由 `scripts/inject-sw-build-id.mjs` 注入 BUILD_ID。生产环境 sw.js **绝对不能被 HTTP 缓存**，否则 kill-switch（旧版本逃生通道）失效。
- **apiProxy 选项**：用户在 SettingsModal 切换的客户端 toggle，决定浏览器发请求时是否走某个用户填的 CORS 代理 URL。**不影响**本任务（代理是另外的服务，不一定要和本镜像同部署）。
- **README.md** 是中文，已有「在线访问」链接到 workers 域名，需要补 Docker 部署小节。

## Assumptions (temporary)

- A1 用户在自己服务器跑（VPS / 自建机），不打算 push 到 Docker Hub 之类公开 registry（除非 Q4 要做）。
- A2 用户期望 80/443 暴露，HTTPS 是基本需求（不上 HTTPS 就 SW + IndexedDB 不工作）。
- A3 不要破坏现有 `npm run deploy`（Cloudflare 路径）。
- A4 CI（GitHub Actions auto-build）可有可无；先不假设。

## Decisions

- **D1 MVP 范围 = B 中等**：Dockerfile + docker-compose 含 Caddy HTTPS 反代。不做 GitHub Actions auto-build（留作 follow-up）。
- **D2 app 静态服务器 = nginx:alpine**：~25MB，配置在 `nginx.conf`，Caddy 仅做外层反代 + HTTPS 自动 cert。两层职责分离。
- **D3 HTTPS 反代 = Caddy**（自动 Let's Encrypt cert，无需 certbot）。
- **D4 CORS 代理同 compose 部署**：加一个轻量 CORS 代理容器（基于 nginx `proxy_pass` 或 Caddy 反代），用户在 SettingsModal 的 apiProxy URL 填该代理。compose 里加 TODO 注释允许用户改 upstream（默认指向 `api.openai.com` + 备一行注释怎么改成 Gemini）。

## Requirements

- R1 多阶段 Dockerfile：`node:20-alpine` build → `nginx:alpine` serve。
- R2 `nginx.conf` 必须含：SPA fallback (`try_files $uri $uri/ /index.html`) / `/sw.js` `Cache-Control: no-cache, no-store, must-revalidate` / `/assets/*` `Cache-Control: public, max-age=31536000, immutable` / `gzip` 启用（vite 产物 ~530KB 压缩后 ~158KB）。
- R3 `.dockerignore` 排除 `node_modules/` `dist/` `.git/` `.trellis/` `dev-proxy.config.json` `.dev.vars*` `.env*` `.claude/` `*.test.*` `coverage/` 等。
- R4 `docker-compose.yml` 三服务：
  - `app`：nginx:alpine + dist 静态资源（COPY 自 builder stage）
  - `caddy`：caddy:alpine + Caddyfile，反代 app + cors-proxy，自动 HTTPS（用户填 `your-domain.com`）
  - `cors-proxy`：轻量 nginx/caddy 容器，`proxy_pass` 到上游（默认注释指向 `api.openai.com`，README 写如何改 Gemini 或加多个）
- R5 `Caddyfile`：两 vhost 示例 — `your-domain.com → app:80` / `cors.your-domain.com → cors-proxy:80`
- R6 `README.md` 加「Docker 部署」节，含可复制 compose up 命令 + 修改 Caddyfile 域名步骤 + apiProxy URL 在 SettingsModal 怎么填。
- R7 不破坏 `npm run deploy` / wrangler.jsonc / 任何 src 代码。
- R8 不引入 npm 依赖。
- R9 镜像体积：app + cors-proxy 各 ≤ 30MB；Caddy ~50MB；总 < 120MB。

## Implementation Plan（单 PR 足够，工作量小）

- 新文件：`Dockerfile`、`nginx.conf`、`.dockerignore`、`docker-compose.yml`、`Caddyfile`、`cors-proxy.conf`
- 改：`README.md` 加部署小节
- 不动：src/、scripts/、wrangler.jsonc、package.json

## Acceptance Criteria

- [ ] AC1 `docker build -t image-playground .` 在干净环境跑通；最终镜像 ≤ 30MB。
- [ ] AC2 `docker compose up -d` 三服务启动正常（app / caddy / cors-proxy）。
- [ ] AC3 浏览器访问 `http://localhost`（用户改 Caddyfile 改域名后 HTTPS 自动）加载首页 + SPA 路由 fallback 正常。
- [ ] AC4 `curl -I http://app:80/sw.js` 响应头含 `Cache-Control: no-cache` 类。
- [ ] AC5 `curl -I http://app:80/assets/<hash>.js` 响应头含 `immutable` 或 `max-age=31536000`。
- [ ] AC6 `npm run deploy` 命令仍可正常推 Cloudflare（功能不丢，wrangler.jsonc 不动）。
- [ ] AC7 README「Docker 部署」节包含：(a) 单容器 `docker build && docker run` / (b) docker-compose 全栈 / (c) Caddyfile 域名修改步骤 / (d) cors-proxy 上游修改 / (e) apiProxy URL 在 SettingsModal 怎么填。
- [ ] AC8 `cors-proxy` 默认 upstream 注释指向 `api.openai.com`；用户改 upstream 后 reload 容器即可。

## Definition of Done

- `docker build` 在干净环境跑通。
- 镜像体积 ≤ 50MB。
- 不动 `src/` / `package.json scripts` / `wrangler.jsonc`。
- 不引入 npm 依赖（Docker 配置全在 Dockerfile + nginx/caddy conf 里）。

## Out of Scope (explicit)

- ❌ Kubernetes / Helm chart。
- ❌ Docker Hub / ghcr.io 公开推送（除非 Q4 加 GitHub Actions）。
- ❌ 服务器侧 API 代理实现（用户的 apiProxy URL 是用户自配的）。
- ❌ 端口、域名、TLS cert 配置自动化（用户改 compose 文件即可）。

## Technical Notes

### 关键文件（即将创建）

- `Dockerfile` — 多阶段构建
- `nginx.conf` 或 `Caddyfile` — 静态服务器配置（基于 Q2）
- `.dockerignore` — 排除清单
- `docker-compose.yml`（基于 Q1 / Q3 决策可选）
- `.github/workflows/docker.yml`（基于 Q1 / Q4 决策可选）
- `README.md` — 部署小节

### 镜像 base 选项比较

| Base | 体积 | 配置难度 | HTTPS |
|---|---|---|---|
| `nginx:alpine` | ~25MB | 写 nginx.conf | 自配 certbot 或外部反代 |
| `caddy:alpine` | ~50MB | 写 Caddyfile（更简洁） | 自动 Let's Encrypt |
| `nginx:distroless` | ~15MB | 复杂（无 shell） | 同上 |

### 风险

- vite hash 文件名规则：`/assets/xxx-[hash].js` —— 静态服务器需正确匹配该路径前缀做永久缓存。
- `/sw.js` 在 `public/` 顶层，build 后落在 `dist/sw.js` —— 缓存规则要精确匹配该单文件。
- Service Worker scope：默认 `/`，路径匹配 sw.js 所在目录，不能在子路径部署除非 vite base 配置同步调整（这是 future evolution，不在 MVP）。

## Research References

（Docker 多阶段 + nginx/caddy 静态托管是成熟模式，不需要外部 research）
