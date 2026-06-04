/**
 * XY 参数网格:维度元数据(表驱动)+ 笛卡尔积生成 + 矩阵重建 + 流内聚合,纯函数。
 *
 * 不依赖全局态(settings/params/prompt 由调用方传入)、不碰 DB。
 */

import type { AppSettings, GridAxis, GridAxisKey, GridAxisValue, TaskParams, TaskRecord } from '../types'
import { STYLE_PRESETS } from './stylePresets'
import { calculateImageSize, detectRatioFromSize, type SizeTier } from './image/size'
import { expandPromptTemplate } from './promptExpand'
import { getOutputImageLimitForSettings } from './api/paramCompatibility'

const QUALITY_VALUES = ['auto', 'low', 'medium', 'high'] as const
const FORMAT_VALUES = ['png', 'jpeg', 'webp'] as const
const SIZE_TIERS: SizeTier[] = ['1K', '2K', '4K']
const DEFAULT_GRID_RATIO = '1:1'

export interface GridAxisCtx {
  settings: AppSettings
  params: TaskParams
  prompt: string
}

export interface GridAxisDef {
  kind: GridAxisKey
  /** 维度中文名 */
  label: string
  /** 该维度的候选取值全集(用户从中多选) */
  getCandidates: (ctx: GridAxisCtx) => GridAxisValue[]
  /** 返回禁用原因,null = 可用 */
  getDisabledReason: (ctx: GridAxisCtx) => string | null
}

/** size 轴在某比例下的 tier → 像素串 */
function sizeLabelForTier(tier: SizeTier, baseSize: string): string {
  const ratio = detectRatioFromSize(baseSize) ?? DEFAULT_GRID_RATIO
  return calculateImageSize(tier, ratio) ?? tier
}

export const GRID_AXIS_DEFS: GridAxisDef[] = [
  {
    kind: 'stylePreset',
    label: '风格',
    getCandidates: () => [
      { key: '', label: '无风格' },
      ...Object.entries(STYLE_PRESETS).map(([key, v]) => ({ key, label: v.label })),
    ],
    getDisabledReason: () => null,
  },
  {
    kind: 'quality',
    label: '质量',
    getCandidates: () => QUALITY_VALUES.map((q) => ({ key: q, label: q })),
    getDisabledReason: ({ settings }) => (settings.codexCli ? 'Codex CLI 不支持质量参数' : null),
  },
  {
    kind: 'size',
    label: '分辨率',
    getCandidates: ({ params }) => SIZE_TIERS.map((tier) => ({ key: tier, label: sizeLabelForTier(tier, params.size) })),
    getDisabledReason: () => null,
  },
  {
    kind: 'output_format',
    label: '格式',
    getCandidates: () => FORMAT_VALUES.map((f) => ({ key: f, label: f.toUpperCase() })),
    getDisabledReason: () => null,
  },
  {
    kind: 'n',
    label: '数量',
    getCandidates: ({ settings }) => {
      const limit = getOutputImageLimitForSettings(settings)
      return [1, 2, 4].filter((n) => n <= limit).map((n) => ({ key: String(n), label: String(n) }))
    },
    getDisabledReason: () => null,
  },
  {
    kind: 'prompt',
    label: '提示词通配',
    // 去重:expandPromptTemplate 对 {a|a} 等重复通配不去重,重复 key 会引发 React 重复 key 与同格多 task。
    getCandidates: ({ prompt }) =>
      Array.from(new Set(expandPromptTemplate(prompt.trim()))).map((p) => ({ key: p, label: p })),
    getDisabledReason: ({ prompt }) =>
      new Set(expandPromptTemplate(prompt.trim())).size < 2 ? '提示词需含 {a|b} 通配才能作为轴' : null,
  },
]

export function getGridAxisDef(kind: GridAxisKey): GridAxisDef | undefined {
  return GRID_AXIS_DEFS.find((d) => d.kind === kind)
}

// ===== 笛卡尔积生成 =====

export interface GridCell {
  params: TaskParams
  prompt: string
  gridCoord: { x: string; y?: string }
}

/** 把单个轴取值应用到 cell(按维度 override params 或 prompt)。 */
function applyAxisValue(cell: GridCell, kind: GridAxisKey, value: GridAxisValue, baseSize: string): void {
  switch (kind) {
    case 'stylePreset':
      cell.params.stylePreset = value.key || undefined
      break
    case 'quality':
      cell.params.quality = value.key as TaskParams['quality']
      break
    case 'output_format':
      cell.params.output_format = value.key as TaskParams['output_format']
      break
    case 'n':
      cell.params.n = Number(value.key)
      break
    case 'size': {
      const ratio = detectRatioFromSize(baseSize) ?? DEFAULT_GRID_RATIO
      cell.params.size = calculateImageSize(value.key as SizeTier, ratio) ?? baseSize
      break
    }
    case 'prompt':
      cell.prompt = value.key
      break
  }
}

