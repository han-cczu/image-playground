# A/B 并排对比设计

- 日期:2026-06-06
- 状态:已评审(roadmap v2 已获批,按推荐顺序实施)
- 范围:roadmap v2 第 2 项。多选 2~4 条已完成任务 → 并排放大对比 + 参数差异逐行高亮,补上实验闭环的「微观精读」环节。

## 1. 背景与目标

XY 网格给了「宏观对照」(矩阵缩略图),但生成 16 格后想细看两三格的差异,目前只能反复开关 DetailModal 靠记忆比对。

**目标**:批量选择 2~4 条任务 → 选择操作栏「对比」→ 全屏并排视图:每列一条任务(图 + prompt + 参数),**值不一致的参数行高亮**,点图可进 Lightbox 细看。

## 2. 现状盘点(可复用件)

- **多选**:`selectedTaskIds`(框选/Ctrl 连选/侧滑)+ `SelectionActionBar`(批量操作栏,加「对比」按钮的天然位置)。
- **参数显示**:`lib/paramDisplay.tsx` 的 `getParamDisplay(task, key)` 已封装「请求值 vs API 实际值」归一(实际值优先、n 按实际输出数、auto 解析标记)——对比列的值显示直接复用。
- **图片加载**:`getCachedImage`/`ensureImageCached`(DetailModal 同款 effect 模式)。
- **Lightbox**:z-[60] 高于 DetailModal(z-50);CompareModal 取 z-50,点列图 `setLightboxImageId(id, 该列输出图列表)` 即可叠放细看。
- **modal 基建**:useCloseOnEscape / useLockBodyScroll / useFocusTrap + ErrorBoundary region="modal"。

## 3. 关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 对比单位 | **task(卡片)**,每列一条 | 与多选粒度一致;格内多图用列内小切换覆盖 |
| 列数 | 2~4 | >4 列在桌面已不可读;5+ 选中时「对比」禁用 + tooltip |
| 参数差异判定 | **纯函数 `buildCompareRows`** 产出行模型(label/values/differs),组件只渲染 | 可测;displayValue 复用 getParamDisplay(实际值优先) |
| per-image actualParams | **不做**,统一用 task 级 `task.actualParams` | DetailModal 的逐图实际参数是细粒度特例;对比视图按任务粒度足够,spec 注明 |
| prompt 差异 | 整块高亮(行级 differs),**不做词级 diff** | 词级 diff 对中文/长 prompt 收益低、实现重 |
| 同步 zoom/pan | 不做(v2) | 静态并排 + Lightbox 放大已覆盖主流程 |

## 4. 详细设计

### 4.1 纯函数(`src/lib/compareTasks.ts`,新建)

```ts
export interface CompareRow {
  key: string          // 'prompt' | 'style' | 'size' | 'quality' | 'output_format' | 'moderation' | 'n' | 'elapsed'
  label: string        // 中文行标题
  values: string[]     // 每列的展示值(与 tasks 同序)
  differs: boolean     // 值不全相同 → 行高亮
  multiline?: boolean  // prompt 行:多行展示
}

/** 行序固定:prompt → 风格 → 尺寸 → 质量 → 格式 → 审核 → 数量 → 耗时。 */
export function buildCompareRows(tasks: TaskRecord[]): CompareRow[]
```

- 参数值经 `getParamDisplay(task, key).displayValue`(请求/实际归一后再比较——两列请求同为 `auto` 但实际解析不同时**应该**判 differs,这是对照实验关心的真实差异)。
- 风格行:`stylePreset` 经 `STYLE_PRESETS[key].label` 转中文,无风格显示「无」。
- 耗时行:`task.elapsed` 秒化(无值显示「—」),**不参与 differs**(耗时必然不同,恒高亮没有信息量)→ `differs: false` 写死。
- `output_compression` 仅 jpeg/webp 相关:任一列格式非 png 时才追加该行(对齐 DetailModal 条件渲染)。

### 4.2 UI 状态(`src/store/slices/ui.ts`)

```ts
compareTaskIds: string[] | null          // null=关闭;长度 2~4
setCompareTaskIds: (ids: string[] | null) => void
```

