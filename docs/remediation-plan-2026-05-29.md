# 修复路线图 · image-playground

> 生成日期:2026-05-29  ·  配套审查报告:`docs/code-review-2026-05-29.md`
> 来源:8 个修复工作包(各自重读真实源码)+ 路线整合,经多智能体设计。
> 原则:**不在 74 个点散修,而是先建共享抽象作为单一真源,再分批收敛。**

---

## 一、先建的共享基础(被多包复用,最先建立)

### chatCompletionsShared.ts (buildChatCompletionsUrl + resolveChatTimeoutMs + parseSseLine)
- **位置**:`src/lib/api/chatCompletionsShared.ts (新文件)`
- **用于**:WP1, WP6 (captionImageApi.ts / optimizePromptApi.ts 的 SSE 吞错对齐), WP2 间接(辅助 API URL 治理)
- **为何先建**:已核实 captionImageApi.ts:14-20 与 optimizePromptApi.ts:11-17 的 buildChatCompletionsUrl、:22-35/:19-32 的 parseSseLine 是逐字重复两份。这是 H1(密钥同源退化泄露)的根因载体,且 WP6 的 SSE 吞错修复也落在这两个文件。先建唯一真源,后续所有改动只改一处,消除并发修补冲突。改为 normalize 空则硬失败(throw)。

### assertAbsoluteHttpUrl / 复用 isHttpUrl
- **位置**:`src/lib/api/imageApiShared.ts (复用现有 isHttpUrl:69) 或 devProxy.ts 内联同正则`
- **用于**:WP1 (URL 守卫), WP3 间接(CSP connect-src 语义对齐)
- **为何先建**:imageApiShared.ts:69 已有 isHttpUrl(value):/^https?:\/\//i。WP1 需要它守卫 normalizeBaseUrl 的 catch 分支(devProxy.ts:32-34)返回的无 scheme 裸串(如 example/v1/...)被浏览器当同源相对路径解析的泄露面。优先直接复用,避免新增重复正则与 devProxy→imageApiShared 反向依赖。

### stripApiKeys (六处 apiKey 抹空清单的单一来源)
- **位置**:`src/lib/api/apiProfiles.ts`
- **用于**:WP2 (persist partialize + redactSettingsForExport)
- **为何先建**:已核实 persist.ts:41-55 partialize 把整个 state.settings 原样落 localStorage(含全部明文 key);exportImport.ts 的 redactSettingsForExport:52-78 已有逐字段抹 key 清单(6 处)。下沉为纯函数后导出与持久化共用一份清单,新增 profile 类型时不会两处各漏。放 apiProfiles.ts(已是 settings 形状归一中枢,无新循环依赖)。

### normalizeTask / normalizeTaskParams / normalizeTasks
- **位置**:`src/lib/tasks.ts (新文件,与 conversations.ts/favoriteCategories.ts 同级)`
- **用于**:WP5 (importData 写库前), 间接保护所有持久化反序列化入口
- **为何先建**:已核实 exportImport.ts:248-251 直接逐条 putTask 落 data.tasks,是导入链路中唯一无 normalize 的实体(conversations/categories 都有)。TaskRecord 的 Record 字段(actualParamsByImage/revisedPromptByImage)是 __proto__ 污染面。照搬 normalizeConversations 范式建白名单纯函数,作为 WP5 后续步骤的地基。

### terminateTaskRuntime + rollbackStoredImages + TASK_CANCELLED_ERROR
- **位置**:`src/lib/taskRuntime.ts`
- **用于**:WP4 (cancelTask/removeTask/removeMultipleTasks/executeTask 早退/MaskEditor 回滚)
- **为何先建**:已核实 abortTaskRequest:93/clearSyncHttpWatchdogTimer:85/clearTaskAbortController:89 三个清理函数分散存在,删除路径(removeTask/removeMultipleTasks)完全不调用它们(M6)。先在 taskRuntime 内建统一收口抽象,再统一改所有调用点,避免散点修补。注意 storeImage 内容寻址去重(db.ts:294),回滚需复用 stillUsed 引用检查。

### mergeAbortSignals 返回 {signal, dispose}
- **位置**:`src/lib/api/imageApiShared.ts:41-67`
- **用于**:WP4 (三个图像 API 文件的 finally 解绑)
- **为何先建**:已核实当前 mergeAbortSignals 只在 abort 时 cleanup,正常完成不解绑 listener(行 63-65 注册)。改返回 dispose 供三处图像 API 在已有 finally{clearTimeout} 里调用。0/1 signal 分支返回 no-op dispose 保持调用方统一。为 WP4 取消链路的地基。

### compareTaskOrder / getTaskSortKey + SORT_STEP/SORT_EPSILON/renumberTaskSortOrders
- **位置**:`src/lib/taskRuntime.ts`
- **用于**:WP8 (taskFilters.ts 排序 + reorderTask 自愈重排)
- **为何先建**:已核实 filterAndSortTasks 排序键混用 sortOrder 与 createdAt 量级且无 tiebreaker,reorderTask 中点 (prev+next)/2 反复同隙插入坍缩。统一比较器(id 作 tiebreaker)+ 整数重排自愈,三处口径单一来源,不改持久化 schema。WP8 内部地基。

---

## 二、PR 批次序列(按依赖与风险)

### 批次 1 · 安全-密钥出站硬失败 + URL 构造统一 (WP1)  `effort:M`
- **包**:WP1
- **理由**:最高优先级安全修复。已核实 H1 根因:buildChatCompletionsUrl 在 normalize 空时 return '/v1/chat/completions' 同源相对路径,随后带 Authorization: Bearer POST,密钥直发部署源。改为硬失败 + assertAbsoluteHttpUrl 守卫 catch 分支裸串。同时建 chatCompletionsShared.ts 唯一真源(被 WP6 复用),并在 apiProfiles 归一层 + SettingsModal index.tsx:188/201 补 || DEFAULT_SETTINGS.baseUrl 兜底(已核实 188/201 仅 .trim() 无兜底,177 有)。自洽无前置依赖,先落让 WP6 在其上对齐。

### 批次 1 · 安全-部署/边缘基线 (WP3)  `effort:M`
- **包**:WP3
- **理由**:最高优先级安全修复,且几乎不碰 React/TS 业务代码(纯 nginx/Caddy/_headers/sw.js 配置),回归面与 WP1 完全隔离,可与 WP1 并行同批。已核实 cors-proxy.conf 反射 $http_origin + Allow-Credentials:true 开放凭证代理;wrangler.jsonc 是纯静态资产部署,public/_headers 原生生效。CSP 必须 connect-src/img-src 放 https:(任意 baseUrl 生图 + fetchImageUrlAsDataUrl 拉任意远程图,见 imageApiShared.ts:128),只做框架级收紧。

### 批次 2 · 核心可用性-Responses 解析 + 剪贴板 + 流式竞态 (WP6)  `effort:L`
- **包**:WP6
- **理由**:最严重正确性 bug,直接打断核心生图。已核实 M1:ResponsesOutputItem.result 类型为 string|{b64_json?|image?|data?}(types.ts:242-255),但 openaiCompatibleImageApi.ts:96-103 只走 typeof result==='string' 分支,对象形态被静默丢弃→明明返图却抛'接口未返回可用图片数据'。依赖 WP1 已建的 chatCompletionsShared.ts(SSE 吞错对齐两处),故排 WP1 之后。新建 useStreamingText hook 根治两 Modal 的 onDelta 无 abort 守卫竞态。

### 批次 3 · 资源生命周期-取消链路 + 图片资源闭环 (WP4)  `effort:L`
- **包**:WP4
- **理由**:正确性+资源泄露修复。已核实 M6:删除任务路径(removeTask/removeMultipleTasks)不 abort/不清 watchdog;mergeAbortSignals 正常完成不解绑 listener;executeTask 早退分支不回滚已 storeImage 的图(孤儿/僵尸缓存)。与 WP6 文件不重叠(WP6 改 Modal/canvasImage/imageApiShared 的 extractResponsesImageBase64;WP4 改 imageApiShared 的 mergeAbortSignals),但同改 imageApiShared.ts 需协调合并顺序,故 WP6 之后单批。

### 批次 3 · 纵深-密钥摄入与客户端存储 (WP2)  `effort:M`
- **包**:WP2
- **理由**:纵深防御类安全(非紧急泄露,故晚于 WP1/WP3)。路径A(hash-only 摄入)低风险必做:已核实 urlBootstrap.ts:57 apiKey 来源为 hashParams??searchParams,查询串会进 access log/Referer,收窄为仅 hash。路径B第2档(session 级,stripApiKeys 抹 partialize)。与 WP8 同改 ui.ts(WP8 改 toast,WP2 改/复刻 banner 三件套)需协调,故与 WP4 同批但避免与 WP8 撞 ui.ts。

### 批次 4 · 健壮性-不可信输入校验 + 导入/迁移原子性 (WP5)  `effort:L`
- **包**:WP5
- **理由**:大重构,靠后。已核实 tasks 是导入链路唯一无 normalize 实体(exportImport.ts:248-251 直接 putTask);replace 模式 clearTasks/Images/Conversations 是三独立事务,中途失败留半残(M5);__proto__ 污染面在 TaskRecord 的 Record 字段。新建 normalizeTask/replaceAllData。与 WP4 在 taskRuntime.ts initStore 有文件级邻接(无逻辑耦合),故排 WP4 之后避免合并冲突。

### 批次 5 · 重构-可访问性 + 弹窗外壳统一 (WP7)  `effort:L`
- **包**:WP7
- **理由**:纯重构、低安全/正确性紧迫度,触碰面最广(7 个弹窗 + Select + TaskGrid),放最后。新建 useLockBodyScroll/useFocusTrap/ModalShell 并逐个迁移弹窗。与 WP6(PromptOptimizerModal/ImageCaptionModal)、WP2(banner)、WP8(TaskGrid/TaskCard)有弹窗与网格文件重叠,必须在它们稳定后合并以免反复 rebase。

### 批次 5 · 性能+杂项正确性 (WP8)  `effort:L`
- **包**:WP8
- **理由**:大重构靠后,但内含若干 quickWin(toast id、relativeTime 钳制)。已核实 ui.ts:89 toast 按 message 文本判等→并发同文案误清。与 WP2 同改 ui.ts(WP8 toast / WP2 banner),与 WP7 同改 TaskGrid/TaskCard,故与 WP7 同批末位统一落地,作为 ui.ts/TaskGrid 相关条目的唯一改动方。compareTaskOrder/renumber 不改持久化 schema。

---

## 三、Quick Wins(单文件、低风险,可立即落地)

- WP2 路径A(hash-only 摄入):urlBootstrap.ts:57 把 apiKey 来源由 hashParams??searchParams 收窄为仅 hashParams,apiKey 仍留 BOOTSTRAP_KEYS(:4)让 ?apiKey= 被 cleanSearchParams 抹掉。单文件、单测已有 'prefers ... from URL hash' 用例,零迁移风险,立即消除查询串泄露。
- WP1 兜底对齐:SettingsModal index.tsx:188/201 补 || DEFAULT_SETTINGS.baseUrl,与已存在的 177 行图像 profile 兜底对齐。一行级改动,堵住辅助 API 空 baseUrl 落盘。
- WP8 toast id:ui.ts:86-91 showToast 加自增 id,setTimeout 闭包比对 get().toast?.id===id 取代 message 文本判等,Toast.tsx 用 id 作 React key 重放入场动画。修复并发同文案误清,改动局部。
- WP8 relativeTime 未来时间钳为'刚刚';ConversationItem Enter+blur 二次提交用 committedRef 守卫——独立局部守卫,无跨文件依赖。
- WP6 三个 low:captionImageApi/optimizePromptApi 的 SSE 吞错误体补解析、getDataUrlEncodedByteSize 口径修正(当前 imageApiShared.ts:85-87 直接 return dataUrl.length 含 data: 前缀与 base64 膨胀)、createMaskPreviewDataUrl canvas 释放——各自独立 helper 内修。
- WP5 low:exportImport getMimeFromPath 旁加 validateImageEntryPath(强制 images/<id>.<ext> 且 ext 白名单),拒绝 '..'/绝对路径;atob try/catch;openDB onblocked——零结构改动的防御补丁。
- WP4 initStore 补 deleteCachedImage(taskRuntime.ts:258-262 删孤立图未删缓存)——单点补一行,与运行期删除路径一致。
- WP3 SW 缓存上限 + 流式关 gzip:独立小改,与安全头清单解耦,可单独并行落地。

---

## 四、跨包冲突点(实施时必须串行)

- imageApiShared.ts 三方改动:WP1 复用其 isHttpUrl 建 assertAbsoluteHttpUrl;WP4 改 mergeAbortSignals 返回 {signal,dispose};WP6 新增 extractResponsesImageBase64。三处虽是不同函数,但同文件并发会产生合并冲突。建议按 WP1→WP6→WP4 顺序串行落地该文件,或约定 WP4 仅追加 dispose 不动其余。
- taskRuntime.ts 四方改动:WP4(terminateTaskRuntime/rollbackStoredImages/cancelTask/TASK_CANCELLED_ERROR)、WP5(initStore 幂等/shouldRunReseed 主轴改 hasOrphanTasks)、WP8(compareTaskOrder/renumberTaskSortOrders)、WP1 间接无关。WP4 与 WP5 都改 initStore 区域,WP8 改排序区域。WP4/WP5 需明确合并顺序(建议 WP4 先,WP5 在其基础上改 initStore reseed 判据)。
- ui.ts 双方改动:WP2 复刻 dismissedPlaintextKeyBanner 三件套(slice 字段+setter+partialize+mergePersistedStoreState),WP8 改 showToast(:86-91)的 toast id。摘要指出 ui.ts:86-91 被主题10 与动画视角重复列出——必须确定 WP8 为 toast 唯一落地点,WP2 只动 banner 字段,二者互不覆盖。
- persist.ts partialize 双方改动:WP2 路径B第2档用 stripApiKeys 抹 key + 新增 banner 持久化字段,任何新增持久化字段的 WP 都会与之冲突。当前仅 WP2 动 partialize,需确保 WP5/WP8 不顺手往 partialize 加字段。
- 弹窗文件多方改动:WP7 把 7 个弹窗迁移到 ModalShell;WP6 改 PromptOptimizerModal/ImageCaptionModal 的流式逻辑(useStreamingText);WP2 在弹窗体系外加 banner。WP7 是结构性重构,若先于 WP6 落地会让 WP6 在新外壳里改;建议 WP6 先稳定 Modal 内部逻辑,WP7 最后做外壳收敛,避免 WP6 改动被 WP7 重写。
- TaskGrid/TaskCard 双方改动:WP8 加 React.memo + 稳定 per-task useCallback 分发;WP7 给 TaskGrid 接 KeyboardSensor、消除 TaskCard 拖拽手柄 ref-in-render 警告。两者都重排 TaskCard props/回调,需同批协调(同为 batch5)以免 memo 依赖与 sensor/handle 改动互相破坏。
- exportImport.ts 多方改动:WP5 改 importData(normalizeTask + replaceAllData + validateImageEntryPath),WP2 把 redactSettingsForExport 改为调用 stripApiKeys。WP2 只动导出抹 key 行为、WP5 只动导入归一/原子性,函数不重叠但同文件,需协调合并。
- index.html 内联脚本 hash 弱耦合:WP3 对 index.html:14-30 theme 引导脚本算 SHA-256 放入 script-src。任何改 index.html 内联脚本的 WP 都会使 hash 漂移。建议 WP3 step2 的 hash 校验作为公共守卫先落地,让后续改 index.html 自动暴露 hash 失效。
- devProxy.ts 合并顺序:WP1 step6 对 buildApiUrl 的改动若与图像 API 相关改动并行需协调。当前无其它 WP 改 buildApiUrl,但 WP1 内部 assertAbsoluteHttpUrl 若内联进 devProxy 而非复用 imageApiShared.isHttpUrl,会引入 devProxy→imageApiShared 反向依赖,需按可行性注记优先复用现有 isHttpUrl。

---

## 五、各工作包详细方案

## WP1 · 密钥出站硬失败(统一 URL 构造)

**工作量** `M` · **依赖** none(本 WP 自洽)。注意与"apiKey 改 hash-only / CSP"那条(H1 第二半)是同一治理主题的姊妹 WP,但本 WP 不依赖它;step6 对 buildApiUrl 的改动若与图像 API 相关 WP(如 M1 Responses 解析)并行,需协调 devProxy.ts 的合并顺序。

### 总体思路

核心思路:把"空/非法 baseUrl 退化为同源相对路径"这一系统性泄露面在两个层面同时封堵——(1) 在 URL 构造层做硬失败,(2) 在配置归一/提交层做默认兜底,使空 baseUrl 在落盘前就被恢复为合法默认值,运行期再有第二道闸。

读真实代码后确认的关键事实:
1. `buildChatCompletionsUrl` 在 captionImageApi.ts:14-20 与 optimizePromptApi.ts:11-17 是**逐字重复**的两份;两处都在 `normalizeBaseUrl` 返回空串时 `return '/v1/chat/completions'`(同源相对路径),随后带 `Authorization: Bearer` POST → 密钥发往部署源。这是 H1 的根因。
2. 同源退化不止辅助 API:`buildApiUrl`(devProxy.ts:57-74)第 73 行 `normalizedBaseUrl ? ... : '/${apiPath}'` 对图像 API 也有同样退化(主题1),但图像 profile 提交时走了 `normalizeBaseUrl(profile.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl)`(index.tsx:177)有兜底,辅助 API(188/201 行)只 `.trim()` 无兜底——所以辅助 API 风险更高。
3. `DEFAULT_BASE_URL` 在 apiProfiles.ts:16 是**模块私有 const,未导出**;`index.ts` 也只 re-export 了 `normalizeBaseUrl`。审查建议的"api 文件回退 DEFAULT_BASE_URL"不可直接 import,需先导出或改走"硬失败"路线。
4. `normalizeBaseUrl` 的 catch 分支(devProxy.ts:32-34)对无法 `new URL()` 解析的非空串返回 `trimmed.replace(/\/+$/, '')`——可能是一个**无 scheme 的裸串**(因为补 https 只发生在 try 分支前的 input 计算,catch 直接用 trimmed),拼出的 URL 形如 `example/v1/chat/completions`,浏览器会当相对路径解析到同源,同样泄露(info devProxy)。

最终方案采用"硬失败为主、默认兜底为辅"的组合,优先级:
- 抽取共享 helper `buildChatCompletionsUrl` 到一个共享文件(消除两份重复),并改为:normalize 为空时 `throw new Error('未配置 API URL')`;同时复用一个新的"安全 URL 守卫"`assertAbsoluteHttpUrl`,对 normalize 后仍非 http(s) 绝对 URL 的结果(catch 分支的裸串)也硬失败。
- 在 apiProfiles.ts 的 `normalizeCaptioner`/`normalizePromptOptimizer` 里把空 baseUrl 兜底为 `defaults.baseUrl`(= DEFAULT_BASE_URL),与 timeout/model/systemPrompt 已有的"空走默认"范式一致,堵住落盘入口。
- SettingsModal commitSettings 第 188/201 行补 `|| DEFAULT_SETTINGS.baseUrl` 兜底,与图像 profile 第 177 行对齐。
- 顺带修 info timeout:把 `Math.max(1, config.timeout)` 改为带 `Number.isFinite && >0` 自我防御的共享 helper。
- info devProxy 的"UI 对 http 端点告警"列为可选 S 级增强,本 WP 不强制(属一致性提示,非泄露主因)。

### 共享抽象

- **buildChatCompletionsUrl(+ resolveChatTimeoutMs)** — `src/lib/api/chatCompletionsShared.ts (新文件)`
  ```ts
  export function buildChatCompletionsUrl(baseUrl: string): string  // normalize 为空或非绝对 http(s) URL 时 throw new Error('未配置 API URL');export function resolveChatTimeoutMs(timeoutSeconds: number, fallbackSeconds: number): number
  ```
  消除 captionImageApi.ts:14-20 与 optimizePromptApi.ts:11-17 两份逐字重复的 buildChatCompletionsUrl。统一为:normalize→空则硬失败,非空则按 endsWith('/v1') 拼 /chat/completions。内部调用 assertAbsoluteHttpUrl 守卫,避免 catch 分支裸串退化同源。resolveChatTimeoutMs 收口两处 Math.max(1, config.timeout)*1000 的 NaN/Infinity 隐患。两个 SSE 文件还各有一份逐字相同的 parseSseLine,可一并抽到此文件(可选,降低重复)。
- **assertAbsoluteHttpUrl / isAbsoluteHttpUrl** — `src/lib/api/devProxy.ts (与 normalizeBaseUrl 同文件,复用 isHttpUrl 的正则范式)`
  ```ts
  export function isAbsoluteHttpUrl(value: string): boolean  // /^https?:\/\//i.test(value)
  ```
  判定 normalizeBaseUrl 输出是否为绝对 http(s) URL。imageApiShared.ts:69 已有等价的 isHttpUrl(value: unknown),优先直接复用 isHttpUrl,无需新增——见 feasibilityNote。仅当为避免 devProxy→imageApiShared 反向依赖时才在 devProxy 内联同一正则。

### 步骤

#### 1. H1 / 主题1 共享抽象 — `src/lib/api/chatCompletionsShared.ts` @ 新文件

**改动**:新建共享文件,导出 buildChatCompletionsUrl(baseUrl) 与 resolveChatTimeoutMs(timeoutSeconds, fallbackSeconds)。buildChatCompletionsUrl 内部:先 normalizeBaseUrl,空串则 throw '未配置 API URL';再用 isHttpUrl 守卫(catch 分支裸串会非 http→也 throw);通过后按现有逻辑 endsWith('/v1') 拼接。可选:把两份重复的 parseSseLine 也搬来此处统一导出。

```ts
import { normalizeBaseUrl } from './devProxy'
import { isHttpUrl } from './imageApiShared'

export function buildChatCompletionsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized || !isHttpUrl(normalized)) {
    throw new Error('未配置 API URL')
  }
  return normalized.endsWith('/v1')
    ? `${normalized}/chat/completions`
    : `${normalized}/v1/chat/completions`
}

export function resolveChatTimeoutMs(timeoutSeconds: number, fallbackSeconds: number): number {
  const s = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds : fallbackSeconds
  return s * 1000
}
```
> 可行性:isHttpUrl 在 imageApiShared.ts:69 已存在且签名为 (value: unknown): value is string,可直接 import 复用,无需新增 isAbsoluteHttpUrl。需注意 import 方向:chatCompletionsShared 同时依赖 devProxy 和 imageApiShared,二者互不依赖,无环。若担心耦合,也可在本文件内联正则 /^https?:\/\//i.test(normalized)。timeout 用秒级 fallback 而非 ms,调用点传 DEFAULT_OPTIMIZER_TIMEOUT/DEFAULT_CAPTIONER_TIMEOUT。

#### 2. H1(captionImageApi)+ info timeout — `src/lib/api/captionImageApi.ts` @ 行 14-20 的 buildChatCompletionsUrl 定义;行 2 import;行 57 timeoutMs

**改动**:删除本文件内 buildChatCompletionsUrl 定义(14-20),改从 chatCompletionsShared import;行 57 的 `Math.max(1, config.timeout) * 1000` 改为 resolveChatTimeoutMs(config.timeout, DEFAULT_CAPTIONER_TIMEOUT)。buildChatCompletionsUrl 现会 throw,而 url 计算(行 56)在 try 之外、apiKey/图片校验之后——throw 会以同步异常冒泡到 ImageCaptionModal 的 .catch,语义与现有'未配置 API Key'一致。

```ts
import { buildChatCompletionsUrl, resolveChatTimeoutMs } from './chatCompletionsShared'
import { DEFAULT_CAPTIONER_TIMEOUT } from './apiProfiles'
// ...
const url = buildChatCompletionsUrl(config.baseUrl)
const timeoutMs = resolveChatTimeoutMs(config.timeout, DEFAULT_CAPTIONER_TIMEOUT)
```
> 可行性:DEFAULT_CAPTIONER_TIMEOUT 已在 apiProfiles.ts:39 导出,可直接 import,不引入新导出。buildChatCompletionsUrl 的 throw 发生在行 56(早于 fetch 与 setTimeout 行 66),不会泄漏未清理的 timer,无需额外 try/finally。

#### 3. H1(optimizePromptApi)+ info timeout — `src/lib/api/optimizePromptApi.ts` @ 行 11-17 的 buildChatCompletionsUrl 定义;行 2 import;行 53 timeoutMs

**改动**:与 step2 完全对称:删除本文件 buildChatCompletionsUrl(11-17),改 import 共享版;行 53 改 resolveChatTimeoutMs(config.timeout, DEFAULT_OPTIMIZER_TIMEOUT)。

```ts
import { buildChatCompletionsUrl, resolveChatTimeoutMs } from './chatCompletionsShared'
import { DEFAULT_OPTIMIZER_TIMEOUT } from './apiProfiles'
// ...
const url = buildChatCompletionsUrl(config.baseUrl)
const timeoutMs = resolveChatTimeoutMs(config.timeout, DEFAULT_OPTIMIZER_TIMEOUT)
```
> 可行性:DEFAULT_OPTIMIZER_TIMEOUT 已在 apiProfiles.ts:25 导出。若 step1 把 parseSseLine 也抽到共享文件,本文件 19-32 的同名函数一并删除并 import;若不抽则保持现状(parseSseLine 重复属低优,不在 H1 范围,可不动以缩小 diff)。

