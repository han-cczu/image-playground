# State Management

> How state is managed in this project.

---

## Overview

<!--
Document your project's state management conventions here.

Questions to answer:
- What state management solution do you use?
- How is local vs global state decided?
- How do you handle server state?
- What are the patterns for derived state?
-->

(To be filled by the team)

---

## State Categories

<!-- Local state, global state, server state, URL state -->

(To be filled by the team)

---

## When to Use Global State

<!-- Criteria for promoting state to global -->

(To be filled by the team)

---

## Server State

### Image task runtime contracts

1. Scope / Trigger
   - Applies when a UI action creates, retries, reorders, favorites, deletes, or completes a `TaskRecord`.
   - `TaskRecord` lives in Zustand for immediate UI feedback and IndexedDB for durable local history.

2. Signatures
   - `submitTask(options?: { allowFullMask?: boolean }): Promise<void>`
   - `retryTask(task: TaskRecord): Promise<void>`
   - `updateTaskInStore(taskId: string, patch: Partial<TaskRecord>): Promise<void>`
   - `callImageApi(opts: CallApiOptions): Promise<CallApiResult>`

3. Contracts
   - UI state updates can happen optimistically, but persistence errors must stay visible.
   - Runtime-created HTTP tasks need a task-scoped abort controller.
   - Watchdog timeout must abort the in-flight request before marking the task failed.
   - Partial concurrent success is still a completed task, but must store `partialFailureCount` and `partialFailureMessage`.

4. Validation & Error Matrix
   - API returns no successful images -> task status `error`.
   - API returns some images and some failed subrequests -> task status `done`, partial failure fields populated, warning toast shown.
   - Timeout fires while task is still running -> request signal aborted, task status `error`.
   - Task was already completed/deleted before API returns -> ignore stale result.

5. Good/Base/Bad Cases
   - Good: requesting 3 images with 2 successful subrequests stores 2 outputs and records 1 failure.
   - Base: requesting 1 image and receiving 1 image stores normal success without partial fields.
   - Bad: timeout only changes the card state while fetch continues in the background.

6. Tests Required
   - Provider-level partial success tests for each concurrent provider path.
   - Runtime test that task watchdog aborts the `CallApiOptions.signal`.
   - Runtime test that partial result metadata lands on `TaskRecord`.

7. Wrong vs Correct

Wrong:

```typescript
const results = await Promise.allSettled(requests)
return successfulResults
```

Correct:

```typescript
const { successfulResults, partialFailureCount, partialFailureMessage } =
  summarizeConcurrentFailures(results)
return { images, partialFailureCount, partialFailureMessage }
```

---

### Favorite category contracts

1. Scope / Trigger
   - Applies when UI code creates, renames, deletes, reorders, recolors, filters, imports, exports, or assigns a favorite category.
   - Category metadata is app-level local state; task assignments are durable task-record fields.

2. Signatures
   - `FavoriteCategory`: `{ id: string; name: string; color: string; sortOrder: number; createdAt: number }`
   - `TaskRecord.favoriteCategoryId?: string | null`
   - `createFavoriteCategory(input: { name: string; color?: string }): string`
   - `ensureDefaultFavoriteCategory(): string`
   - `updateFavoriteCategory(id: string, patch: Partial<Pick<FavoriteCategory, 'name' | 'color'>>): void`
   - `deleteFavoriteCategory(id: string): Promise<void>`
   - `moveFavoriteCategory(id: string, direction: -1 | 1): void`
   - `setTaskFavoriteCategory(taskId: string, categoryId: string): Promise<void>`
   - `clearTaskFavorite(taskId: string): Promise<void>`
   - `filterAndSortTasks(tasks, { searchQuery, filterStatus, filterFavorite, filterFavoriteCategoryId })`

