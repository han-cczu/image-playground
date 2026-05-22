# 风格预设功能：底栏风格 pill 接入实际选择

## Goal

让底栏现在标着「无风格 · 风格预设功能尚未上线」的占位 pill 真正可用：
点击展开一个 popover，用户能从 8 个预设风格 + 「无风格」共 9 个选项里选一个，
选择会作为风格修饰应用到 prompt 上。

直接动机：之前 ui-ikun-style-refresh 任务（PRD D2 / A6 / Out of Scope）刻意把"8 种风格预设"延后，
现在所有上游 layout / 数据层 / 美化已就绪，可以补上业务实现。

## What I already know

### 当前占位代码

- `src/components/InputBar/index.tsx:979-992` —— 占位 pill：disabled + tooltip "风格预设功能尚未上线"
- 旁边模型 pill（`:974-976`）、比例 pill（`:994-1009`）、分辨率/优化 pill 都已是 working popover，**复用同一套结构和 token**
- popover 互斥状态走 `openMenu: 'model' | 'resolution' | 'advanced' | ... | null`（见 component-guidelines.md 已沉淀的 pattern），新增 `'style'` literal 即可

### 数据层现状

- `src/types.ts:61-68` `TaskParams` 含 size/quality/output_format/output_compression/moderation/n。**没有 style 字段**。
- `src/types.ts:70-77` `DEFAULT_PARAMS` 对应初始值
- params 走 zustand-persist（key=`image-playground`，自动持久化）
- `src/lib/taskRuntime.ts:382` 提交时 `prompt: prompt.trim()` 直接落到 `task.prompt`
- task 里也没风格字段，需要看是否扩 `TaskRecord`

### 项目导出 / 导入

- `src/lib/exportImport.ts` 的 `redactSettingsForExport` 主要负责 secret 字段脱敏（apiKey 等）
- 新增非 secret 的 `stylePreset` 不需要脱敏，但 schema 要保持向后兼容（旧导出包没有此字段时不能炸）

### 提示词优化器交互

- 已有 `PromptOptimizerModal` 走独立 OpenAI API 把用户原始 prompt"优化"为更详细的版本
- 风格预设作用于**最终提交的 prompt**，与"优化"是不同的层。需要确认两者的合作顺序（优化 → 加风格前缀？还是反过来？）

## Assumptions (temporary, to validate)

- A1 风格列表**硬编码 8 种**写在代码里，**MVP 不做用户自定义风格库**（与 PRD `00-bootstrap` 风格一致：先实证，后泛化）
- A2 8 种风格选项参考 IkunImage 截图常见组合：写实 / 动漫 / 油画 / 水彩 / 赛博朋克 / 像素 / 极简 / 胶片（**待用户拍板，否则用此默认**）
- A3 风格作用方式是**前缀拼接到 prompt** 给 API（不调任何"风格" API 字段，因为 OpenAI Image / Gemini 都没有原生 style 参数）
- A4 选中风格在 pill 上回显（`无风格` → `动漫风`），文案对齐 IkunImage 截图
- A5 风格选择持久化到 `params` 中（与其它参数同生命周期）

## Open Questions

- ~~[BLOCKING] 风格注入策略~~ → **已锁定：方案 A（task 独立字段 + API 调用前拼接）**
- ~~[PREFERENCE] 8 种风格组合~~ → **已锁定：权重偏写实类（见 STYLE_PRESETS）**

## Requirements

- R1. 风格 pill 解除 disabled，点击弹 popover（结构参考 `AdvancedParamsPopover.tsx`）
- R2. 9 选项：无风格 + 8 写实偏向风格
- R3. `TaskParams` 加 `stylePreset?: string`（写入风格 key，undefined = 无风格）
- R4. `TaskRecord` 同步加 `stylePreset?: string`（retry / 复制时风格继承）
- R5. API 调用前拼接：`finalPrompt = stylePreset ? `${STYLE_PROMPTS[stylePreset]}, ${prompt}` : prompt`
- R6. popover 加入 `openMenu` 互斥状态（新增 `'style'` literal）
- R7. popover 遵循 Esc + outside-click + cleanup（component-guidelines.md 已沉淀）

## STYLE_PRESETS（权重偏写实类）

