import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { buildTaskPresentation, getPresentedSelection } from './taskPresentation'
import { TASK_GRID_RENDER_CAP } from './taskFilters'

function task(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    prompt: id,
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    outputImages: [],
    maskImageId: null,
    maskTargetImageId: null,
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    ...overrides,
  }
}

const axes: NonNullable<TaskRecord['gridAxes']> = {
  x: {
    kind: 'quality',
    values: [
      { key: 'low', label: '低' },
      { key: 'high', label: '高' },
    ],
  },
}
const cell = (id: string, x: string, createdAt = 1) =>
  task(id, {
    batchId: 'batch-a',
    gridAxes: axes,
    gridCoord: { x },
    createdAt,
  })

describe('任务呈现与选择范围', () => {
  it('在真实显示上限处整体隐藏放不下的矩阵，其成员不能进入批量动作', () => {
    const ordinary = Array.from({ length: TASK_GRID_RENDER_CAP - 1 }, (_, index) =>
      task(`plain-${index}`),
    )
    const low = cell('low', 'low')
    const high = cell('high', 'high')
    const presentation = buildTaskPresentation([...ordinary, low, high, task('tail')])

    expect(presentation.isCapped).toBe(true)
    expect(presentation.renderedMemberCount).toBe(TASK_GRID_RENDER_CAP - 1)
    expect(presentation.blocks).toHaveLength(TASK_GRID_RENDER_CAP - 1)
    expect(presentation.displayedTaskIds.has(low.id)).toBe(false)
    expect(presentation.memberTaskIds.has(high.id)).toBe(false)
    expect(
      getPresentedSelection(presentation, [ordinary[0].id, low.id, high.id, 'tail']).taskIds,
    ).toEqual([ordinary[0].id])
  })

  it('恰好容纳矩阵时同时保留代表任务和整批历史成员，普通全选不包含历史', () => {
    const old = cell('old-low', 'low', 1)
    const latest = cell('new-low', 'low', 3)
    const high = cell('high', 'high', 2)
    const presentation = buildTaskPresentation([latest, high, old, task('hidden')], 3)

    expect(presentation.displayedTasks.map((item) => item.id)).toEqual(['new-low', 'high'])
    expect([...presentation.memberTaskIds]).toEqual(['new-low', 'high', 'old-low'])
    expect(getPresentedSelection(presentation, ['new-low', 'high', 'old-low', 'hidden'])).toEqual({
      taskIds: ['new-low', 'high', 'old-low'],
      historyCount: 1,
      batchCount: 1,
    })
  })

  it('最新失败代表覆盖旧成功任务，不把旧结果误当成当前显示的格', () => {
    const old = cell('old-success', 'low', 1)
    const latest = { ...cell('latest-error', 'low', 2), status: 'error' as const }
    const presentation = buildTaskPresentation([latest, old])
    expect(presentation.displayedTasks).toEqual([latest])
    expect(getPresentedSelection(presentation, [old.id]).historyCount).toBe(1)
  })

  it('筛选只剩一个矩阵成员时按普通卡呈现，不恢复被筛掉的成员', () => {
    const only = cell('only', 'low')
    const presentation = buildTaskPresentation([only])
    expect(presentation.blocks).toEqual([{ type: 'card', task: only }])
    expect(presentation.displayedTasks).toEqual([only])
    expect(getPresentedSelection(presentation, ['only', 'hidden-history'])).toEqual({
      taskIds: ['only'],
      historyCount: 0,
      batchCount: 0,
    })
  })
})
