# 图生文 / 反推提示词 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 上传/选中一张图片 → 调用支持 vision 的 chat 模型反推出文生图英文提示词，弹窗对比后「替换 / 追加」到提示词框。

**Architecture:** 反推获得一套**独立的多配置系统**，与优化器同构但数据解耦（`captionerProfiles[]` + `activeCaptionerProfileId` + `captioner` 派生镜像）。数据层平行克隆优化器实现；UI 选择器泛化为共用的 `NamedProfileSelector`；反推 API 复用 chat completions 流式骨架并加 vision 消息体；入口 = 右键菜单 + 底栏上传；结果弹窗仿 `PromptOptimizerModal`。

**Tech Stack:** TypeScript、React 19、Zustand、Vitest、Tailwind。

设计依据：`docs/superpowers/specs/2026-05-25-vision-captioning-design.md`

**通用命令：**
- 单文件测试：`npx vitest run <path>`
- 全量测试：`npm run test`
- Lint：`npm run lint`（0 errors 即通过；既有 warnings 容忍）
- 单文件 lint：`npx eslint <path>`
- 类型检查：`npx tsc -b`
- 完整构建：`npm run build`

**关键既有参照（实现时可读）：**
- `src/lib/api/apiProfiles.ts` 中优化器那套：`createDefaultPromptOptimizer` / `normalizePromptOptimizer` / `createDefaultOptimizerProfile` / `normalizeOptimizerProfile` / `getActiveOptimizerProfile` / `normalizeSettings` 的优化器块 / `mergeImportedSettings` 的优化器合并 / `redactSettingsForExport`。captioner 全部平行克隆。
- `src/lib/api/optimizePromptApi.ts`（反推 API 模板）、`src/lib/api/optimizePromptApi.test.ts`（测试模板）。
- `src/components/PromptOptimizerModal.tsx`（反推 modal 模板）。
- `src/components/SettingsModal/OptimizerSection.tsx`（CaptionerSection 模板）、`OptimizerProfileSelector.tsx`（泛化来源）、`SettingsModal/index.tsx`（接线模板）。

---

## Task 1: 数据层 — 类型 + 归一化/迁移（captioner）

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/api/apiProfiles.ts`
- Test: `src/lib/api/apiProfiles.test.ts`

- [ ] **Step 1: 加类型（types.ts）**

在 `PromptOptimizerProfile` 接口之后新增：

```ts
/** 反推提示词 API 的独立配置（OpenAI 兼容 chat completions + vision） */
export interface CaptionerConfig {
  baseUrl: string
  apiKey: string
  model: string
  /** 秒 */
  timeout: number
  /** 用户可自定义的反推系统提示词 */
  systemPrompt: string
}

/** 反推提示词的命名配置（多配置切换用） */
export interface CaptionerProfile extends CaptionerConfig {
  id: string
  name: string
}
```

在 `AppSettings` 中，`activeOptimizerProfileId: string` 行之后新增三行：

```ts
  /** 派生镜像：当前激活的反推配置 */
  captioner: CaptionerConfig
  captionerProfiles: CaptionerProfile[]
  activeCaptionerProfileId: string
