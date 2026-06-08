import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { optimizePromptStream } from './optimizePromptApi'
import type { PromptOptimizerConfig } from '../../types'

const baseConfig: PromptOptimizerConfig = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-4o-mini',
  timeout: 30,
  systemPrompt: 'You are a helpful assistant.',
}

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

describe('optimizePromptStream', () => {
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
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"!"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    )

    const deltas: string[] = []
    const result = await optimizePromptStream(baseConfig, 'draft', {
      onDelta: (chunk) => deltas.push(chunk),
    })

    expect(result).toBe('Hello world!')
    expect(deltas).toEqual(['Hello', ' world', '!'])
  })

  it('拼接的请求 URL 包含 /v1/chat/completions', async () => {
    fetchMock.mockResolvedValue(makeSseResponse(['data: [DONE]\n\n']))
    await optimizePromptStream(baseConfig, 'draft').catch(() => {
      // 空结果也会抛错，但我们只关心 URL
    })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(typeof url).toBe('string')
    expect(url).toContain('/v1/chat/completions')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.stream).toBe(true)
    expect(body.messages[0]).toEqual({ role: 'system', content: baseConfig.systemPrompt })
    expect(body.messages[1]).toEqual({ role: 'user', content: 'draft' })
  })

  it('未配置 API Key 时直接抛错，不发请求', async () => {
    await expect(
      optimizePromptStream({ ...baseConfig, apiKey: '   ' }, 'draft'),
    ).rejects.toThrow(/API Key/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('用户输入为空时直接抛错', async () => {
    await expect(optimizePromptStream(baseConfig, '   ')).rejects.toThrow(/提示词为空/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('HTTP 非 2xx 抛出包含状态码的错误', async () => {
    fetchMock.mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    await expect(optimizePromptStream(baseConfig, 'draft')).rejects.toThrow(/HTTP 401/)
  })

  it('优化结果为空（仅 [DONE]）抛错', async () => {
    fetchMock.mockResolvedValue(makeSseResponse(['data: [DONE]\n\n']))
    await expect(optimizePromptStream(baseConfig, 'draft')).rejects.toThrow(/结果为空/)
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
    const pending = optimizePromptStream(baseConfig, 'draft', { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow(/已取消/)
  })

  it('忽略无法解析的 SSE 行', async () => {
    fetchMock.mockResolvedValue(
      makeSseResponse([
        ': keep-alive\n\n',
        'data: not-json\n\n',
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    )
    const result = await optimizePromptStream(baseConfig, 'draft')
    expect(result).toBe('ok')
  })
})

describe('optimizePromptStream — Gemini provider', () => {
  const geminiConfig: PromptOptimizerConfig = {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: 'gm-key',
    model: 'gemini-2.5-flash',
    timeout: 30,
    systemPrompt: 'You are a prompt engineer.',
    provider: 'gemini',
  }
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('纯文本(无 inlineData)走 Gemini generateContent,systemInstruction 映射', async () => {
    fetchMock.mockResolvedValue(
      makeSseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"better "}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"prompt"}]}}]}\n\n',
      ]),
    )
    const result = await optimizePromptStream(geminiConfig, 'draft')
    expect(result).toBe('better prompt')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain(':streamGenerateContent?alt=sse')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.systemInstruction.parts[0].text).toBe(geminiConfig.systemPrompt)
    const parts = body.contents[0].parts
    expect(parts).toHaveLength(1) // 纯文本,无图 part
    expect(parts[0].text).toBe('draft')
  })
})
