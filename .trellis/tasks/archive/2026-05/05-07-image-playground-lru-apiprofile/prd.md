# Image Playground 三项优化：LRU 缓存 + 命名通用化 + ApiProfile 判别联合

## Goal

针对项目当前最值得修复的三处技术债做一次性整理：

1. **修内存泄漏隐患**：`imageCache` 启动时全量加载所有图片到内存，1000 张大图可能吃 1+GB
2. **命名通用化**：去掉 `OpenAI*` 前缀的函数/常量，因为它们实际同时处理 openai 和 gemini provider
3. **ApiProfile 判别联合**：用 TS discriminated union 消除散落在 16+ 处的 `provider === 'openai'` 守卫

视觉/功能行为对用户透明，纯代码质量优化。

## What I already know

**LRU 缓存**
- `src/lib/imageCache.ts` 现状：`Map<string, string>` 无上限
- `taskRuntime.ts:140-148` 在 `initStore()` 时遍历 IDB 全部图片并 `setCachedImage` 存入内存
- 用户场景：1000 张 1024x1024 图 → base64 各 ~2MB → ~2GB 内存
- 内存中 dataUrl 在 IDB 已经持久化，evict 后可重新 `ensureImageCached(id)` 加载

**命名失真（同步 HTTP 任务相关）**
- `OPENAI_INTERRUPTED_ERROR = '请求中断'`（变量名有 OPENAI，文案没有）
- `createOpenAITimeoutError(s)`
- `isOpenAITask` / `isRunningOpenAITask`（已经覆盖 openai+gemini，名字误导）
- `markInterruptedOpenAIRunningTasks`（initStore 时重置 gemini 任务也走这）
- `scheduleOpenAIWatchdog` / `clearOpenAIWatchdogTimer` / `failOpenAITaskIfStillRunning`
- `openAIWatchdogTimers: Map`
- `showToast('OpenAI 任务请求超时', 'error')` ← 文案也写死了 OpenAI
- `store.test.ts` 引用 `markInterruptedOpenAIRunningTasks`

**ApiProfile 判别联合**
- 当前 `ApiProfile` 是单 interface，`apiMode` / `codexCli` / `apiProxy` 三个字段对 gemini 无意义
- `provider === 'openai'` 守卫散落 16 处（SettingsModal 9 处、apiProfiles.ts 2 处、其他 5 处）
- 持久化数据：localStorage `image-playground` 里的 `profiles[]`、IndexedDB tasks 的 `apiProvider`
- 旧数据可能仍带 `provider: 'fal'`（normalizeSettings 已经有 filter）

## Open Questions

- [x] ~~LRU 缓存策略~~ → **纯懒加载 + LRU 100 条**
- [x] ~~命名前缀风格~~ → **去掉 OpenAI 前缀，用 SyncHttp 语义**

## Requirements

### LRU 缓存（task #1）
- 去掉 `initStore` 中的全量预加载（仍保留孤儿图片清理逻辑）
- `imageCache` 改为 LRU，按访问顺序排序
- 加容量上限（数值待定）
- 超出时自动 evict 最久未访问项
- `setCachedImage` / `ensureImageCached` 调用时维护访问顺序

### 命名通用化（task #2）
- 重命名以下 6 个标识符 + 1 处 toast 文案
  - `OPENAI_INTERRUPTED_ERROR` → `INTERRUPTED_ERROR`（或 `SYNC_HTTP_INTERRUPTED_ERROR`）
  - `createOpenAITimeoutError` → `createTimeoutError` / `createSyncHttpTimeoutError`
  - `isOpenAITask` → `isSyncHttpTask`
  - `isRunningOpenAITask` → `isRunningSyncHttpTask`
  - `markInterruptedOpenAIRunningTasks` → `markInterruptedRunningTasks`
  - `scheduleOpenAIWatchdog` / `clearOpenAIWatchdogTimer` / `failOpenAITaskIfStillRunning` → 去掉 OpenAI
  - `openAIWatchdogTimers` → `watchdogTimers`
  - `'OpenAI 任务请求超时'` → `'生成任务请求超时'`
