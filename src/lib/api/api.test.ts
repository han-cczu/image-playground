import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../../types'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { callImageApi } from '.'

describe('callImageApi', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it.each([false, true])(
    'adds the prompt rewrite guard on Responses API when Codex CLI mode is %s',
    async (codexCli) => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
        output: [{
          type: 'image_generation_call',
          result: 'aW1hZ2U=',
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

      await callImageApi({
        settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses', codexCli },
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS },
        inputImageDataUrls: [],
      })

      const [, init] = fetchMock.mock.calls[0]
      const body = JSON.parse(String((init as RequestInit).body))
      expect(body.input).toBe('Use the following text as the complete prompt. Do not rewrite it:\nprompt')
    },
  )

  it('rejects non-image input data URLs before OpenAI Responses requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(
      callImageApi({
        settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses' },
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS },
        inputImageDataUrls: ['data:text/plain;base64,SGk='],
      }),
    ).rejects.toThrow('输入图片不是图片内容')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects empty input image payloads before OpenAI Responses requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(
      callImageApi({
        settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses' },
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS },
        inputImageDataUrls: ['data:image/png;base64,   '],
      }),
    ).rejects.toThrow('输入图片数据为空')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([1, 2])(
    'does not build OpenAI Responses request bodies when the caller signal is already aborted (n=%s)',
    async (n) => {
      const controller = new AbortController()
      controller.abort(new Error('user cancelled'))
      const stringifySpy = vi.spyOn(JSON, 'stringify')
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new DOMException('Aborted', 'AbortError'))

      await expect(
        callImageApi({
          settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses' },
          prompt: 'prompt',
          params: { ...DEFAULT_PARAMS, n },
          inputImageDataUrls: ['data:image/png;base64,aW1hZ2U='],
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ message: '已取消' })

      const requestBodyStringifyCalls = stringifySpy.mock.calls.filter(([value]) =>
        Boolean(value && typeof value === 'object' && 'input' in value),
      )
      expect(requestBodyStringifyCalls).toHaveLength(0)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('rejects non-image masks before OpenAI Responses requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(
      callImageApi({
        settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses' },
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS },
        inputImageDataUrls: ['data:image/png;base64,AQ=='],
        maskDataUrl: 'data:text/plain;base64,SGk=',
      }),
    ).rejects.toThrow('输入图片不是图片内容')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('records actual params returned on Images API responses in Codex CLI mode', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_format: 'png',
      quality: 'medium',
      size: '1033x1522',
      data: [{
        b64_json: 'aW1hZ2U=',
        revised_prompt: '移除靴子',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', codexCli: true },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.actualParams).toEqual({
      output_format: 'png',
      quality: 'medium',
      size: '1033x1522',
    })
    expect(result.actualParamsList).toEqual([{
      output_format: 'png',
      quality: 'medium',
      size: '1033x1522',
    }])
    expect(result.revisedPrompts).toEqual(['移除靴子'])
  })

  it('does not synthesize actual quality in Codex CLI mode when the API omits it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_format: 'png',
      size: '1033x1522',
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', codexCli: true },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(result.actualParams).toEqual({
      output_format: 'png',
      size: '1033x1522',
    })
    expect(result.actualParams?.quality).toBeUndefined()
    expect(result.actualParamsList).toEqual([{
      output_format: 'png',
      size: '1033x1522',
    }])
  })

  it('normalizes image params at the API boundary before building OpenAI Images requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      prompt: 'prompt',
      params: {
        ...DEFAULT_PARAMS,
        output_format: 'gif' as never,
        output_compression: 80,
        quality: 'ultra' as never,
        moderation: 'strict' as never,
        n: 1.7,
      },
      inputImageDataUrls: [],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body).toMatchObject({
      output_format: 'png',
      quality: 'auto',
      moderation: 'auto',
      n: 2,
    })
    expect(body.output_compression).toBeUndefined()
  })

  it('trims OpenAI API keys before sending authorization headers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: '  test-key  ' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    const [, init] = fetchMock.mock.calls[0]
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer test-key',
    })
  })

  it('caps huge OpenAI image API timeouts before passing them to setTimeout', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        timeout: Number.MAX_SAFE_INTEGER,
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2_147_483_647)
  })

  it('normalizes image params against the execution profile override even when settings contain a stale same-id profile', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const storedProfile = {
      ...DEFAULT_SETTINGS.profiles[0],
      id: 'profile-a',
      codexCli: true,
    }
    const executionProfile = {
      ...storedProfile,
      codexCli: false,
    }

    await callImageApi(
      {
        settings: {
          ...DEFAULT_SETTINGS,
          profiles: [storedProfile],
          activeProfileId: storedProfile.id,
          codexCli: true,
        },
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS, quality: 'high' },
        inputImageDataUrls: [],
      },
      executionProfile,
    )

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.quality).toBe('high')
  })

  it('uses the same-origin API proxy path when API proxy is enabled', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiProxy: true,
        baseUrl: 'http://api.example.com/v1',
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api-proxy/images/generations',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('ignores stored API proxy settings when the current deployment has no proxy', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'false')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiProxy: true,
        baseUrl: 'http://api.example.com/v1',
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.example.com/v1/images/generations',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('reports partial failures for concurrent OpenAI Images API requests', async () => {
    let callIndex = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callIndex += 1
      if (callIndex === 2) {
        return new Response(JSON.stringify({
          error: { message: 'second request failed' },
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({
        data: [{ b64_json: `aW1hZ2Ut${callIndex}` }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', codexCli: true },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 3 },
      inputImageDataUrls: [],
    })

    expect(result.images).toHaveLength(2)
    expect(result.partialFailureCount).toBe(1)
    expect(result.partialFailureMessage).toContain('second request failed')
    expect(result.actualParams).toMatchObject({ n: 2 })
  })

  it('does not turn a cancelled concurrent OpenAI Images request into partial success', async () => {
    const controller = new AbortController()
    let callIndex = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      callIndex += 1
      if (callIndex === 1) {
        return new Response(JSON.stringify({
          data: [{ b64_json: 'aW1hZ2U=' }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const signal = (init as RequestInit).signal as AbortSignal
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        )
      })
    })

    const request = callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', codexCli: true },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 3 },
      inputImageDataUrls: [],
      signal: controller.signal,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort()

    await expect(request).rejects.toMatchObject({ message: '已取消' })
  })

  it('reports partial failures for concurrent OpenAI Responses API requests', async () => {
    let callIndex = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callIndex += 1
      if (callIndex === 1) {
        return new Response(JSON.stringify({
          error: { message: 'first responses request failed' },
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({
        output: [{
          type: 'image_generation_call',
          result: `aW1hZ2Ut${callIndex}`,
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 3 },
      inputImageDataUrls: [],
    })

    expect(result.images).toHaveLength(2)
    expect(result.partialFailureCount).toBe(1)
    expect(result.partialFailureMessage).toContain('first responses request failed')
    expect(result.actualParams).toMatchObject({ n: 2 })
  })

  it('does not turn a cancelled concurrent OpenAI Responses request into partial success', async () => {
    const controller = new AbortController()
    let callIndex = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      callIndex += 1
      if (callIndex === 1) {
        return new Response(JSON.stringify({
          output: [{
            type: 'image_generation_call',
            result: 'aW1hZ2U=',
          }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const signal = (init as RequestInit).signal as AbortSignal
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        )
      })
    })

    const request = callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 3 },
      inputImageDataUrls: [],
      signal: controller.signal,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort()

    await expect(request).rejects.toMatchObject({ message: '已取消' })
  })

  it('passes a cancellable caller abort signal through OpenAI requests', async () => {
    const controller = new AbortController()
    // 调用前即取消:合并后的请求 signal 应反映 caller 的取消,验证 caller→fetch 的接线。
    // (请求完成后 mergeAbortSignals 的 dispose 会解绑监听以防泄漏,故不再断言「完成后再 abort 仍传播」。)
    controller.abort()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
      signal: controller.signal,
    }).catch(() => {})

    const [, init] = fetchMock.mock.calls[0]
    const requestSignal = (init as RequestInit).signal as AbortSignal
    expect(requestSignal).toBeDefined()
    expect(requestSignal.aborted).toBe(true)
  })

  it('reports caller abort as cancellation in OpenAI image requests', async () => {
    const controller = new AbortController()
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = (init as RequestInit).signal as AbortSignal
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
        }),
    )

    const request = callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
      signal: controller.signal,
    })
    controller.abort()

    await expect(request).rejects.toMatchObject({ message: '已取消' })
  })

  it('keeps provider timeout active when a caller abort signal is provided', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = (init as RequestInit).signal as AbortSignal
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
        }),
    )

    const request = callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', timeout: 1 },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
      signal: new AbortController().signal,
    })
    const rejection = expect(request).rejects.toThrow()

    await vi.advanceTimersByTimeAsync(1000)

    await rejection
    vi.useRealTimers()
  })

  it('reports provider timeout while reading a hanging OpenAI Images error body', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn(() => new Promise<string>(() => undefined)),
    } as unknown as Response)

    const request = callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', timeout: 1 },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })
    const rejection = expect(request).rejects.toMatchObject({ message: '请求超时' })

    await vi.advanceTimersByTimeAsync(1000)

    await rejection
    vi.useRealTimers()
  })

  it('reports provider timeout while reading a hanging OpenAI Images success body', async () => {
    vi.useFakeTimers()
    let rejectText!: (error: Error) => void
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: vi.fn(() => new Promise<string>((_resolve, reject) => {
        rejectText = reject
      })),
    } as unknown as Response)

    const request = callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', timeout: 1 },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })
    const observed = request.then(
      () => 'resolved',
      (error: unknown) => error,
    )

    await vi.advanceTimersByTimeAsync(1000)

    try {
      const result = await Promise.race([
        observed,
        Promise.resolve('pending'),
      ])
      expect(result).toMatchObject({ message: '请求超时' })
    } finally {
      rejectText(new Error('cleanup'))
      await request.catch(() => undefined)
      vi.useRealTimers()
    }
  })

  it('reports provider timeout while reading a hanging OpenAI Images result URL body', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ url: 'https://cdn.example.com/result.png' }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        blob: vi.fn(() => new Promise<Blob>(() => undefined)),
      } as unknown as Response)

    const request = callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', timeout: 1 },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })
    const rejection = expect(request).rejects.toMatchObject({ message: '请求超时' })

    await vi.advanceTimersByTimeAsync(1000)

    await rejection
    vi.useRealTimers()
  })

  it('reports provider timeout while reading a hanging OpenAI Responses error body', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn(() => new Promise<string>(() => undefined)),
    } as unknown as Response)

    const request = callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses', timeout: 1 },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })
    const rejection = expect(request).rejects.toMatchObject({ message: '请求超时' })

    await vi.advanceTimersByTimeAsync(1000)

    await rejection
    vi.useRealTimers()
  })

  it('reports provider timeout while reading a hanging OpenAI Responses success body', async () => {
    vi.useFakeTimers()
    let rejectText!: (error: Error) => void
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: vi.fn(() => new Promise<string>((_resolve, reject) => {
        rejectText = reject
      })),
    } as unknown as Response)

    const request = callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses', timeout: 1 },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })
    const observed = request.then(
      () => 'resolved',
      (error: unknown) => error,
    )

    await vi.advanceTimersByTimeAsync(1000)

    try {
      const result = await Promise.race([
        observed,
        Promise.resolve('pending'),
      ])
      expect(result).toMatchObject({ message: '请求超时' })
    } finally {
      rejectText(new Error('cleanup'))
      await request.catch(() => undefined)
      vi.useRealTimers()
    }
  })
})
