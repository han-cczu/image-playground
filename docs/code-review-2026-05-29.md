# 全项目代码审查报告 · image-playground

> 审查日期:2026-05-29
> 审查范围:`src/` 全量(约 21K 行 / 130 文件)+ 构建/部署/基础设施配置
> 审查方法:11 子系统并行深读 → 对抗式核验(逐条独立读源码裁定真伪)→ 综合完整性批判
> 基线提交:`580010d`(feat(ui): 首屏分层错落入场动画)

---

## 一、总体判断

**健康度:良好,无致命缺陷,但有一组成体系的安全加固与生命周期健壮性问题值得集中治理。**

代码工程化水平较高(测试覆盖好、不可变性规范、`ErrorBoundary` 状态机严谨、SW kill-switch 契约、多阶段 Docker、profile 分模式部署)。问题**不在功能正确性主干**,而集中在三条系统性主题:**密钥安全纵深、异步取消/资源生命周期闭环、不可信输入的信任边界**。

### 地面信号(独立运行)

| 信号 | 结果 |
|---|---|
| 类型检查 `tsc -b` | ✅ 无报错 |
| 测试 `vitest run` | ✅ 24 文件 / 206 用例全部通过 |
| lint `eslint src` | ⚠️ 0 error / 85 warning |

### 审查结果统计

| 维度 | 数据 |
|---|---|
| 子系统 | 11 |
| 原始发现 | 79 |
| **核验确认** | **74**(0 critical · 3 high · 13 medium · 43 low · 15 info) |
| 核验驳回(误报) | 5 |

按类别:correctness 28、security 9、data-integrity 8、resource-leak 8、performance 6、react-concurrency 5、accessibility 4、error-handling 4、type-safety 1、maintainability 1。

按子系统确认数:API·图像 6 / API·辅助 5 / 持久化 9 / 状态管理 8 / 图像库 4 / 蒙版编辑器 6 / 输入栏 5 / 弹窗 9 / 核心 UI 8 / 侧栏杂项 7 / 基础设施 7。

---

## 二、建议处理顺序(按风险)

1. **H1 + 主题①**:统一治理密钥——空/非法 baseUrl 硬失败、apiKey 改 hash-only、补 CSP + 安全头。确定发生、危害最重。
2. **H3**:关闭开放凭证代理(origin 白名单)。
3. **M1**:修 Responses API 对象形态解析——影响核心生成可用性。
4. **M6 + 主题②**:在途任务取消闭环 + 用户级取消入口。
5. **M3 / M5 / M4 + 主题④**:不可信入口字段校验 + 导入原子性 + 迁移幂等去 localStorage 依赖。
6. **M11**:Workers `/sw.js` no-cache(SW kill-switch 逃生通道)。
7. **H2 / M7~M10 + 主题⑥⑦**:剪贴板转码、历史内存上限、a11y 与弹窗外壳统一。

---

## 三、🔴 HIGH(3 条,确定性发生)

### H1 · 密钥泄露:辅助 API 的 baseUrl 为空时,API Key 被 POST 到应用自身源
- **位置**:`src/lib/api/captionImageApi.ts:14-20,56,70-76`(`optimizePromptApi.ts` 同样)
- **类别/置信度**:security / high
- **问题**:`buildChatCompletionsUrl` 在 `normalizeBaseUrl` 返回空串时回退为同源相对路径 `/v1/chat/completions`,随后以 `Authorization: Bearer <apiKey>` POST。设置页 API URL 可被清空;提交时 captioner/optimizer 的 baseUrl 仅 `.trim()`(`SettingsModal/index.tsx:188,201`),`normalizeCaptioner/normalizePromptOptimizer` 也仅在「非字符串」时回退默认值,空字符串原样保留;且不存在 `validateCaptioner/validateOptimizer`(只有图像 Provider 有 `validateApiProfile`)。结果:用户清空辅助 API URL 后触发反推/优化,密钥以 Bearer 头发往部署源(自托管反代 / Cloudflare Worker 的日志即可见)。
- **修复**:`buildChatCompletionsUrl` 中 baseUrl 归一为空时抛「未配置 API URL」错误而非回退同源;或在 normalize 时对空 baseUrl 回退 `DEFAULT_BASE_URL`,提交时对 captioner/optimizer 也走 `normalizeBaseUrl(... || DEFAULT_BASE_URL)`。两套 API 文件需同步修改。

### H2 · 复制 JPEG/WEBP 等非 PNG 图片在主流浏览器必然抛错
- **位置**:`src/lib/image/clipboard.ts:18-26`
- **类别/置信度**:correctness / high
- **问题**:`new ClipboardItem({ [blob.type]: blob })` 直接用 `blob.type` 作键,但 Chromium/WebKit 异步剪贴板写入图片只可靠支持 `image/png`,写 `image/jpeg`、`image/webp` 会抛 `Type ... not supported on write`。生成图 mime 来自模型返回(`geminiImageApi.ts:84` 用 `inline.mime_type`,可为 jpeg/webp),`DetailModal.tsx:262-264` 与 `ImageContextMenu.tsx:79-81` 都直接 fetch 原始 blob 原样传入 → 复制非 PNG 图必落 catch,仅显示通用「复制失败」。
- **修复**:写入前把非 `image/png` blob 经离屏 canvas 转 PNG(项目已有 `imageDataUrlToPngBlob`/`canvasToBlob` 可复用),再用 `'image/png'` 作键。

