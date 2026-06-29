import { describe, expect, it } from 'vitest'
import {
  DEFAULT_API_TIMEOUT,
  DEFAULT_CAPTIONER_PROFILE_ID,
  DEFAULT_CAPTIONER_TIMEOUT,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_CHAT_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_IMAGES_MODEL,
  DEFAULT_OPENAI_PROFILE_ID,
  DEFAULT_OPTIMIZER_MODEL,
  DEFAULT_OPTIMIZER_PROFILE_ID,
  DEFAULT_OPTIMIZER_SYSTEM_PROMPT,
  DEFAULT_OPTIMIZER_TIMEOUT,
  DEFAULT_SETTINGS,
  MAX_CONFIG_FIELD_LEN,
  createDefaultCaptionerProfile,
  createDefaultOptimizerProfile,
  getActiveApiProfile,
  getActiveCaptionerProfile,
  getActiveOptimizerProfile,
  mergeImportedSettings,
  normalizeSettings,
  switchApiProfileProvider,
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

    expect(merged.profiles.map((profile) => profile.id)).toEqual([
      'imported-openai',
      'imported-gemini',
    ])
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
    expect(merged.profiles[1]).toMatchObject({
      name: 'Imported OpenAI',
      provider: 'openai',
      apiKey: 'imported-key',
    })
    expect(merged.profiles[2]).toMatchObject({
      name: 'Imported Gemini',
      provider: 'gemini',
      apiKey: 'gemini-key',
    })
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
    expect(merged.profiles[1]).toMatchObject({
      provider: 'gemini',
      apiKey: 'gemini-key',
      model: DEFAULT_GEMINI_MODEL,
    })
  })
})