瞬态,不进 partialize。

### 4.3 组件(`src/components/CompareModal.tsx`,新建)

- `compareTaskIds` 为 null 或解析出的有效 task < 2 时返回 null(task 可能在打开期间被删,渲染期过滤兜底)。
- 布局:`fixed inset-0 z-50`,面板 `max-w-[95vw] max-h-[92vh]`;列容器 `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-{N}`(桌面 N 列,移动端纵向堆叠滚动)。
- 每列:
  - 列头:A/B/C/D 字母标 + 网格坐标(若 task.gridCoord)或创建时间。
  - 图区:当前输出图 `object-contain`(高度 ~40vh),点击 `setLightboxImageId(当前图, 该列全部输出图)`;多图时图下圆点切换(列内独立 index)。
  - 图加载:DetailModal 同款 cache-first effect(整组 task 的 outputImages 一次收集)。
- 参数区:`buildCompareRows` 行模型渲染为**跨列对齐的行**——行标题在左,值按列展示;`differs` 行加 `bg-blue-50/50 dark:bg-blue-500/[0.06]` + 行标题蓝点。prompt 行 multiline、`break-words`、max-h 滚动。
- 关闭:Esc(useCloseOnEscape)/ 右上 X / 遮罩点击;useLockBodyScroll + useFocusTrap;挂在 App.tsx modal 区(ErrorBoundary)。

### 4.4 入口(`SelectionActionBar.tsx`)

- 新增「对比」按钮(收藏与删除之间):
  - 可用:`2 ≤ selectedTaskIds.length ≤ 4` 且选中任务全部 `status === 'done'` 且有输出图。
  - 不满足:按钮禁用 + title 说明(「选择 2~4 条已完成任务进行对比」)。
  - 点击:`setCompareTaskIds(selectedTaskIds)`(**不**清空选择——对比完可能继续批量操作)。

## 5. 边界与错误处理

- **打开期间任务被删**:渲染期按 id 解析,缺失列直接消失;有效列 < 2 时整体关闭(渲染 null 并同步重置状态副作用避免空壳)→ 用 effect 检测并 `setCompareTaskIds(null)`。
- **图片未加载完**:列图区出现占位(与 DetailModal 同款灰底),不阻塞参数区。
- **running/error 任务**:入口已挡(仅 done);防御性渲染:无输出图列显示「无输出」占位。
- **gridCoord 列头**:轴值直接展示原始 value(不做 label 化,避免引入 gridExperiment 依赖面);无 gridCoord 用 `创建于 HH:mm:ss`。
- **移动端**:纵向堆叠后参数区每列重复行标题(跨列对齐在单列布局下退化为「每列自带参数表」)→ 简化:参数区在移动端仍渲染同一行模型,行内值横向排列可滚动。

## 6. 测试计划

- `compareTasks.test.ts`(纯函数):行序固定;值经实际参数归一(请求 auto + 实际不同 → differs);风格 label 化;elapsed 不参与 differs;output_compression 条件行;2/3/4 列。
- 端到端(Playwright):注入 2 条参数不同的 done task → 框选/程序选中 → 「对比」→ 两列渲染、差异行高亮存在、点图开 Lightbox、Esc 逐层关闭。
- `tsc` / `eslint` / `vitest` 全绿。

## 7. 非目标(本期)

- 不做同步 zoom/pan(v2;Lightbox 放大已覆盖)。
- 不做词级 prompt diff。
- 不做 >4 列、不做对比视图内的任务操作(删除/收藏/重试)。
- 不做矩阵内「整行/整列对比」快捷入口(A3/v2 一并考虑)。
- 不做对比结果导出(归 A3 对照导出)。
- 不做 per-image actualParams 粒度(用 task 级)。

## 8. 落地顺序

1. `lib/compareTasks.ts` + 测试(纯函数先行)。
2. `ui` slice `compareTaskIds`。
3. `CompareModal.tsx` + App.tsx 挂载。
4. `SelectionActionBar`「对比」按钮。
5. Playwright 端到端 + 全量回归。
