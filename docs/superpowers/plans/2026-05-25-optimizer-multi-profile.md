# 提示词优化器多配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让「提示词优化 API」从单一配置升级为「多个可切换的命名配置」，与图像生成 API 的 profile 体验一致。

**Architecture:** 平行的多配置系统 + `promptOptimizer` 字段保留为「当前激活优化器配置」的派生镜像（在 `normalizeSettings` 中派生），使两个消费方（`PromptOptimizerModal`、`InputBar`）零改动。新建独立的 `OptimizerProfileSelector`（无服务商徽标），不复用/不改动图像的 `ProfileSelector`。

**Tech Stack:** TypeScript、React 19、Zustand、Vitest、Tailwind。

设计依据：`docs/superpowers/specs/2026-05-25-optimizer-multi-profile-design.md`

**通用命令：**
- 单文件测试：`npx vitest run <path>`
- 全量测试：`npm run test`
- Lint：`npm run lint`
- 类型检查：`npx tsc -b`
- 完整构建：`npm run build`

---

## Task 1: 类型 + 归一化/迁移层

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/api/apiProfiles.ts`
- Test: `src/lib/api/apiProfiles.test.ts`

- [ ] **Step 1: 加类型（types.ts）**

在 `PromptOptimizerConfig` 接口之后新增：

```ts
/** 提示词优化器的命名配置（多配置切换用） */
export interface PromptOptimizerProfile extends PromptOptimizerConfig {
  id: string
  name: string
}
```

在 `AppSettings` 接口中，把 `promptOptimizer` 行替换为以下三行：

```ts
  /** 派生镜像：当前激活的优化器配置（消费方读此字段，等于 optimizerProfiles 中 activeOptimizerProfileId 指向的项） */
  promptOptimizer: PromptOptimizerConfig
  optimizerProfiles: PromptOptimizerProfile[]
  activeOptimizerProfileId: string
```

- [ ] **Step 2: 写失败测试（apiProfiles.test.ts）**

在文件末尾追加新 `describe` 块（顶部 import 里补上 `createDefaultOptimizerProfile`, `getActiveOptimizerProfile`, `DEFAULT_OPTIMIZER_PROFILE_ID`，与已有的 `normalizeSettings` / `DEFAULT_*` 同处导入）：

```ts
import {
  // ...保留文件已有导入...
  createDefaultOptimizerProfile,
  getActiveOptimizerProfile,
  DEFAULT_OPTIMIZER_PROFILE_ID,
} from './apiProfiles'

