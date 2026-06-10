# 全项目深度审查报告(第三轮·ultracode) · image-playground

> 审查日期:2026-06-10
> 基线提交:`7a13f0b`(Merge: 批量反推 + Gemini 原生 provider(B2))——明细中所有行号以此提交为准
> 审查范围:`src/` 全量 + 构建/部署/基础设施(Dockerfile / nginx / Caddyfile / cors-proxy / sw.js / wrangler / scripts/)+ README / manifest
> 审查方法:多 agent 工作流(87 agent / 约 425 万 token):8 维度 finder 并行深读 → 每条发现 1~2 个独立怀疑者对抗核验(high 级双验证:对抗反驳 + 影响面评估)→ 完整性批评家扫盲区 → 3 个盲区补查轮(各发现再过对抗核验)→ 3 视角功能候选 + 评审团合并排序。另独立运行 tsc / vitest / eslint 取地面信号。
> 配套前两轮:`docs/code-review-2026-05-29.md` / `docs/code-review-2026-05-31.md`

---

## 一、总体判断

**健康度:良好,无 critical。第二轮(2026-05-31)聚焦的三条主题(IDB 事务语义 / baseUrl 信任边界 / 跨平台一致性)已基本收口;本轮存活问题呈现成熟代码库的新特征——主路径扎实,缺口集中在四类系统性盲区:**

1. **旗舰功能的恢复路径**——导入白名单漏掉 batchId/gridAxes/gridCoord,XY 网格与批次笔记在「备份恢复」这条唯一救援路径上静默丢失(H1)。主路径(生成/展示/导出)全对,恰恰是恢复路径没人走过。
2. **「本地优先」承诺的地基**——全库零调用 `navigator.storage.persist()`(H4),数百 MB 图库唯一副本躺在浏览器 best-effort 驱逐域;导出无上限而导入硬卡 400MB(M7);initStore 失败静默呈现空库(M8)。数据「全在本地」的宣传与数据「留得住」之间缺了三块板。
3. **双口径漂移**——同一概念两处计算各自为政:全选口径 vs 可见列表口径(H2)、入队固化元数据 vs 执行时 active profile(M1)、流式路径 vs 非流式路径的 Gemini 错误保真(M4)、引用图判定的 1 份共享函数 vs 3 份内联复制(M6)。
4. **规模效应**——小库一切正常,大库逐项劣化:TaskCard 全尺寸 dataUrl 常驻(H3)、遮罩撤销栈最坏 ~560MB(M24)、主线程同步 zipSync 整页冻结(M13)、imageCache 按条数不按字节(L3)。

### 地面信号(独立运行,基线 `7a13f0b`)

| 信号 | 结果 |
|---|---|
| 类型检查 `tsc -b` | ✅ 无报错 |
| 测试 `vitest run` | ✅ 41 文件 / 441 用例全部通过(1.8s) |
| lint `eslint src` | ⚠️ 0 error / 91 warning(`set-state-in-effect` 31 · `refs` 25 · `preserve-caught-error` 15 · `no-explicit-any` 8 · `exhaustive-deps` 5 · 其它 7) |

`exhaustive-deps` 的 5 条(InputBar:158 / useCursorOverlay:117 / useMaskCanvasInit:189 / SettingsModal:310 / TaskGrid:370)是真实的陈旧闭包候选,建议逐条裁定而非一键禁用。

### 审查结果统计

| 维度 | 数据 |
|---|---|
| 审查维度 | 8(并发与状态机 / 数据完整性 / 安全 / API 层 / React 性能与正确性 / 代码健康 / 构建部署 / UX·a11y)+ 3 个批评家盲区(存储驱逐授权 / SW 更新生命周期 / 遮罩画布手势子系统) |
| 原始发现 | 62(主轮 52 + 盲区补查 10) |
| 对抗核验驳回 | 0(见第八节「方法与可信度说明」) |
| 核验严重度修正 | 9(5 条 high→medium,4 条 medium→low) |
| 跨维度重复合并 | 5(同一问题被多个维度独立发现,视为交叉印证) |
| **去重后存活** | **57 条:🔴 high 4 · 🟡 medium 31 · 🟢 low 22** |
| 功能候选 | 新提 30 + 上轮遗留 8 → 评审团排序后 **12 项在榜 / 18 项否决或延后** |

---

## 二、建议处理顺序(按性价比)

1. **数据可信轮(最高优先,都是「本地优先」招牌的地基)**——H1(导入白名单补三字段 + export→import 往返保真测试)、H2(全选口径补 `filterConversationId`)、H4(`storage.persist()` 一行 + 面板徽标)、M7(导出前按 forEachImageMeta 累计字节、超限警告)、M8(initStore `.catch` + 空库/加载失败状态区分)。
2. **实验正确性轮**——M1(执行时按 `task.apiProfileName` 固定 profile)、M2(`callImageApi` resolve 后立即清 watchdog)、M3(三个清除路径补 `terminateTaskRuntime`)、M4(Gemini 非流式补 `finishReason` 检查)、L2(导入侧复用 `markInterruptedSyncHttpTasks`)。
3. **规模与体验轮**——H3(缩略图 / objectURL + IntersectionObserver)、M13(异步 zip + 忙碌态 + 防重入)、M24(撤销栈按字节预算)、M15(移动端操作按钮可达性)。
4. **流程基建(所有后续轮次的质量放大器)**——M27(CI:lint + tsc + vitest 做合并门禁)、L15(安装 DOM 测试环境,为 58 个组件的交互测试解锁)。
5. 其余 medium/low 按主题就近捎带:a11y 一轮(M14/M16~M19)、部署配置一轮(M25/M26/M28/L16)、API 边界一轮(M12/L6~L9)。

---

## 三、🔴 HIGH(4 条)

### H1 · 导入白名单 normalizeTask 丢失 batchId/gridAxes/gridCoord:备份恢复后 XY 网格/批量分组/批次笔记关联被静默摧毁

- **位置**:`src/lib/tasks.ts:70`
- **维度/严重度**:数据完整性 / high
- **问题**:确认可触发:导出 ZIP 的 manifest 里 tasks 是 getAllTasks 原样写入(含 batchId/gridAxes/gridCoord),但任何一次导入(merge 或 replace)都会把这三个字段剥掉后写入 IndexedDB。后果链:① XY 网格矩阵散架成普通卡片(gridExperiment.ts L206 判定失败);② 通配批量分组丢失;③ batchNotes 以 batchId 为 key,导入后无任何 task 携带该 batchId → 笔记全部变孤儿不可见;④ 下次导出时 exportImport.ts L161 `referencedBatchIds` 过滤掉无引用笔记 → 笔记永久丢失。这是项目旗舰功能(批量实验/对照笔记)在唯一恢复路径上的静默数据丢失。
- **证据**:

```
normalizeTask 返回对象字段枚举(L70-99)止于:
    sortOrder: typeof item.sortOrder === 'number' && Number.isFinite(item.sortOrder) ? item.sortOrder : undefined,
    conversationId: typeof item.conversationId === 'string' ? item.conversationId : undefined,
  }
—— 无 batchId/gridAxes/gridCoord 三个字段;而 types.ts L227-231 定义了 batchId?: string / gridAxes?: {...} / gridCoord?: {...}。注释自称「保留 TaskRecord 全部字段以保证往返导入不掉字段」(L64)但实际漏了。importData 对所有导入 task 强制走它:exportImport.ts L252 `const normalizedImportedTasks = normalizeTasks(data.tasks)`。grid 渲染硬依赖这两个字段:gridExperiment.ts L206 `if (task.gridAxes && task.batchId)`。
```

- **修复方向**:normalizeTask 补三个字段的白名单校验:batchId 取 string;gridAxes 逐层校验 {x:{kind,values[{key,label}]},y?};gridCoord 校验 {x:string,y?:string},并加一条 export→import 往返保真测试(对比字段集与 TaskRecord keys)。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 两处细节修正:① 「通配批量分组丢失」表述过重——gridExperiment.ts L200 注释及 L202-215 实现表明无 gridAxes 的纯通配批次本来就逐卡渲染,UI 上没有可丢失的分组,batchId 丢失对通配批次仅是数据层损失(影响导出往返保真与 cancelBatch,后者对已完成的导入任务无意义);② 「merge 或 replace 都剥掉」需限定——merge 模式下本地已存在同 id 的 task 被 L268 去重跳过、字段保留,剥离只发生在实际写入的新 task 上,但这恰是备份恢复(新浏览器/replace)的主场景,影响面结论不变。其余(行号 L70、批次笔记孤儿化→下次导出 L161-163 永久丢失、网格散架 L206)全部准确。
  - 两处微调:1) 「任何一次导入都会剥字段」需收窄——merge 模式下 exportImport.ts L268 会跳过本地已存在同 id 的任务,故同浏览器 merge 不损伤已有本地网格任务;受损的是 replace 模式与导入到新环境(恰是备份的主用途)。2) 笔记并非导入瞬间丢失:导入时 batchNotes 仍写入 store(L316-321),只是因无任务引用而在 UI 不可见(TaskGridMatrix.tsx L25 是唯一读取面);「永久丢失」发生在下一次导出(L161-164 referencedBatchIds 过滤孤儿)且旧备份 ZIP 被轮换弃置之后。其余行号与证据全部准确。
- **交叉印证**:代码健康 维度独立报告了同一问题(「normalizeTask 白名单缺 batchId/gridAxes/gridCoord,ZIP 导入后批量/网格结构…」,`src/lib/tasks.ts:70`),结论一致,已合并。

### H2 · SelectionActionBar「全选当前可见」漏传对话过滤,会选中并可批量删除其它对话里不可见的任务

- **位置**:`src/components/InputBar/index.tsx:69`
- **维度/严重度**:React 性能与正确性 / high
- **问题**:确认可触发:在某个对话视图里 Ctrl 选一张卡唤出操作条 → 点「全选当前可见」(title 原文即如此) → 实际选中的是全库所有对话的任务(仅受搜索/状态/收藏过滤约束) → 再点「删除选中」会把其它对话里用户从未看到的记录连图一起删掉。批量收藏/取消收藏/批量反推同样误伤。确认框只显示条数,数量大时用户也难察觉口径错了。仅 galleryView 下两边口径恰好一致,对话视图必然不一致。
- **证据**:

```
InputBar/index.tsx L69-76:
  const filteredTasks = useMemo(() => {
    return filterAndSortTasks(tasks, {
      searchQuery,
      filterStatus,
      filterFavorite,
      filterFavoriteCategoryId,
    })
  }, [tasks, searchQuery, filterStatus, filterFavorite, filterFavoriteCategoryId])
—— 没有传 filterConversationId。而 TaskGrid.tsx L124/L147 是 `const filterConversationId = galleryView ? null : activeConversationId` 并传入同一函数。SelectionActionBar.tsx L22-28:
  const handleSelectAllToggle = useCallback(() => {
    if (allVisibleSelected) { clearSelection() } else {
      setSelectedTaskIds(filteredTasks.map((t) => t.id))
    }
  }, ...)
随后 L74: removeMultipleTasks(selectedTaskIds)。store/slices/tasks
…(截断,完整见源文件)
```

- **修复方向**:InputBar 计算 filteredTasks 时补传 `filterConversationId: galleryView ? null : activeConversationId`(与 TaskGrid 同源);更进一步可把这份「当前可见任务」计算提为单一来源(selector 或 context),消除 TaskGrid/InputBar 双份 O(N log N)+JSON.stringify 重复计算;并考虑在 setActiveConversation 时清空 selectedTaskIds。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 细节修正(均不影响结论):1) TaskGrid 的 filterAndSortTasks 调用在 L141-149(filterConversationId 在 L147),与发现所述一致;2) "双份 O(N log N)+JSON.stringify" 中 JSON.stringify 仅在 searchQuery 非空时执行,空搜索时只有排序开销;3) 不一致的精确条件是「galleryView=false 且 activeConversationId 非 null」——若对话视图下 activeConversationId 为 null,两边口径恰好一致,但有激活对话是正常使用态;4) 附带一个发现未提的次级症状:allVisibleSelected(SelectionActionBar L19-20)也用错口径计算,用户在对话内手动选满当前可见任务后,按钮仍显示「全选当前可见」而非「取消全选」,且 selectedTaskIds.length===filteredTasks.length 的相等判断口径错位。
  - 行号与引用全部核实无误(InputBar/index.tsx L69-76、SelectionActionBar.tsx L22-28/L74/L79、TaskGrid.tsx L124/L141-149、taskFilters.ts L28/L42、store/slices/tasks.ts L453)。两点补充:1) ui.ts L115 setGalleryView 同样不清空 selectedTaskIds;2) 发现漏了一个额外症状——allVisibleSelected(SelectionActionBar L19-20)也用全库口径计算,用户在对话内框选完全部可见卡后按钮仍显示「全选当前可见」而非「取消全选」,再点一下会静默把选中集扩到全库,构成第二条隐蔽触发路径。另:批量反推误伤还会额外消耗 captioner API 配额。

### H3 · TaskCard 封面直接用全尺寸图 dataUrl 且每卡 state 常驻,大库下内存不受 LRU 约束、首渲染触发 N 次 IDB 全量读

- **位置**:`src/components/TaskCard.tsx:146`
- **维度/严重度**:React 性能与正确性 / high
- **问题**:确认可触发:图库/大对话视图下每张挂载的卡(上限 2000)mount 即发起一次 IDB getImage + FileReader 全图转 base64,且把全尺寸 dataUrl 存进各自组件 state。LRU=100 只限共享 Map,组件 state 持有的字符串引用不会随驱逐释放——几百张 2-5MB 的 PNG 即数百 MB~GB 级 JS 堆;超过 100 张后切换筛选/对话还会反复缓存 miss 重读 IDB(缓存抖动)。cv-auto 只省渲染,不省 effect 与内存。img loading="lazy" 对已在内存的 dataUrl 无意义。
- **证据**:

```
TaskCard.tsx L141-149:
    if (task.outputImages?.[0]) {
      const cached = getCachedImage(task.outputImages[0])
      if (cached) { setThumbSrc(cached) } else {
        ensureImageCached(task.outputImages[0]).then((url) => {
          if (url) setThumbSrc(url)
        })
      }
    }
imageCache.ts L8: `const MAX_ENTRIES = 100`;db.ts L341-344 storedImageToDataUrl 返回完整原图 base64(无降采样缩略图)。TaskGrid.tsx L111: `const RENDER_CAP = 2000`。
```

- **修复方向**:为卡片封面生成并持久化降采样缩略图(createImageBitmap+canvas,如 320px,存 IDB 独立 store 或内存按需生成);或改用 Blob+objectURL 并在卡片卸载/换图时 revoke;同时把加载延迟到进入视口(IntersectionObserver)再触发,避免首渲 IDB 风暴。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 1) 机制描述修正:db.ts blobToDataUrl(L336-339)不用 FileReader,而是 blob.arrayBuffer() + 同步分块 String.fromCharCode + btoa(L325-334)——同步主线程编码,首渲卡顿影响比 FileReader 更直接。2) 效果块实际在 TaskCard.tsx L137-154(引用 L141-149,在容差内)。3) 遗漏的受影响面:TaskGridMatrix 每个格子(L273-279)同样渲染 TaskCard,XY 网格块逐格走同一加载路径。4) 内存量化细化:LRU 内条目与组件 state 共享同一字符串引用(不双倍计),总驻留 ≈ 挂载的 done 卡数 × 各首图全尺寸 dataUrl 大小,上界由 RENDER_CAP=2000 张挂载卡决定;卸载后可 GC,故是「挂载卡集合」级而非全库级,但 2000 × 数 MB 仍可达 GB 级。5) 触发前提:需大库/图库视图下挂载超 100 张不同图的 done 卡才出现 LRU 抖动;小对话(<100 图)只付全尺寸 dataUrl 成本,无抖动。
  - 行号与证据全部准确(TaskCard.tsx L137-154、imageCache.ts L8 MAX_ENTRIES=100、db.ts L341-345、TaskGrid.tsx L111 RENDER_CAP=2000)。三点补充修正:1) 影响面应收窄到「图库视图或大对话」——默认对话视图经 filterAndSortTasks 按 activeConversationId 过滤(taskFilters.ts L42),日常小对话只挂载几十张卡不受影响;但批量功能(通配展开/XY 网格一次产几十条)使单对话数百任务是现实常态,且 TaskGridMatrix 每格复用 TaskCard(L7/L142 附近),网格格子同样逐格全图加载,放大了触发面。2) 发现遗漏一个加重项:TaskCard L156-176 第二个 effect 还会用 new Image() 对每张全尺寸 dataUrl 再做一次完整解码(仅为取 naturalWidth/Height 显示比例标签),首渲 CPU 翻倍。3) 「首渲 IDB 风暴」的主成本其实在 N 次同步 base64 转换(db.ts bytesToBase64:String.fromCharCode 32KB 分块 + btoa,纯主线程)而非 IDB 读本身。

### H4 · 全库零调用 navigator.storage.persist()/persisted(),数百 MB 图库唯一副本处于浏览器 best-effort 驱逐域

- **位置**:`src/lib/storageStats.ts:78`
- **维度/严重度**:盲区补查 / high
- **问题**:这是全库唯一接触 navigator.storage 的代码,只调 estimate() 做展示;grep 全 src 验证 persist(/persisted( 仅命中 zustand persist 中间件(src/store/index.ts:14),无任何 StorageManager 持久化请求。未授权持久化时,整个源的 IndexedDB+localStorage 归 best-effort 桶:Chromium/Firefox 磁盘压力下按 LRU 整源清空;Safari ITP 在 7 天无站点交互后清除全部脚本可写存储。触发条件完全可达——用户磁盘紧张、或一周没打开过该站点即触发,本地优先应用的全部数据(任务记录/生成图/API 配置)被无声抹掉且无恢复路径。initStore(src/lib/taskRuntime.ts:264)做了中断恢复/迁移/孤儿 GC 等大量启动工作,却没有这一行成本近乎为零的保护
- **证据**:

```
async function readStorageQuota(): Promise<StorageStats['quota']> {
  try {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined
    if (!storage?.estimate) return null
    const est = await storage.estimate()
```

- **修复方向**:initStore 成功路径末尾 fire-and-forget 调用 navigator.storage.persist()(try/catch 包裹,旧 Safari 无此 API),并将 navigator.storage.persisted() 结果写入 store 供 UI 消费;Chromium 对已安装 PWA/高互动站点自动批准,拒绝也无任何副作用,属纯增益改动
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 两处需修正:1) "被无声抹掉且无恢复路径"过强——项目有手动导出/导入(src/lib/exportImport.ts),导出过备份的用户可恢复;准确表述是"驱逐无预警,未手动导出的部分无恢复路径"。2) fix 对 Safari 场景无效:navigator.storage.persist() 并不豁免 ITP 的 7 天脚本可写存储清除(只有添加到主屏幕的 Web App 豁免),该 fix 只缓解 Chromium/Firefox 磁盘压力 LRU 驱逐;发现把 Safari 列为触发场景却暗示同一 fix 覆盖它,需注明。行号全部精确无需修正(storageStats.ts:78、store/index.ts:14、taskRuntime.ts:264)。

## 四、🟡 MEDIUM(31 条)

#### ◆ 任务运行时与实验正确性

### M1 · 排队中的批量任务执行时使用「当时的 active profile」发请求,与 enqueue 时固化的 apiProvider/apiModel 元数据脱钩,中途切 profile 导致剩余任务静默换供应商/模型执行

- **位置**:`src/lib/taskRuntime.ts:848`
- **维度/严重度**:并发与状态机 / high(核验分歧:high / medium)
- **问题**:确认可触发:批量/网格任务先全部 enqueueTask 落库(running),再经 runEnqueuedTasks 并发闸(默认 1~6)排队;每条任务的 executeTask 在被 worker 取出那一刻才执行 `useStore.getState()` 读 settings,callImageApi 再从这份 settings 解析 active profile。提交 30 条批次、并发 2、单条 30s 时有数分钟窗口;用户此间在设置里切换 provider/模型,剩余成员全部用新 profile 发请求,但 TaskRecord 里的 apiProvider/apiProfileName/apiModel 永远是提交时刻的旧值。后果:(a) XY 网格/批量对比的样本被静默混入另一个模型,实验结论失效;(b) 卡片/详情/对照导出展示的模型归属错误;(c) watchdog 超时取的也是新 profile 的 timeout。对一个以参数对照实验为核心卖点的工具,这是正确性问题而非风格问题。
- **证据**:

```
async function executeTask(taskId: string) {
  const { settings } = useStore.getState()
  ...
  const activeProfile = getActiveApiProfile(settings)
  const taskProvider = task.apiProvider ?? activeProfile.provider
  ...
  const result = await callImageApi({ settings, prompt: finalPrompt, ... })

// src/lib/api/index.ts L9-13:
export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  const profile = getActiveApiProfile(opts.settings)
  if (profile.provider === 'gemini') return callGeminiImageApi(opts, profile)
  return callOpenAICompatibleImageApi(opts, profile)
}

// 对照 enqueue 时元数据来自提交时刻 profile(submitTask L646-648):
  apiProvider: activeProfile.provider,
  apiPro
…(截断,完整见源文件)
```