### H3 · cors-proxy 是「任意来源 + 带凭证」开放代理
- **位置**:`cors-proxy.conf:42-49,84-88`
- **类别/置信度**:security / high
- **问题**:对预检和实际响应都回写 `Access-Control-Allow-Origin: $http_origin`(反射任意来源)叠加 `Access-Control-Allow-Credentials: true`,等于对全互联网开放。上游虽被固定为 api.openai.com 等(无 SSRF),但任何第三方页面都能借 `cors.your-domain.com` 向该上游发认证请求:把你的代理当隐藏 IP 的免费中转,流量/封禁风险记在你域名上;`Allow-Credentials:true` 配合 Authorization 透传若用户在该 origin 有 cookie 也会被带上。
- **修复**:用 `map` 把 `$http_origin` 收敛到白名单再反射,非白名单不回 ACAO 头;去掉 `Allow-Credentials:true`(本应用 key 走 Authorization 头不需 credentials);加 `limit_req` 防滥用。

---

## 四、🟠 MEDIUM(13 条,真实路径缺陷)

### M1 · Responses API 对象形态 result 被静默丢弃,整次请求误报「未返回可用图片」
`src/lib/api/openaiCompatibleImageApi.ts:93-110` — correctness
`parseResponsesImageResults` 只处理 `typeof result === 'string'`(裸 base64),但类型定义 `ResponsesOutputItem.result` 明确为 `string | { b64_json?; image?; data? }`(`types.ts:242-255`)。对端返回对象时该 item 被跳过,`results.length===0` 抛「接口未返回可用图片数据」。**直接影响核心生成可用性**。
**修复**:增加对象分支,依次取 `result.b64_json ?? result.image ?? result.data`,命中字符串走 `normalizeBase64Image`,三者皆缺才跳过。

### M2 · 导入去重键过窄导致 optimizer/captioner 配置被误删
`src/lib/api/apiProfiles.ts:472-478,519-525` — data-integrity
去重键仅 `[baseUrl, apiKey, model]`,未含 `systemPrompt`。导出时 apiKey 被抹空(`exportImport.ts:65-77`),同 baseUrl+model 的多套配置导入时去重键完全相同,只保留第一个 → 往返导入静默丢失多套 systemPrompt 配置。
**修复**:将 `systemPrompt`(必要时加 `name`)纳入去重键;或 apiKey 为空时不参与去重折叠。

### M3 · 导入 ZIP 的 tasks 不做任何字段级校验直接写 IndexedDB
`src/lib/exportImport.ts:212-251` — security
`importData` 仅校验 `data.tasks/imageFiles` 存在,随后逐条 `putTask` 落库,无 normalize 白名单(对比 conversations/categories 都有)。可注入缺字段/类型错误/超大 task,或 `actualParamsByImage` 含 `__proto__`/`constructor` 键,被原样持久化后在消费处崩溃或污染对象。
**修复**:新增 `normalizeTask(unknown): TaskRecord|null` 白名单(校验类型、跳过危险 key、字段/数组上限),`putTask` 前过滤,与 `normalizeConversations` 一致。

### M4 · IDB v1→v2 迁移外包给受 localStorage 门控的 initStore
`src/lib/db.ts:22-36` — data-integrity
`onupgradeneeded` 只 put(archive),真正的「按分类切分」迁移留到 `initStore` 跑,而是否跑由 `readConversationMigrationVersion()`(localStorage)门控。localStorage 被禁/清时:迁移版本恒为 0 → 每次启动重跑全表写事务;或 DB 已 v2 但版本被清 → 再跑一遍。结构升级与数据迁移标记分散在 IndexedDB 与 localStorage 两个可独立清除的存储,破坏「升级即迁移」原子性。
**修复**:幂等判据改用数据自身状态(仅当存在 `conversationId` 缺失的 task 时才 reseed),localStorage 版本号仅作加速提示;或把版本号也存进 IDB meta store 同事务。

### M5 · 导入(merge/replace)整体非原子,中途失败留半残状态
`src/lib/exportImport.ts:215-316` — data-integrity
replace 模式先 `clearTasks→clearImages→clearConversations`(三个独立事务),再逐个 `await putImage`/`putTask`,最后才提交 conversation 迁移。跨越数十~数百独立事务,任一步抛错已写入部分不回滚 → replace 在清空后中途失败造成数据丢失。
**修复**:把清空+写入收敛到尽量少的事务(批量 put);或导入前快照、失败恢复;至少在 replace 失败时强提示「数据可能不完整」。