#### 4. H1 落盘入口(normalize 空 baseUrl 视为合法) — `src/lib/api/apiProfiles.ts` @ normalizePromptOptimizer 行 68;normalizeCaptioner 行 134

**改动**:把两处 `baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : defaults.baseUrl` 改为追加 trim 判空:非字符串或 trim 后为空都回退 defaults.baseUrl(= DEFAULT_BASE_URL)。与同函数内 model/systemPrompt 的'空走默认'范式一致,堵住空 baseUrl 落盘。

```ts
baseUrl:
  typeof record.baseUrl === 'string' && record.baseUrl.trim()
    ? record.baseUrl
    : defaults.baseUrl,
```
> 可行性:这会改变现有行为:旧逻辑保留空串,新逻辑兜底为默认。需检查 apiProfiles.test.ts 是否有断言空 baseUrl 保留——经核查现有用例(行 240-280、314-337 等)均传非空 baseUrl,无空串保留断言,故不破坏现有 206 用例。注意保持原串不 trim 写回(只用 trim 判空,与 model 行 71/136 的现有写法一致——它们也是判空但写回原值)。

#### 5. H1 提交入口(SettingsModal 仅 trim 无兜底) — `src/components/SettingsModal/index.tsx` @ commitSettings 内 normalizedOptimizerProfiles 行 188;normalizedCaptionerProfiles 行 201

**改动**:把 `baseUrl: profile.baseUrl.trim()` 改为 `baseUrl: profile.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl`,与图像 profile 第 177 行 `normalizeBaseUrl(profile.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl)` 的兜底范式对齐。归一仍交给随后调用的 normalizeOptimizerProfile/normalizeCaptionerProfile(它们内部已含 step4 的兜底,形成双保险)。

```ts
// 行 188(optimizer)
baseUrl: profile.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl,
// 行 201(captioner)
baseUrl: profile.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl,
```
> 可行性:DEFAULT_SETTINGS 已在本文件行 15 import。是否对辅助 API 也套 normalizeBaseUrl(像 177 行那样)需权衡:辅助 API 历史上不 normalize(保留用户原样 URL,见 188/201 现状),为最小改动且不改变 normalize 语义,建议仅加 `|| DEFAULT_SETTINGS.baseUrl` 兜底,不额外套 normalizeBaseUrl;归一由 step4 在 normalizeOptimizerProfile/normalizeCaptionerProfile 内统一负责。

#### 6. 主题1(buildApiUrl 图像 API 同源退化) — `src/lib/api/devProxy.ts` @ buildApiUrl 行 73

**改动**:评估是否一并硬失败:行 73 `return normalizedBaseUrl ? ... : '/${apiPath}'`。当 useApiProxy=false 且 normalizedBaseUrl 为空时退化同源。建议:非 proxy 分支为空时 throw '未配置 API URL'(与辅助 API 对齐)。proxy 分支(行 69-71)用相对 prefix 是预期行为(同源反代),保持不变。

```ts
if (useApiProxy) {
  return `${proxyConfig?.prefix ?? DEFAULT_PROXY_PREFIX}/${apiPath}`
}
if (!normalizedBaseUrl) throw new Error('未配置 API URL')
return `${normalizedBaseUrl}/${apiPath}`
```
> 可行性:⚠ 需谨慎:devProxy.test.ts 现有 4 个用例均传非空 baseUrl,不会破坏。但 buildApiUrl 被 listModels.ts:7、openaiCompatibleImageApi.ts:222/249/363 调用,且图像 profile 提交时已有 DEFAULT_SETTINGS.baseUrl 兜底(index.tsx:177),空 baseUrl 实际很难到达此处。此步属防御纵深,优先级低于 step1-5;若想缩小回归面可拆为后续小 WP,或仅加 throw 不改 proxy 分支。本 WP 的 H1 主泄露面在 step1-5 已闭合,step6 标记为可选增强。

#### 7. info devProxy(http 端点告警,可选 S) — `src/components/SettingsModal/OptimizerSection.tsx / CaptionerSection.tsx / ApiProfileSection.tsx` @ API URL input 下方说明文字(OptimizerSection 行 88-90)

**改动**:可选增强:当 baseUrl 以 http:// 开头时,在 API URL 输入框下方追加一行 amber 文案提示'明文 HTTP 传输,密钥可能被中间人窃取'。纯展示,不拦截提交。

```ts
{/^http:\/\//i.test(optimizer.baseUrl.trim()) && (
  <div className="mt-1 text-xs text-amber-500">明文 HTTP 传输,密钥可能在传输中被窃取,建议使用 https。</div>
)}
```
> 可行性:此为一致性/告警增强,非 H1 泄露主因(http 仍是用户显式配置的绝对 URL,不会退化同源)。建议本 WP 仅列为可选,避免扩大 UI diff;如纳入则三个 Section 共用一个小 helper 组件 HttpWarning 以免重复。

### 测试策略

沿用现有 vitest 模式(vi.stubGlobal('fetch', fetchMock) + makeSseResponse),新增/修改如下:

1. 新建 src/lib/api/chatCompletionsShared.test.ts(单测共享 helper):
   - buildChatCompletionsUrl('') / '   ' → toThrow(/未配置 API URL/)
   - buildChatCompletionsUrl('https://api.example.com') → 'https://api.example.com/v1/chat/completions'
   - buildChatCompletionsUrl('https://api.example.com/v1') → '.../v1/chat/completions'(不重复 v1)
   - buildChatCompletionsUrl('not a url with spaces') 这类 catch 分支裸串 → toThrow(对齐 isHttpUrl 守卫;注意 'example.com' 这种会被 normalizeBaseUrl 的 try 分支补 https 成功,不会 throw——用真正不可解析或补 https 后仍非 http 的输入做断言)
   - resolveChatTimeoutMs(NaN, 60) → 60000;resolveChatTimeoutMs(Infinity, 60) → 60000;resolveChatTimeoutMs(30, 60) → 30000;resolveChatTimeoutMs(-5, 60) → 60000

2. 扩充 captionImageApi.test.ts / optimizePromptApi.test.ts(已有 baseConfig 模式):
   - 新增用例:baseUrl 为空串时 captionImageStream/optimizePromptStream rejects toThrow(/未配置 API URL/) 且 expect(fetchMock).not.toHaveBeenCalled()(关键回归断言:证明密钥未发出)
   - 现有'请求 URL 含 /v1/chat/completions'用例保持绿(baseConfig.baseUrl 非空)

3. 扩充 apiProfiles.test.ts(已有 normalizeSettings - promptOptimizer / captioner profiles 块):
   - normalizePromptOptimizer / normalizeCaptioner 传 baseUrl:'' 与 '   ' → 结果 baseUrl === DEFAULT_BASE_URL(可经 normalizeSettings({promptOptimizer:{baseUrl:''}}) 断言 result.promptOptimizer.baseUrl 为非空默认)

4. devProxy.test.ts(若做 step6):新增 buildApiUrl('', 'images/generations', null, false) → toThrow;buildApiUrl('', path, proxy, true) 仍返回 proxy 相对路径不 throw。

5. 运行 npx vitest run 全量 206+ 用例 + npx tsc --noEmit 确认类型干净。SettingsModal 改动(step5/7)无单测覆盖,需手动验证:清空辅助 API URL→保存→重开设置应显示默认 URL;触发反推/优化在空 URL 下应报'未配置 API URL'而非静默 POST 到同源(可在 devtools Network 确认无对自身源的 chat/completions 请求)。

### 回归风险

1. 行为变更(step4):normalizeCaptioner/normalizePromptOptimizer 对空 baseUrl 从'保留空串'改为'兜底默认'。理论上若有用户依赖空 baseUrl 走同源代理(自托管反代场景),此改动会让其 URL 变为 DEFAULT_BASE_URL。但同源代理的正规路径是 apiProxy/devProxy 机制(buildApiUrl 的 proxy 分支),辅助 API(caption/optimize)根本不接 proxyConfig,空 baseUrl 走同源纯属泄露 bug 而非特性,故此风险可接受;且兜底默认值正是 DEFAULT_BASE_URL(api.openai.com),不会指向部署源。
2. 硬失败 vs 兜底的双轨:step1(URL 层 throw)与 step4/5(配置层兜底)叠加后,正常情况下空 baseUrl 在落盘时已被兜底,运行期 throw 几乎不会触发——这是预期的纵深防御,但要确保两者错误文案/语义不冲突(URL 层统一用'未配置 API URL')。
3. step6(buildApiUrl 改 throw)回归面相对大:被 4 处图像 API 调用点引用,需确认所有调用前 baseUrl 都已兜底(经查 index.tsx:177 已兜底),否则会把原先静默退化变成抛错。建议 step6 标记可选/可拆分,优先合入 step1-5。
4. 文案与可读性:throw '未配置 API URL' 会经 ImageCaptionModal/PromptOptimizerModal 的 .catch 显示到 errorMessage,UI 已有 isError 分支(ImageCaptionModal 行 144、PromptOptimizerModal 行 144),无需改 UI。
5. parseSseLine 抽取(可选):若一并抽取需同步删两处定义并 import,扩大 diff;若只为 H1 可不动,降低风险。

---

## WP2 · 密钥摄入与客户端存储纵深(apiKey hash-only 摄入 + localStorage 明文密钥风险降低)

**工作量** `M` · **依赖** none(自包含)。若仓库另有 WP 同时改 persist.ts 的 partialize / mergePersistedStoreState 或 settings slice(如新增持久化字段),需与本包协调合并,避免对 partialize 的并发改动冲突;但无硬依赖。

### 总体思路

读完真实代码后,本工作包拆成两条相互独立、可分别交付的路径。

路径 A(低风险、必做)——「hash-only 摄入」:在 src/lib/urlBootstrap.ts 的 readUrlBootstrap() 里,把 apiKey 的来源从「hashParams ?? searchParams」收窄为「仅 hashParams」。原因:URL 查询串(?apiKey=)会出现在请求行、access log、Referer、CDN/Worker 日志里,在清理 history 之前就已泄露;而 hash 片段(#apiKey=)永不随 HTTP 请求发送,这正是当前实现已偏好 hash 的初衷(见 urlBootstrap.test.ts 用例名 "prefers one-time API keys from the URL hash")。注意 apiKey 仍要保留在 BOOTSTRAP_KEYS(line 4)里,这样即使用户误用 ?apiKey= 也会被 cleanSearchParams 从可见 URL 里抹掉(只是不再被摄入)。其余 4 个 bootstrap 参数(apiUrl/codexCli/apiMode/provider)不含机密,维持「query 优先,hash 兜底」语义不变,改动面最小。

关于「hash-only」字面含义的澄清(见 feasibilityNote):真正的「只存哈希、永不存明文」在本应用不可行——openaiCompatibleImageApi.ts:27 用 `Authorization: Bearer ${profile.apiKey}`、geminiImageApi.ts:139 用 `x-goog-api-key: profile.apiKey`,请求时必须持有明文 key;单向 hash 无法还原成可用凭证。因此本包的「hash-only」落地为「摄入只走 hash 片段」,而非密码学哈希存储。

路径 B(低风险)——localStorage 明文密钥处理:partialize(persist.ts:41-55)当前把整个 state.settings 原样返回,导致每个 profile.apiKey 以及 promptOptimizer/captioner 镜像里的 key 全部明文落 localStorage(XSS / 共享设备 / 浏览器同步均可读取)。代码库里已有现成的「按字段抹 key」范式 redactSettingsForExport(exportImport.ts:52-78),它精确覆盖了 settings.apiKey + profiles[].apiKey + promptOptimizer.apiKey + optimizerProfiles[].apiKey + captioner.apiKey + captionerProfiles[].apiKey 六处。我建议先把这段抽成一个与导出语义解耦的共享 util(stripApiKeys),让 redactSettingsForExport 与 persist 路径共用,避免两处各写一遍漏字段。

路径 B 给出三档可选强度(由弱到强,推荐第 2 档):
- 第 1 档(最低成本、强烈建议至少做到):保持明文持久化不变,但新增一行风险提示 banner,完全复刻已落地的 InsecureContextBanner + dismissedInsecureContextBanner(ui slice + partialize + mergePersistedStoreState)三件套范式,提示「API Key 以明文存储于本浏览器」。零数据迁移风险。
- 第 2 档(推荐,session 级):key 不进 localStorage(partialize 用 stripApiKeys 抹掉),改为运行期内存 + 可选 sessionStorage(关标签即清)。需要在 App 启动注水后把 key 留在内存态。代价:刷新/重开会要求重新粘 key,这是与「明文长存」的根本取舍。
- 第 3 档(最强,WebCrypto 加密持久化):用 SubtleCrypto AES-GCM + 一个由用户口令派生(PBKDF2)的 key 在写盘前加密 apiKey。安全性最高但引入解锁 UX、口令丢失=数据不可用、与 zustand-persist 同步 JSON 序列化不兼容(需异步 storage 适配),复杂度跳到 L。本包不建议在此迭代内做,仅作为后续工作包记录。

最终建议交付组合:路径 A(必做)+ 路径 B 第 2 档(session 级,带降级到第 1 档 banner 的开关),既消除查询串泄露,又把「明文长期驻留 localStorage」这一最大面降为「会话级 + 明确告知」。

### 共享抽象

- **stripApiKeys** — `src/lib/api/apiProfiles.ts`
  ```ts
  export function stripApiKeys(settings: AppSettings): AppSettings
  ```
  把 redactSettingsForExport(exportImport.ts:52-78)里「逐字段把 apiKey 置空」的逻辑下沉为与导出语义无关的纯函数,统一覆盖 settings.apiKey + profiles[].apiKey + promptOptimizer.apiKey + optimizerProfiles[].apiKey + captioner.apiKey + captionerProfiles[].apiKey 六处。redactSettingsForExport 改为直接调用它(避免改导出行为);persist.ts 的 partialize 在第 2 档方案下也调用它,保证『需要抹 key 的地方只有一份清单』,新增 profile 类型时不会两处各漏。放在 apiProfiles.ts 是因为该文件已是 settings 形状的归一化/校验中枢,且已被 exportImport.ts 与 persist 间接依赖,不引入新循环依赖。
- **readSessionApiKeys / writeSessionApiKeys** — `src/lib/api/apiKeySession.ts (新文件)`
  ```ts
  export function writeSessionApiKeys(settings: AppSettings): void; export function readSessionApiKeys(): Record<string,string> | null; export function applySessionApiKeys(stripped: AppSettings): AppSettings
  ```
  仅路径 B 第 2 档需要。把各 profile/optimizer/captioner 的 apiKey 以 {profileId: key} 形态写入 sessionStorage(随标签关闭自动清除,不进 localStorage),并在 App 注水后用 applySessionApiKeys 把 key 合并回被 stripApiKeys 抹空的 settings。键空间用 profile.id(types.ts ApiProfileBase.id),与 dedupe/normalize 不冲突。做成独立 util 便于单测且 SSR/无 sessionStorage 环境(typeof sessionStorage 检测,沿用 InsecureContextBanner 的 typeof window 兜底范式)安全降级。
- **PlaintextKeyBanner + dismissedPlaintextKeyBanner** — `src/components/PlaintextKeyBanner.tsx (新文件) + src/store/slices/ui.ts`
  ```ts
  dismissedPlaintextKeyBanner: boolean; setDismissedPlaintextKeyBanner: (v: boolean) => void
  ```
  路径 B 第 1 档(及作为第 2 档不可用时的降级)。1:1 复刻 InsecureContextBanner.tsx 与 ui slice 里 dismissedInsecureContextBanner(ui.ts:11-12,59-61)的三件套:slice 字段 + setter、partialize 持久化关闭态、mergePersistedStoreState 用 `=== true` 兜底。banner 文案提示『API Key 以明文存储于本浏览器,请勿在共享设备使用』。仅在确实以明文持久化(第 1 档)时渲染。

### 步骤

#### 1. low security — urlBootstrap.ts:57-60 query 串读取 apiKey — `src/lib/urlBootstrap.ts` @ readUrlBootstrap() 内 line 57-60 的 apiKeyParam 块

**改动**:把 apiKey 来源从 `hashParams.get('apiKey') ?? searchParams.get('apiKey')` 收窄为仅 `hashParams.get('apiKey')`,停止从查询串摄入。BOOTSTRAP_KEYS(line 4)保持包含 'apiKey' 不变,这样 cleanSearchParams(line 31-35)仍会把误传的 ?apiKey= 从可见 URL/history 抹掉。changed(line 73)与 cleanHash 逻辑无需改。

```ts
const apiKeyParam = hashParams.get('apiKey')
if (apiKeyParam !== null) {
  settings.apiKey = apiKeyParam.trim()
}
```
> 可行性:审查所提『hash-only』若理解为密码学哈希存储则不可行(请求时需明文 Bearer/x-goog-api-key,见 openaiCompatibleImageApi.ts:27、geminiImageApi.ts:139),替代实现即此处的『摄入仅走 hash 片段』。可行且改动极小。

#### 2. low security — urlBootstrap.ts query 摄入(回归保护) — `src/lib/urlBootstrap.test.ts` @ describe('readUrlBootstrap') 现有两条用例后追加

**改动**:现有用例 'prefers one-time API keys from the URL hash'(line 5-14)同时带 ?apiKey=query-key 与 #apiKey=hash-key,改后仍取 hash-key,断言不变(但语义已变为『只认 hash』)。新增一条:仅查询串带 apiKey 时,result.settings 不含 apiKey,且 cleanUrl 已剥离 apiKey。

```ts
it('ignores apiKey from the query string entirely', () => {
  const result = readUrlBootstrap('https://app.example.com/?apiKey=query-key&apiUrl=https://api.example.com/v1')
  expect(result.settings.apiKey).toBeUndefined()
  expect(result.settings.baseUrl).toBe('https://api.example.com/v1')
  expect(result.cleanUrl).toBe('https://app.example.com/')
})
```
> 可行性:沿用现有 vitest describe/it + toMatchObject 范式,无需新依赖。

#### 3. low security — persist.ts:41-55 明文 key(共享抽象前置) — `src/lib/api/apiProfiles.ts` @ 新增 stripApiKeys();exportImport.ts:52-78 redactSettingsForExport 改为复用

**改动**:在 apiProfiles.ts 导出 stripApiKeys(settings),把 redactSettingsForExport 内逐字段置空 apiKey 的逻辑下沉。redactSettingsForExport 改为 `return stripApiKeys(normalizeSettings(settings))`,保持其对外行为与 exportImport.test.ts 现有断言完全一致。

```ts
export function stripApiKeys(settings: AppSettings): AppSettings {
  return {
    ...settings,
    apiKey: '',
    profiles: settings.profiles.map((p) => ({ ...p, apiKey: '' })),
    promptOptimizer: { ...settings.promptOptimizer, apiKey: '' },
    optimizerProfiles: settings.optimizerProfiles.map((p) => ({ ...p, apiKey: '' })),
    captioner: { ...settings.captioner, apiKey: '' },
    captionerProfiles: settings.captionerProfiles.map((p) => ({ ...p, apiKey: '' })),
  }
}
```
> 可行性:纯重构,redactSettingsForExport 已含全部字段,直接抽取不丢逻辑;exportImport.ts 需新增 import { stripApiKeys }。

#### 4. low security — persist.ts:41-55(第 2 档:session 级,推荐) — `src/store/persist.ts` @ partialize() line 41-55 的 `settings: state.settings`

**改动**:把 `settings: state.settings` 改为 `settings: stripApiKeys(state.settings)`,使 localStorage 不再含任何明文 key。其余持久化字段不动。配套在 App.tsx 注水后用 sessionStorage 里的 key 回填(见 step 5/6)。mergePersistedStoreState(line 25 `normalizeSettings(persisted?.settings)`)无需改——抹空后 normalizeSettings 会把缺失 key 归一为 ''。

```ts
settings: stripApiKeys(state.settings),
```
> 可行性:若团队选第 1 档(仅 banner、保留明文),则跳过本 step,partialize 不动,只做 step 7。两档二选一。

#### 5. low security — session 级 key 写入(第 2 档) — `src/lib/api/apiKeySession.ts (新文件) + src/store/slices/settings.ts` @ setSettings (settings.ts:17) 成功 set 后旁路写 session

**改动**:新建 apiKeySession util(见 sharedAbstractions)。在 setSettings 写入 store 成功后,调用 writeSessionApiKeys(merged) 把各 id→key 落 sessionStorage。这样运行期内存(zustand state)持有明文供请求用,sessionStorage 仅为同标签刷新续命,关标签即清。

```ts
// settings.ts setSettings 末尾 return 前
writeSessionApiKeys(merged)
return { settings: normalizeSettings(merged) }
```
> 可行性:writeSessionApiKeys 内 typeof sessionStorage 检测兜底(测试/SSR 环境);第 1 档方案不需要本 step。

#### 6. low security — session 级 key 回填(第 2 档) — `src/App.tsx` @ 首个 useEffect(line 66-95)内 initStore() 调用处附近

**改动**:在 readUrlBootstrap 之后、initStore() 之前,从 sessionStorage 读回 key 合并进当前 settings(URL hash 摄入的新 key 优先级最高)。利用现有 setSettings 通道写回内存,无需新 action。

```ts
const sessionKeys = readSessionApiKeys()
if (sessionKeys) {
  const restored = applySessionApiKeys(useStore.getState().settings) // 用 session key 填回被抹空的 profile
  setSettings(restored)
}
// 已有的 nextSettings(含 hash 摄入的 apiKey)在其后 setSettings,自然覆盖
```
> 可行性:注意执行顺序:先回填 session key,再 apply hash 摄入的 nextSettings(step 1 产物),保证一次性 URL key 覆盖旧 session key。第 1 档不需要本 step。

#### 7. low security — persist.ts 明文 key(第 1 档 / 第 2 档降级:风险提示) — `src/components/PlaintextKeyBanner.tsx (新) + src/store/slices/ui.ts + src/store/persist.ts + src/App.tsx` @ 复刻 InsecureContextBanner 三件套:ui.ts:11-12/59-61、persist.ts partialize:52 与 merge:35、App.tsx:131

**改动**:ui slice 加 dismissedPlaintextKeyBanner + setter;partialize 增列该字段;mergePersistedStoreState 用 `persisted?.dismissedPlaintextKeyBanner === true` 兜底;App.tsx 在 <InsecureContextBanner /> 旁渲染 <PlaintextKeyBanner />。文案:『API Key 以明文存储于本浏览器,共享设备请勿保存』。第 1 档下常驻(只要存在非空 key 且未关闭);第 2 档下作为 sessionStorage 不可用时的兜底提示。

```ts
// ui.ts
dismissedPlaintextKeyBanner: false,
setDismissedPlaintextKeyBanner: (dismissedPlaintextKeyBanner) => set({ dismissedPlaintextKeyBanner }),
// PlaintextKeyBanner.tsx 结构 1:1 仿 InsecureContextBanner.tsx
```
> 可行性:完全有现成范式可抄(InsecureContextBanner + dismissedInsecureContextBanner),零新机制。

### 测试策略

沿用现有 vitest 模式,不引第三方:
1) urlBootstrap.test.ts(已存在):新增『查询串 apiKey 被完全忽略且从 cleanUrl 剥离』用例(step 2);确认现有两条 hash 用例仍绿。
2) apiProfiles.test.ts(已存在):为 stripApiKeys 加用例——构造含多 profile/optimizer/captioner 且 key 非空的 settings,断言六处 apiKey 全为 ''、其余字段(id/name/baseUrl/model/timeout/provider 专属字段)不变;并断言 redactSettingsForExport 重构后输出与旧实现一致(可对照 exportImport.test.ts 现有 redact 断言)。
3) store.test.ts(已存在,含 partialize/mergePersistedStoreState 范式):第 2 档——断言 partialize(state) 返回的 settings 各 apiKey 为 ''(用 store.test.ts:82 的 `{ ...DEFAULT_SETTINGS, apiKey: 'test-key' }` 造数据);断言 mergePersistedStoreState 注水被抹空的 settings 不抛错且 key 归一为 ''。第 7 步——仿现有 dismissedInsecureContextBanner 用例(store.test.ts:608-664)为 dismissedPlaintextKeyBanner 写 default-false / preserve-true / setter 三条。
4) apiKeySession.ts(新):单测 write/read/apply 往返,含 sessionStorage 缺失降级返回 null;vitest jsdom 环境自带 sessionStorage,无需额外 mock。
5) 运行期验证(无法纯单测):第 2 档需手动验证『刷新后 key 仍在(同标签 sessionStorage)』『关标签重开后 key 已清需重填』『URL #apiKey= 一次性覆盖』『请求头仍带正确 Bearer/x-goog-api-key』。建议在 step 提交后跑一次 dev server 走真实 OpenAI/Gemini 各一次请求。

### 回归风险

