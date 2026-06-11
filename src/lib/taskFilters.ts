import type { TaskRecord, TaskStatus } from '../types'

/**
 * 参数搜索文本缓存:JSON.stringify(params) 在大库 + 搜索词逐键触发下是过滤热路径的大头。
 * 以 params 对象引用为键——store 对 task 的更新是不可变替换({...t, ...patch}),
 * params 未变时引用保留、缓存命中;params 被替换则新引用自然失效。WeakMap 随对象回收,无泄漏。
 */
const paramsSearchTextCache = new WeakMap<object, string>()

function getParamsSearchText(task: TaskRecord): string {
  const params = task.params
  let text = paramsSearchTextCache.get(params)
  if (text === undefined) {
    text = JSON.stringify(params).toLowerCase()
    paramsSearchTextCache.set(params, text)
  }
  return text
}

export interface TaskFilterOptions {
  searchQuery: string
  filterStatus: TaskStatus | 'all'
  filterFavorite: boolean
  filterFavoriteCategoryId: string | null
  /** 按对话过滤；null 表示不过滤（跨对话搜索/调试视图） */
  filterConversationId?: string | null
}

export function filterAndSortTasks(tasks: TaskRecord[], options: TaskFilterOptions): TaskRecord[] {
  /*
   * ========================================================================
   * 步骤1：整理筛选输入
   * ========================================================================
   * 数据源：
   *   1) 任务列表
   *   2) 搜索文本、状态筛选、收藏筛选、分类筛选、对话筛选
   * 操作要点：
   *   1) 先按任务顺序排序
   *   2) 分类筛选只匹配收藏记录
   *   3) 对话筛选与收藏分类筛选独立可叠加
   */
  // 1.1 归一化搜索文本、分类 id、对话 id
  const q = options.searchQuery.trim().toLowerCase()
  const categoryId = options.filterFavoriteCategoryId?.trim() || null
  const conversationId = options.filterConversationId?.trim() || null

  // 1.2 按自定义排序值或创建时间降序;sortOrder 相等时用 createdAt、再用 id 作 tiebreaker,
  //     避免 gap 排序精度坍缩后(两任务 sortOrder 浮点相等)出现不稳定/抖动的次序。
  const sorted = [...tasks].sort((a, b) => {
    const ka = a.sortOrder ?? a.createdAt
    const kb = b.sortOrder ?? b.createdAt
    if (ka !== kb) return kb - ka
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
  })

  // 1.3 应用对话、收藏、分类、状态和文本筛选
  return sorted.filter((task) => {
    if (conversationId && task.conversationId !== conversationId) return false
    if (categoryId && (!task.isFavorite || task.favoriteCategoryId !== categoryId)) return false
    if (!categoryId && options.filterFavorite && !task.isFavorite) return false
    if (options.filterStatus !== 'all' && task.status !== options.filterStatus) return false

    if (!q) return true
    const prompt = (task.prompt || '').toLowerCase()
    return prompt.includes(q) || getParamsSearchText(task).includes(q)
  })
}
