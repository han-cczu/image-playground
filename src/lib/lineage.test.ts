import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import {
  buildLineageGraph,
  buildLineageIndex,
  findChildTasks,
  findParentTasks,
} from './lineage'

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

describe('buildLineageIndex', () => {
  it('inverts tasks into producer/consumer maps without reading mask', () => {
    const t = task('T', {
      inputImageIds: ['in1'],
      outputImages: ['out1', 'out2'],
      maskImageId: 'mask-should-be-ignored',
    })
    const idx = buildLineageIndex([t])
    expect(idx.producersByImage.get('out1')).toEqual(['T'])
    expect(idx.producersByImage.get('out2')).toEqual(['T'])
    expect(idx.consumersByImage.get('in1')).toEqual(['T'])
    // mask 不计入血缘:既不在 producer 也不在 consumer
    expect(idx.producersByImage.has('mask-should-be-ignored')).toBe(false)
    expect(idx.consumersByImage.has('mask-should-be-ignored')).toBe(false)
    expect(idx.taskById.get('T')).toBe(t)
  })
})

describe('buildLineageGraph (multi-hop)', () => {
  it('assigns depth: ancestors negative, center 0, descendants positive (A→B→C)', () => {
    const graph = buildLineageGraph('B', buildLineageIndex(ALL))
    const depthById = new Map(graph.nodes.map((n) => [n.task.id, n.depth]))
    expect(depthById.get('A')).toBe(-1)
    expect(depthById.get('B')).toBe(0)
    expect(depthById.get('C')).toBe(1)
    // 边方向恒 from=父 to=子
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ from: 'A', to: 'B', sharedImageIds: ['img1'] }),
    )
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ from: 'B', to: 'C', sharedImageIds: ['img2'] }),
    )
    expect(graph.truncated).toBe(false)
  })

  it('returns empty graph for an unknown center', () => {
    expect(buildLineageGraph('nope', buildLineageIndex(ALL))).toEqual({
      nodes: [],
      edges: [],
      truncated: false,
    })
  })

  it('a running center with no outputs yet has no descendants until outputs land', () => {
    const root = task('R', { outputImages: [], inputImageIds: ['seed'], status: 'running' })
    const seedProducer = task('P', { outputImages: ['seed'], createdAt: 1 })
    const graph = buildLineageGraph('R', buildLineageIndex([root, seedProducer]))
    expect(graph.nodes.map((n) => n.task.id).sort()).toEqual(['P', 'R'])
    // 没有后代(outputs 空);P 是祖先
    expect(graph.nodes.find((n) => n.task.id === 'P')!.depth).toBe(-1)
  })

  it('dedups a diamond into one node with converging forward edges (no false cycle)', () => {
    // A 出 x,y;B 用 x 出 m;C 用 y 出 m2;D 用 m,m2 → 菱形,D 单节点,边均前向(实线)
    const A = task('A', { outputImages: ['x', 'y'], createdAt: 1 })
    const B = task('B', { inputImageIds: ['x'], outputImages: ['m'], createdAt: 2 })
    const C = task('C', { inputImageIds: ['y'], outputImages: ['m2'], createdAt: 3 })
    const D = task('D', { inputImageIds: ['m', 'm2'], createdAt: 4 })
    const graph = buildLineageGraph('A', buildLineageIndex([A, B, C, D]))
    // D 只出现一次(两路径可达),边均为前向(B→D / C→D 存在)
    expect(graph.nodes.filter((n) => n.task.id === 'D')).toHaveLength(1)
    expect(graph.edges.some((e) => e.from === 'B' && e.to === 'D')).toBe(true)
    expect(graph.edges.some((e) => e.from === 'C' && e.to === 'D')).toBe(true)
  })

  it('terminates on a true cycle (visited) without dropping or duplicating nodes', () => {
    // 人造环:A 出 a(B 输入),B 出 b(A 输入)——A.in 含 b 使 B 成 A 的父,形成 A⇄B
    const A = task('A', { inputImageIds: ['b'], outputImages: ['a'], createdAt: 1 })
    const B = task('B', { inputImageIds: ['a'], outputImages: ['b'], createdAt: 2 })
    const graph = buildLineageGraph('A', buildLineageIndex([A, B]))
    // 节点不重复(visited 终止),A、B 各一个,不无限循环
    expect(graph.nodes.map((n) => n.task.id).sort()).toEqual(['A', 'B'])
    // 边如实收集不静默省略(2-cycle 两个方向各一条 A→B / B→A)
    expect(graph.edges.length).toBeGreaterThanOrEqual(1)
  })

  it('does NOT mislabel a diamond-with-shortcut forward edge (审查修复:isCycle 移除)', () => {
    // 中心 A 出 a;B 用 a 出 b;C 用 a 和 b → C 同时是 A 的直接子(经 a)和 B 的子(经 b)
    // 旧实现 depth 判定会把合法前向边 B→C 误标为环;现全部实线
    const A = task('A', { outputImages: ['a'], createdAt: 1 })
    const B = task('B', { inputImageIds: ['a'], outputImages: ['b'], createdAt: 2 })
    const C = task('C', { inputImageIds: ['a', 'b'], createdAt: 3 })
    const graph = buildLineageGraph('A', buildLineageIndex([A, B, C]))
    // 合法前向边 B→C 存在(旧实现会误标为环并画虚线;现统一实线)
    expect(graph.edges.some((e) => e.from === 'B' && e.to === 'C')).toBe(true)
  })

  it('treats a byte-identical (collided) image id shared by unrelated tasks as a real edge (固化行为)', () => {
    // U1、U2 生成字节相同图 → 同 SHA256 'dup';X 用 dup 当输入 → 多父(单跳是 feature,多跳固化)
    const U1 = task('U1', { outputImages: ['dup'], createdAt: 1 })
    const U2 = task('U2', { outputImages: ['dup'], createdAt: 2 })
    const X = task('X', { inputImageIds: ['dup'], createdAt: 3 })
    const graph = buildLineageGraph('X', buildLineageIndex([U1, U2, X]))
    const parents = graph.edges.filter((e) => e.to === 'X').map((e) => e.from).sort()
    expect(parents).toEqual(['U1', 'U2']) // 两个合理来源都连(碰撞=特性,如实展示)
  })

  it('truncates at maxNodes and flags truncated', () => {
    // 一个 root 派生出 10 个子;maxNodes=3 → 截断
    const root = task('root', { outputImages: ['r'], createdAt: 1 })
    const kids = Array.from({ length: 10 }, (_, i) =>
      task(`k${i}`, { inputImageIds: ['r'], createdAt: 10 + i }),
    )
    const graph = buildLineageGraph('root', buildLineageIndex([root, ...kids]), { maxNodes: 3 })
    expect(graph.nodes.length).toBeLessThanOrEqual(3)
    expect(graph.truncated).toBe(true)
  })

  it('shares the node budget fairly between ancestors and descendants (审查修复:方向饿死)', () => {
    // 中心两侧各 5 深链;maxNodes=5 → 交替扩展应两侧都有节点,而非祖先吃满后代全无
    const center = task('C', { inputImageIds: ['a1'], outputImages: ['d1'], createdAt: 100 })
    const anc = Array.from({ length: 5 }, (_, i) =>
      task(`anc${i}`, { outputImages: [`a${i + 1}`], inputImageIds: [`a${i + 2}`], createdAt: 50 - i }),
    )
    const desc = Array.from({ length: 5 }, (_, i) =>
      task(`desc${i}`, { inputImageIds: [`d${i + 1}`], outputImages: [`d${i + 2}`], createdAt: 150 + i }),
    )
    const graph = buildLineageGraph('C', buildLineageIndex([center, ...anc, ...desc]), { maxNodes: 5 })
    const hasAncestor = graph.nodes.some((n) => n.depth < 0)
    const hasDescendant = graph.nodes.some((n) => n.depth > 0)
    expect(hasAncestor).toBe(true)
    expect(hasDescendant).toBe(true) // 后代不被祖先饿死
    expect(graph.truncated).toBe(true)
  })

  it('does NOT false-flag truncated when the deepest chain ends exactly at maxDepth (审查修复)', () => {
    // 链深恰好 = maxDepth 且边界叶子无更深派生 → 谱系完整,不应误报 truncated
    const c = task('c', { outputImages: ['o0'], createdAt: 1 })
    const d1 = task('d1', { inputImageIds: ['o0'], outputImages: ['o1'], createdAt: 2 })
    const d2 = task('d2', { inputImageIds: ['o1'], createdAt: 3 }) // 叶子,无 output
    const graph = buildLineageGraph('c', buildLineageIndex([c, d1, d2]), { maxDepth: 2 })
    expect(graph.nodes.map((n) => n.task.id).sort()).toEqual(['c', 'd1', 'd2']) // 全在场
    expect(graph.truncated).toBe(false) // 完整展示,不误报
  })

  it('excludes self-loop edges from the graph', () => {
    const selfLoop = task('S', { inputImageIds: ['s1'], outputImages: ['s1'], createdAt: 1 })
    const graph = buildLineageGraph('S', buildLineageIndex([selfLoop]))
    expect(graph.nodes.map((n) => n.task.id)).toEqual(['S'])
    expect(graph.edges).toEqual([])
  })
})
