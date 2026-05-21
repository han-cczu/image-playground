# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

### Don't: use `window.*` prefixed globals inside `src/lib/**`

`src/lib/**` 是与运行环境解耦的库层，必须可在 vitest 的 node 环境直接被单测引入。任何 `window.setTimeout` / `window.clearTimeout` / `window.fetch` / `window.localStorage` 等 `window.` 前缀写法都会让纯 node 测试抛 `ReferenceError: window is not defined`，被迫为单测引入 jsdom 或 setup shim。React 组件层（`src/components/**`、`src/hooks/**` 等本就跑在浏览器）允许使用 `window.xxx` 以表达"显式 DOM 依赖"。

❌ Bad — `src/lib/api/optimizePromptApi.ts` 里写：

```typescript
const timer = window.setTimeout(() => controller.abort(), timeoutMs)
// vitest (node 环境) 报 ReferenceError: window is not defined
```

✅ Good — 直接用全局裸名，浏览器与 node 都识别：

```typescript
const timer = setTimeout(() => controller.abort(), timeoutMs)
```

原因：`src/lib/**` 应保持环境无关，避免为单测付出 DOM 模拟成本。

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

---

## Testing Requirements

### Local-first data safety contracts

1. Scope / Trigger
   - Applies to export/import, URL bootstrap, IndexedDB persistence, and image task runtime.
   - These paths move secrets or local user data across storage boundaries, so tests must assert the exact boundary behavior.

2. Signatures
   - `exportData(): Promise<void>`
   - `importData(file: File, options?: { mode?: 'merge' | 'replace' }): Promise<boolean>`
   - `readUrlBootstrap(href: string): { settings: Partial<AppSettings>; provider: ApiProvider | null; cleanUrl: string; changed: boolean }`
   - `updateTaskInStore(taskId: string, patch: Partial<TaskRecord>): Promise<void>`

3. Contracts
   - Exported backups must not contain raw `apiKey` values by default.
   - Any newly-added secret-like field on `AppSettings` (`apiKey` / `password` / `token` / `secret` 等持久化敏感字段) MUST be redacted by `src/lib/exportImport.ts::redactSettingsForExport` in the same PR that introduces it, with a unit test asserting that field is cleared in the exported manifest. 新字段与脱敏函数必须同 PR 同步落地，否则视为不完整实现。
   - Import merge mode must not overwrite existing task/image records with the same id.
   - Import replace mode may clear tasks/images first, but settings still use conservative merge rules.
   - URL bootstrap may read legacy query secrets for compatibility, but must return a `cleanUrl` without bootstrap keys.
   - Task updates must surface IndexedDB write failure through `TaskRecord.persistenceError` and a toast.

4. Validation & Error Matrix
   - Missing `manifest.json` -> import returns `false` and shows an import failure toast.
   - Invalid manifest shape -> import returns `false` and shows an import failure toast.
   - Existing task/image id in merge mode -> skip imported record, keep local record.
   - IndexedDB write failure -> keep UI patch visible, add `persistenceError`, show error toast, reject caller promise.

5. Good/Base/Bad Cases
   - Good: export backup with configured API keys, unzip manifest, assert every `apiKey` is `''`.
   - Base: import a legacy backup with keys into an empty profile, assert compatibility still works.
   - Bad: import merge backup over existing id, assert existing local record is not overwritten.

6. Tests Required
   - Unit tests around export redaction.
   - Unit tests around merge versus replace import behavior.
   - Unit tests around URL cleanup for query and hash bootstrap values.
   - Unit tests around rejected `putTask`.

7. Wrong vs Correct

Wrong:

```typescript
const manifest = { settings }
```

Correct:

```typescript
const manifest = { settings: redactSettingsForExport(settings) }
```

### Common Mistake: 新增 settings 上的敏感字段后忘记同步 `redactSettingsForExport`

**Symptom**: 用户导出的备份 ZIP 里 `manifest.json` 包含明文 API Key / token，备份文件一旦泄漏即等于密钥泄漏。

**Cause**: 新增 `AppSettings.<feature>.apiKey`（典型例：`AppSettings.promptOptimizer.apiKey`）时只改了 store 与 UI，未同步更新 `src/lib/exportImport.ts::redactSettingsForExport`，导致默认导出路径直接序列化原始 settings。

**Fix**: 在 `redactSettingsForExport` 中把新 secret 字段同样清空为 `''`/`null`，并在 `redactSettingsForExport` 的单测里新增一条断言：导出后该字段被脱敏。

**Prevention**: 把 `redactSettingsForExport` 视为 secret-like settings 字段的**强制出口**——任何新增 `apiKey` / `password` / `token` / `secret` 字段的 PR，必须同时改动该函数与其单测，否则在 code review 阶段打回。

❌ Bad:

```typescript
// settings.ts: 加了 promptOptimizer.apiKey
interface PromptOptimizerSettings { apiKey: string; /* ... */ }

// exportImport.ts: redactSettingsForExport 未更新
function redactSettingsForExport(s: AppSettings) {
  return { ...s, openai: { ...s.openai, apiKey: '' }, gemini: { ...s.gemini, apiKey: '' } }
  // ↑ promptOptimizer.apiKey 原样落入 manifest
}
```

✅ Good:

```typescript
function redactSettingsForExport(s: AppSettings) {
  return {
    ...s,
    openai: { ...s.openai, apiKey: '' },
    gemini: { ...s.gemini, apiKey: '' },
    promptOptimizer: { ...s.promptOptimizer, apiKey: '' }, // 同 PR 补全
  }
}
```

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
