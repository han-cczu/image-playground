import type { TaskRecord } from '../types'
import { getParamDisplay } from './paramDisplay'
import { isStylePresetKey, STYLE_PRESETS } from './stylePresets'

/** 对比视图的一行:跨列对齐的参数维度 */
export interface CompareRow {
  key: string
  /** 中文行标题 */
  label: string
  /** 每列的展示值（与传入 tasks 同序） */
  values: string[]
  /** 值不全相同 → 行高亮 */
  differs: boolean
  /** prompt 行：多行展示 */
  multiline?: boolean
}

function styleLabel(task: TaskRecord): string {
  const key = task.params.stylePreset
  if (!key || !isStylePresetKey(key)) return '无'
  return STYLE_PRESETS[key].label
}

/** 来源(Provider · 配置名 · 模型),格式与兜底对齐 DetailModal 的来源区 */
function sourceLabel(task: TaskRecord): string {
  const provider = task.apiProvider === 'gemini' ? 'Gemini' : task.apiProvider ? 'OpenAI' : '未知'
  return `${provider} · ${task.apiProfileName || '未知'} · ${task.apiModel || '未知'}`
}

function elapsedLabel(task: TaskRecord): string {
  if (typeof task.elapsed !== 'number' || !Number.isFinite(task.elapsed)) return '—'
  return `${task.elapsed.toFixed(1)}s`
}

function allSame(values: string[]): boolean {
  return values.every((v) => v === values[0])
}

/**
 * 构建对比行模型。行序固定：prompt → 风格 →（模型）→ 尺寸 → 质量 → 格式 →（压缩）→ 审核 → 数量 → 耗时。
 *
 * - 参数值经 getParamDisplay 归一（API 实际值优先）后再比较：两列请求同为 auto
 *   但实际解析不同时应判 differs——这正是对照实验关心的真实差异。
 * - 模型行：Provider/配置/模型是对照实验的常改维度，缺了它「仅模型不同」的两列会显示零差异；
 *   老任务无来源信息时整行省略（对齐 DetailModal 的 showSourceInfo 守卫）。
 * - 耗时必然不同，恒高亮没有信息量 → differs 写死 false。
 * - output_compression 仅 jpeg/webp 相关：任一列格式非 png 时才追加该行；
 *   png 列该值为 null，按 DetailModal 的 != null 守卫显示 —（否则 String(null) 渲染出字面量 "null"）。
 * - 粒度为 task 级 actualParams（不做 per-image 细分，见 spec §3）。
 */
export function buildCompareRows(tasks: TaskRecord[]): CompareRow[] {
  if (tasks.length === 0) return []

  const paramRow = (
    key: 'size' | 'quality' | 'output_format' | 'moderation' | 'n' | 'output_compression',
    label: string,
  ): CompareRow => {
    const values = tasks.map((task) => getParamDisplay(task, key).displayValue)
    return { key, label, values, differs: !allSame(values) }
  }

  const prompts = tasks.map((task) => task.prompt)
  const styles = tasks.map(styleLabel)

  const rows: CompareRow[] = [
    { key: 'prompt', label: '提示词', values: prompts, differs: !allSame(prompts), multiline: true },
    { key: 'style', label: '风格', values: styles, differs: !allSame(styles) },
  ]

  if (tasks.some((task) => task.apiProvider || task.apiProfileName || task.apiModel)) {
    const sources = tasks.map(sourceLabel)
    rows.push({ key: 'source', label: '模型', values: sources, differs: !allSame(sources) })
  }

  rows.push(paramRow('size', '尺寸'), paramRow('quality', '质量'), paramRow('output_format', '格式'))

  const anyNonPng = tasks.some(
    (task) => getParamDisplay(task, 'output_format').displayValue !== 'png',
  )
  if (anyNonPng) {
    const values = tasks.map((task) =>
      task.params.output_compression == null && task.actualParams?.output_compression == null
        ? '—'
        : getParamDisplay(task, 'output_compression').displayValue,
    )
    rows.push({ key: 'output_compression', label: '压缩', values, differs: !allSame(values) })
  }

  rows.push(paramRow('moderation', '审核'))
  rows.push(paramRow('n', '数量'))
  rows.push({
    key: 'elapsed',
    label: '耗时',
    values: tasks.map(elapsedLabel),
    differs: false,
  })

  return rows
}
