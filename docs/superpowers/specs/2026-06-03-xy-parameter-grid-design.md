# XY 参数网格(对照实验)设计

- 日期：2026-06-03
- 状态：待评审
- 范围：在「批量实验」方向上落地 XY 参数网格——选 1~2 个维度（X 轴、可选 Y 轴）、各维度选若干取值，笛卡尔积生成一批 task，以矩阵（行=Y 取值、列=X 取值）对照展示。建立在已有的批量地基（`batchId` + `enqueueTask` + `runEnqueuedTasks`）之上。
- 关系：本 spec 是「批量实验」特性的第二期（第一期=提示词通配批量地基，见 `2026-06-03-batch-experiment-foundation-design.md`）。

## 1. 背景与目标

批量地基已提供「一次提交 → 一批共享 `batchId` 的 task → 并发闸调度」的能力，但批量结果目前只是混在流式 grid 里的普通卡片。**XY 网格把它升级为「参数对照矩阵」**——这是 playground 类工具的灵魂功能：固定提示词，扫一个或两个维度，网格化对比哪组参数最优。

**目标**：让用户选 X 轴（必选，≥2 取值）+ 可选 Y 轴，对所选维度做笛卡尔积批量生成，并以矩阵对照展示、支持缺漏格补跑。

## 2. 设计探索方法

本设计经一轮多 agent design judge panel 产出：3 个独立角度（复用优先 / 独立矩阵视图 / 体验优先）各提完整方案，judge 4 维评分后综合。评分结论：

| 角度 | 可行性 | 架构契合 | 用户价值 | 成本(5=低) |
|---|---|---|---|---|
| 复用优先 / inline 聚合 | 5 | 5 | 4 | 5 |
| 独立矩阵全屏模态 | 4 | 3 | 4 | 2 |
| 体验优先 + manifest 表 | 4 | 3 | 5 | 2 |

**采用「复用优先」为骨架**，嫁接另两案的关键决策（见 §3）。

## 3. 采用方案

**inline 聚合，不新建视图/路由/store slice/DB 表。** XY 网格 = `submitTask` 之上的一个新批量生成器（复用 `batchId`/`enqueueTask`/`runEnqueuedTasks`）+ TaskGrid 内一个 inline 渲染分支（把同 `batchId` 的网格 task 聚合成一张矩阵卡）+ 一个底栏 pill。

**嫁接的关键决策**：
- （来自独立视图案）**每条 task 冗余写完整轴定义** `gridAxes.values`：IndexedDB 无批头事务，只写锚点则锚点被删后整批散架；冗余几十字节换来「删任意成员/部分落库失败后矩阵骨架仍可从存活的任一 task 重建」。
- （来自独立视图案）**size 轴坐标用 tier 标识**（`'1K'/'2K'/'4K'`）而非 `calculateImageSize` 算出的像素串：`normalizeImageSize` 可能把不同 tier 归一到相近值，用像素串作列键会列重复/错位。
- （来自体验优先案）**缺漏格补跑** + **选中整批** + **筛选命中部分成员时降级散图**：对照实验「补漏格」是核心价值。

**明确否决**：
- 独立全屏模态矩阵视图——需新 UI slice 状态 + 新模态 + 与 DetailModal 叠层处理，净增成本高；inline 的真正难点（矩阵打破响应式列流）用 `col-span-full` + 横向滚动即可解。
- `GridBatchManifest` 独立 IndexedDB 表——触发 `DB_VERSION` 升级 + 新 store + `ExportData` 扩展 + 加载 + 孤儿 GC，成本远高于冗余写 `gridAxes`，且引入 manifest 泄漏新风险。

## 4. 详细设计

### 4.1 数据模型（`src/types.ts`）

`TaskRecord` 新增两个可选字段（沿用 `batchId` 的可选演进惯例，只在网格 task 上出现；普通/通配/单条提交一律不写；不进 `partialize`，走 IndexedDB；导出随 `ExportData.tasks` 自动序列化；老数据零迁移）：

