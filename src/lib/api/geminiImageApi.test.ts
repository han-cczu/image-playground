import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../../types'
import { DEFAULT_GEMINI_BASE_URL, DEFAULT_GEMINI_MODEL, DEFAULT_SETTINGS } from './apiProfiles'
import { callImageApi } from '.'
import { dataUrlToInlinePart } from './geminiImageApi'

describe('dataUrlToInlinePart', () => {
  it('accepts data URLs whose scheme uses uppercase letters', () => {
    expect(dataUrlToInlinePart('DATA:image/png;base64,aW1hZ2U=')).toEqual({
      inline_data: {
        mime_type: 'image/png',
        data: 'aW1hZ2U=',
      },
    })
  })

  it('accepts image data URLs with metadata parameters before base64', () => {
    expect(dataUrlToInlinePart('data:image/png;name=input.png;base64,aW1hZ2U=')).toEqual({
      inline_data: {
        mime_type: 'image/png',
        data: 'aW1hZ2U=',
      },
    })
  })

  it('rejects image data URLs with an empty base64 payload', () => {
    expect(() => dataUrlToInlinePart('data:image/png;base64,   ')).toThrow('输入图片数据为空')
  })

  it('rejects data URLs whose MIME type is not an image', () => {
    expect(() => dataUrlToInlinePart('data:text/plain;base64,SGk=')).toThrow('输入图片不是图片内容')
  })
})

