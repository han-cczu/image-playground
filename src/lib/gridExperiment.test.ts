import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type GridAxis, type TaskRecord } from '../types'
import {
  buildGridCells,
  countGridCells,
  countGridImages,
  GRID_AXIS_DEFS,
  groupIntoGridBlocks,
  reconstructMatrix,
  type GridAxisCtx,
} from './gridExperiment'

let uid = 0
function task(over: Partial<TaskRecord> = {}): TaskRecord {
  uid += 1
  return {
    id: `t${uid}`,
    prompt: '',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: uid,
    finishedAt: null,
    elapsed: null,
    ...over,
  }
}

const axisQuality: GridAxis = { kind: 'quality', values: [{ key: 'low', label: 'low' }, { key: 'high', label: 'high' }] }
const axisFmt: GridAxis = { kind: 'output_format', values: [{ key: 'png', label: 'PNG' }, { key: 'jpeg', label: 'JPEG' }] }

describe('buildGridCells', () => {
  it('overrides params and sets coord for a single X axis', () => {
    const cells = buildGridCells({ x: axisQuality }, { params: { ...DEFAULT_PARAMS }, prompt: 'cat' })
    expect(cells).toHaveLength(2)
    expect(cells[0].params.quality).toBe('low')
    expect(cells[0].gridCoord).toEqual({ x: 'low' })
    expect(cells[1].params.quality).toBe('high')
    expect(cells[0].prompt).toBe('cat')
  })

  it('takes cartesian product of X and Y, X outer / Y inner', () => {
    const cells = buildGridCells({ x: axisQuality, y: axisFmt }, { params: { ...DEFAULT_PARAMS }, prompt: 'cat' })
    expect(cells).toHaveLength(4)
    expect(cells[0].gridCoord).toEqual({ x: 'low', y: 'png' })
    expect(cells[0].params).toMatchObject({ quality: 'low', output_format: 'png' })
    expect(cells[3].gridCoord).toEqual({ x: 'high', y: 'jpeg' })
    expect(cells[3].params).toMatchObject({ quality: 'high', output_format: 'jpeg' })
  })

  it('resolves size tier to a concrete pixel string in params.size', () => {
    const axisSize: GridAxis = { kind: 'size', values: [{ key: '1K', label: '' }, { key: '2K', label: '' }] }
    const cells = buildGridCells({ x: axisSize }, { params: { ...DEFAULT_PARAMS, size: 'auto' }, prompt: 'x' })
    expect(cells[0].params.size).toBe('1024x1024')
    expect(cells[1].params.size).toBe('2048x2048')
    expect(cells[0].gridCoord).toEqual({ x: '1K' })
  })

  it('uses the prompt axis value as the cell prompt (params untouched by that axis)', () => {
    const axisPrompt: GridAxis = { kind: 'prompt', values: [{ key: 'a cat', label: 'a cat' }, { key: 'a dog', label: 'a dog' }] }
    const cells = buildGridCells({ x: axisPrompt }, { params: { ...DEFAULT_PARAMS }, prompt: 'base ignored' })
    expect(cells.map((c) => c.prompt)).toEqual(['a cat', 'a dog'])
    expect(cells[0].gridCoord).toEqual({ x: 'a cat' })
  })
})

describe('countGridCells', () => {
  it('equals the product of axis value counts', () => {
    expect(countGridCells({ x: axisQuality })).toBe(2)
    expect(countGridCells({ x: axisQuality, y: axisFmt })).toBe(4)
  })
})