- **修复方向**:二选一并保持自洽:(1) 执行时按 task.apiProfileName 在 settings.apiProfiles 中查回提交时的 profile 并固定使用(找不到则直接落 error「Provider 已删除」),callImageApi 增加显式 profile 参数;(2) 若有意让批次跟随当前设置,则在 executeTask 取出执行时回写 task.apiProvider/apiProfileName/apiModel 为实际使用值,保证记录与事实一致。推荐 (1),符合用户提交时的意图。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 三处细节修正:(1) 并发闸默认值是 3(DEFAULT_BATCH_CONCURRENCY,clamp 范围 1~6),发现写「默认 1~6」不准确;(2) executeTask 函数声明在 L847,L848 是 getState 行,在容差内;(3) 触发面比「用户在设置里切换」更宽——InputBar 的 ModelMenu 一键即时切换 activeProfileId/改当前 profile 的 model(src/components/InputBar/ModelMenu.tsx L256、L66-73),无需打开设置面板,批量运行中顺手为下一轮实验换模型即可触发;且仅改 model 不切 profile 同样导致记录的 apiModel 与实际请求脱钩。另一处精确化:已被 worker 取出在途的任务不受影响(settings 在 executeTask 开头快照),仅未取出的剩余成员受影响,与发现「剩余任务」表述一致。
  - 两处小修正:(1) 发现里的影响点 (c)「watchdog 超时取的是新 profile 的 timeout」表述有误导——executeTask L848 一次性快照 settings,L860 watchdog timeout 与 L884 callImageApi 实际请求用的是同一份快照,二者彼此自洽;不一致只存在于「enqueue 时元数据 vs 执行时实际 profile」之间,watchdog 不构成额外的内部矛盾。(2) 遗漏一个次生影响:task.params 在提交时经 normalizeParamsForSettings(L562) 按旧 provider 的参数空间归一化,换 provider 执行后参数集与新 provider 不匹配(paramCompatibility 的钳制基准失效)。另:行号 848 准确,executeTask 定义在 L847。
- **交叉印证**:API 层 维度独立报告了同一问题(「排队批量任务在执行时重新解析 active profile,中途切换配置会让剩余任务静默打到新 provider/模型,…」,`src/lib/taskRuntime.ts:855`),结论一致,已合并。
- **交叉印证**:代码健康 维度独立报告了同一问题(「executeTask 用执行时刻的 active profile 发请求,TaskRecord 却记录提交时刻元数据—…」,`src/lib/taskRuntime.ts:848`),结论一致,已合并。

### M2 · watchdog 计时窗口覆盖了响应返回后的输出图持久化阶段:已成功的生成可在 storeImage 循环中被翻成「请求超时」,且随即被 rollbackStoredImages 删掉刚生成的图

- **位置**:`src/lib/taskRuntime.ts:932`
- **维度/严重度**:并发与状态机 / high → medium(核验修正)
- **问题**:逻辑链确认、触发依赖时序边界:watchdog 在 L860 调度后,直到 L932 才被清除——其间不仅包含网络请求,还包含 (a) 请求前 ensureImageCached 逐张从 IDB 加载输入图(最多 16 张多 MB dataUrl,L869-879),(b) 响应后 storeImage 循环(每张对整个 dataUrl 字符串做 SHA-256 + base64→Blob + IDB 写事务等 oncomplete,n 张大图可达数百 ms~数秒)。若超时 deadline 落在 (b) 窗口内:failSyncHttpTaskIfStillRunning 看到 status 仍 running → 翻 error「请求超时」+ toast;executeTask 继续跑到 L926 守卫,发现已非 running → rollbackStoredImages 把刚生成的图全部删除。即 API 已 200 返回、配额已消耗,结果却被销毁并报超时。现实场景:用户把 timeout 调到接近 provider 典型时延(如生成常 55s、timeout 设 60s)时,响应贴着 deadline 返回的概率不低。(a) 窗口则单纯压缩了真实网络预算,加大误超时概率。
- **证据**:

```
const result = await callImageApi({ ... })            // L884 响应已返回
...
const outputIds: string[] = []
for (const dataUrl of result.images) {                 // L898-901 逐张 SHA-256 + IDB 写(等 tx.oncomplete)
  const imgId = await storeImage(dataUrl, 'generated')
  setCachedImage(imgId, dataUrl)
  outputIds.push(imgId)
}
...
const latestBeforeUpdate = useStore.getState().tasks.find((t) => t.id === taskId)
if (!latestBeforeUpdate || latestBeforeUpdate.status !== 'running') {
  await rollbackStoredImages(outputIds)                // L926-930
  return
}
clearSyncHttpWatchdogTimer(taskId)                     // L932 此时才清 watchdog

// watchdog 触发逻辑 L236-239:
const failed = failSyncHttpTaskIfStillRun
…(截断,完整见源文件)
```

- **修复方向**:在 `await callImageApi` resolve 后立即 clearSyncHttpWatchdogTimer(taskId)(即 L893 守卫之前),watchdog 只管网络阶段;输入图加载阶段也可移到 schedule 之前,或为持久化阶段单独设宽松预算。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 1) 行号全部准确(L860 调度/L869-879 输入图加载/L884 callImageApi/L898-902 storeImage 循环/L926-930 rollback/L932 唯一成功路径清表点)。2) 补充姊妹分支:timer 若恰在 fetch resolve 与 L893 守卫之间触发,走 L894 早退——成功响应同样被报超时丢弃,但无图被存、无 rollback;「已存图被删」特指 timer 落在 storeImage 循环的 await 间隙。3) (a) 输入图加载窗口并非普遍成立:刚上传的输入图命中内存缓存同步返回;但 executeTask 的 finally(L980-982)逐张 deleteCachedImage(inputImageIds),故批量兄弟任务共享输入图、重试、刷新后重跑等场景才真正在 watchdog 窗口内走 IDB 读。4) 严重度建议 high→medium:DEFAULT_API_TIMEOUT=600s(apiProfiles.ts L22),默认配置下 deadline 落入数百 ms~数秒的持久化窗口概率极低,现实触发面要求用户把 timeout 手动调到贴近 provider 典型时延;触发后果(API 已成功、配额已耗、结果被删、误报超时)确实严重,但属窄窗口竞态。
  - 行号与逻辑链全部准确(L860 调度、L869-879 输入图加载、L884 响应返回、L898-902 storeImage 循环、L926-930 回滚守卫、L932 才清 watchdog;watchdog 触发体 L236-239)。需补充两点:1) 默认 timeout 为 600 秒(src/lib/api/apiProfiles.ts L22 DEFAULT_API_TIMEOUT=600),默认配置下网络阶段需耗满 ~600s 且响应恰好落在最后零点几秒~几秒的持久化窗口内才触发,概率几乎可忽略——发现描述的「用户把 timeout 调到接近 provider 典型时延」是必要前置,不是默认态;2) failSyncHttpTaskIfStillRunning→updateTaskInStore 的 setTasks 是同步执行(await putTask 之前),所以 L926 守卫必然看到 error 态并执行回滚,该链路无额外逃逸口;L926 守卫通过后到 L932 之间无 await,不存在二次竞态。另:rollbackStoredImages 只删无引用图,仅在内容寻址去重命中已有图时结果才幸存,对新生成图基本不构成缓解。

### M3 · deleteConversationWithTasks / clearAllData / importData(replace) 三个清除路径均不调用 terminateTaskRuntime:在途请求不中止继续烧配额,watchdog/AbortController 条目残留,与 removeTask/removeMultipleTasks 行为不一致

- **位置**:`src/store/slices/tasks.ts:431`
- **维度/严重度**:并发与状态机 / medium
- **问题**:确认可触发:对话下有 running 任务时删除该对话(UI 仅弹「N 条任务将一并删除」确认,不阻止),或在批量进行中执行清空全部数据/replace 导入。后果:(a) 在途 HTTP 请求不被 abort,继续跑到 provider 返回为止,白烧 API 配额(响应回来后被 L894 守卫丢弃);(b) syncHttpWatchdogTimers 条目要等到超时触发才自删(timeout 可配得很长),taskAbortControllers 条目等请求结束的 finally 才清,生命周期与「任务已不存在」错配;(c) 对话删除路径还不做关联图片的即时 GC(removeTask 有),孤儿图要等下次启动 initStore 才回收。无数据损坏(成功路径 L893/L926 守卫会拦住并回滚),但行为与单条删除路径明显不一致且浪费真金白银的配额。
- **证据**:

```
// deleteConversationWithTasks 的确认 action(tasks.ts L429-444),全程无 terminateTaskRuntime:
void (async () => {
  try {
    await dbDeleteConversation(id, true)
    const latest = get()
    const remainingConversations = latest.conversations.filter((c) => c.id !== id)
    const remainingTasks = latest.tasks.filter((task) => task.conversationId !== id)
    ...
    set({ conversations: remainingConversations, tasks: remainingTasks, ... })

// 对照单条/多条删除有清理(taskRuntime.ts L1171 / L1214):
  if (t.status === 'running') terminateTaskRuntime(t.id)

// clearAllData(exportImport.ts L119-135)与 importData replace(L271-281)同样直接清:
await dbClearTasks()
await clearImages()
...
state.setTasks([])
```

- **修复方向**:提取共享的清理原语:在 store/DB 清除前,对被波及的 running 任务逐条 terminateTaskRuntime(deleteConversationWithTasks 按 conversationId 圈定;clearAllData/importData replace 对全部 running 调 cancelAllRunning 或直接遍历 terminateTaskRuntime)。对话删除路径可顺带复用 removeMultipleTasks 的孤儿图 GC。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 细节修正:1) tasks.ts 确认 action 实际为 L428-450(evidence 写 L429-444,在容差内);2) 发现可再加强一点:任务删除后 watchdog 超时触发也不会 abort 请求(failSyncHttpTaskIfStillRunning 找不到任务即早退、不调 terminateTaskRuntime),即 watchdog 并非兜底,在途请求必然跑到 provider 响应/网络层失败为止;3) clearAllData 还有第二个调用方 src/components/ErrorBoundary.tsx L415(崩溃恢复路径),触发面比发现描述的略大;4) importData replace 的 store 清空(L276-281)发生在「全部待写记录就绪后」,若解析阶段抛错不会触达,触发窗口仅限校验通过后的清空-写回阶段——不影响结论,running 任务照样不被终止。

### M4 · Gemini 非流式图像路径忽略 candidate.finishReason,安全拦截被泛化为「Gemini 未返回图片数据」

- **位置**:`src/lib/api/geminiImageApi.ts:164`
- **维度/严重度**:API 层 / medium
- **问题**:确认可触发。Gemini 图像生成被安全策略拦截时常见返回 HTTP 200 + candidates[0].finishReason='IMAGE_SAFETY'/'PROHIBITED_CONTENT' 且无 inline_data、promptFeedback 缺失,此时用户只看到泛化的「Gemini 未返回图片数据」,无法区分内容违规与网关故障。同仓库的流式路径 geminiChatShared.extractGeminiStreamError(L78-79)明确检查了 finishReason(`if (finish && finish !== 'STOP' && finish !== 'MAX_TOKENS') return 生成中断：${finish}`),两条 Gemini 路径错误保真度不一致;GeminiResponse 接口里声明了 finishReason 字段却无人消费,是明显的遗漏而非取舍。
- **证据**:

```
if (payload.promptFeedback?.blockReason) {
  throw new Error(`请求被拒绝：${payload.promptFeedback.blockReason}`)
}
const imageResults = parseGeminiImages(payload)
if (!imageResults.length) {
  throw new Error('Gemini 未返回图片数据')
}
// 接口定义 L69-73 声明了 finishReason 却从未读取:
candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>
```

- **修复方向**:在 parseGeminiImages 结果为空时,先扫 candidates[].finishReason,非 STOP/MAX_TOKENS 则抛「生成中断：<finishReason>」,与 extractGeminiStreamError 口径对齐;可顺带提取 candidate 里残留的 text part 作为补充说明。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - throw 实际在 geminiImageApi.ts L165(L164 是 if 判断),在容差内。补充:n>1 并发路径(L195-198)同样透传该泛化错误(firstError.reason),修 callGeminiSingle 可同时覆盖两条路径。

### M5 · initStore 孤儿 GC 仍用 getAllImages 全量物化 + 逐张 deleteImage,而库内已有现成的流式单事务实现未被复用

- **位置**:`src/lib/taskRuntime.ts:364`
- **维度/严重度**:代码健康 / medium(已知问题深化)
- **问题**:对已知问题 4 的重大深化:不只是 O(N) 低效,而是高效实现已在同一代码库内存在——pruneOrphanImages(referencedIds, cutoff) 的语义(引用集 + createdAt cutoff)与 initStore 这段逐字对应,db.ts 注释还明确点名 deleteImage 逐张是被替代的反模式。initStore(每次启动必跑)却没迁移,启动路径在大图库下仍是全量 Blob 物化 + N 个独立写事务。注意 images 同时被下方 imageById(恢复输入栏图)复用,直接替换需把输入图恢复改为按需 getImage。
- **证据**:

```
const images = await getAllImages()
  const imageById = new Map(images.map((img) => [img.id, img]))
  ...
  for (const img of images) {
    if (referencedIds.has(img.id) || latestReferencedIds.has(img.id)) continue
    if ((img.createdAt ?? 0) >= initStartedAt) continue
    await deleteImage(img.id)
    deleteCachedImage(img.id)
  }
// 对照 db.ts L257 pruneImagesViaCursor:「把删除从『N 张孤儿 = N 个独立事务』(deleteImage 逐张)降到 1 个事务」
// storageStats.ts L135 pruneOrphanImages(referencedIds, cutoff) 已实现同语义(含 createdAt cutoff 守卫)
```

- **修复方向**:initStore 的 GC 段改调 pruneOrphanImages(new Set([...referencedIds, ...latestReferencedIds]), initStartedAt);输入栏图恢复改为对 persistedInputImages 逐个 getImage(id)(通常仅几张),彻底去掉 getAllImages。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 两处细节:1)「全量 Blob 物化」略夸大——Chromium/Firefox 的 IDB getAll() 返回的 Blob 为懒加载磁盘句柄,blob 记录的图片字节未必全部进堆;但 legacy dataUrl 字符串记录确会全量物化,且 db.ts L224-225 自家注释即把 getAllImages 定性为 O(N) 物化反模式,N 个独立 readwrite 删除事务(deleteImage 每调用一个 dbTransaction)则无争议。2)迁移到 pruneImagesViaCursor 后为单事务,abort 会回滚全部删除(现状逐张删可部分提交),对孤儿 GC 均良性但属行为差异,迁移时可在注释说明。其余描述(行号、语义逐字对应、imageById 复用需改 getImage)均准确。

### M6 · collectReferencedImageIds 自称『唯一判定来源』,但 taskRuntime 内有 3 份内联重复的引用扫描,新增引用字段必漂移误删

- **位置**:`src/lib/taskRuntime.ts:1229`
- **维度/严重度**:代码健康 / medium
- **问题**:结构性问题确认存在,误删属潜在(未来触发)。storageStats.collectReferencedImageIds 的文档不变量已经被违反:rollbackStoredImages/removeTask/removeMultipleTasks 三处手写同逻辑的 stillUsed 集合后直接 deleteImage。当 TaskRecord 再新增图片引用字段(谱系/对照导出这类功能正活跃迭代)时,只补 collectReferencedImageIds 不会让这三处『自动跟随』——删除任务时会把新字段引用的图当孤儿删掉,且因内容寻址去重,一张图可能被多任务共享,误删是跨任务的数据丢失。
- **证据**:

```
// removeTask (L1229-1235),removeMultipleTasks (L1184-1190)、rollbackStoredImages (L133-139) 同款:
  const stillUsed = new Set<string>()
  for (const t of remaining) {
    for (const id of t.inputImageIds || []) stillUsed.add(id)
    if (t.maskImageId) stillUsed.add(t.maskImageId)
    for (const id of t.outputImages || []) stillUsed.add(id)
  }
// 而 storageStats.ts L4-5 声明:`collectReferencedImageIds` 是「图片是否在用」的**唯一判定来源**,…杜绝多份引用扫描漂移
// L17: 任何新增的图片引用字段都应只在此处补充,initStore 与孤儿清理会自动跟随
```

- **修复方向**:三处内联扫描改为调用 collectReferencedImageIds(remaining, inputImages)(签名完全吻合,Pick<InputImage,'id'> 兼容),并在 storageStats 加单测锁定 TaskRecord 图片引用字段集。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 行号全部精确无误(L133-139/L1184-1190/L1229-1235,storageStats L4-5/L17)。需修正一处表述:storageStats L4-5 的「唯一判定来源」字面上只列举了三个消费方(initStore GC/本模块统计/本模块手动清理),且这三处确实都走 collectReferencedImageIds,故「文档不变量已经被违反」措辞略过强;准确说法是 L17「任何新增字段只在此处补充即自动跟随」的承诺与「杜绝多份引用扫描漂移」的目标被 taskRuntime 三处文档列举之外的内联删除路径架空——新字段只补 canonical 函数时,这三处会把仍被引用的图当孤儿删。另:发现未提及 maskTargetImageId 字段,该字段在 canonical 与三处内联中均一致排除且总指向 inputImageIds 成员,不构成当前漂移,故确为潜在而非现行 bug。

#### ◆ 数据持久化与备份

### M7 · 导出无大小上限且全量驻留内存,而导入硬卡 400MB:超过上限的备份导出成功却永远无法恢复

- **位置**:`src/lib/exportImport.ts:230`
- **维度/严重度**:数据完整性 / medium
- **问题**:两个确认可达的问题:① 不对称上限——图片工作台几百张 PNG(每张 1-2MB)即可让 ZIP 超 400MB,导出毫无警告地成功,用户拿着这份「备份」却被导入直接拒绝,且 PNG 已压缩、zip level 6 几乎不再缩小,无自救路径;② 内存峰值 ≈ 全库字节 ×2~3(原始 bytes + zipSync 输出 + Blob 拷贝),库到 GB 级时导出可直接 OOM 崩标签页。导入侧注释明确意识到 unzipSync 的 OOM 风险,导出侧没有对等处理。
- **证据**:

```
导入侧:L37 `const MAX_IMPORT_FILE_BYTES = 400 * 1024 * 1024` + L230-231 `if (file.size > MAX_IMPORT_FILE_BYTES) { throw new Error(...) }`。导出侧无任何对应检查:L155 `const images = await getAllImages()`(全量物化 blob)→ L184 逐张 `await storedImageToBytes(img)` 把所有字节累进 zipFiles → L208 `const zipped = zipSync(zipFiles, { level: 6 })` 一次性生成完整输出 → L209 再复制成 Blob。
```

- **修复方向**:短期:导出前用 forEachImageMeta 累计字节,超过导入上限时警告/提示分卷;长期:改用 fflate 流式 Zip API 边压边落(File System Access API 或分块 Blob),导入侧对超限文件给出「分批导入」指引而非直接拒绝。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 两处细节修正,不影响结论:① "无自救路径"略过强——备份 zip 是普通格式,技术上可手工解包、拆分 manifest 重打包后用 merge 模式分批导入(importData L244-245/L258-268 的 id 去重支持增量),但产品内无任何路径,L231 错误提示也无指引,对普通用户等同不可恢复;② "导出可直接 OOM 崩标签页"需细化——exportData 整体有 try/catch(L153-224),同步分配失败抛出的 RangeError 会被捕获并 toast「导出失败」,不必然崩标签页;但 zipSync 期间真实堆耗尽仍可能直接杀死渲染进程,且即便被 catch,结果也是大库根本无法导出备份。另补充强化证据:db.ts L222-225 注释自述 getAllImages 是「O(N) 全量物化」并已提供 forEachImageMeta 流式替代(storageStats.ts L105 已采用),导出路径却仍用 getAllImages;storageStats 只做孤儿 GC,在用图片无总量上限,>400MB 库完全可达。

### M8 · initStore 失败完全静默:db.ts 精心构造的用户提示(升级被阻塞/事务中止)永远到不了 UI,用户看到的是空库

- **位置**:`src/App.tsx:104`
- **维度/严重度**:数据完整性 / medium
- **问题**:触发条件:① 下次 DB_VERSION 升级(2→3)部署后,只要有旧标签页持有 v2 连接,新标签页 open 即 onblocked → initStore reject;② IDB 打开/读取失败(隐私模式、存储损坏、磁盘错误);③ 配合 persist.ts 的非法 inputImages(见另一条)在 L380 `.map` 抛错。后果:conversations/tasks 全部不加载,界面呈现全新空库,无任何错误提示——用户第一反应是「数据丢了」,且可能立刻执行清空/重导等破坏性操作。db.ts 里那句「请关闭其它标签页重试」证明作者预期用户能看到它,但调用链上没有任何 UI 出口。理论→确认的分界:当前版本号稳定时主要靠 IDB 故障触发,版本号一升级就是必然可达路径。
- **证据**:

```
App.tsx L101-104:
    // 且不吞 initStore 的 rejection(与原 fire-and-forget 错误语义一致)
    void initStore().finally(() => maybeStartTour())
—— 无 .catch,无 toast。而 db.ts L46 专门为用户写了可读错误:`req.onblocked = () => reject(new Error('数据库升级被其它标签页阻塞,请关闭本站其它标签页后重试'))`,openDB 失败还会被所有后续 DB 操作复现。
```

