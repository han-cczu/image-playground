# 批量并发可配置 + 批次级取消设计

- 日期:2026-06-07
- 状态:待评审(roadmap v2 第 4 项 B3)
- 范围:批量调度并发上限从写死常量改为用户可配置(settings 持久化);新增批次级取消(在途请求中止 + 排队未启动跳过),覆盖网格批 / 通配批 / 全部在途三层口径。
- 设计过程:4 读者并行摸底 + 3 方案(最小改动/体验/健壮性)judge panel 综合——以 robust 的边界论证为骨架,嫁接 minimal 的工程选型与 ux 的反馈设计。

## 1. 背景与目标

- `BATCH_CONCURRENCY = 3` 写死(`taskRuntime.ts:446`),撞 429 的用户无法调低、小批量高配额用户无法调高。
- 批量提交(通配 `{a|b|c}` / XY 网格)一旦发出无法整批停止:单卡「取消」按钮(`TaskCard.tsx:318`)只能逐张点,且**排队未启动的任务取消后仍会空打请求**(见 §3 守卫缺失)。

**目标**:设置页可调批量并发(1~6,默认 3);网格矩阵一键「取消批次」、多选「取消生成」、命令面板「取消所有在途」;被取消的排队任务不再发出任何请求。

## 2. 现状盘点(摸底结论,均已核实行号)

- **调度链路**:批量三路径(`submitTask` 通配 :625 / `submitGridTask` :724 / `retryGridMissing` :795)统一 `enqueueTask` 落库(**恒写 `status:'running'`**,:419)后 `runEnqueuedTasks(taskIds, limit=BATCH_CONCURRENCY)` → `mapWithConcurrency`。排队中与在途的任务 **status 都是 'running'**,无法从状态区分。
- **并发闸无早退**:`mapWithConcurrency`(`concurrency.ts:11-35`)是固定 worker 池 + 闭包 cursor,无 signal、无外部钩子,「全部 item 最终都会被执行」是其文档承诺——跳过排队项不能靠停闸。
- **executeTask 入口无 status 守卫**(:799-802 仅 `if (!task) return`):排队项先被 `cancelTask` 翻 error 后,worker 取出时仍会建 AbortController、起 watchdog、**真发 callImageApi**,结果才被 :842/:875/:913 三道后置守卫丢弃——空打请求、浪费配额、潜在 429。
- **cancelTask(:163)已自洽**:`status!=='running'→return false` 幂等守卫 + `terminateTaskRuntime`(abort + 清 watchdog + 清 controller,:110-114)+ 落 `error` + `TASK_CANCELLED_ERROR='已取消生成'`(:50)。对排队项三清理是 no-op 但翻态成功。
- **settings 净化口**:`normalizeSettings`(`apiProfiles.ts:355-385`)是**显式白名单重建**,新字段漏登记即被持久化/导入/导出全链路静默抹掉;export/import 侧(`redactSettingsForExport` / `mergeImportedSettings`)spread 已 normalize 对象,字段自动随行。
- **codexCli×n 相乘**:`callImagesApiConcurrent`(`openaiCompatibleImageApi.ts:121-132`)在 codexCli && n>1 时对 n 张图各发 1 子请求,真实并发 ≈ batchConcurrency × n;n 个子请求共享 executeTask 的同一 requestSignal(:813),abort 一次全中止。
- **watchdog 从请求发起计时**(:182,提交 751bbf1 教训):调小并发拉长排队正是该机制保护的场景,本期不触碰。
- **刷新恢复**:`markInterruptedSyncHttpTasks`(:75-92)把 running 统一翻 `error+'请求中断'`,刷新后批内无 running——取消按钮(仅 running 时显示)自然不显示,无需特殊处理。