3. Contracts
   - Store task assignment by category id, not category name.
   - Favoriting from a record star or bulk action must first select a category; canceling the category menu must not change `TaskRecord`.
   - Selecting a category through the favorite flow must set both `isFavorite: true` and `favoriteCategoryId`.
   - Canceling favorite must set `isFavorite: false` and `favoriteCategoryId: null`.
   - Category creation is available from the top category entry and favorite category menu; settings only manages existing categories.
   - Fresh local state and legacy persisted state without initialized category metadata must seed one default favorite category.
   - Persisted stores use `favoriteCategoriesInitialized` to distinguish legacy empty arrays from users who deleted all categories after initialization.
   - An initialized empty category list is valid after the user deletes all categories; do not recreate the default in that path.
   - If the user explicitly chooses the default category from the favorite flow after deleting all categories, `ensureDefaultFavoriteCategory()` may restore that single default category.
   - A task may have zero or one `favoriteCategoryId`; category filtering only shows favorite tasks with that id.
   - Renaming, recoloring, or reordering a category must not rewrite task records.
   - Deleting a category must clear matching `TaskRecord.favoriteCategoryId` values and persist affected tasks. Dirty tasks must be identified by `task.favoriteCategoryId === deletedId` against the pre-delete `state.tasks` snapshot, not by index-aligned diffing against the post-delete list — index alignment silently breaks the moment any upstream `filter/sort/map` is reordered.
   - Bulk category assignment must only short-circuit when every selected task is already favorited **into the target category**. Short-circuiting on "every selected task is favorited" alone silently drops cross-category bulk moves.
   - Bulk store actions over `selectedTaskIds` (favorite, unfavorite, assign category, delete) must `await Promise.allSettled(...)` before clearing the selection / closing the confirm dialog. `forEach` + bare `void promise.catch(...)` clears the selection while writes are still in flight and leaves the user unable to retry the failed subset.
   - Persisted and imported category arrays must be normalized: invalid ids skipped, colors defaulted, and `sortOrder` compacted.
   - Export manifest must include `favoriteCategories` when category metadata exists.

4. Validation & Error Matrix
   - Missing category metadata during import -> clear imported task `favoriteCategoryId`.
   - Non-favorite task with category id during import -> clear `favoriteCategoryId`.
   - Legacy replace import with no category metadata -> keep one default category for UI visibility, with no task assignments.
   - Favorite category menu closed without selection -> no task update and no persistence write.
   - Explicit default category selection with initialized empty categories -> restore default category, then assign the task.
   - Deleted active filter category -> reset `filterFavoriteCategoryId` to `null`.
   - Invalid category color -> replace with default category color.
   - Duplicate category id in imported/persisted metadata -> keep one normalized category.
   - Bulk assign to category X with all selected tasks already in X -> short-circuit; no confirm dialog.
   - Bulk assign to category X with any selected task not yet in X (including already-favorited tasks in a different category) -> show confirm dialog; on confirm, write all and only clear selection after `Promise.allSettled`.

5. Good/Base/Bad Cases
   - Good: import backup with category metadata and favorite task assignment, then filter by category id.
   - Good: click an un-favorited star, choose a category, and persist `isFavorite: true` plus that `favoriteCategoryId`.
   - Base: legacy task without `favoriteCategoryId` renders and exports normally.
   - Bad: click an un-favorited star and immediately persist `isFavorite: true` before the user chooses a category.

6. Tests Required
   - Store tests for create/update/reorder/delete actions.
   - Store tests for fresh default category, legacy persisted state without category metadata, and legacy empty category arrays.
   - Store test that delete clears task assignments and persists only changed tasks (assert `putTask` is called for affected tasks and **not** called for unaffected tasks).
   - Runtime tests for `setTaskFavoriteCategory` and `clearTaskFavorite`.
   - Runtime test that explicit default restore can be assigned to a task after initialized empty categories.
   - Export/import tests for category metadata round-trip.
   - Import test for dangling task category references.
   - Filter tests for category filters excluding non-favorites and preserving uncategorized favorites in all-favorites view.
   - Bulk-action coverage (test or manual verification, depending on available test infrastructure): cross-category bulk-move is not short-circuited; bulk action clears selection only after all writes settle.

7. Wrong vs Correct

Wrong (raw favorite without category):

```typescript
updateTaskInStore(task.id, { isFavorite: true })
```

Correct:

```typescript
setTaskFavoriteCategory(task.id, category.id)
```

Wrong (bulk action short-circuits on "all favorited"):

```typescript
const allFavorite = selectedTasks.every((t) => t.isFavorite)
if (allFavorite) return // silently drops cross-category bulk moves
```

Correct:

```typescript
const allInTarget = selectedTasks.every(
  (t) => t.isFavorite && t.favoriteCategoryId === categoryId,
)
if (allInTarget) return
```

Wrong (delete-category persistence via index-aligned diff):

```typescript
const nextTasks = state.tasks.map((t) =>
  t.favoriteCategoryId === id ? { ...t, favoriteCategoryId: null } : t,
)
await Promise.all(
  nextTasks
    .filter((t, i) => state.tasks[i]?.favoriteCategoryId !== t.favoriteCategoryId)
    .map((t) => putTask(t)),
)
```

