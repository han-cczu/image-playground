import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OpenAIProfile } from '../../types'
import { listModels } from './listModels'

const EXPECTED_MAX_MODEL_ID_LEN = 5000
const EXPECTED_MAX_MODEL_LIST_ITEMS = 500
/** 成功体上限:必须容得下真实聚合网关(OpenRouter ≈ 700KB、one-api 数百条带 permission[])的列表 */
const EXPECTED_MAX_MODEL_LIST_BODY_BYTES = 8 * 1024 * 1024
/** 错误体只用来拼 HTTP 状态提示,仍沿用 64KB 截断口径 */
const EXPECTED_MAX_MODEL_LIST_ERROR_BODY_BYTES = 64 * 1024

/** 仿 one-api / new-api 网关的标准 OpenAI model 对象(带 permission[] 与描述),单条约 2KB */
function buildGatewayModelList(count: number): string {
  return JSON.stringify({
    object: 'list',
    data: Array.from({ length: count }, (_, index) => ({
      id: `gateway/model-${index.toString().padStart(4, '0')}`,
      object: 'model',
      created: 1_700_000_000 + index,
      owned_by: 'gateway',
      description: 'd'.repeat(1500),
      permission: [
        {
          id: `modelperm-${index}`,
          object: 'model_permission',
          allow_create_engine: false,
          allow_sampling: true,
          allow_logprobs: true,
          allow_search_indices: false,
          allow_view: true,
          allow_fine_tuning: false,
          organization: '*',
          group: null,
          is_blocking: false,
        },
      ],
    })),
  })
}

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
      const result = await Promise.race([observed, Promise.resolve('pending')])
      expect(result).toMatchObject({ message: expect.stringContaining('拉取模型列表超时') })
    } finally {
      await pending.catch(() => undefined)
    }
  })

  it('parses multi-hundred-KB aggregator model lists in full instead of truncating them to an empty list', async () => {
    // 回归:64KB 上限时代,OpenRouter / one-api 这类 700KB 级列表被截成非法 JSON,
    // 解析失败被吞成「成功的空列表」并被 useModelList 缓存整个会话,UI 只显示「返回为空」
    const body = buildGatewayModelList(400)
    expect(body.length).toBeGreaterThan(600 * 1024)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )

    const models = await listModels(profile)

    expect(models).toHaveLength(400)
    expect(models[0]).toBe('gateway/model-0000')
    expect(models[399]).toBe('gateway/model-0399')
  })

  it('rejects with a readable error instead of an empty list when a streaming success body exceeds the cap', async () => {
    let pulls = 0
    const encoder = new TextEncoder()
    const chunk = encoder.encode('x'.repeat(1024 * 1024))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls += 1
            controller.enqueue(chunk)
            if (pulls >= 1000) controller.close()
          },
        }),
        { status: 200 },
      ),
    )

    // 超限必须是可见错误:静默返回 [] 会被调用方当成功结果缓存,用户无从得知是被截断
    await expect(listModels(profile)).rejects.toThrow('模型列表响应过大')

    // 有界读体的本意不能回退:超限后要 cancel 流,不能把整条流读完。
    // 上界留 2 块余量:第 N+1 块触发超限,ReadableStream 的内部队列(highWaterMark 1)会再预拉一块
    expect(pulls).toBeLessThan(1000)
    expect(pulls).toBeLessThanOrEqual(EXPECTED_MAX_MODEL_LIST_BODY_BYTES / (1024 * 1024) + 2)
  })

  it('rejects when a non-streaming success body without Content-Length exceeds the cap', async () => {
    const text = vi.fn(async () => 'x'.repeat(EXPECTED_MAX_MODEL_LIST_BODY_BYTES + 1))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      headers: new Headers(),
      text,
    } as unknown as Response)

    await expect(listModels(profile)).rejects.toThrow('模型列表响应过大')
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
    const text = vi.fn(async () => 'e'.repeat(EXPECTED_MAX_MODEL_LIST_ERROR_BODY_BYTES + 1))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      body: null,
      headers: new Headers({
        'Content-Length': String(EXPECTED_MAX_MODEL_LIST_ERROR_BODY_BYTES + 1),
      }),
      text,
    } as unknown as Response)

    await expect(listModels(profile)).rejects.toThrow('HTTP 500')
    expect(text).not.toHaveBeenCalled()
  })

  it('still reads success bodies that only exceed the error-body cap', async () => {
    // 成功体与错误体上限必须分开:64KB 是错误体口径,套到成功体上会把正常网关列表当成超限
    const text = vi.fn(async () => JSON.stringify({ data: [{ id: 'regular' }] }))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      headers: new Headers({
        'Content-Length': String(EXPECTED_MAX_MODEL_LIST_ERROR_BODY_BYTES + 1),
      }),
      text,
    } as unknown as Response)

    await expect(listModels(profile)).resolves.toEqual(['regular'])
    expect(text).toHaveBeenCalledTimes(1)
  })

  it('rejects without reading non-streaming success bodies when Content-Length exceeds the cap', async () => {
    const text = vi.fn(async () => JSON.stringify({ data: [{ id: 'oversized' }] }))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      headers: new Headers({ 'Content-Length': String(EXPECTED_MAX_MODEL_LIST_BODY_BYTES + 1) }),
      text,
    } as unknown as Response)

    await expect(listModels(profile)).rejects.toThrow('模型列表响应过大')
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
              headers: new Headers({
                'Content-Length': String(EXPECTED_MAX_MODEL_LIST_BODY_BYTES + 1),
              }),
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