```

- [ ] **Step 2: 写失败测试（apiProfiles.test.ts）**

在文件顶部从 `./apiProfiles` 的 import 中补上 `createDefaultCaptionerProfile`, `getActiveCaptionerProfile`, `DEFAULT_CAPTIONER_PROFILE_ID`, `DEFAULT_CAPTIONER_TIMEOUT`。在文件末尾追加：

```ts
describe('captioner profiles 归一化与迁移', () => {
  it('老数据（只有 captioner，无 captionerProfiles）迁移为单个默认配置', () => {
    const result = normalizeSettings({
      captioner: {
        baseUrl: 'https://cap.example.com/v1',
        apiKey: 'sk-cap',
        model: 'gpt-4o',
        timeout: 50,
        systemPrompt: '反推系统提示词',
      },
    })
    expect(result.captionerProfiles).toHaveLength(1)
    expect(result.captionerProfiles[0]).toMatchObject({
      id: DEFAULT_CAPTIONER_PROFILE_ID,
      name: '默认',
      baseUrl: 'https://cap.example.com/v1',
      apiKey: 'sk-cap',
      model: 'gpt-4o',
      timeout: 50,
      systemPrompt: '反推系统提示词',
    })
    expect(result.activeCaptionerProfileId).toBe(DEFAULT_CAPTIONER_PROFILE_ID)
    expect(result.captioner).toEqual({
      baseUrl: 'https://cap.example.com/v1',
      apiKey: 'sk-cap',
      model: 'gpt-4o',
      timeout: 50,
      systemPrompt: '反推系统提示词',
    })
  })

  it('多个 captionerProfiles：activeCaptionerProfileId 命中时镜像派生该项', () => {
    const result = normalizeSettings({
      captionerProfiles: [
        { id: 'a', name: 'A', baseUrl: 'https://a/v1', apiKey: 'ka', model: 'ma', timeout: 30, systemPrompt: 'sa' },
        { id: 'b', name: 'B', baseUrl: 'https://b/v1', apiKey: 'kb', model: 'mb', timeout: 60, systemPrompt: 'sb' },
      ],
      activeCaptionerProfileId: 'b',
    })
    expect(result.captionerProfiles).toHaveLength(2)
    expect(result.activeCaptionerProfileId).toBe('b')
    expect(result.captioner.apiKey).toBe('kb')
    expect(result.captioner.model).toBe('mb')
  })

  it('activeCaptionerProfileId 失效时兜底回第一个', () => {
    const result = normalizeSettings({
      captionerProfiles: [
        { id: 'a', name: 'A', baseUrl: 'https://a/v1', apiKey: 'ka', model: 'ma', timeout: 30, systemPrompt: 'sa' },
      ],
      activeCaptionerProfileId: 'nope',
    })
    expect(result.activeCaptionerProfileId).toBe('a')
    expect(result.captioner.apiKey).toBe('ka')
  })

  it('DEFAULT_SETTINGS 带一个默认反推配置', () => {
    expect(DEFAULT_SETTINGS.captionerProfiles).toHaveLength(1)
    expect(DEFAULT_SETTINGS.activeCaptionerProfileId).toBe(DEFAULT_CAPTIONER_PROFILE_ID)
    expect(DEFAULT_SETTINGS.captionerProfiles[0].apiKey).toBe('')
  })

  it('createDefaultCaptionerProfile 可被 overrides 覆盖', () => {
    const p = createDefaultCaptionerProfile({ id: 'x', name: '新配置' })
    expect(p.id).toBe('x')
    expect(p.name).toBe('新配置')
    expect(p.timeout).toBe(DEFAULT_CAPTIONER_TIMEOUT)
  })

  it('getActiveCaptionerProfile 返回激活配置', () => {
    const active = getActiveCaptionerProfile({
      captionerProfiles: [
        { id: 'a', name: 'A', baseUrl: 'https://a/v1', apiKey: 'ka', model: 'ma', timeout: 30, systemPrompt: 'sa' },
        { id: 'b', name: 'B', baseUrl: 'https://b/v1', apiKey: 'kb', model: 'mb', timeout: 60, systemPrompt: 'sb' },
      ],
      activeCaptionerProfileId: 'b',
    })
    expect(active.id).toBe('b')
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run src/lib/api/apiProfiles.test.ts`
Expected: FAIL（缺导出 + 缺字段）

- [ ] **Step 4: 实现（apiProfiles.ts）**

在优化器常量附近（`DEFAULT_OPTIMIZER_PROFILE_ID` 一带）新增：

```ts
export const DEFAULT_CAPTIONER_MODEL = 'gpt-4o-mini'
export const DEFAULT_CAPTIONER_TIMEOUT = 60
export const DEFAULT_CAPTIONER_PROFILE_ID = 'default-captioner'
export const DEFAULT_CAPTIONER_SYSTEM_PROMPT = `You are an expert at reverse-engineering image-generation prompts from images.

Look at the provided image and write a single, vivid, structured English prompt that could recreate it with a state-of-the-art image model (GPT Image, DALL·E, Midjourney, Stable Diffusion).

Guidelines:
- Output ONLY the prompt. No preface, no quotes, no commentary, no markdown.
- Describe the main subject, composition, lighting, color palette, materials/textures, mood, and art style. Include camera/lens cues if it looks like a photo.
- Be concrete and specific; avoid vague adjectives.
- Keep it under ~120 words. One paragraph.`
```

在 `import type { ... } from '../../types'` 补上 `CaptionerConfig, CaptionerProfile`。

在优化器的 `normalizePromptOptimizer` / `createDefaultOptimizerProfile` / `normalizeOptimizerProfile` / `getActiveOptimizerProfile` 之后，新增 captioner 平行实现：

```ts
export function createDefaultCaptioner(overrides: Partial<CaptionerConfig> = {}): CaptionerConfig {
  return {
    baseUrl: DEFAULT_BASE_URL,
    apiKey: '',
    model: DEFAULT_CAPTIONER_MODEL,
    timeout: DEFAULT_CAPTIONER_TIMEOUT,
    systemPrompt: DEFAULT_CAPTIONER_SYSTEM_PROMPT,
    ...overrides,
  }
}

export function normalizeCaptioner(input: unknown): CaptionerConfig {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const defaults = createDefaultCaptioner()
  return {
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : defaults.baseUrl,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : defaults.apiKey,
    model: typeof record.model === 'string' && record.model.trim() ? record.model : defaults.model,
    timeout:
      typeof record.timeout === 'number' && Number.isFinite(record.timeout) && record.timeout > 0
        ? record.timeout
        : defaults.timeout,
    systemPrompt:
      typeof record.systemPrompt === 'string' && record.systemPrompt.trim()
        ? record.systemPrompt
        : defaults.systemPrompt,
  }
}

export function createDefaultCaptionerProfile(
  overrides: Partial<CaptionerProfile> = {},
): CaptionerProfile {
  return {
    id: DEFAULT_CAPTIONER_PROFILE_ID,
    name: '默认',
    ...createDefaultCaptioner(),
    ...overrides,
  }
}

export function normalizeCaptionerProfile(input: unknown): CaptionerProfile {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const config = normalizeCaptioner(record)
  const id =
    typeof record.id === 'string' && record.id.trim()
      ? record.id
      : `captioner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const name = typeof record.name === 'string' && record.name.trim() ? record.name : '新配置'
  return { ...config, id, name }
}

/**
 * 仅用于初始化场景（如打开设置面板时一次性读取激活配置）。
 * 消费方在渲染路径上应直接读 `settings.captioner` 镜像，不要在循环/选择器里调用此函数。
 */
export function getActiveCaptionerProfile(
  settings: Partial<AppSettings> | unknown,
): CaptionerProfile {
  const normalized = normalizeSettings(settings)
  return (
    normalized.captionerProfiles.find((p) => p.id === normalized.activeCaptionerProfileId) ??
    normalized.captionerProfiles[0]
  )
}
```

在 `normalizeSettings` 内、优化器块之后（紧挨 `return {` 之前）插入 captioner 块：

```ts
  const rawCaptionerProfiles = Array.isArray(record.captionerProfiles)
    ? (record.captionerProfiles as unknown[])
    : []
  const captionerProfiles = rawCaptionerProfiles.length
    ? rawCaptionerProfiles.map((p) => normalizeCaptionerProfile(p))
    : [
        createDefaultCaptionerProfile({
          ...normalizeCaptioner(record.captioner),
          id: DEFAULT_CAPTIONER_PROFILE_ID,
          name: '默认',
        }),
      ]
  const activeCaptionerProfileId =
    typeof record.activeCaptionerProfileId === 'string' &&
    captionerProfiles.some((p) => p.id === record.activeCaptionerProfileId)
      ? record.activeCaptionerProfileId
      : captionerProfiles[0].id
  const activeCaptioner =
    captionerProfiles.find((p) => p.id === activeCaptionerProfileId) ?? captionerProfiles[0]
```

在 `normalizeSettings` 的 `return { ... }` 中，优化器三件套（`promptOptimizer` / `optimizerProfiles` / `activeOptimizerProfileId`）之后追加：

```ts
    captioner: {
      baseUrl: activeCaptioner.baseUrl,
      apiKey: activeCaptioner.apiKey,
      model: activeCaptioner.model,
      timeout: activeCaptioner.timeout,
      systemPrompt: activeCaptioner.systemPrompt,
    },
    captionerProfiles,
    activeCaptionerProfileId,
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/lib/api/apiProfiles.test.ts`
Expected: PASS（含原有用例）

- [ ] **Step 6: 类型检查 + lint**

Run: `npx tsc -b && npm run lint`
Expected: 无报错（0 errors）

- [ ] **Step 7: 提交**

```bash
git add src/types.ts src/lib/api/apiProfiles.ts src/lib/api/apiProfiles.test.ts
git commit -m "feat(captioner): 反推配置类型与归一化/迁移层（多配置 + 激活镜像）"
```

---

## Task 2: 数据层 — 导入合并（captioner）

**Files:**
- Modify: `src/lib/api/apiProfiles.ts`
- Test: `src/lib/api/apiProfiles.test.ts`

- [ ] **Step 1: 写失败测试**

在 Task 1 的 describe 块后追加：

```ts
describe('mergeImportedSettings - captioner profiles', () => {
  it('current 仅默认反推配置时，全量采用导入的反推配置', () => {
    const merged = mergeImportedSettings(DEFAULT_SETTINGS, {
      captionerProfiles: [
        { id: 'imp-a', name: 'Imp A', baseUrl: 'https://a/v1', apiKey: 'ka', model: 'ma', timeout: 30, systemPrompt: 'sa' },
        { id: 'imp-b', name: 'Imp B', baseUrl: 'https://b/v1', apiKey: 'kb', model: 'mb', timeout: 60, systemPrompt: 'sb' },
      ],
      activeCaptionerProfileId: 'imp-b',
    })
    expect(merged.captionerProfiles).toHaveLength(2)
    expect(merged.captionerProfiles.map((p) => p.baseUrl).sort()).toEqual([
      'https://a/v1',
      'https://b/v1',
    ])
    expect(merged.activeCaptionerProfileId).toBe('imp-b')
  })

  it('current 已自定义反推配置时，去重追加导入项并分配新 id，保留 current 激活项', () => {
    const current = normalizeSettings({
      profiles: [
        { id: 'cur-img', name: 'Cur', provider: 'openai', baseUrl: 'https://img/v1', apiKey: 'ik', model: 'gpt-image-2', timeout: 600, apiMode: 'images', codexCli: false, apiProxy: false },
      ],
      activeProfileId: 'cur-img',
      captionerProfiles: [
        { id: 'cur-cap', name: 'Cur Cap', baseUrl: 'https://cur/v1', apiKey: 'ck', model: 'cm', timeout: 30, systemPrompt: 'cs' },
      ],
      activeCaptionerProfileId: 'cur-cap',
    })
    const merged = mergeImportedSettings(current, {
      captionerProfiles: [
        { id: 'dup', name: 'Dup', baseUrl: 'https://cur/v1', apiKey: 'ck', model: 'cm', timeout: 99, systemPrompt: 'x' },
        { id: 'new', name: 'New', baseUrl: 'https://new/v1', apiKey: 'nk', model: 'nm', timeout: 45, systemPrompt: 'ns' },
      ],
      activeCaptionerProfileId: 'new',
    })
    expect(merged.captionerProfiles).toHaveLength(2)
    expect(merged.captionerProfiles.map((p) => p.baseUrl).sort()).toEqual(['https://cur/v1', 'https://new/v1'])
    expect(merged.activeCaptionerProfileId).toBe('cur-cap')
    expect(merged.captionerProfiles.some((p) => p.id === 'new')).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/api/apiProfiles.test.ts`
Expected: FAIL（第二个用例长度仍为 1）

- [ ] **Step 3: 实现（apiProfiles.ts）**

在优化器的 `createImportedOptimizerProfileId` 之后新增 captioner 合并助手：

```ts
function getCaptionerProfileDedupKey(profile: CaptionerProfile): string {
  return JSON.stringify([
    profile.baseUrl.trim().replace(/\/+$/, '').toLowerCase(),
    profile.apiKey.trim(),
    profile.model.trim(),
  ])
}

function dedupeCaptionerProfiles(profiles: CaptionerProfile[]): CaptionerProfile[] {
  const seen = new Set<string>()
  return profiles.filter((profile) => {
    const key = getCaptionerProfileDedupKey(profile)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isDefaultCaptionerProfile(profile: CaptionerProfile): boolean {
  return (
    profile.id === DEFAULT_CAPTIONER_PROFILE_ID &&
    profile.name === '默认' &&
    profile.baseUrl === DEFAULT_BASE_URL &&
    profile.apiKey === '' &&
    profile.model === DEFAULT_CAPTIONER_MODEL &&
    profile.timeout === DEFAULT_CAPTIONER_TIMEOUT &&
    profile.systemPrompt === DEFAULT_CAPTIONER_SYSTEM_PROMPT
  )
}

function hasOnlyDefaultCaptionerProfiles(settings: AppSettings): boolean {
  return (
    settings.captionerProfiles.length === 1 &&
    settings.activeCaptionerProfileId === DEFAULT_CAPTIONER_PROFILE_ID &&
    isDefaultCaptionerProfile(settings.captionerProfiles[0])
  )
}

function createImportedCaptionerProfileId(usedIds: Set<string>): string {
  let id = `captioner-imported-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  while (usedIds.has(id)) {
    id = `captioner-imported-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  }
  usedIds.add(id)
  return id
}
```

在 `mergeImportedSettings` 中，把 `imported` 的构造再加一行 captioner 去重（与现有 `optimizerProfiles: dedupeOptimizerProfiles(...)` 并列）：

```ts
  const imported = normalizeSettings({
    ...normalizedImported,
    profiles: dedupeApiProfiles(normalizedImported.profiles),
    optimizerProfiles: dedupeOptimizerProfiles(normalizedImported.optimizerProfiles),
    captionerProfiles: dedupeCaptionerProfiles(normalizedImported.captionerProfiles),
  })
```

不改 `if (hasOnlyDefaultProfiles(current)) return imported`。在非 fresh 分支，紧挨现有 optimizer 合并块之后插入 captioner 合并块：

```ts
  let mergedCaptionerProfiles: CaptionerProfile[]
  let mergedActiveCaptionerProfileId: string
  if (hasOnlyDefaultCaptionerProfiles(current)) {
    mergedCaptionerProfiles = imported.captionerProfiles
    mergedActiveCaptionerProfileId = imported.activeCaptionerProfileId
  } else {
    const usedCaptionerIds = new Set(current.captionerProfiles.map((p) => p.id))
    const existingCaptionerKeys = new Set(current.captionerProfiles.map(getCaptionerProfileDedupKey))
    const importedCaptionerProfiles = imported.captionerProfiles
      .filter((p) => !existingCaptionerKeys.has(getCaptionerProfileDedupKey(p)))
      .map((p) => ({ ...p, id: createImportedCaptionerProfileId(usedCaptionerIds) }))
    mergedCaptionerProfiles = [...current.captionerProfiles, ...importedCaptionerProfiles]
    mergedActiveCaptionerProfileId = current.activeCaptionerProfileId
  }
```

在该分支末尾的 `return normalizeSettings({ ... })` 里追加两个字段（与现有 optimizer 字段并列）：

```ts
    captionerProfiles: mergedCaptionerProfiles,
    activeCaptionerProfileId: mergedActiveCaptionerProfileId,
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/api/apiProfiles.test.ts`
Expected: PASS

- [ ] **Step 5: 类型检查 + lint**

Run: `npx tsc -b && npm run lint`
Expected: 0 errors

- [ ] **Step 6: 提交**

```bash
git add src/lib/api/apiProfiles.ts src/lib/api/apiProfiles.test.ts
git commit -m "feat(captioner): 导入合并支持反推多配置（去重追加 / fresh 整体采用）"
```

---

## Task 3: 数据层 — 导出脱敏（captioner）

**Files:**
- Modify: `src/lib/exportImport.ts`
- Test: `src/lib/exportImport.test.ts`

- [ ] **Step 1: 扩展 redact 测试**

在 `src/lib/exportImport.test.ts` 既有 redact 测试（含 `optimizerProfiles` 断言那条 `it`）中：

(a) 给构造的 settings 对象在 `optimizerProfiles: [...]` 之后追加：
```ts
      captionerProfiles: [
        {
          ...DEFAULT_SETTINGS.captionerProfiles[0],
          apiKey: 'captioner-profile-secret',
        },
      ],
```
(b) 在该 `it` 末尾追加：
```ts
    expect(JSON.stringify(redacted)).not.toContain('captioner-profile-secret')
    expect(redacted.captionerProfiles.every((p) => p.apiKey === '')).toBe(true)
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/exportImport.test.ts`
Expected: FAIL（`captioner-profile-secret` 仍出现）

- [ ] **Step 3: 实现（exportImport.ts）**

在 `redactSettingsForExport` 返回对象中，`optimizerProfiles: ...` map 之后追加：

```ts
    captioner: {
      ...normalized.captioner,
      apiKey: '',
    },
    captionerProfiles: normalized.captionerProfiles.map((profile) => ({
      ...profile,
      apiKey: '',
    })),
```

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `npx vitest run src/lib/exportImport.test.ts && npm run test`
Expected: 全绿

- [ ] **Step 5: 类型检查 + lint**

Run: `npx tsc -b && npm run lint`
Expected: 0 errors

- [ ] **Step 6: 提交**

```bash
git add src/lib/exportImport.ts src/lib/exportImport.test.ts
git commit -m "feat(captioner): 导出脱敏覆盖反推配置与镜像的 apiKey"
```

---

## Task 4: 反推 API — captionImageStream

**Files:**
- Create: `src/lib/api/captionImageApi.ts`
- Test: `src/lib/api/captionImageApi.test.ts`

模板：`src/lib/api/optimizePromptApi.ts`（复用其 `buildChatCompletionsUrl` / SSE 解析 / 超时 / abort 骨架）。

- [ ] **Step 1: 写失败测试（captionImageApi.test.ts）**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captionImageStream } from './captionImageApi'
import type { CaptionerConfig } from '../../types'

const baseConfig: CaptionerConfig = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-4o-mini',
  timeout: 30,
  systemPrompt: 'You reverse-engineer image prompts.',
}

const IMG = 'data:image/png;base64,iVBORw0KGgo='

function makeSseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
}

function makeSseResponse(chunks: string[], init: ResponseInit = { status: 200 }): Response {
  return new Response(makeSseStream(chunks), init)
}

describe('captionImageStream', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('拼接 SSE delta 为完整文本，并对每个 delta 调用 onDelta', async () => {
    fetchMock.mockResolvedValue(
      makeSseResponse([
        'data: {"choices":[{"delta":{"content":"a "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"cat"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    )
    const deltas: string[] = []
    const result = await captionImageStream(baseConfig, IMG, { onDelta: (c) => deltas.push(c) })
    expect(result).toBe('a cat')
    expect(deltas).toEqual(['a ', 'cat'])
  })

  it('请求 URL 含 /v1/chat/completions，user 消息含 image_url（vision 格式）', async () => {
    fetchMock.mockResolvedValue(makeSseResponse(['data: [DONE]\n\n']))
    await captionImageStream(baseConfig, IMG).catch(() => {})
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(typeof url).toBe('string')
    expect(url).toContain('/v1/chat/completions')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.stream).toBe(true)
    expect(body.messages[0]).toEqual({ role: 'system', content: baseConfig.systemPrompt })
    expect(body.messages[1].role).toBe('user')
    expect(Array.isArray(body.messages[1].content)).toBe(true)
    const imagePart = body.messages[1].content.find((p: { type?: string }) => p.type === 'image_url')
    expect(imagePart).toBeTruthy()
    expect(imagePart.image_url.url).toBe(IMG)
    const textPart = body.messages[1].content.find((p: { type?: string }) => p.type === 'text')
    expect(typeof textPart.text).toBe('string')
  })

  it('未配置 API Key 时直接抛错，不发请求', async () => {
    await expect(captionImageStream({ ...baseConfig, apiKey: '  ' }, IMG)).rejects.toThrow(/API Key/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('未提供图片时直接抛错', async () => {
    await expect(captionImageStream(baseConfig, '  ')).rejects.toThrow(/图片/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('HTTP 非 2xx 抛出包含状态码的错误', async () => {
    fetchMock.mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    await expect(captionImageStream(baseConfig, IMG)).rejects.toThrow(/HTTP 401/)
  })

  it('结果为空（仅 [DONE]）抛错', async () => {
    fetchMock.mockResolvedValue(makeSseResponse(['data: [DONE]\n\n']))
    await expect(captionImageStream(baseConfig, IMG)).rejects.toThrow(/结果为空/)
  })

  it('external signal 中止后抛出取消错误', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation(async (_url, init) => {
      const signal = (init as RequestInit).signal
      return await new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          const err = new Error('aborted') as Error & { name: string }
          err.name = 'AbortError'
          reject(err)
        })
      })
    })
    const pending = captionImageStream(baseConfig, IMG, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow(/已取消/)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/api/captionImageApi.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现（captionImageApi.ts）**

```ts
import type { CaptionerConfig } from '../../types'
import { normalizeBaseUrl } from './devProxy'

export interface CaptionImageOptions {
  /** AbortSignal 用于取消请求 */
  signal?: AbortSignal
  /** 流式追加 token 回调 */
  onDelta?: (chunk: string) => void
}

/** 引导语：放在 user 文本部分，配合 systemPrompt 一起约束输出 */
const USER_GUIDE_TEXT = 'Describe this image as a detailed text-to-image prompt.'

function buildChatCompletionsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) return '/v1/chat/completions'
  return normalized.endsWith('/v1')
    ? `${normalized}/chat/completions`
    : `${normalized}/v1/chat/completions`
}

function parseSseLine(line: string): string | null {
  if (!line.startsWith('data:')) return null
  const payload = line.slice(5).trim()
  if (!payload || payload === '[DONE]') return null
  try {
    const parsed = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: unknown } }>
    }
    const delta = parsed.choices?.[0]?.delta?.content
    return typeof delta === 'string' ? delta : null
  } catch {
    return null
  }
}

/**
 * 对一张图片做反推：通过 OpenAI 兼容 chat completions（vision，stream=true）生成文生图提示词。
 *
 * @param imageDataUrl base64 data URL（如 data:image/png;base64,...）
 * @returns 完整的反推文本
 * @throws 网络 / 鉴权 / 超时 / 服务端错误时抛出可读 Error
 */
export async function captionImageStream(
  config: CaptionerConfig,
  imageDataUrl: string,
  options: CaptionImageOptions = {},
): Promise<string> {
  if (!config.apiKey.trim()) {
    throw new Error('未配置 API Key')
  }
  if (!imageDataUrl.trim()) {
    throw new Error('未选择图片')
  }

  const url = buildChatCompletionsUrl(config.baseUrl)
  const timeoutMs = Math.max(1, config.timeout) * 1000

  const externalSignal = options.signal
  const timeoutController = new AbortController()
  const onExternalAbort = () => timeoutController.abort(externalSignal?.reason)
  if (externalSignal) {
    if (externalSignal.aborted) timeoutController.abort(externalSignal.reason)
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }
  const timeoutTimer = setTimeout(() => timeoutController.abort(new Error('请求超时')), timeoutMs)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey.trim()}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: config.model.trim() || 'gpt-4o-mini',
        stream: true,
        messages: [
          { role: 'system', content: config.systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: USER_GUIDE_TEXT },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
        ],
      }),
      signal: timeoutController.signal,
    })
  } catch (err) {
    clearTimeout(timeoutTimer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
    if (externalSignal?.aborted) throw new Error('已取消')
    if ((err as { name?: string }).name === 'AbortError') throw new Error('请求超时')
    throw new Error(`网络错误：${err instanceof Error ? err.message : String(err)}`)
  }

  if (!response.ok) {
    clearTimeout(timeoutTimer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}${text ? ` - ${text.slice(0, 300)}` : ''}`)
  }

  const body = response.body
  if (!body) {
    clearTimeout(timeoutTimer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
    throw new Error('响应不包含数据流')
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newlineIdx = buffer.indexOf('\n')
      while (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, '')
        buffer = buffer.slice(newlineIdx + 1)
        const delta = parseSseLine(line)
        if (delta) {
          full += delta
          options.onDelta?.(delta)
        }
        newlineIdx = buffer.indexOf('\n')
      }
    }
    if (buffer.trim()) {
      const delta = parseSseLine(buffer.trim())
      if (delta) {
        full += delta
        options.onDelta?.(delta)
      }
    }
  } catch (err) {
    if (externalSignal?.aborted) throw new Error('已取消')
    if ((err as { name?: string }).name === 'AbortError') throw new Error('请求超时')
    throw err
  } finally {
    clearTimeout(timeoutTimer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
    reader.releaseLock()
  }

  const trimmed = full.trim()
  if (!trimmed) throw new Error('反推结果为空')
  return trimmed
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/api/captionImageApi.test.ts`
Expected: PASS

- [ ] **Step 5: 类型检查 + lint**

Run: `npx tsc -b && npm run lint`
Expected: 0 errors

- [ ] **Step 6: 提交**

```bash
git add src/lib/api/captionImageApi.ts src/lib/api/captionImageApi.test.ts
git commit -m "feat(captioner): 新增 captionImageStream（vision chat completions 流式）"
```

---

## Task 5: 通用选择器 NamedProfileSelector（泛化 + 切换优化器）

**Files:**
- Create: `src/components/SettingsModal/NamedProfileSelector.tsx`
- Modify: `src/components/SettingsModal/index.tsx`
- Delete: `src/components/SettingsModal/OptimizerProfileSelector.tsx`

> 无组件测试框架，验证 = tsc + lint + 全量 test（确保优化器选择器替换后仍编译/测试通过）。

- [ ] **Step 1: 新建 NamedProfileSelector.tsx**

内容与现 `OptimizerProfileSelector.tsx` 完全一致，仅把类型从 `PromptOptimizerProfile` 改为内联 `{ id: string; name: string }` 并改名：

```tsx
export interface NamedProfileSelectorProps {
  profiles: { id: string; name: string }[]
  activeProfileId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
}

export function NamedProfileSelector({
  profiles,
  activeProfileId,
  open,
  onOpenChange,
  onSelect,
  onCreate,
  onDelete,
}: NamedProfileSelectorProps) {
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

- [ ] **Step 2: index.tsx 切换优化器到 NamedProfileSelector**

把 `import { OptimizerProfileSelector } from './OptimizerProfileSelector'` 改为 `import { NamedProfileSelector } from './NamedProfileSelector'`。把 JSX 中 `<OptimizerProfileSelector ... />` 标签名改为 `<NamedProfileSelector ... />`（props 不变，`draft.optimizerProfiles` 满足 `{id,name}[]`）。

- [ ] **Step 3: 删除旧组件**

```bash
git rm src/components/SettingsModal/OptimizerProfileSelector.tsx
```

- [ ] **Step 4: 验证**

Run: `npx tsc -b && npm run lint && npm run test`
Expected: 全绿（优化器选择器替换后行为不变）

- [ ] **Step 5: 提交**

```bash
git add src/components/SettingsModal/NamedProfileSelector.tsx src/components/SettingsModal/index.tsx
git commit -m "refactor(settings): 选择器泛化为 NamedProfileSelector,优化器切换复用"
```

---

## Task 6: 反推设置区块 CaptionerSection + 接线设置面板

**Files:**
- Create: `src/components/SettingsModal/CaptionerSection.tsx`
- Modify: `src/components/SettingsModal/index.tsx`

模板：`OptimizerSection.tsx` 与 index.tsx 中优化器的接线。本任务两文件一起验证、一次提交。

- [ ] **Step 1: 新建 CaptionerSection.tsx**

与 `OptimizerSection.tsx` 结构一致，把类型/默认值/文案换成 captioner：

```tsx
import { useEffect, useState, useCallback } from 'react'
import { listModels } from '../../lib/api/listModels'
import {
  DEFAULT_CAPTIONER_SYSTEM_PROMPT,
  DEFAULT_SETTINGS,
} from '../../lib/api/apiProfiles'
import type { CaptionerProfile, OpenAIProfile } from '../../types'
import { ModelListDropdown } from './ModelListDropdown'
import { normalizeTimeout } from './timeout'
import { EyeIcon } from './EyeIcon'

export interface CaptionerSectionProps {
  captioner: CaptionerProfile
  onUpdate: (patch: Partial<CaptionerProfile>) => void
  timeoutInput: string
  onTimeoutChange: (v: string) => void
}

export function CaptionerSection({
  captioner,
  onUpdate,
  timeoutInput,
  onTimeoutChange,
}: CaptionerSectionProps) {
  const [showApiKey, setShowApiKey] = useState(false)
  const [modelListOpen, setModelListOpen] = useState(false)
  const [modelListLoading, setModelListLoading] = useState(false)
  const [modelList, setModelList] = useState<string[] | null>(null)
  const [modelListError, setModelListError] = useState<string | null>(null)

  useEffect(() => {
    setModelListOpen(false)
    setModelList(null)
    setModelListError(null)
  }, [captioner.id, captioner.baseUrl, captioner.apiKey])

  const fetchModelList = useCallback(async () => {
    setModelListOpen(true)
    setModelListLoading(true)
    setModelListError(null)
    try {
      const tempProfile: OpenAIProfile = {
        id: 'captioner-temp',
        name: 'captioner',
        provider: 'openai',
        baseUrl: captioner.baseUrl,
        apiKey: captioner.apiKey,
        model: captioner.model,
        timeout: captioner.timeout,
        apiMode: 'images',
        codexCli: false,
        apiProxy: false,
      }
      const ids = await listModels(tempProfile)
      setModelList(ids)
      if (ids.length === 0) setModelListError('接口返回为空')
    } catch (err) {
      setModelList(null)
      setModelListError(err instanceof Error ? err.message : String(err))
    } finally {
      setModelListLoading(false)
    }
  }, [captioner.baseUrl, captioner.apiKey, captioner.model, captioner.timeout])

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">配置名称</span>
        <input
          value={captioner.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          type="text"
          className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">API URL</span>
        <input
          value={captioner.baseUrl}
          onChange={(e) => onUpdate({ baseUrl: e.target.value })}
          type="text"
          placeholder={DEFAULT_SETTINGS.baseUrl}
          className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
        />
        <div data-selectable-text className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          独立配置，与图像生成 / 提示词优化解耦。需是 OpenAI 兼容、且模型支持图像输入（vision）的 chat completions 接口。
        </div>
      </label>

      <div className="block">
        <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">API Key</span>
        <div className="relative">
          <input
            value={captioner.apiKey}
            onChange={(e) => onUpdate({ apiKey: e.target.value })}
            type={showApiKey ? 'text' : 'password'}
            placeholder="sk-..."
            className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 pr-10 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
          />
          <button
            type="button"
            onClick={() => setShowApiKey((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
            tabIndex={-1}
          >
            <EyeIcon open={showApiKey} />
          </button>
        </div>
      </div>

      <label className="block">
        <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">模型 ID</span>
        <ModelListDropdown
          value={captioner.model}
          onChange={(model) => onUpdate({ model })}
          onFetch={fetchModelList}
          isLoading={modelListLoading}
          isOpen={modelListOpen}
          onOpenChange={setModelListOpen}
          modelList={modelList}
          error={modelListError}
          placeholder="gpt-4o-mini"
        />
        <div data-selectable-text className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          需选择支持图像输入的模型（如 gpt-4o-mini / gpt-4o）。
        </div>
      </label>

      <label className="block">
        <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">请求超时 (秒)</span>
        <input
          value={timeoutInput}
          onChange={(e) => onTimeoutChange(e.target.value)}
          onBlur={() => {
            const normalized = normalizeTimeout(timeoutInput, captioner.timeout)
            onTimeoutChange(String(normalized))
            if (normalized !== captioner.timeout) {
              onUpdate({ timeout: normalized })
            }
          }}
          type="number"
          min={1}
          max={600}
          className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
        />
      </label>

      <div className="block">
        <div className="mb-1 flex items-center justify-between">
          <span className="block text-xs text-gray-500 dark:text-gray-400">系统提示词</span>
          <button
            type="button"
            onClick={() => onUpdate({ systemPrompt: DEFAULT_CAPTIONER_SYSTEM_PROMPT })}
            className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
          >
            重置为默认
          </button>
        </div>
        <textarea
          value={captioner.systemPrompt}
          onChange={(e) => onUpdate({ systemPrompt: e.target.value })}
          rows={6}
          className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50 resize-y font-mono leading-relaxed"
        />
        <div data-selectable-text className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          控制反推风格。默认值会要求模型输出单段结构化英文图像提示词。
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: index.tsx — imports**

从 `apiProfiles` 补 `createDefaultCaptionerProfile`, `DEFAULT_CAPTIONER_PROFILE_ID`, `getActiveCaptionerProfile`, `normalizeCaptionerProfile`。类型 import 补 `CaptionerProfile`。新增 `import { CaptionerSection } from './CaptionerSection'`。

- [ ] **Step 3: index.tsx — state + 派生激活配置**

在 `showOptimizerProfileMenu` state 后新增：
```ts
  const [captionerTimeoutInput, setCaptionerTimeoutInput] = useState(
    String(getActiveCaptionerProfile(settings).timeout),
  )
  const [showCaptionerProfileMenu, setShowCaptionerProfileMenu] = useState(false)
```
在 `activeOptimizerProfile` 派生后新增：
```ts
  const activeCaptionerProfile =
    draft.captionerProfiles.find((profile) => profile.id === draft.activeCaptionerProfileId) ??
    draft.captionerProfiles[0]
```

- [ ] **Step 4: index.tsx — buildFlushedDraft 折叠 captioner timeout**

在 `buildFlushedDraft` 中、优化器 timeout 折叠块之后追加：
```ts
    const captionerTimeoutRaw = Number(captionerTimeoutInput)
    const normalizedCaptionerTimeout =
      captionerTimeoutInput.trim() === '' || Number.isNaN(captionerTimeoutRaw) || captionerTimeoutRaw <= 0
        ? activeCaptionerProfile.timeout
        : captionerTimeoutRaw
    if (normalizedCaptionerTimeout !== activeCaptionerProfile.timeout) {
      next = {
        ...next,
        captionerProfiles: next.captionerProfiles.map((profile) =>
          profile.id === activeCaptionerProfile.id
            ? { ...profile, timeout: normalizedCaptionerTimeout }
            : profile,
        ),
      }
    }
```
依赖数组追加 `activeCaptionerProfile.id, activeCaptionerProfile.timeout, captionerTimeoutInput`。

- [ ] **Step 5: index.tsx — 四处 setCaptionerTimeoutInput**

在每个已有 `setOptimizerTimeoutInput(String(getActiveOptimizerProfile(<draft>).timeout))` 之后并列追加一行（同一 `<draft>` 变量名：打开面板 useEffect 用 `nextDraft`，`resetDraft` 用 `fresh`，`runImport` 用 `nextDraft`，`handleClearAllData` 用 `nextDraft`）：
```ts
    setCaptionerTimeoutInput(String(getActiveCaptionerProfile(<draft>).timeout))
```

- [ ] **Step 6: index.tsx — 切换激活反推配置时重置 timeout 输入框**

在优化器的 `useEffect(() => { setOptimizerTimeoutInput(...) }, [activeOptimizerProfile.id, activeOptimizerProfile.timeout])` 之后新增：
```ts
  useEffect(() => {
    setCaptionerTimeoutInput(String(activeCaptionerProfile.timeout))
  }, [activeCaptionerProfile.id, activeCaptionerProfile.timeout])
```

- [ ] **Step 7: index.tsx — commitSettings 归一化 captioner**

在 `commitSettings` 内、优化器 `optimizerProfiles` 归一化之后，`normalizeSettings({...})` 调用之前，新增：
```ts
    const normalizedCaptionerProfiles: CaptionerProfile[] = nextDraft.captionerProfiles.map((profile) =>
      normalizeCaptionerProfile({
        ...profile,
        name: profile.name.trim() || (profile.id === DEFAULT_CAPTIONER_PROFILE_ID ? '默认' : '新配置'),
        baseUrl: profile.baseUrl.trim(),
        apiKey: profile.apiKey.trim(),
        model: profile.model.trim(),
      }),
    )
    const fallbackCaptioner = createDefaultCaptionerProfile({ id: newId('captioner') })
    const captionerProfiles = normalizedCaptionerProfiles.length
      ? normalizedCaptionerProfiles
      : [fallbackCaptioner]
```
在 `normalizeSettings({...})` 的入参里、优化器字段之后追加：
```ts
      captionerProfiles,
      activeCaptionerProfileId: captionerProfiles.some((profile) => profile.id === nextDraft.activeCaptionerProfileId)
        ? nextDraft.activeCaptionerProfileId
        : (captionerProfiles[0]?.id ?? fallbackCaptioner.id),
```
在 `setOptimizerTimeoutInput(String(getActiveOptimizerProfile(normalizedDraft).timeout))` 之后追加：
```ts
    setCaptionerTimeoutInput(String(getActiveCaptionerProfile(normalizedDraft).timeout))
```

- [ ] **Step 8: index.tsx — updateActiveCaptionerProfile + CRUD**

在 `updateActiveOptimizerProfile` 之后新增：
```ts
  const updateActiveCaptionerProfile = (patch: Partial<CaptionerProfile>) => {
    setDraft((prev) => ({
      ...prev,
      captionerProfiles: prev.captionerProfiles.map((profile) =>
        profile.id === activeCaptionerProfile.id ? { ...profile, ...patch } : profile,
      ),
    }))
  }
```
在优化器 CRUD（`createOptimizerProfile` 等）之后新增：
```ts
  const createCaptionerProfile = () => {
    const profile = createDefaultCaptionerProfile({ id: newId('captioner'), name: '新配置' })
    setDraft(normalizeSettings({
      ...draft,
      captionerProfiles: [...draft.captionerProfiles, profile],
      activeCaptionerProfileId: profile.id,
    }))
    setShowCaptionerProfileMenu(false)
  }

  const switchCaptionerProfile = (id: string) => {
    setDraft(normalizeSettings({ ...draft, activeCaptionerProfileId: id }))
    setShowCaptionerProfileMenu(false)
  }

  const deleteCaptionerProfile = (id: string) => {
    if (draft.captionerProfiles.length <= 1) return
    const nextProfiles = draft.captionerProfiles.filter((item) => item.id !== id)
    setDraft(normalizeSettings({
      ...draft,
      captionerProfiles: nextProfiles,
      activeCaptionerProfileId:
        draft.activeCaptionerProfileId === id ? nextProfiles[0].id : draft.activeCaptionerProfileId,
    }))
  }
```

- [ ] **Step 9: index.tsx — 新增「反推提示词 API」section JSX**

在「提示词优化 API」`<section>` 之后插入：
```tsx
          <section className="rounded-2xl bg-gray-50/40 dark:bg-white/[0.02] p-5">
            <div className="mb-4 flex items-center justify-between gap-3 relative">
              <h4 className="text-base font-semibold text-gray-800 dark:text-gray-200">
                反推提示词 API
              </h4>
              <NamedProfileSelector
                profiles={draft.captionerProfiles}
                activeProfileId={draft.activeCaptionerProfileId}
                open={showCaptionerProfileMenu}
                onOpenChange={setShowCaptionerProfileMenu}
                onSelect={switchCaptionerProfile}
                onCreate={createCaptionerProfile}
                onDelete={(id) => setConfirmDialog({
                  title: '删除配置',
                  message: `确定要删除配置「${draft.captionerProfiles.find((p) => p.id === id)?.name ?? id}」吗？`,
                  action: () => deleteCaptionerProfile(id),
                })}
              />
            </div>
            <CaptionerSection
              captioner={activeCaptionerProfile}
              onUpdate={updateActiveCaptionerProfile}
              timeoutInput={captionerTimeoutInput}
              onTimeoutChange={setCaptionerTimeoutInput}
            />
          </section>
```

- [ ] **Step 10: 验证**

Run: `npx tsc -b && npm run lint && npm run test`
Expected: 全绿

- [ ] **Step 11: 提交**

```bash
git add src/components/SettingsModal/CaptionerSection.tsx src/components/SettingsModal/index.tsx
git commit -m "feat(captioner): 设置面板接线反推多配置(选择器/CRUD/timeout + CaptionerSection)"
```

---

## Task 7: UI 状态 + ImageCaptionModal + 挂载

**Files:**
- Modify: `src/store/slices/ui.ts`
- Create: `src/components/ImageCaptionModal.tsx`
- Modify: `src/App.tsx`

模板：`PromptOptimizerModal.tsx`。

- [ ] **Step 1: ui.ts — captionSource 状态**

在 `UiSlice` 接口中 `setShowPromptOptimizer` 行后新增：
```ts
  /** 反推源图（base64 data URL）；非 null 即打开反推 modal */
  captionSource: string | null
  setCaptionSource: (src: string | null) => void
```
在 slice 实现中 `setShowPromptOptimizer` 实现后新增：
```ts
  captionSource: null,
  setCaptionSource: (captionSource) => set({ captionSource }),
```

- [ ] **Step 2: 新建 ImageCaptionModal.tsx**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { captionImageStream } from '../lib/api/captionImageApi'

type Phase = 'idle' | 'streaming' | 'done' | 'error'

export default function ImageCaptionModal() {
  const captionSource = useStore((s) => s.captionSource)
  const setCaptionSource = useStore((s) => s.setCaptionSource)
  const prompt = useStore((s) => s.prompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const settings = useStore((s) => s.settings)
  const showToast = useStore((s) => s.showToast)

  const [caption, setCaption] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const sourceRef = useRef<string | null>(null)
  sourceRef.current = captionSource
  const configRef = useRef(settings.captioner)
  configRef.current = settings.captioner
  const promptRef = useRef(prompt)
  promptRef.current = prompt

  const runCaption = useCallback(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setCaption('')
    setErrorMessage(null)
    setPhase('streaming')

    const source = sourceRef.current
    if (!source) return
    captionImageStream(configRef.current, source, {
      signal: controller.signal,
      onDelta: (chunk) => setCaption((s) => s + chunk),
    })
      .then(() => {
        if (controller.signal.aborted) return
        setPhase('done')
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setPhase('error')
        setErrorMessage(err instanceof Error ? err.message : String(err))
      })
  }, [])

  useEffect(() => {
    if (!captionSource) return
    runCaption()
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [captionSource, runCaption])

  const handleClose = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setCaptionSource(null)
    setCaption('')
    setPhase('idle')
    setErrorMessage(null)
  }, [setCaptionSource])

  const handleReplace = () => {
    const trimmed = caption.trim()
    if (!trimmed) return
    setPrompt(trimmed)
    showToast('已替换为反推提示词', 'success')
    handleClose()
  }

  const handleAppend = () => {
    const trimmed = caption.trim()
    if (!trimmed) return
    const cur = promptRef.current.trim()
    setPrompt(cur ? `${cur}\n${trimmed}` : trimmed)
    showToast('已追加反推提示词', 'success')
    handleClose()
  }

  useCloseOnEscape(Boolean(captionSource), handleClose)

  if (!captionSource) return null

  const isStreaming = phase === 'streaming'
  const isDone = phase === 'done'
  const isError = phase === 'error'
  const canAdopt = isDone && Boolean(caption.trim())

  return (
    <div data-no-drag-select className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in" onClick={handleClose} />
      <div className="relative z-10 w-full max-w-3xl rounded-3xl border border-white/50 bg-white/95 p-5 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10 overflow-hidden max-h-[85vh] flex flex-col">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            反推提示词
          </h3>
          <button
            onClick={handleClose}
            className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
            aria-label="关闭"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1 min-h-0">
          <div className="flex flex-col min-h-0">
            <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">源图</div>
            <div className="flex-1 min-h-[200px] max-h-[50vh] overflow-hidden rounded-2xl border border-gray-200/70 bg-white/50 p-3 flex items-center justify-center dark:border-white/[0.08] dark:bg-white/[0.03]">
              <img src={captionSource} alt="源图" className="max-h-full max-w-full object-contain rounded-lg" />
            </div>
          </div>

          <div className="flex flex-col min-h-0">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
              <span>反推结果</span>
              {isStreaming && (
                <span className="flex items-center gap-1 text-blue-500 dark:text-blue-400">
                  <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" strokeWidth={3} className="opacity-25" />
                    <path strokeWidth={3} strokeLinecap="round" d="M22 12a10 10 0 00-10-10" />
                  </svg>
                  生成中…
                </span>
              )}
            </div>
            <div className="flex-1 min-h-[200px] max-h-[50vh] overflow-y-auto rounded-2xl border border-blue-200/70 bg-blue-50/30 p-3 text-sm text-gray-700 whitespace-pre-wrap break-words dark:border-blue-500/20 dark:bg-blue-500/[0.04] dark:text-gray-200 custom-scrollbar">
              {isError ? (
                <div className="text-red-500 dark:text-red-400 break-words">{errorMessage || '反推失败'}</div>
              ) : (
                <>
                  {caption}
                  {isStreaming && (
                    <span className="inline-block w-[2px] h-[1em] -mb-[2px] bg-blue-500 dark:bg-blue-400 animate-pulse ml-0.5" aria-hidden>▍</span>
                  )}
                  {!caption && !isStreaming && !isError && (
                    <span className="text-gray-400">（等待反推结果）</span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          {isError && (
            <button
              type="button"
              onClick={runCaption}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-blue-600 transition hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10"
            >
              重试
            </button>
          )}
          <button
            type="button"
            onClick={handleClose}
            className="rounded-xl px-4 py-2.5 text-sm text-gray-600 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleAppend}
            disabled={!canAdopt}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-blue-600 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-blue-400 dark:hover:bg-blue-500/10"
          >
            追加
          </button>
          <button
            type="button"
            onClick={handleReplace}
            disabled={!canAdopt}
            className="rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            采用
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: App.tsx 挂载**

在 `import PromptOptimizerModal from './components/PromptOptimizerModal'` 后新增 `import ImageCaptionModal from './components/ImageCaptionModal'`。在 JSX 中 `<PromptOptimizerModal />` 之后新增一行 `<ImageCaptionModal />`。

- [ ] **Step 4: 验证**

Run: `npx tsc -b && npm run lint && npm run test`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add src/store/slices/ui.ts src/components/ImageCaptionModal.tsx src/App.tsx
git commit -m "feat(captioner): 反推弹窗 ImageCaptionModal + captionSource 状态 + 挂载"
```

---

## Task 8: 入口接线 — ImageContextMenu + InputBar/PillRow

**Files:**
- Modify: `src/components/ImageContextMenu.tsx`
- Modify: `src/components/InputBar/PillRow.tsx`
- Modify: `src/components/InputBar/index.tsx`

- [ ] **Step 1: ImageContextMenu — 加「反推提示词」项**

在组件内取 `setCaptionSource`：在 `const setMaskEditorImageId = useStore((s) => s.setMaskEditorImageId)` 后新增：
```ts
  const setCaptionSource = useStore((s) => s.setCaptionSource)
```
在 `handleEdit` 之后新增 handler（把任意 img src 转成 base64 data URL，再开反推 modal）：
```ts
  const handleCaption = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuInfo(null)
    try {
      const res = await fetch(menuInfo.src)
      const blob = await res.blob()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
      setDetailTaskId(null)
      setLightboxImageId(null)
      setMaskEditorImageId(null)
      setCaptionSource(dataUrl)
    } catch (err) {
      console.error(err)
      showToast(`反推失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }
```
把菜单高度常量从 `const MENU_HEIGHT = 128 // 三个按钮高度加 padding` 改为 `const MENU_HEIGHT = 160 // 四个按钮高度加 padding`。在「编辑」按钮之后新增一个菜单项：
```tsx
      <button
        onClick={handleCaption}
        className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2 transition-colors"
      >
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h6m-6 8l-3-3V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H8l-4 4z" />
        </svg>
        反推提示词
      </button>
```

- [ ] **Step 2: PillRow — 加「反推」按钮 + props**

在 `PillRowProps` 中 `onOptimize: () => void` 后新增：
```ts
  canCaption: boolean
  captionTooltipText: string
  onCaption: () => void
```
在解构参数中加入 `canCaption, captionTooltipText, onCaption`。在 `optimizeHover` state 旁新增 `const [captionHover, setCaptionHover] = useState(false)`。在「优化 pill」`</div>` 之后插入「反推 pill」：
```tsx
      {/* 反推 pill */}
      <div
        className="relative"
        onMouseEnter={() => setCaptionHover(true)}
        onMouseLeave={() => setCaptionHover(false)}
      >
        <ButtonTooltip visible={Boolean(captionTooltipText) && captionHover} text={captionTooltipText} />
        <button
          type="button"
          onClick={() => canCaption && onCaption()}
          disabled={!canCaption}
          className={canCaption ? PILL_BASE : PILL_DISABLED}
          title="图生文 / 反推提示词"
          aria-label="图生文 / 反推提示词"
        >
          <svg className="h-3.5 w-3.5 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 15l5-5 4 4 3-3 6 6" />
            <circle cx="8.5" cy="8.5" r="1.5" />
          </svg>
          <span>反推</span>
        </button>
      </div>
```

- [ ] **Step 3: InputBar/index.tsx — 反推上传入口接线**

取 `setCaptionSource`：在 `const setShowPromptOptimizer = ...` 后新增：
```ts
  const setCaptionSource = useStore((s) => s.setCaptionSource)
```
计算可用性（在 `canOptimize` 一带）：
```ts
  const captionerKeyConfigured = Boolean(settings.captioner.apiKey.trim())
  const captionTooltipText = !captionerKeyConfigured
    ? '反推提示词 API 尚未配置，点设置中"反推提示词 API"添加'
    : ''
```
新增一个文件读取 handler 与隐藏 input 的 ref：在 `const fileInputRef = useRef<HTMLInputElement>(null)` 后新增 `const captionFileInputRef = useRef<HTMLInputElement>(null)`。在 `handleFileUpload` 之后新增：
```ts
  const handleCaptionFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      showToast('请选择图片文件', 'error')
      return
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })
      setCaptionSource(dataUrl)
    } catch (err) {
      showToast(`读取图片失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }
```
给 `PillRow` 传入新 props（在 `onOptimize={() => setShowPromptOptimizer(true)}` 旁）：
```tsx
      canCaption={captionerKeyConfigured}
      captionTooltipText={captionTooltipText}
      onCaption={() => captionFileInputRef.current?.click()}
```
在现有隐藏 `<input ref={fileInputRef} .../>` 之后新增隐藏 input：
```tsx
          <input
            ref={captionFileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleCaptionFilePick}
          />
```

- [ ] **Step 4: 验证**

Run: `npx tsc -b && npm run lint && npm run test`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add src/components/ImageContextMenu.tsx src/components/InputBar/PillRow.tsx src/components/InputBar/index.tsx
git commit -m "feat(captioner): 入口接线——右键菜单反推 + 底栏反推上传"
```

---

## Task 9: 完整构建 + 手动冒烟验证

**Files:** 无（验证任务）

- [ ] **Step 1: 完整构建**

Run: `npm run build`
Expected: 构建成功无报错

- [ ] **Step 2: 启动 dev 手动冒烟**

Run: `npm run dev`，逐项核对：

1. 设置面板出现「反推提示词 API」区块（含配置选择器）；默认「默认」配置。
2. 配一个支持 vision 的模型 + key，保存，重开设置持久化正确。
3. 反推配置的新建/切换/删除/重命名正常；删到剩 1 个时删除按钮隐藏。
4. 底栏出现「反推」pill：未配 key 时禁用 + tooltip 提示；配好后点击弹文件选择器，选图后弹出反推 modal 并流式出结果。
5. 反推 modal：源图正常显示；「采用」替换提示词；「追加」在已有提示词后换行拼接；「取消」关闭；出错可「重试」。
6. 右键任意图（参考图 / 生成图 / Lightbox 大图）出现「反推提示词」，点击后正常反推。
7. 底栏反推上传所选图片**不**进入参考图列表。
8. 导出数据 → 解压 manifest.json，确认每个 captionerProfiles[].apiKey 与 captioner.apiKey 均为空。
9. 导入含多反推配置的备份 → 正确合并（去重/追加）。
10. 优化器区块（已切到 NamedProfileSelector）功能不回归。

- [ ] **Step 3: 收尾确认**

Run: `npm run test && npm run lint && npx tsc -b`
Expected: 全绿。若冒烟发现问题，回到对应 Task 修复后重跑。

---

## 完成定义（Definition of Done）

- 右键菜单与底栏上传两个入口都能对图片发起反推，弹窗流式出结果，支持替换/追加/取消。
- 反推有独立的多配置系统（增删改切 + 持久化 + 迁移 + 导入合并 + 导出脱敏），与优化器解耦。
- 选择器泛化为 `NamedProfileSelector`，优化器与反推共用；优化器无回归。
- `npm run test` / `npm run lint` / `npm run build` 全绿。

## 非目标（重申）

- 不支持 Gemini / 非 chat 接口；不做批量反推；不改图像生成流程；不做图片尺寸预处理。
