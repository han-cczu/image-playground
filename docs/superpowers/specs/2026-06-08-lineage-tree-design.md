# 创作谱系树可视化设计(多跳 DAG)

- 日期:2026-06-08
- 状态:待评审(roadmap 第三轮 C2)
- 范围:把现有单跳血缘(DetailModal「派生自/衍生出」缩略图 pill)升级为**多跳图形化谱系树**——独立全屏 LineageModal,展示中心 task 的祖先链 + 后代树(非整连通分量),纵向分层 DAG + SVG 连线 + 缩略图节点。单跳 pill 区保留为轻量预览入口。
- 设计过程:4 读者摸底 + 3 方案(内嵌轻量/独立全屏/务实分层)judge panel。两个评审一致选 **pragmatic(8/8.5)**(embedded 6/6.5、standalone 5.5/7)。本 spec = pragmatic 骨架 + 嫁接 embedded/standalone 亮点 + 正面回应 5 个共有盲点。

## 1. 背景与目标

- `lib/lineage.ts` 的 `findParentTasks`/`findChildTasks` 只推断**单跳**(基于内容寻址 SHA-256 图 id 集合求交:`outputImages ∩ inputImageIds`);DetailModal 渲染直接父/子为可点缩略图 pill(`DetailModal.tsx:586-605`),点击 `setDetailTaskId` 跨 task 跳转。
- 一张图经多轮编辑/反推/网格派生的**完整创作链路**(祖父、孙辈、分叉)目前只能逐跳点击追溯。

**目标**:一图看清中心 task 的祖先+后代多跳谱系,讲清创作叙事;单跳 pill 入口保留不回退;不引第三方图布局库。

## 2. 现状盘点(摸底结论,带行号)

- **单跳求交语义**:父边 = 候选 `outputImages ∩ 当前 inputImageIds`;子边 = 候选 `inputImageIds ∩ 当前 outputImages`;排除自身,按 createdAt 升序(`lineage.ts:21-44`)。`LineageLink={task, sharedImageIds}` 已把同两 task 间多张共享图聚成一条边。
- **mask 不计入血缘**(`2026-06-03-lineage-view-design.md:70`):只读 `inputImageIds`/`outputImages`,不读 `maskImageId`/`maskTargetImageId`——多跳必须延续,否则 mask 图引入噪声边。
- **跨 conversation 全库扫**:DetailModal 用 `useStore(s=>s.tasks)` 全量(非按对话过滤,`DetailModal.tsx:14`),单跳已能跳到别对话 task——多跳收窄到当前对话反而不一致,**保持全库**。
- **独立全屏 modal 先例 CompareModal**:`compareTaskIds:string[]|null` + `setCompareTaskIds`(`ui.ts:50-52`)开关、外层 id 解析 + 内层 `key=` 重置 + auto-close-stale(`CompareModal.tsx:40-55`)、三件套 hooks(`:101-103`)、电影暗色 overlay(`:113-122`)、Lightbox z-[60] 叠放(`:165`)——C2 1:1 套用。
- **纯函数布局先例 gridSheet**:`computeSheetLayout` 算矩形坐标 + 薄渲染壳,"本文件不碰 DOM"(`gridSheet.ts:5`),`gridSheet.test.ts` 用等宽近似喂入断言 rect——C2 布局套同款。
- **缓存上限**:`imageCache.ts:8` MAX_ENTRIES=100;cache-first 加载范式 `CompareModal.tsx:76-97`(useState 初始化器吃缓存命中 + useEffect 异步补 + cancelled 旗标)。
- **环/方向**:内容寻址下真环罕见;`createdAt` 是客户端 `Date.now()`(`lineage.ts:16`),导入/多标签/时钟回拨不可靠,**不能用作裁边方向保证**——靠 visited Set 防环。
- **碰撞特性**:两个 task 生成字节相同图 → 同 SHA-256 id → 判为共享边,单跳 spec 定为"特性非 bug"(`lineage-view-design.md:69`)。

