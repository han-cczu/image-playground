import type { FavoriteCategory, TaskRecord } from '../../types'
import { setTaskFavoriteCategory, clearTaskFavorite, retryTask } from '../../store'
import FavoriteCategoryMenu from '../FavoriteCategoryMenu'
import ParamPills, { type ConversationTagProp } from './ParamPills'

interface Props {
  task: TaskRecord
  favoriteCategory: FavoriteCategory | null | undefined
  conversationTag?: ConversationTagProp
  onReuse: () => void
  onEditOutputs: () => void
  onDelete: () => void
}

/** 右侧信息区域:提示词、参数 pills、操作按钮(重试/收藏/复用/编辑输出/删除) */
export default function InfoArea({
  task,
  favoriteCategory,
  conversationTag,
  onReuse,
  onEditOutputs,
  onDelete,
}: Props) {
  return (
    <div className="flex-1 p-3 flex flex-col min-w-0">
      <div className="flex-1 min-h-0 mb-2">
        <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed line-clamp-3">
          {task.prompt || '(无提示词)'}
        </p>
      </div>
      <div className="mt-auto flex flex-col gap-1.5">
        {/* 参数：横向滚动 */}
        <ParamPills task={task} favoriteCategory={favoriteCategory} conversationTag={conversationTag} />
        {/* 操作按钮 */}
        <div
          className="flex gap-1 justify-end flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {task.status === 'error' && (
            <button
              onClick={() => retryTask(task)}
              className="p-1.5 rounded-md hover:bg-blue-50 dark:hover:bg-blue-950/30 text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition"
              title="重试失败任务"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}
          {task.isFavorite ? (
            <button
              onClick={() => {
                void clearTaskFavorite(task.id).catch(() => {
                  /* updateTaskInStore already surfaced the persistence error */
                })
              }}
              className="p-1.5 rounded-md text-yellow-400 transition hover:bg-yellow-50 dark:hover:bg-yellow-500/10"
              title="取消收藏"
            >
              <svg
                className="w-4 h-4"
                fill="currentColor"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                />
              </svg>
            </button>
          ) : (
            <div className="relative">
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
                    className="p-1.5 rounded-md text-gray-500 dark:text-gray-400 transition hover:bg-yellow-50 hover:text-yellow-500 dark:hover:bg-yellow-500/10 dark:hover:text-yellow-400"
                    title="收藏记录"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                      />
                    </svg>
                  </button>
                )}
              />
            </div>
          )}
          <button
            onClick={onReuse}
            className="p-1.5 rounded-md hover:bg-blue-50 dark:hover:bg-blue-950/30 text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition"
            title="复用配置"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
              />
            </svg>
          </button>
          <button
            onClick={onEditOutputs}
            className="p-1.5 rounded-md hover:bg-green-50 dark:hover:bg-green-950/30 text-gray-500 dark:text-gray-400 hover:text-green-500 dark:hover:text-green-400 transition disabled:opacity-30"
            title="编辑输出"
            disabled={!task.outputImages?.length}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition"
            title="删除记录"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
