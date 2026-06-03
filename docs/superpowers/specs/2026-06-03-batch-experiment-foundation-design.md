# 批量实验地基（提交原语解耦 + 提示词通配）设计

- 日期：2026-06-03
- 状态：待评审
- 范围：把「一次提交 → 一组结果」的单任务提交管线，重构为可参数化复用的提交原语 `enqueueTask`；在其之上落地最轻量的批量入口——提示词通配语法 `{a|b|c}`（一次提交展开成多条 prompt 并发生成）。
- 关系：本 spec 是「批量实验」特性的**地基**。XY 参数网格的维度选择器、矩阵聚合卡片**不在本期范围**，留给后续 spec；本期只铺好「参数化提交原语 + 批量并发调度 + batchId 关联字段」，并用通配语法作为第一个消费者验证地基。

## 1. 背景与目标

当前唯一的新任务入口是 `submitTask`（`src/lib/taskRuntime.ts`）。它把两类职责揉在一起：

1. **采集全局输入态**：读 `useStore` 的 `prompt` / `inputImages` / `maskDraft` / `params`，做 mask 校验与持久化、输入图持久化、参数归一化、确保 active conversation、提交后清空输入。
2. **构造并落库单条 `TaskRecord`**：`genId` → 构造 task → `setTasks([task, ...])` → `putTask`（失败回滚）→ 首条回填对话标题 → `executeTask(taskId)`。

`retryTask` 是另一个几乎平行的「构造并落库一条派生 task」实现，与第 2 类职责高度重复。

**问题**：任何「一次提交产生多条 task」的能力（通配、XY 网格、未来的 seed 微调批次）都无法复用 `submitTask`，因为它强绑定「全局态 → 单 task」。

**目标**：
- 抽出纯参数化的提交原语 `enqueueTask(spec)`，只负责第 2 类职责（构造 + 落库 + 触发执行），不读全局输入态、不处理 mask。
- `submitTask` 重构为「采集全局态 → 计算 prompt 列表 → 对每条 prompt 调 `enqueueTask`」，单条路径与现状**严格等价**。
- 新增 `lib/promptExpand.ts`：解析 `{a|b|c}` 通配并做笛卡尔展开，作为 `submitTask` 计算 prompt 列表的一步。
- 新增批量并发调度 `runEnqueuedTasks(taskIds, limit)`：批量场景下 `executeTask` 不能全量并发，需信号量限流。
- `TaskRecord` 新增可选字段 `batchId`，关联同一次提交展开出的多条 task，为后续矩阵聚合 UI 预留锚点。

**明确不做（本期）**：
- 不做 XY 网格维度选择器 / 矩阵聚合卡片 UI（下一期）。
- 不引入任何新的底栏控件——通配是 textarea 内的隐式语法。
- 不改 `executeTask` / `callImageApi` 的任何逻辑。
- 不做提示词模板的持久化复用（snippets 库另议）。

## 2. 现状盘点

- **提交链**：`submitTask(options)` → 构造 task → `putTask` → `executeTask(taskId)`（fire-and-forget，内部 `async`，resolve 时机为任务成功/失败/取消收口）。`src/lib/taskRuntime.ts:382` / `:493`。
- **派生范例**：`retryTask(task)`（`:725`）已演示「基于已有 task 构造 newTask → setTasks → putTask 回滚 → executeTask」。
- **风格预设拼接**：`buildFinalPrompt(task.prompt, task.params.stylePreset)` 在 `executeTask` 内（`:524`），**晚于** task 落库。故 task.prompt 始终是「用户原文」，风格前缀只在请求时拼接。→ 通配展开必须发生在 `submitTask`（task.prompt 写入前），与风格预设互不干扰（展开产出的每条具体 prompt 仍是「用户原文」，风格前缀照旧在 `executeTask` 拼接）。
- **并发原语**：`summarizeConcurrentFailures` / `mergeAbortSignals`（`src/lib/api/imageApiShared.ts`）服务于 `callImageApi` **单任务内**的多图拆单，使用 `Promise.allSettled` 全量并发。**不存在跨任务的信号量限流**。→ 批量调度需新增。
- **参数归一化**：`normalizeParamsForSettings(params, settings)` + `getChangedParams`（`src/lib/api/paramCompatibility.ts`），`submitTask` 内对全局 params 归一并回写 store。批量共用同一组归一后 params。
- **对话标题回填**：`maybeUpdateConversationOnFirstTask(conversationId, task)`（`:349`）以「该对话此前是否有 task」判定首条，幂等。
- **store 组合**：4 slice（settings/tasks/ui/filters）+ `persist`/`partialize`（`src/store/index.ts`）。`re-export` 列表需同步导出新 API。
- **类型**：`TaskRecord`（`src/types.ts:148`）已有大量可选字段的平滑演进惯例。
- **导出/导入**：`ExportData.tasks: TaskRecord[]` 直接序列化整个 task；新增可选字段自动随行，`exportImport.ts` 无需改动。