## 3. 关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 入口容器 | **独立全屏 LineageModal**(照搬 CompareModal),非 DetailModal 内嵌 | 谱系画布大、需 SVG 绝对定位 overlay + 滚动,与 DetailModal 右栏 `overflow-y-auto`+`max-w-4xl` 打架;CompareModal 正是为大画布躲开此冲突 |
| 单跳 pill 去留 | **保留**现有「派生自/衍生出」pill 区作轻量预览,旁加「查看完整谱系」按钮 → 替换式开 LineageModal(嫁接 embedded) | 单跳 UX 不回退;中心±1 跳时谱系视图视觉等价于 pill |
| 遍历范围 | **祖先链 + 后代树**(双向有界 BFS),**非整连通分量泛洪** | 泛洪撞"同一上传图被几十 task 共享为输入→consumer 爆簇"(摸底警示);祖先+后代足够讲清链路,对应现有"派生自在上/衍生出在下"叙事 |
| 性能 | **倒排索引** `buildLineageIndex`:`producersByImage`/`consumersByImage` Map,单遍 O(N×图/task);遍历改 O(1) 邻接 | 朴素 K 跳 BFS 是 O(K×节点×allTasks),大库退化;与 C1 不引库务实基调一致 |
| 节点上限 | **maxNodes 默认 60**(嫁接 embedded:80 对 cache=100 仅剩 20 headroom,60 更安全),maxDepth 12;超限 `truncated=true` + 提示行 | eager cache-first 天然安全,无需 standalone 未验证的 IntersectionObserver-under-transform |
| 布局 | **纵向分层 DAG**:纯函数 `lineageLayout.ts` 套 gridSheet 范式,按 BFS depth 分层、层内 createdAt 排序、固定节点尺寸 | 不引库(Sugiyama 交叉最小化 NP-hard 且小家族收益不可感);固定尺寸防缩略图异步抖动 |
| 边 | **SVG 三次贝塞尔**(父底中点→子顶中点),蓝色语义半透明,**全部实线** | 全仓零连线先例,自绘 SVG 层。**实现期审查修正**:原拟"真环画虚线",但 BFS 最短路径 depth 无法区分菱形前向边与真回边(常见"中心直接产物+中间产物喂同一后代"的菱形会被误标成虚线环,误导更甚),故移除环检测;visited 已收集所有可达边不会静默省略,真环边照常实线渲染 |
| 缩放/平移 | 本轮**不做缩放**,大画布靠容器 `overflow-auto` 滚动(对齐 `TaskGridMatrix.tsx:237`) | 降复杂度;pan/zoom 是新基建,留后续 |
| 节点点击 | 替换式回 DetailModal(`setLineageTaskId(null)`+`setDetailTaskId(nodeId)`);缩略图点击开 Lightbox z-[60] 叠放 | 复用现有跳转语义,无层叠冲突 |

## 4. 设计明细

### 4.1 数据层(`lib/lineage.ts` 扩展,纯函数)

```ts
interface LineageIndex {
  producersByImage: Map<string, string[]>  // imageId -> 产出 taskId[]
  consumersByImage: Map<string, string[]>  // imageId -> 消费 taskId[]
  taskById: Map<string, TaskRecord>
}
export function buildLineageIndex(allTasks: TaskRecord[]): LineageIndex   // 单遍,只读 input/output

interface LineageNode { task: TaskRecord; depth: number }  // 负=祖先 0=中心 正=后代
interface LineageEdge { from: string; to: string; sharedImageIds: string[]; isCycle?: boolean }
interface LineageGraph { nodes: LineageNode[]; edges: LineageEdge[]; truncated: boolean }
export function buildLineageGraph(centerId, index, opts?: {maxDepth?; maxNodes?}): LineageGraph
```

- **交替双向 BFS**(实现期审查修正:原顺序跑两次会让祖先先吃满 maxNodes 饿死后代):逐层交替扩展两方向——向上对 `inputImageIds` 查 `producersByImage`(父),向下对 `outputImages` 查 `consumersByImage`(子);中心 depth=0,父 -1 子 +1,预算公平。
- **防环**:全程 `visited`(=nodes Map),一节点多路径只入一次(菱形),回边不重复入队;**不做环检测/虚线**(见决策表"边");`truncated` 仅真有节点因 maxNodes 丢弃、或 maxDepth 边界仍有未访问邻居时才置(避免叶子边界假阳性)。
- **边去重**:`Map<\`${from}->${to}\`, LineageEdge>` 聚合 sharedImageIds。
- **截断**:按层入队,超 maxNodes 停止扩展置 truncated。

### 4.2 布局层(`lib/lineageLayout.ts` 新建,纯函数套 gridSheet 范式)

```ts
const LN_NODE_W=168, LN_NODE_H=56, LN_GAP_X=24, LN_GAP_Y=72, LN_PADDING=32
interface LineageLayout { width; height; nodePos: Map<id,{x,y,w,h}>; edgePath: (e)=>string }
export function computeLineageLayout(graph: LineageGraph): LineageLayout
```

按 depth 分层(无 Sugiyama)、层内 createdAt 升序排 x、depth 算 y(祖先上/后代下、中心层水平居中)、外接框定 width/height。`edgePath` 返回三次贝塞尔 SVG `d`。固定节点尺寸,**绝不依赖缩略图 naturalWidth**。

### 4.3 渲染层(`components/LineageModal.tsx` 照搬 CompareModal)