```ts
export type GridAxisKey = 'stylePreset' | 'quality' | 'size' | 'output_format' | 'n' | 'prompt'
export interface GridAxisValue { key: string; label: string }
export interface GridAxis { kind: GridAxisKey; values: GridAxisValue[] }

export interface TaskRecord {
  // ...既有字段...
  /** 本批网格的轴定义（含完整取值集，每条成员冗余写，便于删成员后重建骨架） */
  gridAxes?: { x: GridAxis; y?: GridAxis }
  /** 本 task 在矩阵中的坐标（存 GridAxisValue.key 稳定键，非 label、非像素串） */
  gridCoord?: { x: string; y?: string }
}
```

- `batchId`（已有，地基期已为网格预留）作为「同属一张矩阵」唯一锚点；网格必 ≥2 格故恒 `genId()` 生成。
- `gridCoord` 存 `key`（如 `size:'2K'`、`quality:'high'`、`stylePreset:'film'`、`prompt:` 存展开后的具体串）。`label` 仅用于表头展示。
- 批次随 task 删除自然消散，**不建批次实体表**。

`EnqueueTaskSpec`（`taskRuntime.ts`）扩展两个可选字段，`enqueueTask` 构造 `TaskRecord` 时按 `batchId` 同款「undefined 不写键」透传：
```ts
...(spec.gridAxes ? { gridAxes: spec.gridAxes, gridCoord: spec.gridCoord } : {})
```
单条/通配/`retryTask` 不传即零影响。

### 4.2 网格纯函数（新建 `src/lib/gridExperiment.ts`）

```ts
// 轴维度元数据:候选维度、各维度取值集来源、label 映射
export const GRID_AXIS_DEFS // { kind, label, getValues(settings), disabled(settings) } 表驱动

// 笛卡尔积:对每个 (xVal,yVal) 从 baseParams/basePrompt clone 并按轴 key override
export function buildGridCells(
  axes: { x: GridAxis; y?: GridAxis },
  base: { params: TaskParams; prompt: string },
): Array<{ params: TaskParams; prompt: string; gridCoord: { x: string; y?: string } }>

export function countGridCells(axes): number  // |X| × max(1,|Y|),不构造数组

// 从存活成员重建矩阵骨架:行列表头(从任一成员的 gridAxes.values,顺序稳定)、坐标→task 匹配、空格、同格多 task(n>1)取最新为代表
export function reconstructMatrix(tasks: TaskRecord[]): {
  axes: { x: GridAxis; y?: GridAxis }
  rows: GridAxisValue[]; cols: GridAxisValue[]
  cellAt(colKey: string, rowKey?: string): TaskRecord[]   // 该格全部 task(取代表 + 计数)
}

// TaskGrid 渲染层:把扁平 filteredTasks 分组成渲染项
export function groupIntoGridBlocks(tasks: TaskRecord[]):
  Array<{ type: 'card'; task: TaskRecord } | { type: 'grid'; batchId: string; tasks: TaskRecord[] }>
```

- **prompt 轴取值集** = `expandPromptTemplate(prompt.trim())`（复用通配展开，不另写解析）。
- **size 轴**：`values[].key` 用 tier（`'1K'/'2K'/'4K'`），`label` 用 `calculateImageSize(tier, detectRatioFromSize(params.size) ?? 默认比例)` 算出的像素串；override 时把算出的具体像素写 `params.size`。
- `groupIntoGridBlocks`：扫描有序列表，把「带 `gridAxes` 的同 `batchId` 成员」收拢为 grid 块，块的流内锚点 = 组内 `sortKey` 最大（最靠前）成员位置；其余为 card。**组内 <2 可见成员降级为普通卡片**（防 1×1 怪异 / 筛选命中部分成员时散开）。无 `gridAxes` 的 task（含纯通配批次）永远走 card 路径。

### 4.3 提交编排（`src/lib/taskRuntime.ts`）

**4.3.1 提取 `prepareSubmission()`（纯重构，最高风险点）**

