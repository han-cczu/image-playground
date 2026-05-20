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
   - `updateFavoriteCategory(id: string, patch: Partial<Pick<FavoriteCategory, 'name' | 'color'>>): void`
   - `deleteFavoriteCategory(id: string): Promise<void>`
   - `moveFavoriteCategory(id: string, direction: -1 | 1): void`
   - `filterAndSortTasks(tasks, { searchQuery, filterStatus, filterFavorite, filterFavoriteCategoryId })`

3. Contracts
   - Store task assignment by category id, not category name.
   - Fresh local state and legacy persisted state without initialized category metadata must seed one default favorite category.
   - Persisted stores use `favoriteCategoriesInitialized` to distinguish legacy empty arrays from users who deleted all categories after initialization.
   - An initialized empty category list is valid after the user deletes all categories; do not recreate the default in that path.
   - A task may have zero or one `favoriteCategoryId`; category filtering only shows favorite tasks with that id.
   - Renaming, recoloring, or reordering a category must not rewrite task records.
   - Deleting a category must clear matching `TaskRecord.favoriteCategoryId` values and persist affected tasks.
   - Persisted and imported category arrays must be normalized: invalid ids skipped, colors defaulted, and `sortOrder` compacted.
   - Export manifest must include `favoriteCategories` when category metadata exists.

4. Validation & Error Matrix
   - Missing category metadata during import -> clear imported task `favoriteCategoryId`.
   - Non-favorite task with category id during import -> clear `favoriteCategoryId`.
   - Legacy replace import with no category metadata -> keep one default category for UI visibility, with no task assignments.
   - Deleted active filter category -> reset `filterFavoriteCategoryId` to `null`.
   - Invalid category color -> replace with default category color.
   - Duplicate category id in imported/persisted metadata -> keep one normalized category.

5. Good/Base/Bad Cases
   - Good: import backup with category metadata and favorite task assignment, then filter by category id.
   - Base: legacy task without `favoriteCategoryId` renders and exports normally.
   - Bad: rename category by rewriting every task's category name.

6. Tests Required
   - Store tests for create/update/reorder/delete actions.
   - Store tests for fresh default category, legacy persisted state without category metadata, and legacy empty category arrays.
   - Store test that delete clears task assignments and persists only changed tasks.
   - Export/import tests for category metadata round-trip.
   - Import test for dangling task category references.
   - Filter tests for category filters excluding non-favorites and preserving uncategorized favorites in all-favorites view.

7. Wrong vs Correct

Wrong:

```typescript
task.favoriteCategoryName = category.name
```

Correct:

```typescript
task.favoriteCategoryId = category.id
```

---

## Common Mistakes

<!-- State management mistakes your team has made -->

(To be filled by the team)
