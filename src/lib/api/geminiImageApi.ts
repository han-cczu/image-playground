import type { GeminiProfile, TaskParams } from '../../types'
import {
  assertImageInputPayloadSize,
  type CallApiOptions,
  type CallApiResult,
  getApiErrorMessage,
  getDataUrlEncodedByteSize,
  mergeActualParams,
} from './imageApiShared'

const ASPECT_RATIO_PRESETS: Array<{ ratio: string; value: number }> = [
  { ratio: '1:1', value: 1 },
  { ratio: '4:5', value: 4 / 5 },
  { ratio: '5:4', value: 5 / 4 },
  { ratio: '3:4', value: 3 / 4 },
  { ratio: '4:3', value: 4 / 3 },
  { ratio: '2:3', value: 2 / 3 },
  { ratio: '3:2', value: 3 / 2 },
  { ratio: '9:16', value: 9 / 16 },
  { ratio: '16:9', value: 16 / 9 },
  { ratio: '21:9', value: 21 / 9 },
]

function mapSizeToAspectRatio(size: string): string | undefined {
  const match = size.match(/^(\d+)x(\d+)$/i)
  if (!match) return undefined
  const w = Number(match[1])
  const h = Number(match[2])
  if (!w || !h) return undefined
  const target = w / h
  let best = ASPECT_RATIO_PRESETS[0]
  let bestDiff = Math.abs(Math.log(best.value / target))
  for (const preset of ASPECT_RATIO_PRESETS) {
    const diff = Math.abs(Math.log(preset.value / target))
    if (diff < bestDiff) {
      best = preset
      bestDiff = diff
    }
  }
  return best.ratio
}

function dataUrlToInlinePart(dataUrl: string): { inline_data: { mime_type: string; data: string } } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/)
  if (!match) throw new Error('输入图片格式无效')
  return {
    inline_data: {
      mime_type: match[1],
      data: match[2],
    },
  }
}

interface GeminiInlineData {
  mime_type?: string
  mimeType?: string
  data?: string
}

interface GeminiPart {
  text?: string
  inline_data?: GeminiInlineData
  inlineData?: GeminiInlineData
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
}

function parseGeminiImages(payload: GeminiResponse): Array<{ image: string; mime: string }> {
  const candidates = payload.candidates ?? []
  const out: Array<{ image: string; mime: string }> = []
  for (const candidate of candidates) {
    const parts = candidate.content?.parts ?? []
    for (const part of parts) {
      const inline = part.inline_data ?? part.inlineData
      if (!inline?.data) continue
      const mime = inline.mime_type ?? inline.mimeType ?? 'image/png'
      out.push({ image: `data:${mime};base64,${inline.data}`, mime })
    }
  }
  return out
}

function buildGeminiUrl(baseUrl: string, model: string): string {
  const cleanBase = baseUrl.trim().replace(/\/+$/, '') || 'https://generativelanguage.googleapis.com/v1beta'
  const cleanModel = model.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  return `${cleanBase}/models/${cleanModel}:generateContent`
}

function pickOutputFormat(mime: string): TaskParams['output_format'] | undefined {
  const ext = mime.split('/')[1]?.toLowerCase()
  if (ext === 'png' || ext === 'jpeg' || ext === 'webp') return ext
  if (ext === 'jpg') return 'jpeg'
  return undefined
}

async function callGeminiSingle(opts: CallApiOptions, profile: GeminiProfile): Promise<CallApiResult> {
  if (opts.maskDataUrl) {
    throw new Error('Gemini provider 暂不支持遮罩编辑，请切换到 OpenAI 配置')
  }

  const totalBytes = opts.inputImageDataUrls.reduce((sum, dataUrl) => sum + getDataUrlEncodedByteSize(dataUrl), 0)
  assertImageInputPayloadSize(totalBytes)

  const parts: Array<Record<string, unknown>> = [{ text: opts.prompt }]
  for (const dataUrl of opts.inputImageDataUrls) {
    parts.push(dataUrlToInlinePart(dataUrl))
  }

  const aspectRatio = mapSizeToAspectRatio(opts.params.size)
  const generationConfig: Record<string, unknown> = {
    responseModalities: ['IMAGE'],
  }
  if (aspectRatio) {
    generationConfig.imageConfig = { aspectRatio }
  }

  const body = {
    contents: [{ parts }],
    generationConfig,
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), profile.timeout * 1000)

  try {
    const response = await fetch(buildGeminiUrl(profile.baseUrl, profile.model), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': profile.apiKey,
        'Cache-Control': 'no-store, no-cache, max-age=0',
        Pragma: 'no-cache',
      },
      cache: 'no-store',
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response))
    }

    const payload = (await response.json()) as GeminiResponse
    if (payload.promptFeedback?.blockReason) {
      throw new Error(`请求被拒绝：${payload.promptFeedback.blockReason}`)
    }

    const imageResults = parseGeminiImages(payload)
    if (!imageResults.length) {
      throw new Error('Gemini 未返回图片数据')
    }

    const actualParams = mergeActualParams({
      output_format: pickOutputFormat(imageResults[0].mime),
    })

    return {
      images: imageResults.map((r) => r.image),
      actualParams,
      actualParamsList: imageResults.map((r) =>
        mergeActualParams({ output_format: pickOutputFormat(r.mime) }),
      ),
      revisedPrompts: imageResults.map(() => undefined),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function callGeminiImageApi(opts: CallApiOptions, profile: GeminiProfile): Promise<CallApiResult> {
  const n = opts.params.n > 0 ? opts.params.n : 1
  if (n === 1) return callGeminiSingle(opts, profile)

  const results = await Promise.allSettled(
    Array.from({ length: n }).map(() => callGeminiSingle(opts, profile)),
  )
  const successful = results
    .filter((r): r is PromiseFulfilledResult<CallApiResult> => r.status === 'fulfilled')
    .map((r) => r.value)

  if (!successful.length) {
    const firstError = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (firstError) throw firstError.reason
    throw new Error('所有并发请求均失败')
  }

  const images = successful.flatMap((r) => r.images)
  const actualParamsList = successful.flatMap((r) =>
    r.actualParamsList?.length ? r.actualParamsList : r.images.map(() => r.actualParams),
  )
  const revisedPrompts = successful.flatMap((r) =>
    r.revisedPrompts?.length ? r.revisedPrompts : r.images.map(() => undefined),
  )
  const actualParams = mergeActualParams(successful[0]?.actualParams ?? {}, { n: images.length })
  return { images, actualParams, actualParamsList, revisedPrompts }
}
