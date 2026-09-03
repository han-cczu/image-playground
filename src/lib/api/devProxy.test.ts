import { describe, expect, it } from 'vitest'
import { buildApiUrl, normalizeDevProxyConfig } from './devProxy'

describe('buildApiUrl', () => {
  it('uses the same-origin proxy prefix when API proxy is enabled', () => {
    expect(buildApiUrl('http://api.example.com/v1', 'images/edits', null, true)).toBe(
      '/api-proxy/images/edits',
    )
  })

  it('keeps the v1 segment when the configured API URL does not include it', () => {
    expect(buildApiUrl('http://api.example.com', 'images/generations', null, true)).toBe(
      '/api-proxy/v1/images/generations',
    )
  })

  it('uses a configured proxy prefix when one is available', () => {
    expect(
      buildApiUrl(
        'http://api.example.com/v1',
        'responses',
        {
          enabled: true,
          prefix: '/openai-proxy',
          target: 'http://api.example.com/v1',
          changeOrigin: true,
          secure: false,
        },
        true,
      ),
    ).toBe('/openai-proxy/responses')
  })

  it('uses the configured API URL directly when API proxy is disabled', () => {
    expect(buildApiUrl('http://api.example.com/v1', 'responses', null, false)).toBe(
      'http://api.example.com/v1/responses',
    )
  })

  it('rejects non-http API URLs before building direct request URLs', () => {
    expect(() => buildApiUrl('ftp://api.example.com/v1', 'responses', null, false)).toThrow(
      '未配置 API URL',
    )
  })
})

describe('normalizeDevProxyConfig', () => {
  it('rejects non-http proxy targets', () => {
    expect(
      normalizeDevProxyConfig({ enabled: true, target: 'ftp://api.example.com/v1' }),
    ).toBeNull()
  })
})

describe('normalizeBaseUrl 对网关前缀路径的处理', () => {
  it('保留 v1 之后的网关路径(Cloudflare AI Gateway),拼端点时不再额外插 v1', () => {
    const gateway = 'https://gateway.ai.cloudflare.com/v1/acct/gw/openai'
    expect(buildApiUrl(gateway, 'images/generations')).toBe(`${gateway}/images/generations`)
    expect(buildApiUrl(`${gateway}/`, 'images/edits')).toBe(`${gateway}/images/edits`)
  })

  it('v1beta 这类版本段同样视为已带版本,不补 v1', () => {
    expect(buildApiUrl('https://generativelanguage.googleapis.com/v1beta/openai', 'models')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/models',
    )
  })

  it('粘贴完整端点地址时剥掉端点尾巴,归一到基址', () => {
    expect(buildApiUrl('https://api.openai.com/v1/chat/completions', 'models')).toBe(
      'https://api.openai.com/v1/models',
    )
    expect(buildApiUrl('https://api.openai.com/v1/images/generations', 'images/edits')).toBe(
      'https://api.openai.com/v1/images/edits',
    )
    expect(
      buildApiUrl(
        'https://gateway.ai.cloudflare.com/v1/acct/gw/openai/chat/completions',
        'responses',
      ),
    ).toBe('https://gateway.ai.cloudflare.com/v1/acct/gw/openai/responses')
  })

  it('无版本段的自定义前缀路径仍按旧口径补 /v1', () => {
    expect(buildApiUrl('https://relay.example/openai', 'models')).toBe(
      'https://relay.example/openai/v1/models',
    )
    expect(buildApiUrl('https://relay.example', 'models')).toBe('https://relay.example/v1/models')
  })
})
