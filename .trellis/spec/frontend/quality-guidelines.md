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

(To be filled by the team)

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

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
