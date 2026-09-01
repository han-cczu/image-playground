import type { AppSettings, TaskParams } from '../../types'
import {
  MAX_TASK_PARAM_STRING_LEN,
  normalizeOutputCompression,
  normalizeOutputCount,
} from './paramCompatibility'
import { MAX_TASK_TEXT_LEN } from '../tasks'

export const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

export const MAX_MASK_EDIT_FILE_BYTES = 50 * 1024 * 1024
export const MAX_IMAGE_INPUT_PAYLOAD_BYTES = 512 * 1024 * 1024
/**
 * 单张远程图下载上限:512MiB 是「输入有效负载总量」上限,不适合当单图护栏——
 * base64 转换(arrayBuffer + 二进制串 + btoa)有约 3 倍内存放大,单图过大可冲数 GB 峰值。
 * 与入站单图上限(MAX_INPUT_IMAGE_BYTES = 50MB)同量级,留少量余量。
 */
export const MAX_REMOTE_IMAGE_BYTES = 64 * 1024 * 1024
const MAX_API_ERROR_BODY_BYTES = 64 * 1024
const MAX_API_JSON_BODY_BYTES = 128 * 1024 * 1024

export interface CallApiOptions {
  settings: AppSettings
  prompt: string
  params: TaskParams
  /** 输入图片的 data URL 列表 */
  inputImageDataUrls: string[]
  maskDataUrl?: string
  signal?: AbortSignal
}

export interface CallApiResult {
  /** base64 data URL 列表 */
  images: string[]
  /** API 返回的实际生效参数 */
  actualParams?: Partial<TaskParams>
  /** 每张图片对应的实际生效参数 */
  actualParamsList?: Array<Partial<TaskParams> | undefined>
  /** 每张图片对应的 API 改写提示词 */
  revisedPrompts?: Array<string | undefined>
  /** 并发生成时失败的子请求数量 */
  partialFailureCount?: number
  /** 并发生成时的代表性失败信息 */
  partialFailureMessage?: string
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function mergeAbortSignals(...signals: Array<AbortSignal | undefined>): {
  signal: AbortSignal | undefined
  dispose: () => void
} {
  const noop = () => {}
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal))
  if (activeSignals.length === 0) return { signal: undefined, dispose: noop }
  if (activeSignals.length === 1) return { signal: activeSignals[0], dispose: noop }

  const controller = new AbortController()
  // dispose 在正常完成路径解绑监听,避免长生命周期 / 并发复用同一 caller signal 时监听器线性累积。
  const dispose = () => {
    for (const signal of activeSignals) {
      signal.removeEventListener('abort', abort)
    }
  }
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort()
      dispose()
    }
  }
  if (activeSignals.some((signal) => signal.aborted)) {
    abort()
    return { signal: controller.signal, dispose }
  }

  for (const signal of activeSignals) {
    signal.addEventListener('abort', abort, { once: true })
  }
  return { signal: controller.signal, dispose }
}

export function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

function hasDataUrlScheme(value: string): boolean {
  return value.slice(0, 'data:'.length).toLowerCase() === 'data:'
}

export function isDataUrl(value: unknown): value is string {
  return typeof value === 'string' && hasDataUrlScheme(value)
}

function isImageMime(mime: string): boolean {
  return mime.toLowerCase().startsWith('image/')
}

export function normalizeBase64Image(
  value: string,
  fallbackMime: string,
  maxBytes = MAX_REMOTE_IMAGE_BYTES,
): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('接口未返回可用图片数据')
  const dataUrl = hasDataUrlScheme(trimmed) ? trimmed : `data:${fallbackMime};base64,${trimmed}`
  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex >= 0 && !dataUrl.slice(commaIndex + 1).trim()) {
    throw new Error('接口未返回可用图片数据')
  }
  const contentType = getDataUrlMime(dataUrl, fallbackMime)
  if (!isImageMime(contentType)) {
    throw new Error(`生成图片返回的不是图片内容(Content-Type: ${contentType || '未知'})`)
  }
  assertMaxBytes('生成图片', getDataUrlDecodedByteSize(dataUrl), maxBytes)
  return dataUrl
}

