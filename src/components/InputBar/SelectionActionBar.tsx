import { useCallback } from 'react'
import type { TaskRecord } from '../../types'
import { removeMultipleTasks, updateTaskInStore, useStore } from '../../store'

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

  const handleToggleFavorite = useCallback(() => {
    const selectedTasks = tasks.filter((t) => selectedTaskIds.includes(t.id))
    const allFavorite = selectedTasks.length > 0 && selectedTasks.every((t) => t.isFavorite)
    const newFavoriteState = !allFavorite
    setConfirmDialog({
      title: newFavoriteState ? '批量收藏' : '批量取消收藏',
      message: newFavoriteState
        ? `确定要收藏选中的 ${selectedTaskIds.length} 条记录吗？`
        : `确定要取消收藏选中的 ${selectedTaskIds.length} 条记录吗？`,
      confirmText: newFavoriteState ? '确认收藏' : '确认取消',
      action: () => {
        selectedTaskIds.forEach((id) => {
          updateTaskInStore(id, { isFavorite: newFavoriteState })
        })
        clearSelection()
      },
    })
  }, [tasks, selectedTaskIds, clearSelection, setConfirmDialog])

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
        <button
          onClick={handleToggleFavorite}
          className="p-2 text-yellow-400 hover:text-yellow-300 transition-colors"
          title="收藏/取消收藏"
        >
          {allSelectedFavorite ? (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          )}
        </button>
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
