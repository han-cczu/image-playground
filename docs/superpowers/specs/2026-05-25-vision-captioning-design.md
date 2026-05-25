# 图生文 / 反推提示词（vision captioning）设计

- 日期：2026-05-25
- 状态：待评审
- 范围：上传/选中一张图片 → 调用支持 vision 的 chat 模型 → 反推出一段可直接用于文生图的英文提示词，弹窗对比后由用户「替换 / 追加」到提示词框。

## 1. 背景与目标

工作台已有「提示词优化」（草稿文本 → 改写）。本功能解决相反方向的痛点：**「看到一张喜欢的图，但不知道怎么描述」**——把图片反推成结构化英文提示词。

技术上复用刚交付的「优化器多配置」基建思路：反推走 OpenAI 兼容 chat completions（与优化器同协议），只是 user message 带一张图（vision 格式）。

**目标**：为反推提供一套**独立的多配置系统**（与优化器解耦），并提供右键菜单 + 底栏上传两个入口，弹窗流式展示反推结果。

**明确不做（非目标）**：
- 不支持 Gemini / 非 chat 接口（与优化器一致，仅 OpenAI 兼容 chat completions + vision）。
- 不做批量反推（一次一张）。
- 不改动图像生成流程。
- 不泛化优化器的数据层归一化/合并逻辑（见 §3 方案 A）。

## 2. 现状盘点（可复用件）

- `optimizePromptStream(config, userPrompt, {signal, onDelta})`（`src/lib/api/optimizePromptApi.ts`）：OpenAI chat completions 流式调用，含 SSE 行解析、超时/外部 abort 骨架、可读错误。反推的 API 实现直接以它为模板。
- 优化器多配置（`src/lib/api/apiProfiles.ts`）：`PromptOptimizerProfile`、`createDefaultOptimizerProfile`、`normalizeOptimizerProfile`、`getActiveOptimizerProfile`、`normalizeSettings` 迁移、`mergeImportedSettings` 去重合并、`redactSettingsForExport` 脱敏。反推数据层平行克隆这一整套。
- `OptimizerProfileSelector`（`src/components/SettingsModal/OptimizerProfileSelector.tsx`）：无服务商徽标的命名配置下拉。本设计将其泛化为通用组件复用（§4.4）。
- `PromptOptimizerModal`（`src/components/PromptOptimizerModal.tsx`）：流式展示 + 采用。反推 modal 以它为模板。
- `inputImages: { id, dataUrl }[]`：参考图自带 dataUrl。
- `ImageContextMenu`（`src/components/ImageContextMenu.tsx`）：全局右键任意 `<img>`，现有「复制/下载/编辑」。`menuInfo.src` 为图片 URL（可能是 object URL），可 `fetch → blob → FileReader` 转 base64 data URL。
- `ui.ts` slice：`showPromptOptimizer` 等 UI 开关、`showToast`、`setConfirmDialog`。
- InputBar pill 行（`PillRow`）：现有「优化」按钮 `onOptimize`。

## 3. 采用方案

**独立的多配置系统（与优化器同构、数据彼此独立），`captioner` 字段为激活配置的派生镜像。** 与优化器一致地复刻「flat 镜像 + profiles[]」模式，使（若有）消费方只读镜像。

**代码复用＝方案 A（克隆数据层 + 共用选择器）**：
- 数据层（types / normalize / migrate / merge / redact）**平行克隆**优化器实现，各自独立字段，**不改动刚合并、被测试守护的优化器归一化/合并代码**。
- UI 选择器**泛化为通用 `NamedProfileSelector`**（接收 `{ id; name }[]`），优化器与反推共用——纯展示组件、零逻辑、低风险，消掉最明显的 UI 重复。

（已否决：方案 B「连数据层也彻底泛化」会侵入式改写刚合并的优化器 normalize/merge，风险与工作量更大；方案 C「反推复用优化器 profiles」违背用户已确认的「独立配置」决策。）

## 4. 详细设计

### 4.1 数据模型（`src/types.ts`）

```ts
/** 反推提示词 API 的独立配置（OpenAI 兼容 chat completions + vision） */
export interface CaptionerConfig {
  baseUrl: string
  apiKey: string
  model: string
  /** 秒 */
  timeout: number
  /** 用户可自定义的反推系统提示词 */
  systemPrompt: string
}

/** 反推提示词的命名配置（多配置切换用） */
export interface CaptionerProfile extends CaptionerConfig {
  id: string
  name: string
}
```