export function assertImageDataUrl(dataUrl: string): { mime: string; data: string } {
  const commaIndex = dataUrl.indexOf(',')
  if (!hasDataUrlScheme(dataUrl) || commaIndex < 0) {
    throw new Error('输入图片格式无效')
  }
  const metaParts = dataUrl.slice('data:'.length, commaIndex).split(';').filter(Boolean)
  const mime = metaParts[0] || 'application/octet-stream'
  if (!metaParts.some((part) => part.toLowerCase() === 'base64')) {
    throw new Error('输入图片格式无效')
  }
  if (!isImageMime(mime)) {
    throw new Error(`输入图片不是图片内容(Content-Type: ${mime || '未知'})`)
  }
  const data = dataUrl.slice(commaIndex + 1)
  if (!data.trim()) {
    throw new Error('输入图片数据为空')
  }
  return { mime, data }
}

export function normalizeRevisedPrompt(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, MAX_TASK_TEXT_LEN) : undefined
}

function clampTaskParamString(value: string): string {
  return value.slice(0, MAX_TASK_PARAM_STRING_LEN)
}

/**
 * 把 Responses output item 的 result(字符串裸 base64 / data URL,或对象形态
 * { b64_json | image | data })统一规整为一个非空候选字符串;空则返回 null。
 * 返回值仍交给 normalizeBase64Image 补 data: 前缀(对已是 data URL 的透传)。
 */
export function extractResponsesImageBase64(
  result: string | { b64_json?: string; image?: string; data?: string } | undefined | null,
): string | null {
  if (typeof result === 'string') {
    const trimmed = result.trim()
    return trimmed || null
  }
  if (result && typeof result === 'object') {
    for (const value of [result.b64_json, result.image, result.data]) {
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }
  return null
}

function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

export function getDataUrlDecodedByteSize(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex < 0) return dataUrl.length

  const meta = dataUrl.slice(0, commaIndex)
  const payload = dataUrl.slice(commaIndex + 1)
  if (!/;base64/i.test(meta)) {
    try {
      return decodeURIComponent(payload).length
    } catch {
      return payload.length
    }
  }

  const normalized = payload.replace(/\s/g, '')
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding)
}

function assertMaxBytes(label: string, bytes: number, maxBytes: number) {
  if (bytes > maxBytes) {
    throw new Error(`${label}过大：${formatMiB(bytes)}，上限为 ${formatMiB(maxBytes)}`)
  }
}

function getDataUrlMime(dataUrl: string, fallbackMime: string): string {
  const commaIndex = dataUrl.indexOf(',')
  if (!hasDataUrlScheme(dataUrl) || commaIndex < 0) return fallbackMime
  return dataUrl.slice('data:'.length, commaIndex).split(';')[0] || fallbackMime
}

export function assertImageInputPayloadSize(bytes: number) {
  assertMaxBytes('图像输入有效负载总大小', bytes, MAX_IMAGE_INPUT_PAYLOAD_BYTES)
}

export function assertMaskEditFileSize(label: string, bytes: number) {
  assertMaxBytes(label, bytes, MAX_MASK_EDIT_FILE_BYTES)
}

async function blobToDataUrl(blob: Blob, fallbackMime: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''

  for (let i = 0; i < bytes.length; i += 0x8000) {
    const chunk = bytes.subarray(i, i + 0x8000)
    binary += String.fromCharCode(...chunk)
  }

  return `data:${blob.type || fallbackMime};base64,${btoa(binary)}`
}

function createAbortError(): DOMException {
  return new DOMException('aborted', 'AbortError')
}