### M6 · 删除在途(running)任务不中断请求,产生孤立图片
`src/lib/taskRuntime.ts:454-535,688-771` — resource-leak
`removeTask/removeMultipleTasks` 删除任务时未调用 `abortTaskRequest`,也未清 watchdog 定时器(`clearSyncHttpWatchdogTimer`)。running 任务被删后 fetch 继续跑,成功分支虽因任务已移除而早退、不写状态,但网络请求与 watchdog 仍在跑,abortController 残留至 finally。
**修复**:删除前对每个被删任务调用 `abortTaskRequest(id)` + `clearSyncHttpWatchdogTimer(id)` + `clearTaskAbortController(id)`。

### M7 · 撤销历史按全分辨率 ImageData 存储,内存可达数百 MB
`src/components/MaskEditorModal/hooks/useMaskHistory.ts:3-13,57-87` — resource-leak
每次 push/undo/redo 都 `getImageData(0,0,W,H)` 保存整张未压缩像素;`HISTORY_LIMIT=40` 仅限条目数。工作画布长边上限 1920,1920×1080 单张约 8.3MB,栈满约 330MB,叠加 redo 接近 660MB,移动端可能崩。
**修复**:按总字节预算裁剪(~64-128MB);或只存脏矩形差异;或快照压缩为 PNG blob;至少把上限与画布面积挂钩。

### M8 · 所有弹窗均未锁定 body 滚动
`src/components/SettingsModal/index.tsx:416-424` — correctness
SettingsModal/DetailModal/Lightbox/PromptOptimizer/ImageCaption/SizePicker/ConfirmDialog 均为 `fixed inset-0` overlay,但全仓无 `document.body.style.overflow` 设置。弹窗打开时滚轮/触摸穿透到背景(主区 `md:overflow-y-auto`),移动端 scroll chaining 明显。
**修复**:`useLockBodyScroll(enabled)` hook(计数器支持多层),打开设 `overflow:hidden` 关闭恢复;或 overlay 根节点加 `overscroll-behavior: contain`。

### M9 · 拖拽排序缺 KeyboardSensor,手柄宣称可拖拽但键盘无效
`src/components/TaskGrid.tsx:138-140,298-299` — accessibility
`DndContext` 只注册 `PointerSensor`。TaskCard 拖拽手柄是真实 `<button>`(可聚焦)并展开 `useSortable` 的 attributes(向 AT 宣告可拖拽),但键盘按空格/方向键无任何效果。
**修复**:加 `KeyboardSensor` + `@dnd-kit/sortable` 的 `sortableKeyboardCoordinates`。

### M10 · 通用 Select 组件无键盘可访问性
`src/components/Select.tsx:48-92` — accessibility
触发器是 `<div onClick>` 而非 button,无 role/tabIndex/aria-expanded/aria-haspopup;选项无 role=option 与键盘处理。被 SearchBar 等多处复用(`SearchBar.tsx:32`),影响面广。
**修复**:触发器改 `<button role="combobox" aria-expanded aria-haspopup="listbox">`,容器 `role="listbox"`,选项 `role="option"`,支持 ArrowUp/Down/Enter/Escape。

### M11 · Cloudflare 部署缺 /sw.js no-cache,SW kill-switch 逃生通道失效
`wrangler.jsonc:8-10` — correctness
`/sw.js` 绝不能被 HTTP 缓存是 kill-switch 硬契约(`nginx.conf:38-45` 已守)。但主部署在 Cloudflare Workers,`wrangler.jsonc` 无 `_headers`、无 header 配置(全仓无 `_headers` 文件),Workers Static Assets 默认带 ETag/边缘缓存,无法保证每次从网络取最新 sw.js → 翻车时救不回被旧 SW 锁死的用户。
**修复**:`public/` 下新增 Cloudflare `_headers`:`/sw.js` 设 `Cache-Control: no-cache, no-store, must-revalidate`,`/assets/*` 长缓存 immutable,`/index.html` no-cache;确认 `@cloudflare/vite-plugin` 透传 `public/_headers`。

### M12 · 全链路无 Content-Security-Policy
`index.html:1-36` — security
index.html 无 CSP meta;nginx/Caddy/cors-proxy/wrangler 均未下发 CSP(全仓 Grep 无结果)。应用在浏览器内持有密钥(IndexedDB/localStorage)且支持 `#apiKey=` 摄入,无 CSP 时任一 XSS(含供应链)都能外带密钥。
**修复**:反代层 + Cloudflare `_headers` 下发收敛 CSP(`default-src 'self'`;`connect-src` 列出 API 域;`img-src 'self' data: blob:`;`script-src 'self'`,内联引导脚本改 hash/外置)+ `frame-ancestors`;先用 Report-Only 验证。

### M13 · 单容器/HTTP+IP 模式无安全响应头
`nginx.conf:8-91` / `Caddyfile.lan` — security
app 的 nginx.conf 只设 `server_tokens off`,未加 `X-Content-Type-Options`/`X-Frame-Options`/`Referrer-Policy`。HTTPS-compose 由外层 Caddy 补,但 README「单容器快速试跑」直接暴露 nginx:80 时安全头全缺(可被任意站点 iframe 点击劫持、MIME 嗅探)。`Caddyfile.lan` 漏了 `X-Frame-Options`。
**修复**:把三项安全头直接加进 nginx.conf 的 server 块(`add_header ... always`);`Caddyfile.lan` 补 `X-Frame-Options`。

---

