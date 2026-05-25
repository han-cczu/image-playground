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
