# 大库性能轮设计(IDB 游标统计 + content-visibility 选择性渲染)

- 日期:2026-06-08
- 状态:待评审(roadmap v2 第 5 项 C1,v2 收官)
- 范围:大库(数千~上万 task / 图)下的两处性能:(1) 存储统计/孤儿清理从 `getAllImages()` 一次性拉全部 blob 进内存改为 **openCursor 流式只累加字节不驻留**;(2) 任务流渲染用 **content-visibility:auto** 跳过视口外渲染 + React.memo + 三项正交快赢,**不引第三方虚拟滚动库、不碰 dnd/框选**。
- 设计过程:4 读者摸底 + 3 方案(激进虚拟化/务实分页/IDB优先+选择性渲染)judge panel。正确性评审选 idb-first(8.5)、契合度评审选 pragmatic(8.5),aggressive 6.5 垫底。本 spec = idb-first 骨架 + 嫁接 pragmatic 三快赢 + aggressive 分批续游标/memo 陷阱。

## 1. 背景与目标

- **IDB**:`computeStorageStats` / `pruneOrphanImages`(`storageStats.ts:97/133`)各 `await getAllImages()` 把全部 blob 物化进 JS 堆,大库下峰值内存 O(N) + GC 卡顿;`pruneOrphanImages` 还逐张 `deleteImage` 开 N 个独立 readwrite 事务(`db.ts:214`)。
- **渲染**:TaskGrid `renderItems.map` 全量渲染所有卡(`TaskGrid.tsx:317`),无任何虚拟化;上万 task 时 DOM 渲染/布局/绘制成本爆炸,框选重渲染又触发全网格 reconcile。

**目标**:存储统计内存与库大小解耦(O(1));任务流滚动流畅度由"活跃渲染节点"而非"DOM 总数"决定;**dnd 拖拽排序、框选、入场动画一行不改**。

## 2. 现状盘点(摸底结论,均带行号)

- **dnd 与 windowing 天然互斥**:`SortableContext.items` 须覆盖全部可拖 id 且每成员真实挂载 `useSortable` 节点(`setNodeRef`)才能被命中为 over 目标;`handleDragEnd` 用 `filteredTasks.findIndex(over.id)`(`TaskGrid.tsx:161`)+ `closestCenter`(:314)。虚拟化卸载视口外节点 → over 落空。**这是排除虚拟滚动/分页的根因。**
- **content-visibility 不卸载节点**:视口外元素跳过渲染/布局/绘制,但 DOM 在场——`useSortable` 节点全注册(dnd 零改)、`.card-enter` 不随滚动 mount/unmount 重播。**注(实现期审查修正)**:被跳过元素受 size containment,`getBoundingClientRect` 返回 `contain-intrinsic-size` 占位框而非真实几何;框选不受影响**不是**因占位卡返回真实几何,**而是框选严格视口受限**(选择只读 clientX/clientY、无 auto-scroll,已核实)——视口外占位卡本就在任何选择框之外。dnd over 目标只能是指针所在(视口内、已渲染)的卡。四冲突不成立的真正理由是"DOM 在场 + 框选/dnd 本就视口受限",精确视觉/拖拽以 Playwright 实测为准。
- **变高矩阵块**:`TaskGridMatrix` 根 `col-span-full`(`TaskGridMatrix.tsx:142`)占整行,高度随 cols×rows 笛卡尔积可变,远大于 `h-40` 定高普通卡。虚拟滚动的定高假设被打破——而 `contain-intrinsic-size: auto` 让浏览器缓存实测高度,CSS 原生吸收变高,无需 ResizeObserver/估高公式。
- **IDB 游标骨架先例**:`deleteConversation`(`db.ts:187-194`)用 `openCursor + cursor.continue()`,**resolution 挂 `tx.oncomplete` 而非 cursor onsuccess**(`db.ts:179`),已用 fake-indexeddb 实跑(`db.test.ts:118`)。`dbTransaction`(`db.ts:74`)契约是"单 IDBRequest 首个 onsuccess 即 resolve",游标多次 onsuccess 会提前 resolve,**不能复用**,须新增专用 helper。
- **initStore 启动 GC 不动**:`taskRuntime.ts:364` 的 `getAllImages` + imageById Map 双层引用集重读是迁移期多标签竞态防护(`code-review-2026-05-31.md:105` 证实可达),且 Map 被 restoredInputImages 复用需 blob 本体。动它正确性风险/收益不匹配。
- **memo 失效陷阱**:`TaskGrid.tsx:333-342` 在 galleryView 下每 render 新建 `conversationTag` 对象 → 不缓存则 React.memo 整体失效。