`AppSettings` 增加三个字段（与优化器三件套并列）：
```ts
  /** 派生镜像：当前激活的反推配置 */
  captioner: CaptionerConfig
  captionerProfiles: CaptionerProfile[]
  activeCaptionerProfileId: string
```

> 字段形态与 `PromptOptimizerConfig`/`PromptOptimizerProfile` 完全相同，但保持为**独立类型**（语义不同、便于各自演进），不强行合并基类。

### 4.2 归一化与迁移（`src/lib/api/apiProfiles.ts`）

平行克隆优化器实现：
- 常量 `DEFAULT_CAPTIONER_PROFILE_ID = 'default-captioner'`、`DEFAULT_CAPTIONER_MODEL`（建议 `gpt-4o-mini`，vision-capable）、`DEFAULT_CAPTIONER_TIMEOUT`（60）、`DEFAULT_CAPTIONER_SYSTEM_PROMPT`（见 §4.7）。
- `createDefaultCaptioner(overrides?)`（对应 `createDefaultPromptOptimizer`）、`normalizeCaptioner(input)`（对应 `normalizePromptOptimizer`）。
- `createDefaultCaptionerProfile(overrides?)`、`normalizeCaptionerProfile(input)`、`getActiveCaptionerProfile(settings)`。
- `normalizeSettings` 增加 captioner 迁移块（与优化器同构）：
  - `captionerProfiles`：`record.captionerProfiles` 非空数组 → 逐项 normalize；否则用 `normalizeCaptioner(record.captioner)` 建单个 `{ id: DEFAULT_CAPTIONER_PROFILE_ID, name: '默认', ... }`（**老用户无感**：无该字段时落默认配置）。
  - `activeCaptionerProfileId`：命中则用，否则 `captionerProfiles[0].id`。
  - `captioner` 镜像：从激活配置派生。
- `DEFAULT_SETTINGS` 经 normalize 自然带上 captioner 三件套。

### 4.3 导入导出

- `redactSettingsForExport`（`exportImport.ts`）：除现有脱敏外，对 `captionerProfiles` 逐项清空 `apiKey`，并清空 `captioner` 镜像 apiKey。
- `mergeImportedSettings`（`apiProfiles.ts`）：克隆优化器的合并（`getCaptionerProfileDedupKey` = baseUrl+apiKey+model；`dedupeCaptionerProfiles`；`isDefaultCaptionerProfile`；`hasOnlyDefaultCaptionerProfiles`；`createImportedCaptionerProfileId`），在非 fresh 分支独立合并 captioner profiles。

### 4.4 通用选择器（泛化 `OptimizerProfileSelector` → `NamedProfileSelector`）

- 新建 `src/components/SettingsModal/NamedProfileSelector.tsx`，props：`profiles: { id: string; name: string }[]` + 现有 `activeProfileId/open/onOpenChange/onSelect/onCreate/onDelete`。结构与现 `OptimizerProfileSelector` 完全一致（无徽标）。
- 删除 `OptimizerProfileSelector.tsx`，把优化器区块改用 `NamedProfileSelector`（`PromptOptimizerProfile[]` 满足 `{id,name}` 结构，可直接传）。
- 反推区块同样用 `NamedProfileSelector`。

### 4.5 反推 API（新 `src/lib/api/captionImageApi.ts`）

```ts
export async function captionImageStream(
  config: CaptionerConfig,
  imageDataUrl: string,
  options?: { signal?: AbortSignal; onDelta?: (chunk: string) => void },
): Promise<string>
```
- 以 `optimizePromptStream` 为模板：相同的 `buildChatCompletionsUrl`、超时/外部 abort、SSE 解析、错误处理。
- 校验：缺 apiKey → 抛「未配置 API Key」；缺 imageDataUrl → 抛「未选择图片」。
- 请求体 messages：
  ```
  [
    { role: 'system', content: config.systemPrompt },
    { role: 'user', content: [
        { type: 'text', text: '<固定引导语，如 Describe this image as an image-generation prompt.>' },
        { type: 'image_url', image_url: { url: imageDataUrl } },
    ]},
  ]
  ```
  `stream: true`，`model: config.model.trim() || DEFAULT_CAPTIONER_MODEL`。
- 复用现有 SSE 解析（`choices[].delta.content`）。

### 4.6 UI

**UI 状态（`ui.ts`）**：新增 `captionSource: string | null`（base64 data URL；非 null 即打开反推 modal）+ `setCaptionSource(src)`。不再单独加布尔开关。

