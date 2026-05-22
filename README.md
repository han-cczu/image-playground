# Image Playground

基于 OpenAI 与 Google Gemini 图像接口的图片生成与编辑工作台。简洁的 Web UI，支持文本生图、最多 16 张参考图融合与遮罩编辑，所有数据存浏览器本地。

在线访问：[https://image-playground.diaohan111.workers.dev/](https://image-playground.diaohan111.workers.dev/)

也可以用 [Docker 一键自部署](#-docker-部署) 到自己的服务器（含 CORS 代理 + 自动 HTTPS）。

---

## ✨ 核心特性

### 🎨 图像生成与编辑
- **多 Provider**：OpenAI 兼容接口（`Images API` / `Responses API` 双模） + Google Gemini，单次生成可一键切换。
- **参考图融合**：最多上传 16 张参考图，支持文件选择、剪贴板粘贴、整页拖拽。
- **可视化遮罩**：内置遮罩编辑器，自动预处理以符合官方分辨率与文件大小限制。
- **批量与迭代**：支持单次多图生成；一键将任意输出图转为参考图，无缝进入下一轮编辑。

### 🗂️ 历史与画廊
- **拖拽排序**：每张卡片右上角的 ⋮⋮ 手柄可调整顺序，全自定义编排；新生成的任务依旧自动落到最前。
- **批量选择**：桌面端支持鼠标拖拽框选 + `Ctrl/⌘` 连选，移动端支持侧滑多选。
- **筛选与搜索**：按状态过滤、收藏过滤、关键字搜索（提示词、参数）。
- **详情对照**：自动提取 API 响应中真实生效的尺寸、质量、耗时和 **API 改写后的提示词**，与你的请求参数高亮对比。
- **导出 / 导入**：一键打包全部记录与图片为 ZIP 备份，可在另一台设备导入恢复。

### ⚙️ 参数与配置
- **多 Profile 管理**：可保存多套 API URL / Key / 模型组合，快速切换。
- **从 API 拉取模型列表**：模型 ID 输入框旁的刷新按钮直接调 `/v1/models`，下拉选择即可填入。
- **智能尺寸控制**：1K / 2K / 4K 快速预设，自定义宽高自动规整到模型安全范围（16 的倍数、总像素校验等）。
- **提示词优化**：可独立配置一套 OpenAI 兼容的文本对话 API（chat completions），一键把简略草稿改写成结构化的英文图像提示词，弹窗对比新旧后由用户主动采用。
- **主题切换**：Header 一键切换 浅色 / 深色 / 跟随系统。

### 🔌 API 兼容增强
- **Codex CLI 兼容模式**：针对非标准 OpenAI 网关，自动屏蔽无效的 `quality` 参数；Images API 多图请求拆分为并发单图；提示词前注入防改写指令。
- **提示词防改写保护**：Responses API 始终注入防改写前缀；Codex CLI 模式下 Images API 同等保护。
- **API 代理转发**：可让浏览器请求同源的 `/api-proxy/` 路径，由部署环境代理转发到真实 API，绕过 CORS（需运行环境支持）。
- **智能诊断提示**：检测到接口返回提示词被改写或缺少标准字段时，主动提示是否开启 Codex CLI 模式。

### 🔒 隐私与本地优先
- 任务记录、生成图片、API 配置全部存浏览器（IndexedDB Blob 存储 + localStorage），**不经过任何第三方服务器**。
- 图片按 SHA-256 哈希去重，多任务引用同一张图只占一份空间。
- 支持作为 PWA 安装到桌面 / 主屏，离线可打开应用外壳。

---

## 🚀 本地开发与构建

**1. 环境准备与启动**

可在项目根目录新建 `.env.local` 配置默认 API URL：

```bash
VITE_DEFAULT_API_URL=https://api.openai.com/v1
```

安装依赖并启动开发服务器：

```bash
npm install
npm run dev
```

**2. 本地开发跨域代理（可选）**

如果开发时遇到 CORS 限制，可开启本地代理转发：

```bash
cp dev-proxy.config.example.json dev-proxy.config.json
```

修改 `dev-proxy.config.json` 中的 `target` 为真实接口地址，重启开发服务器，在页面设置中开启 **API 代理** 即可。仅在 `npm run dev` 阶段生效，打包产物不受影响。

**3. 构建静态产物**

```bash
npm run build
```

输出位于 `dist/` 目录，部署到任意静态文件服务器即可。

---

## 🛠️ API 配置与 URL 传参

点击右上角 **⚙️ 设置** 配置 Provider、密钥、模型等参数。

**支持的 Provider**

| 类型 | 接口 / 端点 | 说明 |
|---|---|---|
| OpenAI 兼容（Images API） | `/v1/images` | 使用 GPT Image 系列模型，如 `gpt-image-2` |
| OpenAI 兼容（Responses API） | `/v1/responses` | 使用支持 `image_generation` 工具的文本模型，如 `gpt-5.5` |
| Google Gemini | `generativelanguage.googleapis.com/v1beta` | 多模态图像模型，如 `gemini-2.5-flash-image`。不支持遮罩与 quality 参数；多图并发拆单 |

### URL 快速填充

适合创建书签或外部系统集成。密钥请放在 hash 中一次性传入，应用读取后会立即从地址栏清除。

| 参数 | 示例 | 作用 |
|---|---|---|
| `apiUrl` | `?apiUrl=https://example.com/v1` | 覆盖当前激活 profile 的 API URL |
| `apiKey` | `#apiKey=sk-xxxx` | 一次性写入当前激活 profile 的 API Key |
| `apiMode` | `?apiMode=images` 或 `?apiMode=responses` | 切换 OpenAI 接口模式（默认 `images`） |
| `codexCli` | `?codexCli=true` | 强制开启 Codex CLI 兼容模式 |
| `provider` | `?provider=openai` 或 `?provider=gemini` | 切换 Provider 类型 |

集成示例（如 New API 等聊天系统中以 URL 形式跳转）：

```text
https://image-playground.diaohan111.workers.dev/?apiUrl={address}#apiKey={key}
```

---

## 💻 技术栈

- **前端框架**：[React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **构建工具**：[Vite](https://vite.dev/)
- **样式方案**：[Tailwind CSS 3](https://tailwindcss.com/)
- **状态管理**：[Zustand](https://zustand.docs.pmnd.rs/)
- **拖拽交互**：[dnd-kit](https://dndkit.com/)
- **本地数据**：IndexedDB Blob 存储 + localStorage

---

## 🐳 Docker 部署

项目自带多阶段 `Dockerfile`、`nginx.conf`、`docker-compose.yml`、`Caddyfile`、`cors-proxy.conf`，可一键部署到任意支持 Docker 的服务器（VPS / 自建机），与现有 `npm run deploy`（Cloudflare Workers）路径互不影响。

> ⚠️ 浏览器需要 **HTTPS** 才能完整启用 Service Worker、IndexedDB Blob、剪贴板 API 等能力；建议直接用下方 docker-compose 全栈方案（自带 Caddy 自动证书）。

### 方式 A：单容器（快速试跑，无 HTTPS）

```bash
# 在仓库根目录
docker build -t image-playground .
docker run -d --name image-playground -p 8080:80 image-playground
# 访问 http://localhost:8080
```

镜像基于 `nginx:alpine`，体积约 30 MB 左右，已内置：

- SPA fallback（`try_files ... /index.html`）
- `/sw.js` 强制 `Cache-Control: no-cache, no-store, must-revalidate`（保留 kill-switch 逃生通道）
- `/assets/*` 长缓存 + `immutable`
- gzip 启用
- `/healthz` 健康检查

### 方式 B：docker-compose 全栈（推荐，含 HTTPS + CORS 代理）

包含三个服务：

| 服务 | 作用 |
|---|---|
| `app` | nginx:alpine 托管前端静态产物 |
| `cors-proxy` | nginx:alpine 反代到上游图像/文本 API，补 CORS 响应头 |
| `caddy` | 对外反向代理 + 自动 Let's Encrypt HTTPS 证书 |

**步骤**：

1. 把代码 clone 到服务器，进入仓库根目录。
2. 编辑 `Caddyfile`，把两处 `your-domain.com` / `cors.your-domain.com` 改成你自己的域名（需提前把 A/AAAA 记录指向当前服务器公网 IP）：

   ```caddyfile
   your-domain.com {
       reverse_proxy app:80
   }
   cors.your-domain.com {
       reverse_proxy cors-proxy:80
   }
   ```

3. （可选）编辑 `cors-proxy.conf`，把 `$upstream` 改成你需要代理的 API：

   ```nginx
   # 默认：OpenAI
   set $upstream      "https://api.openai.com";
   set $upstream_host "api.openai.com";

   # 切换 Gemini：
   # set $upstream      "https://generativelanguage.googleapis.com";
   # set $upstream_host "generativelanguage.googleapis.com";
   ```

4. 启动：

   ```bash
   docker compose up -d --build
   ```

5. 首次访问 `https://your-domain.com`，Caddy 会自动签发证书。

### 在 SettingsModal 配合 CORS 代理使用

打开 ⚙️ 设置，把当前 profile 的 **API 地址** 改成你刚才部署的 CORS 代理子域名：

| 上游 | 填入的 API 地址 |
|---|---|
| OpenAI / OpenAI 兼容 | `https://cors.your-domain.com/v1` |
| Google Gemini | `https://cors.your-domain.com/v1beta` |
| 自定义网关 | `https://cors.your-domain.com/<你的 path 前缀>` |

之后浏览器所有图像 API 请求都会走该子域名转发，绕开上游 CORS 限制。

> 同一个 CORS 代理容器一次只能对应一个上游 origin。如果你想同时代理多家，可在 `docker-compose.yml` 里复制一份 `cors-proxy` 服务并指向不同的 `*.conf`，再在 `Caddyfile` 里加一个新 vhost（如 `cors-gemini.your-domain.com`）。

### 维护与升级

- 拉取新代码后 `docker compose up -d --build` 即可滚动更新；旧版本 Service Worker 通过 `__CACHE_NAME__` 注入机制自动失效。
- 仅修改 `cors-proxy.conf` 时：`docker compose restart cors-proxy`。
- 仅修改 `Caddyfile` 时：`docker compose restart caddy`。

### 与 Cloudflare Workers 部署的关系

Docker 部署是**完全独立**的路径，不会影响 `wrangler.jsonc` / `npm run deploy`。两套部署可以并存。
