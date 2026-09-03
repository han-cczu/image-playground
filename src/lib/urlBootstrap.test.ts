import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BASE_URL,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_IMAGES_MODEL,
  MAX_CONFIG_FIELD_LEN,
  normalizeSettings,
} from './api/apiProfiles'
import { applyUrlBootstrapToSettings, readUrlBootstrap } from './urlBootstrap'

describe('readUrlBootstrap', () => {
  it('prefers one-time API keys from the URL hash', () => {
    // apiKey 与 apiUrl 都只从 hash 读;查询串里的 apiKey 被忽略并清理。
    const result = readUrlBootstrap(
      'https://app.example.com/?apiKey=query-key#apiKey=hash-key&apiUrl=https://api.example.com/v1&provider=gemini',
    )

    expect(result.settings).toMatchObject({
      apiKey: 'hash-key',
      baseUrl: 'https://api.example.com/v1',
    })
    expect(result.provider).toBe('gemini')
    expect(result.cleanUrl).toBe('https://app.example.com/')
  })

  it('忽略查询串里的 apiUrl(只接受 hash),但仍将其从 URL 清理掉', () => {
    const result = readUrlBootstrap(
      'https://app.example.com/?apiUrl=https://evil.example.com&provider=openai',
    )

    expect(result.settings.baseUrl).toBeUndefined()
    // 查询串里的 provider 同样不摄入(否则一条外链就能重建激活 profile)
    expect(result.provider).toBeNull()
    expect(result.changed).toBe(true)
    expect(result.cleanUrl).toBe('https://app.example.com/')
  })

  it('忽略查询串里的 provider(只接受 hash),但仍将其从 URL 清理掉', () => {
    const result = readUrlBootstrap('https://app.example.com/?provider=gemini')

    expect(result.provider).toBeNull()
    expect(result.settings).toEqual({})
    expect(result.changed).toBe(true)
    expect(result.cleanUrl).toBe('https://app.example.com/')
  })

  it('接受 hash 里的 apiUrl', () => {
    const result = readUrlBootstrap('https://app.example.com/#apiUrl=https://api.example.com/v1')

    expect(result.settings.baseUrl).toBe('https://api.example.com/v1')
    expect(result.changed).toBe(true)
    expect(result.cleanUrl).toBe('https://app.example.com/')
  })

  it('preserves Gemini apiUrl version paths from the URL hash', () => {
    const result = readUrlBootstrap(
      'https://app.example.com/#provider=gemini&apiUrl=https%3A%2F%2Fgenerativelanguage.googleapis.com%2Fv1beta%2F',
    )

    expect(result.provider).toBe('gemini')
    expect(result.settings.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta')
    expect(result.cleanUrl).toBe('https://app.example.com/')
  })

  it('caps API bootstrap values read from the URL hash', () => {
    const longKey = 'k'.repeat(MAX_CONFIG_FIELD_LEN + 50)
    const longUrl = `https://api.example.com/${'x'.repeat(MAX_CONFIG_FIELD_LEN + 50)}`
    const result = readUrlBootstrap(
      `https://app.example.com/#apiKey=${encodeURIComponent(longKey)}&apiUrl=${encodeURIComponent(longUrl)}`,
    )

    expect(result.settings.apiKey).toHaveLength(MAX_CONFIG_FIELD_LEN)
    expect(result.settings.baseUrl).toHaveLength(MAX_CONFIG_FIELD_LEN)
  })

  it('忽略查询串里的 apiKey(只接受 hash),但仍将其从 URL 清理掉', () => {
    const result = readUrlBootstrap('https://app.example.com/?apiKey=query-key')

    expect(result.settings.apiKey).toBeUndefined()
    expect(result.changed).toBe(true)
    expect(result.cleanUrl).toBe('https://app.example.com/')
  })

  it('hash 里的 provider 只被读出,不在解析层清 key(是否真换厂商由 applyUrlBootstrapToSettings 判定)', () => {
    const result = readUrlBootstrap('https://app.example.com/#provider=gemini')

    expect(result.provider).toBe('gemini')
    expect(result.settings.apiKey).toBeUndefined()
    expect(result.changed).toBe(true)
    expect(result.cleanUrl).toBe('https://app.example.com/')
  })

  it('keeps non-sensitive hash fragments while clearing secret bootstrap values', () => {
    const result = readUrlBootstrap('https://app.example.com/#section=history&apiKey=hash-key')

    expect(result.settings.apiKey).toBe('hash-key')
    expect(result.cleanUrl).toBe('https://app.example.com/#section=history')
  })
})

describe('applyUrlBootstrapToSettings', () => {
  /** 激活 profile 是自建中转 + Responses 模式 + Codex 兼容 + 已填 key 的 OpenAI 用户——最容易被「重建」误伤的形态 */
  function gatewaySettings() {
    return normalizeSettings({
      profiles: [
        {
          id: 'relay',
          name: '中转',
          provider: 'openai',
          baseUrl: 'https://relay.example/v1',
          apiKey: 'sk-victim',
          model: 'gpt-image-1-mini',
          timeout: 120,
          apiMode: 'responses',
          codexCli: true,
          apiProxy: false,
        },
        {
          id: 'other',
          name: '备用',
          provider: 'gemini',
          baseUrl: DEFAULT_GEMINI_BASE_URL,
          apiKey: 'AIza-other',
          model: DEFAULT_GEMINI_MODEL,
          timeout: 60,
        },
      ],
      activeProfileId: 'relay',
    })
  }

  it('同 provider 的 #provider=openai 不重建激活 profile:网关地址/模型/模式/Codex 开关/密钥全部保留', () => {
    const settings = gatewaySettings()
    const next = applyUrlBootstrapToSettings(
      settings,
      readUrlBootstrap('https://app.example.com/#provider=openai'),
    )

    expect(next.activeProfileId).toBe('relay')
    expect(next.apiKey).toBeUndefined()
    expect(next.profiles?.find((p) => p.id === 'relay')).toEqual(settings.profiles[0])
    // 非激活 profile 不受影响
    expect(next.profiles?.find((p) => p.id === 'other')).toEqual(settings.profiles[1])
  })

  it('同 provider 的 #apiKey=…&provider=openai 只轮换密钥,其余字段原样保留', () => {
    const settings = gatewaySettings()
    const next = applyUrlBootstrapToSettings(
      settings,
      readUrlBootstrap('https://app.example.com/#apiKey=sk-rotated&provider=openai'),
    )

    expect(next.profiles?.find((p) => p.id === 'relay')).toEqual({
      ...settings.profiles[0],
      apiKey: 'sk-rotated',
    })
  })

  it('同 provider 时仍可叠加 hash 里显式给出的 apiMode / codexCli', () => {
    const settings = gatewaySettings()
    const next = applyUrlBootstrapToSettings(
      settings,
      readUrlBootstrap('https://app.example.com/#provider=openai&apiMode=images&codexCli=false'),
    )

    expect(next.profiles?.find((p) => p.id === 'relay')).toEqual({
      ...settings.profiles[0],
      apiMode: 'images',
      codexCli: false,
    })
  })

  it('真换厂商且未带新 key 时:重置为目标厂商默认端点/模型并清空密钥(旧厂商 key 不得发往新厂商)', () => {
    const settings = gatewaySettings()
    const next = applyUrlBootstrapToSettings(
      settings,
      readUrlBootstrap('https://app.example.com/#provider=gemini&apiMode=responses'),
    )

    expect(next.apiKey).toBe('')
    const relay = next.profiles?.find((p) => p.id === 'relay')
    expect(relay).toMatchObject({
      id: 'relay',
      name: '中转',
      provider: 'gemini',
      baseUrl: DEFAULT_GEMINI_BASE_URL,
      model: DEFAULT_GEMINI_MODEL,
      apiKey: '',
      timeout: 120,
    })
    // apiMode 是 OpenAI 专属字段,不得泄漏到 Gemini profile 上
    expect(relay).not.toHaveProperty('apiMode')
  })

  it('真换厂商且带新 key 时写入新 key', () => {
    const settings = gatewaySettings()
    const next = applyUrlBootstrapToSettings(
      settings,
      readUrlBootstrap('https://app.example.com/#provider=gemini&apiKey=AIza-new'),
    )

    expect(next.profiles?.find((p) => p.id === 'relay')).toMatchObject({
      provider: 'gemini',
      apiKey: 'AIza-new',
    })
  })

  it('从 Gemini 切回 OpenAI 时重置为 OpenAI 默认端点/模型', () => {
    const settings = normalizeSettings({
      profiles: [
        {
          id: 'g',
          name: 'G',
          provider: 'gemini',
          baseUrl: DEFAULT_GEMINI_BASE_URL,
          apiKey: 'AIza',
          model: DEFAULT_GEMINI_MODEL,
          timeout: 60,
        },
      ],
      activeProfileId: 'g',
    })
    const next = applyUrlBootstrapToSettings(
      settings,
      readUrlBootstrap('https://app.example.com/#provider=openai'),
    )

    expect(next.profiles?.[0]).toMatchObject({
      provider: 'openai',
      baseUrl: DEFAULT_BASE_URL,
      model: DEFAULT_IMAGES_MODEL,
      apiKey: '',
      apiMode: 'images',
      codexCli: false,
    })
  })

  it('纯查询串 ?provider=gemini 不产生任何 settings 变更', () => {
    const next = applyUrlBootstrapToSettings(
      gatewaySettings(),
      readUrlBootstrap('https://app.example.com/?provider=gemini'),
    )

    expect(next).toEqual({})
  })

  it('#apiUrl 不带 key 时清空密钥(不复用旧 key 发往新主机)', () => {
    const next = applyUrlBootstrapToSettings(
      gatewaySettings(),
      readUrlBootstrap('https://app.example.com/#apiUrl=https://new-host.example/v1'),
    )

    expect(next).toEqual({ baseUrl: 'https://new-host.example/v1', apiKey: '' })
  })
})

describe('readUrlBootstrap 的 defaultProvider', () => {
  it('链接未带 provider 时按激活 profile 的厂商归一化 #apiUrl:Gemini 不套 OpenAI 的补 /v1 规则', () => {
    const gemini = readUrlBootstrap(
      'https://app.example.com/#apiUrl=https://generativelanguage.googleapis.com/v1beta/',
      { defaultProvider: 'gemini' },
    )
    expect(gemini.settings.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta')

    // OpenAI 规则:粘进来的端点尾巴被剥掉、归一到基址
    const openai = readUrlBootstrap(
      'https://app.example.com/#apiUrl=https://relay.example/v1/chat/completions',
      { defaultProvider: 'openai' },
    )
    expect(openai.settings.baseUrl).toBe('https://relay.example/v1')

    // 链接自带 provider 时以链接为准
    const explicit = readUrlBootstrap(
      'https://app.example.com/#apiUrl=https://relay.example/v1/chat/completions&provider=openai',
      { defaultProvider: 'gemini' },
    )
    expect(explicit.settings.baseUrl).toBe('https://relay.example/v1')
  })
})