describe('optimizer profiles 归一化与迁移', () => {
  it('老数据（只有 promptOptimizer，无 optimizerProfiles）迁移为单个默认配置', () => {
    const result = normalizeSettings({
      promptOptimizer: {
        baseUrl: 'https://opt.example.com/v1',
        apiKey: 'sk-opt',
        model: 'gpt-4o-mini',
        timeout: 45,
        systemPrompt: '自定义提示词',
      },
    })
    expect(result.optimizerProfiles).toHaveLength(1)
    expect(result.optimizerProfiles[0]).toMatchObject({
      id: DEFAULT_OPTIMIZER_PROFILE_ID,
      name: '默认',
      baseUrl: 'https://opt.example.com/v1',
      apiKey: 'sk-opt',
      model: 'gpt-4o-mini',
      timeout: 45,
      systemPrompt: '自定义提示词',
    })
    expect(result.activeOptimizerProfileId).toBe(DEFAULT_OPTIMIZER_PROFILE_ID)
    // 镜像派生自激活配置
    expect(result.promptOptimizer).toEqual({
      baseUrl: 'https://opt.example.com/v1',
      apiKey: 'sk-opt',
      model: 'gpt-4o-mini',
      timeout: 45,
      systemPrompt: '自定义提示词',
    })
  })

  it('多个 optimizerProfiles：activeOptimizerProfileId 命中时镜像派生该项', () => {
    const result = normalizeSettings({
      optimizerProfiles: [
        { id: 'a', name: 'A', baseUrl: 'https://a/v1', apiKey: 'ka', model: 'ma', timeout: 30, systemPrompt: 'sa' },
        { id: 'b', name: 'B', baseUrl: 'https://b/v1', apiKey: 'kb', model: 'mb', timeout: 60, systemPrompt: 'sb' },
      ],
      activeOptimizerProfileId: 'b',
    })
    expect(result.optimizerProfiles).toHaveLength(2)
    expect(result.activeOptimizerProfileId).toBe('b')
    expect(result.promptOptimizer.apiKey).toBe('kb')
    expect(result.promptOptimizer.model).toBe('mb')
  })

  it('activeOptimizerProfileId 失效时兜底回第一个', () => {
    const result = normalizeSettings({
      optimizerProfiles: [
        { id: 'a', name: 'A', baseUrl: 'https://a/v1', apiKey: 'ka', model: 'ma', timeout: 30, systemPrompt: 'sa' },
      ],
      activeOptimizerProfileId: 'does-not-exist',
    })
    expect(result.activeOptimizerProfileId).toBe('a')
    expect(result.promptOptimizer.apiKey).toBe('ka')
  })

  it('DEFAULT_SETTINGS 带一个默认优化器配置', () => {
    expect(DEFAULT_SETTINGS.optimizerProfiles).toHaveLength(1)
    expect(DEFAULT_SETTINGS.activeOptimizerProfileId).toBe(DEFAULT_OPTIMIZER_PROFILE_ID)
    expect(DEFAULT_SETTINGS.optimizerProfiles[0].apiKey).toBe('')
  })

  it('createDefaultOptimizerProfile 可被 overrides 覆盖', () => {
    const p = createDefaultOptimizerProfile({ id: 'x', name: '新配置' })
    expect(p.id).toBe('x')
    expect(p.name).toBe('新配置')
    expect(p.timeout).toBe(DEFAULT_OPTIMIZER_TIMEOUT)
  })

  it('getActiveOptimizerProfile 返回激活配置', () => {
    const active = getActiveOptimizerProfile({
      optimizerProfiles: [
        { id: 'a', name: 'A', baseUrl: 'https://a/v1', apiKey: 'ka', model: 'ma', timeout: 30, systemPrompt: 'sa' },
        { id: 'b', name: 'B', baseUrl: 'https://b/v1', apiKey: 'kb', model: 'mb', timeout: 60, systemPrompt: 'sb' },
      ],
      activeOptimizerProfileId: 'b',
    })
    expect(active.id).toBe('b')
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run src/lib/api/apiProfiles.test.ts`
Expected: FAIL（`createDefaultOptimizerProfile` / `getActiveOptimizerProfile` / `DEFAULT_OPTIMIZER_PROFILE_ID` 未导出，且 `optimizerProfiles` 字段不存在）

- [ ] **Step 4: 实现（apiProfiles.ts）**

在 `DEFAULT_OPTIMIZER_TIMEOUT` 常量附近新增常量：

```ts
export const DEFAULT_OPTIMIZER_PROFILE_ID = 'default-optimizer'
```

在 `normalizePromptOptimizer` 函数之后新增三个函数：

```ts
export function createDefaultOptimizerProfile(
  overrides: Partial<PromptOptimizerProfile> = {},
): PromptOptimizerProfile {
  return {
    id: DEFAULT_OPTIMIZER_PROFILE_ID,
    name: '默认',
    ...createDefaultPromptOptimizer(),
    ...overrides,
  }
}

export function normalizeOptimizerProfile(input: unknown): PromptOptimizerProfile {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const config = normalizePromptOptimizer(record)
  const id =
    typeof record.id === 'string' && record.id.trim()
      ? record.id
      : `optimizer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const name = typeof record.name === 'string' && record.name.trim() ? record.name : '新配置'
  return { id, name, ...config }
}

export function getActiveOptimizerProfile(
  settings: Partial<AppSettings> | unknown,
): PromptOptimizerProfile {
  const normalized = normalizeSettings(settings)
  return (
    normalized.optimizerProfiles.find((p) => p.id === normalized.activeOptimizerProfileId) ??
    normalized.optimizerProfiles[0]
  )
}
```

在 `import type { ... } from '../../types'` 中补上 `PromptOptimizerProfile`。

在 `normalizeSettings` 内，`const active = ...` 与 `return { ... }` 之间，插入优化器配置归一化：

```ts
  const rawOptimizerProfiles = Array.isArray(record.optimizerProfiles)
    ? (record.optimizerProfiles as unknown[])
    : []
  const optimizerProfiles = rawOptimizerProfiles.length
    ? rawOptimizerProfiles.map((p) => normalizeOptimizerProfile(p))
    : [
        createDefaultOptimizerProfile({
          ...normalizePromptOptimizer(record.promptOptimizer),
          id: DEFAULT_OPTIMIZER_PROFILE_ID,
          name: '默认',
        }),
      ]
  const activeOptimizerProfileId =
    typeof record.activeOptimizerProfileId === 'string' &&
    optimizerProfiles.some((p) => p.id === record.activeOptimizerProfileId)
      ? record.activeOptimizerProfileId
      : optimizerProfiles[0].id
  const activeOptimizer =
    optimizerProfiles.find((p) => p.id === activeOptimizerProfileId) ?? optimizerProfiles[0]
```

把 `normalizeSettings` 的 `return { ... }` 中原来的这一行：

```ts
    promptOptimizer: normalizePromptOptimizer(record.promptOptimizer),
```

替换为：

```ts
    promptOptimizer: {
      baseUrl: activeOptimizer.baseUrl,
      apiKey: activeOptimizer.apiKey,
      model: activeOptimizer.model,
      timeout: activeOptimizer.timeout,
      systemPrompt: activeOptimizer.systemPrompt,
    },
    optimizerProfiles,
    activeOptimizerProfileId,
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/lib/api/apiProfiles.test.ts`
Expected: PASS（含原有用例）

- [ ] **Step 6: 类型检查 + lint**

Run: `npx tsc -b && npm run lint`
Expected: 无报错

- [ ] **Step 7: 提交**

```bash
git add src/types.ts src/lib/api/apiProfiles.ts src/lib/api/apiProfiles.test.ts
git commit -m "feat(optimizer): 优化器配置类型与归一化/迁移层（多配置 + 激活镜像）"
```

---

## Task 2: 导入合并（mergeImportedSettings）

**Files:**
- Modify: `src/lib/api/apiProfiles.ts`
- Test: `src/lib/api/apiProfiles.test.ts`

- [ ] **Step 1: 写失败测试**

在 Task 1 的 `describe` 块之后追加：

```ts
describe('mergeImportedSettings - optimizer profiles', () => {
  it('current 仅默认优化器配置时，全量采用导入的优化器配置', () => {
    const merged = mergeImportedSettings(DEFAULT_SETTINGS, {
      optimizerProfiles: [
        { id: 'imp-a', name: 'Imp A', baseUrl: 'https://a/v1', apiKey: 'ka', model: 'ma', timeout: 30, systemPrompt: 'sa' },
        { id: 'imp-b', name: 'Imp B', baseUrl: 'https://b/v1', apiKey: 'kb', model: 'mb', timeout: 60, systemPrompt: 'sb' },
      ],
      activeOptimizerProfileId: 'imp-b',
    })
    expect(merged.optimizerProfiles).toHaveLength(2)
    expect(merged.optimizerProfiles.map((p) => p.baseUrl).sort()).toEqual([
      'https://a/v1',
      'https://b/v1',
    ])
  })

  it('current 已自定义优化器配置时，去重追加导入项并分配新 id，保留 current 激活项', () => {
    const current = normalizeSettings({
      // 让图像 profiles 也非默认，避免命中图像 fresh 整体替换分支
      profiles: [
        { id: 'cur-img', name: 'Cur', provider: 'openai', baseUrl: 'https://img/v1', apiKey: 'ik', model: 'gpt-image-2', timeout: 600, apiMode: 'images', codexCli: false, apiProxy: false },
      ],
      activeProfileId: 'cur-img',
      optimizerProfiles: [
        { id: 'cur-opt', name: 'Cur Opt', baseUrl: 'https://cur/v1', apiKey: 'ck', model: 'cm', timeout: 30, systemPrompt: 'cs' },
      ],
      activeOptimizerProfileId: 'cur-opt',
    })
    const merged = mergeImportedSettings(current, {
      optimizerProfiles: [
        // 与 current 同 baseUrl+apiKey+model → 视为重复，跳过
        { id: 'dup', name: 'Dup', baseUrl: 'https://cur/v1', apiKey: 'ck', model: 'cm', timeout: 99, systemPrompt: 'x' },
        // 新配置 → 追加
        { id: 'new', name: 'New', baseUrl: 'https://new/v1', apiKey: 'nk', model: 'nm', timeout: 45, systemPrompt: 'ns' },
      ],
      activeOptimizerProfileId: 'new',
    })
    expect(merged.optimizerProfiles).toHaveLength(2)
    const baseUrls = merged.optimizerProfiles.map((p) => p.baseUrl).sort()
    expect(baseUrls).toEqual(['https://cur/v1', 'https://new/v1'])
    // current 激活项保留
    expect(merged.activeOptimizerProfileId).toBe('cur-opt')
    // 追加项不得复用导入 id
    expect(merged.optimizerProfiles.some((p) => p.id === 'new')).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/api/apiProfiles.test.ts`
Expected: FAIL（第二个用例：current 自定义优化器配置时未追加导入项，长度仍为 1）

- [ ] **Step 3: 实现（apiProfiles.ts）**

在 `dedupeApiProfiles` 函数之后新增优化器去重/默认判断/新 id 助手：

```ts
function getOptimizerProfileDedupKey(profile: PromptOptimizerProfile): string {
  return JSON.stringify([
    profile.baseUrl.trim().replace(/\/+$/, '').toLowerCase(),
    profile.apiKey.trim(),
    profile.model.trim(),
  ])
}

function dedupeOptimizerProfiles(profiles: PromptOptimizerProfile[]): PromptOptimizerProfile[] {
  const seen = new Set<string>()
  return profiles.filter((profile) => {
    const key = getOptimizerProfileDedupKey(profile)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isDefaultOptimizerProfile(profile: PromptOptimizerProfile): boolean {
  const d = createDefaultOptimizerProfile()
  return (
    profile.id === DEFAULT_OPTIMIZER_PROFILE_ID &&
    profile.name === d.name &&
    profile.baseUrl === d.baseUrl &&
    profile.apiKey === '' &&
    profile.model === d.model &&
    profile.timeout === d.timeout &&
    profile.systemPrompt === d.systemPrompt
  )
}

function hasOnlyDefaultOptimizerProfiles(settings: AppSettings): boolean {
  return (
    settings.optimizerProfiles.length === 1 &&
    settings.activeOptimizerProfileId === DEFAULT_OPTIMIZER_PROFILE_ID &&
    isDefaultOptimizerProfile(settings.optimizerProfiles[0])
  )
}

function createImportedOptimizerProfileId(usedIds: Set<string>): string {
  let id = `optimizer-imported-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  while (usedIds.has(id)) {
    id = `optimizer-imported-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  }
  usedIds.add(id)
  return id
}
```

在 `mergeImportedSettings` 内，把 `imported` 的构造从：

```ts
  const imported = normalizeSettings({
    ...normalizedImported,
    profiles: dedupeApiProfiles(normalizedImported.profiles),
  })
```

改为：

```ts
  const imported = normalizeSettings({
    ...normalizedImported,
    profiles: dedupeApiProfiles(normalizedImported.profiles),
    optimizerProfiles: dedupeOptimizerProfiles(normalizedImported.optimizerProfiles),
  })
```

> 说明：`if (hasOnlyDefaultProfiles(current)) return imported` 这一行**不动**——图像配置为初始默认时整体采用导入（含其优化器配置），符合「全新安装整体替换」语义。

在非 fresh 分支（即 `return normalizeSettings({ ...current, profiles, activeProfileId: current.activeProfileId })` 之前），插入优化器配置的独立合并：

```ts
  let mergedOptimizerProfiles: PromptOptimizerProfile[]
  let mergedActiveOptimizerProfileId: string
  if (hasOnlyDefaultOptimizerProfiles(current)) {
    mergedOptimizerProfiles = imported.optimizerProfiles
    mergedActiveOptimizerProfileId = imported.activeOptimizerProfileId
  } else {
    const usedOptimizerIds = new Set(current.optimizerProfiles.map((p) => p.id))
    const existingOptimizerKeys = new Set(current.optimizerProfiles.map(getOptimizerProfileDedupKey))
    const importedOptimizerProfiles = imported.optimizerProfiles
      .filter((p) => !existingOptimizerKeys.has(getOptimizerProfileDedupKey(p)))
      .map((p) => ({ ...p, id: createImportedOptimizerProfileId(usedOptimizerIds) }))
    mergedOptimizerProfiles = [...current.optimizerProfiles, ...importedOptimizerProfiles]
    mergedActiveOptimizerProfileId = current.activeOptimizerProfileId
  }
```

并把该分支最后的 return 从：

```ts
  return normalizeSettings({
    ...current,
    profiles,
    activeProfileId: current.activeProfileId,
  })
```

改为：

```ts
  return normalizeSettings({
    ...current,
    profiles,
    activeProfileId: current.activeProfileId,
    optimizerProfiles: mergedOptimizerProfiles,
    activeOptimizerProfileId: mergedActiveOptimizerProfileId,
  })
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/api/apiProfiles.test.ts`
Expected: PASS

- [ ] **Step 5: 类型检查 + lint**

Run: `npx tsc -b && npm run lint`
Expected: 无报错

- [ ] **Step 6: 提交**

```bash
git add src/lib/api/apiProfiles.ts src/lib/api/apiProfiles.test.ts
git commit -m "feat(optimizer): 导入合并支持优化器多配置（去重追加 / fresh 整体采用）"
```

---

## Task 3: 导出脱敏（redactSettingsForExport）

**Files:**
- Modify: `src/lib/exportImport.ts`
- Test: `src/lib/exportImport.test.ts`

- [ ] **Step 1: 写失败测试**

在 `exportImport.test.ts` 既有 redact 测试（含 `expect(redacted.promptOptimizer.apiKey).toBe('')` 那条 `it`）中，给传入的 settings 增加 `optimizerProfiles`，并追加断言。把该 `it` 中构造 settings 的对象里的 `promptOptimizer` 块替换为：

```ts
      promptOptimizer: {
        ...DEFAULT_SETTINGS.promptOptimizer,
        apiKey: 'optimizer-secret',
      },
      optimizerProfiles: [
        {
          ...DEFAULT_SETTINGS.optimizerProfiles[0],
          apiKey: 'optimizer-profile-secret',
        },
      ],
```

并在该 `it` 末尾追加断言：

```ts
    expect(JSON.stringify(redacted)).not.toContain('optimizer-profile-secret')
    expect(redacted.optimizerProfiles.every((p) => p.apiKey === '')).toBe(true)
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/exportImport.test.ts`
Expected: FAIL（`optimizer-profile-secret` 仍出现在导出 JSON 中）

- [ ] **Step 3: 实现（exportImport.ts）**

在 `redactSettingsForExport` 的 return 对象中，`promptOptimizer: { ...normalized.promptOptimizer, apiKey: '' }` 之后追加：

```ts
    optimizerProfiles: normalized.optimizerProfiles.map((profile) => ({
      ...profile,
      apiKey: '',
    })),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/exportImport.test.ts`
Expected: PASS

- [ ] **Step 5: 全量测试 + 类型检查 + lint**

Run: `npm run test && npx tsc -b && npm run lint`
Expected: 全绿

- [ ] **Step 6: 提交**

```bash
git add src/lib/exportImport.ts src/lib/exportImport.test.ts
git commit -m "feat(optimizer): 导出脱敏覆盖每个优化器配置的 apiKey"
```

---

## Task 4: OptimizerProfileSelector 组件

**Files:**
- Create: `src/components/SettingsModal/OptimizerProfileSelector.tsx`

> 本项目无 React 组件测试框架，本任务以类型检查 + lint + 后续手动冒烟验证。

- [ ] **Step 1: 新建组件文件**

写入 `src/components/SettingsModal/OptimizerProfileSelector.tsx`（结构对齐 `ProfileSelector`，去掉服务商徽标）：

```tsx
import type { PromptOptimizerProfile } from '../../types'

export interface OptimizerProfileSelectorProps {
  profiles: PromptOptimizerProfile[]
  activeProfileId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
}

export function OptimizerProfileSelector({
  profiles,
  activeProfileId,
  open,
  onOpenChange,
  onSelect,
  onCreate,
  onDelete,
}: OptimizerProfileSelectorProps) {
  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0]

  return (
    <div className="relative w-44 sm:w-48">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:hover:bg-white/[0.06]"
        title={activeProfile?.name}
      >
        <span className="min-w-0 truncate">{activeProfile?.name}</span>
        <svg className={`w-3.5 h-3.5 flex-shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => onOpenChange(false)} />
          <div className="absolute right-0 top-full z-50 mt-1.5 max-h-60 w-full overflow-hidden overflow-y-auto rounded-xl border border-gray-200/60 bg-white/95 py-1 shadow-[0_8px_30px_rgb(0,0,0,0.12)] ring-1 ring-black/5 backdrop-blur-xl animate-dropdown-down dark:border-white/[0.08] dark:bg-gray-900/95 dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] dark:ring-white/10 custom-scrollbar">
            <button
              type="button"
              onClick={onCreate}
              className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10"
            >
              <span className="truncate">创建新配置</span>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </span>
            </button>
            <div>
              {profiles.map((profile) => (
                <div
                  key={profile.id}
                  title={profile.name}
                  className={`group flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-xs transition-colors ${profile.id === activeProfileId ? 'bg-blue-50 font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-400' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.06]'}`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(profile.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 pr-2"
                  >
                    <span className="min-w-0 truncate">{profile.name}</span>
                  </button>

                  {profiles.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(profile.id)
                      }}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 opacity-60 transition-all hover:bg-red-50 hover:text-red-500 hover:opacity-100 dark:hover:bg-red-500/10"
                      aria-label="删除配置"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 类型检查 + lint**

Run: `npx tsc -b && npm run lint`
Expected: 无报错（注意：组件此时尚未被引用，lint 不应因此报错；如有 `unused` 警告，将在 Task 6 引用后消除——本步只验证文件本身合法）

- [ ] **Step 3: 提交**

```bash
git add src/components/SettingsModal/OptimizerProfileSelector.tsx
git commit -m "feat(optimizer): 新增 OptimizerProfileSelector(无服务商徽标)"
```

---

## Task 5: OptimizerSection 改造（接收激活配置 + 配置名称）

> 本任务与 Task 6 互相依赖（props 改动会导致父组件类型不通过），两者改动在 **Task 6 末一并验证并合并为一次提交**。本任务只做 OptimizerSection 文件内编辑，不单独跑 `tsc -b`、不单独提交。

**Files:**
- Modify: `src/components/SettingsModal/OptimizerSection.tsx`

- [ ] **Step 1: 改 props 类型与 import**

把顶部 `import type { AppSettings, OpenAIProfile } from '../../types'` 改为：

```ts
import type { OpenAIProfile, PromptOptimizerProfile } from '../../types'
```

把 `OptimizerSectionProps` 接口中的：

```ts
  optimizer: AppSettings['promptOptimizer']
  onUpdate: (patch: Partial<AppSettings['promptOptimizer']>) => void
```

改为：

```ts
  optimizer: PromptOptimizerProfile
  onUpdate: (patch: Partial<PromptOptimizerProfile>) => void
```

- [ ] **Step 2: 模型列表缓存随配置切换而清空**

把重置缓存的 `useEffect` 依赖数组从：

```ts
  }, [optimizer.baseUrl, optimizer.apiKey])
```

改为：

```ts
  }, [optimizer.id, optimizer.baseUrl, optimizer.apiKey])
```

- [ ] **Step 3: 加「配置名称」输入框**

在 `return (<div className="space-y-4">` 之后、第一个「API URL」`<label>` 之前，插入：

```tsx
      <label className="block">
        <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">配置名称</span>
        <input
          value={optimizer.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          type="text"
          className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
        />
      </label>
```

- [ ] **Step 4: 单文件 lint**

Run: `npx eslint src/components/SettingsModal/OptimizerSection.tsx`
Expected: 无报错（完整 `tsc -b` 与提交在 Task 6 末进行）

---

## Task 6: SettingsModal/index.tsx 接线（配置 CRUD + 选择器 + timeout）

**Files:**
- Modify: `src/components/SettingsModal/index.tsx`

- [ ] **Step 1: 补 import**

把从 `apiProfiles` 的 import 块补上 `createDefaultOptimizerProfile`、`DEFAULT_OPTIMIZER_PROFILE_ID`、`getActiveOptimizerProfile`、`normalizeOptimizerProfile`：

```ts
import {
  createDefaultOpenAIProfile,
  createDefaultOptimizerProfile,
  DEFAULT_OPENAI_PROFILE_ID,
  DEFAULT_OPTIMIZER_PROFILE_ID,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_SETTINGS,
  getActiveApiProfile,
  getActiveOptimizerProfile,
  normalizeOptimizerProfile,
  normalizeSettings,
} from '../../lib/api/apiProfiles'
```

> 移除已不再使用的 `normalizePromptOptimizer` 导入（若 lint 报未使用）。

把 `import type { ApiProfile, AppSettings } from '../../types'` 改为：

```ts
import type { ApiProfile, AppSettings, PromptOptimizerProfile } from '../../types'
```

新增组件 import：

```ts
import { OptimizerProfileSelector } from './OptimizerProfileSelector'
```

- [ ] **Step 2: 新增 state 与派生激活配置**

把 `optimizerTimeoutInput` 初始化改为读激活优化器配置：

```ts
  const [optimizerTimeoutInput, setOptimizerTimeoutInput] = useState(
    String(getActiveOptimizerProfile(settings).timeout),
  )
  const [showOptimizerProfileMenu, setShowOptimizerProfileMenu] = useState(false)
```

在 `const activeProfile = ...` 行之后新增：

```ts
  const activeOptimizerProfile =
    draft.optimizerProfiles.find((profile) => profile.id === draft.activeOptimizerProfileId) ??
    draft.optimizerProfiles[0]
```

- [ ] **Step 3: 改 buildFlushedDraft 的优化器 timeout 折叠**

把 `buildFlushedDraft` 中处理优化器 timeout 的整段：

```ts
    const optimizerTimeoutRaw = Number(optimizerTimeoutInput)
    const normalizedOptimizerTimeout =
      optimizerTimeoutInput.trim() === '' || Number.isNaN(optimizerTimeoutRaw) || optimizerTimeoutRaw <= 0
        ? next.promptOptimizer.timeout
        : optimizerTimeoutRaw
    if (normalizedOptimizerTimeout !== next.promptOptimizer.timeout) {
      next = {
        ...next,
        promptOptimizer: { ...next.promptOptimizer, timeout: normalizedOptimizerTimeout },
      }
    }
```

替换为：

```ts
    const optimizerTimeoutRaw = Number(optimizerTimeoutInput)
    const normalizedOptimizerTimeout =
      optimizerTimeoutInput.trim() === '' || Number.isNaN(optimizerTimeoutRaw) || optimizerTimeoutRaw <= 0
        ? activeOptimizerProfile.timeout
        : optimizerTimeoutRaw
    if (normalizedOptimizerTimeout !== activeOptimizerProfile.timeout) {
      next = {
        ...next,
        optimizerProfiles: next.optimizerProfiles.map((profile) =>
          profile.id === activeOptimizerProfile.id
            ? { ...profile, timeout: normalizedOptimizerTimeout }
            : profile,
        ),
      }
    }
```

并把 `buildFlushedDraft` 的依赖数组从：

```ts
  }, [draft, activeProfile.id, activeProfile.timeout, timeoutInput, optimizerTimeoutInput])
```

改为：

```ts
  }, [draft, activeProfile.id, activeProfile.timeout, activeOptimizerProfile.id, activeOptimizerProfile.timeout, timeoutInput, optimizerTimeoutInput])
```

- [ ] **Step 4: 打开面板 / reset / import / clear 处的 optimizer timeout 取值**

把以下 4 处的 `setOptimizerTimeoutInput(String(... .promptOptimizer.timeout))` 全部改为读激活优化器配置：

- 打开面板 useEffect 内 `setOptimizerTimeoutInput(String(nextDraft.promptOptimizer.timeout))`
- `resetDraft` 内 `setOptimizerTimeoutInput(String(fresh.promptOptimizer.timeout))`
- `runImport` 内 `setOptimizerTimeoutInput(String(nextDraft.promptOptimizer.timeout))`
- `handleClearAllData` 内 `setOptimizerTimeoutInput(String(nextDraft.promptOptimizer.timeout))`

分别改为（对应变量名 `nextDraft` / `fresh`）：

```ts
    setOptimizerTimeoutInput(String(getActiveOptimizerProfile(nextDraft).timeout))
```
```ts
    setOptimizerTimeoutInput(String(getActiveOptimizerProfile(fresh).timeout))
```

- [ ] **Step 5: 新增「切换激活优化器配置时重置 timeout 输入框」effect**

在已有的 `useEffect(() => { setTimeoutInput(String(activeProfile.timeout)) }, [activeProfile.id, activeProfile.timeout])` 之后新增：

```ts
  useEffect(() => {
    setOptimizerTimeoutInput(String(activeOptimizerProfile.timeout))
  }, [activeOptimizerProfile.id, activeOptimizerProfile.timeout])
```

- [ ] **Step 6: 改 commitSettings 的优化器归一化**

把 `commitSettings` 中这一段：

```ts
    const fallbackProfile = createDefaultOpenAIProfile({ id: newId('openai') })
    const normalizedOptimizer = normalizePromptOptimizer({
      ...nextDraft.promptOptimizer,
      baseUrl: nextDraft.promptOptimizer.baseUrl.trim(),
      apiKey: nextDraft.promptOptimizer.apiKey.trim(),
      model: nextDraft.promptOptimizer.model.trim(),
    })
    const normalizedDraft = normalizeSettings({
      ...nextDraft,
      profiles: normalizedProfiles.length ? normalizedProfiles : [fallbackProfile],
      activeProfileId: normalizedProfiles.some((profile) => profile.id === nextDraft.activeProfileId)
        ? nextDraft.activeProfileId
        : (normalizedProfiles[0]?.id ?? fallbackProfile.id),
      promptOptimizer: normalizedOptimizer,
    })
    setDraft(normalizedDraft)
    setOptimizerTimeoutInput(String(normalizedDraft.promptOptimizer.timeout))
    setSettings(normalizedDraft)
```

替换为：

```ts
    const fallbackProfile = createDefaultOpenAIProfile({ id: newId('openai') })
    const normalizedOptimizerProfiles: PromptOptimizerProfile[] = nextDraft.optimizerProfiles.map((profile) =>
      normalizeOptimizerProfile({
        ...profile,
        name: profile.name.trim() || (profile.id === DEFAULT_OPTIMIZER_PROFILE_ID ? '默认' : '新配置'),
        baseUrl: profile.baseUrl.trim(),
        apiKey: profile.apiKey.trim(),
        model: profile.model.trim(),
      }),
    )
    const fallbackOptimizer = createDefaultOptimizerProfile({ id: newId('optimizer') })
    const optimizerProfiles = normalizedOptimizerProfiles.length
      ? normalizedOptimizerProfiles
      : [fallbackOptimizer]
    const normalizedDraft = normalizeSettings({
      ...nextDraft,
      profiles: normalizedProfiles.length ? normalizedProfiles : [fallbackProfile],
      activeProfileId: normalizedProfiles.some((profile) => profile.id === nextDraft.activeProfileId)
        ? nextDraft.activeProfileId
        : (normalizedProfiles[0]?.id ?? fallbackProfile.id),
      optimizerProfiles,
      activeOptimizerProfileId: optimizerProfiles.some((profile) => profile.id === nextDraft.activeOptimizerProfileId)
        ? nextDraft.activeOptimizerProfileId
        : (optimizerProfiles[0]?.id ?? fallbackOptimizer.id),
    })
    setDraft(normalizedDraft)
    setOptimizerTimeoutInput(String(getActiveOptimizerProfile(normalizedDraft).timeout))
    setSettings(normalizedDraft)
```

- [ ] **Step 7: updatePromptOptimizer → updateActiveOptimizerProfile**

把：

```ts
  const updatePromptOptimizer = (patch: Partial<AppSettings['promptOptimizer']>) => {
    setDraft((prev) => ({
      ...prev,
      promptOptimizer: { ...prev.promptOptimizer, ...patch },
    }))
  }
```

替换为：

```ts
  const updateActiveOptimizerProfile = (patch: Partial<PromptOptimizerProfile>) => {
    setDraft((prev) => ({
      ...prev,
      optimizerProfiles: prev.optimizerProfiles.map((profile) =>
        profile.id === activeOptimizerProfile.id ? { ...profile, ...patch } : profile,
      ),
    }))
  }
```

- [ ] **Step 8: 新增优化器配置 CRUD**

在已有的 `deleteProfile` 函数之后新增：

```ts
  const createOptimizerProfile = () => {
    const profile = createDefaultOptimizerProfile({ id: newId('optimizer'), name: '新配置' })
    setDraft(normalizeSettings({
      ...draft,
      optimizerProfiles: [...draft.optimizerProfiles, profile],
      activeOptimizerProfileId: profile.id,
    }))
    setShowOptimizerProfileMenu(false)
  }

  const switchOptimizerProfile = (id: string) => {
    setDraft(normalizeSettings({ ...draft, activeOptimizerProfileId: id }))
    setShowOptimizerProfileMenu(false)
  }

  const deleteOptimizerProfile = (id: string) => {
    if (draft.optimizerProfiles.length <= 1) return
    const nextProfiles = draft.optimizerProfiles.filter((item) => item.id !== id)
    setDraft(normalizeSettings({
      ...draft,
      optimizerProfiles: nextProfiles,
      activeOptimizerProfileId:
        draft.activeOptimizerProfileId === id ? nextProfiles[0].id : draft.activeOptimizerProfileId,
    }))
  }
```

- [ ] **Step 9: 改「提示词优化 API」section 的 JSX**

把：

```tsx
          <section className="rounded-2xl bg-gray-50/40 dark:bg-white/[0.02] p-5">
            <h4 className="mb-4 text-base font-semibold text-gray-800 dark:text-gray-200">
              提示词优化 API
            </h4>
            <OptimizerSection
              optimizer={draft.promptOptimizer}
              onUpdate={updatePromptOptimizer}
              timeoutInput={optimizerTimeoutInput}
              onTimeoutChange={setOptimizerTimeoutInput}
            />
          </section>
```

替换为：

```tsx
          <section className="rounded-2xl bg-gray-50/40 dark:bg-white/[0.02] p-5">
            <div className="mb-4 flex items-center justify-between gap-3 relative">
              <h4 className="text-base font-semibold text-gray-800 dark:text-gray-200">
                提示词优化 API
              </h4>
              <OptimizerProfileSelector
                profiles={draft.optimizerProfiles}
                activeProfileId={draft.activeOptimizerProfileId}
                open={showOptimizerProfileMenu}
                onOpenChange={setShowOptimizerProfileMenu}
                onSelect={switchOptimizerProfile}
                onCreate={createOptimizerProfile}
                onDelete={(id) => setConfirmDialog({
                  title: '删除配置',
                  message: `确定要删除配置「${draft.optimizerProfiles.find((p) => p.id === id)?.name ?? id}」吗？`,
                  action: () => deleteOptimizerProfile(id),
                })}
              />
            </div>
            <OptimizerSection
              optimizer={activeOptimizerProfile}
              onUpdate={updateActiveOptimizerProfile}
              timeoutInput={optimizerTimeoutInput}
              onTimeoutChange={setOptimizerTimeoutInput}
            />
          </section>
```

- [ ] **Step 10: 类型检查 + lint + 全量测试**

Run: `npx tsc -b && npm run lint && npm run test`
Expected: 全绿（含 Task 5 的改动此时整体编译通过）

- [ ] **Step 11: 提交（含 Task 5 的 OptimizerSection 改动）**

```bash
git add src/components/SettingsModal/index.tsx src/components/SettingsModal/OptimizerSection.tsx
git commit -m "feat(optimizer): 设置面板接线优化器多配置(选择器/CRUD/timeout 切换 + OptimizerSection 配置名称)"
```

---

## Task 7: 完整构建 + 手动冒烟验证

**Files:** 无（验证任务）

- [ ] **Step 1: 完整构建**

Run: `npm run build`
Expected: 构建成功无报错

- [ ] **Step 2: 启动 dev 手动冒烟**

Run: `npm run dev`，浏览器打开设置面板「提示词优化 API」区块，逐项核对：

1. 顶部出现配置选择器；默认显示「默认」配置。
2. 「创建新配置」→ 新增「新配置」并切为激活；表单显示其（默认）值。
3. 编辑 API URL / Key / 模型 / 超时 / 系统提示词 / 配置名称 → 顶部选择器名称随「配置名称」变化；保存按钮变为可用（dirty）。
4. 在两个配置间切换 → 表单与超时输入框正确切换；切换不丢未保存编辑（仍 dirty）。
5. 仅剩 1 个配置时删除按钮隐藏；≥2 个时删除弹确认框，删除后激活切到剩余项。
6. 保存 → 重新打开设置，配置与激活项持久化正确。
7. 打开提示词优化弹窗（InputBar 的优化按钮）→ 使用**当前激活**优化器配置发起优化；激活配置 apiKey 为空时按钮禁用 / 运行时报「未配置 API Key」。
8. 导出数据 → 解压 manifest.json，确认每个 optimizerProfiles[].apiKey 与 promptOptimizer.apiKey 均为空。
9. 导入含多优化器配置的备份 → 配置正确合并（去重 / 追加）。

- [ ] **Step 3: 收尾确认**

Run: `npm run test && npm run lint`
Expected: 全绿。若冒烟发现问题，回到对应 Task 修复后重跑。

---

## 完成定义（Definition of Done）

- 优化器支持多个命名配置：新建 / 切换 / 删除 / 重命名，激活项持久化。
- 老用户单配置无感迁移为「默认」配置。
- 导出脱敏覆盖所有优化器配置；导入按去重规则合并。
- 两个消费方（Modal / InputBar）行为不变，始终使用激活配置。
- `npm run test` / `npm run lint` / `npm run build` 全绿。