- store.test.ts 跟着改
- store.ts 里的 re-export 同步更新

### ApiProfile 判别联合（task #3）
- 改造 `src/types.ts` 中 `ApiProfile`：
  ```ts
  type ApiProfile =
    | { provider: 'openai'; ...common; apiMode: ApiMode; codexCli: boolean; apiProxy: boolean }
    | { provider: 'gemini'; ...common }
  ```
- 更新 `apiProfiles.ts`：
  - `createDefaultOpenAIProfile` / `createDefaultGeminiProfile` 不再带不属于自己的字段
  - `switchApiProfileProvider` 切换时正确剔除/添加字段
  - `normalizeApiProfile` 按 provider 收窄字段
  - `validateApiProfile` 收窄
- 简化 SettingsModal 守卫（让 TS 自动收窄）
- 持久化兼容：normalize 时容忍旧数据多余字段

## Acceptance Criteria

### LRU 缓存
- [x] 容量满时 `setCachedImage` 新图会 evict 最旧的（test：`evicts least-recently-used when over capacity`）
- [x] 已经在缓存中的图被 `getCachedImage` 后会移到 LRU 队尾（test：`promotes accessed key to most-recently-used position`）
- [x] `initStore` 不再无脑预加载（保留孤儿清理 + 输入图缓存）
- [x] 加单测：`lib/imageCache.test.ts` (12 个测试)

### 命名通用化
- [x] `taskRuntime.ts` 中所有 `OpenAI*` 标识符已改为 `SyncHttp*`
- [x] toast 文案改为 `'生成任务请求超时'`（不含 OpenAI）
- [x] `store.test.ts` 同步更新（`markInterruptedSyncHttpTasks`）
- [x] `tsc` 通过

### ApiProfile 判别联合
- [x] `provider === 'openai'` 守卫数量 16 → 12（剩下都是真实 UI 分支或语义分支）
- [x] gemini profile 类型上没有 codexCli/apiMode/apiProxy 字段（TS 编译期保证）
- [x] 现有 `apiProfiles.test.ts` 全部通过
- [x] 旧 localStorage 数据（带多余字段）正常加载（normalize 时按 provider 选择 builder，多余字段被忽略）

### 全局
- [x] `npm test`：54 passed (新增 11 个 LRU 测试，原 43 全过)
- [x] `npm run build`：通过（452KB → 137KB gz）
- [x] `npx tsc --noEmit`：通过

## Definition of Done

- 三个子任务的 AC 全部满足
- 现有 43 个测试不退化
- 视觉行为对用户无变化（设置面板、生成、任务列表、详情、导出导入）
- store.ts 公开导出兼容（其他文件 import 路径不变）

## Out of Scope

- AppSettings 顶层扁平字段去重（P2 #9，跟判别联合相关但是单独工程）
- removeMultipleTasks/removeTask 提取 helper（P2 #11）
- 串行 await → Promise.all（P1 #4，跟 LRU 不冲突但分开做）
- SHA-256 移到 worker（P1 #6）
- HMR 清理（P1 #7）
- UI 组件拆分（InputBar 858 行、MaskEditorModal 1030 行）
- 抽 `<TextField>` / `<Select>` 等基础组件
- 组件级集成测试

## Technical Approach

**实施顺序**：LRU → 命名 → 判别联合（独立性递减，每完成一项跑一次 tsc + test）

### LRU 实现思路
```ts
class LruImageCache {
  #map = new Map<string, string>()  // 利用 Map 的插入序 = 访问序
  constructor(private maxEntries = 100) {}

  get(id) {
    const v = this.#map.get(id)
    if (v !== undefined) {
      this.#map.delete(id)  // 移到末尾
      this.#map.set(id, v)
    }
    return v
  }

  set(id, dataUrl) {
    if (this.#map.has(id)) this.#map.delete(id)
    this.#map.set(id, dataUrl)
    while (this.#map.size > this.maxEntries) {
      const first = this.#map.keys().next().value
      if (first === undefined) break
      this.#map.delete(first)
    }
  }
}
```