**`ImageCaptionModal`（新组件，仿 `PromptOptimizerModal`）**：
- 由 `captionSource` 驱动；打开即对该图发起 `captionImageStream`。
- 左栏：源图预览；右栏：流式反推结果 + 生成中指示 / 错误 + 重试。
- 底部动作：**采用（替换提示词）/ 追加（拼到现有提示词后）/ 取消**。「追加」规则：现有提示词非空时以换行（`\n`）分隔后拼接反推结果，为空时等同「替换」。
- 用激活的反推配置（`settings.captioner`）。apiKey 为空时入口禁用 / 运行时报错（见入口）。

**入口**：
1. `ImageContextMenu` 增加「反推提示词」项：`fetch(menuInfo.src) → blob → FileReader → dataURL → setCaptionSource(dataUrl)`，并关闭菜单/lightbox。
2. InputBar `PillRow` 增加「反推」按钮：触发一个隐藏 `<input type="file" accept="image/*">`，选图后读为 dataURL → `setCaptionSource`。**不**加入 `inputImages`。按钮在反推 apiKey 未配置时禁用，tooltip 同优化器风格提示去设置配置。

### 4.7 默认反推系统提示词（英文）

要求模型把图片转写成单段、结构化、可直接用于文生图的英文提示词，**只输出提示词本身**（无前后缀/解释/markdown），覆盖主体、构图、光线、色彩、材质、风格、镜头等，控制在约 120 词内。（具体措辞在实现时定稿，遵循与 `DEFAULT_OPTIMIZER_SYSTEM_PROMPT` 一致的风格。）

### 4.8 消费方

无既有消费方读取 `captioner`（全新功能）。`ImageCaptionModal` 读 `settings.captioner`；InputBar 入口读 `settings.captioner.apiKey` 判断启用。

## 5. 边界与错误处理

- 老数据（无 captioner 字段）→ 迁移为单「默认」配置，零丢失。
- 至少保留 1 个反推配置：删除到剩 1 个时禁用删除（选择器 `length>1` + `deleteCaptionerProfile` 守卫双保护）。
- 激活 id 失效 → normalize 兜底回 `[0]`。
- 空 apiKey 不在保存时硬校验；运行时 `captionImageStream` 抛「未配置 API Key」。
- 反推模型非 vision-capable → API 报错，原样透传到 modal（可读错误）。
- 大图：直接传 data URL（与现有参考图一致，不额外压缩；MVP 不做尺寸预处理）。
- `ImageContextMenu` 在 iOS 触控/嵌入页的现有放行逻辑不变；反推项只在菜单已显示时出现。

## 6. 测试计划

- `apiProfiles.test.ts`：captioner 老数据迁移、多配置归一化与 active 兜底、`mergeImportedSettings`（fresh 整体采用 / 非 fresh 去重追加保留 active）。
- `exportImport.test.ts`：`redactSettingsForExport` 清空每个 captioner 配置及镜像的 apiKey。
- `captionImageApi.test.ts`（仿 `optimizePromptApi.test.ts`）：vision 消息体组装正确（system + user 含 image_url）、流式拼接、缺 apiKey/缺图报错、超时/abort。
- 全量 `npm run lint` + `npm run test` + `npm run build` 通过。
- 手动冒烟：右键反推、底栏上传反推、采用/追加/取消、设置里多配置增删切换、导出脱敏、导入合并。

## 7. 文件清单（预计）

- 修改：`src/types.ts`、`src/lib/api/apiProfiles.ts`、`src/lib/exportImport.ts`、`src/store/slices/ui.ts`、`src/components/ImageContextMenu.tsx`、`src/components/InputBar/index.tsx`、`src/components/InputBar/PillRow.tsx`、`src/components/SettingsModal/index.tsx`
- 新建：`src/lib/api/captionImageApi.ts`、`src/components/ImageCaptionModal.tsx`、`src/components/SettingsModal/CaptionerSection.tsx`、`src/components/SettingsModal/NamedProfileSelector.tsx`
- 删除：`src/components/SettingsModal/OptimizerProfileSelector.tsx`（被 `NamedProfileSelector` 取代）
- 挂载 `ImageCaptionModal` 于 App 根（与 `PromptOptimizerModal` 同处）。
- 测试：`captionImageApi.test.ts` 新增；`apiProfiles.test.ts`、`exportImport.test.ts` 扩充。