## 3. 采用方案

**三段式拆分：`submitTask`（采集 + 展开） → `enqueueTask`（构造单 task） → `runEnqueuedTasks`（批量并发调度）。**

理由：
- `enqueueTask` 是「全局态无关」的纯原语，单条/批量/网格/重试统一复用，消除 `submitTask` 与 `retryTask` 的构造逻辑重复。
- 通配作为 `submitTask` 内「prompt 字符串 → prompt 列表」的一步，是对管线侵入最小的批量入口（零新控件）。
- batchId 仅作关联字段，本期不渲染矩阵，避免一次吞下 UI 工作量。

**已否决**：
- 方案 B「让 `submitTask` 接收可选的 `promptList` 参数，内部循环」——把批量逻辑塞回 `submitTask`，全局态采集与批量编排仍耦合，网格无法复用。
- 方案 C「批量在 UI 层循环调 `submitTask`」——`submitTask` 每次都清空输入 / 重复持久化输入图 / 重复 mask 校验 / 重复归一化回写，N 次副作用叠加，且无法共享同一 batchId 与并发闸。

**task.prompt 存储语义**：存**展开后的具体值**（`一只橘色的猫`），**非**模板（`一只{橘色|黑色}的猫`）。理由：每条 task 是一次独立真实生成，其详情对照、复用配置、重试都应反映实际请求的 prompt；模板只是输入手段。本期不持久化模板来源（YAGNI），同批关联靠 `batchId` 即可。

## 4. 详细设计

### 4.1 数据模型（`src/types.ts`）

`TaskRecord` 新增一个可选字段：

```ts
export interface TaskRecord {
  // ...既有字段...
  /** 同一次提交批量展开（通配 / 未来网格）出的多条 task 的关联 id；单条提交不设 */
  batchId?: string
}
```

- 单条提交（展开数 = 1）**不设** `batchId`，保持与现状字节级一致，老数据兼容零成本。
- 批量提交（展开数 ≥ 2）所有 task 共享同一 `batchId`。
- 不引入新 store slice、不进 `partialize`（task 持久化走 IndexedDB，非 localStorage）。

### 4.2 通配展开（新建 `src/lib/promptExpand.ts`）

纯函数模块，无副作用、不读全局态。

```ts
/** 把含 {a|b|c} 通配的模板笛卡尔展开为具体 prompt 列表。无通配组时返回 [原串]。 */
export function expandPromptTemplate(template: string): string[]

/** 仅判定是否「将要展开成多条」（含至少一个有效通配组），供 UI 预判与确认文案。 */
export function countPromptExpansion(template: string): number
```

**语法规则（首版，刻意保守）**：
- 通配组 = `{` ... `}`，组内以 `|` 分隔为 ≥ 2 个选项。**仅含 `|` 的花括号组才触发**；不含 `|` 的 `{...}`（如 JSON 片段 `{"k":1}`）原样保留、不触发展开。这是降低误触发的关键约束。
- 多个通配组 → 笛卡尔积。各组取值数 $|V_i|$，总展开数 $N=\prod_i |V_i|$。
- **不支持嵌套**（`{a|{b|c}}`）：首版只解析单层，内层花括号按字面处理。理由：避免组合爆炸与解析复杂度，YAGNI。
- **转义**：`\{` `\}` `\|` 表示字面字符，展开后还原为去转义的字符。
- 选项内首尾空白保留（用户可能有意为之）；空选项（`{a||b}` 中的空段）保留为空字符串，不做「聪明」裁剪。
- 解析失败 / 不配对的花括号 → 容错：当作无通配，返回 `[template]`（绝不抛错阻断提交）。