把 `submitTask` 现有的「采集全局态」副作用段抽成内部 helper，`submitTask` 与 `submitGridTask` 共用：
```ts
// 返回 { normalizedParams, orderedInputImageIds, maskImageId, maskTargetImageId, activeConversationId, activeProfile }
// 或在校验失败/确认中断时返回 null(由调用方 return)
async function prepareSubmission(options): Promise<...|null>
```
**必须保持 `submitTask` 单条/通配路径字节级等价**：副作用顺序（profile 校验 → mask 整图确认 → 输入图持久化 → `normalizeParamsForSettings`+`getChangedParams` 回写 → 确保 active conversation）不可乱序；`allowFullMask`/`allowLargeBatch` 重入标志须同时被两个调用方透传（否则大批量+整图遮罩双确认互相丢标志 → 弹窗循环，这是地基期已踩过的坑）。**配等价回归测试兜底**。

**4.3.2 `submitGridTask(gridConfig)`**

架在 `enqueueTask` + `runEnqueuedTasks` 之上，`executeTask`/`callImageApi` 零改动：
1. `prepareSubmission()` 采集全局态。
2. `cells = buildGridCells(axes, { params: normalizedParams, prompt })`。
3. 规模把关：`countGridCells × normalizedParams.n`，复用 `MAX_PROMPT_EXPANSION`（确认/预告）与 `MAX_PROMPT_EXPANSION_HARD`（拒绝）阈值 + `setConfirmDialog` 的 `allowLargeBatch` 同款重入，文案体现「X×Y 矩阵共 N 张」。
4. `batchId = genId()`，所有 cell 共享。
5. 循环 `await enqueueTask({ ...cell, gridAxes, gridCoord, batchId, 共享 input/mask/conversation/provider })` 收集 `taskIds`（部分失败跳过，与通配一致）；首条回填 `maybeUpdateConversationOnFirstTask`；`clearInputAfterSubmit` 清一次；`void runEnqueuedTasks(taskIds)`。

**prompt 轴 × textarea 通配（明确结论：不叠加）**：仅当 X/Y 选了 prompt 轴时，通配展开并入该轴取值集；未选 prompt 轴时即便 textarea 含通配也整体作为定值（网格模式忽略 textarea 通配，避免双重笛卡尔爆炸），UI 文案明示。

**4.3.3 缺漏格补跑**

```ts
export function retryGridCell(batchId, coord): // 从该 batch 任一存活成员读 gridAxes 重建该格 spec
  // 非轴 params/输入图/conversation 取存活成员快照;enqueueTask 挂回同 batchId + 同 gridCoord → executeTask
export function retryGridMissing(batchId, scope: 'all' | {row} | {col}): // 对缺失或 error 坐标批量 retryGridCell,>1 走 runEnqueuedTasks
```
**`retryTask` 对带 `gridCoord` 的 task 走 `retryGridCell` 分支**——保证单元格重试结果回到矩阵原位（否则跑出矩阵成散图）。这是正确性需求，非增强。conversation 兜底：原对话已删时回退 `ARCHIVE_CONVERSATION_ID`（对齐 `retryTask` 现状）。

### 4.4 入口 UI（`InputBar`）

底栏 `PillRow` 新增「网格」pill，纳入现有 `openMenu` 互斥联合（`OpenMenu` 加 `'grid'`），与 model/style/resolution/advanced 同构：`gridPillRef` + `GridConfigPopover`，Esc/outside-click 复用 `AdvancedParamsPopover` 的 `onKey`/`onPointer`。不做全局模式切换、不改 textarea、**不复用底栏发送键**（popover 内有独立「生成网格」主按钮，避免与普通提交混淆）。