## 五、🟡 LOW(43 条)

> 以下均经对抗式核验确认成立。格式:`位置` — 类别 · 问题 / 修复。

**API · 图像生成**
- `imageApiShared.ts:41-67` — resource-leak · `mergeAbortSignals` 在请求正常完成后不移除 caller 信号上的 abort 监听器,长生命周期/并发复用同一 signal 时线性累积泄漏。**修复**:返回 dispose 函数在 finally 解绑,或改用 `AbortSignal.any` 并在 finally abort 本地 timeout controller。
- `geminiImageApi.ts:26-43,117-123,162-173` — correctness · Gemini 把任意精确尺寸静默映射到最近预设长宽比且不在 actualParams 回报,实际产图比例与所选不符且 UI 不可见。**修复**:映射设容差,把最终 aspectRatio/size 写入 actualParams。
- `imageApiShared.ts:85-87,108-110` — correctness · 图像输入大小校验对 base64 用字符串长度而非解码字节,阈值偏紧约 25%(同文件已有正确的 `getDataUrlDecodedByteSize`,两套口径不一)。**修复**:统一用解码字节,或常量明确为「字符长度上限」。
- `openaiCompatibleImageApi.ts:181,235` — correctness · `moderation` 字段无条件下发(OpenAI 特有),面向第三方兼容端点可能因未知字段被拒(quality/output_compression 都有条件分支,唯独它没有)。**修复**:加与 codexCli/兼容模式对应的条件开关。

**API · 辅助**
- `captionImageApi.ts:22-35,119-155` — error-handling · SSE 解析仅识别 `data:` 行,服务端 200 流中以 `event: error` 推送的错误被静默吞,最终抛含义不准的「结果为空」(optimizer 同)。**修复**:对非 data 行尝试解析 `{error:{message}}` 并抛出。

**持久化与数据**
- `exportImport.ts:239-246` — security · `imageFiles.path` 完全信任 ZIP 内容用于查表与推断 MIME,可构造成与 id 不一致/含 `..` 的路径,破坏 id↔内容一致性;未知扩展兜底 `image/png`。**修复**:校验 path 形如 `images/<id>.<ext>` 且与 id 匹配,拒绝 `..`/绝对路径,MIME 与 id 交叉校验。
- `exportImport.ts:104-133` — react-concurrency · `clearAllData`/`importData(replace)` 调 `clearImageCache`,但与并发 in-flight 的 `ensureImageCached` 竞态,可能把已删图重新写回内存缓存(僵尸缓存)。**修复**:imageCache 引入 generation/epoch,await 前后比对,变更则丢弃结果。
- `taskRuntime.ts:258-262` — resource-leak · `initStore` 删孤立图只 `deleteImage` 未配套 `deleteCachedImage`(与运行期删除路径不一致)。**修复**:补 `deleteCachedImage(img.id)`。
- `db.ts:205-212` — error-handling · `dataUrlToImageBlob` 用 atob 解码无容错,损坏 dataUrl 让 `putImage/storeImage` 在常见路径抛未捕获 DOMException。**修复**:atob/decodeURIComponent 包 try/catch,抛语义化错误。
- `db.ts:10-40` — correctness · `indexedDB.open` 未监听 `onblocked`,其它标签页持旧连接时版本升级被阻塞 → Promise 永久挂起,所有 DB 操作静默卡死。**修复**:加 `onblocked` 处理 + `onupgradeneeded` 事务 `onabort/onerror` + 超时兜底。

**状态管理与任务运行时**
- `taskRuntime.ts:38,93-96,424-451` — correctness · 缺用户级任务取消能力:`AbortController` 已建,`abortTaskRequest` 仅被超时 watchdog 内部调用,无任何 UI/导出入口让用户主动取消 running 任务。**修复**:导出 `cancelTask(taskId)`(abort + 清 watchdog + 标记已取消),TaskCard/DetailModal 加取消按钮。
- `store/persist.ts:41-55` — security · `partialize` 返回整个 settings,各 profile.apiKey 明文持久化进 localStorage,同源 XSS/扩展/共享设备可直接读取。**修复**:partialize 剥离 apiKey(运行期保留内存),或短生命周期存储 + UI 风险提示;若保留至少文档化。
- `taskRuntime.ts:457-488` — resource-leak · 成功分支先循环 `storeImage` 再二次校验状态,若任务在 storeImage 异步间隙被删/改状态则 return,已存输出图不回滚 → 永久孤立记录。**修复**:早退分支对已存 outputIds `deleteImage`+`deleteCachedImage` 回滚;或状态校验前移 + 单次原子提交。
- `store/slices/ui.ts:86-91` — correctness · `showToast` 自动关闭按 message 文本判等,并发同文案 toast 被上一个计时器提前清除。**修复**:每条 toast 生成自增 id,计时器闭包比对 id。
- `taskRuntime.ts:574-603` — correctness · `reorderTask` 混用 sortOrder 与 createdAt 量级,首/尾插入仅 ±1,易触发浮点精度坍塌或置顶失败。**修复**:首/尾用相对极值的大步长,精度逼近时一次性 renumber。