1) 行为变更(必然):停止 query 串摄入后,任何依赖 ?apiKey= 的旧分享链接/书签/集成将不再注入 key(改后仅 #apiKey= 有效)。这是预期的安全收紧,但需在 release note / 文档明确,属可见的兼容性破坏。urlBootstrap.test.ts:5 现有用例名暗示『prefers hash』,本改使其变为『only hash』,语义漂移需同步注释。
2) 第 2 档最大回归:key 不再长存 localStorage,用户刷新(若 sessionStorage 也被清,如隐私模式跨会话)或换标签需重填 key,是明显 UX 退化——这正是『安全 vs 便利』的核心取舍,务必先与产品确认默认档位。若默认上线第 2 档而无 banner 解释,易被当成 bug。
3) stripApiKeys 抽取若漏改 redactSettingsForExport 的 import 或与 normalizeSettings 调用次序错位,可能导致导出 ZIP 仍含明文 key(安全回归)或导出形状变化——exportImport.test.ts 现有断言可挡住,需保留并跑通。
4) sessionStorage 容量/可用性:隐私模式或被策略禁用时 writeSessionApiKeys 须静默降级(typeof 检测),否则首屏抛错;此时应回退到第 1 档 banner 提示明文风险或提示需重填。
5) persist 版本:本改未动 zustand-persist 的 name('image-playground')与无 version 字段,旧 localStorage(含明文 key)在第 2 档下首次注水后仍残留旧明文(因 mergePersistedStoreState 读旧值),建议注水成功后主动用新 partialize 覆盖写一次以清除磁盘上的旧明文(zustand-persist set 触发即可),否则『历史明文』不会被自动擦除——这点容易被忽略,需在 step 4 落地时确认 persist 会 rehydrate 后回写。
6) promptOptimizer/captioner 是 normalizeSettings 产出的派生镜像(apiProfiles.ts:361-376),stripApiKeys 已覆盖镜像与 *Profiles 两侧,但 setSettings 回填 session key 时须同时回填镜像与对应 profile,否则 UI 读镜像显示空而请求读 profile,或反之,造成不一致。

---

## WP3 · 部署/边缘安全基线(关闭开放凭证代理 + 安全头/CSP + Workers /sw.js no-cache + 流式关 gzip + SW 运行时缓存上限)

**工作量** `M` · **依赖** none(本工作包自成闭环,纯部署/边缘配置 + sw.js 运行时,不依赖其它 WP)。若仓库另有 WP 计划改 index.html 行 14-30 的内联脚本,则本包的内联脚本 sha256 需在那之后重算,存在弱顺序耦合,建议本包 step 2 的 hash 校验函数作为公共守卫先落地,让其它包改 index.html 时自动暴露 hash 漂移。

### 总体思路

本工作包全部为「部署面 / 边缘配置 + SW 运行时」修复,几乎不触碰 React/TS 业务代码,因此回归面集中在 nginx/Caddy/Cloudflare 行为与 SW fetch 路径,而非类型系统。读真实代码后确认四点关键事实,它们决定了方案取舍:

1) API baseUrl 完全用户可配(apiProfiles.ts:16/19 默认 OpenAI/Gemini,settings.ts 允许任意 baseUrl/apiProxy),且 imageApiShared.ts:128 fetchImageUrlAsDataUrl 会去拉任意远程图片 URL,Lightbox/TaskCard 等用 data:/blob: 显示图片。=> CSP 的 connect-src 与 img-src 必须放到 `https:`(以及 data:/blob:)这一宽粒度,绝不能做 host 白名单,否则直接打断核心生图功能。这是对审查「加 CSP」建议的关键校正:CSP 在此项目只能做「框架级收紧」(default-src 'self'、object-src 'none'、frame-ancestors、base-uri),不能做 network 白名单。

