# 瞬时失败自动重试设计(429/5xx/超时/网络错误的有限次指数退避)

日期:2026-08-31。来源:2026-06-10 审查报告功能评审榜首(评分 9 / 难度 M):
「仅对可重试错误(429/5xx/网络超时)做 2~3 次退避、尊重 AbortController,即可消灭
『红卡→急停→等→手动补跑』人工链路。实现边界清晰(executeTask 内收口,不动调度器)。」

## 1. 背景与目标

批量实验(通配/网格)里 429/5xx/瞬断是常态,当前 executeTask 一次失败即落 error,
批量越大人工补跑链路越痛。目标:对**可重试错误**在任务生命周期内做有限次指数退避,
重试期间卡片有可见反馈,严格尊重取消语义,不改动并发调度器。

## 2. 现状盘点(均已核实行号)

- `taskRuntime/submit.ts:595` catch 无条件一次性落 error;`:432` executeTask 主体;
  `:457/:484` watchdog 两段式调度(输入图加载段 + 请求段各拿完整预算)。
- `taskRuntime/watchdog.ts:45` failSyncHttpTaskIfStillRunning:超时直接终态 + toast,
  在 executeTask 的 promise 流**之外**落态(abort 让 fetch 以 AbortError 拒绝,catch 里
  status 守卫早退)——超时重试必须让 watchdog 参与仲裁,不能只改 catch。
- HTTP 错误在三处以 `new Error(await getApiErrorMessage(...))` 抛出
  (`openaiCompatibleImageApi.ts:306/:449`、`geminiImageApi.ts:209`);getApiErrorMessage
  在响应 body 带 message 时**丢弃 status**——按消息正则分类不可靠,必须结构化错误。
- 两条并发聚合路径(`openaiCompatibleImageApi.ts:170`、`geminiImageApi.ts:281`)已
  `throw firstError.reason`,错误实例可穿透聚合 ✓。
- 取消语义:terminateTaskRuntime abort 控制器;fetch 各阶段 throwIfAborted 抛
  DOMException AbortError。
- TaskRecord 无 retryCount;normalizeTask 白名单归一化(`tasks.ts:165`)。刷新后
  markInterruptedSyncHttpTasks 本就中断一切 running——重试计数没有跨刷新存活的必要。

## 3. 关键决策

- **D1 结构化错误**:imageApiShared 新增 `ApiHttpError extends Error { status: number;
  retryAfterMs?: number }`,上述三个 HTTP 位点改抛。构造时解析 `Retry-After` 头
  (秒数与 HTTP 日期两种格式,clamp 1~60s)。message 口径不变(仍取 getApiErrorMessage
  结果),对既有 UI/测试文案零影响。
