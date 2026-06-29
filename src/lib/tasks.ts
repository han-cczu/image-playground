import type { ApiProvider, GridAxis, GridAxisKey, TaskParams, TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import {
  MAX_TASK_PARAM_STRING_LEN,
  normalizeOutputCompression,
  normalizeOutputCount,
} from './api/paramCompatibility'
import { MAX_PROMPT_EXPANSION_HARD } from './promptExpand'

/**
 * 不可信 task 数据(导入 ZIP / 反序列化)的字段级白名单归一化。
 * 与 normalizeConversations / normalizeFavoriteCategories 同范式:逐字段类型校验,
 * Record 字段跳过 __proto__/constructor/prototype 危险 key,防止原型污染直入 IndexedDB。
 */

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
export const MAX_IMAGE_IDS_PER_TASK = 64
export const MAX_INPUT_IMAGES_PER_SUBMISSION = 16
export const MAX_TASKS = 5000
export const MAX_TASK_TEXT_LEN = 5000

function normalizeTaskText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.slice(0, MAX_TASK_TEXT_LEN) : fallback
}

function normalizeTaskParamString(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_TASK_PARAM_STRING_LEN) : ''
}

function toStringArray(input: unknown): string[] {
  return Array.isArray(input)
    ? input.flatMap((value) => (typeof value === 'string' ? [normalizeTaskText(value)] : []))
    : []
}

/** 把不可信对象收敛为 Partial<TaskParams>:只读取已知 key,天然规避原型污染。空则 undefined。 */
function sanitizePartialParams(input: unknown): Partial<TaskParams> | undefined {
  if (!input || typeof input !== 'object') return undefined
  const r = input as Record<string, unknown>
  const out: Partial<TaskParams> = {}
  const hasOutputFormat = Object.prototype.hasOwnProperty.call(r, 'output_format')
  const hasOutputCompression = Object.prototype.hasOwnProperty.call(r, 'output_compression')
  if (typeof r.size === 'string') out.size = normalizeTaskParamString(r.size)
  if (r.quality === 'auto' || r.quality === 'low' || r.quality === 'medium' || r.quality === 'high')
    out.quality = r.quality
  if (r.output_format === 'png' || r.output_format === 'jpeg' || r.output_format === 'webp')
    out.output_format = r.output_format
  if (typeof r.output_compression === 'number')
    out.output_compression = normalizeOutputCompression(r.output_compression)
  else if (r.output_compression === null) out.output_compression = null
  if (hasOutputFormat && out.output_format === 'png' && hasOutputCompression) {
    out.output_compression = DEFAULT_PARAMS.output_compression
  }
  if (r.moderation === 'auto' || r.moderation === 'low') out.moderation = r.moderation
  if (typeof r.n === 'number') out.n = normalizeOutputCount(r.n)
  if (typeof r.stylePreset === 'string') out.stylePreset = normalizeTaskParamString(r.stylePreset)
  return Object.keys(out).length ? out : undefined
}

export function normalizeTaskParams(input: unknown): TaskParams {
  const params = { ...DEFAULT_PARAMS, ...(sanitizePartialParams(input) ?? {}) }
  if (params.output_format === 'png') params.output_compression = DEFAULT_PARAMS.output_compression
  return params
}

/** actualParamsByImage:key→Partial<TaskParams>,跳过危险 key 并对 value 做白名单。 */
function sanitizeRecordOfParams(input: unknown): Record<string, Partial<TaskParams>> | undefined {
  if (!input || typeof input !== 'object') return undefined
  const out: Record<string, Partial<TaskParams>> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) continue
    const params = sanitizePartialParams(value)
    if (params) out[normalizeTaskText(key)] = params
  }
  return Object.keys(out).length ? out : undefined
}

/** revisedPromptByImage:key→string,跳过危险 key。 */
function sanitizeStringRecord(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) continue
    if (typeof value === 'string') out[normalizeTaskText(key)] = normalizeTaskText(value)
  }
  return Object.keys(out).length ? out : undefined
}

function normalizeProvider(value: unknown): ApiProvider | undefined {
  return value === 'gemini' ? 'gemini' : value === 'openai' ? 'openai' : undefined
}

function normalizePartialFailureCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return Math.floor(value)
}

const GRID_AXIS_KEYS = new Set<GridAxisKey>([
  'stylePreset',
  'quality',
  'size',
  'output_format',
  'n',
  'prompt',
])

/** 单条轴定义:kind 必须在白名单内,values 至少一项且每项 key/label 均为 string。 */
function sanitizeGridAxis(input: unknown): GridAxis | undefined {
  if (!input || typeof input !== 'object') return undefined
  const r = input as Record<string, unknown>
  if (typeof r.kind !== 'string' || !GRID_AXIS_KEYS.has(r.kind as GridAxisKey)) return undefined
  if (!Array.isArray(r.values)) return undefined
  const values = r.values.flatMap((v) => {
    if (!v || typeof v !== 'object') return []
    const item = v as Record<string, unknown>
    return typeof item.key === 'string' && typeof item.label === 'string'
      ? [{ key: normalizeTaskText(item.key), label: normalizeTaskText(item.label) }]
      : []
  })
  return values.length ? { kind: r.kind as GridAxisKey, values } : undefined
}

/** gridAxes:x 轴非法则整体丢弃(矩阵骨架失效),y 轴非法时仅降级为单轴。 */
function sanitizeGridAxes(input: unknown): TaskRecord['gridAxes'] {
  if (!input || typeof input !== 'object') return undefined
  const r = input as Record<string, unknown>
  const x = sanitizeGridAxis(r.x)
  if (!x) return undefined
  const y = sanitizeGridAxis(r.y)
  const cellCount = x.values.length * (y ? y.values.length : 1)
  if (cellCount > MAX_PROMPT_EXPANSION_HARD) return undefined
  return y ? { x, y } : { x }
}

