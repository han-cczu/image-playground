import { describe, expect, it } from 'vitest'
import { readUrlBootstrap } from './urlBootstrap'

describe('readUrlBootstrap', () => {
  it('prefers one-time API keys from the URL hash', () => {
    const result = readUrlBootstrap('https://app.example.com/?apiKey=query-key&apiUrl=https://api.example.com/v1#apiKey=hash-key&provider=gemini')

    expect(result.settings).toMatchObject({
      apiKey: 'hash-key',
      baseUrl: 'https://api.example.com/v1',
    })
    expect(result.provider).toBe('gemini')
    expect(result.cleanUrl).toBe('https://app.example.com/')
  })

  it('keeps non-sensitive hash fragments while clearing secret bootstrap values', () => {
    const result = readUrlBootstrap('https://app.example.com/#section=history&apiKey=hash-key')

    expect(result.settings.apiKey).toBe('hash-key')
    expect(result.cleanUrl).toBe('https://app.example.com/#section=history')
  })
})
