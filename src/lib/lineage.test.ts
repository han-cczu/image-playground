import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { findChildTasks, findParentTasks } from './lineage'

function task(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    prompt: '',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 0,
    finishedAt: null,
    elapsed: null,
    ...overrides,
  }
}

// A 生成 img1 → B 用 img1 当输入并生成 img2 → C 用 img2 当输入。
const A = task('A', { outputImages: ['img1'], createdAt: 1 })
const B = task('B', { inputImageIds: ['img1'], outputImages: ['img2'], createdAt: 2 })
const C = task('C', { inputImageIds: ['img2'], createdAt: 3 })
const ALL = [A, B, C]

describe('findParentTasks', () => {
  it('finds the task whose output is the current input', () => {
    const parents = findParentTasks(B, ALL)
    expect(parents).toHaveLength(1)
    expect(parents[0].task.id).toBe('A')
    expect(parents[0].sharedImageIds).toEqual(['img1'])
  })

  it('returns empty for a task with no inputs (e.g. a root generation)', () => {
    expect(findParentTasks(A, ALL)).toEqual([])
  })

  it('returns empty when an input image came from upload (no producing task)', () => {
    const uploaded = task('U', { inputImageIds: ['upload-1'], outputImages: ['o'] })
    expect(findParentTasks(uploaded, [uploaded, A, B, C])).toEqual([])
  })

  it('lists multiple parents sorted by createdAt', () => {
    const p1 = task('P1', { outputImages: ['x'], createdAt: 5 })
    const p2 = task('P2', { outputImages: ['y'], createdAt: 3 })
    const child = task('X', { inputImageIds: ['x', 'y'], createdAt: 9 })
    const parents = findParentTasks(child, [p1, p2, child])
    expect(parents.map((l) => l.task.id)).toEqual(['P2', 'P1']) // createdAt 3 then 5
  })
})

describe('findChildTasks', () => {
  it('finds the task that consumes the current output', () => {
    const children = findChildTasks(A, ALL)
    expect(children).toHaveLength(1)
    expect(children[0].task.id).toBe('B')
    expect(children[0].sharedImageIds).toEqual(['img1'])
  })

  it('returns empty for a task whose outputs nobody consumed', () => {
    expect(findChildTasks(C, ALL)).toEqual([])
  })

  it('excludes the task itself even if it reuses its own output', () => {
    const selfLoop = task('S', { inputImageIds: ['s1'], outputImages: ['s1'], createdAt: 1 })
    expect(findChildTasks(selfLoop, [selfLoop])).toEqual([])
    expect(findParentTasks(selfLoop, [selfLoop])).toEqual([])
  })
})

describe('batch siblings are not mistaken for parent/child', () => {
  it('two tasks sharing the same uploaded input are not linked', () => {
    const s1 = task('S1', { inputImageIds: ['up'], outputImages: ['o1'], batchId: 'b', createdAt: 1 })
    const s2 = task('S2', { inputImageIds: ['up'], outputImages: ['o2'], batchId: 'b', createdAt: 2 })
    const all = [s1, s2]
    // 共享的是「输入」(up)，不是一方输出=另一方输入，故互不为父子。
    expect(findParentTasks(s2, all)).toEqual([])
    expect(findChildTasks(s1, all)).toEqual([])
  })
})
