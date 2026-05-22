/**
 * 风格预设：8 种偏写实类组合，pill 中文展示，prompt 英文前缀注入。
 *
 * 设计要点：
 * - 仅作用于"最终提交给 API 的 prompt"，不污染 task.prompt 的存储值
 * - undefined / 未命中 key → 直通原 prompt（旧数据兼容）
 */

export const STYLE_PRESETS = {
  photoreal: {
    label: '写实摄影',
    prompt: 'photorealistic, sharp focus, natural lighting, high detail',
  },
  film: {
    label: '胶片',
    prompt: 'shot on 35mm film, kodak portra 400, grainy, soft contrast, vintage',
  },
  portrait: {
    label: '人像',
    prompt: 'portrait photography, 85mm lens, shallow depth of field, studio lighting',
  },
  'classical-oil': {
    label: '古典油画',
    prompt: 'classical oil painting, renaissance style, rich texture, dramatic chiaroscuro',
  },
  watercolor: {
    label: '文艺水彩',
    prompt: 'watercolor painting, soft wash, paper texture, gentle gradients, artistic',
  },
  industrial: {
    label: '工业设计图',
    prompt: 'industrial design sketch, technical drawing, isometric, clean line art, blueprint style',
  },
  architecture: {
    label: '建筑渲染',
    prompt: 'architectural rendering, photorealistic, octane render, golden hour lighting',
  },
  product: {
    label: '产品摄影',
    prompt: 'product photography, white seamless background, soft box lighting, commercial',
  },
} as const

export type StylePresetKey = keyof typeof STYLE_PRESETS

/**
 * 判断给定字符串是否是 STYLE_PRESETS 的**自有**键。
 *
 * 用 `Object.prototype.hasOwnProperty.call` 而非 `in`：避免 `__proto__` / `toString` /
 * `constructor` 等 Object.prototype 上的键被误判为命中。这些键通常不应出现在 stylePreset
 * 字段里（UI 只能写入 ITEMS 内的合法 key），但旧的持久化数据、损坏的导入文件、
 * 或未来扩展点都可能引入外部输入，纯函数应当对这些边界鲁棒。
 */
export function isStylePresetKey(value: string): value is StylePresetKey {
  return Object.prototype.hasOwnProperty.call(STYLE_PRESETS, value)
}

/**
 * 构造最终发给 API 的 prompt：命中风格 → 英文修饰词前缀 + ', ' + 原 prompt；否则原样返回。
 *
 * 纯函数，不读任何全局状态；旧数据 / 未知 key / 原型链 key 都直通原 prompt。
 */
export function buildFinalPrompt(prompt: string, stylePreset?: string): string {
  if (!stylePreset) return prompt
  if (!isStylePresetKey(stylePreset)) return prompt
  return `${STYLE_PRESETS[stylePreset].prompt}, ${prompt}`
}