**图像处理库**
- `clipboard.ts:18-26` — error-handling · `blob.type` 为空时 ClipboardItem 键为空字符串,抛无意义错误且 `getClipboardFailureMessage` 无法识别。**修复**:`const type = blob.type || 'image/png'`(并据此转码)。
- `canvasImage.ts:73-112` — resource-leak · `createMaskPreviewDataUrl` 每次预览创建 3 个全尺寸 canvas 不主动释放,iOS Safari 总 canvas 内存上限场景下高分辨率频繁切换可能触发限制致 `getImageData/toDataURL` 失败。**修复**:返回前临时 canvas `width/height=0` 释放;或 overlay 用 `fillRect + globalCompositeOperation` 减少一块。
- `clipboard.ts:36-55` — correctness · `copyTextWithExecCommand` 选中临时 textarea 后未恢复原焦点/选区。**修复**:进入前保存 `activeElement` 与选区 range,finally 恢复。

**蒙版编辑器**
- `usePointerInteraction.ts:222-245,309-330` — correctness · Alt 平移手势不写入 `pointerPositionsRef`,触摸设备上第二指落下时 size 计数与真实指针数不一致,捏合判定少算一指。**修复**:所有 pointerdown 统一写入 ref,再依 altKey/数量决定走平移/绘制/捏合。
- `MaskEditorModal/index.tsx:233-258` — data-integrity · `handleSave` 先 `storeImage` 再校验令牌,关闭/切图竞态下产生未被引用的孤儿图片(内容寻址使影响有限)。**修复**:存在性/令牌校验前移到 storeImage 之前再补一次。

**输入栏 InputBar**
- `useDragDropFiles.ts:13-31` — correctness · 全局 `paste` 监听挂在 document 且不检查焦点 target,在其它弹窗/编辑器内粘贴图片会被错误塞进底栏参考图。**修复**:`handlePaste` 先判断 `activeElement` 是否在 InputBar 之外的可编辑元素/modal 内,是则 return。
- `InputBar/index.tsx:148-180` — data-integrity · 上传/拖放/粘贴图片无任何大小校验(只过滤类型+数量≤16),高分辨率大图易触发 IndexedDB 配额错误/内存压力。**修复**:加单文件大小上限并 toast 提示,可选客户端降采样。
- `InputBar/ImageGrid.tsx:50,222-226` — correctness · 移动端「只能有一张遮罩图」提示 `maskConflictNoticeShownRef` 一旦置 true 整生命周期不复位,移除重加遮罩后不再提示。**修复**:`maskTargetImage` 变不存在时复位 ref。
- `useDragDropFiles.ts:34-67` — correctness · 全页拖拽计数器在子元素进出/异常 dragleave 时可能失衡使遮罩卡住(拖出窗口外释放无兜底)。**修复**:加 `window` 的 `dragend`/`blur` 兜底归零;或 dragenter 仅在 `types.includes('Files')` 时计数。

**弹窗与设置面板**
- `SettingsModal/index.tsx:126-129` — performance · `isDirty` 每次渲染执行两次全量 `JSON.stringify`(含多组长文本 systemPrompt),每敲一字符都重算,输入大量文本可感知卡顿。**修复**:字段级浅比较或仅关闭/保存时计算;settings 侧 stringify 缓存。
- `PromptOptimizerModal.tsx:38-53` — react-concurrency · `onDelta` 是 `setOptimized(s=>s+chunk)` 不检查 `signal.aborted`,abort 与抛错之间的残余 chunk 会污染新流(点重试时新旧交错;caption 同)。**修复**:onDelta 加 `if (controller.signal.aborted) return`,或每次 run 分配 runId 全程校验。
- `SettingsModal/ModelListDropdown.tsx:87-103` — performance · 模型列表无虚拟化/无上限,聚合网关返回上千模型时一次性渲染全部 DOM。**修复**:搜索过滤 + 截断,或轻量虚拟滚动。
- `Lightbox.tsx:297-306` — correctness · 缩放态单击关闭依赖 `e.target instanceof HTMLImageElement`,点击落在 img 外的内部容器节点会误判为「图片外」而关闭。**修复**:改用 `closest('.saveable-image')` 或包裹容器 data 属性判断。
- `SizePickerModal.tsx:45-68` — accessibility · 唯独 SizePickerModal 未接入 `useCloseOnEscape`,ESC 无法关闭,与其它弹窗不一致。**修复**:调用 `useCloseOnEscape(true, onClose)`。
- `SettingsModal/DataManagementSection.tsx:22-34` — data-integrity · 导入进行中按钮无禁用/loading,可重复触发并发导入与 IndexedDB 清空/写入交错。**修复**:加 importing 状态禁用全部导入/导出/清空按钮,catch 复位。
- `ImageCaptionModal.tsx:55-62` — react-concurrency · 弹窗不关闭直接换源图时,旧流 abort 与停止之间的残余 chunk 污染新图描述(与流式竞态同源)。**修复**:onDelta 校验 aborted/runId。

