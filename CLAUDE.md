# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

Image Playground——本地优先的图片生成/编辑工作台。React 19 + TypeScript + Vite + Tailwind CSS 3 + Zustand,无后端:对接 OpenAI 兼容图像接口(Images API / Responses API 双模)与 Google Gemini,所有用户数据(任务、图片、API 配置)只存浏览器(IndexedDB + localStorage)。

本仓库代码注释、commit 信息、UI 文案、文档全部使用中文(commit 标题的 type 前缀保留英文,如 `fix:` / `refactor:`)。注释风格偏重「为什么这么写/不这么写会出什么事故」,新增代码请保持同等密度与取向。

## 常用命令

```bash
npm run dev          # Vite 开发服务器
npm test             # vitest run 全量测试
npm run test:watch   # vitest watch 模式
npm run lint         # eslint src(CI 仅 error 失败;存量 warning 是已知基线)
npm run build        # tsc -b + vite build + SW build id 注入 + CSP hash 校验
npm run preview      # build 后用 wrangler dev 本地预览 Workers 形态
npm run deploy       # build + wrangler deploy(Cloudflare Workers,不经 CI 门禁)
npm run format       # prettier 格式化 src
```

单个测试文件:`npx vitest run src/lib/taskSort.test.ts`;单个用例:追加 `-t "用例名"`。

### 测试注意点

- **vitest 配置独立于 vite.config.ts**(见 `vitest.config.ts` 头注释):测试不加载 cloudflare 插件,`__DEV_PROXY_CONFIG__` 固定为 null。不要把测试改回去消费 vite.config.ts。
- 测试默认 node 环境;需要 DOM 的测试文件在首行加 `// @vitest-environment jsdom`。
- IndexedDB 相关测试用 `fake-indexeddb`;`db.ts` / `taskRuntime.ts` 暴露了 `__resetDbCacheForTests` / `resetTaskRuntimeForTest` 等仅测试用的复位钩子,跨用例状态污染先查这里。
- `scripts/*.test.mjs`(构建脚本自己的测试)也在 `npm test` 中运行。

## 架构

### 数据分层(最重要的一条线)

两套持久化,职责严格分开:

- **localStorage(zustand-persist)**:settings/参数/UI 偏好等小数据。单 store 在 `src/store/index.ts`,由四个 slice 组成(`store/slices/` 下 settings / tasks / ui / filters)。持久化白名单在 `src/store/persist.ts` 的 `partialize`;恢复时的字段归一化/瞬态字段复位在 `mergePersistedStoreState`。**新增需要持久化的 store 字段必须同时改这两处**,并对旧数据缺字段做显式归一化。
- **IndexedDB(`src/lib/db.ts`,库名 image-playground,v2)**:tasks / images / conversations 三个 store。图片以 Blob 存储,按 SHA-256 哈希去重,task 只存图片 id 引用;展示层经 `imageCache.ts` / `objectUrlCache.ts` 转 object URL。conversations 与 tasks 一样**不进 zustand-persist**。

### 任务运行时

`src/lib/taskRuntime.ts` 是核心:提交/重试/取消/批量调度、提示词通配展开(`{a|b}` 笛卡尔积,上限见 `promptExpand.ts`)、并发限流(`concurrency.ts`)、同步 HTTP 超时 watchdog。关键约定:**任务入队时固化当时的 ApiProfile**,排队中的任务不随 active profile 切换漂移。`store/index.ts` re-export 了 taskRuntime 与 exportImport 的全部公开函数,调用方统一从 `./store` import——保持这个路径稳定。

### API 层(`src/lib/api/`)

`index.ts` 的 `callImageApi` 按 provider 分流:

- `openaiCompatibleImageApi.ts`:Images / Responses 双模;Codex CLI 兼容模式(屏蔽 `quality`、多图拆并发单图、注入防改写前缀)在 `paramCompatibility.ts`。
- `geminiImageApi.ts`:Gemini 原生接口,不支持遮罩与 quality。
- `apiProfiles.ts`:多 profile 归一化/校验/切换,settings 的兼容性修复都在这里。
- 提示词优化器(`optimizePromptApi.ts`)与图片反推(`captionImageApi.ts`)各有独立的 API 配置,不复用图像 profile。
- 开发期 CORS 代理:复制 `dev-proxy.config.example.json` 为 `dev-proxy.config.json`,仅 `npm run dev` 生效。

### UI 原语(强约定)

- 弹窗一律基于 `src/components/Modal.tsx`;浮层定位用 `src/hooks/usePopoverPlacement.ts`、关闭行为用 `src/hooks/usePopoverDismiss.ts`。**不要为新弹窗/浮层另起骨架**。
- 大组件已按「容器 + 子组件 + hooks 子目录」拆分(InputBar / MaskEditorModal / SettingsModal / Lightbox / Sidebar / TaskCard / DetailModal),新逻辑优先放进对应 hooks 目录。
- 区域级 ErrorBoundary 包裹 sidebar / Header / 主区域 / InputBar / 各 Modal,新顶层区域要同样包裹。

### Service Worker / 构建链守卫

- `public/sw.js` 含 `__CACHE_NAME__` / `__PRECACHE_MANIFEST__` 占位符,构建后由 `scripts/inject-sw-build-id.mjs` 注入 git hash 与预缓存清单;CI 会 grep dist/sw.js 确认占位符已替换。
- `index.html` 的内联主题脚本受 CSP hash 锁定:改动它必须同步更新四处配置(`public/_headers`、`nginx-security-headers.inc`、`Caddyfile`、`Caddyfile.lan`)里的 sha256,否则 `npm run build` 在 `verify-csp-hash.mjs` 处硬失败。该文件被 .gitattributes 锁为 LF,不要改 EOL。
- `sw.js` 里的 `KILL_SWITCH` 常量是线上逃生通道(改 true 部署一次可远程注销所有用户的旧 SW),不要顺手删。

### 部署双轨

Cloudflare Workers(`wrangler.jsonc`,`npm run deploy`)与 Docker(`Dockerfile` + `docker-compose.yml` + Caddy/nginx/cors-proxy,三种 profile 模式)完全独立并存,改其一不要破坏另一套。CI(`.github/workflows/ci.yml`)跑 lint + test + build + SW 占位符校验。