| key | 中文 label（pill 显示） | 英文修饰词（拼到 prompt 前） |
|---|---|---|
| `photoreal` | 写实摄影 | `photorealistic, sharp focus, natural lighting, high detail` |
| `film` | 胶片 | `shot on 35mm film, kodak portra 400, grainy, soft contrast, vintage` |
| `portrait` | 人像 | `portrait photography, 85mm lens, shallow depth of field, studio lighting` |
| `classical-oil` | 古典油画 | `classical oil painting, renaissance style, rich texture, dramatic chiaroscuro` |
| `watercolor` | 文艺水彩 | `watercolor painting, soft wash, paper texture, gentle gradients, artistic` |
| `industrial` | 工业设计图 | `industrial design sketch, technical drawing, isometric, clean line art, blueprint style` |
| `architecture` | 建筑渲染 | `architectural rendering, photorealistic, octane render, golden hour lighting` |
| `product` | 产品摄影 | `product photography, white seamless background, soft box lighting, commercial` |

## Acceptance Criteria

- [ ] AC1 点击 pill 弹 popover，9 选项可见可选；选中后 popover 关闭，pill 显示风格中文名
- [ ] AC2 持久化：刷新页面后 pill 仍显示上次选择
- [ ] AC3 提交任务时，选定风格作为英文前缀拼进 API 请求（task.prompt 保持用户原始输入不变）
- [ ] AC4 「无风格」时 prompt 不被任何前缀污染（finalPrompt === prompt）
- [ ] AC5 风格 popover 与其他 popover 互斥
- [ ] AC6 retry / 重新提交已有 task 时风格继承
- [ ] AC7 旧版用户首次打开：未升级前的 task / params 没 stylePreset → 按"无风格"展示，不抛错

## Technical Approach

### 1. 类型 / 常量（src/types.ts）

- `TaskParams` 增 `stylePreset?: string`
- `TaskRecord` 增 `stylePreset?: string`
- `DEFAULT_PARAMS` 不需要给默认值（`undefined` 即"无风格"，与旧数据天然兼容）

### 2. 风格常量（新文件或 types.ts 末尾）

```ts
export const STYLE_PRESETS = {
  photoreal:     { label: '写实摄影',   prompt: 'photorealistic, sharp focus, natural lighting, high detail' },
  film:          { label: '胶片',       prompt: 'shot on 35mm film, kodak portra 400, grainy, soft contrast, vintage' },
  portrait:      { label: '人像',       prompt: 'portrait photography, 85mm lens, shallow depth of field, studio lighting' },
  'classical-oil': { label: '古典油画', prompt: 'classical oil painting, renaissance style, rich texture, dramatic chiaroscuro' },
  watercolor:    { label: '文艺水彩',   prompt: 'watercolor painting, soft wash, paper texture, gentle gradients, artistic' },
  industrial:    { label: '工业设计图', prompt: 'industrial design sketch, technical drawing, isometric, clean line art, blueprint style' },
  architecture:  { label: '建筑渲染',   prompt: 'architectural rendering, photorealistic, octane render, golden hour lighting' },
  product:       { label: '产品摄影',   prompt: 'product photography, white seamless background, soft box lighting, commercial' },
} as const

export type StylePresetKey = keyof typeof STYLE_PRESETS
```

放置位置：建议 `src/lib/stylePresets.ts`（独立文件，跨组件/runtime 都可 import）。

### 3. Popover 组件（src/components/InputBar/StylePickerPopover.tsx）

参考 `AdvancedParamsPopover.tsx` 的结构：anchorRef + onClose + Esc/outside-click。
内容：9 行 list（无风格 + 8 预设），role="listbox"，选项 role="option" + aria-selected。

### 4. 互斥状态（src/components/InputBar/index.tsx）

- `openMenu` 联合类型扩 `'style'` literal
- 风格 pill 解除 disabled，onClick toggle('style')
- pill label 显示 `params.stylePreset ? STYLE_PRESETS[params.stylePreset].label : '无风格'`
- 删除 disabled 样式 / tooltip / aria-disabled

### 5. Prompt 注入（src/lib/api/openaiCompatibleImageApi.ts 或 taskRuntime 的 API 拼装点）

```ts
function buildFinalPrompt(prompt: string, stylePreset?: string): string {
  if (!stylePreset || !(stylePreset in STYLE_PRESETS)) return prompt
  return `${STYLE_PRESETS[stylePreset as StylePresetKey].prompt}, ${prompt}`
}
```

抽成纯函数方便单测。在真正发请求处调用（不要污染 task.prompt 存储）。

### 6. 单测（src/lib/api/stylePresets.test.ts）

