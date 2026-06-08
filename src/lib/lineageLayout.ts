import type { LineageEdge, LineageGraph } from './lineage'

/**
 * 谱系树布局:纯函数算节点坐标 + 边 SVG 路径(套 gridSheet.ts「不碰 DOM 纯函数 + 薄渲染壳」范式)。
 * 节点尺寸固定常量,绝不依赖缩略图 naturalWidth——图经 ensureImageCached 异步陆续到达,
 * 若尺寸随图变会让已算好的 SVG 连线坐标失效。先布局后填图。
 */

export const LN_NODE_W = 168
export const LN_NODE_H = 56
export const LN_GAP_X = 24
export const LN_GAP_Y = 72
export const LN_PADDING = 32

export interface NodeRect {
  x: number
  y: number
  w: number
  h: number
}

export interface LineageLayout {
  width: number
  height: number
  nodePos: Map<string, NodeRect>
  /** 边的 SVG path 'd' 字符串(父底中点 → 子顶中点的三次贝塞尔);端点缺失返回 '' */
  edgePath: (edge: LineageEdge) => string
}

/**
 * 纵向分层 DAG:按 depth 分层(祖先负 y 小、中心 0、后代正 y 大),层内按节点已排序的
 * createdAt 顺序水平排,每层相对最宽层水平居中(中心层居中,左右分叉)。O(V+E)。
 */
export function computeLineageLayout(graph: LineageGraph): LineageLayout {
  const nodePos = new Map<string, NodeRect>()
  if (graph.nodes.length === 0) {
    return { width: 0, height: 0, nodePos, edgePath: () => '' }
  }

  // 按 depth 分层(graph.nodes 已按 depth→createdAt 排序,顺序入层即层内有序)
  const levels = new Map<number, string[]>()
  let minDepth = Infinity
  let maxDepth = -Infinity
  for (const node of graph.nodes) {
    const list = levels.get(node.depth)
    if (list) list.push(node.task.id)
    else levels.set(node.depth, [node.task.id])
    if (node.depth < minDepth) minDepth = node.depth
    if (node.depth > maxDepth) maxDepth = node.depth
  }

  const levelWidth = (count: number) => count * LN_NODE_W + (count - 1) * LN_GAP_X
  let maxLevelWidth = 0
  for (const ids of levels.values()) maxLevelWidth = Math.max(maxLevelWidth, levelWidth(ids.length))

  for (const [depth, ids] of levels) {
    const startX = LN_PADDING + (maxLevelWidth - levelWidth(ids.length)) / 2
    const y = LN_PADDING + (depth - minDepth) * (LN_NODE_H + LN_GAP_Y)
    ids.forEach((id, i) => {
      nodePos.set(id, { x: startX + i * (LN_NODE_W + LN_GAP_X), y, w: LN_NODE_W, h: LN_NODE_H })
    })
  }

  const width = maxLevelWidth + LN_PADDING * 2
  const levelCount = maxDepth - minDepth + 1
  const height = LN_PADDING * 2 + levelCount * LN_NODE_H + (levelCount - 1) * LN_GAP_Y

  const edgePath = (edge: LineageEdge): string => {
    const from = nodePos.get(edge.from)
    const to = nodePos.get(edge.to)
    if (!from || !to) return ''
    const x1 = from.x + from.w / 2
    const y1 = from.y + from.h // 父底中点
    const x2 = to.x + to.w / 2
    const y2 = to.y // 子顶中点
    const dy = (y2 - y1) / 2 // 正常向下为正;回边向上为负,贝塞尔仍成立
    return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`
  }

  return { width, height, nodePos, edgePath }
}