function readBodyWithAbort<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return read()
  if (signal.aborted) throw createAbortError()
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(createAbortError())
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      read()
        .then(resolve, reject)
        .finally(() => {
          signal.removeEventListener('abort', onAbort)
        })
    } catch (err) {
      signal.removeEventListener('abort', onAbort)
      reject(err)
    }
  })
}

async function readBlobWithAbort(
  response: Response,
  signal: AbortSignal | undefined,
  maxBytes: number,
  label: string,
): Promise<Blob> {
  if (!response.body) {
    return readBodyWithAbort(() => response.blob(), signal)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0

  try {
    while (true) {
      const { done, value } = await readStreamChunkWithAbort(reader, signal)
      if (done) break
      if (!value?.byteLength) continue

      bytes += value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined)
        assertMaxBytes(label, bytes, maxBytes)
      }
      chunks.push(value)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* Ignore cleanup errors so they do not mask abort/read failures. */
    }
  }

  return new Blob(
    chunks.map((chunk) => new Uint8Array(chunk)),
    { type: response.headers.get('Content-Type') || undefined },
  )
}

export async function fetchImageUrlAsDataUrl(
  url: string,
  fallbackMime: string,
  signal?: AbortSignal,
): Promise<string> {
  if (isDataUrl(url)) {
    assertMaxBytes('图片 URL 响应', getDataUrlDecodedByteSize(url), MAX_REMOTE_IMAGE_BYTES)
    const contentType = getDataUrlMime(url, fallbackMime)
    if (!isImageMime(contentType)) {
      throw new Error(`图片 URL 返回的不是图片内容(Content-Type: ${contentType || '未知'})`)
    }
    return url
  }

  const response = await fetch(url, {
    cache: 'no-store',
    signal,
  })

  if (!response.ok) {
    throw new Error(`图片 URL 下载失败：HTTP ${response.status}`)
  }

  const contentLength = Number(response.headers.get('Content-Length'))
  if (Number.isFinite(contentLength)) {
    assertMaxBytes('图片 URL 响应', contentLength, MAX_REMOTE_IMAGE_BYTES)
  }

  const blob = await readBlobWithAbort(response, signal, MAX_REMOTE_IMAGE_BYTES, '图片 URL 响应')
  // 上游(可能是用户可配/被注入的半信任主机)返回的图片 URL:按单图上限设防并校验确为图片,
  // 避免把任意/超大响应体整块读入内存(arrayBuffer + binary 串 + btoa 三重放大)导致内存暴涨 / 页面卡死。
  assertMaxBytes('图片 URL 响应', blob.size, MAX_REMOTE_IMAGE_BYTES)
  const contentType = blob.type || fallbackMime
  if (!isImageMime(contentType)) {
    throw new Error(`图片 URL 返回的不是图片内容(Content-Type: ${contentType || '未知'})`)
  }
  return blobToDataUrl(blob, fallbackMime)
}

function readTextWithAbort(response: Response, signal?: AbortSignal): Promise<string> {
  return readBodyWithAbort(() => response.text(), signal)
}

function clampApiErrorMessage(message: string): string {
  return message.slice(0, MAX_TASK_TEXT_LEN)
}

function readStreamChunkWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!signal) return reader.read()
  if (signal.aborted) throw createAbortError()
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      void reader.cancel().catch(() => undefined)
      reject(createAbortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      reader
        .read()
        .then(resolve, reject)
        .finally(() => {
          signal.removeEventListener('abort', onAbort)
        })
    } catch (err) {
      signal.removeEventListener('abort', onAbort)
      reject(err)
    }
  })
}

