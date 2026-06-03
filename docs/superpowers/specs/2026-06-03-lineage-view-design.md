# 创作血缘视图（轻量版）设计

- 日期：2026-06-03
- 状态：待评审
- 范围：在 `DetailModal` 展示一条任务的「派生自（父）/ 衍生出（子）」血缘关系，可点击缩略图在任务间跳转。把零散 task 织成可追溯的创作历史。

## 1. 背景与目标

现有迭代流程：详情里「编辑输出」(`editOutputs`) 把某 task 的输出图加入输入 → 提交 → 新 task。这条「谁从谁派生」的链路在数据里其实**已经存在**，只是没被呈现：新 task 的 `inputImageIds` 里就含着父 task 的某个 `outputImages` id（SHA-256 内容寻址，去重共享同一份）。

**目标**：在 `DetailModal` 加一个血缘区块，读时反查并展示父/子任务，点击跳转。

## 2. 采用方案：纯推断，零数据模型改动

**不加任何持久化字段。** 父子关系由 `inputImageIds`/`outputImages` 的集合求交在读时推断：

- `findParentTasks(task)`：其它 task 的 `outputImages` ∩ 本 task 的 `inputImageIds` 非空 → 父。
- `findChildTasks(task)`：其它 task 的 `inputImageIds` ∩ 本 task 的 `outputImages` 非空 → 子。

**为什么否决「加 `parentTaskId` 字段」（原头脑风暴方案）**：
- 内容寻址让推断**精确且免费**——共享的图 id 就是边。
- 加字段需要改 `editOutputs`/`reuseConfig`/`submitTask` 的写入路径、做迁移、且**只对新数据生效**；纯推断对**全部历史数据**立即生效。
- YAGNI：DetailModal 是纯读，没有任何地方需要持久化的 parent 指针。

**连接缩略图免费**：父的连接图 = 本 task 的某 `inputImageId`；子的连接图 = 本 task 的某 `outputImage`。两者**都已在 `DetailModal` 的 `imageSrcs` 缓存中**（现有加载 effect 已覆盖 input+output+mask），无需新增图片加载。

## 3. 详细设计

### 3.1 `src/lib/lineage.ts`（新建，纯函数）

```ts
import type { TaskRecord } from '../types'

export interface LineageLink {
  task: TaskRecord
  /** 连接两个 task 的共享图 id（取自本 task 的 input 或 output），用作缩略图与跳转锚点 */
  sharedImageIds: string[]
}

/** 本 task 的输入图里，由哪些其它 task 生成 → 父任务。按 createdAt 升序。 */
export function findParentTasks(task: TaskRecord, allTasks: TaskRecord[]): LineageLink[]

/** 本 task 的输出图，被哪些其它 task 当作输入 → 子任务。按 createdAt 升序。 */
export function findChildTasks(task: TaskRecord, allTasks: TaskRecord[]): LineageLink[]
```

- 排除自身（`t.id === task.id`）。
- 空 input/output 直接返回 `[]`。
- 用 `Set` 做交集，O(N×M)，N=任务数、M=图/任务（小）。
- 排序：`createdAt` 升序（父=更早的来源在前；子=按衍生时间）。

### 3.2 `DetailModal` 血缘区块

- 两个 `useMemo`（在现有 `task` useMemo 之后，`if (!task) return null` 之前）：
  ```ts
  const parentLinks = useMemo(() => (task ? findParentTasks(task, tasks) : []), [task, tasks])
  const childLinks = useMemo(() => (task ? findChildTasks(task, tasks) : []), [task, tasks])
  ```
- 渲染位置：「参考图」区块之后、「参数配置」之前（血缘语义贴近输入来源）。
- 结构：仅当 `parentLinks.length || childLinks.length` 时显示。「派生自」「衍生出」两小节，各渲染一排可点缩略图卡片：
  - 缩略图 `src = imageSrcs[link.sharedImageIds[0]]`（已缓存）。
  - 旁注对方 task 的 `prompt` 截断 + 状态点（done/error/running 配色）。
  - `onClick={() => setDetailTaskId(link.task.id)}` 跳转；现有 `detailTaskId` 变化会重置 `imageIndex` 并重载图片，平滑切换。
- 样式沿用现有缩略图卡片 className（16×16 圆角边框），与「参考图」一致。

## 4. 边界

- **上传的原始图**：不在任何 task 的 `outputImages` → 无父，正确。
- **同像素图被多 task 生成**（去重后同 id，罕见）→ 可能推断出多个父，都是合理来源，展示无妨。
- **mask 图不参与**：血缘只看 `inputImageIds`/`outputImages` 创作流，`maskImageId` 不计入。
- **跳转到已删除任务**：不会发生——links 来自当前 `tasks` 列表，已删除的不在其中。
- **批量任务**：同 `batchId` 的兄弟 task 之间无 input/output 共享，不会互相误判为父子（它们共享的是*输入*图，不是一方的输出=另一方的输入）。正确。

## 5. 测试计划

- `lineage.test.ts`（纯函数）：父识别 / 子识别 / 排除自身 / 空 input-output / 多父多子 / createdAt 排序 / 上传图无父 / 兄弟批量不误判。
- 端到端：构造 A(生成图) → editOutputs → B(用 A 输出当输入) 的链路，DetailModal 中 B 显示「派生自 A」、A 显示「衍生出 B」，点击跳转。
- `tsc` / `eslint` / `vitest` 全绿。

## 6. 非目标

- 不做可视化谱系树（SVG/Canvas 多层布局）——留待验证价值后再议。
- 不加任何持久化字段、不改 `editOutputs`/`submitTask` 写入路径。
- 不在 TaskCard/TaskGrid 上展示血缘标记（仅 DetailModal）。