**上限**：模块导出常量 `MAX_PROMPT_EXPANSION = 20`。`expandPromptTemplate` 本身不截断（纯函数返回真实展开），由 `submitTask` 在调用后对 `length > MAX_PROMPT_EXPANSION` 做二次确认（见 4.4）。

**测试点**（`promptExpand.test.ts`，纯函数易覆盖）：无花括号直通；单组多选；多组笛卡尔积与顺序；`{}`/`{x}`（无 `|`）不触发；转义 `\{`/`\|`；不配对花括号容错；空选项保留；`countPromptExpansion` 与 `expandPromptTemplate().length` 一致。

### 4.3 提交原语（`src/lib/taskRuntime.ts` 新增 `enqueueTask`）

```ts
interface EnqueueTaskSpec {
  prompt: string                       // 已展开的具体 prompt（用户原文，不含风格前缀）
  params: TaskParams                   // 已归一化
  apiProvider: ApiProvider
  apiProfileName: string
  apiModel: string
  inputImageIds: string[]              // 已持久化
  maskTargetImageId: string | null
  maskImageId: string | null
  conversationId: string
  batchId?: string
}

/** 构造一条 TaskRecord、落库（失败回滚内存态）、触发 executeTask；返回 taskId 或 null（落库失败）。 */
async function enqueueTask(spec: EnqueueTaskSpec): Promise<string | null>
```

职责（搬运自 `submitTask` 现有第 2 段，逻辑不变）：
1. `genId()` → 构造 `TaskRecord`（status `running`、空 outputImages、`createdAt` 等），带入 `spec.batchId`（undefined 时不写键）。
2. `setTasks([task, ...latestTasks])`。
3. `await putTask(task)`；失败则从内存移除该 task + toast，返回 `null`（与现状回滚一致）。
4. 返回 `taskId`。**不在此处调 `executeTask`**——执行时机交由调用方决定（单条立即 fire-and-forget；批量交并发闸），也**不**在此处回填对话标题（由调用方对首条统一处理）。

> 设计取舍：把 `executeTask` 触发与标题回填留在调用方，使 `enqueueTask` 成为纯「落库」原语，便于批量先全部落库（即时显示 N 张 running 卡片）再受控调度执行。

### 4.4 `submitTask` 重构（`src/lib/taskRuntime.ts`）

保持函数签名 `submitTask(options: { allowFullMask?: boolean } = {})` 与所有现有副作用顺序不变，仅在「构造 task」处改为「展开 + 循环 enqueue」：

1. 前置校验（profile / prompt 非空）、mask 处理、输入图持久化、参数归一化回写、确保 active conversation —— **全部不变**（这些是批量共享的一次性副作用）。
2. **新增展开步骤**：`const prompts = expandPromptTemplate(prompt.trim())`。
3. **新增上限确认**：若 `prompts.length > MAX_PROMPT_EXPANSION`，走 `setConfirmDialog`（复用现有整图 mask 确认的模式），文案提示「将生成 N 张图片（展开 × n=…），是否继续」，确认后以一个内部标志重入提交避免再次弹窗。`prompts.length` 在 `[2, MAX]` 区间也建议给一条轻确认或 toast 预告（见「边界」）。
4. **生成 batchId**：`const batchId = prompts.length > 1 ? genId() : undefined`。
5. **循环 enqueue**：
   ```
   const taskIds: string[] = []
   for (const p of prompts) {
     const id = await enqueueTask({ prompt: p, params: normalizedParams, ...沿用同一组 inputImageIds/mask*/provider 信息, conversationId, batchId })
     if (id) taskIds.push(id)
   }
   ```
   全部使用**同一组** `inputImageIds` / `maskImageId` / `maskTargetImageId`（内容寻址，去重命中，N 条 task 引用同一份图，零额外存储）。
