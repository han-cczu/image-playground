# 存储用量面板 + 孤儿图片 GC 设计

- 日期：2026-06-03
- 状态：待评审
- 范围：在设置面板「数据管理」区新增本地存储用量可视化（总占用、按来源拆分、浏览器配额占比、孤儿图片统计），并提供手动「清理孤儿图片」入口。核心是把 `initStore` 已内联存在的孤儿 GC 引用扫描逻辑抽成**单一可复用纯函数**，面板与启动清理共用，杜绝双份逻辑漂移。

## 1. 背景与目标

「本地优先」是本项目的核心承诺：所有图片以 Blob 形式存 IndexedDB，按 SHA-256 内容寻址去重。代价是 IndexedDB 只增不显——用户无从得知占用多少、是否有可清理的死数据。

**关键事实：孤儿 GC 逻辑已经存在，只是没有出口。**
- `initStore`（`src/lib/taskRuntime.ts:296-329`）启动时已扫描所有图片，删除「无任何 task/inputImage 引用」且 `createdAt < initStartedAt` 的孤儿图。
- `removeTask` / `removeMultipleTasks` / `rollbackStoredImages` 在删任务时即时清理失去引用的图。

所以本特性**不是「实现 GC」，而是「把已验证的引用扫描可视化 + 给用户手动触发入口」**。这决定了它低风险——不发明新的删除判定，只复用现成判定。

**目标**：
- 抽 `collectReferencedImageIds(tasks, inputImages)` 纯函数，作为「图片是否在用」的**唯一真相**。
- `initStore` 改用该函数（行为保真，含两层引用集 + `createdAt` 守卫）。
- 新增 `computeStorageStats()`：总字节、图片数、按 `source` 拆分、孤儿数/字节，叠加 `navigator.storage.estimate()` 配额占比。
- `DataManagementSection` 展示用量 + 「清理 N 张孤儿图（约 X MB）」按钮（二次确认）。

**明确不做**：见第 8 节（尤其「按对话拆分用量」因归属歧义本期不做）。

## 2. 现状盘点

- **图片存储**：`StoredImage { id, blob?, mime?, dataUrl?, createdAt?, source? }`（`src/types.ts:194`）。`source: 'upload'|'generated'|'mask'`，**可选**（旧数据可能无）。新写入统一转 `blob`，旧数据可能仍是 `dataUrl`。
- **取全部图**：`getAllImages(): Promise<StoredImage[]>`（`src/lib/db.ts:205`）。`blob.size` 可直接读，无需解码内容。
- **字节估算**：旧版 `dataUrl` 图无 blob，用 `getDataUrlDecodedByteSize(dataUrl)`（`src/lib/api/imageApiShared.ts:110`，已存在）估算解码后字节。
- **引用扫描（待抽取）**：`initStore` 内联两段——
  - 第一段 `referencedIds`：遍历 `tasks` 的 `inputImageIds`/`maskImageId`/`outputImages` + `persistedInputImages`。
  - 第二段 `latestReferencedIds`：删除前**重读** `useStore.getState()` 的最新 `inputImages`/`tasks` 再扫一遍。
  - 删除条件：`!referencedIds.has(id) && !latestReferencedIds.has(id) && (createdAt ?? 0) < initStartedAt`。两层引用集 + 时间守卫互补，「最坏只漏删孤儿（良性泄漏），绝不误删在用图」（原注释）。
- **删除单图**：`deleteImage(id)` + `deleteCachedImage(id)`（DB + 内存缓存成对删，见 `rollbackStoredImages`）。
- **UI**：`DataManagementSection`（纯展示，props 注入回调）渲染于 `SettingsModal/index.tsx` 的「数据管理」`<section>`。
- **确认对话**：全局 `setConfirmDialog`（store ui slice），`onConfirmClearAll` 已是「清空所有数据」的现成确认范例。

## 3. 采用方案

**新建 `src/lib/storageStats.ts` 收纳「引用扫描 + 用量统计 + 孤儿清理」，`initStore` 反向依赖它。**

理由：
- 引用扫描是正确性敏感逻辑（误删 = 用户作品丢失）。必须**单点定义、双处复用**（启动 GC + 手动 GC + 统计），任何对「什么算在用」的修改只改一处。
- 统计与清理是同一份引用集的两种消费（数孤儿 vs 删孤儿），天然同模块。

**已否决**：
- 方案 B「面板里重写一套引用扫描」——与 `initStore` 双份逻辑，未来加新引用字段（如方案二的血缘 `derivedFromImageIds`、本批的输入图）必漏一处 → 误删风险，明确否决。
- 方案 C「`computeStorageStats` 顺手做按对话拆分」——一张去重图常被多 task/多对话引用，bytes 归属无唯一解（计入每个对话则总和 > total，误导用户）。本期不做，降为非目标。

## 4. 详细设计

### 4.1 `src/lib/storageStats.ts`（新建）

