import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { buildLineageGraph, buildLineageIndex } from './lineage'
import {
  computeLineageLayout,
  LN_NODE_H,
  LN_NODE_W,
  LN_GAP_Y,
  LN_PADDING,
} from './lineageLayout'

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

// A→B→C 链
const A = task('A', { outputImages: ['img1'], createdAt: 1 })
const B = task('B', { inputImageIds: ['img1'], outputImages: ['img2'], createdAt: 2 })
const C = task('C', { inputImageIds: ['img2'], createdAt: 3 })

describe('computeLineageLayout', () => {
  it('returns an empty layout for an empty graph', () => {
    const layout = computeLineageLayout({ nodes: [], edges: [], truncated: false })
    expect(layout).toMatchObject({ width: 0, height: 0 })
    expect(layout.nodePos.size).toBe(0)
    expect(layout.edgePath({ from: 'a', to: 'b', sharedImageIds: [] })).toBe('')
  })

  it('stacks layers vertically: ancestor above center above descendant', () => {
    const graph = buildLineageGraph('B', buildLineageIndex([A, B, C]))
    const layout = computeLineageLayout(graph)
    const yA = layout.nodePos.get('A')!.y
    const yB = layout.nodePos.get('B')!.y
    const yC = layout.nodePos.get('C')!.y
    expect(yA).toBeLessThan(yB)
    expect(yB).toBeLessThan(yC)
    // 层间距 = 节点高 + 纵向 gap
    expect(yB - yA).toBe(LN_NODE_H + LN_GAP_Y)
    // 顶层从 padding 起
    expect(yA).toBe(LN_PADDING)
  })

  it('uses fixed node dimensions independent of image load', () => {
    const layout = computeLineageLayout(buildLineageGraph('A', buildLineageIndex([A, B, C])))
    for (const rect of layout.nodePos.values()) {
      expect(rect.w).toBe(LN_NODE_W)
      expect(rect.h).toBe(LN_NODE_H)
    }
  })

  it('centers narrower levels relative to the widest level', () => {
    // root 出 r;两子 k0 k1 用 r → 子层 2 节点(更宽),root 层 1 节点居中
    const root = task('root', { outputImages: ['r'], createdAt: 1 })
    const k0 = task('k0', { inputImageIds: ['r'], createdAt: 2 })
    const k1 = task('k1', { inputImageIds: ['r'], createdAt: 3 })
    const layout = computeLineageLayout(buildLineageGraph('root', buildLineageIndex([root, k0, k1])))
    const rootX = layout.nodePos.get('root')!.x
    const k0x = layout.nodePos.get('k0')!.x
    const k1x = layout.nodePos.get('k1')!.x
    // root(单节点层)水平居中于两子之间
    expect(rootX).toBeCloseTo((k0x + k1x) / 2, 5)
  })

  it('produces a non-empty SVG path between connected nodes and empty for missing endpoints', () => {
    const graph = buildLineageGraph('B', buildLineageIndex([A, B, C]))
    const layout = computeLineageLayout(graph)
    const edge = graph.edges.find((e) => e.from === 'A' && e.to === 'B')!
    expect(layout.edgePath(edge)).toMatch(/^M [\d.]+ [\d.]+ C /)
    expect(layout.edgePath({ from: 'A', to: 'ghost', sharedImageIds: [] })).toBe('')
  })

  it('width/height bound all node rects with padding', () => {
    const graph = buildLineageGraph('A', buildLineageIndex([A, B, C]))
    const layout = computeLineageLayout(graph)
    for (const rect of layout.nodePos.values()) {
      expect(rect.x + rect.w).toBeLessThanOrEqual(layout.width)
      expect(rect.y + rect.h).toBeLessThanOrEqual(layout.height)
    }
  })
})