async function readCappedTextWithAbort(
  response: Response,
  signal: AbortSignal | undefined,
  maxBytes: number,
  label: string,
): Promise<string> {
  const contentLength = Number(response.headers.get('Content-Length'))
  if (Number.isFinite(contentLength)) {
    assertMaxBytes(label, contentLength, maxBytes)
  }

  const body = response.body
  if (!body) {
    const text = await readTextWithAbort(response, signal)
    assertMaxBytes(label, new TextEncoder().encode(text).byteLength, maxBytes)
    return text
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytesRead = 0

  try {
    while (true) {
      const { done, value } = await readStreamChunkWithAbort(reader, signal)
      if (done) break
      if (!value?.byteLength) continue

      bytesRead += value.byteLength
      if (bytesRead > maxBytes) {
        await reader.cancel().catch(() => undefined)
        assertMaxBytes(label, bytesRead, maxBytes)
      }
      text += decoder.decode(value, { stream: true })
    }

    text += decoder.decode()
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* Ignore cleanup errors so they do not mask abort/read failures. */
    }
  }

  return text
}

async function readLimitedTextWithAbort(response: Response, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw createAbortError()

  const contentLength = Number(response.headers?.get('Content-Length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_API_ERROR_BODY_BYTES) return ''

  const body = response.body
  if (!body) {
    return (await readTextWithAbort(response, signal)).slice(0, MAX_API_ERROR_BODY_BYTES)
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytesRead = 0

  try {
    while (bytesRead < MAX_API_ERROR_BODY_BYTES) {
      const { done, value } = await readStreamChunkWithAbort(reader, signal)
      if (done) break
      if (!value?.byteLength) continue

      const remaining = MAX_API_ERROR_BODY_BYTES - bytesRead
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value
      bytesRead += chunk.byteLength
      text += decoder.decode(chunk, { stream: bytesRead < MAX_API_ERROR_BODY_BYTES })

      if (value.byteLength > remaining) break
    }

    text += decoder.decode()
    if (bytesRead >= MAX_API_ERROR_BODY_BYTES) {
      await reader.cancel().catch(() => undefined)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* Ignore cleanup errors so they do not mask abort/read failures. */
    }
  }

  return text
}

export function readJsonWithAbort<T = unknown>(
  response: Response,
  signal?: AbortSignal,
  maxBytes = MAX_API_JSON_BODY_BYTES,
): Promise<T> {
  return readCappedTextWithAbort(response, signal, maxBytes, 'API JSON 响应').then(
    (text) => JSON.parse(text) as T,
  )
}

/**
 * 结构化 HTTP 错误(自动重试轮 D1):getApiErrorMessage 在响应 body 带 message 时会丢弃
 * status,靠消息正则分类 429/5xx 不可靠——重试判定必须拿到结构化 status。message 口径
 * 与旧 `new Error(getApiErrorMessage())` 完全一致,对 UI 文案零影响。
 */
export class ApiHttpError extends Error {
  readonly status: number
  /** 来自 Retry-After 头(已 clamp 1~60s);无头/无法解析时缺省 */
  readonly retryAfterMs?: number

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message)
    this.name = 'ApiHttpError'
    this.status = status
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs
  }
}

const RETRY_AFTER_MIN_MS = 1_000
const RETRY_AFTER_MAX_MS = 60_000

/**
 * 解析 Retry-After 头(RFC 9110:非负秒数或 HTTP 日期),clamp 到 [1s, 60s]。
 * 负数秒/垃圾串返回 undefined(视作无头);过去的日期 clamp 到下限。
 */
export function parseRetryAfterMs(headerValue: string | null, now = Date.now()): number | undefined {
  if (headerValue === null) return undefined
  const trimmed = headerValue.trim()
  if (!trimmed) return undefined
  const clamp = (ms: number) => Math.min(RETRY_AFTER_MAX_MS, Math.max(RETRY_AFTER_MIN_MS, ms))
  const seconds = Number(trimmed)
  if (Number.isFinite(seconds)) {
    if (seconds < 0) return undefined
    return clamp(seconds * 1000)
  }
  const dateMs = Date.parse(trimmed)
  if (Number.isNaN(dateMs)) return undefined
  return clamp(dateMs - now)
}

/** 非 2xx 响应 → ApiHttpError(读 body 提炼 message 的行为与 getApiErrorMessage 相同)。 */
export async function createApiHttpError(
  response: Response,
  signal?: AbortSignal,
): Promise<ApiHttpError> {
  // headers 防御性读取:真实 Response 恒有 headers,但测试里的极简 stub(只带 status/body)没有
  const retryAfterMs = parseRetryAfterMs(
    typeof response.headers?.get === 'function' ? response.headers.get('Retry-After') : null,
  )
  const message = await getApiErrorMessage(response, signal)
  return new ApiHttpError(message, response.status, retryAfterMs)
}

export async function getApiErrorMessage(
  response: Response,
  signal?: AbortSignal,
): Promise<string> {
  let errorMsg = `HTTP ${response.status}`
  let text = ''
  try {
    text = await readLimitedTextWithAbort(response, signal)
  } catch (err) {
    if ((err as { name?: string } | null)?.name === 'AbortError') throw err
  }

  if (!text) return errorMsg

  try {
    const errJson = JSON.parse(text)
    if (errJson.error?.message) errorMsg = errJson.error.message
    else if (typeof errJson.detail === 'string') errorMsg = errJson.detail
    else if (Array.isArray(errJson.detail))
      errorMsg = errJson.detail
        .map((item: unknown) => (typeof item === 'string' ? item : JSON.stringify(item)))
        .join('\n')
    else if (typeof errJson.error === 'string') errorMsg = errJson.error
    else if (errJson.message) errorMsg = errJson.message
  } catch {
    errorMsg = text
  }
  return clampApiErrorMessage(errorMsg)
}

export function pickActualParams(source: unknown): Partial<TaskParams> {
  if (!source || typeof source !== 'object') return {}
  const record = source as Record<string, unknown>
  const actualParams: Partial<TaskParams> = {}

  if (typeof record.size === 'string') actualParams.size = clampTaskParamString(record.size)
  if (
    record.quality === 'auto' ||
    record.quality === 'low' ||
    record.quality === 'medium' ||
    record.quality === 'high'
  ) {
    actualParams.quality = record.quality
  }
  if (
    record.output_format === 'png' ||
    record.output_format === 'jpeg' ||
    record.output_format === 'webp'
  ) {
    actualParams.output_format = record.output_format
  }
  if (typeof record.output_compression === 'number')
    actualParams.output_compression = normalizeOutputCompression(record.output_compression)
  if (record.moderation === 'auto' || record.moderation === 'low')
    actualParams.moderation = record.moderation
  if (typeof record.n === 'number') actualParams.n = normalizeOutputCount(record.n)
  if (typeof record.stylePreset === 'string')
    actualParams.stylePreset = clampTaskParamString(record.stylePreset)

  return actualParams
}

export function mergeActualParams(
  ...sources: Array<Partial<TaskParams> | undefined>
): Partial<TaskParams> | undefined {
  const merged = Object.assign(
    {},
    ...sources.filter((source) => source && Object.keys(source).length),
  )
  return Object.keys(merged).length ? merged : undefined
}

export function summarizeConcurrentFailures(results: PromiseSettledResult<CallApiResult>[]): {
  successfulResults: CallApiResult[]
  partialFailureCount?: number
  partialFailureMessage?: string
} {
  const successfulResults = results
    .filter((r): r is PromiseFulfilledResult<CallApiResult> => r.status === 'fulfilled')
    .map((r) => r.value)
  const failedResults = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (!failedResults.length) return { successfulResults }

  const cancellationFailure = failedResults.find((result) => {
    const message = getErrorMessage(result.reason)
    return message === '已取消'
  })
  if (cancellationFailure) throw cancellationFailure.reason

  return {
    successfulResults,
    partialFailureCount: failedResults.length,
    partialFailureMessage: getErrorMessage(failedResults[0].reason),
  }
}