- ui slice 加 `lineageTaskId:string|null`+`setLineageTaskId`(仿 compareTaskIds,**不进 persist 白名单**)。
- 外层读 `lineageTaskId` + `tasks.find` 解析,task 被删则 auto-close;内层 `key={lineageTaskId}` 重置;三件套 hooks;电影暗色 overlay z-50。
- 节点:绝对定位 div(left/top from nodePos)+ **轻量自绘缩略图**(不复用重组件 TaskCard);中心 depth=0 节点蓝色 ring + 光晕高亮;右下状态点(done/error/running 三色,照搬 `DetailModal.tsx:289-294`)。
- SVG 单层覆盖画 edgePath(实线/isCycle 虚线)。
- 缩略图 cache-first(照搬 `CompareModal.tsx:76-97`),maxNodes 60 < cache 100 无 LRU 抖动。
- App.tsx fragment 顶层挂 `<LineageModal/>`(ErrorBoundary region modal)。

### 4.4 五个盲点的正面回应(评审揪出)

1. **缩略图兜底链**(无输出节点空白):`outputImages[0] → inputImageIds[0] → sharedImageIds[0] → 状态占位`,显式实现不留空白。
2. **memo 重算成本**:`buildLineageIndex`+BFS 在 `useMemo deps=[tasks]`,生成期 tasks 高频变 → open modal 下重建倒排索引。**接受并标注**:单遍 O(N) 在数千 task 下约几 ms,可接受;若实测卡顿改为 keyed on 粗信号(tasks.length + center.outputImages.length)。
3. **碰撞合并假家族**(多跳放大):两无关 task 共享字节相同图 id 在多跳下可能把两棵无关子树并成假家族——单跳是"特性",多跳规模放大需**显式测试用例**覆盖,且文案不暗示血缘必然真实。本轮如实展示(同单跳立场),测试固化行为。
4. **中心生成中 transient**:中心 task `status=running`/`outputImages` 空 → `findChildTasks` 返回 []、后代树空;outputs 落地时 `useMemo deps=[tasks]` 自动重算,后代自然"长出"——**预期渐进**,不做特殊动画,spec 标注。
5. **纯祖先引用节点状态**:`TaskStatus` 仅 running/done/error 三态(`types.ts:130`),else=blue 桶覆盖;所有节点都是完整 TaskRecord,无"无状态引用节点"。

## 5. 嫁接(落选方案亮点)

- **同 batchId 兄弟簇**(标注非父子边):作为未来增强,可把同 batchId 网格兄弟视觉分组(`lineage.test.ts:72-80` 守护"共享输入不成父子"必须保留),给分叉宽度可读性——**本轮不做**,记为升级路径。
- **IntersectionObserver/content-visibility 懒载**:仅当未来 maxNodes 超 cache 100 或扩到整家族时启用(对齐 C1 content-visibility 方向)——本轮 maxNodes 60 无需。

## 6. 非目标

- 整连通分量家族泛洪(爆簇风险)、pan/zoom 手势、移动端 DAG 画布退化优化(本轮窄屏靠滚动)、同 batchId 兄弟簇标注、Sugiyama 交叉最小化。

## 7. 测试计划

- **lineage.ts**(复用既有 task() 工厂 + 8 用例):`buildLineageIndex` 倒排正确性;`buildLineageGraph` 多跳链 A→B→C 的 depth 分配、菱形(两路径达同节点只一 node + 边聚合)、多父多子分叉、兄弟批量不成边、自环排除、**人造环 visited 终止 + isCycle 标记**、**碰撞 id 合并无关子树的行为固化**、maxNodes 截断置 truncated。
- **lineageLayout.ts**(套 gridSheet.test.ts):分层 y 坐标(祖先负/中心 0/后代正)、层内 createdAt 排序 x、固定节点尺寸、外接框 width/height、edgePath 非空。
- **渲染**:LineageModal 节点缩略图兜底链(无输出→input→edge→占位)、中心高亮、auto-close-stale;jsdom 无布局,几何全在纯函数测。
- **e2e**(Playwright):DetailModal「查看完整谱系」开 modal、节点点击回跳、ESC 逐层关、截断提示、生成完成后代长出。

## 8. 触及文件

新增:`lib/lineageLayout.ts` · `lib/lineageLayout.test.ts` · `components/LineageModal.tsx`
修改:`lib/lineage.ts`(buildLineageIndex/buildLineageGraph)· `lib/lineage.test.ts`(多跳用例)· `store/slices/ui.ts`(lineageTaskId)· `components/DetailModal.tsx`(「查看完整谱系」按钮)· `App.tsx`(挂 LineageModal)· `index.css`(若需谱系节点/连线工具类)
