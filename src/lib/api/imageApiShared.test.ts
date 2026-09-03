import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertImageDataUrl,
  extractResponsesImageBase64,
  fetchImageUrlAsDataUrl,
  getApiErrorMessage,
  getDataUrlDecodedByteSize,
  MAX_REMOTE_IMAGE_BYTES,
  normalizeBase64Image,
  normalizeRevisedPrompt,
  pickActualParams,
  getImagesApiJsonLimit,
  readJsonWithAbort,
} from './imageApiShared'
import { MAX_TASK_PARAM_STRING_LEN } from './paramCompatibility'
import { MAX_TASK_TEXT_LEN } from '../tasks'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('extractResponsesImageBase64', () => {
  it('返回裸 base64 字符串(trim)', () => {
    expect(extractResponsesImageBase64('  aW1hZ2U=  ')).toBe('aW1hZ2U=')
  })

  it('透传 data URL 字符串', () => {
    const dataUrl = 'data:image/png;base64,aW1hZ2U='
    expect(extractResponsesImageBase64(dataUrl)).toBe(dataUrl)
  })

  it('对象形态:取 b64_json(M1 回归——此前对象形态被静默丢弃)', () => {
    expect(extractResponsesImageBase64({ b64_json: 'aW1hZ2U=' })).toBe('aW1hZ2U=')
  })

  it('对象形态:回退到 image / data 字段', () => {
    expect(extractResponsesImageBase64({ image: 'aW1n' })).toBe('aW1n')
    expect(extractResponsesImageBase64({ data: 'ZGF0YQ==' })).toBe('ZGF0YQ==')
  })

  it('对象字段优先级 b64_json > image > data', () => {
    expect(extractResponsesImageBase64({ b64_json: 'a', image: 'b', data: 'c' })).toBe('a')
    expect(extractResponsesImageBase64({ image: 'b', data: 'c' })).toBe('b')
  })

  it('空 / 无效输入返回 null(保留「未返回可用图片」兜底)', () => {
    expect(extractResponsesImageBase64('   ')).toBeNull()
    expect(extractResponsesImageBase64({})).toBeNull()
    expect(extractResponsesImageBase64({ b64_json: '  ' })).toBeNull()
    expect(extractResponsesImageBase64(undefined)).toBeNull()
    expect(extractResponsesImageBase64(null)).toBeNull()
  })
})

describe('normalizeBase64Image', () => {
  it('rejects blank generated image payloads instead of producing empty data URLs', () => {
    expect(() => normalizeBase64Image('   ', 'image/png')).toThrow('接口未返回可用图片数据')
  })

  it('rejects generated data URLs with an empty base64 payload', () => {
    expect(() => normalizeBase64Image('data:image/png;base64,   ', 'image/png')).toThrow(
      '接口未返回可用图片数据',
    )
  })

  it('rejects generated data URLs with a non-image MIME type', () => {
    expect(() => normalizeBase64Image('data:text/plain;base64,SGk=', 'image/png')).toThrow(
      '生成图片返回的不是图片内容',
    )
  })

  it('rejects raw generated base64 when the response MIME type is not an image', () => {
    expect(() => normalizeBase64Image('SGk=', 'text/plain')).toThrow('生成图片返回的不是图片内容')
  })

  it('trims raw generated image base64 before wrapping it as a data URL', () => {
    expect(normalizeBase64Image('  AQI=  ', 'image/png', 2)).toBe('data:image/png;base64,AQI=')
  })

  it('rejects inline generated images whose decoded bytes exceed the configured cap', () => {
    expect(() => normalizeBase64Image('AQID', 'image/png', 2)).toThrow('生成图片过大')
  })

  it('keeps inline generated images within the configured cap', () => {
    expect(normalizeBase64Image('AQI=', 'image/png', 2)).toBe('data:image/png;base64,AQI=')
  })

  it('accepts generated data URLs whose image MIME type uses uppercase letters', () => {
    expect(normalizeBase64Image('data:IMAGE/PNG;base64,AQI=', 'image/png', 2)).toBe(
      'data:IMAGE/PNG;base64,AQI=',
    )
  })

  it('accepts generated data URLs whose scheme uses uppercase letters', () => {
    expect(normalizeBase64Image('DATA:image/png;base64,AQI=', 'image/png', 2)).toBe(
      'DATA:image/png;base64,AQI=',
    )
  })
})