describe('normalizeSettings - malformed profile arrays', () => {
  it('falls back provider image profiles with blank base URLs to provider defaults', () => {
    const result = normalizeSettings({
      profiles: [
        {
          id: 'openai-blank-url',
          name: 'OpenAI Blank URL',
          provider: 'openai',
          baseUrl: '   ',
          apiKey: 'openai-key',
          model: DEFAULT_IMAGES_MODEL,
          timeout: 300,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
        {
          id: 'gemini-blank-url',
          name: 'Gemini Blank URL',
          provider: 'gemini',
          baseUrl: '',
          apiKey: 'gemini-key',
          model: DEFAULT_GEMINI_MODEL,
          timeout: 300,
        },
      ],
      activeProfileId: 'openai-blank-url',
    })

    expect(result.profiles[0]).toMatchObject({
      provider: 'openai',
      baseUrl: DEFAULT_SETTINGS.baseUrl,
    })
    expect(result.profiles[1]).toMatchObject({
      provider: 'gemini',
      baseUrl: DEFAULT_GEMINI_BASE_URL,
    })
    expect(result.baseUrl).toBe(DEFAULT_SETTINGS.baseUrl)
  })

  it('caps untrusted profile text fields beyond display names', () => {
    const long = 'x'.repeat(MAX_CONFIG_FIELD_LEN + 50)
    const result = normalizeSettings({
      profiles: [
        {
          id: long,
          name: 'Image',
          provider: 'openai',
          baseUrl: long,
          apiKey: long,
          model: long,
          timeout: DEFAULT_API_TIMEOUT,
          apiMode: 'images',
        },
      ],
      activeProfileId: long,
      optimizerProfiles: [
        {
          id: long,
          name: 'Optimizer',
          baseUrl: long,
          apiKey: long,
          model: long,
          timeout: 30,
          systemPrompt: long,
        },
      ],
      activeOptimizerProfileId: long,
      captionerProfiles: [
        {
          id: long,
          name: 'Captioner',
          baseUrl: long,
          apiKey: long,
          model: long,
          timeout: 30,
          systemPrompt: long,
        },
      ],
      activeCaptionerProfileId: long,
    })

    expect(result.profiles[0].id).toHaveLength(MAX_CONFIG_FIELD_LEN)
    expect(result.profiles[0].baseUrl).toHaveLength(MAX_CONFIG_FIELD_LEN)
    expect(result.profiles[0].apiKey).toHaveLength(MAX_CONFIG_FIELD_LEN)
    expect(result.profiles[0].model).toHaveLength(MAX_CONFIG_FIELD_LEN)
    expect(result.activeProfileId).toBe(result.profiles[0].id)
    expect(result.optimizerProfiles[0].id).toHaveLength(MAX_CONFIG_FIELD_LEN)
    expect(result.optimizerProfiles[0].baseUrl).toHaveLength(MAX_CONFIG_FIELD_LEN)
    expect(result.optimizerProfiles[0].apiKey).toHaveLength(MAX_CONFIG_FIELD_LEN)
    expect(result.optimizerProfiles[0].model).toHaveLength(MAX_CONFIG_FIELD_LEN)
    expect(result.optimizerProfiles[0].systemPrompt).toHaveLength(MAX_CONFIG_FIELD_LEN)
    expect(result.activeOptimizerProfileId).toBe(result.optimizerProfiles[0].id)
    expect(result.captionerProfiles[0].id).toHaveLength(MAX_CONFIG_FIELD_LEN)
    expect(result.captionerProfiles[0].baseUrl).toHaveLength(MAX_CONFIG_FIELD_LEN)
    expect(result.captionerProfiles[0].apiKey).toHaveLength(MAX_CONFIG_FIELD_LEN)
    expect(result.captionerProfiles[0].model).toHaveLength(MAX_CONFIG_FIELD_LEN)
    expect(result.captionerProfiles[0].systemPrompt).toHaveLength(MAX_CONFIG_FIELD_LEN)
    expect(result.activeCaptionerProfileId).toBe(result.captionerProfiles[0].id)
  })

  it('keeps generated unique ids capped when duplicate imported ids hit the text limit', () => {
    const long = 'x'.repeat(MAX_CONFIG_FIELD_LEN + 50)
    const result = normalizeSettings({
      profiles: [
        {
          id: long,
          name: 'Image A',
          provider: 'openai',
          baseUrl: 'https://a.example.com/v1',
          apiKey: 'ka',
          model: DEFAULT_IMAGES_MODEL,
          timeout: DEFAULT_API_TIMEOUT,
          apiMode: 'images',
        },
        {
          id: long,
          name: 'Image B',
          provider: 'openai',
          baseUrl: 'https://b.example.com/v1',
          apiKey: 'kb',
          model: DEFAULT_IMAGES_MODEL,
          timeout: DEFAULT_API_TIMEOUT,
          apiMode: 'images',
        },
      ],
      optimizerProfiles: [
        {
          id: long,
          name: 'Opt A',
          baseUrl: 'https://oa/v1',
          apiKey: 'oa',
          model: 'oma',
          timeout: 30,
          systemPrompt: 'sa',
        },
        {
          id: long,
          name: 'Opt B',
          baseUrl: 'https://ob/v1',
          apiKey: 'ob',
          model: 'omb',
          timeout: 30,
          systemPrompt: 'sb',
        },
      ],
      captionerProfiles: [
        {
          id: long,
          name: 'Cap A',
          baseUrl: 'https://ca/v1',
          apiKey: 'ca',
          model: 'cma',
          timeout: 30,
          systemPrompt: 'sa',
        },
        {
          id: long,
          name: 'Cap B',
          baseUrl: 'https://cb/v1',
          apiKey: 'cb',
          model: 'cmb',
          timeout: 30,
          systemPrompt: 'sb',
        },
      ],
    })

    expect(result.profiles).toHaveLength(2)
    expect(result.profiles.every((profile) => profile.id.length <= MAX_CONFIG_FIELD_LEN)).toBe(true)
    expect(new Set(result.profiles.map((profile) => profile.id)).size).toBe(2)
    expect(
      result.optimizerProfiles.every((profile) => profile.id.length <= MAX_CONFIG_FIELD_LEN),
    ).toBe(true)
    expect(new Set(result.optimizerProfiles.map((profile) => profile.id)).size).toBe(2)
    expect(
      result.captionerProfiles.every((profile) => profile.id.length <= MAX_CONFIG_FIELD_LEN),
    ).toBe(true)
    expect(new Set(result.captionerProfiles.map((profile) => profile.id)).size).toBe(2)
  })

  it('caps profile arrays and clamps untrusted profile names', () => {
    const longName = `  ${'x'.repeat(90)}  `
    const result = normalizeSettings({
      profiles: Array.from({ length: 80 }, (_, i) => ({
        id: `profile-${i}`,
        name: longName,
        provider: 'openai',
        baseUrl: 'https://api.example.com/v1',
        apiKey: `key-${i}`,
        model: DEFAULT_IMAGES_MODEL,
        timeout: 300,
        apiMode: 'images',
      })),
      optimizerProfiles: Array.from({ length: 80 }, (_, i) => ({
        id: `optimizer-${i}`,
        name: longName,
        baseUrl: 'https://opt.example.com/v1',
        apiKey: `ok-${i}`,
        model: 'optimizer-model',
        timeout: 30,
        systemPrompt: 'system',
      })),
      captionerProfiles: Array.from({ length: 80 }, (_, i) => ({
        id: `captioner-${i}`,
        name: longName,
        baseUrl: 'https://cap.example.com/v1',
        apiKey: `ck-${i}`,
        model: 'captioner-model',
        timeout: 30,
        systemPrompt: 'system',
      })),
    })

    expect(result.profiles).toHaveLength(50)
    expect(result.optimizerProfiles).toHaveLength(50)
    expect(result.captionerProfiles).toHaveLength(50)
    expect(result.profiles[0].name).toBe('x'.repeat(50))
    expect(result.optimizerProfiles[0].name).toBe('x'.repeat(50))
    expect(result.captionerProfiles[0].name).toBe('x'.repeat(50))
    expect(result.profiles.find((profile) => profile.id === 'profile-79')).toBeUndefined()
    expect(
      result.optimizerProfiles.find((profile) => profile.id === 'optimizer-79'),
    ).toBeUndefined()
    expect(
      result.captionerProfiles.find((profile) => profile.id === 'captioner-79'),
    ).toBeUndefined()
  })

  it('normalizes non-positive image profile timeouts to the API default', () => {
    const result = normalizeSettings({
      timeout: 0,
      profiles: [
        {
          id: 'zero-timeout',
          name: 'Zero Timeout',
          provider: 'openai',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'key',
          model: DEFAULT_IMAGES_MODEL,
          timeout: -5,
          apiMode: 'images',
        },
      ],
    })

    expect(result.timeout).toBe(DEFAULT_SETTINGS.timeout)
    expect(result.profiles[0].timeout).toBe(DEFAULT_SETTINGS.timeout)
  })

  it('does not let legacy top-level timeout overrides bypass active profile normalization', () => {
    expect(getActiveApiProfile({ ...DEFAULT_SETTINGS, timeout: 0 }).timeout).toBe(
      DEFAULT_SETTINGS.timeout,
    )
    expect(getActiveApiProfile({ ...DEFAULT_SETTINGS, timeout: -5 }).timeout).toBe(
      DEFAULT_SETTINGS.timeout,
    )
  })

  it('uses the active profile instead of legacy top-level mirrors when profiles are present', () => {
    const active = getActiveApiProfile({
      baseUrl: 'https://legacy.example.com/v1',
      apiKey: 'legacy-key',
      model: 'legacy-model',
      timeout: 10,
      apiMode: 'responses',
      profiles: [
        {
          id: 'gemini-active',
          name: 'Gemini',
          provider: 'gemini',
          baseUrl: DEFAULT_GEMINI_BASE_URL,
          apiKey: 'gemini-key',
          model: DEFAULT_GEMINI_MODEL,
          timeout: 600,
        },
      ],
      activeProfileId: 'gemini-active',
    })

    expect(active).toMatchObject({
      provider: 'gemini',
      baseUrl: DEFAULT_GEMINI_BASE_URL,
      apiKey: 'gemini-key',
      model: DEFAULT_GEMINI_MODEL,
      timeout: 600,
    })
  })

  it('ignores non-object image profiles and falls back to legacy settings when none are valid', () => {
    const result = normalizeSettings({
      baseUrl: 'https://legacy.example.com/v1',
      apiKey: 'legacy-key',
      model: 'legacy-model',
      profiles: [null, 'bad-profile'],
    })

    expect(result.profiles).toHaveLength(1)
    expect(result.profiles[0]).toMatchObject({
      id: DEFAULT_OPENAI_PROFILE_ID,
      baseUrl: 'https://legacy.example.com/v1',
      apiKey: 'legacy-key',
      model: 'legacy-model',
    })
  })

  it('ignores non-object optimizer and captioner profiles instead of manufacturing default duplicates', () => {
    const result = normalizeSettings({
      optimizerProfiles: [
        null,
        {
          id: 'opt-valid',
          name: 'Opt',
          baseUrl: 'https://opt/v1',
          apiKey: 'ok',
          model: 'om',
          timeout: 30,
          systemPrompt: 'os',
        },
      ],
      activeOptimizerProfileId: 'opt-valid',
      captionerProfiles: [
        'bad-captioner',
        {
          id: 'cap-valid',
          name: 'Cap',
          baseUrl: 'https://cap/v1',
          apiKey: 'ck',
          model: 'cm',
          timeout: 30,
          systemPrompt: 'cs',
        },
      ],
      activeCaptionerProfileId: 'cap-valid',
    })

    expect(result.optimizerProfiles.map((profile) => profile.id)).toEqual(['opt-valid'])
    expect(result.captionerProfiles.map((profile) => profile.id)).toEqual(['cap-valid'])
  })

  it('makes duplicate profile ids unique before they reach settings UI state', () => {
    const result = normalizeSettings({
      profiles: [
        {
          id: 'dup',
          name: 'OpenAI A',
          provider: 'openai',
          baseUrl: 'https://a.example.com/v1',
          apiKey: 'ka',
          model: 'ma',
          timeout: 300,
          apiMode: 'images',
        },
        {
          id: 'dup',
          name: 'OpenAI B',
          provider: 'openai',
          baseUrl: 'https://b.example.com/v1',
          apiKey: 'kb',
          model: 'mb',
          timeout: 300,
          apiMode: 'images',
        },
      ],
      activeProfileId: 'dup',
      optimizerProfiles: [
        {
          id: 'opt-dup',
          name: 'Opt A',
          baseUrl: 'https://oa/v1',
          apiKey: 'oa',
          model: 'oma',
          timeout: 30,
          systemPrompt: 'sa',
        },
        {
          id: 'opt-dup',
          name: 'Opt B',
          baseUrl: 'https://ob/v1',
          apiKey: 'ob',
          model: 'omb',
          timeout: 30,
          systemPrompt: 'sb',
        },
      ],
      activeOptimizerProfileId: 'opt-dup',
      captionerProfiles: [
        {
          id: 'cap-dup',
          name: 'Cap A',
          baseUrl: 'https://ca/v1',
          apiKey: 'ca',
          model: 'cma',
          timeout: 30,
          systemPrompt: 'sa',
        },
        {
          id: 'cap-dup',
          name: 'Cap B',
          baseUrl: 'https://cb/v1',
          apiKey: 'cb',
          model: 'cmb',
          timeout: 30,
          systemPrompt: 'sb',
        },
      ],
      activeCaptionerProfileId: 'cap-dup',
    })

    expect(new Set(result.profiles.map((profile) => profile.id)).size).toBe(result.profiles.length)
    expect(new Set(result.optimizerProfiles.map((profile) => profile.id)).size).toBe(
      result.optimizerProfiles.length,
    )
    expect(new Set(result.captionerProfiles.map((profile) => profile.id)).size).toBe(
      result.captionerProfiles.length,
    )
    expect(result.activeProfileId).toBe('dup')
    expect(result.activeOptimizerProfileId).toBe('opt-dup')
    expect(result.activeCaptionerProfileId).toBe('cap-dup')
  })
})

describe('switchApiProfileProvider', () => {
  it('clears the API key when switching providers to avoid sending one vendor key to another endpoint', () => {
    const openai = normalizeSettings({
      profiles: [
        {
          ...DEFAULT_SETTINGS.profiles[0],
          apiKey: 'sk-openai',
        },
      ],
    }).profiles[0]

    const gemini = switchApiProfileProvider(openai, 'gemini')
    expect(gemini).toMatchObject({
      provider: 'gemini',
      apiKey: '',
      baseUrl: DEFAULT_GEMINI_BASE_URL,
      model: DEFAULT_GEMINI_MODEL,
    })

    const backToOpenAI = switchApiProfileProvider(
      { ...gemini, apiKey: 'AIza-gemini' },
      'openai',
    )
    expect(backToOpenAI).toMatchObject({
      provider: 'openai',
      apiKey: '',
      model: DEFAULT_IMAGES_MODEL,
    })
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
    expect(result.promptOptimizer).toEqual({
      baseUrl: 'https://opt.example.com/v1',
      apiKey: 'sk-opt',
      model: 'gpt-4o-mini',
      timeout: 45,
      systemPrompt: '自定义提示词',
      provider: 'openai',
    })
  })

  it('多个 optimizerProfiles：activeOptimizerProfileId 命中时镜像派生该项', () => {
    const result = normalizeSettings({
      optimizerProfiles: [
        {
          id: 'a',
          name: 'A',
          baseUrl: 'https://a/v1',
          apiKey: 'ka',
          model: 'ma',
          timeout: 30,
          systemPrompt: 'sa',
        },
        {
          id: 'b',
          name: 'B',
          baseUrl: 'https://b/v1',
          apiKey: 'kb',
          model: 'mb',
          timeout: 60,
          systemPrompt: 'sb',
        },
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
        {
          id: 'a',
          name: 'A',
          baseUrl: 'https://a/v1',
          apiKey: 'ka',
          model: 'ma',
          timeout: 30,
          systemPrompt: 'sa',
        },
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
        {
          id: 'a',
          name: 'A',
          baseUrl: 'https://a/v1',
          apiKey: 'ka',
          model: 'ma',
          timeout: 30,
          systemPrompt: 'sa',
        },
        {
          id: 'b',
          name: 'B',
          baseUrl: 'https://b/v1',
          apiKey: 'kb',
          model: 'mb',
          timeout: 60,
          systemPrompt: 'sb',
        },
      ],
      activeOptimizerProfileId: 'b',
    })
    expect(active.id).toBe('b')
  })
})

describe('mergeImportedSettings - optimizer profiles', () => {
  it('current 仅默认优化器配置时，全量采用导入的优化器配置', () => {
    const merged = mergeImportedSettings(DEFAULT_SETTINGS, {
      optimizerProfiles: [
        {
          id: 'imp-a',
          name: 'Imp A',
          baseUrl: 'https://a/v1',
          apiKey: 'ka',
          model: 'ma',
          timeout: 30,
          systemPrompt: 'sa',
        },
        {
          id: 'imp-b',
          name: 'Imp B',
          baseUrl: 'https://b/v1',
          apiKey: 'kb',
          model: 'mb',
          timeout: 60,
          systemPrompt: 'sb',
        },
      ],
      activeOptimizerProfileId: 'imp-b',
    })
    expect(merged.optimizerProfiles).toHaveLength(2)
    expect(merged.optimizerProfiles.map((p) => p.baseUrl).sort()).toEqual([
      'https://a/v1',
      'https://b/v1',
    ])
    expect(merged.activeOptimizerProfileId).toBe('imp-b')
  })

  it('current 已自定义优化器配置时，去重追加导入项并分配新 id，保留 current 激活项', () => {
    const current = normalizeSettings({
      profiles: [
        {
          id: 'cur-img',
          name: 'Cur',
          provider: 'openai',
          baseUrl: 'https://img/v1',
          apiKey: 'ik',
          model: 'gpt-image-2',
          timeout: 600,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
      ],
      activeProfileId: 'cur-img',
      optimizerProfiles: [
        {
          id: 'cur-opt',
          name: 'Cur Opt',
          baseUrl: 'https://cur/v1',
          apiKey: 'ck',
          model: 'cm',
          timeout: 30,
          systemPrompt: 'cs',
        },
      ],
      activeOptimizerProfileId: 'cur-opt',
    })
    const merged = mergeImportedSettings(current, {
      optimizerProfiles: [
        // 与 cur-opt 在去重键全字段(baseUrl/apiKey/model/systemPrompt/name)一致,仅 timeout 不同 → 仍应折叠
        {
          id: 'dup',
          name: 'Cur Opt',
          baseUrl: 'https://cur/v1',
          apiKey: 'ck',
          model: 'cm',
          timeout: 99,
          systemPrompt: 'cs',
        },
        {
          id: 'new',
          name: 'New',
          baseUrl: 'https://new/v1',
          apiKey: 'nk',
          model: 'nm',
          timeout: 45,
          systemPrompt: 'ns',
        },
      ],
      activeOptimizerProfileId: 'new',
    })
    expect(merged.optimizerProfiles).toHaveLength(2)
    const baseUrls = merged.optimizerProfiles.map((p) => p.baseUrl).sort()
    expect(baseUrls).toEqual(['https://cur/v1', 'https://new/v1'])
    expect(merged.activeOptimizerProfileId).toBe('cur-opt')
    expect(merged.optimizerProfiles.some((p) => p.id === 'new')).toBe(false)
  })

  it('current 仅默认图像配置但已自定义优化器配置时，仍按 fresh 整体替换语义采用导入', () => {
    // current 图像 profiles 仍是出厂默认 → 命中 hasOnlyDefaultProfiles → 整体替换
    const current = normalizeSettings({
      optimizerProfiles: [
        {
          id: 'my-opt',
          name: 'My',
          baseUrl: 'https://my/v1',
          apiKey: 'mk',
          model: 'mm',
          timeout: 30,
          systemPrompt: 'ms',
        },
      ],
      activeOptimizerProfileId: 'my-opt',
    })
    const merged = mergeImportedSettings(current, {
      optimizerProfiles: [
        {
          id: 'imp-opt',
          name: 'Imp',
          baseUrl: 'https://imp/v1',
          apiKey: 'ik',
          model: 'im',
          timeout: 60,
          systemPrompt: 'is',
        },
      ],
      activeOptimizerProfileId: 'imp-opt',
    })
    expect(merged.optimizerProfiles).toHaveLength(1)
    expect(merged.optimizerProfiles[0].baseUrl).toBe('https://imp/v1')
  })

  it('导入优化器配置去重时区分 provider', () => {
    const shared = {
      name: 'Shared',
      baseUrl: DEFAULT_GEMINI_BASE_URL,
      apiKey: '',
      model: DEFAULT_GEMINI_CHAT_MODEL,
      timeout: 30,
      systemPrompt: 'same prompt',
    }
    const current = normalizeSettings({
      profiles: [
        {
          id: 'cur-img',
          name: 'Cur',
          provider: 'openai',
          baseUrl: 'https://img/v1',
          apiKey: 'ik',
          model: 'gpt-image-2',
          timeout: 600,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
      ],
      activeProfileId: 'cur-img',
      optimizerProfiles: [{ id: 'cur-opt', provider: 'openai', ...shared }],
      activeOptimizerProfileId: 'cur-opt',
    })

    const merged = mergeImportedSettings(current, {
      optimizerProfiles: [{ id: 'imp-opt', provider: 'gemini', ...shared }],
      activeOptimizerProfileId: 'imp-opt',
    })

    expect(merged.optimizerProfiles).toHaveLength(2)
    expect(merged.optimizerProfiles.map((p) => p.provider).sort()).toEqual(['gemini', 'openai'])
  })

  it('当前优化器配置只改变 provider 时不应被当作出厂默认替换', () => {
    const current = normalizeSettings({
      profiles: [
        {
          id: 'cur-img',
          name: 'Cur',
          provider: 'openai',
          baseUrl: 'https://img/v1',
          apiKey: 'ik',
          model: 'gpt-image-2',
          timeout: 600,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
      ],
      activeProfileId: 'cur-img',
      optimizerProfiles: [
        {
          ...DEFAULT_SETTINGS.optimizerProfiles[0],
          provider: 'gemini',
        },
      ],
      activeOptimizerProfileId: DEFAULT_OPTIMIZER_PROFILE_ID,
    })

    const merged = mergeImportedSettings(current, {
      optimizerProfiles: [
        {
          id: 'imp-opt',
          name: 'Imported',
          baseUrl: 'https://imp/v1',
          apiKey: '',
          model: 'imp-model',
          timeout: 30,
          systemPrompt: 'imported',
        },
      ],
      activeOptimizerProfileId: 'imp-opt',
    })

    expect(merged.activeOptimizerProfileId).toBe(DEFAULT_OPTIMIZER_PROFILE_ID)
    expect(merged.optimizerProfiles).toHaveLength(2)
    expect(merged.optimizerProfiles[0]).toMatchObject({
      id: DEFAULT_OPTIMIZER_PROFILE_ID,
      provider: 'gemini',
    })
  })
})

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
      provider: 'openai',
    })
  })

  it('多个 captionerProfiles：activeCaptionerProfileId 命中时镜像派生该项', () => {
    const result = normalizeSettings({
      captionerProfiles: [
        {
          id: 'a',
          name: 'A',
          baseUrl: 'https://a/v1',
          apiKey: 'ka',
          model: 'ma',
          timeout: 30,
          systemPrompt: 'sa',
        },
        {
          id: 'b',
          name: 'B',
          baseUrl: 'https://b/v1',
          apiKey: 'kb',
          model: 'mb',
          timeout: 60,
          systemPrompt: 'sb',
        },
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
        {
          id: 'a',
          name: 'A',
          baseUrl: 'https://a/v1',
          apiKey: 'ka',
          model: 'ma',
          timeout: 30,
          systemPrompt: 'sa',
        },
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

  it('B2: provider 字段缺省兜 openai,显式 gemini 经镜像 round-trip 不丢', () => {
    // 缺省 provider → openai
    expect(DEFAULT_SETTINGS.captioner.provider).toBe('openai')
    expect(DEFAULT_SETTINGS.promptOptimizer.provider).toBe('openai')

    // 显式 gemini captioner/optimizer profile → 镜像与 round-trip 保留 provider
    const once = normalizeSettings({
      captionerProfiles: [
        {
          id: 'g',
          name: 'G',
          baseUrl: 'https://gem/v1beta',
          apiKey: 'gk',
          model: 'gemini-2.5-flash',
          timeout: 30,
          systemPrompt: 's',
          provider: 'gemini',
        },
      ],
      activeCaptionerProfileId: 'g',
      optimizerProfiles: [
        {
          id: 'go',
          name: 'GO',
          baseUrl: 'https://gem/v1beta',
          apiKey: 'gk',
          model: 'gemini-2.5-flash',
          timeout: 30,
          systemPrompt: 's',
          provider: 'gemini',
        },
      ],
      activeOptimizerProfileId: 'go',
    })
    expect(once.captioner.provider).toBe('gemini')
    expect(once.promptOptimizer.provider).toBe('gemini')
    expect(once.captionerProfiles[0].provider).toBe('gemini')
    expect(once.optimizerProfiles[0].provider).toBe('gemini')

    // round-trip:再归一一次仍是 gemini(白名单逐字段重建不丢)
    const twice = normalizeSettings(once)
    expect(twice.captioner.provider).toBe('gemini')
    expect(twice.promptOptimizer.provider).toBe('gemini')
  })

  it('显式 gemini 反推/优化配置缺少端点和模型时使用 Gemini 默认值', () => {
    const result = normalizeSettings({
      captionerProfiles: [
        {
          id: 'cap-gemini',
          name: 'Gemini Captioner',
          baseUrl: '   ',
          apiKey: 'gk',
          model: '',
          timeout: 30,
          systemPrompt: 'caption',
          provider: 'gemini',
        },
      ],
      activeCaptionerProfileId: 'cap-gemini',
      optimizerProfiles: [
        {
          id: 'opt-gemini',
          name: 'Gemini Optimizer',
          baseUrl: '',
          apiKey: 'gk',
          model: '   ',
          timeout: 30,
          systemPrompt: 'optimize',
          provider: 'gemini',
        },
      ],
      activeOptimizerProfileId: 'opt-gemini',
    })

    expect(result.captionerProfiles[0]).toMatchObject({
      provider: 'gemini',
      baseUrl: DEFAULT_GEMINI_BASE_URL,
      model: DEFAULT_GEMINI_CHAT_MODEL,
    })
    expect(result.optimizerProfiles[0]).toMatchObject({
      provider: 'gemini',
      baseUrl: DEFAULT_GEMINI_BASE_URL,
      model: DEFAULT_GEMINI_CHAT_MODEL,
    })
    expect(result.captioner).toMatchObject({
      provider: 'gemini',
      baseUrl: DEFAULT_GEMINI_BASE_URL,
      model: DEFAULT_GEMINI_CHAT_MODEL,
    })
    expect(result.promptOptimizer).toMatchObject({
      provider: 'gemini',
      baseUrl: DEFAULT_GEMINI_BASE_URL,
      model: DEFAULT_GEMINI_CHAT_MODEL,
    })
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
        {
          id: 'a',
          name: 'A',
          baseUrl: 'https://a/v1',
          apiKey: 'ka',
          model: 'ma',
          timeout: 30,
          systemPrompt: 'sa',
        },
        {
          id: 'b',
          name: 'B',
          baseUrl: 'https://b/v1',
          apiKey: 'kb',
          model: 'mb',
          timeout: 60,
          systemPrompt: 'sb',
        },
      ],
      activeCaptionerProfileId: 'b',
    })
    expect(active.id).toBe('b')
  })
})