describe('reconstructMatrix', () => {
  const axes = { x: axisQuality, y: axisFmt }
  const cell = (x: string, y: string, over: Partial<TaskRecord> = {}) =>
    task({ batchId: 'b', gridAxes: axes, gridCoord: { x, y }, ...over })

  it('rebuilds headers from redundant gridAxes and maps cells, with empty gaps', () => {
    const tasks = [cell('low', 'png'), cell('low', 'jpeg'), cell('high', 'png')] // (high,jpeg) missing
    const m = reconstructMatrix(tasks)!
    expect(m.cols.map((c) => c.key)).toEqual(['low', 'high'])
    expect(m.rows.map((r) => r.key)).toEqual(['png', 'jpeg'])
    expect(m.cellTasks('low', 'png')).toHaveLength(1)
    expect(m.cellTasks('high', 'jpeg')).toHaveLength(0)
  })

  it('returns all tasks in a cell when more than one share a coord', () => {
    const tasks = [cell('low', 'png'), cell('low', 'png')]
    expect(reconstructMatrix(tasks)!.cellTasks('low', 'png')).toHaveLength(2)
  })

  it('uses a single placeholder row when there is no Y axis', () => {
    const xOnly = { x: axisQuality }
    const tasks = [task({ batchId: 'b', gridAxes: xOnly, gridCoord: { x: 'low' } })]
    const m = reconstructMatrix(tasks)!
    expect(m.rows).toEqual([{ key: '', label: '' }])
    expect(m.cellTasks('low', '')).toHaveLength(1)
  })

  it('returns null when no task carries gridAxes', () => {
    expect(reconstructMatrix([task({})])).toBeNull()
  })
})

describe('groupIntoGridBlocks', () => {
  it('aggregates same-batch grid members into one grid block at the first member position', () => {
    const axes = { x: axisQuality }
    const g1 = task({ batchId: 'b', gridAxes: axes, gridCoord: { x: 'low' } })
    const g2 = task({ batchId: 'b', gridAxes: axes, gridCoord: { x: 'high' } })
    const plain = task({})
    const items = groupIntoGridBlocks([plain, g1, g2])
    expect(items.map((i) => i.type)).toEqual(['card', 'grid'])
    const grid = items[1]
    expect(grid.type === 'grid' && grid.tasks.length).toBe(2)
  })

  it('degrades a <2-member grid batch to plain cards', () => {
    const single = [task({ batchId: 'b', gridAxes: { x: axisQuality }, gridCoord: { x: 'low' } })]
    expect(groupIntoGridBlocks(single).map((i) => i.type)).toEqual(['card'])
  })

  it('does NOT aggregate a wildcard batch (batchId without gridAxes)', () => {
    const wb = [task({ batchId: 'wb' }), task({ batchId: 'wb' })]
    expect(groupIntoGridBlocks(wb).map((i) => i.type)).toEqual(['card', 'card'])
  })
})

describe('countGridImages', () => {
  const axisN = { kind: 'n' as const, values: [{ key: '1', label: '1' }, { key: '2', label: '2' }, { key: '4', label: '4' }] }

  it('multiplies cells by baseN when there is no n axis', () => {
    expect(countGridImages({ x: axisQuality }, 2)).toBe(4) // 2 格 × 2
    expect(countGridImages({ x: axisQuality, y: axisFmt }, 1)).toBe(4) // 4 格 × 1
  })

  it('sums per-cell n when n is an axis (baseN ignored)', () => {
    expect(countGridImages({ x: axisN }, 99)).toBe(7) // Σ(1+2+4)
    expect(countGridImages({ x: axisQuality, y: axisN }, 1)).toBe(14) // otherCount 2 × Σ7
  })
})

describe('prompt axis candidates dedup', () => {
  it('dedupes repeated wildcard expansions (avoids duplicate coord keys)', () => {
    const def = GRID_AXIS_DEFS.find((d) => d.kind === 'prompt')!
    const cands = def.getCandidates({ prompt: '{a|a|b}' } as GridAxisCtx)
    expect(cands.map((c) => c.key)).toEqual(['a', 'b'])
    // 去重后只剩 1 个的提示词应被判为不可用作轴
    expect(def.getDisabledReason({ prompt: '{a|a}' } as GridAxisCtx)).toBeTruthy()
  })
})
