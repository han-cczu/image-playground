import type { ApiProvider, TaskParams, TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'

/**
 * 不可信 task 数据(导入 ZIP / 反序列化)的字段级白名单归一化。
 * 与 normalizeConversations / normalizeFavoriteCategories 同范式:逐字段类型校验,
 * Record 字段跳过 __proto__/constructor/prototype 危险 key,防止原型污染直入 IndexedDB。
 */

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
export const MAX_IMAGE_IDS_PER_TASK = 64

function toStringArray(input: unknown): string[] {
  return Array.isArray(input) ? input.filter((v): v is string => typeof v === 'string') : []
}

/** 把不可信对象收敛为 Partial<TaskParams>:只读取已知 key,天然规避原型污染。空则 undefined。 */
function sanitizePartialParams(input: unknown): Partial<TaskParams> | undefined {
  if (!input || typeof input !== 'object') return undefined
  const r = input as Record<string, unknown>
  const out: Partial<TaskParams> = {}
  if (typeof r.size === 'string') out.size = r.size
  if (r.quality === 'auto' || r.quality === 'low' || r.quality === 'medium' || r.quality === 'high') out.quality = r.quality
  if (r.output_format === 'png' || r.output_format === 'jpeg' || r.output_format === 'webp') out.output_format = r.output_format
  if (typeof r.output_compression === 'number' && Number.isFinite(r.output_compression)) out.output_compression = r.output_compression
  else if (r.output_compression === null) out.output_compression = null
  if (r.moderation === 'auto' || r.moderation === 'low') out.moderation = r.moderation
  if (typeof r.n === 'number' && Number.isFinite(r.n)) out.n = r.n
  if (typeof r.stylePreset === 'string') out.stylePreset = r.stylePreset
  return Object.keys(out).length ? out : undefined
}

function normalizeTaskParams(input: unknown): TaskParams {
  return { ...DEFAULT_PARAMS, ...(sanitizePartialParams(input) ?? {}) }
}

/** actualParamsByImage:key→Partial<TaskParams>,跳过危险 key 并对 value 做白名单。 */
function sanitizeRecordOfParams(input: unknown): Record<string, Partial<TaskParams>> | undefined {
  if (!input || typeof input !== 'object') return undefined
  const out: Record<string, Partial<TaskParams>> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) continue
    const params = sanitizePartialParams(value)
    if (params) out[key] = params
  }
  return Object.keys(out).length ? out : undefined
}

/** revisedPromptByImage:key→string,跳过危险 key。 */
function sanitizeStringRecord(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) continue
    if (typeof value === 'string') out[key] = value
  }
  return Object.keys(out).length ? out : undefined
}

function normalizeProvider(value: unknown): ApiProvider | undefined {
  return value === 'gemini' ? 'gemini' : value === 'openai' ? 'openai' : undefined
}

/** 归一化单条不可信 task;id 非法时返回 null(整条丢弃)。保留 TaskRecord 全部字段以保证往返导入不掉字段。 */
export function normalizeTask(input: unknown, now = Date.now()): TaskRecord | null {
  if (!input || typeof input !== 'object') return null
  const item = input as Record<string, unknown>
  if (typeof item.id !== 'string' || !item.id.trim()) return null

  return {
    id: item.id,
    prompt: typeof item.prompt === 'string' ? item.prompt : '',
    params: normalizeTaskParams(item.params),
    apiProvider: normalizeProvider(item.apiProvider),
    apiProfileName: typeof item.apiProfileName === 'string' ? item.apiProfileName : undefined,
    apiModel: typeof item.apiModel === 'string' ? item.apiModel : undefined,
    actualParams: sanitizePartialParams(item.actualParams),
    actualParamsByImage: sanitizeRecordOfParams(item.actualParamsByImage),
    revisedPromptByImage: sanitizeStringRecord(item.revisedPromptByImage),
    partialFailureCount:
      typeof item.partialFailureCount === 'number' && Number.isFinite(item.partialFailureCount)
        ? item.partialFailureCount
        : undefined,
    partialFailureMessage: typeof item.partialFailureMessage === 'string' ? item.partialFailureMessage : undefined,
    persistenceError: typeof item.persistenceError === 'string' ? item.persistenceError : undefined,
    inputImageIds: toStringArray(item.inputImageIds).slice(0, MAX_IMAGE_IDS_PER_TASK),
    maskTargetImageId: typeof item.maskTargetImageId === 'string' ? item.maskTargetImageId : null,
    maskImageId: typeof item.maskImageId === 'string' ? item.maskImageId : null,
    outputImages: toStringArray(item.outputImages).slice(0, MAX_IMAGE_IDS_PER_TASK),
    status: item.status === 'running' || item.status === 'done' || item.status === 'error' ? item.status : 'done',
    error: typeof item.error === 'string' ? item.error : null,
    createdAt: typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : now,
    finishedAt: typeof item.finishedAt === 'number' && Number.isFinite(item.finishedAt) ? item.finishedAt : null,
    elapsed: typeof item.elapsed === 'number' && Number.isFinite(item.elapsed) ? item.elapsed : null,
    isFavorite: typeof item.isFavorite === 'boolean' ? item.isFavorite : undefined,
    favoriteCategoryId: typeof item.favoriteCategoryId === 'string' ? item.favoriteCategoryId : null,
    sortOrder: typeof item.sortOrder === 'number' && Number.isFinite(item.sortOrder) ? item.sortOrder : undefined,
    conversationId: typeof item.conversationId === 'string' ? item.conversationId : undefined,
  }
}

export function normalizeTasks(input: unknown, now = Date.now()): TaskRecord[] {
  if (!Array.isArray(input)) return []
  return input.map((task) => normalizeTask(task, now)).filter((task): task is TaskRecord => task !== null)
}
