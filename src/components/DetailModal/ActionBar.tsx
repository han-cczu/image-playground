import { useStore, reuseConfig, editOutputs, removeTask, setTaskFavoriteCategory, clearTaskFavorite } from '../../store'
import FavoriteCategoryMenu from '../FavoriteCategoryMenu'
import type { TaskRecord } from '../../types'

/** 底部操作按钮区:复用配置/编辑输出/删除记录/收藏(取消收藏或选分类收藏) */
export default function ActionBar({ task }: { task: TaskRecord }) {
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)

  const outputLen = task.outputImages?.length || 0

  const handleReuse = () => {
    reuseConfig(task)
    setDetailTaskId(null)
  }

  const handleEdit = () => {
    editOutputs(task)
    setDetailTaskId(null)
  }

  const handleDelete = () => {
    setDetailTaskId(null)
    setConfirmDialog({
      title: '删除记录',
      message: '确定要删除这条记录吗？关联的图片资源也会被清理（如果没有其他任务引用）。',
      action: () => removeTask(task),
    })
  }

  const handleToggleFavorite = () => {
    void clearTaskFavorite(task.id).catch(() => {
      /* updateTaskInStore already surfaced the persistence error */
    })
  }

  return (
    <div className="grid grid-cols-4 sm:flex gap-2 pt-4 border-t border-gray-100 dark:border-white/[0.08]">
      <button
        onClick={handleReuse}
        className="col-span-2 sm:flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/20 transition text-sm font-medium whitespace-nowrap"
      >
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
        </svg>
        复用配置
      </button>
      <button
        onClick={handleEdit}
        disabled={!outputLen}
        className="col-span-2 sm:flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm font-medium whitespace-nowrap"
      >
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        编辑输出
      </button>
      <button
        onClick={handleDelete}
        className="col-span-3 sm:flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 transition text-sm font-medium whitespace-nowrap"
      >
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        删除记录
      </button>
      {task.isFavorite ? (
        <button
          onClick={handleToggleFavorite}
          className="col-span-1 sm:flex-none sm:w-11 w-full flex items-center justify-center rounded-xl bg-yellow-50 text-yellow-500 transition hover:bg-yellow-100 dark:bg-yellow-500/10 dark:hover:bg-yellow-500/20"
          title="取消收藏"
        >
          <svg className="w-5 h-5" fill="currentColor" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        </button>
      ) : (
        <div className="relative col-span-1 sm:flex-none sm:w-11 w-full">
          <FavoriteCategoryMenu
            includeDefaultFallback
            align="right"
            onSelect={(categoryId) => {
              if (!categoryId) return
              void setTaskFavoriteCategory(task.id, categoryId).catch(() => {
                /* updateTaskInStore already surfaced the persistence error */
              })
            }}
            renderTrigger={({ toggle }) => (
              <button
                type="button"
                onClick={toggle}
                className="flex h-full min-h-10 w-full items-center justify-center rounded-xl bg-gray-50 text-gray-400 transition hover:bg-yellow-50 hover:text-yellow-500 dark:bg-white/[0.04] dark:hover:bg-yellow-500/10"
                title="收藏记录"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
              </button>
            )}
          />
        </div>
      )}
    </div>
  )
}