- **修复方向**:initStore().catch(e => showToast(`本地数据加载失败:${e.message}`, 'error')) 并在 UI 上区分「空库」与「加载失败」状态(例如全局错误横幅 + 重试按钮),onblocked 场景给出关闭其它标签页的指引。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 触发条件①夸大:db.ts L50-53 已有 `db.onversionchange = () => { db.close(); dbPromise = null }`(commit 30a1aa4, 2026-05-31 加入),运行现版代码的旧标签页会在新标签页请求版本升级时主动 close 让路,故未来 DB_VERSION 2→3 时 onblocked 并非「必然可达路径」——仅当旧标签页运行 30a1aa4 之前的旧 build(长寿标签/PWA 缓存)、标签页被浏览器冻结导致 versionchange 事件未及时处理、或有进行中事务拖延 close 时才触发。现实主触发路径是条件②(隐私模式/存储损坏/磁盘错误 → openDB onerror)。另一细节:onblocked reject 后底层 open 请求仍挂起,若阻塞方稍后关闭,升级照常完成且 dbPromise 缓存已清(db.ts L62-65),后续 DB 操作(如新建任务)可成功——形成「历史全丢但新任务能存」的半工作态,刷新前不自愈,这反而加重不一致性。条件③引用的 taskRuntime.ts L380 persistedInputImages.map 位置准确,但其前提(persist 水合出非数组)属另一条发现,本条不依赖它即成立。

### M9 · zustand persist 多标签页 last-writer-wins:无 storage 事件/BroadcastChannel 同步,陈旧标签页整包覆盖丢失另一页的设置/片段/笔记

- **位置**:`src/store/index.ts:24`
- **维度/严重度**:数据完整性 / medium
- **问题**:确认可触发:标签页 A 新增片段/改 API 配置 → 写 localStorage;标签页 B 内存里还是旧快照,此后 B 的任意一次持久化变更(哪怕只是折叠侧栏,partialize 是整包序列化)都会把 A 的修改整体覆盖。tasks/conversations 走 IDB 记录级写入受影响小,但 settings/snippets/batchNotes/favoriteCategories 这些纯 localStorage 数据在双标签页日常使用中就会丢。与已知清单第 6 条(配额错误)不同,这是写冲突维度的新路径。
- **证据**:

```
persist 配置仅 `{ name: 'image-playground', merge: mergePersistedStoreState, partialize }`(store/index.ts L24-28),默认 localStorage 整包 JSON 写入;partialize(persist.ts L51-69)包含 settings(含 API key)/favoriteCategories/snippets/batchNotes/params/prompt 等全部配置面。全仓 grep `addEventListener('storage'` 与 `BroadcastChannel` 均无命中。
```

- **修复方向**:监听 window storage 事件触发 useStore.persist.rehydrate()(zustand 提供 API),或对 snippets/batchNotes 等做按 key 合并写(updatedAt 较新者胜),至少在文档/UI 提示多标签页配置互斥。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 触发条件比发现描述的更宽:zustand 5.0.5 的 persist 包裹了 api.setState,任何 setState(包括只改瞬态/非持久化字段,如 filter、tour、modal 状态)都会无条件执行 setItem 整包回写(middleware.mjs L363-367),不限于「持久化变更」;「哪怕只是折叠侧栏」的例子成立但低估了触发面。另外补充:hydrate 仅在 store 创建时执行一次,merge(persist.ts L14-49)只在 hydration 时生效,对运行期写冲突无任何缓解作用。

### M10 · mergePersistedStoreState 对 params/prompt/inputImages/dismissedCodexCliPrompts 不做归一化,...persisted 裸展开;非法 inputImages 直接炸毁 initStore

- **位置**:`src/store/persist.ts:26`
- **维度/严重度**:数据完整性 / medium
- **问题**:理论上可能(需 localStorage 损坏/手工编辑/旧版本 schema 漂移,同源无外部注入面),但爆炸半径不成比例:inputImages 非数组 → initStore 在 L380 抛 TypeError → 叠加 App.tsx 无 catch(另一条发现)→ 整个任务库静默加载失败;params 类型错误 → 请求体畸形或 UI 崩溃。同文件对四个字段做了归一化证明团队有此意识,这两个字段是遗漏而非取舍。
- **证据**:

```
persist.ts L24-31:
  return {
    ...currentState,
    ...persisted,
    settings: normalizeSettings(persisted?.settings),
    favoriteCategories: ...,
    snippets: normalizeSnippets(persisted?.snippets),
    batchNotes: normalizeBatchNotes(persisted?.batchNotes),
—— settings/categories/snippets/batchNotes 都过白名单,但 params、prompt、inputImages、dismissedCodexCliPrompts 走 `...persisted` 原样进 store。下游:taskRuntime.ts L380 `persistedInputImages.map(async (img) => ...)`,若 inputImages 非数组直接 TypeError;params 不经 normalizeTaskParams(那只用于导入 task)就流入 submitTask → API 请求体。代码注释自己承认风险:L42「...persisted 整体展开的是磁盘原始对象,手工塞入的键不受 partialize 白名单约束」,却只复位了 tour/mobile 等瞬态键。
```

- **修复方向**:补 normalizeTaskParams(persisted?.params)(lib/tasks.ts 已有现成实现可导出)、prompt 收敛为 string、inputImages 收敛为 Array.filter(项有 string id),与 settings 同范式。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 1) 崩溃点修正:inputImages 非数组时首个异常不在 taskRuntime.ts L380,而在水合后第一次 store 写入——zustand persist 每次 set() 同步调 partialize(persist.ts L60 state.inputImages.map),无 try/catch(node_modules/zustand/esm/middleware.mjs L356-372);initStore 内即 L343 setConversations 抛 TypeError,早于 L344 setTasks,任务库加载失败结论成立但机制不同。非可迭代值还会更早崩在 taskRuntime L361 → storageStats.ts L24 的 for...of。2) 爆炸半径比描述更大:水合后所有事件处理器触发的 store 写入都同步抛错(ErrorBoundary 只接 render 期异常),全应用交互瘫痪,不止 initStore。3) params 描述部分过头:submitTask L562 有 normalizeParamsForSettings 收敛 size/n 后才入请求体;但 quality/output_format/output_compression/moderation 无类型检查可畸形透传,params 为 null/非对象时 taskRuntime L611 params.n 与 paramCompatibility.ts L16 params.size 直接 TypeError。4) normalizeTaskParams(lib/tasks.ts L33)存在但当前未 export,需先导出。5) 触发前提确认:partialize 正常写出永远合法、zustand 对坏 JSON 水合有兜底、无 version/migrate,故仅手工编辑 localStorage/合法 JSON 级损坏可达——低概率,但与项目 persist.ts L42 注释自认防御的威胁模型一致。
- **交叉印证**:代码健康 维度独立报告了同一问题(「zustand persist merge 对 params/prompt/dismissedCodexCliPromp…」,`src/store/persist.ts:25`),结论一致,已合并。

#### ◆ 安全

### M11 · ?provider= 查询参数可切换 provider 并保留旧 apiKey,使密钥被改投另一家厂商主机

- **位置**:`src/lib/urlBootstrap.ts:77`
- **维度/严重度**:安全 / medium
- **问题**:apiUrl/apiKey 已被加固为「仅 hash 读 + 改 host 必清 key」,但 provider 仍从【查询串】读取(urlBootstrap:77 search 优先)。攻击者只需让受害者打开 https://app/?provider=gemini(纯查询串,正是 apiUrl 加固想堵的注入面)。App.tsx 对激活 profile 调 switchApiProfileProvider,它保留 apiKey 并把 baseUrl 改成该 provider 的默认主机(Gemini→generativelanguage.googleapis.com);而 App.tsx:73 的清 key 守卫只在显式 #apiUrl(nextSettings.baseUrl!==undefined)时触发,provider 隐式改 host 不触发→旧 key 被原样保留并 persist 落盘。下次生成时用户的 OpenAI key 会以 x-goog-api-key 发往 Google(反向亦然)。确认可触发(查询串即可,无需控制 fragment;urlBootstrap.test.ts 已证明 provider 接受查询串值)。目的地是固定的正规第三方主机而非攻击者可控,故非直接窃取,但属攻击者用一条链接造成的静默配置篡改 + 跨厂商凭据外泄,且持久化。
- **证据**:

```
urlBootstrap.ts:77  const provider = normalizeProvider(searchParams.get('provider') ?? hashParams.get('provider'))
// App.tsx:73  if (nextSettings.baseUrl !== undefined && nextSettings.apiKey === undefined) { nextSettings.apiKey = '' }
// App.tsx:85  ...switchApiProfileProvider(profile, provider),  (无 baseUrl 时不再覆盖 apiKey)
// apiProfiles.ts:241 const common = { id: profile.id, name: profile.name, apiKey: profile.apiKey, timeout: profile.timeout }
```

- **修复方向**:在 App.tsx provider 切换分支里,当 provider 切换导致 baseUrl 隐式变更(且 URL 未显式带新 apiKey)时,同样把该 profile 的 apiKey 置空,与 baseUrl 变更时的清 key 守卫对齐;或把 provider 也限制为仅 hash 读取,与 apiKey/apiUrl 一致。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 1) evidence 称 "urlBootstrap.test.ts 已证明 provider 接受查询串值" 不精确:唯一对 result.provider 断言的用例(第7/13行)把 provider=gemini 放在 HASH 里;第18/34行虽把 provider= 放查询串却未断言 result.provider。机制靠代码第77行成立,测试并未直接证明。2) 前提条件:激活 profile 必须已有非空 apiKey 才有可泄露之物(空 key 会被 validateApiProfile 拦下),这是已配置用户的常态。3) "持久化落盘" 属真但次要;跨厂商泄露在下次生成时即发生,与是否落盘无关,持久化只让篡改在刷新后存活。4) 严重度 medium 可接受,但因目的地是固定的正规厂商主机(Google/OpenAI)而非攻击者可控,定为 low 亦有据——属密钥被投递到错误第三方 + 静默配置篡改,而非攻击者直接窃取。fix 建议正确(provider 也限制为仅 hash 读,或 provider 隐式改 host 时与 baseUrl 守卫对齐清 key)。

#### ◆ API 层

### M12 · Responses 模式 n>1 fan-out 每路请求独立 JSON.stringify 全量参考图 base64,内存 n 倍放大

- **位置**:`src/lib/api/openaiCompatibleImageApi.ts:312`
- **维度/严重度**:API 层 / medium
- **问题**:确认可触发:n 上限 10(paramCompatibility.ts MAX_OPENAI_OUTPUT_IMAGES=10),参考图上限 16 张、总 payload 上限 512MiB(imageApiShared.ts L10)。n 路并发同时各自物化一份含全部参考图 base64 的 JSON 字符串,峰值 ≈ n × 总参考图体积(16 张大图 + n=10 时可达 GB 级),提交瞬间主线程长卡顿甚至标签页 OOM。codexCli Images 并发路径(L128-132)同理,每路重复 dataUrlToBlob 解码全部输入图。
- **证据**:

```
const promises = Array.from({ length: n }).map(() => callResponsesImageApiSingle(opts, profile))
const results = await Promise.allSettled(promises)
// 每路 single(L371):body: JSON.stringify(body) —— body.input 内嵌全部 inputImageDataUrls
```

- **修复方向**:fan-out 改为有限并发(复用 batchConcurrency 或固定 2-3)而非一次性 allSettled 全开;或预先 stringify 一次共享请求体模板(各路 body 相同时)。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 两处细节修正:1) "n=10 时可达 GB 级甚至 OOM"仅在极端配置下成立——512MiB 单请求上限本身极少触及,且该体量在 n=1 时已有问题;现实重载场景(16 张数 MB 参考图 × n=10)约 ~1GB 瞬时字符串,是卡顿/内存压力而非必然 OOM。2) 补充加重细节:每个 async 单路在首个 await(fetch)前同步执行,n 次 JSON.stringify 在 .map 循环内背靠背同步完成,n 份全量字符串在提交瞬间同时物化并在整个上传期间被 in-flight fetch 持有;且 512MiB assert 在每路 single 内部执行(L352-355),只限单请求、不限 n 倍聚合。3) 行号全部准确(L312/L371/L128-132),无需修正。

#### ◆ 交互·性能·可访问性

### M13 · 导出/导入用 zipSync/unzipSync 在主线程同步压缩解压,大数据量时整页冻结且按钮无忙碌态

- **位置**:`src/lib/exportImport.ts:208`
- **维度/严重度**:UX·a11y / high → medium(核验修正)
- **问题**:确认可触发:数据全存 IndexedDB Blob,设置页自己就展示 GB 级配额条(storageStats.quota)。点「导出」后 getAllImages 全量物化 + zipSync level 6 同步 deflate 全部图片,主线程冻结数秒到数分钟,无任何进度/忙碌反馈,期间用户可再点导出叠加第二次冻结;导入路径 unzipSync 同理。这是「长任务无进度反馈」最重的入口。
- **证据**:

```
const zipped = zipSync(zipFiles, { level: 6 })  // exportImport.ts:208
const unzipped = unzipSync(new Uint8Array(buffer))  // exportImport.ts:234
// DataManagementSection.tsx:117 导出按钮: <button onClick={onExport} className="flex-1 rounded-xl ...">导出</button> — 无 disabled/spinner/进度
```

- **修复方向**:改用 fflate 异步 zip()/unzip()(内部走 worker),按钮加 isExporting 禁用态 + 进度 toast(已处理 N/M 张);或至少分块 yield 让 UI 喘息。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 1) "冻结数分钟"偏夸大:导入有 400MB 文件上限(exportImport.ts:37),冻结有上界;导出无上限,典型规模冻结为数秒到数十秒。2) "期间可再点导出叠加第二次冻结"不准确:冻结期间主线程不处理点击,点击排队在第一次冻结结束后才触发第二次导出,是背靠背串行冻结而非并发叠加;无防重入守卫这点属实。3) 无数据丢失/损坏风险:导出只读,导入的 unzipSync 与全部解码校验在 replace 清库之前完成;纯响应性/UX 问题,严重度建议 high→medium。4) 补充:命令面板 commands.ts:197 是第二个无守卫的导出入口。
  - 1) 冻结归因修正:getAllImages + 逐张 await storedImageToBytes(db.ts:347)是 async 逐张 yield 的,主线程冻结集中在 zipSync(exportImport.ts:208)单次同步调用(及全量 Blob 构造),IDB 物化阶段只贡献内存压力不贡献冻结。2) 影响面补充:除 DataManagementSection.tsx:117 外,命令面板 commands.ts:197 也 fire-and-forget 调 exportData,同样无忙碌态,是第二入口。3) 后果收窄:无任何数据完整性风险——导出只读;导入 unzipSync(:234)发生在 replace 清库(:271)之前,冻结期杀页不丢数据;导入另有 400MB 文件上限(:36-37)封顶。4) fix 补充:图片条目本身是已压缩格式,zip level 6 几乎无体积收益,改 level 0(store)可低成本消除大部分冻结时间,可与异步 zip()/unzip() 并列为方案。

### M14 · Toast 无 role=status/aria-live,屏幕阅读器收不到任何操作反馈;且固定 3 秒消失、错误文案无法复制

- **位置**:`src/components/Toast.tsx:38`
- **维度/严重度**:UX·a11y / high → medium(核验修正)
- **问题**:确认存在:全应用所有成功/失败反馈(生成失败、导入结果、复制失败等)唯一通道是这个 toast,无 aria-live 意味着读屏用户对一切操作结果零感知——WCAG 4.1.3 直接不满足。叠加问题:error 与 info 同为固定 3000ms,API 错误文案(whitespace-pre-line 多行)3 秒读不完;pointer-events-none 导致无法选中复制错误详情去排查;新 toast 直接覆盖旧 toast,批量操作时前面的错误被吞。
- **证据**:

```
<div key={toast.id} className="fixed bottom-24 left-1/2 z-[120] pointer-events-none toast-enter">  // 无 role/aria-live
// ui.ts:147-149: setTimeout(() => { if (get().toast?.id === id) set({ toast: null }) }, 3000)
```

- **修复方向**:容器加 role="status" aria-live="polite"(error 用 role="alert");时长按 type 与文本长度分级(error ≥6s 或需手动关闭),error toast 允许 pointer-events 并提供复制/关闭按钮。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 三处修正:1) "全应用所有成功/失败反馈唯一通道是这个 toast"过度声称——生成失败持久化为 task.status='error'+task.error,TaskCard(327 行失败态、455 行重试)与 DetailModal(438-465 行完整报错+241-249 行专用复制按钮)提供了持久且可复制的通道;"pointer-events-none 导致无法复制错误详情"仅对 toast-only 错误成立(保存任务失败/导入失败/剪贴板失败/校验错误等),对 API 生成错误不成立。2) "API 错误文案 3 秒读不完"前提偏差——API 生成错误详情主要落在 task.error 而非 toast;toast 里的长文案主要是导入失败和保存失败类。3) 建议的修法不完整:Toast.tsx:6 是 `if (!toast) return null` 条件渲染,直接在第 38 行 div 加 aria-live 无效(live region 随内容同时挂载,多数读屏不播报),需改为常驻空容器再注入文本。行号引用(Toast.tsx:38、ui.ts:147-149)全部准确。
  - 1) "全应用所有成功/失败反馈唯一通道是这个 toast" 言过其实:最高风险的错误类(生成失败)会持久化到 task.error,TaskCard.tsx:327-346 显示"失败"角标,DetailModal.tsx:441-457 展示完整报错文本并提供专门的"复制完整报错"按钮(handleCopyError, 241-249 行)——视障以外的用户排查生成错误不依赖 toast,"pointer-events-none 导致无法复制错误详情"对主路径已有缓解。2) "新 toast 覆盖旧 toast、批量错误被吞"属实(ui.ts 单槽位 toast),但批量生成的逐条错误持久化在各 task 卡片上,实际被吞的只是导入失败/保存任务失败/反推失败/剪贴板失败等 toast-only 错误。3) 修复建议需补充:Toast.tsx:6 在无 toast 时 return null,直接在该节点加 role="status" 会因 live region 随内容一起挂载/卸载而在部分读屏器上不播报,live region 容器应常驻 DOM、仅替换内容。

### M15 · hover 才显示的操作按钮用 display:none,触屏与键盘双重不可达——移动端无法重命名/删除对话、无法编辑/删除片段

- **位置**:`src/components/Sidebar/ConversationItem.tsx:199`
- **维度/严重度**:UX·a11y / high → medium(核验修正)
- **问题**:确认可触发:`hidden`(display:none)的元素不进 Tab 序,键盘用户永远摸不到「更多操作」(删除/重命名对话的唯一入口;重命名的另一入口是 onDoubleClick,同样键盘/触屏不可达)。触屏上无 hover:点对话行会立即 onSelect + onMobileClose 关掉抽屉,菜单按钮没有任何显示机会——移动端用户完全无法删除或重命名对话。SnippetPopover 的片段编辑/删除按钮同病:触屏点击行即插入并关闭 popover。
- **证据**:

```
className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-200 hover:text-gray-600 group-hover:flex ..."  // ConversationItem.tsx:199 更多操作按钮
// SnippetPopover.tsx:217: <span className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 group-hover:flex"> — 编辑/删除按钮同模式
```

- **修复方向**:把 hidden/group-hover:flex 换成 opacity-0 group-hover:opacity-100 focus-visible:opacity-100(保持可聚焦),并在触屏(useIsMobile 或 pointer:coarse)下常显这些按钮。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 1) SnippetPopover 路径应为 src/components/InputBar/SnippetPopover.tsx(发现里写成 src/components/SnippetPopover.tsx)。2) 「移动端完全无法」在 ConversationItem 一侧有一个边缘例外:对话行 div.group 自身有 px-2/py-2 内边距且无 click handler,部分 Android 浏览器点击该约 8px 空白条可能触发 hover 模拟而不选中对话,从而短暂露出菜单按钮——但不可发现、跨浏览器不可靠,不构成实际缓解;SnippetPopover 的 li 无任何空白区(插入按钮 w-full),触屏路径为零。3) 严重度建议从 high 降为 medium:无数据丢失/崩溃,核心生成流程移动端可用,桌面鼠标用户不受影响,影响面限于触屏/键盘用户的管理类操作(对话重命名/删除、片段编辑/删除);考虑到 PWA 移动定位属 medium 偏上。
  - 行号与代码证据完全准确(ConversationItem.tsx:199、SnippetPopover.tsx:217)。两处小修正:1) "移动端用户完全无法删除或重命名对话"略绝对——移动浏览器 tap 的 sticky :hover 模拟(抽屉用 translate 隐藏不卸载,重开后上次点过的行可能残留 hover 露出按钮)和外层 div 约 8px 的 padding 条带(点击只触发 group hover 不命中 onSelect 按钮)偶尔能露出按钮,但属浏览器相关的偶然行为、不可发现,实际等同不可用;2) 建议 fix 还应补 group-focus-within:opacity-100(光是按钮自身 focus-visible 不解决"Tab 进 group 时按钮仍不可见"的发现性问题,虽然 opacity-0 已可聚焦)。

### M16 · IME 守卫漏网:对话重命名与新建收藏分类的输入框,组字确认 Enter 会提前提交、Esc 会误取消

- **位置**:`src/components/Sidebar/ConversationItem.tsx:152`
- **维度/严重度**:UX·a11y / medium
- **问题**:确认可触发:全中文应用,给对话/分类起中文名是主路径。中文 IME 下按 Enter 确认候选词时 keydown 仍派发(isComposing=true),这里未守卫——拼音组字中途 Enter 直接 commitRename 提交半截拼音;Esc 本意是取消 IME 候选,却触发 cancelRename 丢弃整个编辑。对照组:CommandPalette.tsx:189、SnippetPopover.tsx:51、useCloseOnEscape.ts:13 都做了 `isComposing || keyCode === 229` 守卫,说明这两处是已修复模式的漏网。
- **证据**:

