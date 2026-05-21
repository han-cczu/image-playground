import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_IMAGES_MODEL,
  DEFAULT_OPENAI_PROFILE_ID,
  DEFAULT_OPTIMIZER_MODEL,
  DEFAULT_OPTIMIZER_SYSTEM_PROMPT,
  DEFAULT_OPTIMIZER_TIMEOUT,
  DEFAULT_SETTINGS,
  mergeImportedSettings,
  normalizeSettings,
} from './apiProfiles'

describe('mergeImportedSettings', () => {
  it('replaces the default OpenAI profile with legacy imported settings when current settings are untouched', () => {
    const merged = mergeImportedSettings(DEFAULT_SETTINGS, {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'imported-key',
      model: 'imported-model',
      timeout: 120,
      apiMode: 'responses',
      codexCli: true,
      apiProxy: true,
    })

    expect(merged.profiles).toHaveLength(1)
    expect(merged.activeProfileId).toBe(DEFAULT_OPENAI_PROFILE_ID)
    expect(merged.profiles[0]).toMatchObject({
      id: DEFAULT_OPENAI_PROFILE_ID,
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'imported-key',
      model: 'imported-model',
      timeout: 120,
      apiMode: 'responses',
      codexCli: true,
      apiProxy: true,
    })
  })

  it('replaces the default provider list with imported profiles when current settings are untouched', () => {
    const merged = mergeImportedSettings(DEFAULT_SETTINGS, {
      profiles: [
        {
          id: 'imported-openai',
          name: 'Imported OpenAI',
          provider: 'openai',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'openai-key',
          model: DEFAULT_IMAGES_MODEL,
          timeout: 300,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
        {
          id: 'imported-gemini',
          name: 'Imported Gemini',
          provider: 'gemini',
          baseUrl: DEFAULT_GEMINI_BASE_URL,
          apiKey: 'gemini-key',
          model: DEFAULT_GEMINI_MODEL,
          timeout: 300,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
      ],
      activeProfileId: 'imported-gemini',
    })

    expect(merged.profiles.map((profile) => profile.id)).toEqual(['imported-openai', 'imported-gemini'])
    expect(merged.activeProfileId).toBe('imported-gemini')
  })

  it('deduplicates imported profiles when replacing untouched default settings', () => {
    const merged = mergeImportedSettings(DEFAULT_SETTINGS, {
      profiles: [
        {
          id: 'imported-openai-a',
          name: 'Imported OpenAI A',
          provider: 'openai',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'openai-key',
          model: DEFAULT_IMAGES_MODEL,
          timeout: 300,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
        {
          id: 'imported-openai-b',
          name: 'Imported OpenAI B',
          provider: 'openai',
          baseUrl: 'https://api.example.com/v1/',
          apiKey: 'openai-key',
          model: DEFAULT_IMAGES_MODEL,
          timeout: 600,
          apiMode: 'images',
          codexCli: true,
          apiProxy: true,
        },
      ],
      activeProfileId: 'imported-openai-b',
    })

    expect(merged.profiles).toHaveLength(1)
    expect(merged.profiles[0].id).toBe('imported-openai-a')
    expect(merged.activeProfileId).toBe('imported-openai-a')
  })

  it('appends imported legacy settings as a new profile when current settings are customized', () => {
    const current = mergeImportedSettings(DEFAULT_SETTINGS, {
      baseUrl: 'https://current.example.com/v1',
      apiKey: 'current-key',
      model: 'current-model',
    })
    const merged = mergeImportedSettings(current, {
      baseUrl: 'https://imported.example.com/v1',
      apiKey: 'imported-key',
      model: 'imported-model',
    })

    expect(merged.profiles).toHaveLength(2)
    expect(merged.activeProfileId).toBe(DEFAULT_OPENAI_PROFILE_ID)
    expect(merged.profiles[0]).toMatchObject({ apiKey: 'current-key', model: 'current-model' })
    expect(merged.profiles[1]).toMatchObject({
      provider: 'openai',
      baseUrl: 'https://imported.example.com/v1',
      apiKey: 'imported-key',
      model: 'imported-model',
    })
    expect(merged.profiles[1].id).not.toBe(DEFAULT_OPENAI_PROFILE_ID)
  })

  it('appends imported profiles as new profiles when current settings are customized', () => {
    const current = mergeImportedSettings(DEFAULT_SETTINGS, {
      baseUrl: 'https://current.example.com/v1',
      apiKey: 'current-key',
      model: 'current-model',
    })
    const merged = mergeImportedSettings(current, {
      profiles: [
        {
          id: 'imported-openai',
          name: 'Imported OpenAI',
          provider: 'openai',
          baseUrl: 'https://imported.example.com/v1',
          apiKey: 'imported-key',
          model: DEFAULT_IMAGES_MODEL,
          timeout: 300,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
        {
          id: 'imported-gemini',
          name: 'Imported Gemini',
          provider: 'gemini',
          baseUrl: DEFAULT_GEMINI_BASE_URL,
          apiKey: 'gemini-key',
          model: DEFAULT_GEMINI_MODEL,
          timeout: 300,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
      ],
      activeProfileId: 'imported-gemini',
    })

    expect(merged.profiles).toHaveLength(3)
    expect(merged.activeProfileId).toBe(DEFAULT_OPENAI_PROFILE_ID)
    expect(merged.profiles[0]).toMatchObject({ apiKey: 'current-key', model: 'current-model' })
    expect(merged.profiles[1]).toMatchObject({ name: 'Imported OpenAI', provider: 'openai', apiKey: 'imported-key' })
    expect(merged.profiles[2]).toMatchObject({ name: 'Imported Gemini', provider: 'gemini', apiKey: 'gemini-key' })
    expect(new Set(merged.profiles.map((profile) => profile.id)).size).toBe(3)
  })

  it('skips imported profiles that already exist in current customized settings', () => {
    const current = mergeImportedSettings(DEFAULT_SETTINGS, {
      baseUrl: 'https://current.example.com/v1',
      apiKey: 'current-key',
      model: 'current-model',
    })
    const merged = mergeImportedSettings(current, {
      profiles: [
        {
          id: 'duplicate-openai',
          name: 'Duplicate OpenAI',
          provider: 'openai',
          baseUrl: 'https://current.example.com/v1/',
          apiKey: 'current-key',
          model: 'current-model',
          timeout: 600,
          apiMode: 'images',
          codexCli: true,
          apiProxy: true,
        },
        {
          id: 'new-gemini',
          name: 'New Gemini',
          provider: 'gemini',
          baseUrl: DEFAULT_GEMINI_BASE_URL,
          apiKey: 'gemini-key',
          model: DEFAULT_GEMINI_MODEL,
          timeout: 300,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
      ],
    })

    expect(merged.profiles).toHaveLength(2)
    expect(merged.profiles[0]).toMatchObject({ apiKey: 'current-key', model: 'current-model' })
    expect(merged.profiles[1]).toMatchObject({ provider: 'gemini', apiKey: 'gemini-key', model: DEFAULT_GEMINI_MODEL })
  })
})

describe('normalizeSettings - promptOptimizer', () => {
  it('缺失字段时填默认值', () => {
    const result = normalizeSettings({})
    expect(result.promptOptimizer).toBeDefined()
    expect(result.promptOptimizer.apiKey).toBe('')
    expect(result.promptOptimizer.model).toBe(DEFAULT_OPTIMIZER_MODEL)
    expect(result.promptOptimizer.timeout).toBe(DEFAULT_OPTIMIZER_TIMEOUT)
    expect(result.promptOptimizer.systemPrompt).toBe(DEFAULT_OPTIMIZER_SYSTEM_PROMPT)
    expect(typeof result.promptOptimizer.baseUrl).toBe('string')
  })

  it('部分字段合法时保留，其他兜底', () => {
    const result = normalizeSettings({
      promptOptimizer: {
        baseUrl: 'https://custom.example.com/v1',
        apiKey: 'sk-custom',
        model: 'custom-model',
      },
    })
    expect(result.promptOptimizer.baseUrl).toBe('https://custom.example.com/v1')
    expect(result.promptOptimizer.apiKey).toBe('sk-custom')
    expect(result.promptOptimizer.model).toBe('custom-model')
    // 未提供的字段走默认
    expect(result.promptOptimizer.timeout).toBe(DEFAULT_OPTIMIZER_TIMEOUT)
    expect(result.promptOptimizer.systemPrompt).toBe(DEFAULT_OPTIMIZER_SYSTEM_PROMPT)
  })

  it('非法 timeout / 空 systemPrompt 走默认', () => {
    const result = normalizeSettings({
      promptOptimizer: {
        baseUrl: 'https://x.example.com/v1',
        apiKey: 'k',
        model: 'm',
        timeout: -5,
        systemPrompt: '   ',
      },
    })
    expect(result.promptOptimizer.timeout).toBe(DEFAULT_OPTIMIZER_TIMEOUT)
    expect(result.promptOptimizer.systemPrompt).toBe(DEFAULT_OPTIMIZER_SYSTEM_PROMPT)

    const result2 = normalizeSettings({
      promptOptimizer: {
        baseUrl: 'https://x.example.com/v1',
        apiKey: 'k',
        model: 'm',
        timeout: 'not-a-number',
        systemPrompt: 0,
      },
    })
    expect(result2.promptOptimizer.timeout).toBe(DEFAULT_OPTIMIZER_TIMEOUT)
    expect(result2.promptOptimizer.systemPrompt).toBe(DEFAULT_OPTIMIZER_SYSTEM_PROMPT)
  })
})