### 命名通用化思路
- 一次性 sed 替换 + 手动 review 文案
- 不动 ApiProvider type 本身（'openai'/'gemini' 字面量是协议层面的）

### 判别联合思路
- 用类型谓词 `isOpenAIProfile(p): p is OpenAIProfile`
- normalize 时按 provider 选择 builder，自动剔除不相关字段
- 切换 provider 走 `switchApiProfileProvider`（已存在），改造它使其类型安全

## Decision (ADR-lite)

### LRU 缓存
- **Context**：`initStore` 全量预加载导致内存随历史任务数线性增长，1000 张图可吃 1+GB
- **Decision**：完全去掉预加载（保留孤儿清理），改为懒加载；`imageCache` 升级为 LRU，上限 100 条
- **Consequences**：
  - 优点：启动更快、内存可控（典型场景 < 200MB）
  - 代价：滚动到老卡片时第一次 `ensureImageCached` 多一次 IDB 读取（~10-50ms）
  - 备选未选：按字节数限制（实现复杂度收益比不高）

### 命名通用化
- **Context**：fal 删除后，`isOpenAITask` 等函数实际同时处理 openai+gemini，名字误导
- **Decision**：统一改用 `SyncHttp` 语义（区别于未来可能加入的异步队列型 provider）
  - `isOpenAITask` → `isSyncHttpTask`
  - `isRunningOpenAITask` → `isRunningSyncHttpTask`
  - `markInterruptedOpenAIRunningTasks` → `markInterruptedSyncHttpTasks`
  - `scheduleOpenAIWatchdog` / `clearOpenAIWatchdogTimer` / `failOpenAITaskIfStillRunning` → `scheduleSyncHttpWatchdog` / `clearSyncHttpWatchdogTimer` / `failSyncHttpTaskIfStillRunning`
  - `openAIWatchdogTimers` → `syncHttpWatchdogTimers`
  - `OPENAI_INTERRUPTED_ERROR` → `SYNC_HTTP_INTERRUPTED_ERROR`
  - `createOpenAITimeoutError` → `createSyncHttpTimeoutError`
  - Toast `'OpenAI 任务请求超时'` → `'生成任务请求超时'`
- **Consequences**：
  - store.test.ts、store.ts re-export 同步更新
  - 公开 API 名字变化（仅 `markInterruptedOpenAIRunningTasks` 暴露给 store.test.ts），需要更新该测试

### ApiProfile 判别联合
- **Context**：单 interface 让 codexCli/apiMode/apiProxy 出现在 gemini 上也合法，导致 16 处 `provider === 'openai'` 守卫
- **Decision**：用 interface 继承 + union type
  ```ts
  interface ApiProfileBase {
    id: string; name: string; baseUrl: string; apiKey: string; model: string; timeout: number
  }
  interface OpenAIProfile extends ApiProfileBase {
    provider: 'openai'; apiMode: ApiMode; codexCli: boolean; apiProxy: boolean
  }
  interface GeminiProfile extends ApiProfileBase { provider: 'gemini' }
  type ApiProfile = OpenAIProfile | GeminiProfile
  ```
- **Consequences**：
  - SettingsModal/JSX 里的 `provider === 'openai'` 大多依然保留（用作分支渲染），但内部访问 `apiMode/codexCli/apiProxy` 变成类型安全
  - normalize 时按 provider 选择 builder，剔除多余字段
  - 旧 localStorage 数据（含多余字段）→ normalize 时按 provider 重新构造，无 BC 风险

## Technical Notes

- 文件 line counts（refactor 之后基线）：
  - `imageCache.ts` 29 行
  - `taskRuntime.ts` 601 行
  - `apiProfiles.ts` 239 行
  - `SettingsModal.tsx` 704 行
  - `types.ts` ~200 行
- 现有测试：43 个全过
- 现有 build：458KB / 137KB gz
- 风险点：判别联合改造若 normalize 处理不当，旧持久化数据加载会丢字段