Correct (locate dirty rows by the deleted id directly):

```typescript
const dirtyTasks = state.tasks
  .filter((t) => t.favoriteCategoryId === id)
  .map((t) => ({ ...t, favoriteCategoryId: null }))
await Promise.all(dirtyTasks.map((t) => putTask(t)))
```

Wrong (bulk action clears selection before writes settle):

```typescript
selectedTaskIds.forEach((id) => {
  void setTaskFavoriteCategory(id, categoryId).catch(() => {})
})
clearSelection() // selection gone while writes are still in flight
```

Correct:

```typescript
void (async () => {
  await Promise.allSettled(
    selectedTaskIds.map((id) => setTaskFavoriteCategory(id, categoryId)),
  )
  clearSelection()
})()
```

---

### Conversation runtime contracts

1. Scope / Trigger
   - Applies when UI code creates, renames, deletes, activates, or imports/exports a `Conversation`, or when `TaskRecord.conversationId` is assigned at submit / migration time.
   - Conversation metadata is durable local data: persisted in IndexedDB (same source-of-truth tier as `tasks`/`images`); only `activeConversationId` and `sidebarCollapsed` go through `zustand-persist` (UI ephemeral state).

2. Signatures
   - `Conversation`: `{ id: string; title: string; createdAt: number; updatedAt: number; sortOrder?: number; color?: string | null }`
   - `TaskRecord.conversationId?: string`（runtime guaranteed non-empty after `initStore` / `submitTask`）
   - `createConversation(seedTitle?: string): string`
   - `renameConversation(id: string, title: string): void`
   - `deleteConversationWithTasks(id: string): void`（弹 confirmDialog + cascade tasks）
   - `setActiveConversation(id: string | null): void`
   - `toggleSidebar(): void` / `setSidebarCollapsed(v: boolean): void`
   - `setConversations(conversations: Conversation[]): void`
   - `getAllConversations(): Promise<Conversation[]>`
   - `putConversation(conv: Conversation): Promise<void>`
   - `deleteConversation(id: string, cascadeTasks: boolean): Promise<void>`（DB 层）
   - `persistConversationMigration(updates): Promise<void>`（单事务 reseed）
   - `normalizeConversations(list): Conversation[]`（archive 沉底 + sortOrder 紧致化）
   - `filterAndSortTasks(tasks, { filterConversationId, ... })`

3. Contracts
   - `__archive__` 是固定 ID 的兜底对话，DB / store / UI **三层**都必须拒绝删除与重命名。`db.ts::deleteConversation('__archive__')` 抛错；`store.deleteConversationWithTasks` / `renameConversation` 走 toast 提示后早返回；UI 不渲染删除按钮 / 不进入重命名输入。
   - 删除 Conversation 必须 cascade tasks（同一 IDB 事务用 cursor 扫描 `byConversationId` 索引），不能"先单独删 conversation 再异步删 tasks"。
   - 历史 task 迁移走 reseed：每个出现过的 `favoriteCategoryId` → 一个 Conversation（id 复用 categoryId 防重复，title=分类 name，color=分类 color）；无 favorite 的 task → `__archive__`。
   - reseed 必须**幂等**：用 `localStorage.image-playground.conversationMigrationVersion` 作版本标志防重跑，再叠加"扫描 orphan task（无 conversationId）"作兜底再跑一次。
   - `setActiveConversation(id)` 在 store 层宽容（不校验 id 存在性）；UI 层与 `initStore` 在加载完 conversations 后必须二选一校验：UI 切换前 grep `find(c => c.id === id)`；`initStore` 加载完 conversations 后若 persisted `activeConversationId` 不在列表内，自动切到最新非 archive 对话。
   - `Conversation` 列表本身**不进 zustand-persist**（与 tasks 一致避免双源真相）；只持久化 `activeConversationId` 与 `sidebarCollapsed`。
   - `submitTask` 提交时若 `activeConversationId` 为空，必须先自动创建并激活一个对话再写入；首条 task 提交后若对话 title 仍为「新对话」，回写为 prompt 前 24 字。
   - `clearAllData` / `importData(replace)` 必须同步清空 conversations object store + 重置 store 中的 conversations 数组，否则旧对话穿透到新备份。
   - Export manifest version 4 携带 `conversations: Conversation[]`；旧导出（v3 无字段）import 时跑 reseed migration，新导出直接写入。
   - `normalizeConversations` 在所有持久化读取路径（`mergePersistedStoreState`、`initStore`、Sidebar 渲染前）调用，保证 `__archive__` 永远 sort 到末尾。