```ts
import type { TaskRecord, InputImage, StoredImage } from '../types'

/**
 * 收集当前所有「在用」图片 id：tasks 的 inputImageIds / maskImageId / outputImages，
 * 外加输入栏暂存的 inputImages。是「图片是否可被回收」的唯一判定来源。
 * 纯函数，不读全局态、不碰 DB。
 */
export function collectReferencedImageIds(
  tasks: TaskRecord[],
  inputImages: Pick<InputImage, 'id'>[],
): Set<string>

/** 单张图的字节数：优先 blob.size，回退 dataUrl 解码估算，再回退 0。 */
export function storedImageByteSize(img: StoredImage): number

export interface StorageStats {
  totalBytes: number
  imageCount: number
  /** 按 source 桶聚合；source 缺失归入 unknown */
  bySource: Record<'upload' | 'generated' | 'mask' | 'unknown', { count: number; bytes: number }>
  orphanCount: number
  orphanBytes: number
  /** navigator.storage.estimate() 结果；不支持时为 null */
  quota: { usage: number; quota: number } | null
}

/** 读全部图 + 当前引用集 → 统计。引用集由调用方传入（来自 store 快照），保证与 UI 一致。 */
export async function computeStorageStats(referencedIds: Set<string>): Promise<StorageStats>

/**
 * 删除当前无引用且 createdAt < cutoff 的孤儿图（DB + 内存缓存成对删）。
 * 返回 { deletedCount, deletedBytes }。cutoff 守卫沿用 initStore 语义：放过清理期间
 * 另一标签刚写入、其 task 尚未进本页 store 的新图。
 */
export async function pruneOrphanImages(
  referencedIds: Set<string>,
  cutoff: number,
): Promise<{ deletedCount: number; deletedBytes: number }>
```

- `collectReferencedImageIds`：把 `initStore` 内联的收集逻辑原样搬入（含 `inputImageIds || []` 等空值兜底）。
- `computeStorageStats` / `pruneOrphanImages` 内部 `getAllImages()` 各取一次；孤儿判定 = `!referencedIds.has(img.id)`（统计）/ 再叠加 `(img.createdAt ?? 0) < cutoff`（删除）。
- **删除守卫差异（关键）**：统计 `orphanCount` 用「当前是否无引用」即可（展示性，不删数据，无需时间守卫，否则会把刚生成还没进引用集的图误报为孤儿）。但**删除**必须叠加 `createdAt < cutoff`，与 `initStore` 完全一致。spec 显式区分二者，避免实现时把守卫用错地方。

### 4.2 `initStore` 重构（`src/lib/taskRuntime.ts`）

把两段内联收集替换为函数调用，**行为保真**：

```ts
// 删除前：
const referencedIds = collectReferencedImageIds(tasks, persistedInputImages)
// ...getAllImages...
const latest = useStore.getState()
const latestReferencedIds = collectReferencedImageIds(latest.tasks, latest.inputImages)
for (const img of images) {
  if (referencedIds.has(img.id) || latestReferencedIds.has(img.id)) continue
  if ((img.createdAt ?? 0) >= initStartedAt) continue
  await deleteImage(img.id)
  deleteCachedImage(img.id)
}
```

- 两层引用集（初始 + 最新重读）的并发防护**保留不动**，只是收集动作换成共享函数。
- `initStore` 不改用 `pruneOrphanImages`：后者只取一次引用集，而 `initStore` 的双层重读是迁移期特有的强保护，价值高于复用，保持现状。共享的只是 `collectReferencedImageIds`。这点在 spec 中明确，防止实现时为「复用」过度合并而削弱启动期防护。

### 4.3 面板数据装配（`src/components/SettingsModal/index.tsx`）

- 新增本地 state：`storageStats: StorageStats | null`、`storageLoading: boolean`。
- 打开设置面板（或展开数据管理区）时触发一次加载：
  ```ts
  const { tasks, inputImages } = useStore.getState()
  const refs = collectReferencedImageIds(tasks, inputImages)
  setStorageStats(await computeStorageStats(refs))
  ```
- 「清理孤儿」回调：
  ```ts
  const onPruneOrphans = () => setConfirmDialog({
    title: '清理孤儿图片',
    message: `将删除 ${stats.orphanCount} 张无引用图片，约 ${formatBytes(stats.orphanBytes)}，不可恢复。`,
    confirmText: '清理', tone: 'danger',
    action: async () => {
      const { tasks, inputImages } = useStore.getState()        // 重读最新引用集
      const refs = collectReferencedImageIds(tasks, inputImages)
      const { deletedCount, deletedBytes } = await pruneOrphanImages(refs, Date.now())
      showToast(`已清理 ${deletedCount} 张，释放约 ${formatBytes(deletedBytes)}`, 'success')
      // 重新计算并刷新面板
      setStorageStats(await computeStorageStats(collectReferencedImageIds(...)))
    },
  })
  ```
- **重读引用集**：确认弹窗到执行之间用户可能又生成了图，故 `action` 内**重新** `collectReferencedImageIds`，不能用打开面板时的快照。`cutoff = Date.now()` 守卫放过执行期间另一标签的新写入。
- 字节格式化：复用或新增 `formatBytes`（`imageApiShared.ts` 有内部 `formatMiB`，可提取为导出工具或在面板内自带轻量实现）。