## 3. 关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 并发字段 | **顶层标量 `settings.batchConcurrency`**,非 per-profile | 控制的是跨任务全局调度节奏;per-profile 让混批无单一 limit 可读 |
| 取值域 | MIN 1 / MAX 6 / DEFAULT 3,`clampBatchConcurrency` 整数化+夹紧 | 默认沿用现常量(防 429 保守值);上界 6 在 codexCli n=10 下已达 ~60 子请求,不再上调 |
| 净化口 | **唯一在 `normalizeSettings` 白名单内 clamp**,读取处信任 | persist 水合/setSettings/import/export 全走此口;读取处分散 clamp 必漏 |
| 设置控件 | **`<select>` 离散 1..6**,不用 number input | 直接 `setDraft` 范式(同 clearInputAfterSubmit),天然进 isDirty 闭环;number input 需把第 4 个 string-state 接入 buildFlushedDraft/deps,扩大既有 flush 机制的脆弱面(两位评审一致结论) |
| 风险文案 | 控件下说明随 **active profile.codexCli 动态切换**:codexCli 时橙色「实际并发≈本值×n,过高易触发 429」,否则中性限流提示 | 相乘风险只对相关用户强调;不做动态收紧上限(切 profile 悄改持久化值,不可预测) |
| 生效时机 | **仅对新批次生效**(mapWithConcurrency 开闸即固定 workerCount) | 改造动态扩缩 worker 池代价大;429 急停的真实路径=「取消批次→调小→补跑」,由取消特性补位(§5) |
| 排队跳过机制 | **executeTask 入口加 `if (task.status !== 'running') return`** | 正确性必改非优化:不碰并发闸的唯一干净落点;enqueueTask 恒写 running(:419),五条产出路径无中间改态,守卫不误伤 |
| 批次取消实现 | **`cancelBatch(batchId)` 逐条复用 `cancelTask`** | 语义单点(terminateTaskRuntime/文案/幂等全继承);渲染抖动不成立——React 19 `createRoot` 自动批处理把同一事件流内 N 次 setTasks 合并为一次渲染 |
| 取消反馈 | 返回 `{aborted, skipped}`(`taskAbortControllers.has(id)` 区分在途/排队),toast「已取消 N 条:中止 M 条在途、跳过 K 条排队」 | ApiProvider 仅 openai\|gemini 且 :806 全覆盖,区分当前可靠;同模块内读 map 无跨界耦合;失效模式纯文案级,加注释标注该依赖 |
| 取消态 | 复用 `error` + `TASK_CANCELLED_ERROR`,**不加 'cancelled' 枚举** | 新枚举牵动所有 status 分支与持久化数据;与单卡取消语义一致 |
| 取消后补跑 | **取消格可被「补跑全部失败格」复活,不做例外** | 取消=失败的一种,补跑语义保持可预测;ConfirmDialog 文案前置知会 |
| 通配批入口 | SelectionActionBar「取消生成」(选中集口径)+ **命令面板「取消所有在途任务」**(全局口径) | 通配批散卡多选是移动目标,可用性差(评审盲点);「取消所有在途」一并覆盖无 batchId 单条、429 急停场景,且复用命令面板基建 |

## 4. 设计明细

### 4.1 并发可配置

1. `types.ts` AppSettings 加 `batchConcurrency: number`(紧邻 `clearInputAfterSubmit`)。
2. `apiProfiles.ts` 加常量 `BATCH_CONCURRENCY_MIN/MAX/DEFAULT`(1/6/3)与纯函数 `clampBatchConcurrency(v: unknown): number`(`Number→trunc→min/max 夹紧,非数兜 DEFAULT`);`normalizeSettings` return 白名单加 `batchConcurrency: clampBatchConcurrency(record.batchConcurrency)`;`DEFAULT_SETTINGS` 入参显式列出(可读性)。
3. `taskRuntime.ts`:删 `BATCH_CONCURRENCY` 常量,`runEnqueuedTasks(taskIds, limit?: number)` 内 `const effective = limit ?? useStore.getState().settings.batchConcurrency`;三调用点不传 limit 天然继承。**单条直跑路径(submitTask 单条 :622 / retryGridCell :766 / retryTask :1053)不渗入**,字节级等价基线不动。
4. `SettingsModal`「习惯配置」区加 `<select>`(1..6)+ 动态风险文案 + 「调整后对新提交的批次生效」说明。
5. import/export:无需改(spread 透传 + normalize 兜底);manifest version 不升(带默认值的新增字段向后兼容)。

### 4.2 批次级取消

1. **守卫**(`taskRuntime.ts` executeTask 入口,:802 后):`if (task.status !== 'running') return`——排队项被翻 error 后,worker 取出时不建 controller、不起 watchdog、不发请求。
2. **`cancelBatch(batchId): { aborted, skipped }`**(紧邻 cancelTask,store barrel 导出):
   ```ts
   const members = getState().tasks.filter(t => t.batchId === batchId && t.status === 'running')
   for (const m of members) {
     const inFlight = taskAbortControllers.has(m.id) // 仅文案统计;依赖「所有在途任务必注册 controller」(ApiProvider 全集 openai|gemini 均走 :806)
     if (cancelTask(m.id)) inFlight ? aborted++ : skipped++
   }
   ```