4. Validation & Error Matrix
   - `deleteConversation('__archive__')` -> throw（DB 层）。
   - `renameConversation('__archive__', ...)` -> toast「历史记录对话不可重命名」，store 不写入。
   - `renameConversation(id, '   ')` -> trim 后为空，store 不写入，UI input 恢复原值。
   - `submitTask` 时 `activeConversationId == null` -> 自动 `createConversation()`，激活后再继续。
   - `initStore` 加载完发现 persisted `activeConversationId` 不在 `conversations` 列表 -> 重置为最新非 archive 对话的 id。
   - IDB schema bump 失败 / onupgradeneeded throw -> 用户首次打开看不到任何 task；必须在 reseed 之外再做 "orphan task 扫描" 作启动兜底。
   - 多 tab 同时打开：activeConversationId 通过 zustand-persist 写 localStorage，多 tab 之间最终一致但不实时（PRD out-of-scope）。

5. Good/Base/Bad Cases
   - Good: 旧用户首次打开，5 个 favoriteCategory 一一映射为 5 个 Conversation，title=分类 name，archive 沉底；2 张未收藏 task 进 archive。
   - Base: 新用户首次打开，无历史数据，自动 seed 一个空 archive；新建对话默认 title「新对话」，提交首条 prompt 后改名为 prompt 前 24 字。
   - Bad: `deleteConversationWithTasks(id)` 先 `setConversations(filtered)` 再异步 `await dbDeleteConversation` -> 万一 DB 抛错，UI 已被擦除，用户失去对话且 task 残留 IDB。

6. Tests Required
   - DB test: v1→v2 升级不丢 task；`deleteConversation('__archive__')` 抛错；cascade delete 同事务删 task + conversation。
   - Store test: `createConversation` 自动激活；`renameConversation` 拒绝 archive 与空字符串；`deleteConversationWithTasks` confirmDialog + 只删目标对话的 task；`toggleSidebar` 翻转；`mergePersistedStoreState` 处理 `activeConversationId` / `sidebarCollapsed`。
   - Migration test: 纯函数 reseed 按 favoriteCategory 切分、复用 categoryId、orphan task 进 archive、幂等。
   - Filter test: `filterConversationId` 单独过滤 + 与 favoriteCategory 叠加（交集）。
   - Import test: 旧导出（无 conversations 字段）跑 reseed；新导出（v4 含 conversations）直接写入并清空旧 conversations store。

7. Wrong vs Correct

Wrong（删除对话先擦 UI 再异步删 DB）:

```typescript
deleteConversationWithTasks: (id) => {
  set((s) => ({ conversations: s.conversations.filter((c) => c.id !== id) }))
  void dbDeleteConversation(id, true).catch(() => {})
}
```

Correct（先 DB 后 UI；archive 双层保护）:

```typescript
deleteConversationWithTasks: (id) => {
  if (id === ARCHIVE_CONVERSATION_ID) { showToast('历史记录对话不可删除'); return }
  setConfirmDialog({
    title: '删除对话',
    message: '...',
    action: async () => {
      await dbDeleteConversation(id, /* cascadeTasks */ true)
      set((s) => ({
        conversations: s.conversations.filter((c) => c.id !== id),
        tasks: s.tasks.filter((t) => t.conversationId !== id),
        activeConversationId: s.activeConversationId === id ? null : s.activeConversationId,
      }))
    },
  })
}
```

Wrong（reseed 不幂等，每次启动重写所有 task.conversationId）:

```typescript
async function initStore() {
  const tasks = await getAllTasks()
  await persistConversationMigration({ tasks, categories })  // 重跑就会覆盖用户手动改的 conversationId
}
```

Correct（localStorage 版本标志 + orphan 兜底）:

```typescript
async function initStore() {
  const tasks = await getAllTasks()
  const needsReseed = readMigrationVersion() < CURRENT_MIGRATION_VERSION
                   || tasks.some((t) => !t.conversationId)
  if (needsReseed) {
    await persistConversationMigration({ tasks, categories })
    writeMigrationVersion(CURRENT_MIGRATION_VERSION)
  }
}
```

实证：commit `eea442a`（PR1 数据层）— `src/lib/db.ts`、`src/lib/conversations.ts`、`src/lib/conversationMigration.ts`、`src/store.ts`、`src/lib/taskRuntime.ts`、`src/lib/exportImport.ts`。