describe('callGeminiImageApi', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('reports partial failures for concurrent Gemini requests', async () => {
    let callIndex = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callIndex += 1
      if (callIndex === 3) {
        return new Response(
          JSON.stringify({
            error: { message: 'gemini request failed' },
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inline_data: {
                      mime_type: 'image/png',
                      data: `aW1hZ2Ut${callIndex}`,
                    },
                  },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    })

    const result = await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        activeProfileId: 'gemini',
        profiles: [
          {
            id: 'gemini',
            name: 'Gemini',
            provider: 'gemini',
            baseUrl: DEFAULT_GEMINI_BASE_URL,
            apiKey: 'gemini-key',
            model: DEFAULT_GEMINI_MODEL,
            timeout: 600,
          },
        ],
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 3 },
      inputImageDataUrls: [],
    })

    expect(result.images).toHaveLength(2)
    expect(result.partialFailureCount).toBe(1)
    expect(result.partialFailureMessage).toContain('gemini request failed')
    expect(result.actualParams).toMatchObject({ n: 2 })
  })

  it('does not turn a cancelled concurrent Gemini request into partial success', async () => {
    const controller = new AbortController()
    let callIndex = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      callIndex += 1
      if (callIndex === 1) {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inline_data: {
                        mime_type: 'image/png',
                        data: 'aW1hZ2U=',
                      },
                    },
                  ],
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      const signal = (init as RequestInit).signal as AbortSignal
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        })
      })
    })

    const request = callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        activeProfileId: 'gemini',
        profiles: [
          {
            id: 'gemini',
            name: 'Gemini',
            provider: 'gemini',
            baseUrl: DEFAULT_GEMINI_BASE_URL,
            apiKey: 'gemini-key',
            model: DEFAULT_GEMINI_MODEL,
            timeout: 600,
          },
        ],
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 3 },
      inputImageDataUrls: [],
      signal: controller.signal,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort()

    await expect(request).rejects.toMatchObject({ message: '已取消' })
  })

  it.each([1, 2])(
    'does not build Gemini request bodies when the caller signal is already aborted (n=%s)',
    async (n) => {
      const controller = new AbortController()
      controller.abort(new Error('user cancelled'))
      const stringifySpy = vi.spyOn(JSON, 'stringify')
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new DOMException('Aborted', 'AbortError'))

      await expect(
        callImageApi({
          settings: {
            ...DEFAULT_SETTINGS,
            activeProfileId: 'gemini',
            profiles: [
              {
                id: 'gemini',
                name: 'Gemini',
                provider: 'gemini',
                baseUrl: DEFAULT_GEMINI_BASE_URL,
                apiKey: 'gemini-key',
                model: DEFAULT_GEMINI_MODEL,
                timeout: 600,
              },
            ],
          },
          prompt: 'prompt',
          params: { ...DEFAULT_PARAMS, n },
          inputImageDataUrls: ['data:image/png;base64,aW1hZ2U='],
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ message: '已取消' })

      const requestBodyStringifyCalls = stringifySpy.mock.calls.filter(([value]) =>
        Boolean(value && typeof value === 'object' && 'contents' in value),
      )
      expect(requestBodyStringifyCalls).toHaveLength(0)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('serializes concurrent Gemini request bodies once and reuses them for fan-out', async () => {
    const stringifySpy = vi.spyOn(JSON, 'stringify')
    const bodies: Array<BodyInit | null | undefined> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      bodies.push((init as RequestInit).body)
      return new Response(
        '{"candidates":[{"content":{"parts":[{"inline_data":{"mime_type":"image/png","data":"aW1hZ2U="}}]}}]}',
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    })

    await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        activeProfileId: 'gemini',
        profiles: [
          {
            id: 'gemini',
            name: 'Gemini',
            provider: 'gemini',
            baseUrl: DEFAULT_GEMINI_BASE_URL,
            apiKey: 'gemini-key',
            model: DEFAULT_GEMINI_MODEL,
            timeout: 600,
          },
        ],
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 3 },
      inputImageDataUrls: ['data:image/png;base64,aW1hZ2U='],
    })

    const requestBodyStringifyCalls = stringifySpy.mock.calls.filter(([value]) =>
      Boolean(value && typeof value === 'object' && 'contents' in value),
    )
    expect(requestBodyStringifyCalls).toHaveLength(1)
    expect(bodies).toHaveLength(3)
    expect(new Set(bodies).size).toBe(1)
  })

  it('serializes uppercase-scheme input data URLs into Gemini inline data parts', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        '{"candidates":[{"content":{"parts":[{"inline_data":{"mime_type":"image/png","data":"aW1hZ2U="}}]}}]}',
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )

    await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        activeProfileId: 'gemini',
        profiles: [
          {
            id: 'gemini',
            name: 'Gemini',
            provider: 'gemini',
            baseUrl: DEFAULT_GEMINI_BASE_URL,
            apiKey: 'gemini-key',
            model: DEFAULT_GEMINI_MODEL,
            timeout: 600,
          },
        ],
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 1 },
      inputImageDataUrls: ['DATA:image/png;base64,aW1hZ2U='],
    })

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.contents[0].parts[1].inline_data).toEqual({
      mime_type: 'image/png',
      data: 'aW1hZ2U=',
    })
  })

  it('trims Gemini API keys before sending x-goog-api-key headers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        '{"candidates":[{"content":{"parts":[{"inline_data":{"mime_type":"image/png","data":"aW1hZ2U="}}]}}]}',
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )

    await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        activeProfileId: 'gemini',
        profiles: [
          {
            id: 'gemini',
            name: 'Gemini',
            provider: 'gemini',
            baseUrl: DEFAULT_GEMINI_BASE_URL,
            apiKey: '  gemini-key  ',
            model: DEFAULT_GEMINI_MODEL,
            timeout: 600,
          },
        ],
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 1 },
      inputImageDataUrls: [],
    })

    const [, init] = fetchMock.mock.calls[0]
    expect((init as RequestInit).headers).toMatchObject({
      'x-goog-api-key': 'gemini-key',
    })
  })

  it('caps huge Gemini image API timeouts before passing them to setTimeout', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        '{"candidates":[{"content":{"parts":[{"inline_data":{"mime_type":"image/png","data":"aW1hZ2U="}}]}}]}',
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )

    await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        activeProfileId: 'gemini',
        profiles: [
          {
            id: 'gemini',
            name: 'Gemini',
            provider: 'gemini',
            baseUrl: DEFAULT_GEMINI_BASE_URL,
            apiKey: 'gemini-key',
            model: DEFAULT_GEMINI_MODEL,
            timeout: Number.MAX_SAFE_INTEGER,
          },
        ],
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 1 },
      inputImageDataUrls: [],
    })

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2_147_483_647)
  })

  it('rejects non-image input data URLs before calling Gemini', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(
      callImageApi({
        settings: {
          ...DEFAULT_SETTINGS,
          activeProfileId: 'gemini',
          profiles: [
            {
              id: 'gemini',
              name: 'Gemini',
              provider: 'gemini',
              baseUrl: DEFAULT_GEMINI_BASE_URL,
              apiKey: 'gemini-key',
              model: DEFAULT_GEMINI_MODEL,
              timeout: 600,
            },
          ],
        },
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS, n: 1 },
        inputImageDataUrls: ['data:text/plain;base64,SGk='],
      }),
    ).rejects.toThrow('输入图片不是图片内容')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects empty input image payloads before calling Gemini', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(
      callImageApi({
        settings: {
          ...DEFAULT_SETTINGS,
          activeProfileId: 'gemini',
          profiles: [
            {
              id: 'gemini',
              name: 'Gemini',
              provider: 'gemini',
              baseUrl: DEFAULT_GEMINI_BASE_URL,
              apiKey: 'gemini-key',
              model: DEFAULT_GEMINI_MODEL,
              timeout: 600,
            },
          ],
        },
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS, n: 1 },
        inputImageDataUrls: ['data:image/png;base64,   '],
      }),
    ).rejects.toThrow('输入图片数据为空')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('安全拦截(HTTP 200 + finishReason 无图)报「生成中断:<原因>」而非泛化的「未返回图片数据」', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: 'IMAGE_SAFETY',
              content: { parts: [{ text: 'Blocked for safety reasons.' }] },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    await expect(
      callImageApi({
        settings: {
          ...DEFAULT_SETTINGS,
          activeProfileId: 'gemini',
          profiles: [
            {
              id: 'gemini',
              name: 'Gemini',
              provider: 'gemini',
              baseUrl: DEFAULT_GEMINI_BASE_URL,
              apiKey: 'gemini-key',
              model: DEFAULT_GEMINI_MODEL,
              timeout: 600,
            },
          ],
        },
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS, n: 1 },
        inputImageDataUrls: [],
      }),
    ).rejects.toThrow('生成中断：IMAGE_SAFETY（Blocked for safety reasons.）')
  })

  it('finishReason 为 STOP 但确实无图时仍报「未返回图片数据」(不误把正常结束当中断)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'no image' }] } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    await expect(
      callImageApi({
        settings: {
          ...DEFAULT_SETTINGS,
          activeProfileId: 'gemini',
          profiles: [
            {
              id: 'gemini',
              name: 'Gemini',
              provider: 'gemini',
              baseUrl: DEFAULT_GEMINI_BASE_URL,
              apiKey: 'gemini-key',
              model: DEFAULT_GEMINI_MODEL,
              timeout: 600,
            },
          ],
        },
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS, n: 1 },
        inputImageDataUrls: [],
      }),
    ).rejects.toThrow('Gemini 未返回图片数据')
  })

  it('reports provider timeout while reading a hanging Gemini error body', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn(() => new Promise<string>(() => undefined)),
    } as unknown as Response)

    const request = callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        timeout: 1,
        activeProfileId: 'gemini',
        profiles: [
          {
            id: 'gemini',
            name: 'Gemini',
            provider: 'gemini',
            baseUrl: DEFAULT_GEMINI_BASE_URL,
            apiKey: 'gemini-key',
            model: DEFAULT_GEMINI_MODEL,
            timeout: 1,
          },
        ],
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 1 },
      inputImageDataUrls: [],
    })
    const rejection = expect(request).rejects.toMatchObject({ message: '请求超时' })

    await vi.advanceTimersByTimeAsync(1000)

    await rejection
    vi.useRealTimers()
  })

  it('reports provider timeout while reading a hanging Gemini success body', async () => {
    vi.useFakeTimers()
    let rejectText!: (error: Error) => void
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: vi.fn(
        () =>
          new Promise<string>((_resolve, reject) => {
            rejectText = reject
          }),
      ),
    } as unknown as Response)

    const request = callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        timeout: 1,
        activeProfileId: 'gemini',
        profiles: [
          {
            id: 'gemini',
            name: 'Gemini',
            provider: 'gemini',
            baseUrl: DEFAULT_GEMINI_BASE_URL,
            apiKey: 'gemini-key',
            model: DEFAULT_GEMINI_MODEL,
            timeout: 1,
          },
        ],
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 1 },
      inputImageDataUrls: [],
    })
    const observed = request.then(
      () => 'resolved',
      (error: unknown) => error,
    )

    await vi.advanceTimersByTimeAsync(1000)

    try {
      const result = await Promise.race([observed, Promise.resolve('pending')])
      expect(result).toMatchObject({ message: '请求超时' })
    } finally {
      rejectText(new Error('cleanup'))
      await request.catch(() => undefined)
      vi.useRealTimers()
    }
  })
})