**核心 UI · 拖拽 · 入场动画**
- `taskRuntime.ts:582-603` — data-integrity · gap-based 排序用中点 `(prev+next)/2` 且无任何重平衡,同间隙反复插入约 50 次后浮点精度耗尽,sortOrder 相等致排序抖动且数据层无法自愈。**修复**:相等键加 tiebreaker(createdAt/id),精度逼近时触发整段整数化重排。
- `TaskCard.tsx:73-87` — correctness · 移动端 swipe 的 `e.preventDefault()` 在 React 被动监听的 onTouchMove 中无效(控制台告警),横滑带纵向分量时页面仍滚动。**修复**:容器加 CSS `touch-action: pan-y`;或必须 preventDefault 时用 ref 手动 `addEventListener('touchmove', fn, {passive:false})`。
- `store/slices/ui.ts:86-91` — correctness · Toast 自动消失靠 message 判等(同上 ui slice 问题,从动画视角:同/异文案后到时 DOM 不重挂载,`toast-enter` 不重放)。**修复**:toast 加 id 作清除判据与 React key,每次先 clearTimeout 上一个句柄。
- `index.css:104-110,231-238,269-276` — accessibility · `toast-enter`(带 16px 位移)未纳入 `prefers-reduced-motion` 兜底(app-enter/glow-blob/card-enter 都有)。**修复**:reduced-motion 媒体查询追加 `.toast-enter { animation: none; }`(连同 modal/confirm/zoom)。
- `TaskGrid.tsx:42-83,300-346` — performance · `SortableTaskCard`/`TaskCard` 未 memo,且 map 内为每卡创建新内联闭包,框选 `setSelectedTaskIds` 时全网格重渲染。**修复**:`React.memo` + per-task 回调用稳定分发;isSelected 派生下沉。
- `App.tsx:94-95` — data-integrity · `initStore()` 无重入守卫,StrictMode 开发期挂载 effect 跑两次 → 迁移并发双跑竞态(仅开发环境)。**修复**:模块级 `inflight: Promise` 复用,保证迁移全局只跑一次。

**侧栏与杂项组件/工具**
- `lib/urlBootstrap.ts:57-60` — security · apiKey 可从查询串 `?apiKey=` 读取,在 `replaceState` 清理前已通过请求行/Referer 泄露给服务器日志。**修复**:仅从 hash 读取(删 `searchParams.get('apiKey')` 回退);若必须兼容查询串则告警。
- `hooks/useCloseOnEscape.ts:10-16` — correctness · 全局 ESC 栈非空时无条件 `preventDefault`,会吞掉输入框/IME 的原生 Escape(取消组合)。**修复**:先判 `e.isComposing` return,焦点在 input/textarea/contenteditable 时让栈顶 handler 自行决定是否 preventDefault。
- `Sidebar/ConversationItem.tsx:81-93,144-153` — correctness · 重命名 Enter 提交后 input 卸载触发 onBlur 二次 `commitRename`,造成重复 putConversation 与 updatedAt 二次跳动(幂等但冗余)。**修复**:提交后置 committedRef 标志使后续 blur 跳过。
- `ViewportTooltip.tsx:13-36` — performance · 定位 effect 以 `children`(ReactNode)为依赖,父组件每次重渲染都产生新引用 → 可见期间反复 `getBoundingClientRect` 强制重排 + 增删 resize 监听。**修复**:依赖改 `[visible]`,内容变化用 ResizeObserver。
- `cors-proxy.conf:35-37,72-75` — performance · 流式代理设了 `proxy_buffering off` 却又开 `gzip on`,对 application/json/text/plain 流做 gzip 缓冲会削弱 SSE 逐字输出。**修复**:对流式路径关 gzip,保留 proxy_buffering off。
- `public/sw.js:52-82` — resource-leak · fetch handler 对所有同源 GET 成功响应 `cache.put`,同一部署生命周期内无大小/TTL 上限只增不减(换部署即清,危害有限)。**修复**:运行时缓存收敛到 `/assets/` 等需离线路径或加 LRU 上限,其余 network-only。

---

## 六、⚪ INFO(15 条,提示/理论改进点)

> 经核验确认但严重度低,多为防御性一致性、边界健壮性或工程提示。