- **D2 分类白名单**:transient = `ApiHttpError(status===429 || status>=500)`
  ∪ `TypeError`(fetch 网络层失败) ∪ watchdog 超时标记。其余一律不重试:4xx、
  AbortError、业务错误(「接口未返回图片数据」「Gemini 安全拦截/finishReason」等)。
  取向:**宁可漏重试,不可误重试**——安全拦截/参数错误重试只会烧配额。
  `TypeError` 仅指**主请求**的网络层失败:Images 模式结果图以 url 形态返回时,下载阶段
  的 TypeError(CDN 无 CORS 头 / 读 body 断连)由 `fetchImageUrlAsDataUrl` 降级为普通
  Error——上游已计费出图,重跑整轮生成只会再烧配额(审计 2026-09-02 #19)。
- **D3 收口位置**:executeTask 内 attempt 循环(评审指定边界)。退避等待**占住并发闸
  worker 槽位是刻意的**:429 场景占槽即天然背压,整批自动降速,不会形成重试风暴;
  调度器(runEnqueuedTasks/mapWithConcurrency)零改动。
- **D4 超时重试**:watchdog 触发时若该任务还有剩余尝试→不落终态:记 timeout-retry
  标记 + terminate(abort 在途请求),executeTask catch 识别标记视作 transient 走重试;
  尝试耗尽才走现行 fail + toast。任务命运的单一所有权(executeTask)保持不变。
  watchdog 侧经**注册制回调**询问剩余尝试(仿 idbRuntimeBridge,避免 watchdog→submit
  反向依赖破坏拆分轮的单向依赖)。
- **D5 退避参数**:延迟 = `min(2s × 4^(attempt-1), 30s) × jitter(0.5~1.5)`
  (即约 2s / 8s 两档);429/503 带 Retry-After 时取 `max(计算值, retryAfterMs)`。
- **D6 设置项**:`settings.autoRetryMax`(0~3,默认 2,0=关闭),normalizeSettings
  clamp + 旧数据缺字段归一化(完全仿 batchConcurrency 先例);SettingsModal 通用段
  一个 select。读取时机 = executeTask 入口快照,改设置对在途任务不生效(同
  batchConcurrency 口径)。
- **D7 重试计数不持久化**:运行期 Map(attempt/timer)+ tasks slice 转瞬字段
  `taskRetryInfo: Record<taskId, { attempt; maxAttempts; nextRetryAt }>`(仅驱动 UI,
  不进 persist 白名单/TaskRecord/导出)。刷新后 running 照旧按「请求中断」处理。
- **D8 UI 反馈**:TaskCard 运行态叠加「第 N/M 次重试中」徽标(taskRetryInfo 驱动);
  **不逐次 toast**(36 格批量下会刷屏)。最终落 error 时文案追加「(已自动重试 N 次)」
  便于事后判读。

## 4. 设计明细

### 4.1 api 层
`ApiHttpError` + `parseRetryAfterMs(headerValue, now?)` 纯函数(可单测);三位点改抛。
聚合路径无需改动(已 throw reason)。

### 4.2 taskRuntime/retryPolicy.ts(新,纯函数先行)
- `isTransientTaskError(err, hasTimeoutRetryFlag): boolean`——D2 分类矩阵。
- `computeRetryDelayMs(attempt, retryAfterMs?, random?): number`——D5 曲线,random
  注入便于测试。

### 4.3 executeTask 改造(submit.ts)
请求段抽成 attemptOnce;外层循环:
catch → AbortError 且带 timeout-retry 标记 → 视作 transient;
transient && attempt < max && 最新 status==='running' → 写 taskRetryInfo →
可清理的退避 timer(注册进运行期 map,terminateTaskRuntime 连带清除)→ 醒来重验
status==='running' → 下一轮(watchdog/controller 每轮重建);
否则 → 现行错误落态(文案按 D8 追加),finally 清 taskRetryInfo 与运行期条目。

### 4.4 watchdog 改造(watchdog.ts)
fail 分支前经注册制回调仲裁:有剩余尝试 → 设标记 + terminateTaskRuntime + 静默返回
(不落态不 toast);否则现行为。

### 4.5 清理路径
- terminateTaskRuntime(shared.ts)增清退避 timer + 重试标记 → cancelTask/removeTask/
  removeMultipleTasks/terminateRunningTaskRuntimes/cancelBatch 全部自动继承。
- clearTransientUiReferencesForDeletedTasks(mutations.ts)清 taskRetryInfo。
- resetTaskRuntimeForTest 经注册制清空新状态。

## 5. 边界与竞态

- **退避中取消/删除**:timer 被 terminate 清除;即便回调已入队,醒来后 status 守卫
  早退(与 cancelBatch「排队跳过」同构)。
- **输入图加载段超时**:IDB await 不可中断,abort 对它无效;仲裁器按阶段判定
  (RetryProgress.phase),加载阶段超时一律交回 watchdog 直落 error,不进重试——
  否则 IDB 永不完成时接管会清掉 watchdog 且再无人看护,任务永久 running(审计 #18 回归)。
  超时接管只在请求阶段(callImageApi 发起后)生效。
- **总耗时上界**:≤ 尝试数×timeout + Σ退避,批量场景由占槽背压自然串行化,不额外放大。
- **部分成功不重试**:拆单路径部分成功仍按现行 partialFailure 落 done(见非目标)。
- **重试徽标与 cv-auto**:徽标只改卡片内文本节点,不影响 content-visibility 测高。

## 6. 非目标

部分失败的子请求级重试;全局并发闸(报告 #7,另轮);中断批次续跑(报告 #3,另轮);
优化器/反推 API 重试(独立配置,另议);除 Retry-After 外的服务端配额协商;重试
计数持久化/跨刷新续跑。

## 7. 测试计划

- retryPolicy 纯函数:D2 分类矩阵(429/500/503/TypeError/AbortError/400/业务错误/
  超时标记)、退避曲线与 jitter 边界(注入 random)、Retry-After 优先级。
- parseRetryAfterMs:秒/HTTP 日期/垃圾输入/负值/超上限。
- executeTask 集成(仿 store.test.ts 的 callImageApi mock + fake timers):
  429×2 后成功 → done 且恰好 3 次请求;429×3 → error 且文案含重试次数;
  AbortError 不重试;退避期 cancelTask → 不发下一请求;autoRetryMax=0 → 行为与现行完全一致。
- watchdog 超时重试:永挂 mock + fake timers,首次超时 → 重试,耗尽 → 终态 + toast。
- ApiHttpError:三位点类型断言 + status 穿透聚合路径保真。

## 8. 触及文件

`api/imageApiShared.ts`、`api/openaiCompatibleImageApi.ts`、`api/geminiImageApi.ts`、
`taskRuntime/retryPolicy.ts`(新)、`taskRuntime/submit.ts`、`taskRuntime/watchdog.ts`、
`taskRuntime/shared.ts`、`taskRuntime/mutations.ts`、`store/slices/tasks.ts`、
`api/apiProfiles.ts`(normalizeSettings)、`SettingsModal`(设置项)、`TaskCard`(徽标)
及对应测试文件。
