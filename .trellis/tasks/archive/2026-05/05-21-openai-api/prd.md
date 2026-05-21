# 提示词优化功能（独立 OpenAI 兼容 API）

## Goal

为 image-playground 增加"提示词优化"能力：用户在 InputBar 中输入草稿提示词后，可一键调用一个**独立配置**的 OpenAI 兼容文本对话 API（`/v1/chat/completions`），由文本模型把简略 / 中文 / 模糊的描述改写为高质量的英文图像生成提示词，再回填到输入框。

为什么独立配置：
- 图像生成 Provider（OpenAI Images / Responses / Gemini）的端点与模型不一定具备文本对话能力，复用同一 Profile 会很别扭。
- 用户可能用一家便宜的文本模型（如本地 Qwen、DeepSeek、第三方 OpenAI 兼容网关）专门跑提示词改写，与图像 API 解耦。

## What I already know

- 项目是 React 19 + Zustand + IndexedDB 的纯前端 PWA，所有配置走 `AppSettings`，由 `normalizeSettings` 统一兜底。
- 现有 API 配置结构是 `profiles: ApiProfile[]` + `activeProfileId`，每个 Profile 含 `provider/baseUrl/apiKey/model/timeout`，OpenAI 还有 `apiMode/codexCli/apiProxy`。详见 `src/lib/api/apiProfiles.ts:20-74`、`src/types.ts:6-45`。
- 设置面板 `SettingsModal.tsx` 已有完整的 Profile CRUD、模型列表拉取（`listModels`）、Codex CLI 模式、API 代理开关，可在此处增加"提示词优化 API"配置区。
- InputBar 的提交按钮在 `src/components/InputBar/index.tsx:741-783`（桌面端）和 `:795-838`（移动端），是天然的"优化按钮"落点。
- 项目已有"提示词防改写"逻辑（Responses API 注入前缀），说明用户对"模型擅自改写提示词"是敏感的——优化功能必须是显式、可控、可撤销的，而不是隐式后处理。
- 现有 API 客户端集中在 `src/lib/api/`：`openaiCompatibleImageApi.ts` / `geminiImageApi.ts` / `listModels.ts`，新增 `optimizePromptApi.ts` 自然契合。

## Assumptions (temporary)

- 用户在乎"是不是英文 / 是不是结构化"的图像提示词，不是简单的"扩写中文"。
- 优化时是否带上当前参考图作为 vision 输入，是一个可选项（很多文本 API 不支持图像输入，强制带图会缩小可用模型范围）。
- "提示词优化"和"图像生成"的配置必须在同一个 Settings 面板内编辑，不再单独开窗口。

## Decisions（已与用户确认）

| 决策点 | 选择 |
|---|---|
| 配置形式 | **独立单一配置**：在 Settings 面板新增『提示词优化 API』区域，仅一份配置（不进入 profiles 数组） |
| 触发 UI | 在 InputBar 提交按钮**左侧**新增 ✨ 按钮（桌面端与移动端同步加） |
| 回写交互 | 弹**对比 Modal**：左『原提示词』、右『优化后』，用户主动点『采用』才覆盖 textarea |
| 参考图 | **不送**参考图，纯文本优化（兼容所有 OpenAI 兼容文本模型） |
| 系统提示词 | **可自定义** + 内置默认值；用户可在设置面板用 textarea 编辑 |
| 流式 | **启用** SSE 流式，Modal 内『优化后』栏目实时逐字填充，期间可取消 |

## Requirements

### 数据模型
- `AppSettings` 新增 `promptOptimizer: PromptOptimizerConfig`
  - `baseUrl: string`（默认 `https://api.openai.com/v1`）
  - `apiKey: string`
  - `model: string`（默认 `gpt-4o-mini` 或留空提示用户填写）
  - `timeout: number`（秒，默认 60）
  - `systemPrompt: string`（内置默认值；用户可编辑）
- `normalizeSettings` 兜底所有新字段；旧导出无此字段时填默认空配置
- 内置默认 systemPrompt 用英文，约束模型输出英文图像提示词

### Settings 面板
- 在『API 配置』section 之后新增独立 section『提示词优化 API』
- 字段：URL / Key（show/hide 按钮，复用现有交互）/ Model（带 `listModels` 刷新按钮）/ Timeout / SystemPrompt（multiline，可重置为默认）
- 与 dirty 检测、保存按钮接入

### InputBar
- 提交按钮左侧加 ✨ icon 按钮
- 禁用条件：`prompt.trim() === ''` 或 `promptOptimizer.apiKey` 为空 或 正在优化中
- 鼠标 hover 显示 tooltip（未配置时引导去设置）
- 点击后打开 `PromptOptimizerModal`

