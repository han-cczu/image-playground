import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OpenAIProfile } from '../../types'
import { listModels } from './listModels'

const EXPECTED_MAX_MODEL_ID_LEN = 5000
const EXPECTED_MAX_MODEL_LIST_ITEMS = 500

const profile: OpenAIProfile = {
  id: 'openai',
  name: 'OpenAI',
  provider: 'openai',
  baseUrl: 'https://api.example.test/v1',
  apiKey: 'sk-test',
  model: 'gpt-image-2',
  timeout: 600,
  apiMode: 'images',
  codexCli: false,
  apiProxy: false,
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('listModels', () => {
  it('returns unique sorted model ids from OpenAI-compatible responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: 'z-model' }, { id: 'a-model' }, { id: 'a-model' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    await expect(listModels(profile)).resolves.toEqual(['a-model', 'z-model'])
  })

  it('trims OpenAI API keys before sending authorization headers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await listModels({ ...profile, apiKey: '  sk-test  ' })

    const [, init] = fetchMock.mock.calls[0]
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer sk-test',
    })
  })

  it('caps remote model ids and total returned models before they reach UI state', async () => {
    const longId = 'a'.repeat(EXPECTED_MAX_MODEL_ID_LEN + 50)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: longId },
            ...Array.from({ length: EXPECTED_MAX_MODEL_LIST_ITEMS + 5 }, (_, index) => ({
              id: `model-${index.toString().padStart(4, '0')}`,
            })),
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const models = await listModels(profile)

    expect(models).toHaveLength(EXPECTED_MAX_MODEL_LIST_ITEMS)
    expect(models).toContain(longId.slice(0, EXPECTED_MAX_MODEL_ID_LEN))
    expect(models.every((id) => id.length <= EXPECTED_MAX_MODEL_ID_LEN)).toBe(true)
  })

  it('rejects on timeout instead of resolving an empty list', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = (init as RequestInit).signal
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )

    const expectation = expect(listModels(profile)).rejects.toThrow('拉取模型列表超时')
    await vi.advanceTimersByTimeAsync(15_000)

    await expectation
  })

  it('rejects on timeout while reading a hanging error response body', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      text: vi.fn(() => new Promise<string>(() => undefined)),
    } as unknown as Response)

    const expectation = expect(listModels(profile)).rejects.toThrow('拉取模型列表超时')
    await vi.advanceTimersByTimeAsync(15_000)

    await expectation
  })

  it('rejects on timeout while reading a hanging success response body', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn(() => new Promise<string>(() => undefined)),
    } as unknown as Response)

    const pending = listModels(profile)
    const observed = pending.then(
      () => 'resolved',
      (error: unknown) => error,
    )

    await vi.advanceTimersByTimeAsync(15_000)

    try {
      const result = await Promise.race([
        observed,
        Promise.resolve('pending'),
      ])
      expect(result).toMatchObject({ message: expect.stringContaining('拉取模型列表超时') })
    } finally {
      await pending.catch(() => undefined)
    }
  })

  it('does not consume an unbounded success body before returning the capped model list', async () => {
    let pulls = 0
    const encoder = new TextEncoder()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls += 1
            controller.enqueue(encoder.encode('x'.repeat(1024)))
            if (pulls >= 1000) controller.close()
          },
        }),
        { status: 200 },
      ),
    )

    await expect(listModels(profile)).resolves.toEqual([])

    expect(pulls).toBeLessThan(1000)
  })

  it('does not consume an unbounded error body before reporting HTTP status', async () => {
    let pulls = 0
    const encoder = new TextEncoder()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls += 1
            controller.enqueue(encoder.encode('e'.repeat(1024)))
            if (pulls >= 1000) controller.close()
          },
        }),
        { status: 500 },
      ),
    )

    await expect(listModels(profile)).rejects.toThrow('HTTP 500')

    expect(pulls).toBeLessThan(1000)
  })

  it('does not read non-streaming error bodies when Content-Length exceeds the cap', async () => {
    const text = vi.fn(async () => 'e'.repeat(64 * 1024 + 1))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      body: null,
      headers: new Headers({ 'Content-Length': String(64 * 1024 + 1) }),
      text,
    } as unknown as Response)

    await expect(listModels(profile)).rejects.toThrow('HTTP 500')
    expect(text).not.toHaveBeenCalled()
  })

  it('does not read non-streaming success bodies when Content-Length exceeds the cap', async () => {
    const text = vi.fn(async () => JSON.stringify({ data: [{ id: 'oversized' }] }))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      headers: new Headers({ 'Content-Length': String(64 * 1024 + 1) }),
      text,
    } as unknown as Response)

    await expect(listModels(profile)).resolves.toEqual([])
    expect(text).not.toHaveBeenCalled()
  })

  it('keeps timeout errors when an oversized non-streaming body is already aborted', async () => {
    vi.useFakeTimers()
    const text = vi.fn(async () => '')
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              status: 200,
              body: null,
              headers: new Headers({ 'Content-Length': String(64 * 1024 + 1) }),
              text,
            } as unknown as Response)
          }, 15_000)
          const signal = (init as RequestInit).signal
          signal?.addEventListener('abort', () => undefined)
        }),
    )

    const expectation = expect(listModels(profile)).rejects.toThrow('拉取模型列表超时')
    await vi.advanceTimersByTimeAsync(15_000)
    await expectation
    expect(text).not.toHaveBeenCalled()
  })
})
