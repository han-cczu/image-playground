import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readChatErrorBody,
  readStreamChunkWithAbort,
  resolveChatTimeoutMs,
} from './chatCompletionsShared'

const EXPECTED_MAX_CHAT_ERROR_BODY_BYTES = 64 * 1024
const EXPECTED_MAX_SET_TIMEOUT_MS = 2_147_483_647

describe('resolveChatTimeoutMs', () => {
  it('caps finite huge timeout values to the maximum safe setTimeout delay', () => {
    expect(resolveChatTimeoutMs(Number.MAX_SAFE_INTEGER, 60)).toBe(
      EXPECTED_MAX_SET_TIMEOUT_MS,
    )
  })
})

describe('readChatErrorBody', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports timeout when the error body reader ignores abort and never settles', async () => {
    vi.useFakeTimers()
    const timeoutController = new AbortController()
    const response = {
      text: vi.fn(() => new Promise<string>(() => undefined)),
    } as unknown as Response
    const pending = readChatErrorBody(response, timeoutController.signal)
    const observed = pending.then(
      () => 'resolved',
      (error: unknown) => error,
    )

    setTimeout(() => timeoutController.abort(new Error('请求超时')), 1000)
    await vi.advanceTimersByTimeAsync(1000)
    await Promise.resolve()
    await Promise.resolve()

    const result = await Promise.race([observed, Promise.resolve('pending')])
    expect(result).toMatchObject({ message: '请求超时' })
  })

  it('reports cancellation when the caller aborts while the error body reader never settles', async () => {
    const timeoutController = new AbortController()
    const externalController = new AbortController()
    const response = {
      text: vi.fn(() => new Promise<string>(() => undefined)),
    } as unknown as Response
    const pending = readChatErrorBody(response, timeoutController.signal, externalController.signal)
    const observed = pending.then(
      () => 'resolved',
      (error: unknown) => error,
    )
    const cause = new Error('user cancelled')

    externalController.abort(cause)
    await Promise.resolve()
    await Promise.resolve()

    const result = await Promise.race([observed, Promise.resolve('pending')])
    expect(result).toMatchObject({ message: '已取消', cause })
  })

  it('caps returned HTTP error bodies before callers format them into errors', async () => {
    const timeoutController = new AbortController()
    const response = new Response('e'.repeat(EXPECTED_MAX_CHAT_ERROR_BODY_BYTES + 50), {
      status: 500,
    })

    const text = await readChatErrorBody(response, timeoutController.signal)

    expect(text).toHaveLength(EXPECTED_MAX_CHAT_ERROR_BODY_BYTES)
  })

  it('does not consume unbounded streaming HTTP error bodies', async () => {
    const timeoutController = new AbortController()
    const encoder = new TextEncoder()
    let pulls = 0
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

    const text = await readChatErrorBody(response, timeoutController.signal)

    expect(text).toHaveLength(EXPECTED_MAX_CHAT_ERROR_BODY_BYTES)
    expect(pulls).toBeLessThan(1000)
  })

  it('skips non-streaming HTTP error bodies when Content-Length exceeds the cap', async () => {
    const timeoutController = new AbortController()
    const response = {
      body: null,
      headers: new Headers({
        'Content-Length': String(EXPECTED_MAX_CHAT_ERROR_BODY_BYTES + 1),
      }),
      text: vi.fn(async () => 'e'.repeat(EXPECTED_MAX_CHAT_ERROR_BODY_BYTES + 1)),
    } as unknown as Response

    const text = await readChatErrorBody(response, timeoutController.signal)

    expect(text).toBe('')
    expect(response.text).not.toHaveBeenCalled()
  })

  it('preserves caller cancellation even when Content-Length exceeds the cap', async () => {
    const timeoutController = new AbortController()
    const externalController = new AbortController()
    const cause = new Error('user cancelled')
    externalController.abort(cause)
    const response = {
      body: null,
      headers: new Headers({
        'Content-Length': String(EXPECTED_MAX_CHAT_ERROR_BODY_BYTES + 1),
      }),
      text: vi.fn(async () => ''),
    } as unknown as Response

    await expect(
      readChatErrorBody(response, timeoutController.signal, externalController.signal),
    ).rejects.toMatchObject({ message: '已取消', cause })
    expect(response.text).not.toHaveBeenCalled()
  })
})

describe('readStreamChunkWithAbort', () => {
  it('cancels the active reader when the caller aborts a pending stream read', async () => {
    const externalController = new AbortController()
    const timeoutController = new AbortController()
    const reader = {
      read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined)),
      cancel: vi.fn(() => Promise.resolve()),
    } as unknown as ReadableStreamDefaultReader<Uint8Array>

    const pending = readStreamChunkWithAbort(
      reader,
      timeoutController.signal,
      externalController.signal,
    )
    externalController.abort()

    await expect(pending).rejects.toMatchObject({ message: '已取消' })
    expect(reader.cancel).toHaveBeenCalled()
  })

  it('cancels the active reader when the timeout signal aborts a pending stream read', async () => {
    const timeoutController = new AbortController()
    const reader = {
      read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined)),
      cancel: vi.fn(() => Promise.resolve()),
    } as unknown as ReadableStreamDefaultReader<Uint8Array>

    const pending = readStreamChunkWithAbort(reader, timeoutController.signal)
    timeoutController.abort(new Error('请求超时'))

    await expect(pending).rejects.toMatchObject({ message: '请求超时' })
    expect(reader.cancel).toHaveBeenCalled()
  })
})
