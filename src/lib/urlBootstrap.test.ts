import { describe, expect, it } from 'vitest'
import { MAX_CONFIG_FIELD_LEN } from './api/apiProfiles'
import { readUrlBootstrap } from './urlBootstrap'

describe('readUrlBootstrap', () => {
  it('prefers one-time API keys from the URL hash', () => {
    // apiKey 与 apiUrl 都只从 hash 读;查询串里的 apiKey 被忽略并清理。
    const result = readUrlBootstrap('https://app.example.com/?apiKey=query-key#apiKey=hash-key&apiUrl=https://api.example.com/v1&provider=gemini')

    expect(result.settings).toMatchObject({
      apiKey: 'hash-key',
      baseUrl: 'https://api.example.com/v1',
    })
    expect(result.provider).toBe('gemini')
    expect(result.cleanUrl).toBe('https://app.example.com/')
  })

  it('忽略查询串里的 apiUrl(只接受 hash),但仍将其从 URL 清理掉', () => {
    const result = readUrlBootstrap('https://app.example.com/?apiUrl=https://evil.example.com&provider=openai')

    expect(result.settings.baseUrl).toBeUndefined()
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

  it('clears the existing API key when a provider switch does not provide a hash API key', () => {
    const result = readUrlBootstrap('https://app.example.com/#provider=gemini')

    expect(result.provider).toBe('gemini')
    expect(result.settings.apiKey).toBe('')
    expect(result.changed).toBe(true)
    expect(result.cleanUrl).toBe('https://app.example.com/')
  })

  it('keeps non-sensitive hash fragments while clearing secret bootstrap values', () => {
    const result = readUrlBootstrap('https://app.example.com/#section=history&apiKey=hash-key')

    expect(result.settings.apiKey).toBe('hash-key')
    expect(result.cleanUrl).toBe('https://app.example.com/#section=history')
  })
})
