# GPT Image Playground

基于 OpenAI 与 Google Gemini 图像接口的图片生成与编辑工作台。简洁的 Web UI，支持文本生图、最多 16 张参考图融合与遮罩编辑，所有数据存浏览器本地。

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
- **主题切换**：Header 一键切换 浅色 / 深色 / 跟随系统。

### 🔌 API 兼容增强
- **Codex CLI 兼容模式**：针对非标准 OpenAI 网关，自动屏蔽无效的 `quality` 参数；Images API 多图请求拆分为并发单图；提示词前注入防改写指令。
- **提示词防改写保护**：Responses API 始终注入防改写前缀；Codex CLI 模式下 Images API 同等保护。
- **API 代理转发**：可让浏览器请求同源的 `/api-proxy/` 路径，由部署环境代理转发到真实 API，绕过 CORS（需运行环境支持）。
- **智能诊断提示**：检测到接口返回提示词被改写或缺少标准字段时，主动提示是否开启 Codex CLI 模式。

### 🔒 隐私与本地优先
- 任务记录、生成图片、API 配置全部存浏览器（IndexedDB + localStorage），**不经过任何第三方服务器**。
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

### URL 查询参数快速填充

适合创建书签或外部系统集成：

| 参数 | 示例 | 作用 |
|---|---|---|
| `apiUrl` | `?apiUrl=https://example.com/v1` | 覆盖当前激活 profile 的 API URL |
| `apiKey` | `?apiKey=sk-xxxx` | 覆盖当前激活 profile 的 API Key |
| `apiMode` | `?apiMode=images` 或 `?apiMode=responses` | 切换 OpenAI 接口模式（默认 `images`） |
| `codexCli` | `?codexCli=true` | 强制开启 Codex CLI 兼容模式 |
| `provider` | `?provider=openai` 或 `?provider=gemini` | 切换 Provider 类型 |

集成示例（如 New API 等聊天系统中以 URL 形式跳转）：

```text
https://你的部署地址?apiUrl={address}&apiKey={key}
```

---

## 💻 技术栈

- **前端框架**：[React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **构建工具**：[Vite](https://vite.dev/)
- **样式方案**：[Tailwind CSS 3](https://tailwindcss.com/)
- **状态管理**：[Zustand](https://zustand.docs.pmnd.rs/)
- **拖拽交互**：[dnd-kit](https://dndkit.com/)
- **本地数据**：IndexedDB + localStorage