```
onKeyDown={(e) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    commitRename()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    cancelRename()
  }
}}  // 无 isComposing/keyCode 229 判定
// FavoriteCategoryMenu.tsx:285-294 新建分类 input 同样裸判 Enter/Escape
```

- **修复方向**:两处 onKeyDown 开头加 `if (e.nativeEvent.isComposing || e.keyCode === 229) return`,与 useCloseOnEscape 口径对齐。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 1) 影响面修正:Windows Chrome/Edge 和 Firefox 在组字期间 keydown 的 key 值为 'Process'(keyCode 229),`e.key === 'Enter'/'Escape'` 字符串比较不命中,这两个平台意外免疫;bug 实际复现于 macOS Chrome/Edge(组字期 keydown 报真实 key 且 isComposing=true)和 Safari(确认组字的 Enter 在 compositionend 后派发,isComposing=false 但 keyCode=229,导致提前提交)。对中文用户主流的 Windows Chrome 不触发,严重度维持 medium 但偏 medium 下限。2) 证据细节修正:CommandPalette.tsx:189 的守卫是 `e.nativeEvent.isComposing || e.repeat`,并非 `isComposing || keyCode === 229`;采用 229 变体的对照组只有 SnippetPopover.tsx:51 和 useCloseOnEscape.ts:13。3) 行号微调:FavoriteCategoryMenu 的 onKeyDown 实际为 284-295 行(声称 285-294,在容差内)。

### M17 · 三处自建 Esc 监听绕过全局 escStack,一次 Esc 同时关闭多层(右键菜单+Lightbox、移动抽屉+确认弹窗)

- **位置**:`src/components/ImageContextMenu.tsx:60`
- **维度/严重度**:UX·a11y / medium
- **问题**:确认可触发:① Lightbox 中右键图片打开 ImageContextMenu 后按 Esc——escStack 栈顶是 Lightbox(菜单未入栈),全局 listener 关掉 Lightbox,菜单自己的 listener 同帧关掉菜单,两层一起消失,预期只关菜单;② <md 宽度下打开侧栏抽屉→对话菜单→删除→ConfirmDialog(z-110)弹出,按 Esc:ConfirmDialog 经栈关闭的同时 Sidebar 的 document 监听把抽屉也关了。三处均无 IME 守卫(连带 Esc 取消组字时误关层)。
- **证据**:

```
const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') setMenuInfo(null)
}  // ImageContextMenu.tsx:60-61,注释自称"不入全局 useCloseOnEscape 栈,本地监听即可"
// Sidebar/index.tsx:120-121: const onKey = (e) => { if (e.key === 'Escape') onMobileClose() } — 同样不入栈、无 stopPropagation
// ConversationItem.tsx:63-64 菜单 Esc 同模式
```

- **修复方向**:ImageContextMenu / Sidebar 抽屉 / ConversationItem 菜单统一改用 useCloseOnEscape 入栈(它已处理栈顶语义与 IME 守卫),删除各自的裸 keydown 监听。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 1) ConversationItem 实际路径为 src/components/Sidebar/ConversationItem.tsx:63-65,发现误写为 src/components/ConversationItem.tsx。2) 场景②影响面修正:Esc 关 ConfirmDialog 走 handleClose(仅 dismiss),不会误触发删除 action,实际损害是抽屉被连带关闭(纯 UX,无数据风险);且点删除时菜单已先 setMenuOpen(false) 关闭,故恰为两层齐关。3) 第三处(ConversationItem 菜单)单独在桌面端无叠层时行为正常(escStack 为空,global handler 早退);双关仅在 <md 抽屉内打开菜单时出现(菜单+抽屉两个裸监听同时触发)。4) ImageContextMenu 的监听挂在 window,Sidebar/ConversationItem 挂在 document,evidence 描述基本准确。

### M18 · MaskEditorModal 是全部弹层中唯一没有焦点陷阱的:Tab 逃逸到被全屏遮挡的背景控件,关闭后焦点不还原

- **位置**:`src/components/MaskEditorModal/index.tsx:146`
- **维度/严重度**:UX·a11y / medium
- **问题**:确认可触发:遮罩编辑器是 fixed inset-0 z-[80] 全屏覆盖层,打开后焦点仍留在背景(如 InputBar 提交按钮),Tab 在不可见的背景控件间游走,Enter/Space 可激活它们(例如误触提交生成);键盘用户也无法直接 Tab 到「保存/撤销/画笔」工具栏(焦点先要穿过整个背景 DOM)。关闭后焦点不还原到触发元素。这是 useFocusTrap 已成项目惯例下的孤例缺口。
- **证据**:

```
useCloseOnEscape(Boolean(imageId), close)
useLockBodyScroll(Boolean(imageId))  // index.tsx:146-147 — 无 useFocusTrap
// grep 证实 MaskEditorModal 目录下 tabIndex/.focus(/focusTrap 零命中;其余 12 个弹层(DetailModal/SettingsModal/Lightbox/ConfirmDialog 等)全部接了 useFocusTrap
```

- **修复方向**:给根容器加 ref + tabIndex={-1},接 useFocusTrap(Boolean(imageId), rootRef),与其他 modal 对齐。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 两处措辞修正:1) "全部弹层中唯一"应限定为"全部全屏 modal 中唯一"——SnippetPopover 与 ImageContextMenu 也无 useFocusTrap,但属 light-dismiss popover/右键菜单,惯例上不强制焦点陷阱;2) "焦点先要穿过整个背景 DOM"更准确是"穿过触发按钮之后的所有背景 focusable"(modal 位于 App.tsx:212 DOM 末段,关闭态 modal 渲染 null 不贡献焦点位)。其余(行号 146-147、z-[80] 全屏、误触提交可达、关闭不还原焦点)均准确。

### M19 · TaskCard 打开详情的主交互是裸 div onClick,无 role/tabIndex/键盘处理——核心查看流程键盘完全不可达

- **位置**:`src/components/TaskCard.tsx:225`
- **维度/严重度**:UX·a11y / medium
- **问题**:确认存在:打开 DetailModal(查看大图、复制提示词、下载、谱系入口)唯一路径是点卡片本体;卡片是不可聚焦的 div,Tab 只能落到卡内的重试/对话标签等次级按钮,键盘用户无法打开任何任务详情。CommandPalette 命令集也不含「打开任务详情」,无替代路径。同时 done 卡封面 img alt=""(L353)使卡片对读屏只剩提示词文本。
- **证据**:

```
<div
  className={`group relative bg-white dark:bg-gray-900 rounded-xl border overflow-hidden cursor-pointer ...`}
  onClick={(e) => { ... onClick(e) }}
  onTouchStart={handleTouchStart}
  ...
>  // TaskCard.tsx:225-251,全文件仅 3 处 aria-*,根节点无 role=button/tabIndex/onKeyDown
```

- **修复方向**:根节点加 role="button" tabIndex={0} + onKeyDown(Enter/Space 触发 onClick),aria-label 取提示词前 N 字;或在卡内提供一个可聚焦的「查看详情」真按钮。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 两处补充修正:1) taskRuntime.ts:976 存在一个非交互例外——单任务(非 batch)失败时会自动 setDetailTaskId 弹出详情,即键盘用户在「任务刚失败」场景会被动看到 DetailModal;但该路径仅限 error 态且非按需触发,成功任务与历史浏览仍无任何键盘入口,不影响结论。2) 影响面比描述更广:TaskGridMatrix.tsx:277 的 XY 网格单元格同样复用 TaskCard 的裸 div onClick(handleCellClick→setDetailTaskId),网格视图详情同样键盘不可达;且多选(toggleTaskSelection)仅 Ctrl+click/触摸侧滑可达,CompareModal 入口对键盘用户同样关闭。其余引用全部准确:行号 225-252 精确命中、aria-* 恰 3 处、alt="" 在 L353、CommandPalette(lib/commands.ts buildCommands)确无打开详情命令。

### M20 · DetailModal 在面板内选中文本、松手落在遮罩上时会被误关(click 落到共同祖先根容器)

- **位置**:`src/components/DetailModal.tsx:320`
- **维度/严重度**:React 性能与正确性 / medium
- **问题**:确认可触发(UI Events 规范行为:mousedown 与 mouseup 目标不同,click 派发到最近共同祖先):DetailModal 专门用 data-selectable-text(L494)鼓励选中提示词文本,用户从面板内按下、拖选到面板外松手 → click 直接以根容器为 target 触发,面板的 stopPropagation 管不到 → 弹窗连同选区一起被关掉。CompareModal/LineageModal 把 onClick 放在遮罩元素上则不受影响,行为不一致。
- **证据**:

```
DetailModal.tsx L316-321:
  <div
    data-no-drag-select
    className="fixed inset-0 z-50 flex items-center justify-center p-4"
    onClick={() => setDetailTaskId(null)}
  >
关闭回调挂在整个 fixed 根容器上;面板 L329 只有 `onClick={(e) => e.stopPropagation()}`。对照 CompareModal.tsx L115-118 / LineageModal.tsx L133 是把 onClick 挂在遮罩层 div 上,根容器无 onClick。
```

- **修复方向**:照搬 CompareModal:把关闭 onClick 移到遮罩 div 上;或在根容器记录 mousedown 起点(pointerdown target 是否为遮罩)再决定 click 是否关闭。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 两处细节修正:(1) DetailModal 不是唯一用根容器 onClick 易感模式的弹窗——ConfirmDialog.tsx L68-70 和 SizePickerModal.tsx L152 同样把关闭 onClick 挂在根容器上,只是它们无 data-selectable-text 区域,实际难触发;DetailModal 是唯一既用易感模式又鼓励文本选中的弹窗。(2) 触发范围应限定为 Chromium 系浏览器(主流,足以成立):Firefox 在 mousedown/mouseup 目标不同时不向共同祖先派发 click,该场景下不可复现;Safari 行为不确定。其余描述(行号、对照文件、机制)无需修正。

### M21 · TaskGridMatrix 给 memo 化 TaskCard 传内联闭包 + 订阅 selectedTaskIds,框选期间每次 mousemove 全矩阵格子重渲染

- **位置**:`src/components/TaskGridMatrix.tsx:277`
- **维度/严重度**:React 性能与正确性 / medium
- **问题**:确认可触发:存在 XY 网格批次时,拖框选/Ctrl 点选的每一次 selectedTaskIds 写入(框选时是每个 mousemove,即每秒几十次)都让 TaskGridMatrix 整体重渲染,4 个内联闭包每次新建,击穿 TaskCard 的 React.memo——所有格子(如 5×5=25 张含 img 的卡)逐帧全量 reconcile。同文件 L36-40 注释专门为此把 repByCell 做了 memo,却留下了更贵的 memo 击穿;与 TaskGrid 里 SortableTaskCard 精心做的稳定回调(L40-44 注释)形成反差。
- **证据**:

```
TaskGridMatrix.tsx L274-281:
  <TaskCard
    task={task}
    isSelected={selectedTaskIds.includes(task.id)}
    onClick={(e) => handleCellClick(task, e)}
    onReuse={() => reuseConfig(task)}
    onEditOutputs={() => editOutputs(task)}
    onDelete={() => onDelete(task)}
  />
L22: `const selectedTaskIds = useStore((s) => s.selectedTaskIds)`。配合 TaskGrid.tsx L305 框选 mousemove 每次执行 `setSelectedTaskIds(Array.from(newSelected))`,store/slices/filters.ts L41-43 setter 无相等性短路,每次都写入新数组引用。
```

- **修复方向**:仿照 TaskGrid:handleCellClick/onReuse/onEditOutputs 提为以 task 为参的 useCallback 稳定回调,格子内再包一层 memo 子组件做闭包绑定;另可在 filters slice 的 setSelectedTaskIds 里加浅比较短路,框选范围未变时不发布新数组。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 两处修正:1) 发现低估了触发面——TaskGridMatrix 本身未包 React.memo,而 TaskGrid 每次框选 mousemove 还会因本地 setSelectionBox 状态(TaskGrid.tsx L336-341)整体重渲染,矩阵重渲染是 selectedTaskIds 订阅 + 父组件级联的双重触发;因此 fix 中"给 setSelectedTaskIds 加浅比较短路"单独实施无效(父级 selectionBox 重渲染照样穿透非 memo 的 TaskGridMatrix),必须以稳定回调 + memo 格子子组件为主修,可选再包 memo(TaskGridMatrix)。2) 影响定性:击穿 memo 后是每帧全量 reconcile(CPU),img src 引用未变不会触发重新解码/网络请求,属性能劣化而非正确性 bug,medium 定级合理。其余引用(TaskGridMatrix.tsx L22/L274-281、TaskGrid.tsx L305、filters.ts L41-43、TaskCard.tsx L593 memo)行号与代码全部准确。

### M22 · Lightbox/TaskCard 的 ensureImageCached 异步 setState 无取消守卫,快速切换时旧请求后到会串图

- **位置**:`src/components/Lightbox.tsx:40`
- **维度/严重度**:React 性能与正确性 / medium
- **问题**:确认可触发:Lightbox 用方向键快速翻页且目标图未进缓存时,图 A 的 IDB 读取+FileReader 转换(大图可达百毫秒级)晚于图 B 完成 → setSrc(A) 覆盖 B,当前 id 与显示内容不一致(底部序号也对不上);L92 的 maskPreview effect 还会基于串掉的 src 合成错误遮罩预览。TaskCard 在任务重跑/编辑输出导致 outputImages 连续变化时同理封面串图。DetailModal 已防,这两处漏防——属同模式不一致。
- **证据**:

```
Lightbox.tsx L31-44:
  useEffect(() => {
    if (!lightboxImageId) { setSrc(''); return }
    const cached = getCachedImage(lightboxImageId)
    if (cached) { setSrc(cached) } else {
      ensureImageCached(lightboxImageId).then((url) => {
        if (url) setSrc(url)
      })
    }
  }, [lightboxImageId])
—— 无 cancelled 标志、无 cleanup。TaskCard.tsx L146-148 同模式(`ensureImageCached(task.outputImages[0]).then((url) => { if (url) setThumbSrc(url) })`)。对照 DetailModal.tsx L68/L82-89 同样的加载有 `let cancelled = false` + cleanup 守卫。
```

- **修复方向**:与 DetailModal 对齐:effect 内 `let cancelled = false`,then 回调里 `if (!cancelled && url) setSrc(url)`,cleanup 置 true;或记录请求序号/当前 id 比对后再 setState。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 1) 转换耗时来源应为 db.ts L336-344 的 blob.arrayBuffer()+JS base64 循环(非 FileReader;FileReader 版本在 taskRuntime/maskPreprocess),但"大图转换耗时与体积成正比、可后到"的时序结论不变。2) Lightbox L64-66 的遮罩图加载 setMaskImageSrc 是同样的无守卫标量 setState,且其 effect 依赖 tasks 重跑更频繁,修复应一并覆盖(发现未列出)。3) maskPreview effect 实际为 L74-92 且自带 cancelled 守卫,串图是因其输入 src 已错,表述需微调。4) 后果比"快速切换时短暂串图"更重:load effect 仅在 id 变化时重跑,旧 promise 后到覆盖后错误图会持续显示到下一次翻页,属持久性错位而非闪烁。

#### ◆ 遮罩编辑器(批评家盲区补查)

### M23 · Alt+滚轮缩放的 preventDefault 在 React 被动 wheel 监听器中失效,Firefox 下 Alt+滚轮会触发历史前进/后退导致未保存遮罩丢失

- **位置**:`src/components/MaskEditorModal/hooks/usePointerInteraction.ts:302`
- **维度/严重度**:盲区补查 / medium
- **问题**:React 17+ 在根容器以 passive: true 注册 wheel/touchstart/touchmove,合成事件内 preventDefault() 是 no-op(浏览器还会每次滚动打印 'Unable to preventDefault inside passive event listener' 告警)。触发条件完全可达:遮罩编辑器的滚轮缩放本身要求按住 Alt,而 Firefox(Windows/Linux 默认 mousewheel.with_alt.action=2)中 Alt+滚轮的默认动作就是历史前进/后退——用户按文档操作缩放画布时可能直接被导航离开页面,正在涂抹的未保存遮罩全部丢失。Chrome/Edge 下因 modal 为 fixed 全屏 + useLockBodyScroll,后果仅为控制台告警。项目在 Lightbox 中已知并规避了这个坑,此处属于同模式遗漏。
- **证据**:

```
usePointerInteraction.ts:296-307: `const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => { if (!event.altKey || !isReady || isSaving) return ... event.preventDefault(); viewport.zoomAtPoint(...) }`,经 CanvasViewport.tsx:54 以 React 合成事件绑定 `onWheel={handlers.onWheel}`。react-dom-client.development.js:19251-19255 确认 React 19 将 wheel 注册为被动监听:`!passiveBrowserEventsSupported || ("touchstart" !== domEventName && "touchmove" !== domEventName && "wheel" !== domEventName) || (listenerWrapper = !0)`。对照同项目 Lightbox.tsx:255 已正确用原生监听规避:`el.addEventListener('wheel', onWheel, { passive: false })`
```

- **修复方向**:与 Lightbox.tsx 一致:在 effect 中对 baseFrameRef.current 用原生 addEventListener('wheel', handler, { passive: false }) 注册,移除 CanvasViewport 的 React onWheel 绑定;handler 内保留 altKey/isReady/isSaving 守卫与 zoomAtPoint 调用。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 仅精度补充,不影响结论:1) 数据丢失还需一个隐含前提——会话历史在对应方向有条目(直接新标签页打开应用且无前进历史时,Alt+滚轮回退无处可去,仅缩放+无害);2) Firefox 下实际表现是缩放与历史导航同时发生(被动监听仍执行 zoomAtPoint,只是 preventDefault 无效);3) macOS Firefox 的 mousewheel.with_alt.action 默认值发现者未声称,其限定 Windows/Linux 是保守且正确的。行号、引用代码、react-dom 内部行号全部准确,无需修正。

### M24 · 遮罩撤销历史每步保存全分辨率 ImageData(上限 40 张),1920 工作尺寸下 undo+redo 栈最坏可达约 1.1GB,移动端有标签页 OOM 崩溃风险

- **位置**:`src/components/MaskEditorModal/hooks/useMaskHistory.ts:62`
- **维度/严重度**:盲区补查 / medium
- **问题**:1920×1920 的 ImageData 为 1920*1920*4 ≈ 14.1MiB,40 张 undo 即约 566MiB;redo 栈虽间接受 undo 次数约束(≤40),最坏合计约 1.1GiB 常驻 JS 堆。触发条件可达:精细涂抹遮罩单次会话超过 40 笔很常见(每次 pointerdown 即一笔),内存在 40 笔后达到平台期并持续占用直到关闭编辑器(resetHistory)。iOS Safari 单标签页内存限额约 1-1.5GB,移动端(项目支持 PWA/触屏捏合缩放,明显面向移动使用)长时间编辑大图有真实的标签页崩溃风险,崩溃即丢失所有未保存编辑。
- **证据**:

```
useMaskHistory.ts:3 `const HISTORY_LIMIT = 40`;:62 `pushBounded(undoStackRef.current, ctx.getImageData(0, 0, canvas.width, canvas.height), HISTORY_LIMIT)`;:73 redo 栈为无界 push:`redoStackRef.current.push(ctx.getImageData(...))`。maskPreprocess.ts:4 `export const DEFAULT_MASK_WORKING_MAX_EDGE = 1920` 决定画布工作尺寸上限。每次笔画起点 usePointerInteraction.ts:248 调用 `history.pushSnapshot()`
```

- **修复方向**:按字节而非张数设上限(如总预算 100-200MB 动态计算可保留张数);或快照改存压缩格式(canvas.toBlob PNG,遮罩为二值图压缩率极高)/仅存笔画脏矩形增量;redo 栈纳入同一预算。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 1) 最坏内存量错误:undo+redo 合计 1.1GiB 不可达。pushSnapshot(useMaskHistory.ts:63)每次清空 redo 栈,undo()/redo() 为两栈 1:1 交换,不变式 undo.length+redo.length ≤ 40 恒成立(useMaskHistory.test.ts:21-38 已测试该守恒性质),最坏 ≈ 562 MiB(40 张 1920×1920 RGBA),应将标题与 why 中的 1.1GB 改为 ~560MB。2) 'redo 栈为无界 push' 表述误导::73 的 push 语句本身无界,但受守恒不变式约束实际有界(≤40 减去 undo 当前张数);同理 redo() 在 :84 对 undo 栈的裸 push 也被同一不变式约束。3) 最坏值前提需补充:562 MiB 要求源图近正方形且长边 ≥1920;典型 1024×1024 生成图平台期约 160 MiB,1920×1080 约 316 MiB。严重度维持 medium(移动端 OOM 风险仍真实,但量级减半、最坏前提收窄)。

#### ◆ 构建与部署

### M25 · SW 离线保障是部分缓存:hashed assets 从不预缓存,且每次部署 activate 会把刚 runtime-cache 的新 assets 连同旧 cache 一起删掉