describe('mergeImportedSettings - captioner profiles', () => {
  it('current 仅默认反推配置时，全量采用导入的反推配置', () => {
    const merged = mergeImportedSettings(DEFAULT_SETTINGS, {
      captionerProfiles: [
        {
          id: 'imp-a',
          name: 'Imp A',
          baseUrl: 'https://a/v1',
          apiKey: 'ka',
          model: 'ma',
          timeout: 30,
          systemPrompt: 'sa',
        },
        {
          id: 'imp-b',
          name: 'Imp B',
          baseUrl: 'https://b/v1',
          apiKey: 'kb',
          model: 'mb',
          timeout: 60,
          systemPrompt: 'sb',
        },
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
        {
          id: 'cur-img',
          name: 'Cur',
          provider: 'openai',
          baseUrl: 'https://img/v1',
          apiKey: 'ik',
          model: 'gpt-image-2',
          timeout: 600,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
      ],
      activeProfileId: 'cur-img',
      captionerProfiles: [
        {
          id: 'cur-cap',
          name: 'Cur Cap',
          baseUrl: 'https://cur/v1',
          apiKey: 'ck',
          model: 'cm',
          timeout: 30,
          systemPrompt: 'cs',
        },
      ],
      activeCaptionerProfileId: 'cur-cap',
    })
    const merged = mergeImportedSettings(current, {
      captionerProfiles: [
        // 与 cur-cap 在去重键全字段(baseUrl/apiKey/model/systemPrompt/name)一致,仅 timeout 不同 → 仍应折叠
        {
          id: 'dup',
          name: 'Cur Cap',
          baseUrl: 'https://cur/v1',
          apiKey: 'ck',
          model: 'cm',
          timeout: 99,
          systemPrompt: 'cs',
        },
        {
          id: 'new',
          name: 'New',
          baseUrl: 'https://new/v1',
          apiKey: 'nk',
          model: 'nm',
          timeout: 45,
          systemPrompt: 'ns',
        },
      ],
      activeCaptionerProfileId: 'new',
    })
    expect(merged.captionerProfiles).toHaveLength(2)
    expect(merged.captionerProfiles.map((p) => p.baseUrl).sort()).toEqual([
      'https://cur/v1',
      'https://new/v1',
    ])
    expect(merged.activeCaptionerProfileId).toBe('cur-cap')
    expect(merged.captionerProfiles.some((p) => p.id === 'new')).toBe(false)
  })

  it('仅 systemPrompt 不同的导入配置不被折叠(M2:往返导入保留多套 systemPrompt)', () => {
    const current = normalizeSettings({
      profiles: [
        {
          id: 'cur-img',
          name: 'Cur',
          provider: 'openai',
          baseUrl: 'https://img/v1',
          apiKey: 'ik',
          model: 'gpt-image-2',
          timeout: 600,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
      ],
      activeProfileId: 'cur-img',
      captionerProfiles: [
        {
          id: 'cur-cap',
          name: 'Cur Cap',
          baseUrl: 'https://cur/v1',
          apiKey: '',
          model: 'cm',
          timeout: 30,
          systemPrompt: 'A',
        },
      ],
      activeCaptionerProfileId: 'cur-cap',
    })
    const merged = mergeImportedSettings(current, {
      captionerProfiles: [
        {
          id: 'imp',
          name: 'Imp',
          baseUrl: 'https://cur/v1',
          apiKey: '',
          model: 'cm',
          timeout: 30,
          systemPrompt: 'B',
        },
      ],
      activeCaptionerProfileId: 'imp',
    })
    expect(merged.captionerProfiles).toHaveLength(2)
    expect(merged.captionerProfiles.map((p) => p.systemPrompt).sort()).toEqual(['A', 'B'])
  })

  it('导入反推配置去重时区分 provider', () => {
    const shared = {
      name: 'Shared',
      baseUrl: DEFAULT_GEMINI_BASE_URL,
      apiKey: '',
      model: DEFAULT_GEMINI_CHAT_MODEL,
      timeout: 30,
      systemPrompt: 'same prompt',
    }
    const current = normalizeSettings({
      profiles: [
        {
          id: 'cur-img',
          name: 'Cur',
          provider: 'openai',
          baseUrl: 'https://img/v1',
          apiKey: 'ik',
          model: 'gpt-image-2',
          timeout: 600,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
      ],
      activeProfileId: 'cur-img',
      captionerProfiles: [{ id: 'cur-cap', provider: 'openai', ...shared }],
      activeCaptionerProfileId: 'cur-cap',
    })

    const merged = mergeImportedSettings(current, {
      captionerProfiles: [{ id: 'imp-cap', provider: 'gemini', ...shared }],
      activeCaptionerProfileId: 'imp-cap',
    })

    expect(merged.captionerProfiles).toHaveLength(2)
    expect(merged.captionerProfiles.map((p) => p.provider).sort()).toEqual(['gemini', 'openai'])
  })

  it('当前反推配置只改变 provider 时不应被当作出厂默认替换', () => {
    const current = normalizeSettings({
      profiles: [
        {
          id: 'cur-img',
          name: 'Cur',
          provider: 'openai',
          baseUrl: 'https://img/v1',
          apiKey: 'ik',
          model: 'gpt-image-2',
          timeout: 600,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
      ],
      activeProfileId: 'cur-img',
      captionerProfiles: [
        {
          ...DEFAULT_SETTINGS.captionerProfiles[0],
          provider: 'gemini',
        },
      ],
      activeCaptionerProfileId: DEFAULT_CAPTIONER_PROFILE_ID,
    })

    const merged = mergeImportedSettings(current, {
      captionerProfiles: [
        {
          id: 'imp-cap',
          name: 'Imported',
          baseUrl: 'https://imp/v1',
          apiKey: '',
          model: 'imp-model',
          timeout: 30,
          systemPrompt: 'imported',
        },
      ],
      activeCaptionerProfileId: 'imp-cap',
    })

    expect(merged.activeCaptionerProfileId).toBe(DEFAULT_CAPTIONER_PROFILE_ID)
    expect(merged.captionerProfiles).toHaveLength(2)
    expect(merged.captionerProfiles[0]).toMatchObject({
      id: DEFAULT_CAPTIONER_PROFILE_ID,
      provider: 'gemini',
    })
  })
})