2) index.html:14-30 有一段内联 theme 引导 <script>(读 localStorage 决定 dark class),index.html:34 的 /src/main.tsx 构建后变成 hashed /assets/*.js。纯静态 SPA 没有 nonce 注入能力。=> script-src 要么 'unsafe-inline'(弱),要么对这段内联脚本算 SHA-256 hash 放进 script-src(强,且这段脚本是稳定的、不含变量,适合 hash)。推荐 hash 方案,并把它作为共享「安全头基线」的一部分,三处部署(nginx/Caddy/_headers)复用同一份策略字符串,避免三处各写一份漂移。

3) cors-proxy.conf:42/45/84/87 反射 $http_origin + Allow-Credentials:true = 开放凭证代理。但该代理透传的是 Authorization / x-api-key / x-goog-api-key(proxy_set_header,行 58-63),从不依赖 Cookie;浏览器侧 fetch 也不带 credentials。=> 安全修复 = 删除 Access-Control-Allow-Credentials,并把 ACAO 从「反射任意 origin」改为「显式 allowlist 变量(map)匹配后回显,未命中则不发 ACAO」。这样既不破坏自部署者用自己域名访问,又关闭了「任意站点带凭证打你的 key 代理」的滥用面。

4) wrangler.jsonc 是纯静态资产部署(只有 assets.not_found_handling,无 main/Worker 脚本)。=> Cloudflare 的 _headers 文件对所有静态资产响应生效,不存在「Worker 生成响应不套用 _headers」的限制(官方文档确认 public/_headers 原生支持,Vite 把 public/* 原样拷到 dist/,wrangler/@cloudflare/vite-plugin ^1.36 + wrangler ^4.90 均支持)。因此 M11 用 public/_headers 即可同时解决 Workers 上的 /sw.js no-cache 与全套安全头,无需写 Worker 脚本。

执行顺序:先建唯一真源的安全头清单(注释 + 三份配置共用同一策略),再逐处接线;SW 缓存上限与 gzip 是独立小改,可并行。所有改动均为配置层,不实际改 React 代码,符合本任务「只设计」。

### 共享抽象

- **安全头基线策略(单一真源清单 + 内联脚本 hash)** — `docs/security-headers.md(新增,纯文档/真源)`
  ```ts
  一段权威的 header 清单:Content-Security-Policy / X-Content-Type-Options / Referrer-Policy / X-Frame-Options / Permissions-Policy / Cross-Origin-Opener-Policy,以及为 index.html:14-30 内联脚本算出的 sha256-<...> 值;三处部署配置(nginx.conf、Caddyfile/Caddyfile.lan、public/_headers)逐字复用同一策略,避免漂移
  ```
  消除三处部署各写一份安全头导致的不一致;把『内联脚本 hash』这一最易出错、最易随 index.html 改动而失效的点集中记录,改 index.html:14-30 时必须同步更新此处(可加构建期校验,见 testStrategy)
- **CSP 策略字符串(connect/img 宽粒度,framework 收紧)** — `docs/security-headers.md 内定义,供三处复用`
  ```ts
  default-src 'self'; script-src 'self' 'sha256-<inline-theme-script>'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; worker-src 'self'; manifest-src 'self'
  ```
  在不破坏『任意 baseUrl 生图 + 任意远程图片 URL + data/blob 预览』前提下做框架级 CSP 收紧。connect-src/img-src 故意放到 https:,这是经核实的必要妥协,不是疏漏
- **CORS origin allowlist(nginx map)** — `cors-proxy.conf 顶部(server 块外,与 resolver 同级)`
  ```ts
  map $http_origin $cors_allow_origin { default ""; "https://your-domain.com" $http_origin; "~^https://([a-z0-9-]+\.)?your-domain\.com$" $http_origin; }
  ```
  替代行 42/84 的『$http_origin 无条件反射』。未命中 allowlist 时 $cors_allow_origin 为空 -> add_header 空值不发 ACAO,浏览器自然拒绝跨域;命中才回显。配合删除 Allow-Credentials 彻底关闭开放凭证代理。把允许域集中到一个 map,自部署者只改这一处

### 步骤

#### 1. H3 开放凭证代理 + low perf 流式 gzip(cors-proxy.conf) — `D:/code/image-playground/cors-proxy.conf` @ 行 35-37(gzip on/gzip_proxied/gzip_types)、行 41-49(OPTIONS 预检块)、行 77-88(响应补 CORS 头块);并在 server 块外(行 9-10 resolver 附近)新增 map

**改动**:(a) 删除行 35-37 的 `gzip on; gzip_proxied any; gzip_types ...`,或显式 `gzip off;`——上游(OpenAI/Gemini)已自带压缩且本代理 proxy_buffering off(行 73)做流式透传,代理层再 gzip 会缓冲分块、破坏增量 flush,且对已压缩响应是双重压缩。(b) 在文件顶部 server{} 外新增 CORS allowlist map(见 sharedAbstractions)。(c) 行 42 与行 84 的 `add_header Access-Control-Allow-Origin "$http_origin"` 改为 `"$cors_allow_origin"`;行 45 与行 87 的 `add_header Access-Control-Allow-Credentials "true" always;` 整行删除(改用 bearer/api-key 鉴权,从不需要 cookie 凭证)。行 88 的 `Vary: Origin` 保留(map 按 Origin 变化,Vary 仍需要)。proxy_hide_header(行 80-83)对应 Allow-Credentials 那行可一并删除或保留(无害)。

```ts
map $http_origin $cors_allow_origin { default ""; "https://your-domain.com" $http_origin; }
# OPTIONS:
add_header Access-Control-Allow-Origin  "$cors_allow_origin" always;
# (删除) add_header Access-Control-Allow-Credentials "true" always;
# 转发响应同样:Allow-Origin 用 $cors_allow_origin,删除 Allow-Credentials
```
> 可行性:审查只说『反射任意 origin + Allow-Credentials』。看真实代码后确认该代理用 header 鉴权(行 58-63 proxy_set_header Authorization/x-*-api-key),Cookie 凭证从未参与,因此删 Allow-Credentials 零功能影响。注意:若改回 `*` 也可,但 `*` 仍是开放代理(任意站点能借你的部署调用 OpenAI,只是不带凭证);allowlist 更稳妥,且不破坏自部署者用自己域访问。gzip 关闭对非流式 JSON 响应略增带宽,但上游本身已 gzip,实际影响极小。

#### 2. M12 全链路无 CSP(确立内联脚本 hash 与策略真源) — `D:/code/image-playground/index.html` @ 行 14-30 内联 theme 引导 <script>;行 5-13 现有 meta

**改动**:不改 index.html 的脚本逻辑(本任务只设计;且改逻辑会使 hash 失效)。决策点:CSP 通过 HTTP 响应头下发(在 nginx/_headers/Caddy),而非 <meta http-equiv> ——因为 frame-ancestors / 上报等指令在 meta 形式下被忽略,响应头形式更完整。需为行 14-30 这段稳定内联脚本计算 sha256(对 <script> 标签内的精确字节,不含标签本身),写入 script-src。把该 hash 记入 docs/security-headers.md 作为真源。

```ts
# 计算方式(部署文档示例,非运行时代码):
# printf '%s' '<行14-30脚本体逐字>' | openssl dgst -sha256 -binary | openssl base64
# -> script-src 'self' 'sha256-XXXX...'
```
> 可行性:审查建议『index.html 加 CSP』。校正:纯静态 SPA 无 nonce 注入,且 meta 形式不支持 frame-ancestors,故改为响应头下发并对内联脚本用 hash。风险:任何人改动行 14-30 都会让 hash 失效 -> 主题闪烁/脚本被 CSP 拦截。缓解见 testStrategy 的构建期校验。若团队不接受 hash 维护成本,退路是 script-src 'self' 'unsafe-inline'(弱化但可用),需在文档显式标注权衡。

#### 3. M11 Workers /sw.js no-cache + M12 在 Cloudflare 部署补全安全头 — `D:/code/image-playground/public/_headers(新增)` @ 新文件;由 Vite 把 public/* 原样拷到 dist/_headers,wrangler deploy / @cloudflare/vite-plugin 静态资产读取

**改动**:新增 public/_headers,内容:(a) /sw.js 块:Cache-Control: no-cache, no-store, must-revalidate;Pragma: no-cache;Expires: 0 —— 恢复 kill-switch 逃生通道(与 nginx.conf:38-45 契约一致)。(b) /index.html 块:no-cache, must-revalidate(对齐 nginx.conf:68-71)。(c) /manifest.webmanifest:max-age=3600;/pwa-icon.svg:max-age=86400。(d) /assets/* 块:public, max-age=31536000, immutable(对齐 nginx.conf:47-52)。(e) 一条 `/*` 全局块下发安全头基线(CSP + X-Content-Type-Options: nosniff + Referrer-Policy: strict-origin-when-cross-origin + X-Frame-Options: SAMEORIGIN + Permissions-Policy + Cross-Origin-Opener-Policy: same-origin),复用 docs/security-headers.md 的策略。注意 _headers 规则按定义顺序,具体路径块与 /* 的合并语义需确认(/* 设安全头,/sw.js 等具体块只覆盖 Cache-Control)。

```ts
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-...'; img-src 'self' data: blob: https:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

/sw.js
  Cache-Control: no-cache, no-store, must-revalidate

/assets/*
  Cache-Control: public, max-age=31536000, immutable
```
> 可行性:已联网核实:Cloudflare Workers 静态资产原生支持 public/_headers(Pages 同语法),且本项目 wrangler.jsonc 无 Worker 脚本(仅 assets.not_found_handling),不触发『_headers 不套用于 Worker 响应』限制。Vite publicDir 默认 public,base './' 不影响 public 文件拷贝路径(仍到 dist 根)。需在 Dockerfile/构建后确认 dist/_headers 不会被 nginx 当成可访问静态文件误暴露——nginx 部署不读 _headers,该文件在 nginx 镜像里只是个无害静态文件;可选在 nginx.conf 加 `location = /_headers { return 404; }`,但非必需(其内容仅是公开策略,无敏感信息)。

#### 4. M13 nginx 缺安全头 — `D:/code/image-playground/nginx.conf` @ server 块内(行 16-17 server_tokens 附近)新增一组 add_header;现有各 location(行 38-83)

**改动**:在 server{} 顶层新增安全头基线 add_header(用 always 确保 4xx/5xx 也带),与 _headers/Caddy 同策略:Content-Security-Policy、X-Content-Type-Options nosniff、Referrer-Policy、X-Frame-Options SAMEORIGIN、Permissions-Policy、Cross-Origin-Opener-Policy same-origin。注意 nginx add_header 继承陷阱:子 location(如 /sw.js 行 38、/assets/ 行 48)一旦自己写了 add_header,会丢弃父级所有 add_header。因此需把安全头放进一个 include 片段并在每个写了 add_header 的 location 内 include,或用 map+add_header 的稳健写法。最简稳妥:把安全头集中到 `/etc/nginx/conf.d/security-headers.inc`(新增,经 Dockerfile COPY),在 server 块与每个含 add_header 的 location 块各 `include security-headers.inc;`。

```ts
# security-headers.inc(新增):
add_header Content-Security-Policy "default-src 'self'; ..." always;
add_header X-Content-Type-Options "nosniff" always;
# nginx.conf server{} 及 location = /sw.js / location /assets/ 等块内:
include /etc/nginx/conf.d/security-headers.inc;
```
> 可行性:审查只说『nginx 缺安全头』。真实代码确认 nginx.conf 多个 location(行 38/48/55/62/68)都已有自己的 add_header,因此不能只在 server 顶层加一次——nginx 的 add_header 不向已声明 add_header 的子 location 继承。必须用 include 片段在每处重复 include,否则 /sw.js、/assets/ 等关键路径拿不到安全头。Dockerfile 行 28 目前只 COPY nginx.conf,需同步 COPY 新增的 .inc(见 step 6)。

#### 5. M13 Caddyfile / Caddyfile.lan 缺安全头(补 CSP 等) — `D:/code/image-playground/Caddyfile 与 D:/code/image-playground/Caddyfile.lan` @ Caddyfile 行 18-25 主站 header{} 块;Caddyfile.lan 行 15-19 header{} 块

**改动**:Caddyfile 主站 header 块(行 18-25)已有 X-Frame-Options/X-Content-Type-Options/Referrer-Policy,补 Content-Security-Policy 与 Permissions-Policy、Cross-Origin-Opener-Policy,使其与 nginx/_headers 同策略。Caddyfile.lan(行 15-19)同样补全(注意 LAN/HTTP 模式无 SW,CSP 仍适用且无害;worker-src/HSTS 不必加,Caddy HTTPS 段才有 HSTS)。Caddy header 指令对所有响应生效,无 nginx 那种继承陷阱,直接在 header{} 内加即可。cors.your-domain.com 段(行 34-42)是代理到 cors-proxy,不应套 CSP/X-Frame(那是 API 响应),保持现状只 -Server。

```ts
header {
  X-Frame-Options "SAMEORIGIN"
  X-Content-Type-Options "nosniff"
  Referrer-Policy "strict-origin-when-cross-origin"
  Content-Security-Policy "default-src 'self'; script-src 'self' 'sha256-...'; img-src 'self' data: blob: https:; connect-src 'self' https:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'"
  Permissions-Policy "camera=(), microphone=(), geolocation=()"
  -Server
}
```
> 可行性:可行,Caddy 无继承陷阱。注意 CSP 含逗号/分号时 Caddyfile 需整体用双引号包住(已用)。Caddyfile.lan 是 http://IP,CSP 中 connect-src https: 不影响其用 http 访问自身(self 覆盖同源 http)。不要给 cors 子域段加 CSP。

#### 6. M13 配套:确保 nginx 安全头片段进镜像 — `D:/code/image-playground/Dockerfile` @ 行 27-28(COPY nginx.conf)

**改动**:若 step 4 采用 security-headers.inc 片段方案,Dockerfile 需新增 `COPY security-headers.inc /etc/nginx/conf.d/security-headers.inc`(放在 COPY nginx.conf 之后)。否则 include 找不到文件,nginx 启动失败。若改为把安全头直接内联进 nginx.conf 各 location(不抽片段),则本步可省,但维护性差、易漂移。

```ts
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.inc /etc/nginx/conf.d/security-headers.inc
```
> 可行性:纯构建管线补丁。注意 conf.d/*.conf 会被 nginx 自动加载,故片段命名用 .inc(非 .conf)避免被当独立 server 加载。

#### 7. low resource-leak:public/sw.js 运行时缓存无上限 — `D:/code/image-playground/public/sw.js` @ 行 69-81 非 KILL_SWITCH 分支的 fetch handler(caches.match -> fetch -> cache.put)

**改动**:为运行时缓存写入加策略上限,避免对所有同源 GET 无限 cache.put。两种与现有范式一致的做法:(a) 仅缓存确属静态资产的请求(url.pathname 以 /assets/ 开头或匹配已知后缀),其余只走网络不写缓存——最贴合本应用(hashed assets 才值得缓存);(b) 保留通用缓存但加 LRU 式裁剪:put 后 caches.open(CACHE_NAME).keys(),超过上限(如 60)时 delete 最旧条目。推荐 (a),实现简单且天然有界(assets 数量有限)。注意保持 install 阶段 APP_SHELL(行 6)与 activate 清理(行 43-50)不变,CACHE_NAME 占位符(行 5)不动以免破坏 inject 脚本。

```ts
// 行 73-78 内,fetch().then 前加判断:
const isCacheable = url.pathname.startsWith(import.meta? '' : '/assets/')
// 实际:if (!url.pathname.includes('/assets/')) return response  // 不写缓存
// 或 LRU:const keys = await cache.keys(); if (keys.length >= 60) await cache.delete(keys[0])
```
> 可行性:审查标 low。sw.js 是构建期占位注入文件(行 5 __CACHE_NAME__,scripts/inject-sw-build-id.mjs 会断言占位符存在),改 fetch handler 不碰行 5 占位符即安全。注意 sw.js 无构建打包(直接拷 public),不能用 import.meta;sketch 用纯运行时 URL 判断。/assets/ 限定与 nginx.conf:47/_headers 的 immutable 缓存语义一致,逻辑自洽。

### 测试策略

沿用现有 .test.ts/.mjs(vitest)模式,优先纯函数与可解析配置的单测,边缘行为用集成/手测:

1) 安全头基线纯函数化测试(推荐新增 scripts/security-headers.test.mjs):把『策略字符串 + 内联脚本 hash 计算』抽成可导出函数(参考 scripts/inject-sw-build-id.mjs 的 export + 测试范式 scripts/inject-sw-build-id.test.mjs)。测点:(a) 给定 index.html 行 14-30 脚本体,computeInlineScriptSha256 输出与 CSP 中写入的 sha256 一致;(b) 构建期校验函数:读 dist/index.html 提取内联脚本,重算 hash,与 _headers/nginx CSP 中的 hash 比对,不一致则 exit 1(防止改 index.html 后 hash 漂移,与 Dockerfile 行 22 `! grep __CACHE_NAME__` 同类构建守卫)。

2) _headers 解析测试(新增 .test.mjs):写一个最小解析器或断言函数,验证 dist/_headers 含 `/sw.js` 块且 Cache-Control 含 no-store、`/assets/*` 含 immutable、`/*` 含 CSP/nosniff。可在 build 后跑(Dockerfile 已有 build 后断言先例)。

3) cors-proxy.conf / nginx.conf:配置类无法在 vitest 里跑 nginx,采用容器集成手测——`docker compose --profile https up`,curl 验证:(a) OPTIONS 带未授权 Origin 时响应不含 Access-Control-Allow-Origin、不含 Allow-Credentials;带 allowlist Origin 时回显该 Origin;(b) 普通 GET 响应 Content-Encoding 不再是 gzip(流式关 gzip);(c) `curl -I https://站点/sw.js` 返回 no-store;(d) `curl -I .../` 返回 CSP 等头;`curl -I .../assets/x.js` 同时带 CSP 与 immutable(验证 nginx include 继承修复)。

4) Cloudflare 路径:`npm run build` 后确认 dist/_headers 存在;`wrangler deploy` 后用 curl 验证 /sw.js no-store 与 /* CSP;或 `wrangler dev` 本地验证。

5) sw.js 运行时缓存:为可测性,把『请求是否可缓存』判定抽成可导出纯函数(如 isCacheableAssetRequest(url)),新增 vitest 单测覆盖 /assets/ 命中、非 assets 不缓存、跨源/非 GET 已在 fetch handler 早返回(行 55/58 现有逻辑)的边界;运行时手测在浏览器 DevTools > Application > Cache Storage 观察条目不再无限增长。

6) 全量回归:`npm test`(现 206 用例)+ `tsc -b`,本工作包基本不动 src/*.ts(除 sw.js,且 sw.js 不参与 tsc 类型检查),预期零破坏。

### 回归风险

1) CSP 误伤核心功能(最高风险):connect-src/img-src 必须含 https: 与 data:/blob:,否则任意 baseUrl 生图(apiProfiles.ts:16/19)、远程图片下载(imageApiShared.ts:128)、data/blob 预览(Lightbox/TaskCard)全挂。务必用宽粒度网络策略,只做框架级收紧。上线前用真实 OpenAI/Gemini 各跑一次生图+反推+远程图 URL 导入,观察 console 无 CSP 违规。\n2) 内联脚本 hash 漂移:任何人改 index.html:14-30 而不更新三处 CSP 的 sha256,会导致主题引导脚本被 CSP 拦截(首屏闪烁/dark 失效)。靠构建期 hash 校验(testStrategy 1b)兜底;否则退化为 'unsafe-inline'。\n3) nginx add_header 继承陷阱:若只在 server 顶层加安全头,/sw.js、/assets/(已有自己 add_header)会丢失全部安全头。必须用 include 片段在每个 location 重复 include,且 Dockerfile 同步 COPY 片段,否则 nginx 启动失败或安全头缺失。\n4) CORS allowlist 过紧:自部署者忘记把自己域名写进 map,会导致跨域被拒、生图失败。需在 cors-proxy.conf 顶部注释明确指引(沿用现有大段中文注释风格)。改 `*` 是更不易出错但更弱的退路。\n5) 关 gzip 的带宽:非流式 JSON 响应代理层不再压缩,但上游本身 gzip,净影响很小;若担心,可保留 gzip 仅对非流式 location,但当前单 location 难拆,关闭最简洁且修复了流式正确性。\n6) _headers 与 nginx 镜像共存:dist/_headers 会进 nginx 镜像成为可访问静态文件(内容是公开策略,无敏感信息,低危);如洁癖可在 nginx.conf 加 `location = /_headers { return 404; }`。\n7) Caddyfile.lan(http)下 CSP 无害但需确认 connect-src https: 不阻断对自身 http 同源请求(self 覆盖)——已确认安全。\n8) Permissions-Policy/COOP 若设过严可能影响未来剪贴板/分享能力(Caddyfile.lan 注释提到 clipboard/Web Share),设 camera/mic/geo=() 即可,勿禁 clipboard。

---

## WP4 · 取消链路 + 图片资源生命周期闭环

**工作量** `M` · **依赖** none(本 WP 自洽)。但与 WP「不可信输入校验/导入原子性」存在 exportImport.ts 邻接改动(本 WP 只在 imageCache 侧加 epoch,不改 exportImport,故无冲突);与「流式回调代际令牌守卫」WP 共享 mergeAbortSignals/AbortController 主题但文件不重叠。若另有 WP 计划扩展 TaskStatus 增加 'cancelled',本 WP 的 cancelTask 文案落点需与其协调(建议本 WP 先落 'error'+文案,后续 WP 再升级)。

### 总体思路

读完真实代码后,核心思路是「先建 4 个小抽象,再统一收口所有调用点」,避免散点修补。

1) taskRuntime.ts 已有完整的「失败收口」范式 `failSyncHttpTaskIfStillRunning`(行 104-117):它做了 abort + clearSyncHttpWatchdogTimer? 实际只 abort + 更新状态,并未清 watchdog;真正清 watchdog 是在 executeTask 的 success/catch/finally 三处。当前删除任务路径(removeTask 738-771 / removeMultipleTasks 688-735)完全没碰 abort 与 watchdog,这是 M6。统一抽象为 `terminateTaskRuntime(taskId)`:一次性 abort + clearSyncHttpWatchdogTimer + clearTaskAbortController,删除前对每个被删 running 任务调用。

2) 用户级取消(low: taskRuntime.ts:38,93-96,424-451):新增导出函数 `cancelTask(taskId)`,复用既有 `failSyncHttpTaskIfStillRunning` 的范式(abort + 写 'error' 状态),用一个新的 CANCELLED 文案常量;由于 TaskStatus 只有 'running'|'done'|'error'(types.ts:128),不能新增 'cancelled' 状态,故复用 'error' + 专属文案,与已有 SYNC_HTTP_INTERRUPTED_ERROR('请求中断')完全同构。TaskCard/DetailModal 的 running 分支加「取消」按钮接线。

3) mergeAbortSignals 正常完成不解绑(imageApiShared.ts:41-67):把返回值从 `AbortSignal | undefined` 改为 `{ signal: AbortSignal | undefined; dispose: () => void }`,三个 API 文件(openaiCompatibleImageApi 行 169/343、geminiImageApi 行 131)在各自已有的 `finally { clearTimeout(timeoutId) }` 里追加 `dispose()`。单 signal / 0 signal 分支也返回 no-op dispose,保持调用方统一。

4) executeTask 成功分支早退不回滚(taskRuntime.ts:457-488):在两处状态再校验(行 455、488)return 之前,对已 storeImage 的 outputIds 回滚——抽象 `rollbackStoredImages(ids)`:对每个 id 调 deleteImage + deleteCachedImage。注意 storeImage 是内容寻址去重(db.ts:294-302),回滚删除可能误删被其它记录引用的同内容图,需做「引用检查后再删」,与 removeTask 的 stillUsed 逻辑一致。

5) initStore 删孤立图未删缓存(taskRuntime.ts:258-262):该处删除时图基本不在缓存(注释也说不预加载),但为与运行期删除路径一致,补 deleteCachedImage(img.id)。

6) imageCache epoch(exportImport.ts:104-133 与 ensureImageCached 竞态):imageCache.ts 引入模块级 epoch,clearImageCache 自增 epoch;ensureImageCached 在 await getImage 前快照 epoch,await 后比对,若变更则丢弃结果不写回(返回 undefined),消除「清空后僵尸缓存写回」。

7) MaskEditorModal handleSave 孤儿图(index.tsx:233-258):把令牌/会话/imageId 存在性校验在 `await storeImage(...)` 之前先做一次(快速失败),storeImage 之后保留原有二次校验;若二次校验失败,对刚 storeImage 的 workingTargetId 做内容寻址安全回滚(同 rollbackStoredImages),消除孤儿写入窗口。

抽象优先级:先建 terminateTaskRuntime / rollbackStoredImages(taskRuntime 内)、mergeAbortSignals 返回 dispose(imageApiShared)、imageCache epoch(imageCache),再统一改所有调用点。

### 共享抽象

- **terminateTaskRuntime** — `src/lib/taskRuntime.ts`
  ```ts
  function terminateTaskRuntime(taskId: string): void
  ```
  统一收口在途任务的运行期资源:abortTaskRequest(taskId) + clearSyncHttpWatchdogTimer(taskId) + clearTaskAbortController(taskId)。供 cancelTask、removeTask、removeMultipleTasks 复用,取代当前删除路径完全不清理 abort/watchdog 的现状(M6)。放在现有 clearTaskAbortController(行89)附近。
- **rollbackStoredImages** — `src/lib/taskRuntime.ts`
  ```ts
  async function rollbackStoredImages(imageIds: string[], keepReferenced?: boolean): Promise<void>
  ```
  对一组刚 storeImage 的图片做成对回滚:deleteImage + deleteCachedImage。因 storeImage 内容寻址去重(db.ts:294),默认需排除仍被现存 task/inputImages 引用的 id(复用 removeTask 中 stillUsed 的收集逻辑),只删真正新产生且无引用的孤儿。供 executeTask 早退分支(457-488)与 MaskEditorModal 回滚复用。
- **mergeAbortSignals(返回 dispose)** — `src/lib/api/imageApiShared.ts`
  ```ts
  function mergeAbortSignals(...signals: Array<AbortSignal | undefined>): { signal: AbortSignal | undefined; dispose: () => void }
  ```
  把当前只返回 signal 改为返回 {signal, dispose}。dispose 在正常完成路径解绑所有 caller signal 上的 abort 监听(行 63-65 注册的 listener),消除长生命周期/并发复用同一 signal 时监听器线性累积泄漏。0/1 signal 分支返回 no-op dispose 保证调用方统一。
- **imageCache epoch** — `src/lib/imageCache.ts`
  ```ts
  let cacheEpoch = 0; clearImageCache(): void(自增 epoch); ensureImageCached(id) 内快照/比对 epoch
  ```
  clearImageCache 时自增 cacheEpoch;ensureImageCached 在 await getImage 前记录 startEpoch,await 完成后若 cacheEpoch !== startEpoch 则丢弃结果不写回缓存并返回 undefined。消除 clearAllData/importData(replace) 与 in-flight ensureImageCached 的竞态(僵尸缓存写回)。
- **TASK_CANCELLED_ERROR 常量** — `src/lib/taskRuntime.ts`
  ```ts
  const TASK_CANCELLED_ERROR = '已取消生成'
  ```
  用户主动取消时写入 task.error 的专属文案,与既有 SYNC_HTTP_INTERRUPTED_ERROR('请求中断',行39)同构。因 TaskStatus 无 'cancelled',取消统一落到 status:'error' + 该文案。

### 步骤

#### 1. low resource-leak: mergeAbortSignals 正常完成不解绑监听 (imageApiShared.ts:41-67) — `src/lib/api/imageApiShared.ts` @ mergeAbortSignals 行 41-67

**改动**:改返回类型为 { signal: AbortSignal | undefined; dispose: () => void }。0 signal 返回 {signal: undefined, dispose: noop};1 signal 返回 {signal: activeSignals[0], dispose: noop};多 signal 时把现有 cleanup 暴露为 dispose(对每个 activeSignals removeEventListener('abort', abort)),abort 路径仍调 cleanup,正常完成路径由调用方在 finally 调 dispose。

```ts
const noop = () => {}
if (activeSignals.length === 0) return { signal: undefined, dispose: noop }
if (activeSignals.length === 1) return { signal: activeSignals[0], dispose: noop }
const controller = new AbortController()
const dispose = () => { for (const s of activeSignals) s.removeEventListener('abort', abort) }
const abort = () => { if (!controller.signal.aborted) { controller.abort(); dispose() } }
if (activeSignals.some(s => s.aborted)) { abort(); return { signal: controller.signal, dispose } }
for (const s of activeSignals) s.addEventListener('abort', abort, { once: true })
return { signal: controller.signal, dispose }
```
> 可行性:审查建议「返回 dispose 或改用 AbortSignal.any」。AbortSignal.any 不可行——本项目部署面广(自托管/边缘),AbortSignal.any 是较新 API 兼容性不足,且现有 once:true 监听已轻量;采用返回 dispose 更稳。

#### 2. low resource-leak: mergeAbortSignals 调用点 (openaiCompatibleImageApi/geminiImageApi) — `src/lib/api/openaiCompatibleImageApi.ts` @ callImagesApiSingle 行 169-170 与 callResponsesImageApiSingle 行 343-344

**改动**:两处把 `const requestSignal = mergeAbortSignals(opts.signal, controller.signal)` 改为解构 `const { signal: requestSignal, dispose: disposeSignals } = mergeAbortSignals(...)`,并在各自已有的 `finally { clearTimeout(timeoutId) }`(行 300-302、391-393)内追加 `disposeSignals()`。requestSignal 后续用法(fetch signal、fetchImageUrlAsDataUrl 第三参)不变。

```ts
const { signal: requestSignal, dispose: disposeSignals } = mergeAbortSignals(opts.signal, controller.signal)
const timeoutId = setTimeout(() => controller.abort(), profile.timeout * 1000)
try { /* ...原逻辑... */ } finally { clearTimeout(timeoutId); disposeSignals() }
```
> 可行性:直接可行;两处结构完全对称。

#### 3. low resource-leak: mergeAbortSignals 调用点 (geminiImageApi) — `src/lib/api/geminiImageApi.ts` @ callGeminiSingle 行 131-132 与 finally 行 174-176

**改动**:同步骤2:解构 {signal: requestSignal, dispose: disposeSignals},finally(行 174 的 `finally { clearTimeout(timeoutId) }`)追加 disposeSignals()。

```ts
const { signal: requestSignal, dispose: disposeSignals } = mergeAbortSignals(opts.signal, controller.signal)
...
} finally { clearTimeout(timeoutId); disposeSignals() }
```
> 可行性:可行,与 openai 文件同范式。

#### 4. low react-concurrency: imageCache epoch (exportImport.ts:104-133 与 ensureImageCached 竞态) — `src/lib/imageCache.ts` @ 模块级状态(行 8-9)、ensureImageCached 行 31-43、clearImageCache 行 55-57

**改动**:新增 `let cacheEpoch = 0`。clearImageCache 内 `imageCache.clear(); cacheEpoch++`。ensureImageCached 在 await getImage 前 `const startEpoch = cacheEpoch`,await 链(getImage + storedImageToDataUrl)完成后 `if (cacheEpoch !== startEpoch) return undefined` 再写回缓存。新增测试导出 `_getCacheEpochForTesting()`(与既有 _getCacheSizeForTesting 同风格)。

```ts
let cacheEpoch = 0
export async function ensureImageCached(id) {
  const cached = getCachedImage(id); if (cached !== undefined) return cached
  const startEpoch = cacheEpoch
  const rec = await getImage(id); if (!rec) return undefined
  const dataUrl = await storedImageToDataUrl(rec); if (!dataUrl) return undefined
  if (cacheEpoch !== startEpoch) return dataUrl   // 已被清空:返回值但不写回
  imageCache.set(id, dataUrl); evictIfOverflow(); return dataUrl
}
export function clearImageCache() { imageCache.clear(); cacheEpoch++ }
```
> 可行性:审查建议「await 前后比对 epoch,变更则丢弃结果」。微调:仍可返回已取到的 dataUrl(调用方一次性使用是安全的),只是不写回缓存——避免把 reuseConfig/editOutputs 等正当读取在恰好并发清空时变成 undefined 误报「图片已不存在」。关键不变量是「不写回僵尸缓存」。

#### 5. M6 + low: terminateTaskRuntime 抽象 + TASK_CANCELLED_ERROR — `src/lib/taskRuntime.ts` @ clearTaskAbortController 行 89-91 之后;常量区 行 39 附近

**改动**:新增 `const TASK_CANCELLED_ERROR = '已取消生成'`。新增 `function terminateTaskRuntime(taskId: string)`:abortTaskRequest(taskId) + clearSyncHttpWatchdogTimer(taskId) + clearTaskAbortController(taskId)。仅做运行期资源清理,不写 store 状态(状态由各调用方按语义决定)。

```ts
const TASK_CANCELLED_ERROR = '已取消生成'
function terminateTaskRuntime(taskId: string) {
  abortTaskRequest(taskId)
  clearSyncHttpWatchdogTimer(taskId)
  clearTaskAbortController(taskId)
}
```
> 可行性:可行;abortTaskRequest(93)/clearSyncHttpWatchdogTimer(83)/clearTaskAbortController(89)均已存在。

#### 6. low correctness: 无用户级取消入口 cancelTask (taskRuntime.ts:38,93-96,424-451) — `src/lib/taskRuntime.ts` @ failSyncHttpTaskIfStillRunning 行 104-117 附近,新增导出 cancelTask

**改动**:新增 `export function cancelTask(taskId: string)`:复用 failSyncHttpTaskIfStillRunning 的范式——查 store 中 task,若非 running 则 return;否则 terminateTaskRuntime(taskId) + updateTaskInStoreSilently 写 status:'error'/error:TASK_CANCELLED_ERROR/finishedAt/elapsed。注意:executeTask 的 success(455)/catch(521)分支已有 `status !== 'running' → return` 守卫,故 abort 触发的 fetch reject 进入 catch 后会因状态已是 error 而早退,不会覆盖取消文案。executeTask finally(529-535)仍会 clearTaskAbortController(幂等)+ 释放输入图缓存。

```ts
export function cancelTask(taskId: string, now = Date.now()): boolean {
  const task = useStore.getState().tasks.find(t => t.id === taskId)
  if (!task || task.status !== 'running') return false
  terminateTaskRuntime(taskId)
  updateTaskInStoreSilently(taskId, { status: 'error', error: TASK_CANCELLED_ERROR, finishedAt: now, elapsed: Math.max(0, now - task.createdAt) })
  return true
}
```
> 可行性:审查建议「abort + 清 watchdog + 标记已取消」。调整:不能新增 'cancelled' 状态(TaskStatus 仅 'running'|'done'|'error',types.ts:128;新增会波及 taskFilters/TaskCard/DetailModal/导入归一化),故落 'error' + 专属文案,与 SYNC_HTTP_INTERRUPTED_ERROR 一致。同时把 failSyncHttpTaskIfStillRunning(行 108 的裸 abortTaskRequest)也改为调 terminateTaskRuntime,顺带让超时路径也清 watchdog/controller(当前超时回调 scheduleSyncHttpWatchdog 内已 delete 了 timer,但 controller 未清,统一更稳)。

#### 7. M6: 删除在途任务不 abort 不清 watchdog (removeTask 738-771) — `src/lib/taskRuntime.ts` @ removeTask 行 738-751(setTasks/dbDeleteTask 之前)

**改动**:在 `const remaining = tasks.filter(...)` 之前,若 task.status === 'running' 调 terminateTaskRuntime(task.id)。这样 fetch 被 abort、watchdog/controller 被清,executeTask 后续 success/catch 因任务已不在 store(find 返回 undefined,行 520 用 `?? task` 但 status 是 running 会进 catch 写状态——需注意)。

```ts
if (task.status === 'running') terminateTaskRuntime(task.id)
const remaining = tasks.filter((t) => t.id !== task.id)
setTasks(remaining)
await dbDeleteTask(task.id)
```
> 可行性:细节风险:executeTask catch(行 520)`const latestTask = ...find(...) ?? task`,任务被删后 find 返回 undefined → 回退到闭包 task(status 仍 'running')→ 进入 updateTaskInStore 重新 putTask 已删任务(复活)。需在 removeTask abort 之前或 executeTask 守卫中处理。建议:executeTask 的 success(455)/catch(521)守卫改为「find 不到也视为应终止」——即 `if (!latest || latest.status !== 'running') return` 已覆盖 success 分支(455 已是此写法),但 catch 分支(520-521)用了 `?? task` 需改为 `const latestTask = find(...); if (!latestTask || latestTask.status !== 'running') return`,消除复活。这是本步关键配套改动。

#### 8. M6: 删除在途任务 (removeMultipleTasks 688-735) — `src/lib/taskRuntime.ts` @ removeMultipleTasks 行 693-709

**改动**:在收集 deletedImageIds 时(行 698-704 遍历)对每个 toDelete 命中且 status==='running' 的 task 调 terminateTaskRuntime(t.id)。放在 setTasks(remaining)(行 706)之前。

```ts
for (const t of tasks) {
  if (toDelete.has(t.id)) {
    if (t.status === 'running') terminateTaskRuntime(t.id)
    for (const id of t.inputImageIds || []) deletedImageIds.add(id)
    ...
  }
}
```
> 可行性:可行;与步骤7 共享同一 executeTask catch 复活防护(步骤7 的配套改动一次性覆盖)。

#### 9. low resource-leak: 成功分支早退已存图不回滚 (taskRuntime.ts:457-488) — `src/lib/taskRuntime.ts` @ executeTask 行 458-463(storeImage 循环)与行 487-488 的二次状态校验

**改动**:把 outputIds 的回滚收口:行 488 `if (!latestBeforeUpdate || latestBeforeUpdate.status !== 'running') return` 之前,先 `await rollbackStoredImages(outputIds)` 再 return。行 455 的早退发生在 storeImage 之前(outputIds 尚空),无需回滚。rollbackStoredImages 需排除仍被引用 id(内容寻址去重)。

```ts
const latestBeforeUpdate = useStore.getState().tasks.find(t => t.id === taskId)
if (!latestBeforeUpdate || latestBeforeUpdate.status !== 'running') {
  await rollbackStoredImages(outputIds)
  return
}
```
> 可行性:审查建议「早退分支对已存 outputIds deleteImage+deleteCachedImage 回滚」。必须加引用检查:storeImage 内容寻址(db.ts:294-302),若某 outputId 内容恰与某 inputImage 相同会复用同一 id,裸删会误删在用图。rollbackStoredImages 内复用 removeTask 的 stillUsed 收集(遍历当前 store tasks + inputImages)后只删无引用项。

#### 10. low data-integrity: initStore 删图未 deleteCachedImage (taskRuntime.ts:258-262) — `src/lib/taskRuntime.ts` @ initStore 行 258-262 孤立图清理循环

**改动**:在 `await deleteImage(img.id)` 后补 `deleteCachedImage(img.id)`,与运行期 removeTask/removeMultipleTasks(行 724/766)的成对删除一致。

```ts
for (const img of images) {
  if (!referencedIds.has(img.id)) {
    await deleteImage(img.id)
    deleteCachedImage(img.id)
  }
}
```
> 可行性:可行;deleteCachedImage 已 import(行 22)。此处图通常不在缓存(初始化阶段),但补齐保证路径一致性,幂等无副作用。

#### 11. low data-integrity: MaskEditorModal 先写库再校验产生孤儿 (index.tsx:233-258) — `src/components/MaskEditorModal/index.tsx` @ handleSave 行 233-245(token/storeImage/二次校验)

**改动**:在 `await storeImage(sourceDataUrl, 'upload')`(行 239)之前先做一次「快速」存在性校验(token/session/maskEditorImageId);storeImage 之后保留原二次校验(行 240-244),但失败 return 前对 workingTargetId 做安全回滚。因 MaskEditorModal 不应直接 import taskRuntime 的私有 helper,回滚用 lib/db 的 deleteImage + lib/imageCache 的 deleteCachedImage(组件已分别可 import),或新增一个 lib 级公共 `safeDeleteImage(id)` 复用。

```ts
// storeImage 之前先快速校验
if (saveTokenRef.current !== token || activeSessionIdRef.current !== savingSessionId || useStore.getState().maskEditorImageId !== savingImageId) return
const workingTargetId = await storeImage(sourceDataUrl, 'upload')
if (<二次校验失败>) { await deleteImage(workingTargetId); deleteCachedImage(workingTargetId); return }
```
> 可行性:审查建议「存在性/令牌校验前移到 storeImage 之前再补一次」。补充:前移仅缩小窗口、不能消除(storeImage 仍是异步)。故二次校验失败时需真正回滚 workingTargetId。注意 sourceDataUrl 内容寻址:若该图正好已被 inputImages 引用则不应删——但 mask 保存场景 sourceDataUrl 来自正在编辑的图,通常已在库;为安全,回滚前可检查 useStore.getState().inputImages 是否含该 id,含则跳过删除。组件层引用检查比 taskRuntime 的 rollbackStoredImages 轻量,建议在组件内联实现或提取 lib/image 级 helper。

#### 12. low correctness: cancelTask UI 入口接线 — `src/components/TaskCard.tsx` @ running 分支 行 287-309(卡片)与 DetailModal.tsx 行 374-387(详情)

**改动**:TaskCard 与 DetailModal 的 `task.status === 'running'` 渲染块内加「取消」按钮,onClick 调用 store 重新导出的 cancelTask(task.id)。可加 ConfirmDialog 二次确认(沿用 setConfirmDialog 范式,如 removeTask 行 159/211 的用法),也可直接取消(取消是可重试的,危害低,建议直接取消 + showToast)。

```ts
<button type="button" onClick={() => cancelTask(task.id)}>取消</button>
```
> 可行性:需在 src/store/index.ts 行 41-59 的 re-export 块追加 cancelTask(与 removeTask 同列)。组件从 '../store' import cancelTask。

#### 13. 导出 cancelTask 到 store barrel — `src/store/index.ts` @ 行 41-59 的 export { ... } from '../lib/taskRuntime'

**改动**:在 re-export 列表加入 cancelTask。

```ts
export {
  ...
  removeTask,
  removeMultipleTasks,
  cancelTask,
  ...
} from '../lib/taskRuntime'
```
> 可行性:可行;TaskCard/DetailModal 既有从 '../store' 取 removeTask 的范式。

### 测试策略

优先复用现有 *.test.ts 的 vi.mock 范式(exportImport.test.ts 已 mock ./db 与 ./imageCache;imageCache.test.ts 已 mock ./db)。

1) imageCache.test.ts(已存在,直接扩):新增 epoch 用例——(a) ensureImageCached 在 await getImage 期间被 clearImageCache 打断后不写回缓存(_getCacheSizeForTesting()===0),但仍返回 dataUrl;(b) 正常路径 epoch 不变时正常写回。用 mockedGetImage.mockImplementation 返回一个在 resolve 前先 clearImageCache() 的 Promise 模拟竞态。新增 _getCacheEpochForTesting 断言自增。

2) 新建 src/lib/api/imageApiShared.test.ts(目前缺):测 mergeAbortSignals 返回 {signal, dispose};用 addEventListener spy 验证 dispose() 后 caller signal 上的 'abort' 监听被 removeEventListener;0/1 signal 返回 noop dispose 且 signal 正确。

3) 新建 src/lib/taskRuntime.test.ts(目前完全缺,本 WP 引入):mock ./db / ./imageCache / ./api / ./store。重点用例:(a) cancelTask 对 running 任务 → status 变 'error'、error===TASK_CANCELLED_ERROR、controller.abort 被调、watchdog timer 被 clearTimeout(用 vi.useFakeTimers + spy);(b) cancelTask 对非 running 任务返回 false 不改状态;(c) removeTask/removeMultipleTasks 删 running 任务时 terminateTaskRuntime 被触发(abort + clear);(d) executeTask 成功分支在 storeImage 后任务被删 → rollbackStoredImages 触发 deleteImage+deleteCachedImage,且对仍被引用 id 不删;(e) catch 分支任务已删(find undefined)不复活(不再 putTask)。

4) 复用 geminiImageApi.test.ts / api.test.ts 现有范式,补一条:确保解构 mergeAbortSignals 后 fetch 仍收到正确 signal、finally 仍 clearTimeout(回归保护)。

5) MaskEditorModal 的 handleSave 回滚因含大量 canvas/DOM 依赖,优先把「回滚决策」逻辑(是否删 workingTargetId 的引用检查)提取为可单测的纯函数;handleSave 端到端走运行时手测(保存时快速关闭/切图,确认无孤儿图)。

全量跑 `vitest run` + `tsc -b` 必须保持干净(206 用例不回归)。

### 回归风险

1) mergeAbortSignals 返回类型从 AbortSignal|undefined 改为对象,是破坏性签名变更——必须同步改全部 3 个调用点(openai 2 处、gemini 1 处),漏改会 tsc 报错(好处:编译期可发现)。

2) executeTask catch 分支「复活已删任务」(行 520 `?? task`)是真实回归隐患:步骤7 删 running 任务后,被 abort 的 fetch reject 进 catch,若不改守卫会 putTask 复活已删任务。步骤7 的配套守卫改动是 M6 正确性的关键,必须一并落地,否则删除在途任务会出现幽灵记录。

3) rollbackStoredImages / MaskEditor 回滚的内容寻址陷阱:storeImage 去重(db.ts:294),裸删可能误删被其它 task/inputImage 引用的同内容图,造成正在用的图丢失。必须做引用检查(复用 removeTask 的 stillUsed 收集),这是回滚类改动最大的回归面。

4) imageCache epoch 调整为「打断时仍返回 dataUrl 但不写回」——若改成审查原话「丢弃结果返回 undefined」,会让 reuseConfig/editOutputs 在恰好并发 clear 时误报「图片已不存在」。需保证语义是「不写僵尸缓存」而非「让正当读取失败」。

5) cancelTask 复用 'error' 状态:用户取消的任务会显示为「错误」态(红色错误 UI),语义上略不理想但不新增 TaskStatus 是为避免波及 taskFilters/导入归一化/UI 多处。若产品要求区分「取消」与「失败」,需单独立项扩 TaskStatus(超出本 WP)。

6) executeTask finally(529-535)对被取消任务仍会释放输入图缓存,与 cancelTask 内的 terminateTaskRuntime 中 clearTaskAbortController 幂等叠加,确认无双删报错(deleteCachedImage/clearTaskAbortController 均幂等,安全)。

---

## WP5 · 不可信输入校验 + 导入/迁移健壮性

**工作量** `L` · **依赖** none（自包含。与 M6『删除在途任务不中断请求』、M1『imageCache 僵尸缓存』在 taskRuntime.ts 有文件级邻接但无逻辑耦合，可并行；若同改 taskRuntime.ts initStore 需注意合并顺序）

### 总体思路

核心是为「所有持久化入口」补齐 normalize 白名单与原子化，沿用项目既有范式而不是新造轮子。读完真实代码后确认：(1) tasks 是导入链路中唯一没有 normalize 的实体——conversations 有 normalizeConversations(conversations.ts:44)、categories 有 normalizeFavoriteCategories(favoriteCategories.ts:32)，唯独 exportImport.ts:248-251 直接把 data.tasks 逐条 putTask 落库，且 TaskRecord 含 Record<string,...> 字段(actualParamsByImage/revisedPromptByImage，types.ts:161-163)正是 __proto__ 污染面。因此第一步是新建纯函数 normalizeTask，完全照搬 normalizeConversations 的「Array.isArray 守卫 + typeof object 跳过 + 逐字段类型校验 + 不可信 Record 用 Object.create(null)/白名单 key 过滤」骨架，并在 importData 写库前做 map+filter。(2) M5 原子性：replace 模式 clearTasks→clearImages→clearConversations 是三个独立事务(db.ts 每个 clear 各开一次 dbTransaction)，再逐条 await putTask/putImage，中途失败留半残。db.ts 已有 persistConversationMigration(98) 证明「单事务批量 put」是项目认可范式；新增 replaceAllData(tasks, images, conversations) 单事务批量写 + 失败时强提示「数据可能不完整」。(3) M4 幂等：initStore 的 shouldRunReseed(taskRuntime.ts:182-183)已经包含 hasOrphanTasks 这一「数据自身状态」判据，真正的修复是让 localStorage 版本号退化为「纯加速提示」——把判据主轴改成 hasOrphanTasks，localStorage 仅在「无孤儿但版本旧」时作一次性补迁触发，且 onupgradeneeded 已 put archive(db.ts:27)结构升级本身是原子的，迁移标记不再是唯一真相源。(4) M2 去重键：optimizer/captioner 的 dedupeKey(472,519)漏了 systemPrompt，导出抹空 apiKey 后同 baseUrl+model 多套配置折叠丢失——把 systemPrompt+name 纳入键即可，零结构改动。(5) low 项：path 穿越校验(强制 images/<id>.<ext> 且与 id 一致)、InputBar 上传大小校验(复用 imageApiShared 的字节常量思路但做成非抛错 UI 校验)、atob try/catch、openDB onblocked。优先级：先建 normalizeTask 与 replaceAllData 两个共享抽象，再改各调用点。

### 共享抽象

- **normalizeTask** — `src/lib/tasks.ts (新文件，与 conversations.ts/favoriteCategories.ts 同级，承载 task 归一化纯函数)`
  ```ts
  export function normalizeTask(input: unknown, now?: number): TaskRecord | null；配套 export function normalizeTasks(input: unknown, now?: number): TaskRecord[]
  ```
  导入/反序列化路径的 task 字段级白名单。照搬 normalizeConversations 范式：input 非 object→返回 null；逐字段校验(id 必须非空 string 否则 null；prompt 取 string 否则 ''；params 经 normalizeTaskParams 收敛到 TaskParams 白名单；inputImageIds/outputImages 过滤为 string[] 并 slice 到上限；status 限定 'running'|'done'|'error'；createdAt/finishedAt/elapsed 数字校验；isFavorite Boolean；favoriteCategoryId/conversationId/maskImageId 等 string|null)。关键安全点：actualParamsByImage/revisedPromptByImage 这类 Record 字段用 sanitizeRecord——遍历 Object.keys 时跳过 __proto__/constructor/prototype 危险 key，写入 Object.create(null) 或新对象。normalizeTasks 内部 Array.isArray 守卫 + map(normalizeTask) + filter(Boolean)。
- **normalizeTaskParams** — `src/lib/tasks.ts (与 normalizeTask 同文件)`
  ```ts
  function normalizeTaskParams(input: unknown): TaskParams
  ```
  把不可信 params 收敛到 TaskParams 字面量并集(size:string、quality:'auto'|'low'|'medium'|'high'、output_format:'png'|'jpeg'|'webp'、moderation:'auto'|'low'、output_compression:number|null、n:number、stylePreset?:string)，缺失/越界回落 DEFAULT_PARAMS(types.ts:102)。不复用 normalizeParamsForSettings(paramCompatibility.ts:11)——那是面向 settings 的运行期收敛(会改 n 上限/quality)，导入归一化只做类型白名单，语义不同。
- **replaceAllData** — `src/lib/db.ts (与 persistConversationMigration 同级，单事务批量写范式)`
  ```ts
  export function replaceAllData(payload: { tasks: TaskRecord[]; images: StoredImage[]; conversations: Conversation[] }): Promise<void>
  ```
  M5 原子化：在 [STORE_TASKS, STORE_IMAGES, STORE_CONVERSATIONS] 单事务内先各 store.clear() 再批量 put，tx.oncomplete/onerror/onabort 决议——清空与写入同一事务，中途失败整体回滚。注意 images 需先经 normalizeImageForStorage(db.ts:247) 处理(putImage 当前异步规整 blob)，故签名接收已规整好的 StoredImage，或在函数内对每个 image await normalizeImageForStorage 后再开事务(IDB 事务内不能 await，必须先规整)。
- **validateImageEntryPath** — `src/lib/exportImport.ts (模块内 helper，紧邻 getMimeFromPath:40)`
  ```ts
  function resolveImageEntry(id: string, info: { path: string }): { path: string; mime: string } | null
  ```
  low(path 穿越)：校验 info.path 严格形如 `images/${id}.${ext}` 且 ext∈{png,jpg,jpeg,webp}，拒绝含 '..'/绝对路径/与 id 不一致的条目(返回 null 跳过)。MIME 由校验通过的 ext 推断，替代当前无条件信任 path 的 getMimeFromPath。
- **assertImportFileSize / readFileWithSizeGuard** — `src/lib/taskRuntime.ts (addImageFromFile 入口处) 或抽到 src/lib/image/fileLimits.ts`
  ```ts
  export const MAX_INPUT_IMAGE_BYTES = 50 * 1024 * 1024；在 addImageFromFile(taskRuntime.ts:774) 内 if (file.size > MAX_INPUT_IMAGE_BYTES) throw new Error(`图片过大：上限 ...`)
  ```
  low(InputBar 无大小校验)：上传/拖放/粘贴最终都汇聚到 addImageFromFile(InputBar handleFiles:164→addImageFromFile)，在此单点加 file.size 上限即覆盖三入口，错误由 handleFiles 的 try/catch(index.tsx:174) 兜底成 toast，无需改三处 UI。MIME 已在 addImageFromFile:775 用 file.type.startsWith('image/') 把关。

### 步骤

#### 1. M3 (tasks 无 normalize / __proto__ 风险) — `src/lib/tasks.ts` @ 新文件，新增 normalizeTask / normalizeTasks / normalizeTaskParams / sanitizeRecord

**改动**:新建归一化纯函数，骨架完全对齐 normalizeConversations(conversations.ts:44-80)。normalizeTask：input 非 object 返回 null；id 必须 typeof string && trim 否则 null(丢弃整条，与 normalizeConversations 跳过无 id 一致)。逐字段白名单收敛。新增 sanitizeRecord 处理 actualParamsByImage/revisedPromptByImage：遍历时 if (key==='__proto__'||key==='constructor'||key==='prototype') continue，写入新对象。inputImageIds/outputImages 用 filter(x=>typeof x==='string') 并 slice(0, MAX_IMAGE_IDS_PER_TASK)。

```ts
const DANGEROUS_KEYS = new Set(['__proto__','constructor','prototype'])
export const MAX_IMAGE_IDS_PER_TASK = 64
function sanitizeStringRecord(input: unknown): Record<string,string> | undefined {
  if (!input || typeof input !== 'object') return undefined
  const out: Record<string,string> = {}
  for (const [k,v] of Object.entries(input as Record<string,unknown>)) {
    if (DANGEROUS_KEYS.has(k)) continue
    if (typeof v === 'string') out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}
export function normalizeTask(input: unknown, now = Date.now()): TaskRecord | null {
  if (!input || typeof input !== 'object') return null
  const item = input as Record<string, unknown>
  if (typeof item.id !== 'string' || !item.id.trim()) return null
  const createdAt = typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : now
  return {
    id: item.id,
    prompt: typeof item.prompt === 'string' ? item.prompt : '',
    params: normalizeTaskParams(item.params),
    apiProvider: item.apiProvider === 'gemini' ? 'gemini' : item.apiProvider === 'openai' ? 'openai' : undefined,
    apiProfileName: typeof item.apiProfileName === 'string' ? item.apiProfileName : undefined,
    apiModel: typeof item.apiModel === 'string' ? item.apiModel : undefined,
    actualParamsByImage: sanitizeRecordOfParams(item.actualParamsByImage),
    revisedPromptByImage: sanitizeStringRecord(item.revisedPromptByImage),
    inputImageIds: toStringArray(item.inputImageIds).slice(0, MAX_IMAGE_IDS_PER_TASK),
    outputImages: toStringArray(item.outputImages).slice(0, MAX_IMAGE_IDS_PER_TASK),
    maskTargetImageId: typeof item.maskTargetImageId === 'string' ? item.maskTargetImageId : null,
    maskImageId: typeof item.maskImageId === 'string' ? item.maskImageId : null,
    status: item.status === 'running' || item.status === 'done' || item.status === 'error' ? item.status : 'done',
    error: typeof item.error === 'string' ? item.error : null,
    createdAt,
    finishedAt: typeof item.finishedAt === 'number' && Number.isFinite(item.finishedAt) ? item.finishedAt : null,
    elapsed: typeof item.elapsed === 'number' && Number.isFinite(item.elapsed) ? item.elapsed : null,
    isFavorite: typeof item.isFavorite === 'boolean' ? item.isFavorite : undefined,
    favoriteCategoryId: typeof item.favoriteCategoryId === 'string' ? item.favoriteCategoryId : null,
    sortOrder: typeof item.sortOrder === 'number' && Number.isFinite(item.sortOrder) ? item.sortOrder : undefined,
    conversationId: typeof item.conversationId === 'string' ? item.conversationId : undefined,
  }
}
export function normalizeTasks(input: unknown, now = Date.now()): TaskRecord[] {
  if (!Array.isArray(input)) return []
  return input.map((t) => normalizeTask(t, now)).filter((t): t is TaskRecord => t !== null)
}
```
> 可行性:审查建议的 normalizeTask(unknown): TaskRecord|null 完全可行且与现有范式一致。补充：sanitizeRecordOfParams 需对 actualParamsByImage 的 value(Partial<TaskParams>)也跑 normalizeTaskParams 的子集校验，避免嵌套污染；toStringArray = Array.isArray(x)?x.filter(v=>typeof v==='string'):[]。注意 status 兜底为 'done' 而非保留 'running'——导入历史里不应有运行中任务(对齐 markInterruptedSyncHttpTasks 思路)，但更稳妥是保留原值交给 initStore 的 markInterruptedSyncHttpTasks 处理；二者皆可，建议保留原值以免误改语义。

#### 2. M3 (导入写库前过滤) — `src/lib/exportImport.ts` @ importData，行 236 sanitizeImportedTasksForFavoriteCategories 之前；以及 248-251 putTask 循环

**改动**:在 data.tasks 进入 sanitizeImportedTasksForFavoriteCategories(236) 之前先跑 normalizeTasks(data.tasks)，得到干净的 TaskRecord[] 再传入既有的分类悬空清理。这样 sanitizeImportedTasksForFavoriteCategories 的输入已是白名单后的强类型，248-251 putTask 落库的就是安全数据。data.tasks.length(328 行的 toast 计数) 改为用 normalize 后的数组长度，保持提示准确。

```ts
import { normalizeTasks } from './tasks'
// ...
const normalizedTasks = normalizeTasks(data.tasks)
const importedTasks = sanitizeImportedTasksForFavoriteCategories(normalizedTasks, importedCategoryIds)
// ... 末尾 toast：`已导入 ${normalizedTasks.length} 条记录`
```
> 可行性:可行。注意 sanitizeImportedTasksForFavoriteCategories(80) 签名是 (tasks: TaskRecord[], ...)，正好接收 normalizeTasks 输出。213 行的 `if (!data.tasks || !data.imageFiles)` 守卫保留(快速失败)，但即使 data.tasks 是脏数组，normalizeTasks 也会安全过滤。

#### 3. M5 (导入非原子) — `src/lib/db.ts` @ 新增 replaceAllData，紧邻 persistConversationMigration(98-115)

**改动**:新增单事务批量替换函数。先对每个 image await normalizeImageForStorage(247)(IDB 事务内不能 await，必须前置规整)，再开 [STORE_TASKS,STORE_IMAGES,STORE_CONVERSATIONS] 单事务：三个 store 各 clear() 后批量 put。tx.oncomplete resolve / onerror+onabort reject，实现清空+写入原子。

```ts
export async function replaceAllData(payload: {
  tasks: TaskRecord[]; images: StoredImage[]; conversations: Conversation[]
}): Promise<void> {
  const normalizedImages = await Promise.all(payload.images.map(normalizeImageForStorage))
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_TASKS, STORE_IMAGES, STORE_CONVERSATIONS], 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('replace all data aborted'))
    const taskStore = tx.objectStore(STORE_TASKS); taskStore.clear()
    for (const t of payload.tasks) taskStore.put(t)
    const imgStore = tx.objectStore(STORE_IMAGES); imgStore.clear()
    for (const i of normalizedImages) imgStore.put(i)
    const convStore = tx.objectStore(STORE_CONVERSATIONS); convStore.clear()
    for (const c of payload.conversations) convStore.put(c)
  })
}
```
> 可行性:审查建议「清空+写入收敛到尽量少事务」可行。但完整重构 importData 为纯 replaceAllData 风险高(replace 链路还交织 favoriteCategories/conversation reseed/imageFiles 逐条解 ZIP)。务实方案：(a) replace 模式下，先在内存里完整组装 tasks+images+conversations(解 ZIP、normalize、reseed 全部就绪)，最后一次 replaceAllData 提交——把多事务收敛成一次；(b) 若改造范围过大(L)，降级为最小修复：在 replace 失败的 catch(330) 分支额外 showToast『替换导入中途失败，数据可能不完整，请重新导入或清空后重试』强提示(对应审查的兜底建议)。建议本 WP 先做 (b) 强提示(S) + 新增 replaceAllData 抽象备用，(a) 作为后续优化，避免一次性大改回归。

#### 4. M4 (迁移受 localStorage 门控，应改用数据自身状态判幂等) — `src/lib/taskRuntime.ts` @ initStore，行 182-183 shouldRunReseed 判据

**改动**:把幂等主判据从 localStorage 版本号改为数据自身状态。现状 shouldRunReseed = migrationVersion < VERSION || hasOrphanTasks，问题是 localStorage 被清时 migrationVersion 恒 0 → 每次重跑全表。改为：以 hasOrphanTasks 为主轴(只有存在 conversationId 缺失的 task 才需要 reseed)；localStorage 版本号退化为『一次性补迁加速提示』——仅当无孤儿但版本旧且确有 favoriteCategory 需要建对应 conversation 时触发一次(避免老用户首次升级漏建分类对话)。reseed 是纯函数且对已有 conversationId 的 task 不触碰(conversationMigration.ts:60)，重跑本身幂等无数据损坏，真正要消除的是『无谓的全表写事务』。

```ts
const hasOrphanTasks = interruptedNormalizedTasks.some((task) => !task.conversationId)
// 数据自身状态为主：有孤儿就必须 reseed
// localStorage 仅作一次性补迁提示，且 reseed 只在真正会改变结果时才落库
const needsFirstTimeBackfill = migrationVersion < CONVERSATION_MIGRATION_VERSION
const shouldRunReseed = hasOrphanTasks || needsFirstTimeBackfill
// 关键改动：reseed 后仅当 dirtyTasks.length 或 conversations 实际新增时才 persist，
// 否则跳过写事务并直接 writeConversationMigrationVersion，避免空跑全表写
if (shouldRunReseed) {
  const { conversations: migratedConversations, dirtyTasks } = reseedConversationsFromFavoriteCategories({...})
  const conversationsChanged = migratedConversations.length !== normalizedExistingConversations.length
  if (dirtyTasks.length || conversationsChanged || interruptedTasks.length) {
    await persistConversationMigration(migratedConversations, persistTasks)
  }
  writeConversationMigrationVersion(CONVERSATION_MIGRATION_VERSION)
  finalConversations = normalizeConversations(migratedConversations)
  finalTasks = mergedTasks
}
```
> 可行性:审查建议『幂等判据改用数据自身状态，localStorage 仅作加速提示』完全可行，且最小改动。审查另一选项『版本号存进 IDB meta store 同事务』需要 DB_VERSION 升级(db.ts:5 现为 2)+新建 meta store，属结构变更，回归面大，本 WP 不采用。当前改法保留 needsFirstTimeBackfill 是为兼容『老用户已 v2、有分类但 task 已有 conversationId(无孤儿)却尚未建分类对话』的边界——但需确认该场景是否真实存在：若 reseed 对已有 conversationId 的 task 不动(确实如此，migration:60)，则无孤儿时 reseed 仅可能新增 category→conversation 映射；可加 conversationsChanged 判定避免空写。若产品确认所有历史 task 都已带 conversationId，可进一步简化为纯 hasOrphanTasks 判据，localStorage 仅防『升级瞬间』竞态。

#### 5. M2 (去重键过窄丢配置) — `src/lib/api/apiProfiles.ts` @ getOptimizerProfileDedupKey(472-478) 与 getCaptionerProfileDedupKey(519-525)

**改动**:把 systemPrompt(以及 name)纳入去重键。导出时 apiKey 被抹空(exportImport.ts redactSettingsForExport:61-77)，往返导入后同 baseUrl+model 的多套 optimizer/captioner 配置 dedupeKey 完全相同，dedupeOptimizerProfiles(480)/dedupeCaptionerProfiles(527) 只保留第一个 → 静默丢失多套 systemPrompt。把 systemPrompt 加入 JSON.stringify 数组即可。

```ts
function getOptimizerProfileDedupKey(profile: PromptOptimizerProfile): string {
  return JSON.stringify([
    profile.baseUrl.trim().replace(/\/+$/, '').toLowerCase(),
    profile.apiKey.trim(),
    profile.model.trim(),
    profile.systemPrompt.trim(),
    profile.name.trim(),
  ])
}
// getCaptionerProfileDedupKey 同样补 systemPrompt + name
```
> 可行性:可行，零结构改动。审查的两个备选(加 systemPrompt / apiKey 空时不折叠)中，加 systemPrompt+name 更稳：既解决往返丢配置，也不影响 mergeImportedSettings(566) 里 existingOptimizerKeys/existingCaptionerKeys 的语义(仍按内容去重，只是粒度更细)。getApiProfileDedupKey(452)含 apiKey 但 ApiProfile 无 systemPrompt，不在本问题范围，保持不动。

#### 6. low (imageFiles.path 信任 ZIP 路径穿越) — `src/lib/exportImport.ts` @ importData 还原图片循环 239-246；新增 resolveImageEntry helper 紧邻 getMimeFromPath(40)

**改动**:用 resolveImageEntry(id, info) 替代当前直接信任 info.path 查表 + getMimeFromPath。校验 path 严格匹配 `images/${id}.${ext}` 且 ext∈白名单，拒绝 '..'/绝对路径/id 不符的条目(跳过)。MIME 由校验后的 ext 推断。','

```ts
function resolveImageEntry(id: string, info: { path: string }): { mime: string } | null {
  const m = /^images\/(.+)\.(png|jpg|jpeg|webp)$/.exec(info.path)
  if (!m || m[1] !== id) return null
  if (info.path.includes('..')) return null
  return { mime: getMimeFromPath(info.path) }
}
// 循环内：
for (const [id, info] of Object.entries(data.imageFiles)) {
  if (existingImageIds.has(id)) continue
  const resolved = resolveImageEntry(id, info)
  if (!resolved) continue
  const bytes = unzipped[info.path]
  if (!bytes) continue
  const blob = new Blob([copyBytesToArrayBuffer(bytes)], { type: resolved.mime })
  await putImage({ id, blob, mime: resolved.mime, createdAt: info.createdAt, source: info.source })
}
```
> 可行性:可行。m[1]!==id 即实现『path 与 id 交叉校验』。注意 id 是 SHA-256 hash 或 fallback-…(db.ts:hashDataUrl/287)，不含 '/'，正则 (.+) 捕获后整体比对即可。info.source 也应顺手校验为 'upload'|'generated'|'mask'，否则交给 normalizeImageForStorage(db.ts:259)时会原样带入——可在 putImage 前限定。

#### 7. low (InputBar 上传/拖放/粘贴无大小校验) — `src/lib/taskRuntime.ts` @ addImageFromFile(774-780)

**改动**:在 addImageFromFile 入口、file.type 校验(775)之后加 file.size 上限校验。上传/拖放/粘贴三入口最终都汇聚到此函数(InputBar handleFiles:164 调 addImageFromFile；captionFilePick 是另一路但只读不入库)，单点设限即覆盖。超限 throw，由 handleFiles 的 try/catch(index.tsx:174-179)兜底成 toast。

```ts
export const MAX_INPUT_IMAGE_BYTES = 50 * 1024 * 1024
export async function addImageFromFile(file: File): Promise<void> {
  if (!file.type.startsWith('image/')) return
  if (file.size > MAX_INPUT_IMAGE_BYTES) {
    throw new Error(`图片过大：上限 ${Math.round(MAX_INPUT_IMAGE_BYTES/1024/1024)}MB`)
  }
  const dataUrl = await fileToDataUrl(file)
  // ...
}
```
> 可行性:可行且最省改动——无需动 InputBar/useDragDropFiles。常量值与 imageApiShared.ts:9 的 MAX_MASK_EDIT_FILE_BYTES(50MB) 对齐保持口径一致。注意 addImageFromUrl(783) 走 fetch+blob，blob.size 也应同样设限(对应右键菜单入口 ImageContextMenu:120)。captionFilePick(InputBar:194) 不入库可暂不限，或一并加以防超大 base64 卡 UI。

#### 8. low (db.ts atob 无容错) — `src/lib/db.ts` @ dataUrlToImageBlob(205-212) 与 getDataUrlMeta(190-203)

**改动**:把 atob/decodeURIComponent 解码包 try/catch，损坏 dataUrl 抛语义化错误而非裸 DOMException。dataUrlToImageBlob 被 putImage/storeImage/normalizeImageForStorage 多路复用(db.ts:251,298)，是常见路径。

```ts
export function dataUrlToImageBlob(dataUrl: string): { blob: Blob; mime: string } {
  const { mime, isBase64, payload } = getDataUrlMeta(dataUrl)
  let bytes: Uint8Array
  try {
    bytes = isBase64
      ? createBytesFromBinary(atob(payload.replace(/\s/g, '')))
      : new TextEncoder().encode(decodeURIComponent(payload))
  } catch {
    throw new Error('图片 data URL 解码失败：内容已损坏')
  }
  return { blob: new Blob([copyBytesToArrayBuffer(bytes)], { type: mime }), mime }
}
```
> 可行性:可行，零调用方改动(仍抛 Error，上层既有 catch 兜底)。getDataUrlMeta 已对格式抛『图片 data URL 格式无效』(194)，保持一致风格。

#### 9. low (db.ts open 无 onblocked) — `src/lib/db.ts` @ openDB(10-40)

**改动**:给 indexedDB.open 加 onblocked 处理与 upgrade 事务的 onabort/onerror，避免其它标签页持旧连接时版本升级阻塞导致 Promise 永久挂起。onblocked 时 reject 语义化错误(提示关闭其它标签页)；onupgradeneeded 的 tx 加 onabort/onerror reject。','

```ts
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const tx = (e.target as IDBOpenDBRequest).transaction
      if (tx) { tx.onabort = () => reject(tx.error ?? new Error('数据库升级被中止')); tx.onerror = () => reject(tx.error) }
      // ...既有 store 创建逻辑...
    }
    req.onblocked = () => reject(new Error('数据库升级被其它标签页阻塞，请关闭本站其它标签页后重试'))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
