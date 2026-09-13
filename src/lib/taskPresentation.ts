import type { TaskRecord } from '../types'
import { groupIntoGridBlocks, reconstructMatrix, type RenderItem } from './gridExperiment'
import { pickCellRepresentative } from './gridSheet'
import { TASK_GRID_RENDER_CAP } from './taskFilters'

/** 同一格的键与矩阵/导出一致；prompt 轴可包含普通分隔符，用 NUL 避免拼接碰撞。 */
export function gridCellKey(x: string, y = ''): string {
  return `${x}\u0000${y}`
}

export function getGridRepresentatives(tasks: TaskRecord[]): Map<string, TaskRecord> {
  const groups = new Map<string, TaskRecord[]>()
  for (const task of tasks) {
    if (!task.gridCoord) continue
    const key = gridCellKey(task.gridCoord.x, task.gridCoord.y)
    const group = groups.get(key)
    if (group) group.push(task)
    else groups.set(key, [task])
  }
  const representatives = new Map<string, TaskRecord>()
  const matrix = reconstructMatrix(tasks)
  if (!matrix) return representatives
  for (const row of matrix.rows) {
    for (const col of matrix.cols) {
      const key = gridCellKey(col.key, row.key)
      const representative = pickCellRepresentative(groups.get(key) ?? [])
      if (representative) representatives.set(key, representative)
    }
  }
  return representatives
}

export interface TaskPresentation {
  blocks: RenderItem[]
  /** 普通全选只包含画面上的普通卡片和每格代表，不偷偷包含重试历史。 */
  displayedTasks: TaskRecord[]
  displayedTaskIds: ReadonlySet<string>
  /** 已呈现的整批成员允许被“选中整批”明确选择；隐藏块不进入此集合。 */
  memberTaskIds: ReadonlySet<string>
  representativesByBatch: ReadonlyMap<string, Map<string, TaskRecord>>
  renderedMemberCount: number
  isCapped: boolean
}

/**
 * 渲染和批量操作必须共用这一边界：按整块累计任务数，而不是分别 slice 平面任务流。
 * 筛选/排序由调用者先完成；同批在上限处放不下时整块及之后内容均隐藏，不破坏轴关系。
 */
export function buildTaskPresentation(
  filteredTasks: TaskRecord[],
  cap = TASK_GRID_RENDER_CAP,
): TaskPresentation {
  const blocks: RenderItem[] = []
  const displayedTasks: TaskRecord[] = []
  const memberTaskIds = new Set<string>()
  const representativesByBatch = new Map<string, Map<string, TaskRecord>>()
  let renderedMemberCount = 0
  for (const block of groupIntoGridBlocks(filteredTasks)) {
    const members = block.type === 'grid' ? block.tasks : [block.task]
    if (renderedMemberCount + members.length > cap) break
    blocks.push(block)
    renderedMemberCount += members.length
    for (const task of members) memberTaskIds.add(task.id)
    if (block.type === 'grid') {
      const representatives = getGridRepresentatives(block.tasks)
      representativesByBatch.set(block.batchId, representatives)
      displayedTasks.push(...representatives.values())
    } else {
      displayedTasks.push(block.task)
    }
  }
  return {
    blocks,
    displayedTasks,
    displayedTaskIds: new Set(displayedTasks.map((task) => task.id)),
    memberTaskIds,
    representativesByBatch,
    renderedMemberCount,
    isCapped: renderedMemberCount < filteredTasks.length,
  }
}

/** 已选 ID 来自用户点选/整批选择；只保留仍属于显示块的成员，并明确标识历史成员。 */
export function getPresentedSelection(presentation: TaskPresentation, selectedIds: string[]) {
  const taskIds = selectedIds.filter((id) => presentation.memberTaskIds.has(id))
  const selected = new Set(taskIds)
  const historyCount = taskIds.filter((id) => !presentation.displayedTaskIds.has(id)).length
  const batchCount = presentation.blocks.filter(
    (block) => block.type === 'grid' && block.tasks.some((task) => selected.has(task.id)),
  ).length
  return { taskIds, historyCount, batchCount }
}