- **位置**:`public/sw.js:6`
- **维度/严重度**:构建部署 / medium
- **问题**:install 只预缓存 4 个 APP_SHELL 文件,JS/CSS(/assets/* hashed 文件)只靠 fetch handler runtime 缓存。两个确认可达的窗口:(1) 部署后第一次在线访问:页面经【旧 SW】加载新 index.html 与新 assets,新 assets 被写进旧 CACHE_NAME;随后新 SW install+skipWaiting+activate 把旧 cache 整个删除——此刻 Cache Storage 里只有 index.html 等 4 个文件,没有任何 JS/CSS;(2) 用户首次访问:assets 在 SW 取得控制权之前就已加载,同样不进 SW cache。之后离线打开:navigate 兜底返回缓存的 index.html,但其引用的 /assets/index-*.js 在 Cache Storage 中 miss,只能指望浏览器 HTTP disk cache(immutable 头)兜底——HTTP cache 是可被驱逐的(存储压力/清『缓存的图片和文件』),被驱逐后离线打开即白屏。即 README『支持作为 PWA…离线可打开应用外壳』的保障从未由 SW 自包含,部署后到第二次完整在线访问之间该保障始终缺失。
- **证据**:

```
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './pwa-icon.svg']
...
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  )
  self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  )
...(fetch handler) if (response.ok && url.pathname.includes('/assets/')) { ... cache.put(request, copy) }
```

- **修复方向**:构建期把 dist/assets/* 清单注入 APP_SHELL(扩展 scripts/inject-sw-build-id.mjs 生成 precache manifest,与 CACHE_NAME 注入同一脚本),或 activate 删旧 cache 前先把当前页面 clients 引用的 assets 复制进新 cache;最低成本方案是 navigate 成功后由 SW 主动 fetch+缓存 index.html 引用的 assets。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 两处细化:(1) 窗口 1 中新 SW activate+claim 之后才发起的请求(如懒加载 chunk)会落入新 cache,被 activate 清掉的是 HTML parse 期已发起的启动关键 bundle(index-*.js/css)——不影响结论,因启动 bundle 正是离线打开外壳所必需;(2) 稳态下(部署后第二次完整在线访问之后、下次部署之前)SW cache 经 runtime 缓存是完整的,缺口严格限于发现所述两个窗口,实际白屏需"处于窗口内 + 离线 + HTTP disk cache 被驱逐/清除"三条件叠加,严重度维持 medium(偏低),不宜上调。行号全部准确(L6/L36-50/L76-79),无需修正。

### M26 · Caddyfile 注释错误声称『Caddy 已默认开启 HSTS』——实际 Caddy 不会自动下发 HSTS,四处部署配置均无 Strict-Transport-Security

- **位置**:`Caddyfile:17`
- **维度/严重度**:构建部署 / medium
- **问题**:Caddy v2 的 automatic HTTPS 只做 HTTP→HTTPS 重定向,并不自动添加 Strict-Transport-Security 头(官方文档要求用 header 指令手动加)。该注释让维护者以为已覆盖而『不再重复添加』。核对全部四处配置(Caddyfile / Caddyfile.lan / nginx-security-headers.inc L7-15 / public/_headers L6-12)和 docs/security-headers.md 的『强制下发』基线,均无 HSTS。影响:Docker HTTPS(含 sslip.io)与自定义域名部署对 SSL-strip/首跳降级无防护;线上 *.workers.dev demo 因 workers.dev 在浏览器 HSTS preload list 而不受影响——这正是『两套部署配置漂移』:Workers 路径有(平台兜底的)HSTS 语义,自托管路径没有。确认可验证:curl -sI https://站点 | grep -i strict 为空。
- **证据**:

```
# 强制 HTTPS 安全响应头（Caddy 已默认开启 HSTS，不再重复添加）
header {
    X-Frame-Options "SAMEORIGIN"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "strict-origin-when-cross-origin"
    ...
}
```

- **修复方向**:Caddyfile 主站 header 块加 Strict-Transport-Security "max-age=31536000"(确认 HTTPS 稳定后再考虑 includeSubDomains/preload);修正注释;同步 docs/security-headers.md 基线。nginx/_headers 侧由于可能被 HTTP 模式复用,只在 HTTPS 终结层(Caddy)加即可。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 细节补强而非修正:(a) docs/remediation-plan-2026-05-29.md L527「Caddy HTTPS 段才有 HSTS」表明原始计划本预期在 Caddyfile HTTPS 段加 HSTS,可作为「非有意省略」的直接证据,建议修复时一并引用。(b) public/_headers 缺 HSTS 对 *.workers.dev 默认域无实际影响(workers.dev 在浏览器 HSTS preload list),但若用户给 Workers 绑自定义域名则同样裸奔——发现的影响面描述可补这一点。(c) 修复建议正确:仅在 HTTPS 终结层(Caddyfile 主站 header 块)加 Strict-Transport-Security "max-age=31536000" 并修正 L17 注释;Caddyfile.lan 为纯 HTTP,浏览器会忽略 HSTS,无需加;nginx 在 Caddy 后面做内层服务,也不必加。同步更新 docs/security-headers.md 基线说明 HSTS 仅在 HTTPS 终结层下发。行号全部准确,无需修正。

### M27 · 无任何 CI;npm run deploy 与 Docker 构建链都不跑 vitest/eslint,441 个测试不在任何部署门禁上

- **位置**:`package.json:8`
- **维度/严重度**:构建部署 / medium
- **问题**:项目根无 .github/.gitlab 等任何 CI 目录(已用 ls -a 确认)。build 链的质量门禁只有 tsc -b + 两个构建后守卫(SW 占位符/CSP hash,这两个守卫本身写得很好、失败硬退出);vitest 和 eslint 只能靠本地手动执行。确认可触发:任何一次忘跑 npm test 的提交都能原样 wrangler deploy 上线、原样进 Docker 镜像——『441 全绿』只是约定而非机制。对一个以 lib 层测试为主要质量保障的本地优先应用,这是测试投资与部署门禁脱节。
- **证据**:

```
"build": "tsc -b && vite build && node scripts/inject-sw-build-id.mjs && node scripts/verify-csp-hash.mjs",
...
"deploy": "npm run build && wrangler deploy",
(Dockerfile L20: RUN npm run build \\\n    && test -f dist/sw.js \\\n    && ! grep -q '__CACHE_NAME__' dist/sw.js)
```

- **修复方向**:加一个最小 GitHub Actions workflow:push/PR 跑 npm ci && npm run lint && npm test && npm run build;deploy 脚本改为 npm test && npm run build && wrangler deploy(或在 CI 里做 deploy)。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 无实质性修正。补充三点细化:(1) build 链中 tsc -b 提供了类型检查门禁(发现已承认),所以并非完全无质量门禁,而是 vitest/eslint 缺位;(2) 除 CI 缺失外,也无 git hooks/husky/npm predeploy 等任何本地机制兜底,发现实际上还可更强;(3) 441 测试套件实测仅 1.35s 跑完,将其加入 deploy 门禁几乎零成本。唯一保留:无法从仓库内排除 GitHub/Cloudflare 侧外部托管 CI 的可能,但仓库内所有证据(本地 wrangler deploy 脚本、wrangler.jsonc 无 build 配置)均指向手动部署路径。

### M28 · vitest 无独立配置、直接消费带 cloudflare() 插件的 vite.config.ts,测试运行器与部署插件版本互锁,安全升级被迫走 exact-pin override(ws 8.20.1 的来由)

- **位置**:`vite.config.ts:26`
- **维度/严重度**:构建部署 / medium
- **问题**:仓库没有 vitest.config.*,vitest 4 直接加载 vite.config.ts,连同 @cloudflare/vite-plugin 一起进入测试管线。git 历史(6ce5faa, 2026-06-01)明确记录:升级 vite-plugin 会破坏 vitest 运行,因此修 ws 漏洞 GHSA-58qx-3vcg-4xpx 时不能走 npm audit fix,只能用 overrides 把 ws 钉死在 8.20.1(已核实 lockfile node_modules/ws version=8.20.1,纯 devDependencies,生产无影响——回答了『override 原因』)。残余风险确认存在:(1) wrangler/vite-plugin 的后续安全更新被锁(仍固定 1.36.3/4.90);(2) exact-pin override 会把未来传递依赖声明的更高 ws 需求静默压回 8.20.1。这是工具链结构问题,不只是单次取舍。
- **证据**:

```
plugins: [react(), cloudflare()],
(无 vitest.config.* —— Glob 确认不存在;package.json overrides: { "ws": "8.20.1" };commit 6ce5faa: "不走 `npm audit fix`——它会连带把 @cloudflare/vite-plugin 1.36.3→1.39.0 / wrangler 4.90→4.95 / miniflare 一起 bump,那是构建工具升级、需单独验证,且新 vite-plugin 会破坏 vitest 运行")
```

- **修复方向**:新建 vitest.config.ts(test 专用,只挂 react 插件或干脆无插件,显式 include src 与 scripts 的 test 文件),解除 vitest 对 cloudflare() 的依赖;之后再独立验证并升级 @cloudflare/vite-plugin/wrangler,升级完成后移除 ws override。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 两处细节修正:(1) '@cloudflare/vite-plugin/wrangler 仍固定 1.36.3/4.90' 的固定发生在 package-lock.json(resolved 1.36.3/4.90.0)+维护者主动不升级,package.json 声明的是 caret 范围 ^1.36.3/^4.90.0,并非 manifest 硬钉——互锁是操作层面(文档化的不敢升)而非 manifest 机械锁。(2) ws override 当前的实际效果方向是把传递声明的 8.18.0 强制'抬升'到 8.20.1;'压回更高需求'是对未来的正确推演而非现状。另:建议 fix 时新 vitest.config.ts 若沿用 react 插件即可,define 两常量经核验无测试依赖,可不补。

#### ◆ 存储驱逐配套(批评家盲区补查)

### M29 · 存储用量 UI 已有 quota 基建,但不展示持久化授权状态,与同区块的导出按钮零联动、无驱逐风险提示

- **位置**:`src/components/SettingsModal/DataManagementSection.tsx:64`
- **维度/严重度**:盲区补查 / medium
- **问题**:StorageStats 类型(storageStats.ts:56-65)只有 quota: { usage, quota },没有 persisted 字段;用户在唯一能查看本地存储状况的界面(设置-数据管理)得不到『数据可能被浏览器清除』的任何信号——配额进度条反而制造『还有大量空间、很安全』的错觉,而导出按钮就在同一组件 L117 却无备份引导。触发条件:任何未获持久化授权的用户打开设置页即处于此盲区
- **证据**:

```
{storageStats.quota && storageStats.quota.quota > 0 && (
  ...
  <div className="text-[11px] text-gray-400 dark:text-gray-500">
    浏览器已用 {formatBytes(storageStats.quota.usage)} / {formatBytes(storageStats.quota.quota)}
  </div>
```

- **修复方向**:StorageStats 增加 persisted: boolean | null(读 navigator.storage.persisted(),不支持时 null);quota 条旁渲染『已持久化/可能被驱逐』徽标;未授权时显示警示文案+『请求持久化』按钮(persist() 由用户手势触发可让 Firefox 弹出授权框),并引导定期导出 ZIP
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 行号与代码全部属实,无需修正事实。两点补充:1) 这是数据安全/UX 加固缺口而非功能性 bug——quota 展示、导出、清理功能本身行为正确;2) fix 中『persist() 触发授权框』仅对 Firefox 成立,Chrome 不弹框而是按站点参与度/PWA 安装/通知权限启发式自动决定(本项目是 PWA,已安装用户在 Chrome 实际接近自动持久化,纯浏览器标签用户才处于 best-effort 驱逐风险),建议 fix 文案注明浏览器差异。另注:ApiProfileSection.tsx:194 有一条 localStorage 密钥丢失提示,但只涉及用户主动清数据,不构成对 IDB 驱逐风险的提示,不削弱本发现。

### M30 · README 隐私章节宣传『数据全在本地不经第三方』,但零披露浏览器驱逐风险,导出被定位为跨设备迁移而非必要备份

- **位置**:`README.md:96`
- **维度/严重度**:盲区补查 / medium
- **问题**:grep 全 README 无『驱逐/数据丢失/浏览器清除』类披露;L68 把导出描述为『可在另一台设备导入恢复』的迁移功能而非防丢失备份。本地优先的宣传语让用户默认本地=持久,实际 Safari 7 天 ITP、用户清浏览数据、磁盘压力 LRU 驱逐均会全量删库;文档层面的风险告知是 persist() 被拒(Safari 常态)时唯一兜底
- **证据**:

```
- 任务记录、生成图片、API 配置全部存浏览器（IndexedDB Blob 存储 + localStorage），**不经过任何第三方服务器**。
```

- **修复方向**:在『🔒 隐私与本地优先』折叠节补一段:数据受浏览器存储策略约束,可能被自动清除(列 Safari 7 天/磁盘压力两个典型场景),建议定期导出 ZIP 备份;persist() 落地后同步说明各浏览器授权差异
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 1) L68 表述过度:原文写的是「一键打包全部记录与图片为 ZIP 备份,可在另一台设备导入恢复」——确实使用了「备份」一词,准确说法应为「虽名为备份,但动机只关联跨设备迁移,未关联数据丢失风险、未建议定期执行」。2) 前提修正:「persist() 被拒时文档是唯一兜底」隐含 persist() 已调用——实际代码从未调用 navigator.storage.persist()(仅 storageStats.ts:78 调 estimate()),即任何浏览器下存储都恒为 best-effort,文档披露在所有场景都是唯一兜底,此修正加重而非削弱发现。3) 影响面精确化:iOS 加到主屏的已安装 PWA 豁免 ITP 7 天上限,风险主要作用于普通浏览器标签页用法(即 README Quickstart 推荐的在线试用路径);另应用内 ApiProfileSection.tsx:194 已有局部披露但仅限 localStorage 密钥的手动清除场景。

#### ◆ 代码重复

### M31 · 优化器/反推双栈全链路复制:~100 行 SSE 流式实现、normalize/dedupe 三连、Config 类型逐字段相同

- **位置**:`src/lib/api/captionImageApi.ts:52`
- **维度/严重度**:代码健康 / medium
- **问题**:确认存在。captionImageStream 与 optimizePromptStream 的超时 AbortController 搭建、fetch、错误映射、SSE reader 循环、收尾清理约 100 行完全复制(chatCompletionsShared 只抽了 buildChatCompletionsUrl/parseSseLine 等零头);类型层 PromptOptimizerConfig(types.ts L33-43)与 CaptionerConfig(L52-62)逐字段相同;apiProfiles.ts 里 normalizePromptOptimizer(L82-103)与 normalizeCaptioner(L152-172)、getOptimizerProfileDedupKey(L501)与 getCaptionerProfileDedupKey(L551)、isDefault*/createImported* 各成对逐字符相同,合计 250+ 行三联复制。这是已知问题 8(两个 image api 的 4 处超时模式重复)之外的另一组更大的重复:任何流解析/取消语义修复都要改两份,已知 9 的『错误文案口径不一』正是这类复制的直接产物。
- **证据**:

```
// captionImageApi.ts L52-154 与 optimizePromptApi.ts L41-137 除 messages 体和空结果文案外逐行相同:
const timeoutTimer = setTimeout(() => timeoutController.abort(new Error('请求超时')), timeoutMs)
...
  } catch (err) {
    clearTimeout(timeoutTimer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
    if (externalSignal?.aborted) throw new Error('已取消')
    if ((err as { name?: string }).name === 'AbortError') throw new Error('请求超时')
// 同样的 cleanup 三连在每个文件里重复 4 处(fetch catch / !ok / !body / finally)
```

- **修复方向**:抽 streamChatCompletions(config, messages, emptyMessage, options) 进 chatCompletionsShared,双方只传 messages 构造器;类型上合并为单一 ChatApiConfig(provider 字段已同构),apiProfiles 的 normalize/dedupe/isDefault/createImportedId 用泛型工厂按 defaults 参数化。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 细节修正:1) "cleanup 三连"实为二连(clearTimeout + removeEventListener),在每文件 4 处重复属实;2) captionImageApi.ts 流主体精确范围是 L52-155(claim 写 L52-154,差 1 行,在容差内);3) geminiChatShared.ts L14 有"不复用 OpenAI 路径,隔离风险"的设计注释,但该隔离是 Gemini/OpenAI 协议之间的,且 Gemini 栈本身已在 captioner/optimizer 间共享(streamGeminiChat 签名即建议的抽取形状),反而佐证而非削弱本发现;4) "已知问题 8/9"为外部清单引用,本次未独立核验,但不影响重复本身的事实成立。

## 五、🟢 LOW(22 条)

### L1 · rollbackStoredImages 完整性缺口:并发兄弟任务已 storeImage 但尚未 commit 到 task record 的同 hash 输出图,会被取消任务的回滚误删(内容寻址去重场景)

- **位置**:`src/lib/taskRuntime.ts:140`
- **维度/严重度**:并发与状态机 / low
- **问题**:理论上可能,未确认实际触发:storeImage 按整个 dataUrl 的 SHA-256 做 id,跨任务字节级相同的输出会去重共享同一条记录。窗口:并发任务 A、B 各自产出同 hash 图 X;B 已 storeImage(X) 但还在循环中/尚未 await updateTaskInStore commit;此时 A 被取消(或删除),A 走 L926→rollbackStoredImages([... X]),X 不在任何已 commit 记录里 → deleteImage(X);随后 B commit 的 outputImages 引用已删的 X,刷新后(内存缓存失效)图丢失。需要两并发任务输出字节级相同——固定 seed + 相同 prompt 的确定性 provider、或 provider 对部分失败返回同一占位图时可达;常规随机生成下几乎不会相同。注释「避免误删内容寻址去重命中的在用图」表明作者考虑过 dedup 误删,但只覆盖了已 commit 的引用。
- **证据**:

```
// rollbackStoredImages 的保护集只来自「已 commit 的 task 记录 + inputImages」(L132-145):
const { tasks, inputImages } = useStore.getState()
const stillUsed = new Set<string>()
for (const t of tasks) {
  for (const id of t.inputImageIds || []) stillUsed.add(id)
  if (t.maskImageId) stillUsed.add(t.maskImageId)
  for (const id of t.outputImages || []) stillUsed.add(id)
}
...
for (const id of imageIds) {
  if (!stillUsed.has(id)) {
    await deleteImage(id)

// 而兄弟任务的 outputIds 在 commit 前只存在于局部变量(L897-901):
const imgId = await storeImage(dataUrl, 'generated')   // 内容寻址:同 dataUrl → 同 id,dedup 跳过写入(db.ts L407-414)
outputIds.push(imgId)                                  // 尚未进任何 task record
```

- **修复方向**:维护模块级 in-flight 输出注册表(taskId → 本次已 storeImage 的 id 集合),executeTask 进入存图循环时登记、finally 注销;rollbackStoredImages 将所有其它任务的 in-flight 集合并入 stillUsed 后再删。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 两处细节修正:1) 影响时点——发现称「刷新后(内存缓存失效)图丢失」,实际 rollbackStoredImages 同时调 deleteCachedImage(L143),且在触发丢失的交错序中 B 的 setCachedImage(L900)必然先于 A 的回滚,故内存缓存也被清,图片在当前会话立即丢失(下次 ensureImageCached 即 miss),不必等刷新;2) 触发窗口需更精确——取消必须落在 A 的写图循环窗口内(L893-894 检查通过之后、L926 之前):若取消发生在网络请求期间,AbortController 使 callImageApi 抛错走 catch 路径,根本不会进入存图循环,也就不触发 L929 回滚。行号全部精确无误差。

### L2 · 导入路径不跑 markInterruptedSyncHttpTasks:备份中 status='running' 的任务被 normalizeTasks 原样保留,导入后成为无执行器、无 watchdog 的幽灵 running 卡片

- **位置**:`src/lib/tasks.ts:90`
- **维度/严重度**:并发与状态机 / low
- **问题**:确认可触发:批量任务进行中执行导出(getAllTasks 会带出 status='running' 的记录),把该备份导入(merge 或 replace)到任意实例——导入的 running 任务没有对应的 executeTask/AbortController/watchdog,卡片永远转圈。可恢复性尚可:用户可逐条 cancelTask(状态守卫只看 status==='running',能正常翻 error),或刷新页面由 initStore 的 markInterruptedSyncHttpTasks 收口;但在刷新前它们会污染 running 计数、cancelBatch 的 aborted/skipped 口径与「全部取消」语义。严重度低,属导入边界未对齐启动恢复逻辑。
- **证据**:

```
// normalizeTasks 保留 running(lib/tasks.ts L90):
status: item.status === 'running' || item.status === 'done' || item.status === 'error' ? item.status : 'done',

// importData 直接 normalize 后写入,无中断标记(exportImport.ts L252-253):
const normalizedImportedTasks = normalizeTasks(data.tasks)

// 而 markInterruptedSyncHttpTasks 全工程仅 initStore 调用(taskRuntime.ts L279):
const { tasks: interruptedNormalizedTasks, interruptedTasks } = markInterruptedSyncHttpTasks(storedTasks)
```

- **修复方向**:importData 在写库/setTasks 前对导入任务套用 markInterruptedSyncHttpTasks(或在 normalizeTask 中将 running 直接降级为 error+「请求中断」文案,导出快照里的 running 本就不可能恢复执行)。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 仅一处口径修正:「merge 或 replace 导入到任意实例」略宽——merge 模式导回正在运行该任务的同一活实例时,existingTaskIds 去重(exportImport.ts L244/L268)会跳过同 id 任务,不产生幽灵;幽灵卡片出现在导入到其他实例/浏览器/会话(典型备份恢复场景)或 replace 模式。其余描述(行号、证据、可恢复路径、skipped 计数污染)全部准确。另一补充佐证:taskRuntime.ts L482 注释本身就把「无请求/无 watchdog 的幽灵 running 卡片」视为需要回滚的异常态,说明导入路径留下同样状态与设计意图相悖。
- **交叉印证**:数据完整性 维度独立报告了同一问题(「导入保留 status:'running':带运行中任务的备份导入后出现无执行体的幽灵 running 卡片…」,`src/lib/tasks.ts:90`),结论一致,已合并。