### 4.4 面板 UI（`src/components/SettingsModal/DataManagementSection.tsx`）

在现有导出/导入/清空按钮**之上**新增用量区块，props 扩展：

```ts
interface DataManagementSectionProps {
  // ...既有...
  storageStats: StorageStats | null
  storageLoading: boolean
  onPruneOrphans: () => void   // 内部走 setConfirmDialog
}
```

渲染（暗色光晕风格，与现有 className 一致）：
- 一行总量：`本地占用 1.2 GB · 共 340 张图片`，`storageLoading` 时骨架/占位。
- 配额条（`quota` 非 null 时）：`navigator.storage.estimate()` 的 `usage / quota` 百分比进度条。
- 按来源拆分：upload / generated / mask /（unknown 仅在 >0 时显示）小标签，各显 `count · bytes`。
- 孤儿行：`orphanCount > 0` 时显示「N 张孤儿图（约 X MB）」+「清理」按钮（`onPruneOrphans`）；为 0 时显示「无可清理的孤儿图」灰字、按钮禁用或隐藏。

### 4.5 字节格式化与配额

- `navigator.storage?.estimate?.()`：异步、可能 reject 或不支持（HTTP 非安全上下文也可能缺失）→ try/catch，失败则 `quota: null`，UI 隐藏配额条。
- `formatBytes(n)`：B/KB/MB/GB 自适应，1 位小数。建议放 `storageStats.ts` 一并导出，面板与 toast 共用。

## 5. 消费方影响

- `SettingsModal/index.tsx`：新增 state + 加载 effect + prune 回调 + 透传 props。
- `DataManagementSection`：扩 props + 新增用量区块。
- `initStore`：仅把内联收集换成 `collectReferencedImageIds`，无行为变化。
- 其余删除路径（`removeTask` 等）本期**不强制**改用共享函数（它们的「仍被引用」扫描语义略不同——是「剩余 task」而非「全部 task」）；可作为后续清理项，但本 spec 不动，避免扩大改动面。

## 6. 边界与错误处理

- **统计 vs 删除的守卫**：统计孤儿不加 `createdAt` 守卫（否则刚生成的图被误报为孤儿，吓用户）；删除孤儿必须加 `cutoff` 守卫。4.1 已显式区分。
- **删除期并发**：`action` 内重读引用集 + `cutoff=Date.now()`，与 `initStore` 同款双保险，最坏漏删（良性），绝不误删在用图。
- **旧 `dataUrl` 图**：`storedImageByteSize` 回退 `getDataUrlDecodedByteSize`；`source` 缺失归 `unknown` 桶。
- **大库性能**：`getAllImages` 遍历全部记录，但只读 `blob.size`（不解码），内存只持 Blob 引用，可接受。若未来需优化可加 IDB 游标累加，本期不预优化。
- **配额 API 缺失/报错**：降级隐藏配额条，不阻断其余统计。
- **清理后刷新**：prune 完重算 stats 回填面板，避免显示陈旧孤儿数。
- **空库**：`totalBytes=0`、各桶 0、`orphanCount=0`，UI 正常显示「无」。

## 7. 测试计划

- **`storageStats.test.ts`（新增）**：
  - `collectReferencedImageIds`：覆盖 inputImageIds/maskImageId/outputImages/inputImages 并集、空值兜底、重复 id 去重。
  - `storedImageByteSize`：blob.size 优先、dataUrl 回退、空图回退 0。
  - `computeStorageStats`：mock `getAllImages`，验证 total/bySource（含 unknown 桶）/orphan 计数；引用集命中项不计孤儿。
  - `pruneOrphanImages`：mock `getAllImages`/`deleteImage`，验证只删「无引用且 createdAt < cutoff」者；被引用图、新图（createdAt ≥ cutoff）不删；返回计数/字节正确。
- **`initStore` 回归**：现有 taskRuntime/store 测试应继续通过（行为保真）。补一条「被引用图不被启动 GC 删除」若现状未覆盖。
- **类型/构建**：`npm run lint` + `npm run test` + `tsc --noEmit` 全绿。

## 8. 非目标

- **不做「按对话拆分用量」**：去重图多对话归属无唯一解，bytes 不可加和，易误导。降为未来增强。
- 不做自动定时 GC（仍仅启动时 + 手动触发）。
- 不改 `removeTask`/`removeMultipleTasks`/`rollbackStoredImages` 的即时清理逻辑（仅未来可选收敛到共享函数）。
- 不做按图片清单的逐张管理/预览/手动删单图（本期只到「批量清孤儿」粒度）。
- 不引入 IDB 游标流式统计优化（大库前不预优化）。

## 9. 落地顺序建议（实现期）

1. `storageStats.ts`：`collectReferencedImageIds` + `storedImageByteSize` + `formatBytes` + 测试（纯函数，零风险）。
2. `initStore` 改用 `collectReferencedImageIds`，跑回归确认保真。
3. `computeStorageStats` + `pruneOrphanImages` + 测试。
4. `SettingsModal/index.tsx` 装配 state/加载/prune 回调。
5. `DataManagementSection` 用量 UI。
