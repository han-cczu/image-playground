import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { optimizePromptStream } from './optimizePromptApi'
import type { PromptOptimizerConfig } from '../../types'
import { MAX_TASK_TEXT_LEN } from '../tasks'

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
    vi.useRealTimers()
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

  it('caps streamed optimizer text and onDelta output before it reaches UI state', async () => {
    const long = 'x'.repeat(MAX_TASK_TEXT_LEN + 50)
    fetchMock.mockResolvedValue(
      makeSseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: long } }] })}\n\n`,
        'data: {"choices":[{"delta":{"content":"tail"}}]}\n\n',
      ]),
    )

    const deltas: string[] = []
    const result = await optimizePromptStream(baseConfig, 'draft', {
      onDelta: (chunk) => deltas.push(chunk),
    })

    expect(result).toBe(long.slice(0, MAX_TASK_TEXT_LEN))
    expect(deltas.join('')).toBe(long.slice(0, MAX_TASK_TEXT_LEN))
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
    await expect(optimizePromptStream({ ...baseConfig, apiKey: '   ' }, 'draft')).rejects.toThrow(
      /API Key/,
    )
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

  it('读取 HTTP 错误体期间取消时保留原始 cause', async () => {
    const controller = new AbortController()
    const cause = new Error('body read aborted')
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn(async () => {
        controller.abort(cause)
        return 'late error'
      }),
    } as unknown as Response)

    await expect(
      optimizePromptStream(baseConfig, 'draft', { signal: controller.signal }),
    ).rejects.toMatchObject({
      message: '已取消',
      cause,
    })
  })

  it('读取 HTTP 错误体期间取消时仍移除外部 abort listener', async () => {
    const controller = new AbortController()
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener')
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn(async () => {
        controller.abort(new Error('body read aborted'))
        return 'late error'
      }),
    } as unknown as Response)

    await optimizePromptStream(baseConfig, 'draft', { signal: controller.signal }).catch(() => {})

    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('读取 HTTP 错误体期间超时时抛出请求超时而非 HTTP 状态', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async (_url, init) => {
      const signal = (init as RequestInit).signal as AbortSignal
      return {
        ok: false,
        status: 500,
        text: vi.fn(
          () =>
            new Promise<string>((_resolve, reject) => {
              signal.addEventListener(
                'abort',
                () => reject(new DOMException('aborted', 'AbortError')),
                { once: true },
              )
            }),
        ),
      } as unknown as Response
    })

    const pending = optimizePromptStream({ ...baseConfig, timeout: 1 }, 'draft')
    const rejection = expect(pending).rejects.toMatchObject({ message: '请求超时' })

    await vi.advanceTimersByTimeAsync(1000)

    await rejection
  })

  it('fetch 阶段超时时即使 reject signal.reason 也抛出请求超时', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async (_url, init) => {
      const signal = (init as RequestInit).signal as AbortSignal
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })

    const pending = optimizePromptStream({ ...baseConfig, timeout: 1 }, 'draft')
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

    const pending = optimizePromptStream({ ...baseConfig, timeout: 1 }, 'draft')
    const observed = pending.then(
      () => 'resolved',
      (error: unknown) => error,
    )

    await vi.advanceTimersByTimeAsync(1000)

    const result = await Promise.race([observed, Promise.resolve('pending')])
    expect(result).toMatchObject({ message: '请求超时' })
    expect(reader.releaseLock).toHaveBeenCalled()
  })

  it('读取 200 SSE 流超时时不让 releaseLock 的二次错误覆盖超时错误', async () => {
    vi.useFakeTimers()
    const reader = {
      read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined)),
      releaseLock: vi.fn(() => {
        throw new TypeError('pending read')
      }),
    }
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => reader,
      },
    } as unknown as Response)

    const pending = optimizePromptStream({ ...baseConfig, timeout: 1 }, 'draft')
    const observed = pending.then(
      () => 'resolved',
      (error: unknown) => error,
    )

    await vi.advanceTimersByTimeAsync(1000)

    const result = await Promise.race([observed, Promise.resolve('pending')])
    expect(result).toMatchObject({ message: '请求超时' })
  })

  it('网络错误保留原始 cause 便于诊断', async () => {
    const cause = new Error('socket reset')
    fetchMock.mockRejectedValue(cause)
    await expect(optimizePromptStream(baseConfig, 'draft')).rejects.toMatchObject({
      message: expect.stringContaining('网络错误'),
      cause,
    })
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

  it('caller signal 已提前取消时不构建 OpenAI 请求体', async () => {
    const controller = new AbortController()
    const cause = new Error('caller canceled')
    controller.abort(cause)
    const stringifySpy = vi.spyOn(JSON, 'stringify')

    try {
      await expect(
        optimizePromptStream(baseConfig, 'draft', { signal: controller.signal }),
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
    vi.useRealTimers()
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

  it('caps streamed Gemini optimizer text and onDelta output', async () => {
    const long = 'x'.repeat(MAX_TASK_TEXT_LEN + 50)
    fetchMock.mockResolvedValue(
      makeSseResponse([
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: long }] } }] })}\n\n`,
        'data: {"candidates":[{"content":{"parts":[{"text":"tail"}]}}]}\n\n',
      ]),
    )

    const deltas: string[] = []
    const result = await optimizePromptStream(geminiConfig, 'draft', {
      onDelta: (chunk) => deltas.push(chunk),
    })

    expect(result).toBe(long.slice(0, MAX_TASK_TEXT_LEN))
    expect(deltas.join('')).toBe(long.slice(0, MAX_TASK_TEXT_LEN))
  })

  it('Gemini 网络错误保留原始 cause 便于诊断', async () => {
    const cause = new Error('socket reset')
    fetchMock.mockRejectedValue(cause)
    await expect(optimizePromptStream(geminiConfig, 'draft')).rejects.toMatchObject({
      message: expect.stringContaining('网络错误'),
      cause,
    })
  })

  it('caller signal 已提前取消时不构建 Gemini 请求体', async () => {
    const controller = new AbortController()
    const cause = new Error('caller canceled')
    controller.abort(cause)
    const stringifySpy = vi.spyOn(JSON, 'stringify')

    try {
      await expect(
        optimizePromptStream(geminiConfig, 'draft', { signal: controller.signal }),
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

  it('Gemini 读取 HTTP 错误体期间取消时保留原始 cause', async () => {
    const controller = new AbortController()
    const cause = new Error('body read aborted')
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn(async () => {
        controller.abort(cause)
        return 'late error'
      }),
    } as unknown as Response)

    await expect(
      optimizePromptStream(geminiConfig, 'draft', { signal: controller.signal }),
    ).rejects.toMatchObject({
      message: '已取消',
      cause,
    })
  })

  it('Gemini 读取 HTTP 错误体期间超时时抛出请求超时而非 HTTP 状态', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async (_url, init) => {
      const signal = (init as RequestInit).signal as AbortSignal
      return {
        ok: false,
        status: 500,
        text: vi.fn(
          () =>
            new Promise<string>((_resolve, reject) => {
              signal.addEventListener(
                'abort',
                () => reject(new DOMException('aborted', 'AbortError')),
                { once: true },
              )
            }),
        ),
      } as unknown as Response
    })

    const pending = optimizePromptStream({ ...geminiConfig, timeout: 1 }, 'draft')
    const rejection = expect(pending).rejects.toMatchObject({ message: '请求超时' })

    await vi.advanceTimersByTimeAsync(1000)

    await rejection
  })

  it('Gemini fetch 阶段超时时即使 reject signal.reason 也抛出请求超时', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async (_url, init) => {
      const signal = (init as RequestInit).signal as AbortSignal
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })

    const pending = optimizePromptStream({ ...geminiConfig, timeout: 1 }, 'draft')
    const rejection = expect(pending).rejects.toMatchObject({ message: '请求超时' })

    await vi.advanceTimersByTimeAsync(1000)

    await rejection
  })

  it('Gemini 非有限 timeout 回退默认值而不是传给 setTimeout', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    fetchMock.mockResolvedValue(
      makeSseResponse(['data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n']),
    )

    await expect(
      optimizePromptStream({ ...geminiConfig, timeout: Number.POSITIVE_INFINITY }, 'draft'),
    ).resolves.toBe('ok')

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 60_000)
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

    const pending = optimizePromptStream({ ...geminiConfig, timeout: 1 }, 'draft')
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