### L3 · imageCache LRU 只按条数(100)淘汰不按字节:满载时驻留数百 MB 全尺寸 dataURL 字符串

- **位置**:`src/lib/imageCache.ts:8`
- **维度/严重度**:数据完整性 / low
- **问题**:确认机制、量级取决于图片大小:生成类工作台单图 PNG 常 2-5MB,100 条 × 3-7MB 字符串 ≈ 300-700MB JS 堆常驻,移动端/低内存设备浏览 gallery 滚动一轮即可顶到上限并长期不释放(LRU 不会缩容)。对象 URL 各处释放倒是干净(canvasImage.ts try/finally、gridSheetRender/exportImport 即用即 revoke),泄漏主因就是这个按条数的缓存。
- **证据**:

```
imageCache.ts L8-9: `const MAX_ENTRIES = 100` / `const imageCache = new Map<string, string>()`;evictIfOverflow(L19-25)仅 `while (imageCache.size > MAX_ENTRIES)` 按条数驱逐,无字节核算。缓存值是 storedImageToDataUrl 产出的完整 base64 dataURL(原图 ×1.33)。
```

- **修复方向**:改按累计字节驱逐(阈值如 100-150MB,size 取 dataUrl.length),或缓存改存 Blob + 按需 createObjectURL(配对 revoke),至少给移动端降低 MAX_ENTRIES。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 1) "300-700MB" 是上界估计:典型 1024² PNG(1.5-3MB)满载约 200-400MB,700MB 需持续 5MB+ 原图,略偏高但量级正确。2) 严格说这是有界驻留(封顶 100 条)而非"泄漏",触发前提是库中确有 ≥100 张图且用户滚动/打开过它们。3) 补充佐证:TaskCard.tsx L136 注释写"加载缩略图"但实际无任何缩略图管线,L141-149 走 ensureImageCached 加载全尺寸图,这是 gallery 滚动即填满缓存的直接原因;且 taskRuntime 多处 setCachedImage 还会写入 mask/参考图 dataURL,进一步增加压力。4) clearImageCache 仅在数据导入时调用(exportImport.ts L123/275),正常浏览下缓存确实只增不缩。

### L4 · 导入 ZIP 解压炸弹:体积上限只卡压缩态(400MB),unzipSync 仍一次性把全部条目解压入内存

- **位置**:`src/lib/exportImport.ts:37`
- **维度/严重度**:安全 / low
- **问题**:注释自称该上限是为防 zip bomb,但 file.size 是【压缩后】字节数,而 fflate 的 unzipSync 把所有条目无上限地同步解压进内存。一个 400MB 全零/高重复的恶意 zip 解压比可达上千倍 → 解压出数百 GB,直接 OOM 让标签页/浏览器崩溃。触发条件:用户被诱导导入一个伪装成备份的恶意 ZIP(本地优先单用户场景,需社工)。可触发但需用户主动导入,属自伤型 DoS,故 low。真正的解压态/单条目上限缺失,现有防线卡错了维度。
- **证据**:

```
exportImport.ts:36 /** 导入 ZIP 文件总大小上限:unzipSync 会把全部条目一次性解压进内存,无上限时 zip bomb / 超大备份可 OOM。 */
const MAX_IMPORT_FILE_BYTES = 400 * 1024 * 1024
// importData: if (file.size > MAX_IMPORT_FILE_BYTES) throw ...(校验的是 file.size=压缩态)
const unzipped = unzipSync(new Uint8Array(buffer))
```

- **修复方向**:改为按解压态设限:遍历 unzipped 各条目累计 byteLength 超阈值即中止;或改用 fflate 的流式 unzip 逐条目计量并在累计超限时 abort,而非一次性 unzipSync 全量物化。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 两处细节修正:1) "无上限"略不精确——400MB 压缩态上限隐含约 412GB 的理论解压天花板(deflate 极限 ~1032:1),只是远超内存、实际等于无界,实质结论不变;且重叠条目型炸弹使远小于 400MB 的文件即可声明数 GB 解压量。2) "直接 OOM 崩溃"非必然:单条目超大分配失败抛 RangeError 会被 importData:387 的 catch 接住降级为错误 toast;需多个中等尺寸条目使分配逐次成功才达成不可捕获的 OOM,对攻击者无实质难度。行号无误差。

### L5 · CORS 代理对无 Origin 头的非浏览器客户端无条件转发 Authorization(凭据中继,无鉴权/限流)

- **位置**:`cors-proxy.conf:56`
- **维度/严重度**:安全 / low
- **问题**:评估任务点:代理是否把 Authorization 转发到任意主机(SSRF/中继)。结论——$upstream 是部署期写死常量(api.openai.com 等),proxy_pass $upstream$request_uri 永远只发往该固定上游,不存在请求可控的任意主机 SSRF,这点是安全的。但 $cors_deny 仅拦截「带 Origin 且不在白名单」的浏览器请求;无 Origin 头的客户端(curl/脚本/服务端)组合串为 ':' 不匹配 ^.+:$ → 0 → 放行,且 Authorization 原样透传到上游。即任何自带 key 的非浏览器调用方都能把本代理当作免鉴权/无限流的凭据中继到固定上游。该限制已在配置注释(L13-15)明确承认为本配置未覆盖范围,故为已知/低价值确认项;且不窃取受害者 key(中继方需自带 key),严重度 low。
- **证据**:

```
map "$http_origin:$cors_allow_origin" $cors_deny { default 0; "~^.+:$" 1; }
location / { if ($cors_deny) { return 403; } ... proxy_pass $upstream$request_uri; proxy_set_header Authorization $http_authorization; ... }
```

- **修复方向**:如对外暴露代理,补共享密钥头校验 + Referer/Origin 强校验(对无 Origin 的请求也默认拒绝或要求密钥)+ 限流;或仅在内网/同源反代后暴露。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 1) 行号:$cors_deny 的 map 在 cors-proxy.conf L24-27(server 块外),L56 是 location / 起始;evidence 其余部分(if return 403 / proxy_pass / Authorization 透传)在 L58-60/L74/L79,属可接受误差。2) isNew 应为 false:docs/code-review-2026-05-31.md L136(L2 · CORS 代理对非浏览器客户端仍是开放中继)已记录同一问题,docs/code-review-2026-05-29.md H3 为其前身;cors-proxy.conf L13-15 注释正是该轮整改后留下的已知限制声明。3) 影响面比描述略宽:非浏览器客户端无需省略 Origin,直接伪造白名单内 Origin(如 https://your-domain.com)同样通过 $cors_deny 门禁,即「无 Origin 放行」只是中继面的子集。4) 部署语境补充:Caddyfile L38-46 将 cors-proxy 以 cors.your-domain.com 公网暴露且无任何鉴权/限流,docker-compose 仅不直接暴露端口,故公网部署下中继面真实可达。

### L6 · 三处 chat 流式 API 在 !response.ok 分支先 clearTimeout+解绑取消监听再 await response.text(),错误体悬挂时请求永久卡死且无法取消

- **位置**:`src/lib/api/captionImageApi.ts:97`
- **维度/严重度**:API 层 / medium → low(核验修正)
- **问题**:理论上可能、触发条件明确:上游(反代/非标准网关)返回非 2xx 响应头后 body 走 chunked 且不关闭流时,response.text() 永不 resolve。此刻超时定时器已被 clear、externalSignal 的 abort 中继监听已被移除,fetch 用的是 timeoutController.signal——用户点取消(abort externalSignal)不再传导到该 signal,.catch(()=>'') 只兜 rejection 不兜悬挂,反推/优化弹窗将永远停在加载态。同一模式复制于 optimizePromptApi.ts L80-84 和 geminiChatShared.ts L134-138。对照:图像 API 路径在 timer 仍在挂的窗口内 await getApiErrorMessage(response)(openaiCompatibleImageApi.ts L261-262),超时仍可中止读取,证明本缺口是 chat 三处独有。
- **证据**:

```
if (!response.ok) {
  clearTimeout(timeoutTimer)
  externalSignal?.removeEventListener('abort', onExternalAbort)
  const text = await response.text().catch(() => '')
  throw new Error(`HTTP ${response.status}${text ? ` - ${text.slice(0, 300)}` : ''}`)
}
```

- **修复方向**:把 clearTimeout/removeEventListener 移到读取错误体之后(finally 收口),或读 text 前不解绑、用同一 signal 限时读取(如 Promise.race 一个短超时)。三处同步修。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 影响面两处需修正:1) "反推/优化弹窗将永远停在加载态"夸大——ImageCaptionModal/PromptOptimizerModal 的 handleClose 是纯 UI 状态重置,不依赖 Promise settle,用户随时可关闭弹窗并重新发起;实际后果是弹窗开着期间 spinner 永不结束、取消/关闭不再终止底层网络请求(连接泄漏),而非用户被永久困住。2) BatchCaptionModal 的 cancelAll(L112-121)直接把 pending/running 条目 UI 置为"已取消",单条目不会卡死;真实后果是 mapWithConcurrency 因悬挂 worker 永不 settle → running 标志永真、并发槽位泄漏,悬挂请求数达到 batchConcurrency 时剩余队列卡在"排队中…"直到用户 cancelAll/关闭。行号全部准确无需修正。严重度建议 medium→low:触发要求非 2xx 响应头 + 永不关闭的 chunked 错误体,正常上游不会出现,且各入口均有用户逃生路径。

### L7 · fetchImageUrlAsDataUrl 用 512MiB『总输入上限』当单图下载护栏,base64 转换三重字符串放大后峰值可达数 GB