---

## Common Mistakes

### Bulk store actions that clear UI selection before writes settle

**Symptom**: After a bulk favorite / unfavorite / assign-category action over `selectedTaskIds`, the multi-select toolbar disappears immediately. If some tasks fail to persist, the user has no selection left to retry and only sees per-task error toasts arriving asynchronously.

**Cause**: The action handler dispatches per-task store actions with `forEach` + `void promise.catch(...)` and calls `clearSelection()` synchronously on the next line. `clearSelection()` runs before any `putTask` resolves.

**Fix**: Wrap the batch in an async IIFE, `await Promise.allSettled(...)`, then `clearSelection()`. Per-task failure toasts emitted by `updateTaskInStore` continue to surface; no aggregate toast is required.

**Prevention**: When `selectedTaskIds.length > 0` and the action mutates each selected task, treat selection state as load-bearing — never clear it before writes finish.

### Reading zustand / localStorage from inside IDB `onupgradeneeded`

**Symptom**: IDB schema bump 后用户刷一次正常、刷第二次（或在另一 tab 打开）对话切分错乱、部分 task 消失或归错对话。

**Cause**: `onupgradeneeded` 里直接 `localStorage.getItem('image-playground')` 读 zustand-persist 拿 favoriteCategories 用于业务迁移。问题：(1) 多 tab 同时打开时只有一个 tab 触发 upgrade，其他 tab 拿到的 IDB 在 zustand-persist 视角是"被另一边突然改过"，时序不稳；(2) zustand-persist 反序列化未完成时 localStorage 可能还是上次的脏数据；(3) onupgradeneeded 是同步事务环境，里面用 await/Promise 链跑业务迁移会让事务自动 commit，后续写入抛 `TransactionInactiveError`。

**Fix**: IDB 升级路径只做"创建 store + 兜底 archive 默认对话 + 给 task 补 conversationId 字段（不读外部数据）"这种**纯 schema 操作**。**真正按 favoriteCategory 切分的业务迁移留到应用启动后第一次跑**：`initStore` 里拿到 zustand 的 favoriteCategories 与 IDB 的 tasks 后，调一次 `persistConversationMigration(...)`，并在 localStorage 写一个 `conversationMigrationVersion` 标志防重跑。

**Prevention**: `onupgradeneeded` 内禁止 await / 跨 store 读取 / 调用 zustand。如果业务迁移需要 zustand 状态，一律延迟到 `initStore`，并用版本标志 + orphan 兜底两道保险。

❌ Bad（onupgradeneeded 内读 localStorage + 跑业务迁移）:

```typescript
request.onupgradeneeded = async (event) => {
  const db = event.target.result
  db.createObjectStore('conversations', { keyPath: 'id' })
  const raw = localStorage.getItem('image-playground')  // 多 tab 时序不稳
  const categories = JSON.parse(raw).state.favoriteCategories
  const tasks = await getAllTasks()  // await 让事务 commit，后续 put 抛 TransactionInactiveError
  for (const t of tasks) {
    db.transaction('tasks', 'readwrite').objectStore('tasks').put({...t, conversationId: ...})
  }
}
```

✅ Good（onupgradeneeded 只动 schema，业务迁移留给 initStore）:

```typescript
request.onupgradeneeded = (event) => {
  const db = event.target.result
  if (event.oldVersion < 2) {
    const store = db.createObjectStore('conversations', { keyPath: 'id' })
    store.createIndex('byUpdatedAt', 'updatedAt')
    store.put({ id: ARCHIVE_CONVERSATION_ID, title: '历史记录', /* ... */ })
  }
}

// 应用启动后
async function initStore() {
  const tasks = await getAllTasks()
  const conversations = await getAllConversations()
  const needsReseed = readMigrationVersion() < CURRENT_MIGRATION_VERSION
                   || tasks.some((t) => !t.conversationId)
  if (needsReseed) {
    const { tasks: nextTasks, conversations: nextConvs } =
      reseedConversations({ tasks, conversations, favoriteCategories })
    await persistConversationMigration({ tasks: nextTasks, conversations: nextConvs })
    writeMigrationVersion(CURRENT_MIGRATION_VERSION)
  }
}
```

实证：commit `eea442a` 的 `src/lib/db.ts::DB_VERSION 1→2` 与 `src/lib/taskRuntime.ts::initStore`。

---

### zustand-persist 反序列化时不 normalize settings → 新字段对老用户白屏

