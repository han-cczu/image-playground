import { useCallback } from 'react'
import type { TaskRecord } from '../../types'
import { clearTaskFavorite, removeMultipleTasks, setTaskFavoriteCategory, useStore } from '../../store'
import FavoriteCategoryMenu from '../FavoriteCategoryMenu'

interface Props {
  filteredTasks: TaskRecord[]
}

export default function SelectionActionBar({ filteredTasks }: Props) {
  const selectedTaskIds = useStore((s) => s.selectedTaskIds)
  const setSelectedTaskIds = useStore((s) => s.setSelectedTaskIds)
  const clearSelection = useStore((s) => s.clearSelection)
  const tasks = useStore((s) => s.tasks)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)

  const allVisibleSelected =
    selectedTaskIds.length === filteredTasks.length && filteredTasks.length > 0

  const handleSelectAllToggle = useCallback(() => {
    if (allVisibleSelected) {
      clearSelection()
    } else {
      setSelectedTaskIds(filteredTasks.map((t) => t.id))
    }
  }, [allVisibleSelected, filteredTasks, clearSelection, setSelectedTaskIds])

  const handleSetFavoriteCategory = useCallback((categoryId: string | null) => {
    if (!categoryId) return
    const selectedTasks = tasks.filter((t) => selectedTaskIds.includes(t.id))
    const allInTarget =
      selectedTasks.length > 0 &&
      selectedTasks.every((t) => t.isFavorite && t.favoriteCategoryId === categoryId)
    if (allInTarget) return

    setConfirmDialog({
      title: '批量收藏',
      message: `确定要把选中的 ${selectedTaskIds.length} 条记录收藏到此分类吗？`,
      confirmText: '确认收藏',
      action: () => {
        void (async () => {
          await Promise.allSettled(
            selectedTaskIds.map((id) => setTaskFavoriteCategory(id, categoryId)),
          )
          clearSelection()
        })()
      },
    })
  }, [tasks, selectedTaskIds, clearSelection, setConfirmDialog])

  const handleClearFavorite = useCallback(() => {
    setConfirmDialog({
      title: '批量取消收藏',
      message: `确定要取消收藏选中的 ${selectedTaskIds.length} 条记录吗？`,
      confirmText: '确认取消',
      action: () => {
        void (async () => {
          await Promise.allSettled(
            selectedTaskIds.map((id) => clearTaskFavorite(id)),
          )
          clearSelection()
        })()
      },
    })
  }, [selectedTaskIds, clearSelection, setConfirmDialog])

  const handleDeleteSelected = useCallback(() => {
    setConfirmDialog({
      title: '批量删除',
      message: `确定要删除选中的 ${selectedTaskIds.length} 条记录吗？`,
      action: () => {
        removeMultipleTasks(selectedTaskIds)
      },
    })
  }, [selectedTaskIds, setConfirmDialog])

  if (selectedTaskIds.length === 0) return null

  const allSelectedFavorite =
    selectedTaskIds.length > 0 &&
    selectedTaskIds.every((id) => tasks.find((t) => t.id === id)?.isFavorite)

  return (
    <div className="flex justify-center mb-3">
      <div className="bg-gray-800/90 dark:bg-gray-800/90 backdrop-blur shadow-lg rounded-full flex items-center p-1 border border-white/10 pointer-events-auto">
        <button
          onClick={clearSelection}
          className="p-2 text-gray-300 hover:text-white transition-colors"
          title="取消选择"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className="w-px h-5 bg-white/20 mx-1"></div>
        <button
          onClick={handleSelectAllToggle}
          className="p-2 text-blue-400 hover:text-blue-300 transition-colors"
          title={allVisibleSelected ? '取消全选' : '全选当前可见'}
        >
          {allVisibleSelected ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path strokeDasharray="4 4" d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" />
            </svg>
          )}
        </button>
        <div className="w-px h-5 bg-white/20 mx-1"></div>
        <div className="relative">
          <FavoriteCategoryMenu
            includeDefaultFallback
            align="right"
            onSelect={handleSetFavoriteCategory}
            includeClearFavorite={allSelectedFavorite}
            onClearFavorite={allSelectedFavorite ? handleClearFavorite : undefined}
            renderTrigger={({ toggle }) => (
              <button
                type="button"
                onClick={toggle}
                className="p-2 text-yellow-400 hover:text-yellow-300 transition-colors"
                title={allSelectedFavorite ? '收藏分类 / 取消收藏' : '收藏'}
              >
                <svg
                  className="w-5 h-5"
                  fill={allSelectedFavorite ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  viewBox="0 0 24 24"
                >
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </button>
            )}
          />
        </div>
        <div className="w-px h-5 bg-white/20 mx-1"></div>
        <button
          onClick={handleDeleteSelected}
          className="p-2 text-red-400 hover:text-red-300 transition-colors"
          title="删除选中"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  )
}
