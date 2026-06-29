import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captionImageStream } from './captionImageApi'
import type { CaptionerConfig } from '../../types'
import { MAX_TASK_TEXT_LEN } from '../tasks'

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
    vi.useRealTimers()
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

  it('caps streamed caption text and onDelta output before it reaches UI state', async () => {
    const long = 'x'.repeat(MAX_TASK_TEXT_LEN + 50)
    fetchMock.mockResolvedValue(
      makeSseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: long } }] })}\n\n`,
        'data: {"choices":[{"delta":{"content":"tail"}}]}\n\n',
      ]),
    )
    const deltas: string[] = []

    const result = await captionImageStream(baseConfig, IMG, { onDelta: (c) => deltas.push(c) })

    expect(result).toBe(long.slice(0, MAX_TASK_TEXT_LEN))
    expect(deltas.join('')).toBe(long.slice(0, MAX_TASK_TEXT_LEN))
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
    const imagePart = body.messages[1].content.find(
      (p: { type?: string }) => p.type === 'image_url',
    )
    expect(imagePart).toBeTruthy()
    expect(imagePart.image_url.url).toBe(IMG)
    const textPart = body.messages[1].content.find((p: { type?: string }) => p.type === 'text')
    expect(typeof textPart.text).toBe('string')
  })

  it('未配置 API Key 时直接抛错，不发请求', async () => {
    await expect(captionImageStream({ ...baseConfig, apiKey: '  ' }, IMG)).rejects.toThrow(
      /API Key/,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('未提供图片时直接抛错', async () => {
    await expect(captionImageStream(baseConfig, '  ')).rejects.toThrow(/图片/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('OpenAI provider 拒绝非图片 data URL 且不发请求', async () => {
    await expect(captionImageStream(baseConfig, 'data:text/plain;base64,SGk=')).rejects.toThrow(
      '输入图片不是图片内容',
    )

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('OpenAI provider 拒绝空图片 payload 且不发请求', async () => {
    await expect(captionImageStream(baseConfig, 'data:image/png;base64,   ')).rejects.toThrow(
      '输入图片数据为空',
    )

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

  it('caller signal 已提前取消时不构建 OpenAI 请求体', async () => {
    const controller = new AbortController()
    const cause = new Error('caller canceled')
    controller.abort(cause)
    const stringifySpy = vi.spyOn(JSON, 'stringify')

    try {
      await expect(
        captionImageStream(baseConfig, IMG, { signal: controller.signal }),
      ).rejects.toMatchObject({
        message: '已取消',
        cause,
      })
    } finally {
      stringifySpy.mockRestore()
    }

    const requestBodyStringifies = stringifySpy.mock.calls.filter(([value]) =>
      Boolean(value && typeof value === 'object' && 'messages' in value),
    )
    expect(requestBodyStringifies).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetch 阶段超时时即使 reject signal.reason 也抛出请求超时', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async (_url, init) => {
      const signal = (init as RequestInit).signal as AbortSignal
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })

    const pending = captionImageStream({ ...baseConfig, timeout: 1 }, IMG)
    const rejection = expect(pending).rejects.toMatchObject({ message: '请求超时' })

    await vi.advanceTimersByTimeAsync(1000)

    await rejection
  })

  it('读取 200 SSE 流期间超时时即使 reader 忽略 abort 也抛出请求超时', async () => {
    vi.useFakeTimers()
    const reader = {
      read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined)),
      releaseLock: vi.fn(),
    }
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => reader,
      },
    } as unknown as Response)

    const pending = captionImageStream({ ...baseConfig, timeout: 1 }, IMG)
    const observed = pending.then(
      () => 'resolved',
      (error: unknown) => error,
    )

    await vi.advanceTimersByTimeAsync(1000)

    const result = await Promise.race([observed, Promise.resolve('pending')])
    expect(result).toMatchObject({ message: '请求超时' })
    expect(reader.releaseLock).toHaveBeenCalled()
  })
})

describe('captionImageStream — Gemini provider', () => {
  const geminiConfig: CaptionerConfig = {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: 'gm-key',
    model: 'gemini-2.5-flash',
    timeout: 30,
    systemPrompt: 'You reverse-engineer image prompts.',
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

  it('走 streamGenerateContent?alt=sse,x-goog-api-key 鉴权,inlineData + systemInstruction', async () => {
    fetchMock.mockResolvedValue(
      makeSseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"a "}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"cat"}]}}]}\n\n',
      ]),
    )
    const deltas: string[] = []
    const result = await captionImageStream(geminiConfig, IMG, { onDelta: (c) => deltas.push(c) })
    expect(result).toBe('a cat')
    expect(deltas).toEqual(['a ', 'cat'])

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/models/gemini-2.5-flash:streamGenerateContent?alt=sse')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['x-goog-api-key']).toBe('gm-key')
    expect(headers.Authorization).toBeUndefined() // 非 Bearer
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.systemInstruction.parts[0].text).toBe(geminiConfig.systemPrompt)
    const parts = body.contents[0].parts
    expect(parts[0].text).toBeTruthy()
    expect(parts[1].inline_data.mime_type).toBe('image/png')
    expect(parts[1].inline_data.data).toBe('iVBORw0KGgo=') // data URL 拆出的纯 base64
  })

  it('Gemini provider 接受 uppercase-scheme 图片 data URL', async () => {
    fetchMock.mockResolvedValue(
      makeSseResponse(['data: {"candidates":[{"content":{"parts":[{"text":"caption"}]}}]}\n\n']),
    )

    await expect(
      captionImageStream(geminiConfig, 'DATA:image/png;base64,iVBORw0KGgo='),
    ).resolves.toBe('caption')

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.contents[0].parts[1].inline_data).toEqual({
      mime_type: 'image/png',
      data: 'iVBORw0KGgo=',
    })
  })

  it('Gemini provider 拒绝非图片 data URL 且不发请求', async () => {
    await expect(captionImageStream(geminiConfig, 'data:text/plain;base64,SGk=')).rejects.toThrow(
      '输入图片不是图片内容',
    )

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Gemini provider 拒绝空图片 payload 且不发请求', async () => {
    await expect(captionImageStream(geminiConfig, 'data:image/png;base64,   ')).rejects.toThrow(
      '输入图片数据为空',
    )

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('caller signal 已提前取消时不构建 Gemini 请求体', async () => {
    const controller = new AbortController()
    const cause = new Error('caller canceled')
    controller.abort(cause)
    const stringifySpy = vi.spyOn(JSON, 'stringify')

    try {
      await expect(
        captionImageStream(geminiConfig, IMG, { signal: controller.signal }),
      ).rejects.toMatchObject({
        message: '已取消',
        cause,
      })
    } finally {
      stringifySpy.mockRestore()
    }

    const requestBodyStringifies = stringifySpy.mock.calls.filter(([value]) =>
      Boolean(value && typeof value === 'object' && 'contents' in value),
    )
    expect(requestBodyStringifies).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('caps streamed Gemini caption text and onDelta output', async () => {
    const long = 'x'.repeat(MAX_TASK_TEXT_LEN + 50)
    fetchMock.mockResolvedValue(
      makeSseResponse([
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: long }] } }] })}\n\n`,
        'data: {"candidates":[{"content":{"parts":[{"text":"tail"}]}}]}\n\n',
      ]),
    )
    const deltas: string[] = []

    const result = await captionImageStream(geminiConfig, IMG, { onDelta: (c) => deltas.push(c) })

    expect(result).toBe(long.slice(0, MAX_TASK_TEXT_LEN))
    expect(deltas.join('')).toBe(long.slice(0, MAX_TASK_TEXT_LEN))
  })

  it('拼接一帧内多个 text part(thinking/多 part)', async () => {
    fetchMock.mockResolvedValue(
      makeSseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"foo"},{"functionCall":{}},{"text":"bar"}]}}]}\n\n',
      ]),
    )
    expect(await captionImageStream(geminiConfig, IMG)).toBe('foobar')
  })

  it('200 流内 blockReason 在空结果时被抠出为可读错误(非"结果为空")', async () => {
    fetchMock.mockResolvedValue(
      makeSseResponse(['data: {"promptFeedback":{"blockReason":"SAFETY"}}\n\n']),
    )
    await expect(captionImageStream(geminiConfig, IMG)).rejects.toThrow(/SAFETY/)
  })

  it('Gemini 读取 200 SSE 流期间超时时即使 reader 忽略 abort 也抛出请求超时', async () => {
    vi.useFakeTimers()
    const reader = {
      read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined)),
      releaseLock: vi.fn(),
    }
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => reader,
      },
    } as unknown as Response)

    const pending = captionImageStream({ ...geminiConfig, timeout: 1 }, IMG)
    const observed = pending.then(
      () => 'resolved',
      (error: unknown) => error,
    )

    await vi.advanceTimersByTimeAsync(1000)

    const result = await Promise.race([observed, Promise.resolve('pending')])
    expect(result).toMatchObject({ message: '请求超时' })
    expect(reader.releaseLock).toHaveBeenCalled()
  })
})