## 3. 关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 渲染策略 | **content-visibility:auto + contain-intrinsic-size**,不引虚拟滚动库 | 唯一与现有 dnd/框选/动画零冲突、跨桌面/移动两套滚动模型零适配、旧浏览器优雅降级为现状全量的方案;契合"不引第三方 UI 库"倾向 |
| 不选分页 | pragmatic 的分页虽真减 DOM,但**框选跨库全选退化**(视口外卡无 DOM)、card-enter 追加页突兀、IntersectionObserver root 按断点切换易错 | 框选退化是现状支持的语义(从顶按下滚到底松开选满库),退化比"本就只作用可视区"的说辞更实质 |
| 不选虚拟滚动 | aggressive 的 chunked 把四个硬冲突全部引回,靠"仅 dragDisabled+超阈值启用"脆弱规避,且第三层自承认"多数到 content-visibility 即够" | 过度工程:边际收益(真减节点数)不抵引回的全部冲突 |
| IDB 范围 | 仅 `computeStorageStats` / `pruneOrphanImages` 两函数;**排除 initStore 启动 GC** | 后者竞态防护 + Map 复用本体,风险高;**诚实标注:本轮覆盖低频手动路径(打开设置才触发),高频的冷启动尖刺仍在,留后续工作包** |
| IDB helper | 新增 `forEachImageMeta`(readonly)/ `pruneImagesViaCursor`(readwrite),**resolve 一律挂 `tx.oncomplete`**,不在 cursor onsuccess 内 resolve | 对齐 `db.ts:98/179` 既有范式;写路径 onsuccess≠落盘,提交阶段 abort 会静默丢写 |
| 删除分批 | pruneImagesViaCursor 预留分批续游标(`IDBKeyRange.lowerBound(lastKey, true)` 续扫,每 BATCH=500 提交),**默认一锅端 + 留接口** | 几千张孤儿单事务有空闲超时风险;但 prune 是低频手动操作,首版一锅端 + Playwright 实测再启用分批 |
| DB 版本 | 维持 DB_VERSION 2,**不升级、不建 index** | images store 无 index,统计/全量 GC 本就全表扫,主键顺序游标无损;建 createdAt/source index 需升级+迁移+回归,增量扫描收益本轮用不到 |
| 软上限 cap | 超阈值(CAP=2000)`renderItems.slice(0, CAP)` + 底部提示行 | 复用 `remediation-plan:1782` ModelListDropdown "slice 前 N + 提示"范式;cap 触发时几乎必配筛选(dragDisabled=true),不破坏拖拽连续性 |

## 4. 设计明细

### 4.1 IDB 游标统计(主交付,确定收益)

1. **`db.ts` 新增两 helper**(手写 `openDB().then(db => new Promise(...))`,照搬 deleteConversation 骨架):
   - `forEachImageMeta(onRecord: (img: StoredImage) => void): Promise<void>` — readonly 游标,`onsuccess` 内 `const c = req.result; if (!c) return; onRecord(c.value); c.continue()`;**resolve 挂 tx.oncomplete**,onerror/onabort → reject。onRecord 内同步取 `storedImageByteSize(c.value)` 标量后,blob 引用随 continue 即可 GC,任一时刻只持 1 条 + 累加器。
   - `pruneImagesViaCursor(shouldDelete, onDeleted, opts?): Promise<void>` — readwrite 游标,命中 `shouldDelete(c.value)` 则 `onDeleted(c.value)` + `c.delete()`;**resolve 挂 tx.oncomplete**。分批参数预留(默认关)。
2. **`storageStats.ts` 改造**(签名/出入参形态不变,纯内部替换):
   - `computeStorageStats`:删 `getAllImages()`,改 `forEachImageMeta`,累加器(totalBytes/bySource/orphanCount/orphanBytes/imageCount)提到闭包;**严格保留** orphan 不加 cutoff 守卫(`:93-95`)、quota 读取不动。
   - `pruneOrphanImages`:改 `pruneImagesViaCursor(img => !refs.has(img.id) && (img.createdAt ?? 0) < cutoff, img => { deletedCount++; deletedBytes += size; pendingCacheDeletes.push(img.id) })`,事务完成后 `pendingCacheDeletes.forEach(deleteCachedImage)`(内存缓存事务外删)。**严格保留** cutoff 守卫、缺 createdAt 视为 0。

### 4.2 渲染优化

1. **content-visibility(主手段)**:`.task-card-wrapper`(`TaskGrid.tsx:68`)与矩阵块根(`TaskGridMatrix.tsx:142`)加 `content-visibility: auto; contain-intrinsic-size: auto <占位高>`。普通卡 `auto 160px`(h-40+gap),矩阵块 `auto 600px`(估不准只影响滚动条初长,进视口自校正)。浏览器按视口自动判定,**不读 scroll parent**,桌面/移动通吃。
2. **React.memo + 稳定回调**(落地 `code-review-2026-05-29:198` 既有未实施方案):`SortableTaskCard`/`TaskCard` 加 `React.memo`;`TaskGrid.tsx:352-371` 每卡内联闭包改为**以 taskId 为参的稳定 useCallback**;**`conversationTag` 用 useMemo 缓存**(否则 memo 失效)。
3. **软上限 cap**:`filteredTasks.length > CAP` 时 `renderItems.slice(0, CAP)` + 底部"仅显示前 N 条,共 M 条,请用搜索/筛选缩小范围"提示行。

