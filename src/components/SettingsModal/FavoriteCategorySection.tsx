import { FAVORITE_CATEGORY_COLORS } from '../../lib/favoriteCategories'
import type { FavoriteCategory } from '../../types'

export interface FavoriteCategorySectionProps {
  categories: FavoriteCategory[]
  onUpdate: (id: string, patch: Partial<FavoriteCategory>) => void
  onMove: (id: string, direction: -1 | 1) => void
  onDelete: (id: string, name: string) => void
}

export function FavoriteCategorySection({
  categories,
  onUpdate,
  onMove,
  onDelete,
}: FavoriteCategorySectionProps) {
  return (
    <div className="space-y-3">
      {categories.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200/70 px-3 py-3 text-xs text-gray-400 dark:border-white/[0.08] dark:text-gray-500">
          暂无分类。可从顶部分类入口或收藏记录时新建。
        </div>
      ) : (
        <div className="space-y-2">
          {categories.map((category, index) => (
            <div
              key={category.id}
              className="rounded-xl border border-gray-200/70 bg-white/50 p-3 dark:border-white/[0.08] dark:bg-white/[0.03]"
            >
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={category.color}
                  onChange={(e) => onUpdate(category.id, { color: e.target.value })}
                  className="h-8 w-8 shrink-0 cursor-pointer rounded-lg border border-gray-200/70 bg-transparent p-0.5 dark:border-white/[0.08]"
                  aria-label="分类颜色"
                  title="分类颜色"
                />
                <input
                  value={category.name}
                  onChange={(e) => onUpdate(category.id, { name: e.target.value })}
                  className="min-w-0 flex-1 rounded-lg border border-gray-200/70 bg-white/70 px-2.5 py-1.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:focus:border-blue-500/50"
                  aria-label="分类名称"
                />
                <button
                  type="button"
                  onClick={() => onMove(category.id, -1)}
                  disabled={index === 0}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
                  aria-label="上移分类"
                  title="上移分类"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => onMove(category.id, 1)}
                  disabled={index === categories.length - 1}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
                  aria-label="下移分类"
                  title="下移分类"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(category.id, category.name)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                  aria-label="删除分类"
                  title="删除分类"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {FAVORITE_CATEGORY_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => onUpdate(category.id, { color })}
                    className={`h-5 w-5 rounded-full border transition ${
                      category.color.toLowerCase() === color.toLowerCase()
                        ? 'border-gray-800 ring-2 ring-gray-300 dark:border-white dark:ring-white/20'
                        : 'border-white/80 hover:scale-110 dark:border-white/20'
                    }`}
                    style={{ backgroundColor: color }}
                    aria-label={`选择颜色 ${color}`}
                    title={color}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
