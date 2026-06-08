# 批量反推 + 优化器 Gemini provider 设计

- 日期:2026-06-08
- 状态:待评审(roadmap 第三轮 B2)
- 范围:两块——(1) 给反推(captioner)与提示词优化(optimizer)加 **Gemini 原生 provider**(generateContent 流式 + vision inlineData + systemInstruction);(2) **多图批量反推**(选多张已生成图一键并发反推,结果汇总,可存片段库/复制)。
- 设计过程:4 读者摸底 + 3 方案(仅Gemini/完整批量/务实折中)judge panel。两评审一致选 gemini-only(8/8.5),但其"不做批量"未触达任务标题的"批量反推"核心。本 spec = **gemini-only 的扎实 Gemini provider 骨架 + 嫁接 full-batch 的干净批量调度**(避开 pragmatic 改造单图 modal 的 fork 风险),并回应 5 个共有盲点。

## 1. 背景与目标

- 反推/优化都只走 OpenAI 兼容 chat completions(`captionImageStream`/`optimizePromptStream`,`buildChatCompletionsUrl` + SSE)。图像生成已有 Gemini 原生 provider(`geminiImageApi.ts`),但反推/优化没有——Gemini 用户无法反推/优化。
- 反推是单图(`ImageCaptionModal` + `captionSource: string|null`),批量场景需逐张手工反推。

**目标**:Gemini 用户能反推/优化;选中多张已生成图一键批量反推,结果汇总可一键存片段库或复制。

## 2. 现状盘点(摸底结论,带行号)

- **OpenAI 抽象不可复用于 Gemini**:`buildChatCompletionsUrl`(`/v1/chat/completions`)、`parseSseLine`(取 `choices[0].delta.content`)、Bearer 鉴权、`extractStreamErrorMessage`(`{error:{message}}`)全是 OpenAI 形态;Gemini 端点 `<base>/models/<model>:streamGenerateContent?alt=sse`、响应 `candidates[0].content.parts[].text`、鉴权 `x-goog-api-key`、错误 `promptFeedback.blockReason`/`finishReason=SAFETY` 完全不同。
- **Config/Profile 无 provider 字段**:`CaptionerConfig`/`PromptOptimizerConfig` 仅 `{baseUrl,apiKey,model,timeout,systemPrompt}`(`types.ts:33-41/50-58`),Profile 多 `{id,name}`。加 `provider` 需贯穿 create/normalize/镜像。
- **可复用件**:`dataUrlToInlinePart(dataUrl)` 正则拆 mime+base64(`geminiImageApi.ts:46-55`);`buildGeminiUrl(baseUrl,model)` 显式不复用 normalizeBaseUrl(`:92-101`,method 段 `:generateContent` 硬编码需参数化);`getApiErrorMessage`(`imageApiShared.ts:172-189`)、`isHttpUrl`(`:74-76`);SSE reader 循环(`captionImageApi.ts:98-128`)可复用,仅换 `parseSseLine→parseGeminiSseLine`。
- **Gemini 现状非流式**:`geminiImageApi` 用 `await response.json()` 一次性(`:158`),未用 streamGenerateContent;反推流式需新写 `?alt=sse` + SSE 解析。`apiKey` 未 trim(`:145`),systemInstruction 未用(`:118`)。
- **批量调度可复用**:`mapWithConcurrency(items,limit,fn)`(`concurrency.ts:11-35`,纯调度);`settings.batchConcurrency`(B3 加)。**反推不产 TaskRecord**,不能复用 `runEnqueuedTasks`/`cancelAllRunning`(深绑 `executeTask`/`taskAbortControllers`)。
- **批量入口先例**:`canCompare` 谓词 `status==='done' && outputImages.length>0`(`SelectionActionBar.tsx:109-115`);`createSnippet` 撞 `MAX_SNIPPETS=200` 返回 null + 已 toast(`tasks.ts:296-299`)。
- **⚠️ commitSettings baseUrl 坑**(评审最严重盲点):`index.tsx:214/227` 写 `baseUrl: profile.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl`(OpenAI 默认);captioner/optimizer commit 路径(`210-231`)**无 gemini 分支**(OpenAI 图像 profile 在 `191-199` 有)。Gemini 反推 profile 空 baseUrl 会被强制写成 OpenAI 端点。

