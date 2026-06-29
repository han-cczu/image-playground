import { DEFAULT_PARAMS, type AppSettings, type TaskParams } from '../../types'
import { getActiveApiProfile } from './apiProfiles'
import { normalizeImageSize } from '../image/size'

export const MAX_OPENAI_OUTPUT_IMAGES = 10
export const MIN_OUTPUT_COMPRESSION = 0
export const MAX_OUTPUT_COMPRESSION = 100
export const MAX_TASK_PARAM_STRING_LEN = 5000

function clampParamString(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_TASK_PARAM_STRING_LEN) : ''
}

export function getOutputImageLimitForSettings(_settings: AppSettings) {
  return MAX_OPENAI_OUTPUT_IMAGES
}

export function normalizeOutputCompression(
  value: TaskParams['output_compression'],
): TaskParams['output_compression'] {
  if (value == null || !Number.isFinite(value)) return DEFAULT_PARAMS.output_compression
  return Math.min(MAX_OUTPUT_COMPRESSION, Math.max(MIN_OUTPUT_COMPRESSION, Math.round(value)))
}

export function normalizeOutputCount(value: unknown, limit = MAX_OPENAI_OUTPUT_IMAGES): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_PARAMS.n
  return Math.min(limit, Math.max(1, Math.round(numeric)))
}

function normalizeQuality(value: TaskParams['quality']): TaskParams['quality'] {
  return value === 'auto' || value === 'low' || value === 'medium' || value === 'high'
    ? value
    : DEFAULT_PARAMS.quality
}

function normalizeOutputFormat(value: TaskParams['output_format']): TaskParams['output_format'] {
  return value === 'png' || value === 'jpeg' || value === 'webp'
    ? value
    : DEFAULT_PARAMS.output_format
}

function normalizeModeration(value: TaskParams['moderation']): TaskParams['moderation'] {
  return value === 'auto' || value === 'low' ? value : DEFAULT_PARAMS.moderation
}

export function normalizeParamsForSettings(params: TaskParams, settings: AppSettings): TaskParams {
  const activeProfile = getActiveApiProfile(settings)
  const outputImageLimit = getOutputImageLimitForSettings(settings)
  const size = clampParamString(params.size)
  const nextParams: TaskParams = {
    ...params,
    size: normalizeImageSize(size) || DEFAULT_PARAMS.size,
    quality: normalizeQuality(params.quality),
    output_format: normalizeOutputFormat(params.output_format),
    moderation: normalizeModeration(params.moderation),
    n: normalizeOutputCount(params.n, outputImageLimit),
    stylePreset:
      typeof params.stylePreset === 'string'
        ? clampParamString(params.stylePreset)
        : undefined,
  }

  if (activeProfile.provider === 'openai' && activeProfile.codexCli) {
    nextParams.quality = DEFAULT_PARAMS.quality
  }

  if (nextParams.output_format === 'png') {
    nextParams.output_compression = DEFAULT_PARAMS.output_compression
  } else {
    nextParams.output_compression = normalizeOutputCompression(nextParams.output_compression)
  }

  return nextParams
}

export function getChangedParams(current: TaskParams, next: TaskParams): Partial<TaskParams> {
  const patch: Partial<TaskParams> = {}
  for (const key of Object.keys(next) as Array<keyof TaskParams>) {
    if (current[key] !== next[key]) {
      ;(patch as Record<keyof TaskParams, TaskParams[keyof TaskParams]>)[key] = next[key]
    }
  }
  return patch
}
