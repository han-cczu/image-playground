import type { FavoriteCategory } from '../types'

export const FAVORITE_CATEGORY_COLORS = [
  '#f59e0b',
  '#14b8a6',
  '#3b82f6',
  '#ef4444',
  '#a855f7',
  '#22c55e',
  '#ec4899',
  '#64748b',
]

export const DEFAULT_FAVORITE_CATEGORY_COLOR = FAVORITE_CATEGORY_COLORS[0]
export const DEFAULT_FAVORITE_CATEGORY_ID = 'default-favorite-category'
export const DEFAULT_FAVORITE_CATEGORY_NAME = '默认分类'

export function createDefaultFavoriteCategory(now = 0): FavoriteCategory {
  return {
    id: DEFAULT_FAVORITE_CATEGORY_ID,
    name: DEFAULT_FAVORITE_CATEGORY_NAME,
    color: DEFAULT_FAVORITE_CATEGORY_COLOR,
    sortOrder: 0,
    createdAt: now,
  }
}

function isValidColor(color: unknown): color is string {
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)
}

export function normalizeFavoriteCategories(categories: unknown, now = Date.now()): FavoriteCategory[] {
  if (!Array.isArray(categories)) return [createDefaultFavoriteCategory()]

  /*
   * ========================================================================
   * 步骤1：归一化分类输入
   * ========================================================================
   * 数据源：
   *   1) Zustand 持久化状态
   *   2) 导入备份 manifest
   * 操作要点：
   *   1) 跳过无效 id
   *   2) 修补缺失颜色、排序和创建时间
   */
  // 1.1 按 id 去重并修补字段
  const byId = new Map<string, FavoriteCategory>()
  categories.forEach((category, index) => {
    if (!category || typeof category !== 'object') return
    const item = category as Partial<FavoriteCategory>
    if (typeof item.id !== 'string' || !item.id.trim()) return

    byId.set(item.id, {
      id: item.id,
      name: typeof item.name === 'string' ? item.name : '未命名分类',
      color: isValidColor(item.color) ? item.color : DEFAULT_FAVORITE_CATEGORY_COLOR,
      sortOrder: typeof item.sortOrder === 'number' && Number.isFinite(item.sortOrder) ? item.sortOrder : index,
      createdAt: typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : now,
    })
  })

  // 1.2 按显示顺序输出，并压缩 sortOrder
  return Array.from(byId.values())
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map((category, index) => ({ ...category, sortOrder: index }))
}

export function mergeFavoriteCategories(
  existing: FavoriteCategory[],
  incoming: FavoriteCategory[],
): FavoriteCategory[] {
  /*
   * ========================================================================
   * 步骤1：合并导入分类
   * ========================================================================
   * 数据源：
   *   1) 本地已有分类
   *   2) 备份中的分类
   * 操作要点：
   *   1) 本地同 id 分类优先
   *   2) 只追加新分类
   */
  // 1.1 保留本地同 id 分类
  const localIds = new Set(existing.map((category) => category.id))

  // 1.2 追加备份中新 id 分类
  return normalizeFavoriteCategories([
    ...existing,
    ...incoming.filter((category) => !localIds.has(category.id)),
  ])
}