## 3. 关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 范围 | **两块都做**:Gemini provider(主交付,确定收益)+ 批量反推(用户诉求) | gemini-only 评审最高但未交付"批量";Gemini provider 是批量前提,先建好 captionImageStream 的 provider 分流,批量只是 mapWithConcurrency 包一层 |
| provider 分流 | 在 `captionImageStream`/`optimizePromptStream` **入口、apiKey/image 校验之后、buildChatCompletionsUrl 之前**按 `config.provider` 分支;**缺省/undefined early-return 走 OpenAI** | 守住现有测试(`captionImageApi.test.ts:55-91` baseConfig 无 provider 必须走 openai);新写 `captionImageGeminiStream`/`optimizePromptGeminiStream` 而非内联,保持可测 |
| Gemini 流式 | `streamGenerateContent?alt=sse` + 新 `parseGeminiSseLine`(**遍历 `candidates[0].content.parts[]` 拼接所有 `part.text`,跳过非 text part**,应对 thinking/多 part);复用现有 SSE reader 循环 | 嫁接 full-batch 的严谨度(不只取 parts[0]);非流式 `:generateContent`(`await json→单 onDelta`)留作安全阀 |
| Gemini 适配 | `dataUrlToInlinePart` 复用拆 vision;`systemInstruction:{parts:[{text:systemPrompt}]}`;`buildGeminiUrl` method 段参数化;`x-goog-api-key`+`apiKey.trim()`;错误 `extractGeminiStreamError` **扫描整个 raw 所有 data: 行找 blockReason**(非只末帧) | 盲点回应:blockReason 可能在首/末帧;空流时不丢真错退化成"结果为空" |
| optimizer Gemini | **同时给**(captioner + optimizer) | optimizer 纯文本 generateContent 更简单(无 vision),对称实现成本低 |
| profile 字段 | `Config`/`Profile` 加 `provider?: ApiProvider`;**唯一 gatekeeper 是 normalize**(`normalizeCaptioner`/`normalizePromptOptimizer` 读 `record.provider`)+ DEFAULT + normalizeSettings 镜像 | 盲点回应:commitSettings 的 `...profile` spread 已自动携带 provider(`index.tsx:212/225`),**无需显式列字段**(gemini-only 过度防御);但 baseUrl/model 兜底**必须加 gemini 分支**(见下) |
| **commitSettings 修复** | captioner/optimizer commit map(`index.tsx:210-231`)加 `provider==='gemini'` 分支:baseUrl 兜 `DEFAULT_GEMINI_BASE_URL`、model 兜 `DEFAULT_GEMINI_CAPTIONER_MODEL`/`_OPTIMIZER_MODEL` | **第 5 个白名单登记点,三案全漏的最严重坑**;不修则 Gemini 配置保存后打到 OpenAI 端点 |
| 批量入口 | **SelectionActionBar「批量反推」按钮**(`canBatchCaption` 镜像 `canCompare`:选中含 done+有输出图),每 task 取 `outputImages[0]` 首图 | 嫁接 full-batch;覆盖主场景(已生成图),不只多文件上传(pragmatic 入口缺陷);复用已验证谓词 |
| 批量调度 | `mapWithConcurrency(sources, settings.batchConcurrency, fn)` + **每路独立 AbortController** + 总取消;**不复用 runEnqueuedTasks** | 反推不进 TaskRecord/executeTask;批量路径**不订阅 onDelta 只取 resolved 全文**降 N 路渲染压力(N===1 才流式) |
| 批量容器 | **新 BatchCaptionModal + captionBatch ui-slice 数组态**,不 fork 单图 ImageCaptionModal | 嫁接 full-batch;避开 pragmatic 把单图 modal 改 N 值态的 fork bug 风险 |
| 批量落地 | 逐图卡片汇总(缩略图 + 反推文本)+ **一键全部存片段库**(`createSnippet`,撞 200 累计汇总 toast)+ 单条复制 | 复用片段库;撞上限不逐条弹 N 个 toast |

## 4. 设计明细

### 4.1 Gemini provider(主交付)