3. **`cancelAllRunning(): { aborted, skipped }`**:同上但圈定全部 `status==='running'`(不限 batchId),覆盖通配批/无 batchId 单条/429 急停。
4. **UI 三入口**:
   - 网格批:`TaskGridMatrix` 工具栏「取消批次」(红系,与补跑橙系区分),仅 `tasks.some(t => t.status==='running')` 时显示(注意:遍历成员而非格代表);走 ConfirmDialog(`tone:'danger'`,确认主按钮红色——'warning' 映射橙色会与补跑同色族):「将取消 N 条进行中的任务(含排队未发出的)…取消的格仍可补跑」。**M/K 拆分放事后 toast 而非弹窗预统计**(实现取舍:在途判定依赖 taskRuntime 模块私有 controller map,为弹窗预统计导出 peek API 不值;且弹窗到确认之间状态会漂移,事后实时返回才准确;action 内对返回 0 条的漂移场景给 info 提示)。
   - 多选:`SelectionActionBar` 加「取消生成(N)」,仅选中集含 running 时显示,红色、置删除按钮前、加分隔(取消≠删除:保留记录可补跑);逐条 `cancelTask`,**走 ConfirmDialog 二次确认**(跟随既有批量删除先例——原稿「不加确认与既有一致」的前提有误,批量删除实际有确认)。
   - 命令面板:`commands.ts` 注册 `action:cancel-running`「取消所有在途任务」,仅存在 running 时出现在列表;执行 `cancelAllRunning()` + toast。
5. **toast**:`已取消 N 条:中止 M 条在途、跳过 K 条排队`(N=M+K)。

### 4.3 边界与竞态(robust 方案论证,均已核实)

- **取消 vs 完成竞态**:filter 快照后某成员先被写 done → cancelTask 重 find 到 done,guard return false,不回改 ✓;反向(取消后请求才返回)由 :842/:875(写图期取消则 `rollbackStoredImages` 回滚孤儿图)/:913 三道后置守卫兜住 ✓。
- **取消时补跑在途**:补跑格沿用原 batchId(:756)且 running → 被 cancelBatch 一并圈进、被入口守卫跳过 ✓(口径=「取消时刻全部 running 成员」)。
- **codexCli 多图中止**:n 个子请求共享同一 requestSignal,abort 一次全中止,无残留 ✓。
- **幂等**:cancelTask guard 使 cancelBatch 重复调返回 0,安全 ✓。
- **刷新恢复**:见 §2 末条,无需特殊处理;取消文案已 putTask 落库,刷新后保留 ✓。
- **watchdog**:cancelTask 内 terminateTaskRuntime 清各自 watchdog,无残留误触发;不动 scheduleSyncHttpWatchdog ✓。

## 5. 429 急停路径(回应「调小并发不即时生效」盲点)

用户撞 429 的完整缓解动线:**「取消批次」(或命令面板「取消所有在途」)→ 设置调小并发 → 「补跑全部失败格」以新并发重跑**。三个动作均为本期交付件,SettingsModal 生效时机文案中点明此路径。

## 6. 非目标

- 在途批次并发热扩缩(改造 mapWithConcurrency 为动态 worker 池)——代价大,急停路径已补位。
- TaskStatus 新增 'cancelled' 枚举、「主动取消 vs 真失败」区分——牵动所有 status 分支与持久化。
- 通配批聚合组头(groupIntoGridBlocks 改造)——违背「通配不聚合」既有决策(gridExperiment.test.ts:125)。
- 提交时 codexCli×n 阈值 toast 警示——每批都弹打扰大于收益,SettingsModal 动态文案先行,留观察。
- per-profile 并发、上界随 codexCli 动态收紧。

## 7. 测试计划(对齐 store.test.ts 既有 mock 套路)

A. **clamp 纯函数**:0→1 / 99→6 / 3.7→3 / NaN·undefined·null·'x'→3;`normalizeSettings({})` 兜底;export/import round-trip 不丢。
B. **并发接入**:batchConcurrency=1,callImageApi defer 门控,提交 3 条通配批 → 任意时刻 in-flight ≤1;=2 时峰值 ≤2;单条提交不经并发闸(等价基线 :329 延伸)。
C. **入口守卫(核心)**:=1 制造排队,对排队项 cancelTask 后释放首条 → 断言该项 callImageApi **零调用**、status 保持 error;对照组不取消时全部被调(不误伤)。
D. **cancelBatch**:混合在途+排队 → 全员 error+'已取消生成'、在途 signal.aborted、返回 {aborted:1, skipped:N};幂等(再调返回 0);只圈定该 batchId;done 成员不回改(竞态用例);网格批取消后 gridAxes/gridCoord 保留、retryGridMissing 可复活取消格。
E. **cancelAllRunning**:跨 batchId + 无 batchId 单条一并取消。
F. **回归必绿**:watchdog staleTask(:358)、单条等价(:329)、通配 batchId 共享(:312/:341)、concurrency.test.ts 全套。
G. **e2e(Playwright 配方)**:设置改并发→保存→重载验持久化;网格「取消批次」全流程;多选「取消生成」;命令面板「取消所有在途」。

## 8. 触及文件

`types.ts` · `lib/api/apiProfiles.ts` · `lib/taskRuntime.ts` · `store/index.ts`(barrel)· `lib/commands.ts` · `components/SettingsModal/index.tsx` · `components/TaskGridMatrix.tsx` · `components/InputBar/SelectionActionBar.tsx` · `store.test.ts` · `lib/commands.test.ts`