- `openaiCompatibleImageApi.ts:128-155,305-334` — 并发生成各子请求共用同一 caller signal,任一外部取消会取消全部(预期内,但叠加 `mergeAbortSignals` 监听器未清理会在 n 较大时放大累积)。结合 dispose 修复一并处理。
- `captionImageApi.ts:57,66` — `timeoutMs = Math.max(1, config.timeout)*1000`,config.timeout 为 NaN 时立即 abort、Infinity 时永不触发(生产经 normalize 兜底,但导出函数缺自我防御)。**修复**:`Number.isFinite && >0 ? : DEFAULT`。
- `devProxy.ts:13-35` — `normalizeBaseUrl` 对无 scheme 输入强制补 https 且失败分支返回原串,无主机白名单/明文告警,密钥外发面较大。**修复**:UI 对 http 端点告警;失败分支返回空串交上层判未配置。
- `exportImport.ts:248-328` — 导入成功提示用 `data.tasks.length` 而非实际写入条数,merge 模式数字偏大误导。**修复**:用循环累加的实际写入计数。
- `store/persist.ts:31-33` — 持久化的 `activeConversationId` 在 initStore 异步加载完成前指向尚不存在的对话(水合竞态,此窗口内 tasks 也为空故无可见错误)。**修复**:可接受现状;严格则用 hydrated 标志门控。
- `types.ts:188-189` — `conversationId` 类型标可选但运行期当必填用,迁移漏网任务会被过滤逻辑在非 gallery 视图永久隐藏。**修复**:迁移后收敛为必填,或过滤层显式处理 undefined。
- `useCursorOverlay.ts:45-63,109-117` — 光标叠加画布尺寸只在 `updateCursor` 内惰性同步,窗口缩放仅改 stage 尺寸而依赖未变时不刷新,可能基于过期尺寸绘制/残留。**修复**:为光标层单独挂观察 stage 的 ResizeObserver。
- `usePointerInteraction.ts:254-288,175-192` — 绘制未消费 `getCoalescedEvents()`,120/240Hz 高速笔画采样不足(round cap 保证不断笔,精细度有损)。**修复**:遍历 coalesced 事件逐点 drawStroke。
- `CanvasViewport.tsx:76-79` — `onPointerUp` 与 `onLostPointerCapture` 同绑 `finishStroke`,单次抬起可能触发两次(当前幂等,未来加非幂等副作用会出错)。**修复**:finishStroke 入口对已处理 pointerId 去重。
- `InputBar/index.tsx:194-213` — `handleCaptionFilePick` 用 `reader.result as string` 不校验即写 captionSource。**修复**:校验 `typeof === 'string' && startsWith('data:image/')`。
- `ImageCaptionModal.tsx:27-36` — 源图为空时提前 return 但未中止新建的 controller、不重置 abortRef(轻微状态不一致)。**修复**:空源校验移到 `new AbortController` 之前;或 return 分支 `abortRef.current = null`。
- `TaskCard.tsx:136-172` — 缩略图 effect 在 `outputImages` 清空时不重置 `thumbSrc`,done 且 outputImages 被清的中间态会显示过期封面。**修复**:effect else 分支 `setThumbSrc('')`。
- `ImageContextMenu.tsx:111-117` — `handleEdit` 用渲染期闭包快照的 `inputImages.length` 判 16 张上限,极短窗口内并发增图可能误放行。**修复**:改 `useStore.getState().inputImages.length`,或上限下沉到 `addInputImage`。
- `Sidebar/relativeTime.ts:34-42` — 对未来时间戳输出「X 分钟后」,时钟回拨/未来时间戳备份时侧栏语义不合理。**修复**:diff>0 时钳为「刚刚」。
- `package.json:8` — build 用 `tsc -b` 但 tsconfig 非 composite 且无 references,`vite.config.ts`/`scripts/*.mjs` 不在类型检查范围(其类型错误到运行时才暴露)。**修复**:用标准 Vite 多 tsconfig + references 结构,或改 `tsc --noEmit -p tsconfig.json`。

---

## 七、横切系统性主题(最值得集中治理)

这些不是简单复述单条,而是跨多文件反复出现的模式,应作为统一主题治理而非分散修。

### ① 【high】密钥可被发往应用自身源:空 baseUrl 一律退化为相对路径
`captionImageApi.ts:14-20` / `devProxy.ts:13-35` / `optimizePromptApi`(同范式) / `imageApiShared.ts`
所有出站 API 调用遵循同一 URL 构造范式:baseUrl 为空时退化为相对路径,把带 Bearer 的请求发到应用自身源。这是统一 URL 范式导致的系统性密钥泄露面。修复应在统一层对空 baseUrl **硬失败**。

### ② 【high】密钥全生命周期无纵深防御
`urlBootstrap.ts:57-60` → `persist.ts:41-55` → `index.html` / `nginx.conf` / `Caddyfile.lan`
URL query 摄入 apiKey(Referer/请求行泄露)+ localStorage 明文持久化 + 无 CSP/安全头。三者单独都是 low,合起来构成一条完整窃取链:XSS 或恶意第三方脚本可直接读 localStorage 明文密钥,CSP 缺失使 XSS 更易得手,URL 参数是现成入口。**作为统一的密钥安全主题治理。**

### ③ 【medium】取消/中止链路系统性不闭环
`taskRuntime.ts` / `imageApiShared.ts:41-67` / `PromptOptimizerModal` / `ImageCaptionModal`
AbortController 到处建,但「建立—触发—清理」三处都未闭环:无用户级取消入口、删任务不 abort、监听器正常完成路径不解绑。

### ④ 【medium】图片资源生命周期脆弱
`taskRuntime.ts` / `exportImport.ts` / `MaskEditorModal/index.tsx` / `imageCache.ts`
多写入点「先 storeImage 再校验」产生孤儿图;清理路径不一致(DB 删了缓存没删);导入非原子。根因是缺少统一的「引用计数 + 原子提交 + 缓存与 DB 成对增删」抽象。

### ⑤ 【medium】不可信外部数据缺乏统一校验/归一化
`exportImport.ts` / `InputBar/index.tsx` / `db.ts:205-212` / `imageApiShared.ts`
校验只集中在最外层 API 出站边界,所有本地持久化入口(导入 ZIP、上传/拖放/粘贴、损坏 dataUrl)都缺防护——**信任边界划错了位置**。