`GridConfigPopover`（~340px，结构对齐 `AdvancedParamsPopover`）：
- X 轴维度下拉（必选）+ Y 轴维度下拉（可选含「无」），两轴互斥。
- 选定维度后渲染取值多选 chip，取值素材复用现有常量：
  - `stylePreset` → `STYLE_PRESETS` 9 项（无风格 + 8 预设）
  - `quality` → `QUALITY_OPTIONS`；**`settings.codexCli` 时禁用该轴**（对齐 `qualityDisabled`）
  - `output_format` → png/jpeg/webp
  - `size` → 1K/2K/4K tier chip（key=tier，label=像素，比例取 `detectRatioFromSize(params.size)`）
  - `n` → 1/2/4 chip（受 `getOutputImageLimitForSettings(settings)` 上限约束）
  - `prompt` → 无取值选择器，只读展示「将展开为 N 条」（取值集=通配展开）
- 底部实时预览 `|X| × max(1,|Y|) × n` 总图数；超 HARD 禁用主按钮；X 取值 <2 禁用并提示「至少在 X 轴选 2 个取值」。
- 一行小字「其余参数沿用当前底栏设置」（非轴维度取当前 params/prompt 为基线）。

### 4.5 矩阵展示（`TaskGrid` + 新组件 `TaskGridMatrix`）

`TaskGrid` 渲染层纯派生（`useMemo` 以 `filteredTasks` 为依赖，**不改 `filterAndSortTasks`**）：
1. `renderItems = groupIntoGridBlocks(filteredTasks)`。
2. `card` 项 → 现有 `SortableTaskCard`；`grid` 项 → `TaskGridMatrix`（`col-span-full` 占满整行，打破 1/2/3 列流）。
3. `TaskGridMatrix`：
   - `reconstructMatrix(tasks)` 得行列表头（从 `gridAxes.values` 直接渲染，顺序稳定）；caption 标注「X: 质量 · Y: 分辨率」。
   - 内部自有 CSS grid：左上角空格 + 顶部 X 列表头 + 左侧 Y 行表头（无 Y 轴则单行）。外层 `overflow-x-auto`，窄屏横滚不破版。
   - 单元格：按 `gridCoord` 匹配 → 复用 `<TaskCard>`（保留缩略图/状态/计时/取消/重试/收藏/复用全部能力），`dragHandle` 传 `disabled`，点击走 `setDetailTaskId`（DetailModal 零改）。空格 → 虚线占位 + 「重试」按钮（`retryGridCell`）。同格多 task（n>1）取最新为代表 + `+k` 角标，详情看全部。
   - 小标题栏：X/Y 维度名 + done/total 进度 + 「选中整批」checkbox（灌 `batchId` 全部 taskId 进 `selectedTaskIds`，复用 `SelectionActionBar`）+ 「补跑全部失败格」按钮。

### 4.6 共存策略

- **拖拽排序**：`SortableContext` items 仍按扁平 `filteredTasks` 不变；矩阵成员的 `TaskCard` 以 `dragDisabled=true` 渲染（单元格不可拖）。矩阵成员仍在扁平序中（仅渲染聚合），故 `handleDragEnd` 的 `findIndex` 仍落到真实 task id，`reorderTask`/`sortOrder` 逻辑完全不动。普通卡片间拖拽不受影响。
- **框选/多选**：单元格仍是 `.task-card-wrapper`+`data-task-id`，框选/Ctrl 天然生效；批量删除/收藏正常。删到该 batch 无存活成员 → 矩阵自然消散（无 manifest 故无需 GC）。
- **筛选/搜索**：`filterAndSortTasks` 不动；命中部分成员时 `groupIntoGridBlocks` 降级散图（组内可见 <2 → card 路径）。搜索字段不扩展（params 已含轴值）。
- **gallery**：`batchId` 全局唯一，跨对话不误并；聚合照常，单元格 `conversationTag` 由现有逻辑注入。
- **sortOrder 不破坏**：矩阵流内位置由组内代表成员 sortKey 决定，成员各自 `sortOrder` 不被网格逻辑改写。

## 5. 边界与风险