### PromptOptimizerModal（新组件）
- 上下/左右两栏：原提示词（只读）+ 优化后（流式追加，可滚动）
- 实时显示流式 token；底部有『取消』『采用』
- 优化中：『采用』禁用，显示 spinner
- 优化完成：『采用』高亮可点
- 关闭 Modal / Esc / 『取消』：中止 fetch（AbortController），不修改 prompt
- 『采用』：把优化结果写入 `setPrompt`，关闭 Modal，toast 成功
- 错误：在 Modal 内显示错误信息，提供『重试』；不弹 toast

### API 客户端
- 新增 `src/lib/api/optimizePromptApi.ts`，导出 `optimizePromptStream(config, userPrompt, opts: { signal, onDelta })`
- 走 `POST {baseUrl}/chat/completions`，`stream: true`，解析 SSE `data:` 行的 `choices[0].delta.content`
- 兼容 baseUrl 末尾带不带 `/v1`（复用 `normalizeBaseUrl` 思路）
- 错误：401/403/404/5xx/超时/CORS 均抛带可读消息的 Error

### 测试
- `optimizePromptApi.test.ts`：mock fetch + ReadableStream，验证 delta 拼接、错误抛出、abort 行为
- `apiProfiles.test.ts`（扩展）：normalizeSettings 对缺失/异常 promptOptimizer 字段的兜底

## Acceptance Criteria

- [ ] 设置面板出现『提示词优化 API』section，可独立配置 URL/Key/Model/Timeout/SystemPrompt 并保存
- [ ] InputBar 提交按钮左侧新增 ✨ 按钮（桌面 + 移动端均渲染）
- [ ] 未填 Key 或 prompt 为空时 ✨ 按钮禁用，hover 显示原因
- [ ] 点击 ✨ 打开 Modal，流式 token 实时显示在右栏
- [ ] 点击『采用』后 textarea 内容被替换，关闭 Modal，toast 提示成功
- [ ] 点击『取消』/ Esc / 关闭：textarea 不变，进行中的请求被 abort
- [ ] 网络/鉴权错误在 Modal 内显示可读消息 + 重试按钮
- [ ] 旧版本无 `promptOptimizer` 字段的 settings 导入后不报错，字段为默认空值
- [ ] `optimizePromptApi.test.ts` 与 `apiProfiles` 新字段单测通过

## Definition of Done

- 类型检查、`npm run test`、`npm run build` 均通过
- README 增补"提示词优化"段落
- IndexedDB / localStorage schema 变更向后兼容

## Out of Scope (explicit)

- 不做"提示词模板库"或"提示词历史记录"
- 不做"自动优化"（每次提交前隐式改写） —— 必须显式触发
- 不集成本地 LLM / 浏览器内推理
- 不做 prompt 翻译以外的多语言切换 UI

## Technical Notes

- 关键文件：`src/types.ts`、`src/lib/api/apiProfiles.ts`、`src/components/SettingsModal.tsx`、`src/components/InputBar/index.tsx`、`src/store.ts`
- 新增文件预计：`src/lib/api/optimizePromptApi.ts`、`src/lib/api/optimizePromptApi.test.ts`
- Settings schema 需新增字段（具体形态待确认），导入导出兼容由 `normalizeSettings` 兜底
- 现有 Toast / ConfirmDialog / Tooltip 组件可直接复用

## Research References

无需外部调研：实现路径完全在项目现有架构内（settings normalize + zustand store + 新 API client + 新 Modal 组件）。OpenAI Chat Completions SSE 协议是公开稳定标准，按 `data: {json}\n\n` 行解析即可。

## Decision (ADR-lite)

**Context**：项目需要提示词优化能力，但图像 API（Images / Responses / Gemini）和文本 chat API 在端点和模型上不共用，且用户对"模型擅自改写"敏感（项目已有防改写前缀逻辑）。

**Decision**：
1. 提示词优化 API 与图像 profiles **完全解耦**，作为 `AppSettings.promptOptimizer` 单一独立配置。
2. 触发显式（按钮）、结果显式（对比 Modal 用户主动采用），不做隐式后处理。
3. 流式 SSE + AbortController，保证可中断与即时反馈。

**Consequences**：
- 简化心智：用户配置图像 Provider 不会被文本配置干扰。
- Settings schema 新增一个字段，导入导出需在 `normalizeSettings` 兜底（已覆盖）。
- 若未来要支持"多套优化配置"，需重构为 profiles 数组（属于未来事）。