### ⑥ 【medium】自定义交互控件普遍缺键盘可访问性 + 弹窗行为不统一
`Select.tsx` / `TaskGrid.tsx` / `SettingsModal` / `SizePickerModal` / `useCloseOnEscape.ts` / `index.css`
裸 `div+onClick` 自造控件不复用语义元素。应通过共享可访问基础组件 + 统一弹窗外壳(scroll-lock/ESC/focus-trap/reduced-motion)解决。

### ⑦ 【medium】自托管/边缘部署链路安全基线缺失
`cors-proxy.conf` / `nginx.conf` / `Caddyfile.lan` / `wrangler.jsonc` / `public/sw.js` / `index.html`
多种部署后端共享「默认配置即不安全」:开放凭证代理 + 无安全头 + kill-switch 失效。

### ⑧~⑪ 【low】其它收敛主题
- 流式回调缺统一代际令牌守卫(abort 后旧增量污染新状态)。
- gap 排序浮点坍缩 + toast message 判等:用「值」代替「稳定 id」。
- base64/data URL 字节计量与编解码口径多处不一,手写 base64 散落多文件。
- 未 memo 化 + effect 依赖过宽导致渲染/重算放大。
- 剪贴板/MIME 处理对非 PNG 与空类型不鲁棒。

---

## 八、核验拦下的 5 条误报(对抗式核验生效证明)

1. `taskRuntime.ts:335-360`「空输入图崩溃」——**误读**:`orderInputImagesForMask` 第一行 `validateMaskTarget` 已先抛友好中文错误,崩溃路径到不了。
2. `taskRuntime.ts:416-452`「提交后切 Provider 用错配置」——**不成立**:`executeTask` 同步读 settings 与 submitTask 固化 provider 同处一条同步链,无让权点,窗口为零。
3. `AdvancedParamsPopover.tsx:68-88`「Esc stopPropagation 吞掉外层」——**被代码反驳**:document 级 popover 监听早于 window 级 escStack 触发,stopPropagation 恰好实现「只关最内层」,是正确行为。
4. `SettingsModal/index.tsx:271-279`「commitTimeout 陈旧闭包」——**风格瑕疵非 bug**:函数式 setDraft + 仅捕获 id,不会写脏。
5. `ImageContextMenu.tsx:162-170`「菜单高度估算裁切」——**高估**:实测单按钮约 36px,四项 152px ≤ 常量 160,且常量只用于向上翻转不用于裁剪。

---

## 九、本次审查的盲区(诚实标注)

- 运行时并发/竞态类发现(删在途任务、缓存竞态、流式 abort 写入、StrictMode 双跑)均为**静态推断**,未在真实浏览器复现。
- Service Worker 运行时缓存累积、Workers 边缘缓存与 `/sw.js` no-cache 交互未在实际部署环境验证。
- 跨浏览器差异未实测:剪贴板对 JPEG/WEBP 抛错、被动监听 preventDefault、execCommand、coalesced 事件——需 Chrome/Firefox/Safari + 移动真机分别验证。
- 密钥泄露链实际可利用性取决于反代/CDN 日志策略与是否存在 XSS sink,未做端到端渗透,也未审查已知 XSS sink。
- ZIP 安全仅看字段校验缺失,未评估 `fflate.unzipSync` 对 zip bomb / 路径穿越的边界。
- IndexedDB 升级异常路径(localStorage 不可用、onblocked、多标签并发)未在真实多标签 + 隐私模式验证。
- 审查按文件分区,跨文件数据流端到端(一张图 上传→缓存→持久化→导出→重新导入 的完整生命周期一致性)未做整链路追踪,可能遗漏分区交界处不变量违背。

---

## 十、与 lint 的交叉印证(审查未单列、lint 抓到的)

- `TaskCard.tsx:259-268` —— **render 期间访问 ref**(`ref={dragHandle.ref}` + render 中读 `dragHandle.disabled`),React 19 `react-hooks/refs` 新规则,建议核对本次拖拽手柄改动。
- `captionImageApi.ts` / `optimizePromptApi.ts` —— 抛错未挂 `cause`(`preserve-caught-error`),与主题⑧错误信息丢失同源。
- `useCloseOnEscape.ts:29` —— render 期间写 `handlerRef.current`(latest-ref 模式),属常见安全写法,可视作 lint 偏严。
- `paramDisplay.tsx:66` —— fast-refresh 混合导出(`react-refresh/only-export-components`),工程提示。

---

## 附录 · 审查方法与元数据

- **编排**:11 子系统并行深读(reviewer)→ 对抗式核验(verifier 逐条独立读源码、默认怀疑、只在能确认时判 isReal=true)→ 综合(横切归纳 + 完整性批判)。
- **规模**:23 个子代理,约 152 万 token,用时约 10.5 分钟。
- **置信度分布**:每条发现标注了 high/medium/low 置信度,运行时竞态类多为 medium/low(需运行复现)。
- **本报告仅审查、未改动任何代码。**