6. **对话标题回填**：仅对 `taskIds[0]` 对应 task 调 `maybeUpdateConversationOnFirstTask`（与现状一致，幂等）。
7. **清空输入**：`settings.clearInputAfterSubmit` 时清一次（不变）。
8. **触发执行**：
   - `taskIds.length === 1`：`executeTask(taskIds[0])`（fire-and-forget，与现状逐字等价）。
   - `taskIds.length > 1`：`void runEnqueuedTasks(taskIds, BATCH_CONCURRENCY)`。

> 单条路径（无通配）展开为 `[prompt]`，`batchId` 为 undefined，`executeTask` 直呼——与重构前**字节级等价**，这是验收基线。

### 4.5 批量并发调度（`src/lib/taskRuntime.ts` 新增 `runEnqueuedTasks`）

```ts
const BATCH_CONCURRENCY = 3  // 模块常量

/** 以并发上限调度一批已落库 task 的 executeTask；每个 task 的失败已由 executeTask 内部收口为 error 态，调度器不抛。 */
async function runEnqueuedTasks(taskIds: string[], limit = BATCH_CONCURRENCY): Promise<void>
```

- 实现：固定大小的「滑动窗口」信号量——维护至多 `limit` 个在执行的 `executeTask(id)`，完成一个补一个，直到队列排空。
- 不引第三方库；可在 `lib/` 内放一个极小的 `mapWithConcurrency(items, limit, fn)` 工具（或内联实现），并补单测（纯函数式，给受控的 async fn 验证「任意时刻在执行数 ≤ limit」「全部最终执行」「单个 reject 不中断其余」）。
- `executeTask` 内部已把每个任务的成功/失败/取消完整收口（落 done/error 态、watchdog、孤儿回滚），因此调度器**不需要**也**不应**让单个失败冒泡中断整批。
- 取消：每个 task 仍各自持有 `AbortController`（`executeTask` 内 `taskAbortControllers`），用户对单卡片取消/删除经现有 `cancelTask`/`removeTask` 即可逐个中止，调度器无需额外取消通道。

**并发上限取值**：`callImageApi` 在单任务内对 OpenAI Images 多图已可能并发拆单，批量再叠加会相乘。`BATCH_CONCURRENCY = 3` 为保守默认，避免易触发上游 429。本期设为模块常量，不暴露为用户设置（待网格期再评估是否提配置）。

### 4.6 `retryTask` 收敛（可选但建议，`src/lib/taskRuntime.ts`）

`retryTask` 的「构造 newTask → setTasks → putTask 回滚 → executeTask」与 `enqueueTask` 重复。重构为：

```ts
export async function retryTask(task: TaskRecord) {
  const { settings, activeConversationId } = useStore.getState()
  const activeProfile = getActiveApiProfile(settings)
  const id = await enqueueTask({
    prompt: task.prompt,
    params: normalizeParamsForSettings(task.params, settings),
    apiProvider: activeProfile.provider,
    apiProfileName: activeProfile.name,
    apiModel: activeProfile.model,
    inputImageIds: [...task.inputImageIds],
    maskTargetImageId: task.maskTargetImageId ?? null,
    maskImageId: task.maskImageId ?? null,
    conversationId: task.conversationId ?? activeConversationId ?? ARCHIVE_CONVERSATION_ID,
    // 不继承 batchId：重试是一次新的独立生成
  })
  if (id) executeTask(id)
}
```

- 重试**不继承** `batchId`（单次独立生成）。若评审认为重试应留在原批，可后续单独决定；本期从简不继承。
- 此项与本特性正交，若想压缩本 PR 体量可推迟，但收益（消除重复、统一回滚语义）明确。

### 4.7 导出/导入与 store re-export

- `exportImport.ts`：无需改动（`batchId` 作为 `TaskRecord` 可选字段自动随 `ExportData.tasks` 序列化/反序列化）。
- `src/store/index.ts`：`enqueueTask` / `runEnqueuedTasks` 为 taskRuntime 内部函数，**不**对外 re-export（仅 `submitTask`/`retryTask` 是公共入口，签名不变，re-export 列表无改动）。

## 5. 消费方影响

- **UI 层零改动**：`InputBar` 的提交按钮继续调 `submitTask()`；用户在 textarea 输入含 `{a|b}` 的提示词即触发展开。
- `TaskCard` / `TaskGrid`：本期**不**消费 `batchId`（不做矩阵聚合），N 条批量 task 按现有 `sortOrder` 各自为独立卡片正常展示。`batchId` 字段静默存在，待下一期网格 UI 读取。