### 4.3 三项正交快赢(嫁接 pragmatic)

- **搜索防抖**:`SearchBar` onChange → setSearchQuery 加 ~200ms debounce,消除逐字键入触发 `App.tsx:47` 与 `TaskGrid.tsx:118` 双重全量 `filterAndSortTasks` + per-task `JSON.stringify`(`taskFilters.ts:49`)。
- **App.tasksInActiveConversation 降级**:它只服务 `showEmptyState` 的 `.length===0`(`App.tsx:63`),改 `.some()` 存在性判定,免一遍全量 sort+filter。
- (React.memo + 稳定回调已在 §4.2.2)

## 5. dnd 处理:一行不改

content-visibility 不卸载节点 → 所有 `useSortable` 在场 → dnd 零冲突。现有 `dragDisabled` 多条件(galleryView/搜索/筛选/`<2`条/hasGridBlock,`TaskGrid.tsx:143-150`)继续原样;cap 截断时 sortableIds 仅来自被渲染的 slice 前 N,与"hasGridBlock 整列表禁拖"同理不产生 items 引用未渲染卡的不一致。**大库拖拽体验与现状完全一致。**

## 6. 非目标(诚实标注)

- **虚拟滚动 / 分页 / 真正减少 DOM 节点数**:content-visibility 跳过绘制但仍 mount 上万 TaskCard 实例(各带 setInterval/Image-decode/IDB 缩略图 useEffect)——初始 mount 成本与节点内存不降,由 cap 兜底。若实测 10k 库 React 实例成本压不住,**分页(visibleCount slice + IntersectionObserver 哨兵)是比 chunked 更安全的升级路径**(只截尾不卸已渲染卡,handleDragEnd 经核实可零改),列为后续。
- **initStore 启动 GC 游标化**:更高价值(每次冷启动必触发)但更高风险(竞态防护 + Map 复用),独立工作包。本轮 IDB 优化覆盖的是低频手动路径。
- 建 createdAt/source index 做增量 GC;DB 版本升级。

## 7. 测试计划

- **db.ts 游标 helper**(fake-indexeddb,对齐 `db.test.ts`):`forEachImageMeta` 遍历全部记录、空库、tx.oncomplete resolve 时机;`pruneImagesViaCursor` 命中删除/未命中保留/cutoff、cursor.delete 链路(`db.test.ts:118` 已证)。
- **storageStats.test.ts 改造**(⚠️ 共有盲点:**deleteImage 断言必改**):现 `:92-93` 断言 `deleteImage` 被调用——游标化后 pruneOrphanImages 不再调 deleteImage(改 `cursor.delete()` + 内存缓存 `deleteCachedImage`)。把 `vi.mock('./db')` 的 getAllImages 换 mock forEachImageMeta/pruneImagesViaCursor 对喂入数组逐条回调;**断言改为 pruneImagesViaCursor 被调 + deleteCachedImage 行为**;computeStorageStats 的 totalBytes/orphan/bySource/quota 断言保留。
- **渲染**:content-visibility 是纯 CSS 无可单测逻辑;cap 的 `renderItems.slice` 边界纯函数化可测;memo/稳定回调靠 React DevTools 手验。
- **内存收益**(⚠️ 共有盲点:**不可单测证伪**):峰值内存 O(1) vs O(N) 单测拿不到硬数据(fake-indexeddb 不代表 Chromium blob 物化行为),只能 Playwright `measureUserAgentSpecificMemory`/heap snapshot 量化;**交付时标注为"代码不再持有全量数组"的设计正确性保证,而非实测收益**。
- **e2e**(Playwright 配方,⚠️ content-visibility 的视觉/dnd/框选交互均需真实 Chromium 验证,单测拿不到):大库注入后滚动流畅度(content-visibility 生效)、SettingsModal 打开统计不卡、prune 后孤儿清零、视口内框选/拖拽正确、拖向滚入视口的目标 over 命中正确、含多矩阵块快速滚动无明显滚动条跳动。

## 8. 触及文件

`src/lib/db.ts`(2 游标 helper)· `src/lib/storageStats.ts`(2 函数改造)· `src/lib/storageStats.test.ts`(断言改造)· `src/lib/db.test.ts`(helper 测试)· `src/components/TaskGrid.tsx`(content-visibility 类 + memo + 稳定回调 + conversationTag useMemo + cap slice)· `src/components/TaskGridMatrix.tsx`(矩阵块 content-visibility 类)· `src/components/TaskCard.tsx`(React.memo)· `src/components/SearchBar.tsx`(防抖)· `src/App.tsx`(tasksInActiveConversation → some)· `src/index.css`(content-visibility 工具类,若不走 inline)
