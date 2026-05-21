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

### Required: Mobile fixed drawer must lock `document.body` scroll while open

**What**: 移动端 `< md` 断点用 `fixed inset-y-0 + transform translate-x-*` 实现的抽屉（如 Sidebar 移动态），打开时必须设置 `document.body.style.overflow = 'hidden'`，关闭/卸载时在 effect cleanup 中恢复。

**Why**: 不锁背景滚动时，用户在抽屉内滑动会"穿透"到背景滚动主内容，移动端 iOS Safari 还会偶发触发 viewport 跳动。锁住 body overflow 是行业事实标准（Radix / HeadlessUI / shadcn 等抽屉组件都这么做）。

**Example**:

```tsx
useEffect(() => {
  if (!mobileOpen) return
  const prev = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  return () => { document.body.style.overflow = prev }
}, [mobileOpen])
```

**Related**: 见 `component-guidelines.md` 中 drawer / popover Esc + outside-click + cleanup 模式。

实证：commit `e6a2584`（PR2 复核自修） `src/components/Sidebar/index.tsx`。

---

### Required: icon-only `<button>` must declare `aria-label`

**What**: 任何只渲染 icon（SVG / emoji / 单字符 / 图标字体）的 `<button>` 必须显式 `aria-label="<动作描述>"`。`title` attribute 对屏幕阅读器不可靠，不能替代 `aria-label`。

**Why**: Screen reader 在没有 accessible name 时只念出 "button"。无障碍审计自动失败；键盘用户 Tab 过去也听不到含义。

**Example**:

```tsx
<button onClick={onDelete} aria-label="删除对话" title="删除对话">
  <TrashIcon aria-hidden="true" />
</button>
```

**Related**: 见 `component-guidelines.md::Accessibility::Required: icon-only <button> must have aria-label`。

实证：commit `e6a2584` 的 `src/components/Header.tsx`（4 个图标按钮）+ `src/components/Sidebar/`（折叠 / 新建 / 删除）；PR3 `src/components/InputBar/`（5 pill + 高级齿轮 + 关闭按钮）。

---

### Required: drawer & popover must listen Esc + outside click with effect cleanup

**What**: 任何可关闭的 overlay 组件（抽屉、popover、菜单、对话框）必须：

1. `keydown` 监听 `Escape` 触发关闭。
2. `mousedown` 或 `pointerdown` 监听 outside ref 触发关闭。
3. 监听挂到 `document`，在 `useEffect` cleanup 中**显式 removeEventListener**。
4. 仅在 overlay open 时挂监听（`if (!open) return`），避免常驻空跑。

**Why**: 不做 cleanup 会在组件卸载后留下僵尸监听，导致 stale closure 引用旧 props/state；不挂 Esc 让键盘用户无法关闭；不挂 outside click 让用户必须找到 X 按钮。这三件事是 overlay 组件的 baseline 期望，不是可选增强。

**Example**:

```tsx
useEffect(() => {
  if (!open) return
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
  const onDown = (e: MouseEvent) => {
    if (!ref.current?.contains(e.target as Node)) onClose()
  }
  document.addEventListener('keydown', onKey)
  document.addEventListener('mousedown', onDown)
  return () => {
    document.removeEventListener('keydown', onKey)
    document.removeEventListener('mousedown', onDown)
  }
}, [open, onClose])
```

实证：commit `e6a2584` `src/components/Sidebar/index.tsx`；PR3 `src/components/InputBar/AdvancedParamsPopover.tsx` / `ModelMenu` / `ResolutionMenu`。

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