## 6. 边界与错误处理

- **误触发防护**：仅「含 `|` 的花括号组」触发展开；纯 `{...}`（JSON / 占位符）原样保留。仍存在用户确实想字面输入 `{红|蓝}` 的极小概率 → 通过转义 `\{红\|蓝\}` 规避，并在 ≥ 2 展开时由确认/预告给用户取消机会。
- **展开数确认**：`> MAX_PROMPT_EXPANSION(20)` 强制 `setConfirmDialog` 二次确认；`[2,20]` 区间至少给一次 toast 预告「本次将生成 N 张」，避免用户对「一条变多条」无感（具体是 toast 还是轻确认，实现时取其一，倾向 toast 预告 + 提交，减少打断）。
- **总图数 = 展开数 × params.n**：确认/预告文案需体现实际图片数（展开数与 n 相乘），防止用户低估配额消耗。
- **部分落库失败**：循环中某条 `enqueueTask` 返回 `null`（putTask 失败），跳过该条、继续其余（`taskIds` 只收成功项），已 toast，不整批回滚（其余 task 是独立有效记录）。
- **批量执行失败**：单条 `executeTask` 失败由其自身落 error 态 + 详情弹窗逻辑收口；调度器不中断其余。批量场景是否仍对每个失败 `setDetailTaskId`（现状单任务失败会打开详情）需注意——批量下逐个弹详情会打架，建议 `executeTask` 在「属于批量（task.batchId 存在）」时跳过 `setDetailTaskId`，改由失败卡片的 error 态呈现。**这是重构中需显式处理的交互细节。**
- **mask 与批量**：同批共用同一 mask（绑定同一 `maskTargetImageId`），语义自洽；mask 的整图覆盖确认在展开之前完成，不受影响。
- **取消/删除**：逐卡片走现有 `cancelTask`/`removeTask`，各自中止与孤儿清理不变。

## 7. 测试计划

- **`promptExpand.test.ts`（新增，纯函数）**：见 4.2 测试点清单。
- **`mapWithConcurrency`（若抽为独立工具）单测**：并发上限不被突破；全部执行；单个 reject 不影响其余完成。
- **`taskRuntime` 相关**：
  - 等价性回归：无通配提交 → 恰好 1 条 task、无 `batchId`、`executeTask` 被调用一次（沿用现有 taskRuntime / store 测试的 mock 方式，参照 `tasks.test.ts` / `store.test.ts` 现有桩）。
  - 批量提交：`{a|b}` → 2 条 task 共享同一 `batchId`、引用同一组 `inputImageIds`；首条触发标题回填一次。
  - 落库失败回滚：`putTask` 抛错 → 该条不进列表、其余继续。
- **类型/构建**：`npm run lint` + `npm run test` + `tsc --noEmit` 全绿。
- **导出/导入**：`exportImport.test.ts` 现有断言应继续通过（可补一条「带 batchId 的 task round-trip 保真」）。

## 8. 非目标

- 不做 XY 网格维度选择器与矩阵聚合卡片（下一期 spec）。
- 不暴露 `BATCH_CONCURRENCY` 为用户可配置项。
- 不支持嵌套通配 `{a|{b|c}}`。
- 不持久化「提示词模板来源」，不做模板复用库。
- 不改 `executeTask` / `callImageApi` 的生成逻辑（仅新增「批量时跳过失败详情自动弹窗」这一交互分支）。
- 不为批量任务引入新的取消通道（复用逐卡片 `cancelTask`/`removeTask`）。

## 9. 落地顺序建议（实现期）

1. `promptExpand.ts` + 测试（纯函数，零风险，可独立合入）。
2. 抽 `enqueueTask`，用它重写 `submitTask` 单条路径 → 跑回归确认等价。
3. `mapWithConcurrency` + `runEnqueuedTasks`，接入 `submitTask` 多条路径。
4. `TaskRecord.batchId` 字段 + 批量失败「跳过自动弹详情」分支。
5. （可选）`retryTask` 收敛到 `enqueueTask`。
6. 确认/预告文案与展开上限。