```
> 可行性:可行。审查另建议『超时兜底』——可加但需谨慎：IDB 阻塞解除后 open 仍可能成功，硬超时 reject 会让已成功的连接泄漏；建议仅做 onblocked+tx.onabort/onerror，不加裸 setTimeout 超时(避免误杀正常的慢升级)。fake-indexeddb 测试环境支持 onblocked 触发，可测。

### 测试策略

复用现有 vitest 模式，按文件归位：(1) 新建 src/lib/tasks.test.ts(对齐 conversations.test.ts/favoriteCategories 无 mock 的纯函数测法)：normalizeTask 丢弃无 id 条目返回 null；缺字段回落默认；status 越界→兜底；inputImageIds 含非 string 被过滤、超 MAX_IMAGE_IDS_PER_TASK 被 slice；重点用例——actualParamsByImage/revisedPromptByImage 含 '__proto__'/'constructor' key 时被剔除且不污染 Object.prototype(断言 ({} as any).polluted===undefined)。(2) exportImport.test.ts 已有完整 db mock(vi.mock('./db'))与 createImportFile helper：新增用例——导入含脏 task(缺 id/含 __proto__)时 putTask 只收到 normalize 后的安全数据(扩展现有 'imports favorite category metadata' 模式)；path 穿越用例——imageFiles 里 path='images/../evil.png' 或 path 与 id 不符时该图被跳过(putImage 不被调用)；replace 强提示用例(若采用兜底方案)——mock putTask 抛错时 showToast 收到『数据可能不完整』。(3) db.test.ts 用真实 fake-indexeddb：新增 replaceAllData 用例——预置脏数据后 replaceAllData 单事务替换、getAllTasks/Images/Conversations 只剩新数据；dataUrlToImageBlob 损坏输入(如 'data:image/png;base64,@@@')抛『解码失败』而非 DOMException。(4) apiProfiles.test.ts：新增往返用例——两套同 baseUrl+model、不同 systemPrompt 的 optimizer/captioner profile，apiKey 抹空后经 mergeImportedSettings 不被折叠(dedupe 后仍为 2 套)。(5) taskRuntime 的 initStore M4 改动：扩展现有 store.test.ts 或新建——localStorage 版本号已是最新但存在孤儿 task 时仍 reseed；无孤儿且版本最新时不触发 persistConversationMigration 写事务(断言 mock 调用次数为 0)。(6) addImageFromFile 大小校验可在 taskRuntime 测试中以构造超大 File(new File([big], ...)) 断言 throw。全部跑 `npm run test` + `npm run typecheck` 保持 206 用例及类型干净基线。

### 回归风险

回归风险按改动排序：(1) normalizeTask 最高风险点是『过度严格丢数据』——若某真实历史 task 字段类型与白名单不符会被静默归一化或整条丢弃(无 id 时)；务必对照 types.ts:148-190 TaskRecord 所有可选字段(actualParams/partialFailureCount/persistenceError 等)逐一保留，缺漏会导致往返导入掉字段。建议 normalizeTask 对未知但无害的运行期字段(如 persistenceError)也保留或显式忽略，并在 PR 里列字段对照表。(2) M4 initStore 改判据风险：若误把『无孤儿但需建分类对话』场景判为不需 reseed，老用户分类对话不再自动生成；feasibilityNote 已加 conversationsChanged 兜底，但需产品确认历史 task 是否都已带 conversationId。改动触及启动主链路，建议保留 localStorage 版本号作 needsFirstTimeBackfill 而非彻底删除。(3) M5 若选完整 replaceAllData 重构(方案 a)风险为 L 级——replace 链路交织 ZIP 解包/favoriteCategories/conversation reseed，一次性收敛易引入新 bug；建议先上强提示(方案 b，S 级)与 replaceAllData 抽象，重构留后续。(4) dedupeKey 加 systemPrompt：理论上让『仅 systemPrompt 不同』的本地配置在 merge 时不再折叠为同一条——这正是期望行为，但若有用户依赖旧的激进折叠去重，会看到配置数变多(可接受，属修 bug)。(5) path 正则校验：若历史导出的 path 命名规则与 `images/<id>.<ext>` 不完全一致(如旧版用了别的扩展或大小写)，会误跳过图片导致丢图；需核对 exportData(166) 当前生成规则——确认 ext 来自 getImageExt 仅产出 png/jpg/webp，与校验白名单一致，但 jpeg→jpg 的归一(getImageExt:35)要确保正则含 jpg。(6) onblocked/atob 改动风险低，纯增健壮性。整体不改 DB_VERSION，不触发 IDB 结构迁移，向后兼容。

---

## WP6 · 核心正确性簇(Responses 解析 / 剪贴板 / 流式竞态)

**工作量** `L` · **依赖** none。但需与其它工作包协调三点:(a) useStreamingText 是新共享 hook,若有 WP 也在动这两个 Modal 会冲突;(b) toPngBlob 加在 canvasImage.ts,若有 WP 同改该文件需合并;(c) captionImageApi 的 SSE 吞错与 optimizePromptApi 同源,若另有 WP 负责 optimizePromptApi 建议同时对齐两处错误体解析,避免重复修补。

### 总体思路

读完真实代码后,问题分三层。(1) M1 是确定性核心 bug:类型 `ResponsesOutputItem.result` 已声明为 `string | { b64_json?; image?; data? }`(types.ts:242-255),但 parseResponsesImageResults(openaiCompatibleImageApi.ts:96-103)只走 `typeof result === 'string'` 分支,对象形态的 result 被静默丢弃,导致明明返回了图却抛"接口未返回可用图片数据"。修法是抽一个 `extractResponsesImageBase64(result)` helper,统一把 string / 对象(b64_json|image|data,且这些字段值本身可能是 data URL 或裸 base64)规整为一个候选字符串,再交给既有 normalizeBase64Image。(2) H2 剪贴板:copyBlobToClipboard(clipboard.ts:18-26) 直接 `new ClipboardItem({ [blob.type]: blob })`,浏览器对非 image/png 普遍拒绝写入(且空 type 会得到 `{ '': blob }` 的坏键)。复用 canvasImage.ts 既有的 imageDataUrlToPngBlob/canvasToBlob 范式:新增 toPngBlob(blob) —— 若已是 png 直接用,否则经 createImageBitmap/Image + canvas 转 png;copyBlobToClipboard 内部统一转 png 后写入。(3) 主题9 流式竞态:两个 Modal 的 onDelta(PromptOptimizerModal.tsx:40-42、ImageCaptionModal.tsx:42)无 abort 守卫,旧流被 abort() 后已入队的 delta 仍会 `setX((s)=>s+chunk)` 污染新一轮文本;`.then/.catch` 里虽有 `controller.signal.aborted` 守卫,但 onDelta 没有。最干净的修法是抽一个共享 hook `useStreamingText`,把"创建/中止 controller、per-run 守卫 onDelta、phase/error 收敛、reset"全部封装,两个 Modal 复用,顺带消除两份几乎重复的 60 行逻辑。(4) 三个 low 顺带在对应 helper/函数里修:captionImageApi SSE 吞错误体、getDataUrlEncodedByteSize 口径、createMaskPreviewDataUrl 的 canvas 释放。先建抽象(extractResponsesImageBase64 / toPngBlob / useStreamingText)再改调用点。

### 共享抽象

- **extractResponsesImageBase64** — `src/lib/api/imageApiShared.ts`
  ```ts
  export function extractResponsesImageBase64(result: string | { b64_json?: string; image?: string; data?: string } | undefined | null): string | null
  ```
  把 Responses output item 的 result(string 或对象形态)统一规整为一个非空候选字符串(返回前 trim,空则 null);对象形态按 b64_json → image → data 优先取第一个非空字符串。返回值后续仍交给既有 normalizeBase64Image 加 data: 前缀,职责单一、可单测。修复 M1 的核心。
- **toPngBlob** — `src/lib/image/canvasImage.ts`
  ```ts
  export async function toPngBlob(blob: Blob): Promise<Blob>
  ```
  接收任意图片 Blob,已是 image/png 直接返回;否则用 loadImage(经 URL.createObjectURL)/canvas + 既有 canvasToBlob 转成 image/png。供 copyBlobToClipboard 复用,确保只往剪贴板写 image/png,且避免空 type 的坏 ClipboardItem 键。与既有 imageDataUrlToPngBlob 同源范式,但入参是 Blob 而非 dataUrl。
- **useStreamingText** — `src/hooks/useStreamingText.ts`
  ```ts
  export function useStreamingText(run: (opts: { signal: AbortSignal; onDelta: (chunk: string) => void }) => Promise<unknown>): { text: string; phase: 'idle' | 'streaming' | 'done' | 'error'; errorMessage: string | null; start: (preflight?: () => string | null) => void; cancel: () => void; reset: () => void }
  ```
  封装流式文本任务的生命周期:每次 start 生成新 AbortController 并自增 runIdRef,onDelta 内先校验 runId 与 signal.aborted 再 setText,旧流的迟到 delta 不会污染新一轮;.then/.catch 同样按 runId+aborted 守卫收敛 phase。preflight 用于源校验(如未选图返回错误文案直接进 error 态,不发请求)。PromptOptimizerModal 与 ImageCaptionModal 共用,消除两份重复逻辑并根治主题9。

### 步骤

#### 1. M1 — Responses 对象形态 result 被丢弃 — `src/lib/api/imageApiShared.ts` @ 在 normalizeBase64Image(第 77-79 行)附近新增 extractResponsesImageBase64

**改动**:新增导出函数 extractResponsesImageBase64,统一处理 string / 对象两种 result 形态,返回首个非空候选字符串或 null。对象字段优先级 b64_json → image → data。

```ts
export function extractResponsesImageBase64(result: string | { b64_json?: string; image?: string; data?: string } | undefined | null): string | null {
  if (typeof result === 'string') { const t = result.trim(); return t || null }
  if (result && typeof result === 'object') {
    for (const v of [result.b64_json, result.image, result.data]) {
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
  }
  return null
}
```
> 可行性:可行。类型已是 `string | { b64_json?; image?; data? }`(types.ts:244-248),无需改类型。注意对象字段值既可能是裸 base64 也可能已是 data URL,故仍统一交给 normalizeBase64Image(它对 data: 开头透传),不要在此函数里加前缀。

#### 2. M1 — 让 parseResponsesImageResults 走新 helper — `src/lib/api/openaiCompatibleImageApi.ts` @ parseResponsesImageResults 第 96-103 行的 `const result = item.result` 分支

**改动**:把只认 string 的 `if (typeof result === 'string' && result.trim())` 改为调用 extractResponsesImageBase64,拿到候选后再 normalizeBase64Image。导入处(第 4-21 行的 import 块)补 extractResponsesImageBase64。

```ts
const raw = extractResponsesImageBase64(item.result)
if (raw) {
  results.push({
    image: normalizeBase64Image(raw, fallbackMime),
    actualParams: mergeActualParams(pickActualParams(item)),
    revisedPrompt: typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined,
  })
}
```
> 可行性:可行。pickActualParams(item) 不受影响(它读的是 item 上的 size/quality 等同级字段,非 result)。第 106-108 的兜底 throw 保留作为真正无图时的提示。

#### 3. H2 + low(空 type 键) — 剪贴板非 PNG 必抛错 — `src/lib/image/canvasImage.ts` @ imageDataUrlToPngBlob(第 28-37 行)之后新增 toPngBlob(blob)

**改动**:新增 toPngBlob:已是 image/png 直接返回;否则用 URL.createObjectURL(blob) 走 loadImage 画到 canvas,再用既有 canvasToBlob(canvas,'image/png') 导出,finally 里 URL.revokeObjectURL 释放。

```ts
export async function toPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob
  const url = URL.createObjectURL(blob)
  try {
    const image = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('当前浏览器不支持 Canvas')
    ctx.drawImage(image, 0, 0)
    return canvasToBlob(canvas, 'image/png')
  } finally { URL.revokeObjectURL(url) }
}
```
> 可行性:可行且优于直接复用 imageDataUrlToPngBlob(那个吃 dataUrl,这里入参是 Blob,转 dataUrl 再转回多一次编解码)。loadImage 现接受 src 字符串,objectURL 可直接用。

#### 4. H2 — copyBlobToClipboard 统一转 PNG — `src/lib/image/clipboard.ts` @ copyBlobToClipboard 第 18-26 行

**改动**:在 navigator.clipboard 可用性检查后,先 `const png = await toPngBlob(blob)`,再 `new ClipboardItem({ [png.type]: png })`。文件顶部从 ../image/canvasImage 导入 toPngBlob。这同时消除空 type 导致 `{ '': blob }` 坏键的 low 问题(toPngBlob 保证 type 为 image/png)。

```ts
import { toPngBlob } from './canvasImage'
// ...
export async function copyBlobToClipboard(blob: Blob) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('Clipboard image API is not available')
  }
  const png = await toPngBlob(blob)
  await navigator.clipboard.write([new ClipboardItem({ [png.type]: png })])
}
```
> 可行性:可行。调用方 DetailModal.tsx handleCopyInputImage(:257-270)、ImageContextMenu.tsx handleCopy(:75-87) 均 try/catch 包裹,转换失败会走既有 getClipboardFailureMessage 提示,无需改调用点。注意 clipboard.ts 与 canvasImage.ts 同在 lib 下,确认无循环依赖(canvasImage 不引用 clipboard,安全)。

#### 5. 主题9 — 抽流式守卫 hook — `src/hooks/useStreamingText.ts` @ 新建文件(参照 useCloseOnEscape.ts 的 hook 范式)

**改动**:实现 useStreamingText:内部维护 text/phase/errorMessage state、abortRef、runIdRef。start(preflight?) 先 abortRef.current?.abort();自增 runIdRef;若 preflight 返回非空字符串则置 error 文案并 return(不发请求);否则新建 controller、reset text、置 streaming,调用 run({signal, onDelta}),onDelta 内 `if (runIdRef.current !== myRunId || controller.signal.aborted) return` 后再 setText 追加;.then/.catch 同样按 myRunId+aborted 守卫。cancel/reset 暴露给 handleClose。

```ts
export function useStreamingText(run) {
  const [text,setText]=useState('')
  const [phase,setPhase]=useState<'idle'|'streaming'|'done'|'error'>('idle')
  const [errorMessage,setErrorMessage]=useState<string|null>(null)
  const abortRef=useRef<AbortController|null>(null)
  const runIdRef=useRef(0)
  const runRef=useRef(run); runRef.current=run
  const start=useCallback((preflight?:()=>string|null)=>{
    abortRef.current?.abort()
    const myRunId=++runIdRef.current
    const pre=preflight?.()
    if (pre){ setPhase('error'); setErrorMessage(pre); return }
    const controller=new AbortController(); abortRef.current=controller
    setText(''); setErrorMessage(null); setPhase('streaming')
    runRef.current({ signal:controller.signal, onDelta:(c)=>{
      if (runIdRef.current!==myRunId||controller.signal.aborted) return
      setText((s)=>s+c)
    }}).then(()=>{ if(runIdRef.current!==myRunId||controller.signal.aborted) return; setPhase('done') })
      .catch((err)=>{ if(runIdRef.current!==myRunId||controller.signal.aborted) return; setPhase('error'); setErrorMessage(err instanceof Error?err.message:String(err)) })
  },[])
  const cancel=useCallback(()=>{ abortRef.current?.abort(); abortRef.current=null },[])
  const reset=useCallback(()=>{ cancel(); setText(''); setPhase('idle'); setErrorMessage(null) },[cancel])
  return { text, phase, errorMessage, start, cancel, reset }
}
```
> 可行性:可行。两个 Modal 现有 .then/.catch 守卫只挡 phase,不挡 onDelta —— 这是真实污染点;runId 守卫比单纯 signal.aborted 更稳(rapid 重试时旧 controller 已换引用,signal.aborted 也能挡,但 runId 对 StrictMode 双调用与 reset 后追加更可靠)。

#### 6. 主题9 — PromptOptimizerModal 接入 hook — `src/components/PromptOptimizerModal.tsx` @ 第 16-19 行的 state/abortRef、第 26-53 行 runOptimize、第 64-72 行 handleClose

**改动**:删去 optimized/phase/errorMessage 三个 useState 与 abortRef,改用 useStreamingText(({signal,onDelta})=>optimizePromptStream(optimizerRef.current, promptRef.current, {signal,onDelta}))。runOptimize 改为 start();handleClose 调 reset() 后 setShowPromptOptimizer(false);handleRetry 调 start();handleAdopt 用 text 替换 optimized。JSX 中 optimized→text。

```ts
const { text, phase, errorMessage, start, reset } = useStreamingText(
  ({ signal, onDelta }) => optimizePromptStream(optimizerRef.current, promptRef.current, { signal, onDelta })
)
const runOptimize = useCallback(() => start(), [start])
// handleClose: reset(); setShowPromptOptimizer(false)
// useEffect 仍在 showPromptOptimizer 变 true 时 runOptimize,卸载时 cancel()
```
> 可行性:可行。promptRef/optimizerRef(:21-24)保留;useEffect 依赖 [showPromptOptimizer, runOptimize] 不变。注意 handleAdopt 里 `optimized.trim()` 全部改 `text.trim()`,采用按钮 disabled 条件 `!isDone || !text.trim()` 同步改名。

#### 7. 主题9 — ImageCaptionModal 接入 hook — `src/components/ImageCaptionModal.tsx` @ 第 16-19 行 state/abortRef、第 27-53 行 runCaption、第 64-71 行 handleClose

**改动**:同 PromptOptimizerModal,用 useStreamingText(({signal,onDelta})=>captionImageStream(configRef.current, sourceRef.current!, {signal,onDelta}))。runCaption 用 start(preflight) 把'未选择图片'校验放进 preflight。caption→text 重命名。

```ts
const { text, phase, errorMessage, start, reset } = useStreamingText(
  ({ signal, onDelta }) => captionImageStream(configRef.current, sourceRef.current as string, { signal, onDelta })
)
const runCaption = useCallback(() => start(() => (sourceRef.current ? null : '未选择图片')), [start])
// canAdopt: isDone && Boolean(text.trim())
```
> 可行性:可行。原 runCaption 在 source 为空时 setPhase('error')+return(:32-36),用 preflight 等价表达;captionImageStream 自身也对空 imageDataUrl 抛错,双重保险。handleReplace/handleAppend 里 caption→text。

#### 8. low — captionImageApi SSE 仅认 data 行吞错误体 — `src/lib/api/captionImageApi.ts` @ parseSseLine 第 22-35 行 / 流读取循环第 119-142 行

**改动**:现状 response.ok 时若服务端返回非 SSE 的 JSON 错误体(如 {"error":{...}}),因每行不以 data: 开头,parseSseLine 全返回 null,最终落到 full 为空 → 抛'反推结果为空',真实错误被吞。改:在循环结束后若 full 为空且 buffer/已读内容里检出 JSON error,优先用 getApiErrorMessage 风格解析出可读错误。最小改动:把整段非 data 文本累积,结束时若无 delta 且累积体可解析出 error.message 则抛该消息。

```ts
// 累积原始体: rawBody += line(或在 done 后用已读全文)
// 结束判定:
if (!full.trim()) {
  try { const j = JSON.parse(rawBody.trim()); const m = j?.error?.message ?? j?.message; if (typeof m==='string'&&m) throw new Error(m) } catch (e) { if (e instanceof Error && e.message) throw e }
  throw new Error('反推结果为空')
}
```
> 可行性:可行但需谨慎:不要把正常的多行 SSE 误判为 JSON。建议仅当『整个响应无任何可解析 data delta』时才尝试 JSON.parse 累积体。imageApiShared 已有 getApiErrorMessage(Response),但此处是 stream 读后的字符串,不能直接复用(它吃 Response 且会二次 read body);故内联一个轻量 error.message 提取即可。optimizePromptApi 有同样问题,但本 WP 仅列了 captionImageApi,可在 feasibilityNote 标注同源问题留待对齐。

#### 9. low — getDataUrlEncodedByteSize 口径(字符长度 vs decoded) — `src/lib/api/imageApiShared.ts` @ getDataUrlEncodedByteSize 第 85-87 行,及调用点 openaiCompatibleImageApi.ts:352-353

**改动**:现 getDataUrlEncodedByteSize 直接返回 dataUrl.length(字符数,含 'data:...;base64,' 头与 base64 膨胀),而 images API 路径(:208-209)用真实 blob.size(decoded 字节)。两条路径对同一上限 MAX_IMAGE_INPUT_PAYLOAD_BYTES 的计量口径不一致。统一改为用 getDataUrlDecodedByteSize 计量 payload,使 responses 路径与 images 路径口径一致(都按解码后字节)。

```ts
// callResponsesImageApiSingle 第 351-354 行:
assertImageInputPayloadSize(
  inputImageDataUrls.reduce((sum, dataUrl) => sum + getDataUrlDecodedByteSize(dataUrl), 0) +
    (opts.maskDataUrl ? getDataUrlDecodedByteSize(opts.maskDataUrl) : 0),
)
// 并移除/弃用 getDataUrlEncodedByteSize 的 import
```
> 可行性:可行。getDataUrlDecodedByteSize 已实现且健壮(:89-100)。若担心移除 getDataUrlEncodedByteSize 影响其它引用,先 Grep 确认仅此处使用;本次 Read 范围内仅 openaiCompatibleImageApi 导入它,应可安全替换。改后注意 assertMaskEditFileSize(:348-349)已用 decoded,口径自洽。

#### 10. low — createMaskPreviewDataUrl 预览 3 canvas 不释放 — `src/lib/image/canvasImage.ts` @ createMaskPreviewDataUrl 第 73-112 行

**改动**:函数创建了 canvas / maskCanvas / overlayCanvas 三个离屏 canvas,返回 dataURL 后未显式置零尺寸释放显存。在 return 前把三者 width/height 置 0(或将 maskCanvas/overlayCanvas 这两个纯中间产物在用完即置 0)。这是内存优化,非正确性。

```ts
const dataUrl = canvas.toDataURL('image/png')
maskCanvas.width = maskCanvas.height = 0
overlayCanvas.width = overlayCanvas.height = 0
canvas.width = canvas.height = 0
return dataUrl
```
> 可行性:可行且低风险。toDataURL 同步完成,置零在其后不影响输出。DetailModal(:143)是唯一调用点,拿到的是字符串 dataURL,与 canvas 生命周期无关。

### 测试策略

复用现有 vitest 范式(api.test.ts 的 fetch mock + Response、optimizePromptApi.test.ts 的 makeSseResponse/ReadableStream)。1) M1:在 src/lib/api/api.test.ts 仿照第 12-36 行新增用例,mock fetch 返回 `{ output: [{ type:'image_generation_call', result: { b64_json:'aW1hZ2U=' } }] }`(及 result.image / result.data 变体)与裸 string,断言 callImageApi 返回 images 长度为 1 且不抛错;并保留一例真正空 result 仍抛'未返回可用图片'。可另建 imageApiShared.test.ts 直测 extractResponsesImageBase64 各分支(string/对象优先级/全空→null)。2) H2/toPngBlob:新建 canvasImage 相关单测较重(依赖 canvas/Image),优先对 toPngBlob 的『已是 png 直接返回』分支做单测(传入 type='image/png' 的 Blob 断言同引用返回);非 png 转换分支因 jsdom 无真实 canvas 编码,标注需运行时/跨浏览器手验(Chrome/Firefox/Safari 右键复制 jpeg/webp 图到剪贴板)。3) useStreamingText:新建 src/hooks/useStreamingText.test.ts(或用 @testing-library/react renderHook,确认项目是否已装;若未装则改为对两个 Modal 做行为测试)——核心断言:start 后旧 run 的迟到 onDelta 不污染新 text(手动构造两个可控 promise,先 start A、再 start B,A 的 onDelta 在 B 之后触发,断言 text 只含 B 的内容)。4) captionImageApi:仿 optimizePromptApi.test.ts 新增『response.ok 但体为 JSON error』用例,断言抛出 error.message 而非'反推结果为空'。5) getDataUrlEncodedByteSize→decoded:若有针对 payload 上限的现有测试则更新期望;否则对 callResponsesImageApiSingle 超限路径补一例。运行 `npm run test` 全量 + `npm run typecheck`(或 tsc --noEmit)确保 206 用例不回归且类型干净。

### 回归风险

1) extractResponsesImageBase64 字段优先级若与某些第三方网关实际返回不符(例如同时给 image 和 data 且语义不同)可能取错字段;以 b64_json→image→data 顺序为最常见约定,风险低但需运行时对接真实网关验证。2) copyBlobToClipboard 改为先转 png:对超大图增加一次 canvas 编解码耗时与内存峰值;且 toPngBlob 失败(canvas 不支持/跨域 tainted)会从'静默写坏键'变为'抛错',但调用点均有 toast 兜底,属可接受的行为变化。注意 createImageBitmap/Image 对 SVG 或动图(gif/apng)会丢动画——但本应用图源均为生成的位图,影响可忽略。3) useStreamingText 重构触及两个 Modal 的全部 state 引用(optimized/caption→text),漏改一处 JSX 会编译报错(TS 会拦),回归风险集中在渲染分支与 disabled 条件;React StrictMode 下 effect 双调用 + runId 守卫需确认不会把首个合法 run 误判作废。4) getDataUrlEncodedByteSize 替换为 decoded 会显著降低 responses 路径的计量值(base64 字符数→约 0.56x 字节),原本临界超限的请求现在可能放行——这是修正口径的预期结果,但若有测试硬编码旧期望需同步更新。5) captionImageApi 的 JSON-error 探测若设计过宽,可能把合法但碰巧可 JSON.parse 的 SSE 内容误判;务必限定在『无任何 delta 时』才尝试。6) createMaskPreviewDataUrl 置零 canvas 若未来有人改成异步返回 canvas 引用会失效——目前返回字符串,安全。

---

## WP7 · 可访问性 + 弹窗外壳统一

**工作量** `L` · **依赖** none(本 WP 自带 useLockBodyScroll/useFocusTrap/ModalShell 三个新抽象,内部自洽)。若存在并行修改同一批弹窗或 TaskGrid/TaskCard 的工作包(如流式竞态 WP 触碰 PromptOptimizerModal/ImageCaptionModal、或 dnd 相关 WP),需协调合并顺序以免冲突;但无硬性前置依赖。

### 总体思路

读完真实代码后确认:7 个弹窗(SettingsModal/SizePickerModal/PromptOptimizerModal/ImageCaptionModal/DetailModal/Lightbox/ConfirmDialog)各自手写同一套外壳结构 `fixed inset-0 z-[XX] flex items-center justify-center p-4` + 遮罩 `absolute inset-0 ... animate-overlay-in` + 面板 `relative z-10 ... animate-modal-in`,但都缺 body 滚动锁与焦点处理;`useCloseOnEscape(enabled,onClose)` 已是全局 ESC 栈范式,只有 SizePickerModal 未接;`Select.tsx` 触发器/选项是纯 div+onClick 无 role/tabIndex/键盘;`TaskGrid` sensors 仅 PointerSensor;`TaskCard` 拖拽手柄读取 `dragHandle.ref/.attributes/.listeners` 触发 react-hooks/refs 警告(已降为 warn);index.css 的 toast-enter/modal-in/confirm-in/slide-down-in/zoom-in/dropdown 动画未纳入 prefers-reduced-motion。

策略分三层,先建抽象再改调用点:(1) 新建两个最小共享 hook —— useLockBodyScroll(计数器引用,跨多弹窗叠加安全) 与 useFocusTrap(挂载时记录 activeElement、聚焦容器首个可聚焦元素、Tab 环绕、卸载时还原焦点);(2) 把这两个 hook + 既有 useCloseOnEscape 收敛进一个 ModalShell 外壳组件,统一遮罩/面板/z-index/ESC/scroll-lock/focus,逐个迁移 7 个弹窗;(3) 修 Select 的键盘可用性(role=listbox/option + 方向键/Enter/Esc/Home/End + roving focus)、给 TaskGrid 接 KeyboardSensor+sortableKeyboardCoordinates、给 useCloseOnEscape 的 preventDefault 加 isComposing/输入框守卫、把位移类动画补进 prefers-reduced-motion、并消除 TaskCard 拖拽手柄的 ref-in-render 警告。沿用项目既有范式(useCloseOnEscape 的 enabled 开关式签名、useIsMobile 的轻量 hook 写法、CSS 既有 @media reduce 块)。注意:本项目测试为纯 vitest(node 环境,无 jsdom/testing-library/renderHook),组件与 DOM 行为无法用现有测试栈覆盖,只能为可纯逻辑化的部分写单测,其余靠手动+键盘+跨浏览器验证。

### 共享抽象

- **useLockBodyScroll** — `src/hooks/useLockBodyScroll.ts`
  ```ts
  export function useLockBodyScroll(active: boolean): void
  ```
  M8 修复。模块级计数器 lockCount,active 为真时 ++,为假/卸载时 --;由 0→1 时记录并写入 document.body.style.overflow='hidden'(同时补 paddingRight 抵消滚动条宽度,避免布局抖动,与 :root scrollbar-gutter:stable 协同),由 1→0 时还原原值。计数器保证多个弹窗叠加打开/关闭顺序错乱时不提前解锁。签名沿用 useCloseOnEscape 的 enabled 开关式范式。
- **useFocusTrap** — `src/hooks/useFocusTrap.ts`
  ```ts
  export function useFocusTrap(active: boolean, containerRef: React.RefObject<HTMLElement | null>): void
  ```
  主题6/可访问性。active 变真时:保存 document.activeElement 为 previouslyFocused;聚焦容器内首个可聚焦元素(无则聚焦容器本身,容器需 tabIndex=-1);监听容器 keydown 的 Tab/Shift+Tab 实现首尾环绕。active 变假/卸载:还原 previouslyFocused.focus()。可聚焦选择器复用常量 FOCUSABLE_SELECTOR。
- **ModalShell** — `src/components/ModalShell.tsx`
  ```ts
  export default function ModalShell({ open, onClose, zClass = 'z-[70]', overlayClassName, panelClassName, panelProps, labelledBy, children }: ModalShellProps): JSX.Element | null
  ```
  主题6 弹窗行为统一 + M8。统一渲染外壳:外层 `fixed inset-0 <zClass> flex items-center justify-center p-4` data-no-drag-select;遮罩 `absolute inset-0 ... animate-overlay-in` onClick=onClose;面板容器 `relative z-10 ... animate-modal-in` role=dialog aria-modal=true aria-labelledby={labelledBy} tabIndex=-1 onClick=stopPropagation。内部统一调用 useCloseOnEscape(open,onClose)、useLockBodyScroll(open)、useFocusTrap(open, panelRef)。open 为 false 返回 null。把现有各弹窗重复的遮罩/面板类名与三类副作用收敛到一处;各弹窗只传 panelClassName 保留各自宽度/圆角/滚动样式。
- **FOCUSABLE_SELECTOR** — `src/hooks/useFocusTrap.ts`
  ```ts
  const FOCUSABLE_SELECTOR = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
  ```
  useFocusTrap 与潜在的 Select 复用的可聚焦元素选择器,集中一处避免重复。

### 步骤

#### 1. M8 — 所有弹窗无 body 滚动锁 — `src/hooks/useLockBodyScroll.ts` @ 新文件

**改动**:新建计数器式 scroll-lock hook。模块级 let lockCount=0 与保存的原始 overflow/paddingRight。useEffect 依赖 [active]:active 为真则 acquire(),清理函数 release()。acquire:lockCount===0 时记录 body.style.overflow 原值并设 'hidden'、按 window.innerWidth-document.documentElement.clientWidth 计算滚动条宽度补到 paddingRight;之后 lockCount++。release:lockCount-- ,降到 0 时还原。

```ts
let lockCount = 0
let prevOverflow = ''
let prevPaddingRight = ''
export function useLockBodyScroll(active: boolean) {
  useEffect(() => {
    if (!active) return
    if (lockCount === 0) {
      prevOverflow = document.body.style.overflow
      prevPaddingRight = document.body.style.paddingRight
      const sbw = window.innerWidth - document.documentElement.clientWidth
      document.body.style.overflow = 'hidden'
      if (sbw > 0) document.body.style.paddingRight = `${sbw}px`
    }
    lockCount++
    return () => {
      lockCount--
      if (lockCount === 0) {
        document.body.style.overflow = prevOverflow
        document.body.style.paddingRight = prevPaddingRight
      }
    }
  }, [active])
}
```
> 可行性:可行。注意 :root 已有 scrollbar-gutter:stable 且 html{overflow-y:scroll},桌面端滚动条常驻,补 paddingRight 仍需保留以防个别浏览器/移动端 overlay 滚动条差异;若担心与 scrollbar-gutter 叠加产生 8px 偏移,可改为只设 overflow:hidden 不补 padding(因 scrollbar-gutter:stable 已预留位置)。建议默认只设 overflow:hidden,先在真机/多浏览器观察是否抖动再决定是否补 padding,避免过度修补。

#### 2. 主题6/可访问性 — 弹窗无焦点管理 — `src/hooks/useFocusTrap.ts` @ 新文件

**改动**:新建焦点陷阱 hook + FOCUSABLE_SELECTOR 常量。active 变真:保存 previouslyFocused=document.activeElement;rAF/微任务后聚焦容器内首个可聚焦元素或容器自身。容器 keydown 捕获 Tab 实现首尾环绕。卸载/active 变假:previouslyFocused?.focus()。

```ts
export function useFocusTrap(active: boolean, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return
    const node = ref.current
    const prev = document.activeElement as HTMLElement | null
    const focusables = () => Array.from(node?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []).filter(el => el.offsetParent !== null)
    const first = focusables()[0]
    ;(first ?? node)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const list = focusables(); if (!list.length) return
      const a = list[0], b = list[list.length-1]
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus() }
      else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus() }
    }
    node?.addEventListener('keydown', onKey)
    return () => { node?.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [active, ref])
}
```
> 可行性:可行。容器需 tabIndex=-1 才能在无可聚焦子元素时承接焦点(ModalShell 面板会带上)。ESC 关闭已由 useCloseOnEscape 全局栈处理,不在此 hook 重复监听,避免与既有范式冲突。

#### 3. 主题6 — 弹窗外壳/行为不统一 + M8 接线点 — `src/components/ModalShell.tsx` @ 新文件

**改动**:新建统一外壳组件,聚合 useCloseOnEscape/useLockBodyScroll/useFocusTrap 三个副作用与重复的遮罩/面板 DOM。props:open、onClose、zClass、overlayClassName?、panelClassName、panelProps?(透传如 ref/aria)、labelledBy?、children。面板 role=dialog aria-modal=true tabIndex=-1。

```ts
interface ModalShellProps { open: boolean; onClose: () => void; zClass?: string; overlayClassName?: string; panelClassName: string; labelledBy?: string; children: React.ReactNode }
export default function ModalShell({ open, onClose, zClass='z-[70]', overlayClassName='absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in', panelClassName, labelledBy, children }: ModalShellProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  useCloseOnEscape(open, onClose)
  useLockBodyScroll(open)
  useFocusTrap(open, panelRef)
  if (!open) return null
  return (
    <div data-no-drag-select className={`fixed inset-0 ${zClass} flex items-center justify-center p-4`}>
      <div className={overlayClassName} onClick={onClose} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} className={`relative z-10 ${panelClassName}`} onClick={(e)=>e.stopPropagation()}>
        {children}
      </div>
    </div>
  )}