- `buildFinalPrompt('cat', undefined)` === `'cat'`
- `buildFinalPrompt('cat', 'film')` === `'shot on 35mm film, ..., vintage, cat'`
- `buildFinalPrompt('cat', 'invalid-key')` === `'cat'`（兜底）

## Decision (ADR-lite)

**Context**: ui-ikun-style-refresh 任务里 8 种风格预设刻意延后（PRD D2/A6），现底栏 layout 与互斥 popover 模式已就绪，可补业务。

**Decision**: 走"独立字段 + API 调用前拼接英文修饰词"路线（方案 A）。8 种风格硬编码偏写实类组合（写实摄影 / 胶片 / 人像 / 古典油画 / 文艺水彩 / 工业设计图 / 建筑渲染 / 产品摄影），pill 中文展示、修饰词全英文。

**Consequences**:
- ✅ task.prompt 保持用户原始输入，对话标题截取、retry 复用、prompt 优化各路径不被污染
- ✅ 旧数据天然兼容（stylePreset 缺失 = 无风格）
- ✅ 未来要"用户自定义风格库"时，只需把 STYLE_PRESETS 从 const 改为读 settings 字段
- ⚠️ TaskParams + TaskRecord 各扩一字段，retry / 复制 task 路径需要同步带上 stylePreset

## Definition of Done

- typecheck / test / build 全绿
- 手动验证：所有 9 种选项都能选中 + 提交 + 看到效果（无风格 + 8 风格）
- 至少一个单测覆盖 prompt 注入逻辑（如果走 task 字段路线，单测注入函数）
- 暗色模式 popover 样式与其他 popover 一致
- 必要时更新 `.trellis/spec/frontend/component-guidelines.md`（如发现新模式）

## Out of Scope (explicit)

- ❌ 用户自定义风格库（添加 / 编辑 / 删除自己的风格） —— 留作未来任务
- ❌ 风格组合（同时叠加多种风格）—— MVP 单选
- ❌ 风格预览缩略图 / 示例图 —— pill + popover 只显示文字
- ❌ AI 推荐"最合适的风格"基于当前 prompt —— 留作未来任务
- ❌ 改 OpenAI / Gemini 任何 API 调用参数（只在前端拼 prompt）
- ❌ 与 PromptOptimizerModal 的深度集成（如"优化后自动加风格"）—— MVP 两个独立功能，谁先谁后由用户操作顺序决定

## Technical Notes

### 注入策略 A/B 对比

**A. 独立字段路线**（推荐）

- `TaskParams` 加 `stylePreset?: string`（null = 无风格）
- `TaskRecord` 跟着扩展同字段（task 上也存，retry 时能精确还原）
- 在 `src/lib/api/` 提交前拼接：`finalPrompt = stylePreset ? `${STYLE_PREFIX[stylePreset]}，${prompt}` : prompt`
- 优点：`task.prompt` 保持用户原始输入（编辑/复用/搜索/对话标题截取都干净）
- 缺点：多一个字段、多处要记得 spread

**B. 字符串拼接路线**

- 提交时直接 `prompt: stylePreset ? `${STYLE_PREFIX}，${prompt.trim()}` : prompt.trim()`
- 优点：简单，没有 schema 改动
- 缺点：用户看到自己的 prompt 被改了；对话标题截取会带上风格前缀；retry 时风格被"焊死"在 prompt 里，二次修改风格变成手工删除字符串

### 关键文件

- `src/components/InputBar/index.tsx` —— pill 改 working + 新增 popover
- `src/types.ts` —— 扩 `TaskParams` 与 `TaskRecord`（若选 A）
- `src/lib/taskRuntime.ts:380-400` —— task 构造点，按策略注入
- `src/lib/api/openaiCompatibleImageApi.ts` —— 真正发请求处，可能在这拼最终 prompt
- `src/components/InputBar/` —— 新建 `StylePickerPopover.tsx`，结构对齐 `AdvancedParamsPopover.tsx`

### 风险

- popover 弹出位置：第 2 个 pill 的 popover 在 desktop 上可能撑到 sidebar 之外，需要 viewport 边界检查（参考现有 popover 实现）
- a11y：popover 自身要 role="dialog" 或 role="listbox"，选项要 role="option" + aria-selected
- 移动端 < md 时所有 pill 横向滚，popover 弹出位置需测试

## Research References

（风格预设是常见 UI 模式，本任务不需要 trellis-research 子代理调研。注入策略本质是项目内决定，由 PRD 列出的两个候选直接选）