**Symptom**: 给 `AppSettings` 加了一个新字段（如 `promptOptimizer.apiKey`），新开发环境用没问题。但有持久化数据早于该字段引入的老用户刷新页面立刻白屏。Console 第一条错误形如 `TypeError: Cannot read properties of undefined (reading 'apiKey')`，指向某个组件读 `settings.<新字段>.xxx` 的位置（如 `InputBar/index.tsx:384`）。

**Cause**: zustand-persist 的反序列化合并函数（项目里是 `mergePersistedStoreState`）原本直接 `...persisted` 裸展开 settings：

```typescript
return {
  ...currentState,
  ...persisted,                  // 把 localStorage 里的旧 settings 整个塞进来
  favoriteCategories: ...,        // 只有特定字段走了 normalize
}
```

`normalizeSettings`（`apiProfiles.ts`）虽然每个字段都 `normalize<Field>(record.<field>)` 兜了 default，但它只在 `setSettings` 路径被调，**hydration 不走这条路**。结果：localStorage 里早期写入的 settings 对象没有新字段 → spread 后整个 `settings.promptOptimizer === undefined` → 组件渲染期读 `.apiKey` 抛 TypeError → 项目当时没 error boundary → 整页 unmount → 白屏。

**Fix**: hydration merge 函数里给 settings 显式跑一次 `normalizeSettings`：

```typescript
return {
  ...currentState,
  ...persisted,
  settings: normalizeSettings(persisted?.settings),  // ← 让 normalizer 兜默认值
  favoriteCategories: ...,
}
```

`normalizeSettings` 内部已经为每个字段调 `normalize<Field>`，新字段引入时只需在那里加一行 default 即可，hydration 路径自动受益。

**Prevention**:
1. **`AppSettings` 任何新增字段的 PR** 必须同步：(a) 在 `normalizeSettings` 内调用对应 `normalize<NewField>(record.<newField>)`；(b) `normalize<NewField>` 自身必须 accept `undefined` / 缺字段输入并返回完整 default 对象，**不能 assume 输入存在**；(c) 不需要再改 `mergePersistedStoreState`，因为这条规则之后 hydration 已统一走 normalize。
2. **review checklist**：写 `record.<newField>.foo` 时，看 normalize 函数是否处理 `record === undefined` / `record.<newField> === undefined` 两种情况。
3. **Code-review red flag**：任何 `normalize<X>(record: any)` 函数体里写 `record.foo` 不带 `?.` 或没有先 `record ?? {}` 就是潜在 white-screen 炸弹。

❌ Bad（normalize 假设输入存在）:

```typescript
function normalizePromptOptimizer(record: any): PromptOptimizerConfig {
  return {
    apiKey: record.apiKey ?? '',        // record === undefined → throw
    baseUrl: record.baseUrl ?? '',
  }
}
```

✅ Good（normalize 容忍缺字段）:

```typescript
function normalizePromptOptimizer(record: unknown): PromptOptimizerConfig {
  const r = (record && typeof record === 'object' ? record : {}) as Record<string, unknown>
  return {
    apiKey: typeof r.apiKey === 'string' ? r.apiKey : '',
    baseUrl: typeof r.baseUrl === 'string' ? r.baseUrl : DEFAULT_BASE_URL,
  }
}
```

实证：commit `15597dc fix(store): hydration 路径补齐 normalizeSettings，修复老用户白屏`。`src/store.ts::mergePersistedStoreState` 加 1 行 `settings: normalizeSettings(persisted?.settings)`，`src/components/InputBar/index.tsx:384` 即可不再 throw。

---

### Persisting "diff" via index-aligned arrays

**Symptom**: After refactoring a store action that "mutates many records and persists only the changed ones", the wrong records are persisted (or correct records are skipped) even though the in-memory state looks right.

**Cause**: The persistence loop diffs two arrays by shared index (`nextTasks[i]` vs `state.tasks[i]`). This is only correct when `nextTasks` is produced by `state.tasks.map(...)` with no reorder/filter — a constraint that is invisible to future readers and silently broken by trivial refactors (e.g. moving a `.filter` upstream).

**Fix**: Identify dirty records by domain identity (e.g. `task.favoriteCategoryId === deletedId`) against the pre-mutation snapshot, then construct the post-mutation copies for persistence. No index arithmetic.

**Prevention**: When you find yourself writing `arr1.filter((x, i) => arr2[i]?.field !== x.field)`, stop. If the two arrays share an implicit shape contract, encode it as a domain predicate instead.
