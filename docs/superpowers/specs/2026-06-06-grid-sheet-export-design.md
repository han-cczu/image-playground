# 对照导出 + 批次笔记设计

- 日期:2026-06-06
- 状态:已评审(roadmap v2 已获批,按推荐顺序实施)
- 范围:roadmap v2 第 3 项(A3+A4 合并)。XY 矩阵一键导出**带行列轴标签的 canvas 拼图 PNG**;批次可附**笔记**,展示在矩阵标题栏并随导出图带出。补上实验闭环的「结论留存与带出」环节。

## 1. 背景与目标

- 实验结果(矩阵对照)只活在本地浏览器,无法分享/归档——XY 网格 spec v2 清单项。
- 实验结论(为什么选这格)无处落笔——批次级元数据当时被列为非目标,本期补上。

**目标**:矩阵标题栏「导出对照图」→ 生成 PNG(行列轴标签 + 单元格代表图 + 可选笔记头);「笔记」→ 行内编辑,持久化、随 ZIP 备份迁移、画进导出图。

## 2. 现状盘点(可复用件)

- `reconstructMatrix`(`lib/gridExperiment.ts`):cols/rows/cellTasks 骨架;`TaskGridMatrix` 的 `repTask`(同格取最新)逻辑需提为共享纯函数。
- `ensureImageCached(id)` → blob URL(同源,canvas 无 taint);`new Image()` 加载后 `drawImage`。
- 持久化范式:snippets 同款(zustand persist + normalize + 导出 manifest 字段 + merge)。
- 下载链路:`exportData` 的 `a.click()` 模式。

## 3. 关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 拼图单元格 | **固定方格**(512×512 区域,object-contain 居中) | size 轴实验中各格比例不同,统一方格最稳;留白可接受 |
| 格代表图 | repTask(最新)的当前首图 | 与矩阵 UI 显示一致 |
| 布局计算 | **纯函数 `computeSheetLayout`**(矩形数学),canvas 绘制薄壳 | 布局可单测;绘制仅 e2e 验证 |
| 导出底色 | 固定浅色(白底深字) | 分享/打印可读性;不跟随主题 |
| 笔记字段 | 单 `text`(≤500 字符),不做独立标题 | 标题栏已有 X/Y/进度自动信息,自定义标题低价值 |
| 笔记存储 | zustand persist `batchNotes: Record<batchId, {text, updatedAt}>` | 对齐 snippets 范式;批次实体仍不进 IDB(维持 XY spec 决策);文本量级小 |
| 孤儿笔记 | 导出 ZIP 时过滤掉无 task 引用的;localStorage 内残留不 GC | 几百字节无害,启动 GC 涉改 initStore,v2 再议 |

## 4. 详细设计

### 4.1 布局纯函数(`src/lib/gridSheet.ts`,新建)

```ts
export const SHEET_CELL_SIZE = 512
export const SHEET_GAP = 12
export const SHEET_PADDING = 24
export const SHEET_COL_HEADER_H = 48
export const SHEET_ROW_HEADER_W = 120   // 有 Y 轴时
export const SHEET_NOTE_LINE_H = 28
export const MAX_BATCH_NOTE_LEN = 500

export interface SheetLayout {
  width: number
  height: number
  noteLines: string[]          // 已按宽度折行的笔记(0 行=无笔记区)
  noteRect: Rect | null
  colHeaderRect(col: number): Rect
  rowHeaderRect(row: number): Rect   // 无 Y 轴时行头宽 0
  cellRect(col: number, row: number): Rect
}

/** measureWidth 由调用方注入(浏览器侧用 canvas.measureText;测试注入字符近似)。 */
export function computeSheetLayout(opts: {
  cols: number; rows: number; hasY: boolean
  note?: string
  measureWidth: (text: string) => number
}): SheetLayout
```

- 笔记折行:贪心按 `width - 2*padding` 切行,最多 4 行(超出截断加 `…`)。
- `normalizeBatchNotes(value: unknown)`:persist/导入兜底(同 normalizeSnippets 模式);`text` trim 非空、截断 500、`updatedAt` 修补。
- `pickCellRepresentative(tasks: TaskRecord[]): TaskRecord | null`:同格取 createdAt 最新——从 `TaskGridMatrix.repTask` 提出共享(矩阵 UI 与导出共用一个判定)。

### 4.2 渲染壳(`src/lib/gridSheetRender.ts`,新建,浏览器侧)

