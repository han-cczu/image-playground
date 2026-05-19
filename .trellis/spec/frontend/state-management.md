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

## Common Mistakes

<!-- State management mistakes your team has made -->

(To be filled by the team)