- **位置**:`src/lib/api/imageApiShared.ts:164`
- **维度/严重度**:API 层 / low
- **问题**:理论上可能:仅当 Images 模式网关返回 url 形态结果且指向超大 image/* 响应时触发。注释自述目的是防内存暴涨,但选用的护栏是 512MiB 的『图像输入有效负载总大小』上限——对单张下载图过于宽松:400MiB blob 通过校验后,arrayBuffer(400MiB)+ binary UTF-16 串(~800MiB)+ btoa 输出串(~1.07GiB)+ dataUrl 拼接副本同时存活,峰值 2-3GiB,直接 OOM 崩标签页,护栏形同虚设。
- **证据**:

```
const blob = await response.blob()
// 上游...套用与入站一致的体积上限...避免把任意/超大响应体整块读入内存(arrayBuffer + binary 串 + btoa 三重放大)导致内存暴涨
assertImageInputPayloadSize(blob.size)  // 上限 MAX_IMAGE_INPUT_PAYLOAD_BYTES = 512 * 1024 * 1024
...
const bytes = new Uint8Array(await blob.arrayBuffer())
let binary = ''
for (let i = 0; i < bytes.length; i += 0x8000) { ... binary += String.fromCharCode(...chunk) }
return `data:${blob.type || fallbackMime};base64,${btoa(binary)}`
```

- **修复方向**:为 URL 下载单图设独立且现实的上限(如复用 MAX_MASK_EDIT_FILE_BYTES=50MiB 量级),并把 blobToDataUrl 换成 FileReader.readAsDataURL(浏览器原生编码,免去手工 binary 串与 btoa 的双重物化)。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 两处技术细节需修正:1) "binary UTF-16 串 ~800MiB"不准确——V8/SpiderMonkey/JSC 对全码元≤0xFF 的字符串用单字节(Latin-1)表示,binary 串约等于 blob 大小(1x 而非 2x);2) "400MiB→峰值 2-3GiB 直接 OOM"高估且该上界走不到——V8 字符串最大长度约 2^29-24≈5.37 亿字符,blob>~384MiB 时 base64 输出超限,btoa 处抛 RangeError(任务报错而非崩标签页)。真实危害窗口是几十 MiB~约 384MiB 的 blob:转换成功,瞬时峰值约 3-4 倍(300MiB blob≈1.2-1.5GiB),且转换循环同步占主线程,移动端/内存受限设备可崩标签页,桌面端长时间卡死——与注释自述要防的"页面卡死"吻合。修复建议(独立单图下载上限+FileReader.readAsDataURL)方向正确;补充:FileReader 仍会物化最终 data URL 串,需配合收紧上限一起用。

### L8 · buildGeminiUrl 不剥离模型名的 models/ 前缀,粘贴官方全限定模型名(models/xxx)生成 /models/models/ 路径 404

- **位置**:`src/lib/api/geminiImageApi.ts:99`
- **维度/严重度**:API 层 / low
- **问题**:确认可触发:Gemini 官方 ListModels 返回值与文档均使用全限定名 `models/gemini-2.5-flash-image`,用户照抄填入模型 ID 后,URL 变成 .../v1beta/models/models/gemini-2.5-flash-image:generateContent,稳定 404,错误信息(getApiErrorMessage 提取的 Google NOT_FOUND 文案)不易让用户意识到是前缀重复。geminiChatShared.buildGeminiStreamUrl(L44-46)同样未剥离。
- **证据**:

```
const cleanModel = model.trim().replace(/^\/+/, '').replace(/\/+$/, '')
return `${cleanBase}/models/${cleanModel}:generateContent`
```

- **修复方向**:cleanModel 追加 .replace(/^models\//, '')(两处同步),或在校验层提示;成本极低。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 两点小修正:1) "官方文档均使用全限定名"过强——Gemini REST 文档 URL 示例多为裸名,全限定名主要来自 ListModels 响应的 name 字段(models/gemini-2.5-flash-image),"照抄 ListModels/SDK 文档"场景仍成立;2) 补充触发面限定:应用自身的 listModels.ts 只服务 OpenAI profile,Gemini 模型字段无拉取按钮(ApiProfileSection.tsx L249 showFetchButton 仅 openai),前缀只能经用户手动粘贴进入,应用不会自动写入带前缀模型名——属用户配置错误类问题,low 严重度恰当。

### L9 · listModels 无超时、无 AbortSignal,网关悬挂时模型列表 UI 永久停留加载态

- **位置**:`src/lib/api/listModels.ts:14`
- **维度/严重度**:API 层 / low
- **问题**:确认可触发:profile.timeout 字段存在却未被使用,fetch 不带 signal。非标准网关 /v1/models 悬挂(或返回错误头后停住 body,res.text() 同样无界)时,useModelList/ApiProfileSection/Captioner/Optimizer 四处调用方的 loading 态永不结束,且没有任何取消手段;与图像/chat 路径全部有超时控制形成缺口。维度里『timeout 与 abort 的衔接缺口』在此是整体缺失。
- **证据**:

```
const res = await fetch(url, { method: 'GET', headers, cache: 'no-store' })
if (!res.ok) {
  const text = await res.text().catch(() => '')
```

- **修复方向**:listModels 内加 AbortController + setTimeout(profile.timeout 或固定 15-30s)并把 signal 传给 fetch,超时映射为可读错误。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 「永久停留加载态」略有夸大:纯悬挂连接会被浏览器网络层停滞超时兜底(Chrome 约 300s 后 reject),并非字面永久;但 evidence 中 res.text()/res.json() 的慢滴流场景(headers 已返回、body 停滞或滴流)可规避浏览器超时而近乎无限期挂起。准确表述应为「数分钟级直至浏览器自身网络超时,慢滴流响应下可无限期」。另一细节:useModelList 中切换 active profile 会触发 useEffect 重跑使 UI 状态脱离 loading(有缓存/idle 分支),故「四处调用方 loading 永不结束」对 useModelList 仅在停留于同一 profile 时严格成立;三个 Settings section 则确实只能等 promise settle。行号、timeout 字段未用、与图像/chat 路径的缺口对比均无需修正。

### L10 · ImageGrid 触摸拖拽中断后 suppressImageClickRef 永久卡 true,所有参考图缩略图点击失效(移动端)

- **位置**:`src/components/InputBar/ImageGrid.tsx:82`
- **维度/严重度**:React 性能与正确性 / medium → low(核验修正)
- **问题**:确认可触发(代码路径完整):移动端按住缩略图轻微拖动后原地松手——setImageDragTarget L123-124 把落回自身判为 noop 置 overIndex=null,touchend 走不进重置分支,resetImageDrag 又不清该 ref → suppressImageClickRef 永久为 true。此后点击任何参考图(打开 Lightbox / 进遮罩编辑)全部静默无响应,只有完成一次成功拖放或 touchcancel 才能恢复。
- **证据**:

```
L193 (handleTouchMove): `suppressImageClickRef.current = true`。L201-212 (handleTouchEnd): 只有 `if (touchDrag.index !== null && imageDragOverIndexRef.current !== null)` 成立(成功落点)才 `window.setTimeout(() => { suppressImageClickRef.current = false }, 0)`。L82-92 resetImageDrag():重置了 drag 各 ref/state 但没有重置 suppressImageClickRef。L220-221 handleClickImage: `if (suppressImageClickRef.current) return`。
```

- **修复方向**:在 resetImageDrag() 里统一 `setTimeout(() => { suppressImageClickRef.current = false }, 0)`(或 touchend 无论是否落点成功都重置),保证每次手势结束后点击恢复。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 1) 影响面修正:"点击任何参考图(打开 Lightbox/进遮罩编辑)全部静默无响应"过宽——ImageThumb.tsx L109-122 的隐形编辑遮罩按钮(opacity-0、inset-0、z-20,opacity 不影响命中测试)在 canEdit 时截获全部点击并 stopPropagation 直调 onEditMask,不经过 suppress 门控;故无遮罩时移动端点击缩略图仍有响应(进遮罩编辑),Lightbox 路径本就不可达。实际失效面仅为:存在遮罩主图时的非遮罩参考图(canEdit=false 无覆盖按钮),其 Lightbox 与冲突 toast 被卡死。2) "永久卡死"修正:除成功拖放/touchcancel 外,ImageGrid 随 inputImages 清空而卸载(index.tsx L377)或页面刷新都会复位 ref。3) 严重度由 medium 降为 low(移动端+需遮罩主图在场+有多条恢复路径)。行号引用全部准确,无需修正。

### L11 · 移动端 InputBar 折叠把手 touchend 与 onClick 双重切换,单次轻点可能净效果为零

- **位置**:`src/components/InputBar/hooks/useMobileGestures.ts:33`
- **维度/严重度**:React 性能与正确性 / low
- **问题**:理论上大概率可触发,需真机/Playwright touch 复核:触屏轻点把手时 touchend 先切换一次,浏览器随后合成的 click(无 preventDefault 不会被抑制)再切换一次,净效果为零或产生展开→收起的闪烁;唯一缓解是折叠动画导致 click 合成时刻命中点已不在把手上(取决于布局移动速度,不可靠)。纯鼠标窄窗口只走 click,正常。
- **证据**:

```
useMobileGestures.ts L33-37:
    const onTouchEnd = () => {
      if (!dragTouchRef.current.moved) {
        setMobileCollapsed((v) => !v)
      }
    }
同一元素在 InputBar/index.tsx L357-361 又绑定:
  <div ref={handleRef} className="sm:hidden ... touch-none" onClick={() => setMobileCollapsed((v) => !v)}>
touchend 内未调用 e.preventDefault() 抑制后续合成 click。
```

- **修复方向**:在 onTouchEnd 中 e.preventDefault()(需以非 passive 注册)抑制合成 click;或删掉 div 的 onClick,统一由 pointer 事件处理。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 1) 行为比发现描述的更确定:不是"理论上大概率",而是可确定性复现——用 Playwright 真实 Chrome(hasTouch+isMobile)对真实应用实测,展开态下连续 4 次轻点把手,document 级 capture 均记录到 touchend 命中把手后 3-4ms 合成 click 再次命中同一把手元素,折叠状态净变化为零;"折叠动画使 click 错过把手"的缓解在收起方向不成立(250ms transition 在 3-4ms 内位移≈0)。2) 存在方向不对称:从折叠态轻点展开时,实测一次合成 click 未落在把手上,展开成功;因此主要用户症状是"展开状态下轻点无法收起输入栏"(把手的主用途),而非双向闪烁。下拉 >30px 的拖动手势(onTouchMove dy>30 路径)仍可收起,故 low 严重度恰当。3) fix 描述小修正:touchend 监听(useMobileGestures.ts L40)未传 options,touchend 默认即非 passive(passive-by-default 仅适用于 touchstart/touchmove),直接在 onTouchEnd 里 e.preventDefault() 即可生效,无需改注册方式;另 onTouchEnd 需补 (e: TouchEvent) 参数。4) 闪烁基本不可见:click 距 touchend 仅 3-4ms,两次切换通常落在同一/相邻帧内,表现为"轻点无效"而非可见闪烁。

### L12 · AppSettings 同一份配置三处表达(顶层镜像/profiles/派生镜像),getActiveApiProfile 还让顶层字段反向覆盖 profile,与类型注释口径矛盾

- **位置**:`src/lib/api/apiProfiles.ts:420`
- **维度/严重度**:代码健康 / low
- **问题**:理论上可能(不变量当前由 normalizeSettings 全链路维持)。AppSettings 把同一配置写三遍:顶层 legacy 镜像(baseUrl/apiKey/model/timeout/apiMode/codexCli/apiProxy)、profiles 数组、promptOptimizer/captioner 派生镜像。类型注释说『实际请求以 active profile 为准』,但 getActiveApiProfile 实现是顶层字段存在即覆盖 profile——语义恰好相反;一旦某条路径漏跑 normalizeSettings(目前靠 settings slice 的 setSettings 里 hasLegacyOverrides 七字段比对 + 二次 normalize 这种高复杂度代码维持),请求会静默用上镜像旧值。这正是 settings.ts L17-53 那段难以审读的合并逻辑的根因。
- **证据**:

```
// types.ts L71: /** 旧版单配置字段：保留用于导入/查询参数兼容，实际请求以 active profile 为准 */
// 但 getActiveApiProfile 中顶层字段优先于 profile:
  const baseOverrides = {
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : profile.baseUrl,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : profile.apiKey,
    model: typeof record.model === 'string' && record.model.trim() ? record.model : profile.model,
```

- **修复方向**:方向:顶层镜像降级为只读派生(类型上拆 ReadonlyMirror 或干脆从 AppSettings 移除、导入/URL 参数路径单独翻译进 profile patch),getActiveApiProfile 删除 override 分支,使『以 active profile 为准』成为类型层事实。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 三点修正/补充:1) 当前调用图下 override 分支实际从不以分歧值触发——所有 6 处调用方(taskRuntime L72/587/690/783/855/1092、paramCompatibility L12、api/index L10、Header L65、SettingsModal、PillRow L95)传入的都是 normalize 过的店内 settings 或草稿;即使直接传 legacy-only 对象也安全(normalizeSettings 用同一顶层字段建 profile,覆盖为恒等)。唯一分歧场景是输入同时带 profiles 数组和不同的顶层值,现无任何路径产生。故这是维护性/潜在风险发现,不是现行行为 bug。2) evidence 只引了 baseUrl/apiKey/model 三字段,实际 override 还含 timeout(L423-424)及 OpenAI 分支的 apiMode/codexCli/apiProxy(L431-434),矛盾面更宽。3) override 分支系 initial commit 继承的历史代码,getActiveApiProfile 全仓库无任何测试覆盖,不存在『有意设计』的文档/测试佐证——发现把它判为口径矛盾而非取舍是对的。

### L13 · 死代码与转换函数重复:ImageGenerationRequest 导出无人引用;blob/file→dataUrl 三份实现 + copyBytesToArrayBuffer 两份拷贝

- **位置**:`src/types.ts:250`
- **维度/严重度**:代码健康 / low
- **问题**:确认存在。ImageGenerationRequest 是构建 OpenAI Images 请求体的早期类型,实际请求体在 openaiCompatibleImageApi 内用 FormData/inline 对象构造,该接口已成纯死代码。blob→dataUrl 路径有 3 个同名函数、2 种实现策略(手写 btoa 分块 vs FileReader),再加 4 处组件内联 FileReader——base64 处理是这类应用的高频 bug 区(大文件栈溢出/编码差异),7 处实现意味着修一处漏六处。eslint 已将 no-explicit-any 降 warn,这类健康度问题不会被 CI 拦截,只能靠清理。
- **证据**:

```
export interface ImageGenerationRequest {  // 全项目 grep 仅此定义处一次命中,无任何 import
  model: string
  prompt: string
...
// blob→dataUrl 三份实现:db.ts L336 blobToDataUrl(手写分块 btoa)、imageApiShared.ts L137 blobToDataUrl(同款手写分块 btoa)、taskRuntime.ts L1298 blobToDataUrl(FileReader);
// 另有 4 处组件内联 new FileReader().readAsDataURL(maskPreprocess.ts:27 / ImageContextMenu.tsx:156 / InputBar/index.tsx:216 / MaskEditorModal/index.tsx:23);
// copyBytesToArrayBuffer 在 db.ts L291 与 exportImport.ts L60 逐字符相同
```

- **修复方向**:删除 ImageGenerationRequest;以 db.ts 的 blobToDataUrl/bytesToBase64 为唯一实现(或挪到 lib/image 下),taskRuntime 与 4 处组件内联改为 import,exportImport 复用 db.ts 的 copyBytesToArrayBuffer(导出之)。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 三处细节修正:(1) "4 处组件内联 FileReader"中,maskPreprocess.ts:25 与 MaskEditorModal/index.tsx:21 实为局部命名 blobToDataUrl 函数(非裸内联),且 maskPreprocess.ts 位于 src/lib/image/ 属 lib 而非组件;真正内联的只有 ImageContextMenu.tsx:155-160 与 InputBar/index.tsx:215-220 两处。(2) 漏算一处:taskRuntime.ts:1289 还有 fileToDataUrl(FileReader 实现),与同文件 1298 行 blobToDataUrl 重复,blob/file→dataUrl 实际共 8 处实现而非 7 处。(3) imageApiShared.ts 的 blobToDataUrl 在 137 行(发现称 L137 准确),但它内联了分块逻辑而非调用 bytesToBase64——与 db.ts 是"同策略不同代码体",非逐字符相同;逐字符相同的只有 copyBytesToArrayBuffer 那对。

### L14 · public/sw.js 被 eslint 显式 ignore 且零测试——部署链风险最高的文件(kill-switch/缓存契约)没有任何静态检查与单测

- **位置**:`eslint.config.js:9`
- **维度/严重度**:构建部署 / low
- **问题**:sw.js 承载 kill-switch 逃生通道与整套缓存契约(注释自述『部署翻车时把用户锁死』的唯一救济),但它既在 eslint ignores 里(连 no-undef/未用变量都不查),也不在 441 个测试覆盖内——对照组:scripts/ 下两个构建脚本(inject-sw-build-id/verify-csp-hash)反而都有 .test.mjs。SW 逻辑(KILL_SWITCH 分支的 claim/unregister/navigate 序列、navigate 网络失败兜底、runtime 缓存条件)全部是纯事件处理函数,完全可以仿照 scripts 的做法抽出可测纯函数或用 mock 事件对象做单测。理论风险:下次改 SW(比如修上面的部分缓存问题)时没有任何安全网,而 SW 的错误恰恰是『部署后才发现、且会把用户锁在旧版本』的一类。
- **证据**:

```
{ ignores: ['dist', 'node_modules', 'public/sw.js'] },
```

- **修复方向**:eslint ignores 移除 public/sw.js,为其加 serviceworker globals 的 override 配置;把 fetch 路由决策(shouldCacheResponse/route 判定)抽成可单测函数,或用注入 self mock 的方式给 install/activate/fetch 三个 handler 写最小单测。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 三处细节修正:(1) ignores 行不是唯一闸门——package.json:13 lint 脚本是 `eslint src`(public/ 本就不在扫描范围),且唯一 rules 块 files: ['**/*.{ts,tsx}'] 不匹配 .js 文件;单纯从 ignores 移除 public/sw.js 不会启用任何检查,必须新增带 serviceworker globals + js recommended 的专门 override 块(fix 文本已含此点,但 evidence 归因过重压在第 9 行)。(2) src/main.tsx:15 以 classic script 注册 SW(无 {type:'module'}),public/ 文件不经打包直拷,sw.js 不能直接用 export——『抽可导出纯函数』需迁移 module SW 或走 fix 中第二方案(mock self 注入的测试 harness)。(3) sw.js 的构建期契约(占位符存在/替换)实际有测试覆盖(inject-sw-build-id.test.mjs);未覆盖的精确表述应为『运行时事件处理逻辑(install/activate/fetch、kill-switch 分支)』。

### L15 · 对已知问题 #7 的修正与深化:taskRuntime 并发/取消/watchdog 其实有测试(store.test.ts);真实缺口是 DOM 渲染层——项目根本没装任何 DOM 测试环境

- **位置**:`src/store.test.ts:990`
- **维度/严重度**:构建部署 / low(已知问题深化)
- **问题**:上一轮清单把『taskRuntime 并发/取消』列为高风险无测试路径——经核实不准确:store.test.ts(1208 行)有专门的 B3 取消/并发套件、watchdog 中止与计时起点、入口守卫、TOCTOU guard 等用例。真正的结构性缺口在另一处:devDependencies 里没有任何 DOM 实现(jsdom/happy-dom)和 @testing-library,vitest 跑在 node 环境(配 fake-indexeddb),所以 4 个『组件测试』全是 .ts 纯逻辑文件——ErrorBoundary.test.ts 只测 computeRetryState/hashString 纯函数,componentDidCatch→重试按钮→recoverConfirmed 的真实 React 边界行为、58 个组件(DetailModal 801 行/SettingsModal 712 行/TaskCard 593 行)的渲染路径在现有工具链下不可测,这是『组件零渲染测试』的根因而非单纯没写。
- **证据**:

```
describe('batch concurrency & cancellation (B3)', () => { ...
(L308) it('aborts the in-flight API request when the task watchdog times out', async () => {
(L374) it('watchdog times from request start, not createdAt ...', () => {
(L1097) it('a queued member cancelled before dispatch never fires its request (executeTask 入口守卫)', async () => {
(L1133) it('cancelBatch aborts in-flight members and skips queued ones, reporting counts', async () => {
—— 而 package.json devDependencies 不含 jsdom / happy-dom / @testing-library/*。
```

- **修复方向**:引入 happy-dom(或 jsdom)+ @testing-library/react,在新建的 vitest.config.ts 里按 glob 分环境(lib 用 node,components 用 DOM);优先给 ErrorBoundary 边界行为与 DetailModal/TaskCard 的关键交互补冒烟级渲染测试。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 两处极小的精度修正:1) fake-indexeddb 不是通过 vitest 配置/全局 setup 注入,而是 db.test.ts 逐文件 `import 'fake-indexeddb/auto'`(项目根本没有 vitest.config.ts,vite.config.ts 也无 test 块,故 vitest 走默认 node 环境——这反而加强了发现的结论);2) "在现有工具链下不可测"略绝对——node 环境下用 react-dom/server renderToString 可做零依赖的渲染冒烟,但 componentDidCatch→点击重试→recoverConfirmed 这类交互行为确实必须 DOM+testing-library,对"有意义的组件测试"而言表述成立。另:发现引用的"上一轮清单把 taskRuntime 列为高风险无测试"属于工作流内部上下文,无法从仓库独立核实,但本条所修正的事实本身全部准确。

### L16 · Docker 构建排除 .git,CACHE_NAME 恒为 nogit-<timestamp>,与 README『自动注入 commit hash 作 CACHE_NAME』不符

- **位置**:`.dockerignore:6`
- **维度/严重度**:构建部署 / low
- **问题**:确认可触发:Dockerfile 在容器内执行 npm run build,而 .dockerignore 排除了 .git,readGitShortHash() 的 execSync('git rev-parse') 必然失败返回 null → 所有 Docker 部署的 CACHE_NAME 都是 image-playground-nogit-<timestamp>。功能上无碍(timestamp 保证每次构建唯一,缓存照常失效——这点设计是稳的),但与 README 的描述不符,且排障时丢失『线上 SW 对应哪个 commit』的关键可观测性:Docker 用户报 SW 问题时无法从 CACHE_NAME 反查版本,kill-switch 操作前的版本确认要靠猜。
- **证据**:

```
# git / 编辑器 / 工具元数据
.git
(scripts/inject-sw-build-id.mjs L23: const hash = gitHash && /^[0-9a-f]{4,40}$/i.test(gitHash) ? gitHash : 'nogit')
(README L99: "Service Worker 自动注入 commit hash 作 CACHE_NAME，每次部署旧缓存自然失效")
```

- **修复方向**:Dockerfile 加 ARG GIT_COMMIT,docker-compose build args 传 git rev-parse --short HEAD,inject 脚本优先读 process.env.GIT_COMMIT 再回退 git 命令;或至少修正 README 注明 Docker 路径为 nogit+时间戳。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 两处修正:1) isNew=true 不成立——docs/code-review-2026-05-31.md:155 的 L15 条目已记录完全相同的发现(.dockerignore:6 + inject-sw-build-id.mjs:12-25 + nogit 退化),这是历史已知问题的重复发现;2) 根因表述不完整——除 .git 被排除外,基础镜像 node:20-alpine 本身不含 git 二进制(Dockerfile 未 apk add git),即使从 .dockerignore 放行 .git 仍会得到 nogit;两个根因独立致命,故标题把因果单独归于 .dockerignore 偏窄,但结论(Docker 部署 CACHE_NAME 恒为 image-playground-nogit-<timestamp>)完全正确,且其建议的 ARG GIT_COMMIT + 脚本优先读 env 的修法恰好同时绕过两个根因,是正确方案(与 2026-05-31 review 的建议一致)。另注:README 描述对 Cloudflare Workers/本地 wrangler 构建路径是准确的,不符仅限 Docker 路径——发现原文已如此限定,无需修正。

### L17 · i18n 债量化:约 930 行非注释中文硬编码散布 118 个文件,无任何 i18n 基础设施

- **位置**:`src/components/DetailModal.tsx:1`
- **维度/严重度**:UX·a11y / low
- **问题**:理论债务而非缺陷:当前 zh-CN 单语言自洽(html lang 正确,读屏发音无错配)。但文案与逻辑深度耦合——错误拼接(`导出失败：${e.message}`)、ConfirmDialog 靠 title.includes('删除') 推断 danger 色(ConfirmDialog.tsx:56,文案即逻辑),以及 lib 层 231 行 toast/错误文案,意味着未来国际化需要动 118 个文件且有行为耦合点,改造成本随每个新功能持续上升。
- **证据**:

```
统计(grep -P CJK,剔除注释行):components/*.tsx 701 行、lib/*.ts 231 行,含中文的非测试源文件 118 个;Top: DetailModal.tsx 56 行、SettingsModal/index.tsx 49、PillRow.tsx 42、ErrorBoundary.tsx 39、SnippetPopover.tsx 30、TaskGridMatrix.tsx 29。无 useTranslation/i18n 依赖;index.html lang="zh-CN"(与内容一致,无 lang 错配问题)
```

- **修复方向**:若有国际化计划,先做两件低成本止血:① 新代码文案集中到 src/lib/messages.ts 常量表;② 消除「文案即逻辑」(ConfirmDialog 的 tone 全部显式传参,弃用 title.includes 推断)。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 细节修正:① components 非注释 CJK 行实测 713(声称 701),合计约 944 行(声称约 930);含中文非测试文件 119 个(声称 118)——偏差 <2%,属统计口径差异,不影响结论。② ConfirmDialog.tsx:57 已存在显式 tone 可选参数(`confirmDialog.tone ?? ...`),且 13 处调用点已显式传 tone;title.includes('删除'/'清空') 仅是回退路径——但该回退确实被 DetailModal.tsx:219、TaskGrid.tsx:227、SettingsModal/index.tsx:577/607/634 等至少 5 处不传 tone 的调用点实际依赖(决定 danger 红色按钮 + 「确认删除」confirmText),「文案即逻辑」耦合为活跃行为而非死代码。③ 推断条件除「删除」还含「清空」,发现只提了「删除」。

### L18 · iOS Safari 无差异化处理:manifest 已配 standalone PWA,但全库无『添加到主屏幕』检测与引导——iOS 上这是唯一可靠的防 ITP 驱逐手段

- **位置**:`public/manifest.webmanifest:7`
- **维度/严重度**:盲区补查 / low
- **问题**:grep src 对 standalone/beforeinstallprompt/A2HS/添加到主屏幕 零匹配。iOS Safari 上 navigator.storage.persist 旧版本不存在、新版本对普通站点也基本拒绝,唯一豁免 7 天 ITP 清库的方式是添加到主屏幕(home screen web app);项目已具备完整 PWA 基建(manifest+sw.js)却不检测 display-mode、不向 iOS 浏览器标签页用户做任何安装引导。触发条件:iPhone/iPad 用户在 Safari 标签页内使用、连续 7 天未访问,整库清空
- **证据**:

```
"display": "standalone",
```

- **修复方向**:用 matchMedia('(display-mode: standalone)') 与 UA 检测 iOS 非 standalone 场景,在数据管理区(配合发现 2 的驱逐提示)或首启提示『添加到主屏幕以防数据被 Safari 自动清除』;成本低且只对受影响平台展示
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 两处细节修正:1) 触发条件应为「7 天 Safari 使用期间未与该站点交互」(WebKit 按 Safari 使用天数计,非自然日;用户完全不开 Safari 则计数不前进),而非字面的「连续 7 天未访问」。2) 缺口比描述更宽:全库从未调用 navigator.storage.persist()(仅 storageStats.ts:78 用 estimate() 做配额展示),即 Chromium 系浏览器上也没有请求持久化存储——iOS A2HS 引导只是其中影响最大的一环,修复时可顺带补 persist() 调用。另注:Safari 15.2+ 已暴露 persist() API,「旧版本不存在」仅对 <15.2 成立,但 persist() 不豁免 7 天 ITP 清除这一核心论断与 WebKit 公开文档一致。

### L19 · SW 注册端零更新生命周期处理:skipWaiting+claim 静默接管长驻页面,无提示、无受控 reload,版本撕裂无人协调

- **位置**:`src/main.tsx:15`
- **维度/严重度**:盲区补查 / medium → low(核验修正)
- **问题**:每次部署 CACHE_NAME 必变(inject-sw-build-id.mjs),新 SW 安装完成即 skipWaiting+claim 立刻接管所有长驻标签页/standalone 窗口(manifest display:standalone),同时删光旧缓存——而页面侧对这次接管完全无感:旧 JS 继续运行,与新部署的 Worker 后端、新数据 schema 的兼容性无任何保证;也因为 skipWaiting,新 SW 永不停留在 waiting,业界标准的『waiting→toast 提示刷新』模式在当前架构下根本无法触发。组合效应『旧页面 lazy-load 旧 hashed asset→404 白屏』当前不可达(已核实:src 无动态 import、vite 无 manualChunks,单 entry chunk,旧页面运行期不再请求 hashed asset),但任何人引入 React.lazy/import() 的那一刻,叠加 activate 删旧缓存 + 部署平台不保留旧 asset,就变成『每次部署=长驻页面分包加载即白屏』且无护栏报警。触发条件:每次部署 + 存在长驻页面,窗口期内必然发生版本撕裂。
- **证据**:

```
navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => { console.error('Service worker registration failed:', error) })  ←—— register 即弃;全 src grep 'controllerchange|updatefound|registration\.update' 零命中。对应 public/sw.js L40 self.skipWaiting() + L49 self.clients.claim() + L43-50 activate 时 caches.keys().filter(key !== CACHE_NAME).map(caches.delete)
```

- **修复方向**:二选一:(a) 保留 skipWaiting,main.tsx 监听 navigator.serviceWorker.addEventListener('controllerchange'),仅当此前已存在 navigator.serviceWorker.controller 时(排除首次安装 claim 误伤)用现成 toast(src/store/slices/ui.ts showToast)提示后受控 location.reload(),并加 once 防循环;(b) 去掉 sw.js 的 skipWaiting,注册端监听 registration.updatefound→installing.statechange==='installed' 且有 controller 时 toast『新版本可用』,用户确认后 postMessage SKIP_WAITING + controllerchange reload。方案 (a) 改动最小且同时为未来 code splitting 提供护栏。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 1) 严重度应降为 low:发现唯一具体故障路径(lazy-load 旧 hashed asset→404 白屏)其自述且经核实当前不可达(无动态 import/无 manualChunks/无静态资源 import/单 chunk);新 SW 接管后旧页面运行期不再发起任何同源 hashed-asset 请求(生成图为 IndexedDB blob: URL 不经 SW fetch,字体走跨域 CDN,API 跨域或非 GET),activate 删旧缓存对长驻页面今日实际无害。2) 「与新部署的 Worker 后端、新数据 schema 的兼容性」被夸大:项目无自有后端 API 契约(数据全本地,后端为用户自配第三方 AI API);「旧 JS 继续运行直到刷新」在无 SW 的普通网站同样存在,非 skipWaiting+claim 引入。3) 「安装完成即立刻接管所有长驻标签页」「窗口期内必然发生」措辞过强:长驻空闲标签页需等浏览器更新检查(scope 内导航或约 24h 周期检查)才会发现新 SW,接管非部署即时。4) 部分属已记录的设计取舍:README L99 与 sw.js L61-62 注释明确将「CACHE_NAME 每部署轮换 + HTML network-first 防白屏 + kill-switch」作为稳定性设计;但「放弃更新提示/静默接管」本身无任何注释或文档佐证为有意取舍,结构性缺口成立。5) 修复方案 (a) 需加约束:本应用在页面内跑长时批量生成任务(taskRuntime),controllerchange 后绝不能自动 reload,只能 toast 由用户确认后再 reload,否则会杀死进行中的批量任务。

### L20 · 从不主动 registration.update():standalone 长驻窗口的 SW 更新检查依赖 24h 节流的 soft update,kill-switch 逃生通道最坏 24h+ 乃至无限期不可达

- **位置**:`src/main.tsx:14`
- **维度/严重度**:盲区补查 / medium → low(核验修正)
- **问题**:浏览器对 sw.js 的更新检查仅在三种时机发生:scope 内导航、registration.update()、functional event(如 fetch)时距上次检查 >24h 的 soft update。本应用是无路由 SPA(无 react-router)+ manifest standalone 模式,窗口一旦打开就不再产生导航事件;静态资源启动时一次性加载完,此后只有 API/图片请求经过 SW fetch 事件,而 soft update 被规范的 86400 秒节流约束,窗口完全空闲时则永不检查。sw.js 注释自述 kill-switch 依赖『下次访问』,但部署事故场景下最需要救的恰是『被旧 SW 锁死、不会主动刷新』的长驻用户——逃生信号(新 sw.js 字节)在这部分用户上最坏延迟 24h+,空闲窗口无限期。普通版本更新同样受此延迟。触发条件:启用 kill-switch(或任何部署)+ 用户侧 standalone/长驻窗口不刷新不重开。
- **证据**:

```
window.addEventListener('load', () => { navigator.serviceWorker.register(...).catch(...) })  ←—— registration 引用未保存,全项目无 registration.update()、无 visibilitychange/定时器触发更新检查;public/sw.js L8-11 注释:『kill-switch 是单向逃生通道:部署翻车(旧 SW 把用户锁死)时把下方常量改成 true 部署一次,已注册旧 SW 的浏览器在下次访问时会自动 unregister』
```

- **修复方向**:main.tsx 保存 register() 返回的 registration,监听 document.visibilitychange,在变为 visible 时调用 registration.update()(可加 30-60 分钟节流避免每次切窗都打更新请求);如需更强保证可叠加 setInterval(update, 6h) 兜底。该改动同时缩短 kill-switch 和正常版本的触达延迟,与发现 1 的 controllerchange 受控 reload 配套后形成完整更新闭环。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 三点修正:(1) "kill-switch 最坏无限期不可达"夸大了影响面——kill-switch 的主救援场景(用户被翻车部署锁死后刷新/重开)不受影响:reload 即导航 + register(),立即触发 update 检查,且 /sw.js 全部署链路均为 no-cache(README L191、_headers/nginx M11 修复),"下次访问"路径即时生效;真正的残余缺口只有"窗口长驻、应用半残但用户始终不刷新"这一窄场景。(2) "空闲窗口无限期"技术上成立但语义上需限定:活跃长驻窗口的 API/图片请求会经过 SW fetch handler(handler 对跨源请求同样先触发 functional event 再早返回),按规范 registration 过期(>86400s)即调度 Soft Update,活跃用户最坏 ~24h 而非无限;无限期仅限零 fetch 的纯空闲窗口,而该窗口内本无活动可被伤害,用户回来后首个请求即恢复过期检查。(3) sw.js L8-11 注释与 no-cache 基建表明作者有意把 kill-switch 设计为"下次访问"语义,本发现属可低成本补强的健壮性改进(visibilitychange + 节流 update() 是 PWA 标准实践),而非已实现行为的缺陷,severity 应从 medium 降为 low。行号与代码引用全部准确(main.tsx L14-18、sw.js L8-11)。

### L21 · 触屏下第二根手指可在笔画进行中点击工具栏 撤销/清空/保存,撤销会弹掉本笔画的起始快照导致历史错位

- **位置**:`src/components/MaskEditorModal/BrushToolbar.tsx:85`
- **维度/严重度**:盲区补查 / low
- **问题**:pointer capture 只拦截 canvas 上的指针,工具栏按钮可被第二根手指独立点击。手指 A 正在涂抹(笔画起始快照已入栈)时手指 B 点撤销:undo 弹出并恢复的是本笔画的起始快照——已画的半截笔画消失但 activePointerIdRef/lastPointRef 仍有效,手指 A 继续移动会在恢复后的画布上接着画;且该起始快照被消耗,后续撤销会跳过一个状态,redo 栈混入半截笔画状态,历史链错位。同理手指 B 可在笔画中途点保存:保存半成品遮罩并 setMaskEditorImageId(null) 直接关闭编辑器。触发需要双手触屏操作,概率低但完全可达,与 ImageGrid 触摸中断 bug 同属多点触控路径盲区。
- **证据**:

```
BrushToolbar.tsx:85 `<button onClick={onUndo} disabled={!canUndo} ...>`(无 active-stroke 守卫);index.tsx:218 `const canUndo = history.canUndo && isReady && !isSaving`(笔画进行中为 true,因为 usePointerInteraction.ts:247-248 在 pointerdown 时已 `activePointerIdRef.current = event.pointerId; history.pushSnapshot()`);useMaskHistory.ts:70 undo 直接 `undoStackRef.current.pop()`
```

- **修复方向**:在 handleUndo/handleRedo/handleClear/handleSave 入口(或 canUndo/canRedo/按钮 disabled 计算)增加 activePointerIdRef.current == null 守卫,可由 usePointerInteraction 暴露 isStrokeActive;或在这些操作前先调用 finishStroke 语义收尾当前笔画。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 三处细节修正:(1) usePointerInteraction.ts 与 useMaskHistory.ts 实际位于 src/components/MaskEditorModal/hooks/ 子目录,发现引用路径漏了 hooks/(行号 247-248、70 均准确);(2) "保存"按钮不在 BrushToolbar 工具栏内,而在 modal 头部 index.tsx:315,同样仅有 disabled={!isReady || isSaving} 无 active-stroke 守卫,结论不变;且 setIsSaving(true) 后 handlePointerMove:284 的 isSaving 守卫会停止手指 A 后续绘制,保存捕获的是点击瞬间的半截笔画;(3) 清空(handleClear→history.clear)路径危害比描述的轻:clear 内部先 pushSnapshot 再填白,历史链不丢条目,只是手指 A 会继续在清空后画布上作画且 redo 被清——主要危害集中在 undo 路径。

### L22 · 手势状态机(usePointerInteraction/useCanvasViewport/useMaskCanvasInit)零单测;同时澄清:上游怀疑的「缺 onPointerCancel 导致幽灵指针」经核实不成立

- **位置**:`src/components/MaskEditorModal/CanvasViewport.tsx:77`
- **维度/严重度**:盲区补查 / low(已知问题深化)
- **问题**:核实结论:pointercancel 与 lostpointercapture 均已路由到 finishStroke(usePointerInteraction.ts:309-330),会释放捕获、从 pointerPositionsRef 删除指针、清理 pinch/pan/stroke 瞬态,触摸被系统中断不会残留幽灵指针——上游基于 usePointerInteraction.ts:353-359 handlers 对象字段推断的 bug 在绑定处已被覆盖,不应据此改代码。我还人工核验了 finishStroke 对 up+lostpointercapture 双触发的幂等性、笔画→捏合升级时 cancelActiveStroke 的快照回滚(handlePointerDown:241-244 + useMaskHistory:100-104)、三指减一指的 beginPinchGesture 重锚定,均正确。但这套多指状态机(下→捏合→抬起→再触摸的状态迁移、快照回滚配对)全靠人工走查,无任何回归防护,未来改动极易引入真 bug——本次上游误报本身就说明其行为难以静态推断。
- **证据**:

```
CanvasViewport.tsx:74-79 实际绑定为 `onPointerDown={handlers.onPointerDown} onPointerMove={handlers.onPointerMove} onPointerUp={handlers.onPointerUp} onPointerCancel={handlers.onPointerUp} onLostPointerCapture={handlers.onPointerUp} onPointerLeave={handlers.onPointerLeave}`;Glob 显示 hooks 目录仅有 useMaskHistory.test.ts 一个测试文件
```

- **修复方向**:参照 lib/image/viewportTransform 已有测试基建,为 usePointerInteraction 补状态机单测(renderHook + 构造 ReactPointerEvent 桩):覆盖 单指绘制、二指落下取消笔画并回滚快照、pointercancel/lostpointercapture 清理、三指重锚定、alt-pan 等路径。
- **核验备注**(采纳修复前必读,验证者对原发现的修正):
  - 无实质性修正。两点补充细节:1) finishStroke 在 pointercancel 路径不回滚已绘制的半截笔画(快照仍留在 undo 栈,可手动撤销),属设计取舍而非 bug,与发现结论一致;2) up+lostpointercapture 双触发时,若捏合仍有 ≥2 指,finishStroke:316 会对同一组位置重复 beginPinchGesture 重锚定一次,无副作用。发现中所有行号(CanvasViewport.tsx:74-79、usePointerInteraction.ts:309-330/353-359/241-244、useMaskHistory.ts:100-104)均精确命中。

## 六、功能候选评审(新提 30 项 + 上轮遗留 8 项,合并去重后)

评审口径:用户价值 × 与「本地优先 + 实验闭环」定位契合度 × 实现可行性,满分 10。

### 在榜 12 项

**1. 瞬时失败自动重试:429/5xx/超时的有限次指数退避**(评分 9 / 难度 M)

批量实验最痛断层,已核实 taskRuntime.ts:961-976 catch 无条件一次性落 error、无 retryCount 字段、全 api 层无任何 backoff。仅对可重试错误(429/5xx/网络超时)做 2~3 次退避、尊重 AbortController,即可消灭『红卡→急停→等→手动补跑』人工链路。与『实验闭环』定位契合度最高,实现边界清晰(executeTask 内收口,不动调度器)。

**2. 图片下载体验包:选中批量 ZIP + 单图显性下载入口 + 含义化文件名**(评分 8.5 / 难度 S)

合并三条候选(批量 ZIP / 单图显性化 / 上轮『单图与选区导出』)。已核实 SelectionActionBar 无下载项、唯一单图入口是右键菜单(iOS 触屏放行原生菜单等于无入口)、文件名固定 image-时间戳。fflate 已是依赖、exportImport 已有 IDB 收集 Blob 打 ZIP 基建,边际成本极低。生成成品『拿走』是所有用户的终点动作,当前是明显短板。

**3. 中断批次恢复续跑:刷新/崩溃后一键续跑「请求中断」成员**(评分 8.5 / 难度 M)

吸收上轮『队列持久化/刷新恢复』。已核实 taskRuntime.ts:85-102 启动把所有 running 翻 error='请求中断',initStore 仅落库无任何恢复检测;retryGridMissing 只覆盖网格批。实验越大中断代价越高,是批量可靠性最后一公里。实现可收敛为『启动检测 N 条中断任务 → 横幅一键续跑(复用 enqueue/execute 原语)』,比完整队列持久化便宜得多。

**4. 本地数据防丢底线:navigator.storage.persist() + 备份新鲜度提醒**(评分 8 / 难度 S)

合并两条 S 级数据安全候选。已核实全仓零 persist() 调用、lastExport 零记录,数据 100% 在可被驱逐的 IDB。persist() 申请 + 面板『已持久化』徽标 + 『上次备份 N 天前,新增 M 个任务未备份』提醒,全部挂在已有 DataManagementSection,是 local-first 定位性价比最高的防线,也是 FSA 自动备份(L,已延后)落地前的过渡方案。

**5. 通配批次(非网格)的批次级聚合 UI:进度/批量重跑/取消/笔记 + 重试继承 batchId**(评分 8 / 难度 M)

已核实 groupIntoGridBlocks 注释明示通配批永远走散卡、TaskGridMatrix 全部能力以 gridAxes 为前提、taskRuntime.ts:1093 重试不继承 batchId 导致失败成员脱批。同是 batchId 批量实验,通配批与网格批能力不对等是明显的产品内一致性缺口。可复用 TaskGridMatrix 的统计/补跑/笔记逻辑,抽象成 batch 级而非 grid 级。

**6. 批次完成汇总:抑制逐条成功 toast + 完成通知含成功率/耗时统计**(评分 7.5 / 难度 S)

合并『汇总通知』与『结果统计聚合』两条 S 级候选(同为批次完成反馈,天然同一 PR)。已核实 taskRuntime.ts:950 每条成功无条件 toast(36 格=36 连环 toast),runEnqueuedTasks 本身 await 全部完成却无汇总点;elapsed/status/error 逐任务持久化但从未聚合。纯派生计算,挂 runEnqueuedTasks 完成点 + 矩阵头部一行即可,对照实验(比 provider 速度)价值直接。

**7. 跨批次共享的全局并发闸(总在途上限)**(评分 7.5 / 难度 M)

已核实 taskRuntime.ts:496-501 注释自述每次调用独立建闸、单条提交路径直呼 executeTask 完全绕过闸——叠批提交时实际并发 = N×上限,架空 apiProfiles 注释声明的『保守默认防 429』设计意图。属正确性修复而非纯新功能,且为『暂停/恢复队列』提供挂载点,与自动重试(第 1 名)协同构成限流治理闭环。建议与自动重试同轮或紧随其后。

**8. 网格实验模板化:保存/复用轴配置 + 从历史网格一键回填**(评分 7.5 / 难度 M)

『换提示词重测同一 3×4 网格』是实验闭环的核心重复动作。已核实 GridConfigPopover 轴选择为纯局部 useState 关弹层即丢、reuseConfig 不回填 gridAxes,而 task.gridAxes 含完整取值集已逐成员持久化——数据 100% 就绪只差两个回填入口。同时是『跨批次按坐标对比』(L,已延后)的前置:有模板才有同轴可对齐的两批。

**9. 画廊筛选维度扩展:模型/Provider/尺寸/日期 + apiModel 纳入搜索**(评分 7 / 难度 M)

已核实 taskFilters.ts 仅五维筛选,且搜索只匹配 prompt+JSON.stringify(params)——apiModel/apiProvider 是顶层字段,搜模型名零结果(这半条几乎是 bug 级缺口,可先行修复)。多 profile/多 provider/批量实验是核心卖点,几百条记录后按模型/日期回溯是真实需求;字段全部已持久化,纯前端过滤,风险低。

**10. 下载 PNG 嵌入生成参数元数据(tEXt chunk),导入侧反读回填**(评分 7 / 难度 M)

与『参数对照/可复现实验』定位强契合:A1111/ComfyUI 社区硬标配,图离开浏览器后参数不丢。已核实 handleDownload 为 blob 原样直传、全库无 PNG chunk 代码,所需字段(prompt/params/apiModel/revisedPrompt)均已持久化。约百行纯函数(CRC32+插块)可测试性好;顺带实现『拖图回填参数』补全闭环。建议与下载体验包(第 2 名)接续落地,共享下载管线。

**11. 暴露 gpt-image 的 background 透明背景参数**(评分 7 / 难度 S)

已核实全 api 层 background 零命中、TaskParams 无此字段;OpenAI Images/Responses 双模均官方支持 background: transparent|opaque|auto(知识面确定,gpt-image-1 文档明列)。贴纸/产品图刚需且项目内置『产品摄影』预设正是高频场景;png/webp 联动与 Gemini 置灰均有现成先例(output_compression/quality)可抄,S 级即可闭环,还可顺势成为新网格轴。

**12. 对比视图提示词词级 diff 高亮**(评分 6.5 / 难度 S)

已核实 compareTasks.ts:66 prompt 行 differs 仅整行布尔、渲染无任何词级 diff。提示词微调迭代({a|b} 通配/手改形容词重跑)是核心工作流,500 字提示词找一个不同词全靠肉眼是真实摩擦。纯函数 token diff + 着色 span,S 级、零依赖、可单测,是对比功能从 80% 到可用的最后 20%,压线入榜。

### 否决与延后 18 项

- **seed 参数支持:Gemini 可复现生成 + seed 作为网格轴**:API 支持存疑(联网核查):seed 确定性仅在 Vertex AI Imagen 文档化(且需关水印);gemini-2.5-flash-image 的 generateContent 官方文档只列 responseModalities/imageConfig,未承诺 seed 生效或可复现;OpenAI gpt-image 全系不支持 seed。两 provider 一个明确不支持、一个未文档化,『控制变量实验』核心卖点无法兑现,与上轮否决负面提示词同理。
- **图片后处理超分(上轮)**:定位不符:纯前端本地优先架构无推理后端,引入 WASM/ONNX 模型有体积与性能负担,走第三方 API 又违背『图不出本机』;且属后处理而非生成实验闭环,L 级成本收益比最差。
- **Web Share API:移动端分享生成图**:不单独立项:与『图片下载体验包』同域,作为其移动端增强点(feature-detect navigator.share,不支持回退下载)并入第 2 名实现即可。
- **PWA share_target:系统分享图片进参考图**:价值面窄 + 架构代价:仅覆盖已安装 PWA 的移动入口,且 sw.js 需引入 POST 处理,破坏现有『GET-only + kill-switch』的简洁安全模型;移动端非本工具主战场。
- **PWA file_handlers + shortcuts**:价值面窄:OS 级文件关联仅 Chromium 安装态生效,受众极小;消费管线虽现成但优先级远低于在榜项,延后。
- **File System Access API 自动增量备份**:延后(非否决):方向正确但 L 级且 Chromium-only;本轮以在榜的 persist()+备份新鲜度(S)作低成本防线,待其落地后再评估自动备份的真实需求强度。
- **批次间对比:同网格跨批次按坐标对齐**:延后(前置未就绪):L 级,且强依赖『网格模板化』先行——没有同轴配置重跑,就没有可按 gridCoord 对齐的两批。本轮先落模板化(在榜第 8),此项下轮携使用数据再评。
- **Outpaint 画布扩展工作流**:延后:价值认可但 L 级,仅 OpenAI 路径可用,涉及画布坐标系/maskPreprocess/尺寸校验三处联动;建议与『遮罩矩形选区+撤销栈』(上轮)合并为遮罩编辑器专题另起一轮。
- **遮罩矩形选区+撤销栈持久化(上轮)**:延后:编辑器打磨项,归入与 Outpaint 同一遮罩编辑器专题统一规划,避免编辑器连改两轮。
- **多标签(tags)体系**:延后/部分重复:对话归属+收藏分类+画廊筛选扩展(在榜第 9)已承担大部分组织职能;多标签引入 CRUD/筛选/批量赋值/导出导入全链路成本,等筛选扩展落地后看剩余需求再评。
- **Lightbox 操作工具栏与 100% 像素视图**:延后:Lightbox 手势事件密集(单击关闭/双击/拖拽/双指),加工具栏的事件冲突成本高于表面 M;下载/收藏入口先由下载体验包在 DetailModal/TaskCard 落地后,其紧迫性进一步下降。
- **编辑迭代前后 wipe 对比滑块**:延后:场景真实且 lineage 数据现成,但先观察 A/B 对比+词级 diff(在榜第 12)落地后的使用情况,再决定是否值得新增第三种对比形态。
- **Hash 路由 deep-link(合并上轮 deep-link 对话/任务)**:延后:urlBootstrap 已预留 #/ 路由空间、实现无冲突,但书签直达受众窄;建议与 ?prompt=/?profile= 打包成一轮『URL 集成专题』集中做。
- **?prompt= 预填 + ?profile= 具名配置切换(两条合并)**:延后:同属 URL 集成深化,受众为外部工具集成者;单独做太碎,与 hash deep-link 同轮打包性价比更高。
- **对话级/选中子集导出(两条合并)**:第 13 名惜败(非否决):本地优先迁移颗粒度的真实痛点,exportData 参数化路径清晰、导入端 merge 去重已就绪;仅因本轮 S 级高性价比项过多而出局,下轮优先回收。
- **历史提示词复用(上轮)**:与现有功能重复:每张卡的 reuseConfig 已可回填历史提示词与参数,片段库覆盖常用词组,独立历史面板边际价值低。
- **片段库变量模板(上轮)**:部分重复:通配 {a|b} 展开已覆盖『一词多值』实验场景,片段库变量化的真实增量场景证据不足,延后观察。
- **移动端 PillRow 折行(上轮)**:纯移动端布局打磨,与本地优先+实验闭环主线关联弱,宜作为常规 UI 修缮随手处理,不占功能评审席位。

---

## 七、与既往已知问题的关系

第二轮报告与 roadmap 记录中的已知欠账,本轮处理如下:

- **#4 initStore 孤儿 GC O(N)**:本轮 M5 深化——确认 `forEachImageMeta`/`pruneImagesViaCursor` 流式基建现成未复用,属低成本即可还的债。
- **#7 组件测试空白**:本轮 L15 **修正**——taskRuntime 并发/取消/watchdog 其实有 store.test.ts 覆盖,真实缺口是项目未安装任何 DOM 测试环境(jsdom/happy-dom 均无),组件交互层想测也测不了,这是基建缺失而非偷懒。
- **#6 persist 配额静默**:仍然成立,且本轮在相邻位置新增两条——多标签页 last-writer-wins(M9)与 merge 裸展开(M10),三者宜同一轮修。
- **taskRuntime 拆分、batchId 双语义、超时 controller 四处重复、错误文案口径不一**:第二轮结论维持成立,本轮未重复立项;其中 taskRuntime 拆分建议作为「中断批次恢复续跑」(功能榜第 3)的前置工程。
- 上一轮功能候选中,「历史提示词复用」「片段变量模板」「移动端 PillRow 折行」「超分后处理」被本轮评审团否决或降级,理由见第六节 dropped 列表。

## 八、方法与可信度说明

- **0 误报驳回的解读**:finder 被要求实读代码、附真实摘录并预核验后再提交,对抗验证的效果体现在 9 条严重度修正与逐条「核验备注」上(每条均为验证者穷尽反驳后的修正意见)。**采纳任何一条修复前,请连同其核验备注一起读**——多条发现的触发条件、影响上界在核验中被精确化(如 M24 的 1.1GB 被修正为 ~560MB、L19 的「白屏链」被证实当前不可达)。
- **残余不确定性**:M23(Firefox Alt+滚轮历史导航)与 M24(移动端 OOM)为代码推理 + 平台文档结论,未做真机复现;H4 的 `storage.persist()` 对 Safari ITP 7 天清除无效(仅 Chromium/Firefox LRU 驱逐有效),iOS 的可靠手段是添加到主屏幕(L18);SW 更新生命周期两条(L19/L20)的影响面经核验大幅收窄,按 low 记录但保留全文供未来引入代码分割时参考。
- **本轮未覆盖**:Playwright 端到端实测(content-visibility 交互、新手导览全流程,沿用 roadmap 既有待办);依赖供应链审计(npm audit)仅在第二轮做过。
