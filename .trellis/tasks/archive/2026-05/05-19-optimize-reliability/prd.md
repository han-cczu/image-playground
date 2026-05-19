# Optimize Image Playground Reliability

## Goal

Improve the current image generation playground from a working experiment into a more reliable local-first tool. The work focuses on security, recoverability, task execution correctness, and regression coverage for the issues found during the review.

## What I Already Know

* The app is a React 19 + TypeScript + Vite single-page app.
* Tasks and images are stored locally with Zustand persistence, localStorage, and IndexedDB.
* API calls support OpenAI-compatible Images API, OpenAI-compatible Responses API, and Gemini.
* Current unit tests pass after restoring dependencies with `npm ci`.
* `npm audit --audit-level=moderate` reports 4 moderate vulnerabilities from the Cloudflare plugin / Wrangler / Miniflare `ws` dependency chain.
* Existing dirty work before this task: `.codex/config.toml`.

## Problems To Fix

* Export currently writes full `settings` into `manifest.json`, including API keys.
* README and app flow support `?apiKey=` URL configuration, which can leak through browser history, logs, screenshots, and shared links.
* Multi-image concurrent generation uses `Promise.allSettled` and treats any successful sub-request as task success. Partial failures are not surfaced.
* Task watchdog marks a task as failed on timeout but does not cancel the actual fetch.
* Task persistence uses fire-and-forget `putTask` in `updateTaskInStore`, so IndexedDB failures can be silent.
* Import behavior merges data without a clear user-facing choice between merge and replace.
* UI and data-flow tests cover utilities but not enough high-risk flows.

## Requirements

* Remove API keys from exported backups by default.
* Keep imported settings compatible with older backups that contain API keys.
* Make URL API key handling safer:
  * Stop documenting `?apiKey=`.
  * Prefer URL hash handling for one-time API key transfer if URL-based bootstrap is kept.
  * Do not leave secrets in the visible URL after initialization.
* Make concurrent multi-image generation honest:
  * Preserve successful outputs.
  * Surface partial failure count and representative error.
  * Store partial success metadata or mark the task as error when no image succeeds.
* Tie task timeout to real request cancellation where feasible.
* Make task persistence failures visible and testable.
* Add import mode support:
  * Merge keeps existing records and imports missing records/images.
  * Replace clears existing local records/images before import.
  * Settings merge remains conservative to avoid overwriting existing user secrets unless there is no real current profile.
* Add tests for security-sensitive export/import behavior, partial concurrent success, timeout/cancel behavior, and persistence error handling.
* Preserve existing UI style and local-first behavior.

## Acceptance Criteria

* [ ] Exported `manifest.json` no longer contains raw `apiKey` values by default.
* [ ] Importing an old backup with `apiKey` still works through the existing settings merge path.
* [ ] README no longer recommends putting API keys in query strings.
* [ ] URL bootstrap clears sensitive values from the address bar after reading them.
* [ ] Partial concurrent failures are visible to the user and stored on the task or task result.
* [ ] All-failed concurrent generation still fails the task with the original error.
* [ ] Timeout cancels or invalidates in-flight request work instead of only changing the task status.
* [ ] IndexedDB write failures during task updates are reported rather than silently ignored.
* [ ] Import offers merge and replace semantics through clear code paths and UI copy.
* [ ] `npm test` passes.
* [ ] `npm run build` passes.
* [ ] `npm audit --audit-level=moderate` is checked and either resolved or documented with a pinned reason.

## Definition Of Done

* Focused unit tests added or updated for changed utility/runtime behavior.
* Build and tests pass locally.
* README updated for changed URL key guidance.
* No unrelated user changes are reverted.
* Implementation stays scoped to reliability/security improvements listed here.

## Technical Approach

Implement the work in small slices:

1. Add data helpers for secret redaction and import modes.
2. Add API result metadata for partial success and wire it into task records.
3. Add a cancellable task execution layer that shares one cancellation signal between watchdog and API calls.
4. Replace fire-and-forget persistence with an async-safe path where failures surface through toast/task error state.
5. Update settings/import UI copy and README.
6. Add regression tests around the high-risk paths.

## Decision (ADR-lite)

**Context**: The current experiment favors fast local operation but under-handles security and failure states.

**Decision**: Keep the local-first architecture and existing provider abstraction. Improve behavior through narrow runtime and data-flow changes instead of a full rewrite.

**Consequences**: This avoids disrupting the UI and API profile model. Some files are already large, so changes should favor small helper functions and tests over broad restructuring.

## Out Of Scope

* Replacing Zustand or IndexedDB storage.
* Adding a backend account system.
* Removing URL-based bootstrap entirely unless the code path proves unsafe to preserve.
* Replacing Cloudflare deployment tooling in this task.
* Full visual redesign.

## Implementation Plan

### Phase 1: Secret-safe export/import

* Add a `redactSettingsForExport` helper near settings/export code.
* Use it when writing `manifest.json`.
* Add import options: `mode: 'merge' | 'replace'`.
* Wire Settings modal import UI to ask merge versus replace.
* Add tests that unzip exported data and assert no key is present.

### Phase 2: Safer URL bootstrap and docs

* Keep existing query compatibility if needed, but prefer hash secret bootstrap.
* Clear sensitive query/hash values immediately after reading.
* Update README examples to remove `?apiKey=`.
* Add tests around settings normalization or extracted URL parsing if parsing is moved into a helper.

### Phase 3: Concurrent generation partial success

* Extend `CallApiResult` with `partialFailureCount` and `partialFailureMessage`.
* Update OpenAI Images, Responses, and Gemini concurrent paths.
* Store partial result metadata in `TaskRecord`.
* Surface a warning toast when only part of the requested image count succeeds.
* Add tests for all-failed and partial-failed concurrent calls.

### Phase 4: Cancellation and persistence reliability

* Introduce a task controller registry keyed by task id.
* Pass an optional abort signal through `callImageApi` into provider implementations.
* Let watchdog abort in-flight work when timeout fires.
* Make persistence update failures visible through toast and task detail.
* Add tests for timeout/cancel and rejected `putTask`.

### Phase 5: Verification and dependency audit

* Run `npm test`.
* Run `npm run build`.
* Run `npm audit --audit-level=moderate`.
* If audit cannot be resolved without breaking Cloudflare tooling, document the exact dependency chain and leave a follow-up note.

## Technical Notes

Important files:

* `src/lib/exportImport.ts`
* `src/lib/api/apiProfiles.ts`
* `src/lib/taskRuntime.ts`
* `src/lib/api/openaiCompatibleImageApi.ts`
* `src/lib/api/geminiImageApi.ts`
* `src/lib/api/imageApiShared.ts`
* `src/types.ts`
* `src/App.tsx`
* `src/components/SettingsModal.tsx`
* `README.md`

Useful verification already run before planning:

* `npm ci`
* `npm test` -> 10 test files, 58 tests passed
* `npm run build` -> passed
* `npm audit --audit-level=moderate` -> 4 moderate vulnerabilities in Cloudflare tooling dependency chain