1. **types.ts**:`CaptionerConfig`/`PromptOptimizerConfig` 加 `provider?: ApiProvider`。
2. **apiProfiles.ts**:`normalizeCaptioner`/`normalizePromptOptimizer` 读 `record.provider`(非 'gemini' 默认 'openai');`createDefaultCaptioner`/`...Optimizer` 默认 openai;`normalizeSettings` 派生镜像搬运 provider;加 `DEFAULT_GEMINI_CAPTIONER_MODEL`/`_OPTIMIZER_MODEL` 常量。
3. **captionImageApi.ts / optimizePromptApi.ts**:入口校验后按 `config.provider` 分流——`'gemini'` 走新 `captionImageGeminiStream`/`optimizePromptGeminiStream`(streamGenerateContent?alt=sse + `parseGeminiSseLine` + `dataUrlToInlinePart` + systemInstruction + x-goog-api-key + 复用 SSE reader),否则现有 OpenAI 路径不变。
4. **新 geminiChatShared.ts**(或并入 chatCompletionsShared):`buildGeminiStreamUrl(baseUrl,model)`、`parseGeminiSseLine`、`extractGeminiStreamError`(扫全 raw)。
5. **SettingsModal CaptionerSection/OptimizerSection**:加 provider 切换(仿 ApiProfileSection 的 `switchApiProfileProvider`);**commitSettings 加 gemini baseUrl/model 兜底分支**(§3 修复)。

### 4.2 批量反推

1. **ui slice**:`captionBatch: { id, src, thumbId, status, text, error }[] | null` + setter(瞬态)。
2. **SelectionActionBar**:`canBatchCaption` 谓词;「批量反推」按钮 → 收集选中 done task 的 `outputImages[0]` → 打开 BatchCaptionModal。
3. **BatchCaptionModal**(照搬 CompareModal 骨架):`mapWithConcurrency(sources, settings.batchConcurrency, src => captionImageStream(settings.captioner, src, {signal}))`,每路独立 AbortController,逐图卡片(缩略图 + 反推文本 + 状态);顶部「全部存为片段」(`createSnippet` 逐条,撞 200 汇总 toast)+ 单条复制;「取消全部」abort 所有未完成。
4. **落地**:不订阅 onDelta(批量只取全文);结果不自动填 prompt(避免覆盖),由用户显式存片段/复制。

## 5. 五个盲点的正面回应(评审揪出)

1. **commitSettings baseUrl 强制 OpenAI**(最严重)→ §3 加 gemini 分支,这是第 5 个登记点。
2. **commitSettings provider 字段冗余**:`...profile` spread 已携带,normalize 是唯一 gatekeeper,不显式列。
3. **dedup key**:已含 systemPrompt+name,加 provider 无害但非高危,据实降权重。
4. **Gemini 200 流 blockReason**:`extractGeminiStreamError` 扫描整个 raw 所有 data: 行 JSON.parse 找 blockReason,非只末帧。
5. **systemInstruction 旧模型不支持**:默认 gemini-2.5-flash 支持;留降级路径(不支持时拼进 user text),文档标注。

## 6. 非目标

- 批量反推结果自动填 prompt/导出 ZIP;批量优化(只批量反推);独立批量视图的平移缩放;反推结果关联回 task 持久化;Gemini 以外的第三 provider。

## 7. 测试计划

- **captionImageApi.test.ts / optimizePromptApi.test.ts**:现有 OpenAI 断言保持绿(缺省 provider 走 openai);新增 Gemini 路径——mock fetch 返回 Gemini SSE(`candidates[].content.parts[].text`)、`parseGeminiSseLine` 多 part 拼接、blockReason 扫描、x-goog-api-key header、inlineData 拆分、systemInstruction、空流错误。
- **apiProfiles.test.ts**:normalizeCaptioner/Optimizer 的 provider 兜底(缺省 openai/显式 gemini)、normalizeSettings 镜像 provider round-trip、DEFAULT 模型。
- **commitSettings**(若可测/手验):gemini provider 空 baseUrl 兜 DEFAULT_GEMINI_BASE_URL 而非 OpenAI。
- **批量**:`mapWithConcurrency` 并发逐图(复用 B3 测试范式)、每路 AbortController 取消、createSnippet 撞 200 汇总;BatchCaptionModal 卡片状态。
- **e2e**(Playwright):Gemini captioner 反推、批量选图反推 + 存片段、取消。

## 8. 触及文件

新增:`lib/api/geminiChatShared.ts`(或并入)· `components/BatchCaptionModal.tsx` · 对应测试
修改:`types.ts`(Config provider)· `lib/api/apiProfiles.ts`(normalize/default/镜像/常量)· `lib/api/captionImageApi.ts` + `optimizePromptApi.ts`(provider 分流 + Gemini 流)· `components/SettingsModal/CaptionerSection.tsx` + `OptimizerSection.tsx` + `index.tsx`(provider 切换 + commitSettings gemini 兜底)· `components/InputBar/SelectionActionBar.tsx`(批量反推入口)· `store/slices/ui.ts`(captionBatch)· `App.tsx`(挂 BatchCaptionModal)· 相关测试