/** gridCoord:x 必为 string,y 可选 string。 */
function sanitizeGridCoord(input: unknown): TaskRecord['gridCoord'] {
  if (!input || typeof input !== 'object') return undefined
  const r = input as Record<string, unknown>
  if (typeof r.x !== 'string') return undefined
  return typeof r.y === 'string'
    ? { x: normalizeTaskText(r.x), y: normalizeTaskText(r.y) }
    : { x: normalizeTaskText(r.x) }
}

/**
 * 网格字段的成对不变量:gridAxes 与 gridCoord 必须同存同维,否则矩阵重建会拿到
 * 「有轴无坐标 / 坐标维度对不上轴」的不一致数据(格子全空、补跑误判全缺失而重复生成)。
 * 任一缺失 → 双弃(降级为普通卡片,batchId 不受影响);y 维度只在两边同时存在时保留。
 */
function reconcileGridFields(
  gridAxes: TaskRecord['gridAxes'],
  gridCoord: TaskRecord['gridCoord'],
): { gridAxes: TaskRecord['gridAxes']; gridCoord: TaskRecord['gridCoord'] } {
  if (!gridAxes || !gridCoord) return { gridAxes: undefined, gridCoord: undefined }
  if (gridAxes.y && gridCoord.y === undefined) {
    return { gridAxes: { x: gridAxes.x }, gridCoord }
  }
  if (!gridAxes.y && gridCoord.y !== undefined) {
    return { gridAxes, gridCoord: { x: gridCoord.x } }
  }
  return { gridAxes, gridCoord }
}

/** 归一化单条不可信 task;id 非法时返回 null(整条丢弃)。保留 TaskRecord 全部字段以保证往返导入不掉字段。 */
export function normalizeTask(input: unknown, now = Date.now()): TaskRecord | null {
  if (!input || typeof input !== 'object') return null
  const item = input as Record<string, unknown>
  if (typeof item.id !== 'string' || !item.id.trim()) return null

  const { gridAxes, gridCoord } = reconcileGridFields(
    sanitizeGridAxes(item.gridAxes),
    sanitizeGridCoord(item.gridCoord),
  )

  return {
    id: normalizeTaskText(item.id),
    prompt: normalizeTaskText(item.prompt),
    params: normalizeTaskParams(item.params),
    apiProvider: normalizeProvider(item.apiProvider),
    apiProfileId:
      typeof item.apiProfileId === 'string' ? normalizeTaskText(item.apiProfileId) : undefined,
    apiProfileName:
      typeof item.apiProfileName === 'string' ? normalizeTaskText(item.apiProfileName) : undefined,
    apiModel: typeof item.apiModel === 'string' ? normalizeTaskText(item.apiModel) : undefined,
    actualParams: sanitizePartialParams(item.actualParams),
    actualParamsByImage: sanitizeRecordOfParams(item.actualParamsByImage),
    revisedPromptByImage: sanitizeStringRecord(item.revisedPromptByImage),
    partialFailureCount: normalizePartialFailureCount(item.partialFailureCount),
    partialFailureMessage:
      typeof item.partialFailureMessage === 'string'
        ? normalizeTaskText(item.partialFailureMessage)
        : undefined,
    persistenceError:
      typeof item.persistenceError === 'string'
        ? normalizeTaskText(item.persistenceError)
        : undefined,
    inputImageIds: toStringArray(item.inputImageIds).slice(0, MAX_IMAGE_IDS_PER_TASK),
    maskTargetImageId:
      typeof item.maskTargetImageId === 'string' ? normalizeTaskText(item.maskTargetImageId) : null,
    maskImageId: typeof item.maskImageId === 'string' ? normalizeTaskText(item.maskImageId) : null,
    outputImages: toStringArray(item.outputImages).slice(0, MAX_IMAGE_IDS_PER_TASK),
    status:
      item.status === 'running' || item.status === 'done' || item.status === 'error'
        ? item.status
        : 'done',
    error: typeof item.error === 'string' ? normalizeTaskText(item.error) : null,
    createdAt:
      typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : now,
    finishedAt:
      typeof item.finishedAt === 'number' && Number.isFinite(item.finishedAt)
        ? item.finishedAt
        : null,
    elapsed:
      typeof item.elapsed === 'number' && Number.isFinite(item.elapsed) && item.elapsed >= 0
        ? item.elapsed
        : null,
    isFavorite: typeof item.isFavorite === 'boolean' ? item.isFavorite : undefined,
    favoriteCategoryId:
      typeof item.favoriteCategoryId === 'string'
        ? normalizeTaskText(item.favoriteCategoryId)
        : null,
    sortOrder:
      typeof item.sortOrder === 'number' && Number.isFinite(item.sortOrder)
        ? item.sortOrder
        : undefined,
    conversationId:
      typeof item.conversationId === 'string' ? normalizeTaskText(item.conversationId) : undefined,
    batchId: typeof item.batchId === 'string' ? normalizeTaskText(item.batchId) : undefined,
    gridAxes,
    gridCoord,
  }
}

export function normalizeTasks(input: unknown, now = Date.now()): TaskRecord[] {
  if (!Array.isArray(input)) return []
  const normalized = input
    .slice(0, MAX_TASKS)
    .map((task) => normalizeTask(task, now))
    .filter((task): task is TaskRecord => task !== null)
  const byId = new Map<string, TaskRecord>()
  for (const task of normalized) {
    if (byId.has(task.id)) byId.delete(task.id)
    byId.set(task.id, task)
  }
  return Array.from(byId.values())
}