describe('assertImageDataUrl', () => {
  it('accepts uppercase data URL schemes and metadata parameters before base64', () => {
    expect(assertImageDataUrl('DATA:image/png;name=input.png;base64,aW1hZ2U=')).toEqual({
      mime: 'image/png',
      data: 'aW1hZ2U=',
    })
  })

  it('rejects non-image input data URLs', () => {
    expect(() => assertImageDataUrl('data:text/plain;base64,SGk=')).toThrow('输入图片不是图片内容')
  })

  it('rejects image data URLs with an empty payload', () => {
    expect(() => assertImageDataUrl('data:image/png;base64,   ')).toThrow('输入图片数据为空')
  })

  it('rejects data URLs without a base64 marker', () => {
    expect(() => assertImageDataUrl('data:image/png,abc')).toThrow('输入图片格式无效')
  })
})

describe('getApiErrorMessage', () => {
  it('preserves plain-text error bodies when JSON parsing fails', async () => {
    const response = new Response('plain server error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    })

    await expect(getApiErrorMessage(response)).resolves.toBe('plain server error')
  })

  it('caps plain-text error messages returned by remote APIs', async () => {
    const long = 'e'.repeat(MAX_TASK_TEXT_LEN + 50)
    const response = new Response(long, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    })

    await expect(getApiErrorMessage(response)).resolves.toBe(long.slice(0, MAX_TASK_TEXT_LEN))
  })

  it('caps JSON error messages returned by remote APIs', async () => {
    const long = 'e'.repeat(MAX_TASK_TEXT_LEN + 50)
    const response = new Response(JSON.stringify({ error: { message: long } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })

    await expect(getApiErrorMessage(response)).resolves.toBe(long.slice(0, MAX_TASK_TEXT_LEN))
  })

  it('does not consume unbounded streaming error bodies before returning an error message', async () => {
    let pulls = 0
    const encoder = new TextEncoder()
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1
          controller.enqueue(encoder.encode('e'.repeat(1024)))
          if (pulls >= 1000) controller.close()
        },
      }),
      { status: 500 },
    )

    const message = await getApiErrorMessage(response)

    expect(message).toHaveLength(MAX_TASK_TEXT_LEN)
    expect(pulls).toBeLessThan(1000)
  })

  it('does not read non-streaming error bodies when Content-Length exceeds the cap', async () => {
    const response = {
      status: 500,
      body: null,
      headers: new Headers({ 'Content-Length': String(64 * 1024 + 1) }),
      text: vi.fn(async () => 'e'.repeat(MAX_TASK_TEXT_LEN + 50)),
    } as unknown as Response

    await expect(getApiErrorMessage(response)).resolves.toBe('HTTP 500')
    expect(response.text).not.toHaveBeenCalled()
  })

  it('preserves request aborts before skipping oversized non-streaming error bodies', async () => {
    const controller = new AbortController()
    controller.abort()
    const response = {
      status: 500,
      body: null,
      headers: new Headers({ 'Content-Length': String(64 * 1024 + 1) }),
      text: vi.fn(async () => ''),
    } as unknown as Response

    await expect(getApiErrorMessage(response, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(response.text).not.toHaveBeenCalled()
  })

  it('错误体读取被 abort 时重抛 abort 错误而不是吞成 HTTP 状态', async () => {
    const abortError = new DOMException('aborted', 'AbortError')
    const response = {
      status: 500,
      text: async () => {
        throw abortError
      },
    } as unknown as Response

    await expect(getApiErrorMessage(response)).rejects.toBe(abortError)
  })

  it('aborts hanging error body reads when a request signal is aborted', async () => {
    const controller = new AbortController()
    const response = {
      status: 500,
      text: vi.fn(() => new Promise<string>(() => undefined)),
    } as unknown as Response

    const pending = getApiErrorMessage(response, controller.signal)
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('aborts streaming error body reads without waiting for the stream to close', async () => {
    const controller = new AbortController()
    const response = new Response(new ReadableStream<Uint8Array>(), { status: 500 })

    const pending = getApiErrorMessage(response, controller.signal)
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('keeps the AbortError when releaseLock fails after aborting a streaming error body', async () => {
    const controller = new AbortController()
    const reader = {
      read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined)),
      cancel: vi.fn(() => Promise.resolve()),
      releaseLock: vi.fn(() => {
        throw new TypeError('pending read')
      }),
    }
    const response = {
      status: 500,
      body: {
        getReader: () => reader,
      },
    } as unknown as Response

    const pending = getApiErrorMessage(response, controller.signal)
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(reader.cancel).toHaveBeenCalled()
  })
})

describe('readJsonWithAbort', () => {
  it('stops reading a streaming JSON response once the configured byte cap is exceeded', async () => {
    let pulls = 0
    const encoder = new TextEncoder()
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1
          controller.enqueue(encoder.encode('"'.repeat(1024)))
          if (pulls >= 100) controller.close()
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )

    await expect(readJsonWithAbort(response, undefined, 4096)).rejects.toThrow('API JSON 响应过大')
    expect(pulls).toBeLessThan(100)
  })

  it('removes abort listeners when a streaming JSON reader throws synchronously', async () => {
    const controller = new AbortController()
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener')
    const error = new Error('reader failed')
    const reader = {
      read: vi.fn(() => {
        throw error
      }),
      releaseLock: vi.fn(),
    }
    const response = {
      headers: new Headers(),
      body: {
        getReader: () => reader,
      },
    } as unknown as Response

    await expect(readJsonWithAbort(response, controller.signal)).rejects.toBe(error)

    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(reader.releaseLock).toHaveBeenCalled()
  })
})

describe('getDataUrlDecodedByteSize', () => {
  it('does not throw on malformed percent-encoded legacy data URLs', () => {
    expect(() => getDataUrlDecodedByteSize('data:image/svg+xml,%E0%A4%A')).not.toThrow()
    expect(getDataUrlDecodedByteSize('data:image/svg+xml,%E0%A4%A')).toBe('%E0%A4%A'.length)
  })
})

describe('pickActualParams', () => {
  it('normalizes numeric actual params before they are persisted', () => {
    expect(pickActualParams({ output_compression: 150, n: 2.2 })).toEqual({
      output_compression: 100,
      n: 2,
    })
    expect(pickActualParams({ output_compression: Number.NaN, n: Number.NaN })).toEqual({
      output_compression: null,
      n: 1,
    })
  })

  it('caps remote string actual params before they are persisted', () => {
    const long = 'x'.repeat(MAX_TASK_PARAM_STRING_LEN + 50)

    expect(pickActualParams({ size: long, stylePreset: long })).toEqual({
      size: long.slice(0, MAX_TASK_PARAM_STRING_LEN),
      stylePreset: long.slice(0, MAX_TASK_PARAM_STRING_LEN),
    })
  })
})

describe('normalizeRevisedPrompt', () => {
  it('caps remote revised prompts before task records persist them', () => {
    const long = 'p'.repeat(MAX_TASK_TEXT_LEN + 50)

    expect(normalizeRevisedPrompt(long)).toBe(long.slice(0, MAX_TASK_TEXT_LEN))
    expect(normalizeRevisedPrompt(123)).toBeUndefined()
  })
})

describe('fetchImageUrlAsDataUrl', () => {
  it('rejects non-image data URLs even when the scheme uses uppercase letters', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(
      fetchImageUrlAsDataUrl('DATA:text/plain;base64,SGk=', 'image/png'),
    ).rejects.toThrow('图片 URL 返回的不是图片内容')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects non-image data URLs returned in image URL fields', async () => {
    await expect(
      fetchImageUrlAsDataUrl('data:text/plain;base64,SGk=', 'image/png'),
    ).rejects.toThrow('图片 URL 返回的不是图片内容')
  })

  it('rejects oversized data URLs before attempting a network fetch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const payload = 'A'.repeat(Math.ceil(((MAX_REMOTE_IMAGE_BYTES + 1) * 4) / 3))

    await expect(
      fetchImageUrlAsDataUrl(`data:image/png;base64,${payload}`, 'image/png'),
    ).rejects.toThrow('图片 URL 响应过大')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects oversized Content-Length before reading the response body', async () => {
    const blob = vi.fn(async () => {
      throw new Error('body should not be read')
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Length': String(MAX_REMOTE_IMAGE_BYTES + 1) }),
      blob,
    } as unknown as Response)

    await expect(
      fetchImageUrlAsDataUrl('https://cdn.example.com/image.png', 'image/png'),
    ).rejects.toThrow('图片 URL 响应过大')
    expect(blob).not.toHaveBeenCalled()
  })

  it('aborts hanging response body reads when the request signal is aborted', async () => {
    const controller = new AbortController()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      blob: vi.fn(() => new Promise<Blob>(() => undefined)),
    } as unknown as Response)

    const pending = fetchImageUrlAsDataUrl(
      'https://cdn.example.com/image.png',
      'image/png',
      controller.signal,
    )

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('stops reading a streaming image URL response once the body exceeds the remote image cap', async () => {
    let pulls = 0
    const chunkSize = 1024 * 1024
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls += 1
            controller.enqueue(new Uint8Array(chunkSize))
            if (pulls >= 100) controller.close()
          },
        }),
        {
          status: 200,
          headers: new Headers({ 'Content-Type': 'image/png' }),
        },
      ),
    )

    await expect(
      fetchImageUrlAsDataUrl('https://cdn.example.com/image.png', 'image/png'),
    ).rejects.toThrow('图片 URL 响应过大')
    expect(pulls).toBeLessThan(100)
  })

  // 以下三例守住「下载阶段的网络层失败不能以 TypeError 形态冒泡」:上游已计费出图,
  // 若 TypeError 原样透传,retryPolicy 会判为瞬时错误,executeTask 会把整轮生成重跑到重试上限。
  it('fetch 被网络/跨域拒绝(TypeError)时降级为普通 Error 并保留 cause', async () => {
    const cause = new TypeError('Failed to fetch')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(cause)

    const error = await fetchImageUrlAsDataUrl(
      'https://cdn.example.com/image.png',
      'image/png',
    ).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(TypeError)
    expect((error as Error).message).toBe('图片 URL 下载失败：网络或跨域错误')
    expect((error as Error).cause).toBe(cause)
  })

  it('读取响应体中途断连(TypeError)同样降级为普通 Error', async () => {
    const cause = new TypeError('network error')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.error(cause)
          },
        }),
        {
          status: 200,
          headers: new Headers({ 'Content-Type': 'image/png' }),
        },
      ),
    )

    const error = await fetchImageUrlAsDataUrl(
      'https://cdn.example.com/image.png',
      'image/png',
    ).catch((err: unknown) => err)

    expect(error).not.toBeInstanceOf(TypeError)
    expect((error as Error).message).toBe('图片 URL 下载失败：网络或跨域错误')
    expect((error as Error).cause).toBe(cause)
  })

  it('fetch 本身以 AbortError 拒绝时原样抛出,调用方仍能区分「已取消 / 请求超时」', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('aborted', 'AbortError'))

    await expect(
      fetchImageUrlAsDataUrl('https://cdn.example.com/image.png', 'image/png'),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('getImagesApiJsonLimit', () => {
  it('单图维持 128MiB 默认上限,多图按 n 放大并封顶 512MiB', () => {
    const MiB = 1024 * 1024
    expect(getImagesApiJsonLimit(1)).toBe(128 * MiB)
    expect(getImagesApiJsonLimit(0)).toBe(128 * MiB)
    expect(getImagesApiJsonLimit(Number.NaN)).toBe(128 * MiB)
    // 2 张:2 × 64MiB × 4/3 + 1MiB ≈ 171.7MiB,大于默认值即放大
    expect(getImagesApiJsonLimit(2)).toBeGreaterThan(128 * MiB)
    expect(getImagesApiJsonLimit(2)).toBeLessThan(200 * MiB)
    expect(getImagesApiJsonLimit(10)).toBe(512 * MiB)
    expect(getImagesApiJsonLimit(100)).toBe(512 * MiB)
  })
})