```ts
/** 渲染矩阵对照图并触发下载。失败 throw,由调用方 toast。 */
export async function exportGridSheet(args: {
  tasks: TaskRecord[]        // 同批成员
  batchId: string
  note?: string
}): Promise<void>
```

流程:`reconstructMatrix` → 逐格 `pickCellRepresentative` 取首图 id → `ensureImageCached` → `Image` 加载(`Promise.all`,单图失败置 null 不中断)→ `computeSheetLayout`(canvas `measureText` 注入)→ 绘制:白底 → 笔记行(深灰)→ 列头/行头 label(`axisValue.label`,measureText 截断)→ 每格图 contain 居中(无图格画浅灰底 +「无」)→ `canvas.toBlob('image/png')` → `grid-<batchId 前 8 位>-<ts>.png` 下载。

### 4.3 批次笔记状态(`src/store/slices/ui.ts` 旁——实际放 tasks slice,与 snippets 同居)

```ts
batchNotes: Record<string, { text: string; updatedAt: number }>
setBatchNote: (batchId: string, text: string) => void   // trim 空 → 删除条目;截断 500
```

persist `partialize` + merge `normalizeBatchNotes`;`clearAllData` 清空。

### 4.4 导出/导入(`lib/exportImport.ts`)

- `ExportData.batchNotes?: Record<...>`;导出时**过滤**:仅保留 `tasks` 中存在对应 `batchId` 的条目。
- 导入:merge=本地同 batchId 优先;replace=直接覆盖;旧备份缺字段 → merge 不动 / replace 清空。

### 4.5 UI(`TaskGridMatrix.tsx`)

- 标题栏右侧操作区新增:
  - **「导出对照图」**:`doneCells ≥ 1` 时可用;点击置 loading(防连点)→ `exportGridSheet` → 成功/失败 toast。
  - **「笔记」**:点击展开行内编辑区(标题栏下方一行:textarea + 保存/取消,maxLength 500);有笔记未编辑时显示单行截断文本(title 悬浮全文),点击文本也进入编辑。
- 笔记编辑为组件内 local state(`editingNote: boolean`),保存调 `setBatchNote`。

## 5. 边界与错误处理

- **图片加载失败/缺图格**:画占位(浅灰底 + 「无」),不中断整图导出。
- **大矩阵**:格数上限既有(≤64);8×8 → canvas ≈ 4.3k×4.3k,Chrome 安全范围内;`toBlob` 失败(理论极限)→ throw → toast「导出失败」。
- **并发导出**:按钮 loading 期间禁用。
- **label 超长**(prompt 轴):measureText 截断加 `…`,完整值不进导出图(可读性优先)。
- **删除批次后笔记残留**:localStorage 内无害;导出 ZIP 已过滤;不做启动 GC(v2)。
- **n>1 格**:代表图 = repTask 首图(与矩阵 UI 一致),不平铺多图。

## 6. 测试计划

- `gridSheet.test.ts`:layout 尺寸/矩形数学(有/无 Y 轴、有/无笔记、折行与 4 行截断);normalizeBatchNotes(损坏/超长/空 text 剔除);pickCellRepresentative。
- store 测试:setBatchNote 增/改/删(空 text)/截断;persist merge。
- exportImport 测试:导出过滤孤儿笔记;merge/replace;旧备份兼容。
- 端到端(Playwright):注入网格批次 → 矩阵标题栏写笔记 → 刷新仍在;点「导出对照图」→ 拦截 download 事件断言文件名/非空;笔记进导出图(像素级不验,验流程)。
- `tsc` / `eslint` / `vitest` 全绿。

## 7. 非目标(本期)

- 不做 zip 打包逐格原图导出(单张对照 PNG 足够分享;原图有 ZIP 备份)。
- 不做导出图主题跟随/自定义样式(尺寸/底色/字体写死)。
- 不做批次独立标题字段、不做笔记历史版本。
- 不做孤儿笔记启动 GC。
- 不做非网格批次(纯通配)的对照导出(无行列语义;v2 可做单行条带)。
- 不做导出图内嵌参数表(轴标签已表达差异维度)。

## 8. 落地顺序

1. `lib/gridSheet.ts`(layout + normalize + representative)+ 测试。
2. store `batchNotes` + persist + 测试。
3. `lib/gridSheetRender.ts` 渲染壳。
4. `TaskGridMatrix` 笔记编辑 + 导出按钮。
5. exportImport 集成 + 测试。
6. Playwright 端到端 + 全量回归。