/**
 * 笛卡尔积:对每个 (xVal, yVal) 从 base 克隆并按轴 override,产出 cell 列表。
 * size 轴的比例固定取 base.params.size 的比例(本期不做 tier×ratio 二级笛卡尔)。
 */
export function buildGridCells(axes: { x: GridAxis; y?: GridAxis }, base: { params: TaskParams; prompt: string }): GridCell[] {
  const cells: GridCell[] = []
  const yValues: (GridAxisValue | null)[] = axes.y ? axes.y.values : [null]
  for (const xVal of axes.x.values) {
    for (const yVal of yValues) {
      const cell: GridCell = {
        params: { ...base.params },
        prompt: base.prompt,
        gridCoord: { x: xVal.key, ...(yVal ? { y: yVal.key } : {}) },
      }
      applyAxisValue(cell, axes.x.kind, xVal, base.params.size)
      if (axes.y && yVal) applyAxisValue(cell, axes.y.kind, yVal, base.params.size)
      cells.push(cell)
    }
  }
  return cells
}

/** 计算总格数,不构造数组(供 popover 预览与规模把关)。 */
export function countGridCells(axes: { x: GridAxis; y?: GridAxis }): number {
  return axes.x.values.length * (axes.y ? axes.y.values.length : 1)
}

/**
 * 计算总图片数。无 n 轴时 = 格数 × baseN;n 轴时各格 n 不同,
 * 总图 = 非 n 轴格数 × Σ(n 轴各取值)。供预览/确认/toast 显示真实张数。
 */
export function countGridImages(axes: { x: GridAxis; y?: GridAxis }, baseN: number): number {
  const nAxis = [axes.x, axes.y].find((a): a is GridAxis => a?.kind === 'n')
  if (!nAxis || nAxis.values.length === 0) return countGridCells(axes) * baseN
  const otherCellCount = countGridCells(axes) / nAxis.values.length
  const sumN = nAxis.values.reduce((sum, v) => sum + (Number(v.key) || 0), 0)
  return otherCellCount * sumN
}

// ===== 矩阵重建 =====

export interface MatrixModel {
  axes: { x: GridAxis; y?: GridAxis }
  cols: GridAxisValue[]
  /** 无 Y 轴时为单行占位 [{key:'',label:''}] */
  rows: GridAxisValue[]
  /** 取某格全部 task(同格可能 >1:n>1 或重复补跑);UI 取最新为代表 */
  cellTasks: (colKey: string, rowKey: string) => TaskRecord[]
}

/** 从同批网格成员重建矩阵骨架(行列从任一成员的冗余 gridAxes 取,删成员后仍完整)。 */
export function reconstructMatrix(tasks: TaskRecord[]): MatrixModel | null {
  const withAxes = tasks.find((t) => t.gridAxes)
  if (!withAxes?.gridAxes) return null
  const axes = withAxes.gridAxes
  const cols = axes.x.values
  const rows = axes.y ? axes.y.values : [{ key: '', label: '' }]
  const cellTasks = (colKey: string, rowKey: string): TaskRecord[] =>
    tasks.filter((t) => {
      if (!t.gridCoord || t.gridCoord.x !== colKey) return false
      return (t.gridCoord.y ?? '') === rowKey
    })
  return { axes, cols, rows, cellTasks }
}

// ===== 流内聚合 =====

export type RenderItem =
  | { type: 'card'; task: TaskRecord }
  | { type: 'grid'; batchId: string; tasks: TaskRecord[] }

/**
 * 把已排序的扁平 task 列表分组成渲染项:带 gridAxes 的同 batchId 成员聚合成 grid 块
 * (占据组内第一个成员的流位置),其余为 card。组内可见成员 <2 降级为 card(防 1×1 怪异 /
 * 筛选命中部分成员时散开)。无 gridAxes 的 task(含纯通配批次)永远走 card。
 */
export function groupIntoGridBlocks(tasks: TaskRecord[]): RenderItem[] {
  const items: RenderItem[] = []
  const seenBatch = new Set<string>()
  for (const task of tasks) {
    if (task.gridAxes && task.batchId) {
      if (seenBatch.has(task.batchId)) continue
      seenBatch.add(task.batchId)
      const members = tasks.filter((t) => t.batchId === task.batchId && t.gridAxes)
      if (members.length >= 2) {
        items.push({ type: 'grid', batchId: task.batchId, tasks: members })
      } else {
        for (const m of members) items.push({ type: 'card', task: m })
      }
    } else {
      items.push({ type: 'card', task })
    }
  }
  return items
}