```
> 可行性:可行但需注意迁移成本:各弹窗当前 z-index 不同(SettingsModal/SizePicker z-[70]、Optimizer/Caption z-[80]、Confirm z-[110]、Lightbox/Detail 另有结构),迁移时逐个传对应 zClass。SizePickerModal 当前把 onClick=onClose 放在最外层 wrapper 并对面板 stopPropagation,语义与 ModalShell(遮罩上 onClose)等价,可平移。ConfirmDialog 面板用 animate-confirm-in 而非 modal-in、遮罩透明度不同,且其 onClose 有 canConfirm 守卫——ConfirmDialog 与 Lightbox 结构差异较大,建议本 WP 先迁移结构最规整的 4 个(SettingsModal/SizePicker/Optimizer/Caption),Confirm/Detail/Lightbox 作为后续增量(降低回归面)。

#### 4. low — SizePickerModal 未接 useCloseOnEscape — `src/components/SizePickerModal.tsx` @ export default function SizePickerModal(45) 的 return(143) 外壳

**改动**:用 ModalShell 替换手写外壳:外层 wrapper(144)、遮罩(145)、面板(146-149) 改为 <ModalShell open onClose={onClose} zClass="z-[70]" panelClassName="w-full max-w-md rounded-3xl border ... animate-modal-in ..." labelledBy="size-picker-title">,标题 h3(152) 加 id="size-picker-title"。此处一并获得 ESC 关闭(补 M8 滚动锁与焦点)。SizePickerModal 由父组件条件渲染({showSizePicker && <SizePickerModal/>},InputBar:305),始终挂载即 open,故 open 传 true。

```ts
return (
  <ModalShell open onClose={onClose} zClass="z-[70]" panelClassName="w-full max-w-md rounded-3xl border border-white/50 bg-white/95 p-5 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10" labelledBy="size-picker-title">
    <div className="mb-5 flex items-start justify-between gap-4">
      <h3 id="size-picker-title" ...>设置图像尺寸</h3>
      ...
    </div>
    ...原 children...
  </ModalShell>
)
```
> 可行性:可行。SizePickerModal 是父级条件渲染(InputBar 305: showSizePicker &&),组件内部没有自己的 open 状态,因此 ModalShell 的 open 恒传 true、卸载即关闭——useCloseOnEscape/useLockBodyScroll/useFocusTrap 的 cleanup 会在卸载时触发,行为正确。若不想引入 ModalShell 也可仅最小修复:在组件体加一行 useCloseOnEscape(true, onClose) —— 但那样无法补 M8 滚动锁,建议走 ModalShell。

#### 5. low — useCloseOnEscape 无条件 preventDefault 干扰 IME — `src/hooks/useCloseOnEscape.ts` @ globalKeyDown(10-16)

**改动**:在 globalKeyDown 中,调用 handler 前增加 IME/输入态守卫:若 e.isComposing 或 (e as any).keyCode===229(部分输入法 compositionend 前的 keyCode)直接 return,不 preventDefault 不关闭;可选再判断焦点是否在 input/textarea/contenteditable 上时仍允许 ESC 关闭(输入法场景靠 isComposing 已足够,无需因普通输入框而禁用 ESC)。preventDefault 移到确实要关闭时才调用。

```ts
function globalKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (e.isComposing || e.keyCode === 229) return // IME 组字中,留给输入法吞掉
  if (escStack.length === 0) return
  e.preventDefault()
  escStack[escStack.length - 1].handler()
}
```
> 可行性:可行且低风险。仅在组字过程中放行 ESC 给输入法,不影响正常关闭。注意 e.keyCode 已废弃但作为对 isComposing 不可靠浏览器的兜底保留;TypeScript 下 keyCode 仍在 KeyboardEvent 类型上,无需 any。

#### 6. M10 — Select.tsx 纯 div+onClick 无 role 无键盘 — `src/components/Select.tsx` @ Select(16);触发器 div(50-66);下拉容器 div(69-73);选项 div(74-89)

**改动**:赋予触发器与选项 ARIA 与键盘:触发器 div 改为 role="combobox"(或 button 语义)aria-haspopup="listbox" aria-expanded={isOpen} aria-disabled={disabled} tabIndex={disabled?-1:0},新增 onKeyDown:Enter/Space/ArrowDown 打开并聚焦当前/首项,ArrowUp 打开聚焦末项,Esc 关闭。下拉容器加 role="listbox";每个选项 div 加 role="option" aria-selected={option.value===value} tabIndex={-1} 并由 roving focus 控制。新增 activeIndex 状态 + 选项 ref 列表;onKeyDown 在打开态处理 ArrowDown/Up 移动 activeIndex、Home/End、Enter 选中、Esc 关闭并把焦点还给触发器。点击外部关闭逻辑(24-32)保留。

```ts
const [activeIndex, setActiveIndex] = useState(-1)
const optionRefs = useRef<(HTMLDivElement|null)[]>([])
const onTriggerKeyDown = (e: React.KeyboardEvent) => {
  if (disabled) return
  if (e.key==='Enter'||e.key===' '||e.key==='ArrowDown'){ e.preventDefault(); openMenu(Math.max(0, options.findIndex(o=>o.value===value))) }
  else if (e.key==='ArrowUp'){ e.preventDefault(); openMenu(options.length-1) }
}
const onListKeyDown = (e: React.KeyboardEvent) => {
  if (e.key==='ArrowDown'){ e.preventDefault(); move(1) }
  else if (e.key==='ArrowUp'){ e.preventDefault(); move(-1) }
  else if (e.key==='Home'){ e.preventDefault(); setActiveIndex(0) }
  else if (e.key==='End'){ e.preventDefault(); setActiveIndex(options.length-1) }
  else if (e.key==='Enter'||e.key===' '){ e.preventDefault(); commit(activeIndex) }
  else if (e.key==='Escape'){ e.preventDefault(); setIsOpen(false); triggerRef.current?.focus() }
}
// 触发器: role="combobox" aria-haspopup="listbox" aria-expanded={isOpen} aria-controls="..." tabIndex={disabled?-1:0} onKeyDown={onTriggerKeyDown}
// listbox: role="listbox" onKeyDown={onListKeyDown}; 选项: role="option" aria-selected ref 收集 + useEffect 聚焦 active 项
```
> 可行性:可行。需用 useEffect 在 activeIndex/isOpen 变化时 optionRefs.current[activeIndex]?.focus() 实现 roving focus;并把现有 handleToggle 拆出 openMenu(index) 复用其 openUp 计算(38-46)。注意 triggerRef 当前是 HTMLDivElement,focus() 需要给触发器 div 也加 tabIndex 才可 focus,已含在改动内。value/onChange 的 any 类型(10:21)是既有 warn,不在本 WP 强制治理。

#### 7. M9 — TaskGrid 缺 KeyboardSensor + sortableKeyboardCoordinates — `src/components/TaskGrid.tsx` @ imports(2-15);useSensors(138-140)

**改动**:从 @dnd-kit/core 增补导入 KeyboardSensor,从 @dnd-kit/sortable 增补 sortableKeyboardCoordinates;在 useSensors 中追加 useSensor(KeyboardSensor,{coordinateGetter:sortableKeyboardCoordinates})。这样拖拽手柄获得焦点后可用空格拾起、方向键移动、空格放下、Esc 取消。

```ts
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
)
```
> 可行性:可行,两个导出已在依赖中确认存在(@dnd-kit/core 6.3.1 KeyboardSensor、@dnd-kit/sortable 10 sortableKeyboardCoordinates)。拖拽手柄已是真正的 <button>(TaskCard:257)且带 attributes(含 role/tabIndex/aria 由 dnd 注入),键盘拾取即可工作。dragDisabled 时 attributes/listeners 未展开(TaskCard:260-261),键盘拖拽自然被禁用,符合预期。

#### 8. lint — TaskCard.tsx:256-268 render 期访问 ref(dragHandle) — `src/components/TaskCard.tsx` @ 拖拽手柄 <button>(256-283)

**改动**:消除 react-hooks/refs 警告:警告源于 render 期读取 dragHandle.ref/.attributes/.listeners(规则把它们当作 ref 访问)。最小且不改行为的做法——保持 ref={dragHandle.ref} 不变(setActivatorNodeRef 本就是 ref 回调,合法),对 attributes/listeners 的条件展开改为先在渲染前解构成普通常量再使用,降低规则误报;若仍告警,则用单行 eslint-disable-next-line react-hooks/refs 注释豁免并写明理由(dnd-kit 的 activator ref/listeners 设计上必须在 render 期绑定到 DOM)。不改变拖拽语义。

```ts
const handleAttrs = dragHandle && !dragHandle.disabled ? dragHandle.attributes : undefined
const handleListeners = dragHandle && !dragHandle.disabled ? dragHandle.listeners : undefined
// <button ref={dragHandle.ref} {...handleAttrs} {...handleListeners} ...>
// 若规则仍命中 dragHandle.ref:
// eslint-disable-next-line react-hooks/refs -- dnd-kit activator ref 必须在 render 期绑定