1. **`prepareSubmission` 等价性**（最高风险）：提取后 `submitTask` 单条/通配路径必须字节级等价，重入标志须双方透传。配回归测试。
2. **size 轴归一塌缩**：坐标键用 tier 而非像素串，否则列重复/错位。
3. **provider 禁用**：`quality` 轴在 `codexCli` 下禁用；`size` 经 `normalizeParamsForSettings` 可能塌缩，对「实际生效轴值塌缩」给提示（复用 `actualParams` 不一致的既有语义）。
4. **聚合性能**：`groupIntoGridBlocks`/`reconstructMatrix` 用 `useMemo` 缓存，O(N) 分组 + 组内 O(M)。
5. **prompt 轴 vs 通配双重展开**：已决策「只认 prompt 轴内通配」，UI 文案明示，否则用户困惑「`{a|b}` 没生效」。
6. **dnd 落点直觉**：矩阵成员 `dragDisabled` + 保留扁平序使 `over.id` 仍是真实 task，`reorderTask` 安全；「拖普通卡到矩阵视觉位置」的落点需实测。

## 6. 测试计划

- `gridExperiment.test.ts`（纯函数）：`buildGridCells`（轴 override 正确、坐标正确、总数=∏、prompt 轴并入通配、size 轴写具体像素）、`countGridCells`、`reconstructMatrix`（行列去重保序、残缺降级、同格多 task 取代表）、`groupIntoGridBlocks`（连续/非连续分组、<2 降级、无 gridAxes 不聚合）。
- `taskRuntime` / `store.test.ts`：`submitTask` 单条路径等价回归（`prepareSubmission` 提取后）；`submitGridTask` 生成 N 格共享 batchId + gridAxes/gridCoord；`retryTask` 对带 `gridCoord` task 走补跑、结果回原坐标。
- 端到端（Playwright）：配 X=quality×Y=size 网格 → 矩阵渲染行列表头 + 单元格；空格补跑；选中整批删除。
- `tsc` / `eslint` / `vitest` 全绿。

## 7. 非目标（本期不做）

不新增路由/页面/全屏模态矩阵视图；不新增 store slice、不持久化批次实体、不做批次级元数据（标题/备注/模板库）；不支持 >2 轴（无 Z 轴）、不支持同一维度跨 X/Y；不做矩阵内拖拽重排/矩阵整体拖拽；不做格内 mini-grid 平铺 n 张（取代表+角标）；不做对照导出（带轴标签拼图/zip，v2）；不做整行整列对比高亮/差异标注/并排放大（v2）；不做 size 的 tier×ratio 二级笛卡尔（比例固定取当前）、不做 moderation 轴、不做 n 任意步进；不扩展 `filterAndSortTasks`/搜索字段；不改 `executeTask`/`callImageApi`；不暴露 `BATCH_CONCURRENCY`/规模阈值为设置。

## 8. 落地顺序（分阶段，便于增量合入）

**Stage 1（核心矩阵,可独立合入）**
1. `types`：`GridAxisKey`/`GridAxisValue`/`GridAxis` + `TaskRecord.gridAxes?`/`gridCoord?`；`EnqueueTaskSpec` 透传。
2. `lib/gridExperiment.ts`：`GRID_AXIS_DEFS` + `buildGridCells`/`countGridCells`/`reconstructMatrix`/`groupIntoGridBlocks` + 纯函数测试（零风险先行）。
3. `taskRuntime`：提取 `prepareSubmission()`（跑单条路径等价回归）→ `submitGridTask` + 规模确认。
4. `GridConfigPopover` + 「网格」pill。
5. `TaskGrid` 聚合分支 + `TaskGridMatrix`（单元格复用 TaskCard、`dragDisabled`、`col-span-full`+横滚）。
6. `retryTask` 带 `gridCoord` 走 `retryGridCell` 自愈（保证重试回原位——正确性必需）。

**Stage 2（实验体验增强）**
7. 空格占位补跑按钮 + `retryGridMissing`（全/行/列失败格）。
8. 矩阵小标题栏：进度 + 「选中整批」+ 「补跑全部失败格」。

Stage 1 即可交付「配置 → 生成矩阵 → 对照展示 → 单格重试回位」的完整闭环；Stage 2 补「批量补漏格 / 整批操作」体验。