```
> 可行性:重要:这是 warning 不是 error(eslint.config.js 已将 react-hooks/refs 降为 warn,见注释「render 期写 ref 等大量命中…降为 warn」),不阻断 lint/CI。dragHandle.ref 是 dnd-kit 的 setActivatorNodeRef,设计上就必须在渲染时绑定到 button,无法移到 effect。务实方案是解构常量减少误报点 + 必要时定向 disable 注释;不要为消除一个 warn 而把可访问的 <button> 改回 div(会回退 M9 键盘可用性)。可与 PM 确认是否值得改,否则保持现状亦可接受。

#### 9. low a11y — index.css 位移动画未纳入 prefers-reduced-motion — `src/index.css` @ 末尾新增 @media (prefers-reduced-motion: reduce) 块(或扩展 269-276 现有块)

**改动**:新增一个 @media (prefers-reduced-motion: reduce) 规则,覆盖所有含位移/缩放的动画类:.toast-enter、.animate-overlay-in、.animate-modal-in、.animate-slide-down-in、.animate-zoom-in、.animate-confirm-in、.animate-fade-in、.animate-dropdown-down、.animate-dropdown-up,统一设 animation:none(纯 opacity 的可保留或一并置 none,以一致为先)。沿用文件中已有的 reduce 块写法。

```ts
@media (prefers-reduced-motion: reduce) {
  .toast-enter,
  .animate-overlay-in,
  .animate-modal-in,
  .animate-slide-down-in,
  .animate-zoom-in,
  .animate-confirm-in,
  .animate-fade-in,
  .animate-dropdown-down,
  .animate-dropdown-up {
    animation: none;
  }
}
```
> 可行性:可行,纯 CSS、零 JS 风险,契合记忆中『纯 CSS 无动画库 + 尊重 prefers-reduced-motion』取向。注意 dropdown 用了 transform-origin+scaleY,置 animation:none 后直接显示终态,无副作用。

### 测试策略

现实约束:本项目测试是纯 vitest(node 环境,无 jsdom/@testing-library/renderHook,24 个 .test.ts 全为纯逻辑,ErrorBoundary.test.ts 也只测导出的纯函数 computeRetryState/hashString)。因此:
1) 可纯逻辑化的部分写单测(复用现有 describe/it/expect 风格,放同目录 *.test.ts):为 useFocusTrap 抽出的纯函数(如可见可聚焦元素过滤、Tab 环绕的目标计算 nextFocusTarget(list, current, shift))写单测;为 Select 的键盘导航抽出纯 reducer 式函数(如 nextActiveIndex(current, key, length))写单测;为 useLockBodyScroll 的计数逻辑可抽 acquire/release 计数纯函数测「叠加打开 N 次仅最后一次 release 才还原」。
2) useCloseOnEscape 的 IME 守卫:抽出 shouldHandleEscape(e) 纯判定(key==='Escape' && !isComposing && keyCode!==229)写单测,覆盖组字态不关闭、正常态关闭。
3) 无法用现有栈覆盖的(ModalShell 焦点陷阱实际聚焦、scroll-lock 真实改 body.style、Select 真实方向键 DOM 行为、dnd 键盘拖拽、prefers-reduced-motion 媒体查询)——靠手动验证清单 + 键盘 only 操作 + 屏幕阅读器抽查 + 跨浏览器(Chrome/Firefox/Safari/移动 Safari)走查:打开每个弹窗确认背景不滚动、ESC 关闭、Tab 不逸出、关闭后焦点回到触发元素;Select 用键盘全程操作;拖拽手柄聚焦后空格+方向键重排;系统开启「减弱动态效果」后弹窗/吐司无位移。
4) 引入 @testing-library/react + jsdom 做组件级测试属于测试基建扩张,超出本 WP 范围,如要做应单列工作包并先评审。运行 npm run test 确保新单测通过、npm run lint 确认 react-hooks/refs 警告数下降且无新 error、tsc -b 类型干净。

### 回归风险

1) scroll-lock 与 :root 的 scrollbar-gutter:stable + html{overflow-y:scroll} 叠加:若同时设 overflow:hidden 又补 paddingRight,桌面端可能出现 8px 横向跳动——建议默认只设 overflow:hidden(gutter 已预留位),真机观察后再决定是否补 padding。2) ModalShell 迁移会改动 7 个弹窗的外壳 DOM 层级,onClick 关闭语义需逐个核对:SizePicker 原本 onClose 在最外层 wrapper、其余在遮罩子元素,ConfirmDialog 的 onClose 带 canConfirm 守卫且用 animate-confirm-in/不同遮罩透明度,Lightbox/DetailModal 结构差异大且含缩放/翻页交互——故建议本 WP 只迁规整的 4 个(Settings/SizePicker/Optimizer/Caption),Confirm/Detail/Lightbox 留增量,避免一次性大回归。3) useFocusTrap 自动聚焦首个可聚焦元素可能改变现有「打开即聚焦某输入」的体感(如 SettingsModal),需确认首个可聚焦元素合理(否则给目标元素加 autoFocus 或让 trap 跳过)。4) Select 改 ARIA/键盘后,既有鼠标点击、点击外部关闭(24-32)、openUp 定位(38-46)必须保持;triggerRef 由 div 变可聚焦(tabIndex=0)可能影响 Tab 顺序,需走查。5) TaskCard 拖拽手柄的 ref-in-render 仅是 warn,强行消除有把可访问 button 改回 div 的诱惑——绝不可,会回退 M9。6) useCloseOnEscape 加 IME 守卫极低风险,但 keyCode 已废弃,仅作兜底。7) prefers-reduced-motion 纯 CSS 改动风险最低。整体兼容性:无新增运行时依赖,KeyboardSensor/sortableKeyboardCoordinates 来自已装依赖。

---

## WP8 · 性能 + 杂项正确性(渲染/重算收敛、gap 排序浮点坍缩、toast 文本判等、零散 correctness/info)

**工作量** `L` · **依赖** none(自包含)。需注意与其它 WP 的潜在重叠:① toast id / Toast key / reduced-motion 若被「动画/主题」WP 同时认领需协调单一改动方;② ui.ts:86-91 在审查中被主题10 与动画视角重复列出,本 WP 统一处理;③ TaskCard touch-action 与 swipe 若另有「移动端交互」WP 需对齐。建议本 WP 作为这些条目的唯一落地点,避免重复修补。

### 总体思路

读完真实代码后,WP8 拆成三条主线 + 一组零散修复。

(1) 排序稳定性(主题10 核心):filterAndSortTasks 的排序键混用 sortOrder 与 createdAt 量级,且无 tiebreaker;reorderTask 用中点 `(prev+next)/2`、首尾仅 ±1,反复同隙插入会坍缩。我不引入完整 fractional-indexing 库(过重,且会改动持久化数据形态),而是采取「最小侵入 + 自愈」:① 抽出 `compareTaskOrder(a,b)` 比较器,把 sortOrder 缺省回退 createdAt、并加 id 作 tiebreaker,消除相等键抖动;② reorderTask 首尾改用相对邻居的大步长(STEP=1<<16 量级),中点插入前检测精度逼近(|prev-next| < EPSILON)则触发对当前可见序列的一次性整数重排 renumber 并批量持久化。两处共用同一 sort key helper,避免 TaskGrid / taskFilters / reorder 三处口径漂移。

(2) Toast 生命周期(主题10):showToast 自动关闭按 message 文本判等,并发同文案会被上一个计时器误清;Toast.tsx 无 React key 导致同/异文案后到时不重挂载、toast-enter 不重放。修复用自增 toastSeq:toast 对象加 id,setTimeout 闭包比对 id;Toast.tsx 用 toast.id 作 key 重放入场动画。顺带补 index.css 的 prefers-reduced-motion 对 toast-enter 兜底(已有 app-enter/card-enter 范式)。

(3) 渲染/重算收敛(性能):TaskGrid 的 SortableTaskCard/TaskCard 未 memo + map 内每卡新建闭包,框选时 setSelectedTaskIds 全网格重渲染。修复:TaskCard 与 SortableTaskCard 包 React.memo;把 onReuse/onEditOutputs/onDelete/handleDelete/conversationTag.onClick 用 useCallback + 以 taskId 为参数的稳定分发(dispatch by id),onClick 同样下沉为稳定回调;conversationById 已 memo 可保留。SettingsModal isDirty 把双次 JSON.stringify 折叠为一次 buildFlushedDraft()+一次比较,用 useMemo 缓存 settings 串。ViewportTooltip 去掉 children 依赖(已有 ResizeObserver 思路可选,但最小改为去依赖 + 保留 resize 监听)。ModelListDropdown 无虚拟化属真实但低收益(列表来自用户 API,通常 < 200 项),按 info 处理:加 maxHeight 已有,补一个软上限渲染说明,不引虚拟化库。

(4) 零散 correctness/info:relativeTime 未来时间钳为「刚刚」或对齐符号;ConversationItem Enter+blur 二次提交用 committedRef 守卫;ImageGrid maskConflictNoticeShownRef 随 maskTargetImage 消失复位;useDragDropFiles 加 window dragend/blur 兜底归零 + dragenter 仅在 Files 时计数 + paste 检查 activeElement;TaskCard outputImages 清空时复位 thumbSrc + 容器 touch-action: pan-y。

原则:先抽共享 helper(compareTaskOrder / 排序键),再改三处调用点;Toast id 贯穿 store+组件;其余为局部守卫。所有改动不触碰持久化 schema(sortOrder 仍是 number,renumber 只是覆写既有字段)。

### 共享抽象

- **compareTaskOrder / getTaskSortKey 复用** — `src/lib/taskRuntime.ts`
  ```ts
  export function getTaskSortKey(task: TaskRecord): number  // 已存在,保留；新增 export function compareTaskOrder(a: TaskRecord, b: TaskRecord): number
  ```
  统一降序比较:先比 getTaskSortKey(b)-getTaskSortKey(a),相等时用 createdAt 再相等用 id 作 tiebreaker,消除浮点坍缩后的排序抖动。taskFilters.ts 的内联 sort 改为调用它,reorder 的 renumber 也用它产出有序序列,三处口径单一来源。
- **SORT_STEP / SORT_EPSILON 常量 + renumberTaskSortOrders** — `src/lib/taskRuntime.ts`
  ```ts
  const SORT_STEP = 65536; const SORT_EPSILON = 1e-6; function renumberVisibleTasks(orderedIds: string[]): TaskRecord[]
  ```
  reorder 时若 |prev-next| < SORT_EPSILON,对当前可见(已排序)序列按 index*SORT_STEP 整数重排,批量 putTask 持久化,自愈精度耗尽。首尾插入用 ±SORT_STEP 大步长替代 ±1。
- **toast id 序列** — `src/store/slices/ui.ts`
  ```ts
  toast: { id: number; message: string; type: 'info'|'success'|'error' } | null; let toastSeq = 0 (模块级)
  ```
  showToast 生成自增 id 写入 toast,setTimeout 闭包比对 get().toast?.id === id 才清除,解决并发同文案误清;Toast.tsx 用 id 作 React key 重放 toast-enter。
- **InputBar 编辑态判定 util(可选)** — `src/components/InputBar/hooks/useDragDropFiles.ts`
  ```ts
  function isEditableTargetOutsideInputBar(el: Element | null): boolean
  ```
  handlePaste 中判断 activeElement 是否为 InputBar 之外的可编辑元素/modal,是则跳过,避免在设置弹窗/重命名输入框内粘贴图片被塞进底栏。若已有等价 helper 则复用,否则就近内联。
- **稳定 per-task 回调分发(TaskGrid 内)** — `src/components/TaskGrid.tsx`
  ```ts
  const handleCardClick = useCallback((taskId: string, e) => {...}, [deps]); 同理 reuse/editOutputs/delete 以 taskId 为参
  ```
  把 map 内每卡新建的内联闭包替换为以 taskId 为参的稳定 useCallback,配合 React.memo(TaskCard/SortableTaskCard) 让框选时只重渲染选中态变化的卡片。

### 步骤

#### 1. 主题10 · gap 排序浮点坍缩 + 排序无 tiebreaker(taskRuntime.ts:574-603, taskFilters.ts:31-33) — `src/lib/taskRuntime.ts` @ getTaskSortKey (574-576) 下方新增；reorderTask (582-603)

**改动**:新增 compareTaskOrder 比较器与 SORT_STEP/SORT_EPSILON 常量。reorderTask:prev&&next 时若 Math.abs(getTaskSortKey(prev)-getTaskSortKey(next)) < SORT_EPSILON,先对当前可见序列整数化重排(renumber)再插入;仅 prev 用 getTaskSortKey(prev)-SORT_STEP;仅 next 用 getTaskSortKey(next)+SORT_STEP。renumber 批量 putTask + 一次 setTasks。

```ts
export function compareTaskOrder(a: TaskRecord, b: TaskRecord) {
  const ka = getTaskSortKey(a), kb = getTaskSortKey(b)
  if (ka !== kb) return kb - ka
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}
const SORT_STEP = 65536, SORT_EPSILON = 1e-6
// reorderTask 内:
if (prev && next) {
  const gap = Math.abs(getTaskSortKey(prev) - getTaskSortKey(next))
  if (gap < SORT_EPSILON) { renumberThenInsert(taskId, prevTaskId, nextTaskId); return }
  newSortOrder = (getTaskSortKey(prev) + getTaskSortKey(next)) / 2
} else if (prev) { newSortOrder = getTaskSortKey(prev) - SORT_STEP }
else if (next) { newSortOrder = getTaskSortKey(next) + SORT_STEP }
```
> 可行性:审查建议的「fractional indexing 或重排」可行但全量 fractional-indexing 过重且改持久化形态;采用「中点 + 精度逼近时整数重排」更贴合现有 number sortOrder schema。注意 renumber 需对『当前 store 全量 tasks 按 compareTaskOrder 排序后』赋 index*SORT_STEP,但仅写回 sortOrder 变化的任务以减少 IDB 写入;reorder 当前仅在 dragDisabled=false(无筛选/搜索)时触发,故重排作用域是全量 tasks 而非 filteredTasks,口径安全。

#### 2. 主题10 · 排序无 tiebreaker(taskFilters.ts:31-33) — `src/lib/taskFilters.ts` @ const sorted = [...tasks].sort(...) (31-33)

**改动**:把内联 (b.sortOrder ?? b.createdAt) - (a.sortOrder ?? a.createdAt) 替换为调用 compareTaskOrder,统一 tiebreaker,消除 sortOrder 相等时的排序不稳定。

```ts
import { compareTaskOrder } from './taskRuntime'
const sorted = [...tasks].sort(compareTaskOrder)
```
> 可行性:需确认 taskFilters.ts 引入 taskRuntime 不会引入循环依赖:taskRuntime 已 import 'store' 而 taskFilters 仅 import types,反向引用 taskRuntime 安全;若 lint 报循环,则把 compareTaskOrder/getTaskSortKey 抽到独立 src/lib/taskSort.ts 供两者引用(更干净,建议此方案)。

#### 3. 主题10 · toast message 判等(ui.ts:86-91) — `src/store/slices/ui.ts` @ toast 类型定义 (33) 与 showToast (86-91)

**改动**:toast 类型加 id: number;模块级 let toastSeq = 0;showToast 生成 id 写入,setTimeout 闭包按 id 判等清除。

```ts
let toastSeq = 0
// type: toast: { id: number; message: string; type: ... } | null
showToast: (message, type = 'info') => {
  const id = ++toastSeq
  set({ toast: { id, message, type } })
  setTimeout(() => { if (get().toast?.id === id) set({ toast: null }) }, 3000)
}
```
> 可行性:可行。需同步更新 AppState['toast'] 引用处的类型(Toast.tsx 读 toast.message/type 不受影响)。store.test.ts 若断言 toast 形状需补 id 字段——已确认现有测试主要 mock db/api,需 Grep 'toast:' 断言点确认。

#### 4. 主题10(动画视角)· Toast 不重挂载 + reduced-motion(Toast.tsx, index.css:104-110) — `src/components/Toast.tsx` @ 最外层 div.toast-enter (38)

**改动**:外层容器加 key={toast.id} 让同/异文案后到时强制重挂载、重放 toast-enter。

```ts
return (
  <div key={toast.id} className="fixed bottom-24 ... toast-enter">...
```
> 可行性:Toast 是单例渲染(只渲染当前 toast),给根 div 加 key 即可触发 React 卸载旧节点挂新节点,动画重放。无回归。

#### 5. 主题10 · reduced-motion 未覆盖 toast-enter(index.css:231-238) — `src/index.css` @ @media (prefers-reduced-motion: reduce) 块 (231-238)

**改动**:在该 reduced-motion 选择器列表追加 .toast-enter(以及 modal/confirm/zoom 类如存在)置 animation: none,沿用既有兜底范式。

```ts
@media (prefers-reduced-motion: reduce) {
  .app-enter-sidebar, .app-enter-header, .app-enter-main, .app-enter-inputbar,
  .toast-enter { animation: none; }
}
```
> 可行性:审查提到 modal/confirm/zoom 也应纳入,但本 WP 聚焦 toast;modal/confirm 的 reduced-motion 收敛若不在其它 WP 覆盖可一并加,但需先 Grep 确认这些类名真实存在(animate-modal-in/animate-overlay-in 在 SettingsModal 用到),避免写无效选择器。

#### 6. 性能 · TaskCard/SortableTaskCard 未 memo + map 内联闭包(TaskGrid.tsx:42-83,300-346) — `src/components/TaskGrid.tsx` @ SortableTaskCard 定义 (42)、filteredTasks.map (301-346)

**改动**:① SortableTaskCard 用 React.memo 包裹(props 已是基本类型 + 稳定回调)。② 把 onReuse/onEditOutputs/onDelete/onClick 改为以 taskId 为参的 useCallback 稳定分发,map 内传 task.id 而非新建闭包;conversationTag.onClick 同理用稳定 useCallback(convId)。③ TaskCard 文件加 React.memo 导出。

```ts
const SortableTaskCard = React.memo(function SortableTaskCard({...}) {...})
const handleReuse = useCallback((t: TaskRecord) => reuseConfig(t), [])
const handleClick = useCallback((taskId: string, e) => { /* 现 onClick 逻辑,用 useStore.getState() 读 selectedTaskIds 避免闭包过期 */ }, [isMac])
// map: onClick={(e)=>handleClick(task.id, e)} 仍是新闭包 → 改为传 task + 在 TaskCard 内 onClick(e) 透传,或用 useCallbackRef 模式
```
> 可行性:关键约束:onClick 当前依赖 selectedTaskIds/suppressClickUntil。若 useCallback 依赖 selectedTaskIds,每次框选仍变更回调→破坏 memo。替代:handleClick 内改用 useStore.getState().selectedTaskIds 读最新值(项目大量已用此范式,如 beginSelection:166),依赖收窄到 [isMac];isSelected 仍随选中变化传入,但 React.memo 只让选中态真正变化的卡重渲染,达成收敛目标。conversationTag 每次 map 新建对象会破坏 memo——需把 conversationTag 计算也 useMemo 成 Map<taskId, ConversationTag> 或在 memo 比较函数里浅比关键字段。建议:抽 conversationTagById = useMemo(...) 预算好,map 直接取。

#### 7. 性能 · SettingsModal 每渲染两次全量 JSON.stringify(index.tsx:126-129) — `src/components/SettingsModal/index.tsx` @ isDirty useMemo (126-129)

**改动**:settings 串用 useMemo 缓存(仅 settings 变时重算);isDirty 只调用一次 buildFlushedDraft() 并 stringify 一次,与缓存的 settings 串比较。

```ts
const settingsJson = useMemo(() => JSON.stringify(settings), [settings])
const isDirty = useMemo(
  () => JSON.stringify(buildFlushedDraft()) !== settingsJson,
  [buildFlushedDraft, settingsJson],
)
```
> 可行性:buildFlushedDraft 已是 useCallback,依赖稳定。改动把每渲染 2 次 stringify 降为:settings 不变时 1 次(只 stringify draft)。低风险。

#### 8. 性能 · ViewportTooltip children 作 effect 依赖(ViewportTooltip.tsx:13-36) — `src/components/ViewportTooltip.tsx` @ useEffect 依赖数组 (36)

**改动**:从依赖数组移除 children(每次父渲染 children 都是新 ReactNode 引用,导致 effect 反复重订阅 resize)。仅保留 visible;内容变更引起的尺寸变化由已注册的 resize 监听 + 首次 updatePosition 覆盖,或可选改用 ResizeObserver 监听 tooltipRef。

```ts
}, [visible])  // 移除 children
// 若担心内容变化后位置不更新:在 return 的 JSX 外层不变,改 effect 内用 ResizeObserver(el) 替代 window resize 即可同时覆盖内容尺寸变化
```
> 可行性:风险:去掉 children 后,visible 不变但内容文本变化时不会重算 offsetX。实测 tooltip 内容通常 visible 切换时才变;若需稳妥,推荐 ResizeObserver 方案(observe tooltipRef.current),既去掉 children 依赖又覆盖内容尺寸变化,比 window resize 更准。建议采用 ResizeObserver。

#### 9. low · relativeTime 未来时间(relativeTime.ts:34-42) — `src/components/Sidebar/relativeTime.ts` @ formatRelativeTime (34-42)

**改动**:diff = timestamp - now 为正(未来)时,语义上 updatedAt 不应晚于 now;钳制为「刚刚」或对未来值取 Math.min(diff, 0) 后走原逻辑,避免显示「X 分钟后/小时后」。

```ts
export function formatRelativeTime(timestamp, now = Date.now()) {
  const diff = Math.min(0, timestamp - now)  // 未来时间钳为现在
  const abs = Math.abs(diff)
  if (abs < 30 * SECOND) return '刚刚'
  ...
```
> 可行性:现有 test 'returns 刚刚 when within 30 seconds' 已断言 NOW+5_000 → '刚刚',与本修复一致;但 fallback formatter 分支(14-29)对未来值有专门文案,钳制后该分支永不接负值→需确认无测试断言「X 后」。Grep 确认 relativeTime.test.ts 无未来值断言,安全。

#### 10. low · ConversationItem Enter + blur 二次提交(ConversationItem.tsx:81-93,145-153) — `src/components/Sidebar/ConversationItem.tsx` @ commitRename (81-93)、onKeyDown Enter (146-148)、onBlur (144)

**改动**:Enter 处理时先置 committedRef.current=true 再 commitRename;commitRename 内首行守卫 if (committedRef.current 且来自 blur) 跳过,或更简洁:Enter 调用 commitRename 后 input 失焦触发 onBlur,用一次性 ref 防止重复 renameConversation。

```ts
const committingRef = useRef(false)
const commitRename = () => {
  if (committingRef.current) return
  committingRef.current = true
  const trimmed = draftTitle.trim()
  ... setIsRenaming(false)
  // 退出重命名后在下一次进入时复位:startRename 内 committingRef.current = false
}
```
> 可行性:Enter 路径:onKeyDown 调 commitRename → setIsRenaming(false) → input 卸载触发 onBlur 再调 commitRename。守卫 ref 可挡第二次。需在 startRename(74-79)与 cancelRename(95-98)复位 committingRef=false。cancelRename(Escape)走 setIsRenaming(false) 也会触发 onBlur→commitRename,但此时 draftTitle 已恢复为原 title,commitRename 内 trimmed===conversation.title 不会调用 renameConversation,故 Escape 无副作用;但加守卫更稳。renameConversation 本身有 trimmed===title 短路(89),所以二次提交主要是多一次 set/IDB 写,守卫消除之。

#### 11. low · ImageGrid maskConflict 提示 ref 不复位(ImageGrid.tsx:50,222-226) — `src/components/InputBar/ImageGrid.tsx` @ maskConflictNoticeShownRef (50)、handleClickImage (222-226)

**改动**:加 useEffect 监听 maskTargetImage 由有变无(或 id 变化)时复位 maskConflictNoticeShownRef.current = false,使移除遮罩后重新加遮罩再点参考图能再次提示。

```ts
useEffect(() => {
  if (!maskTargetImage) maskConflictNoticeShownRef.current = false
}, [maskTargetImage])
```
> 可行性:maskTargetImage 是 prop(InputImage|null)。当遮罩被移除变 null 时复位即可;也可用 maskTargetImage?.id 作依赖覆盖『换了另一张遮罩』场景。低风险,纯本地 ref。

#### 12. low · useDragDropFiles 拖拽计数失衡 + paste 焦点(useDragDropFiles.ts:13-31,34-67) — `src/components/InputBar/hooks/useDragDropFiles.ts` @ handlePaste (14-28)、drag effect (34-80)

**改动**:① dragenter 仅在 e.dataTransfer?.types.includes('Files') 时自增计数(非文件拖拽不计数),并相应仅在文件拖拽路径 setIsDragging。② 加 window 'dragend' 与 'blur' 监听把 dragCounter 归零 + setIsDragging(false),兜底拖出窗口外释放。③ handlePaste 开头判断 document.activeElement 若是 InputBar 之外的可编辑元素/modal 则 return。

```ts
const handleDragEnter = (e) => { e.preventDefault(); e.stopPropagation();
  if (!e.dataTransfer?.types.includes('Files')) return
  dragCounter.current++; setIsDragging(true) }
const resetDrag = () => { dragCounter.current = 0; setIsDragging(false) }
window.addEventListener('dragend', resetDrag); window.addEventListener('blur', resetDrag)
// paste: if (isEditableTargetOutsideInputBar(document.activeElement)) return
```
> 可行性:dragleave 现按 --counter===0 收起;若 dragenter 改为只在 Files 时计数,则 handleDragLeave 也要对应只在 Files 拖拽时递减,否则非文件 dragleave 会把计数减成负。更稳妥:dragLeave 内 dragCounter.current = Math.max(0, dragCounter.current - 1)。paste 焦点判断:需确认 InputBar 容器有 data-input-bar 标记(TaskGrid:227 已用 [data-input-bar] 选择器,说明存在),用 closest('[data-input-bar]') 判断 activeElement 归属。

#### 13. info · TaskCard thumbSrc 不清空 + touch-action(TaskCard.tsx:136-150,221-246) — `src/components/TaskCard.tsx` @ 加载缩略图 useEffect (136-150)、滑动容器 div (221-246)

**改动**:① 缩略图 effect 在 task.outputImages?.[0] 为空时 setThumbSrc('') 复位,避免任务从 done 退回(如重试覆盖)或输出被清后仍显示旧图。② 滑动容器 div 加 style touch-action: 'pan-y',让横滑被 swipe 接管、纵向仍可滚动(解决 onTouchMove 被动监听 preventDefault 无效告警)。

```ts
useEffect(() => {
  setCoverRatio(''); setCoverSize('')
  const first = task.outputImages?.[0]
  if (!first) { setThumbSrc(''); return }
  const cached = getCachedImage(first)
  if (cached) setThumbSrc(cached)
  else ensureImageCached(first).then(url => { if (url) setThumbSrc(url) })
}, [task.outputImages])
// 容器:style={{ transform: ..., touchAction: 'pan-y' }}
```
> 可行性:touch-action: pan-y 与现有 handleTouchMove 的 e.preventDefault()(81)配合:pan-y 允许垂直滚动、阻止水平,浏览器不会因 passive 告警而忽略;但需确认容器内 onClick/拖拽手柄(已单独 touchAction:none on handle,272)不冲突——手柄是子元素独立设置,安全。thumbSrc 复位:当前 effect 依赖 [task.outputImages],done→其它状态时若 outputImages 变空会复位;若 outputImages 引用不变则不触发,实际重试是新建 task(不同 id)故卡片重挂载,影响面小,属防御性修复。

#### 14. info · ModelListDropdown 无虚拟化(ModelListDropdown.tsx:87-103) — `src/components/SettingsModal/ModelListDropdown.tsx` @ modelList.map 渲染 (88-103)

**改动**:评估后判定为低优先 info:模型列表来自用户配置的单个 API /models 响应,常见量级 < 200 项,已有 max-h-60 + overflow-y-auto。不引虚拟化库(react-window 会增依赖与样式复杂度)。若坚持收敛,可加软上限:超过 N(如 300)项时只渲染前 N 并提示『请用输入框筛选』,但建议本 WP 仅记录、不实施。

```ts
// 维持现状;如需软上限:
// {modelList.slice(0, 300).map(...)}{modelList.length > 300 && <div>列表过长,请手动输入筛选</div>}
```
> 可行性:审查列为 perf,但真实数据规模下虚拟化收益极低、成本(依赖+滚动样式回归)偏高,作为 info 处理更合理。若产品确认存在超大模型列表(如某些聚合网关返回上千),再单列工作包引 @tanstack/react-virtual。

### 测试策略

优先复用现有 vitest 纯函数测试范式(taskFilters.test.ts / relativeTime.test.ts / store.test.ts 已有 mock db/api 的成熟框架)。

1. compareTaskOrder + reorder(新增 src/lib/taskSort.test.ts 或并入既有):
   - 同 sortOrder 时按 createdAt 再按 id 稳定排序(断言 sort 幂等:两次 sort 结果一致)。
   - reorderTask 中点逼近:构造 prev/next sortOrder 差 < SORT_EPSILON,断言触发 renumber(可 spy putTask 调用次数 = 受影响任务数,且 sortOrder 变为 index*SORT_STEP 整数序列)。复用 store.test.ts 的 db mock(putTask: vi.fn)。
   - 首/尾插入断言用 ±SORT_STEP 而非 ±1。
2. taskFilters.test.ts:补一例 sortOrder 相等(浮点坍缩后)仍稳定排序的断言。
3. relativeTime.test.ts:补「未来时间戳(NOW+5min)返回『刚刚』而非『X 分钟后』」。
4. ui/showToast:在 store.test.ts 加用例——连续两次 showToast 同文案,用 vi.useFakeTimers 推进到第一个 3s 计时,断言第二条 toast(更大 id)未被清除(get().toast 仍非 null 且 id 为第二条)。
5. 组件类(TaskCard memo、TaskGrid 回调稳定、ViewportTooltip、ConversationItem 双提交、ImageGrid ref 复位、useDragDropFiles 计数、Toast key):项目目前无 *.test.tsx / RTL 设施(确认 0 个 tsx 测试),不新建组件测试基建;这些改动以类型检查(tsc)+ 手动运行时验证为主:Enter 重命名只触发一次 renameConversation(可临时 console / 或在 store.test 层对 renameConversation 计数,若提取逻辑);拖拽遮罩入场不卡死;移动端横滑不触发页面纵向滚动告警(需真机/模拟器跨浏览器验证)。
6. 回归基线:全量 npm run test(现 206 用例)+ npm run typecheck 必须保持绿;新增用例不低于 +6。

### 回归风险

1. 循环依赖:taskFilters.ts 引用 taskRuntime.ts 的 compareTaskOrder 可能触发 ESLint import/no-cycle 或运行期 TDZ。缓解:把 getTaskSortKey/compareTaskOrder/SORT_STEP 抽到无副作用的 src/lib/taskSort.ts,taskRuntime 与 taskFilters 均从它引入(taskRuntime 现导出的 getTaskSortKey 需保持 re-export 以不破坏外部引用)。
2. renumber 作用域:reorder 仅在无筛选/搜索(dragDisabled=false)时可触发,renumber 必须对 store 全量 tasks 排序后赋值,不能只对 filteredTasks(否则被过滤掉的任务 sortOrder 与可见区错位)。需读 useStore.getState().tasks 全量处理并批量持久化,IDB 写入量在精度坍缩(约 50 次插入后)才发生,频率极低,可接受。
3. TaskGrid memo 化:onClick 改用 useStore.getState() 读 selectedTaskIds 后,逻辑须与原闭包等价(原读 selectedTaskIds.length / .includes),否则框选→点击的多选/详情分支会回归。conversationTag 必须预算成稳定引用,否则 React.memo 失效、改动无收益。需逐分支对照原 325-340 行逻辑。
4. ViewportTooltip 去 children 依赖:若不换 ResizeObserver,内容变化但 visible 不变时位置不重算——可能出现 tooltip 内容变长后越界。推荐 ResizeObserver 方案规避;但 ResizeObserver 在测试 jsdom 环境需 mock,组件无单测则仅运行时验证。
5. Toast 类型加 id:AppState['toast'] 形状变更,凡解构 toast 的地方(Toast.tsx 已审、其它若有)需同步;store.test.ts 若有 toast 形状断言会红,需更新。
6. useDragDropFiles dragenter/leave 计数口径同时改动:若只改一侧会把计数推成负值导致遮罩永不收起或闪烁,必须 enter/leave 成对调整 + Math.max(0,...) 兜底。paste 焦点判断若 InputBar 无 data-input-bar 容器标记则误伤正常粘贴——已确认存在该标记。
7. touch-action: pan-y 跨浏览器(iOS Safari)行为差异:需真机验证横滑选择与纵向滚动并存,不可仅靠桌面 DevTools。
8. relativeTime 钳制未来值会让 fallback formatter 的「X 后」分支变为死代码,功能无碍但可在注释标注。

---

## 附录

- 设计规模:9 个子代理。
- 本路线图由多智能体重读源码后产出,每步都校验了原审查建议在真实代码下的可行性。
- 实施需遵守第四节跨包串行约束,每批后跑 tsc -b + vitest run 守住 206 用例绿。