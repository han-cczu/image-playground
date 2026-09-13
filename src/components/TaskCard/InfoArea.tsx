import type { FavoriteCategory, TaskRecord } from '../../types'
import { setTaskFavoriteCategory, clearTaskFavorite, useStore } from '../../store'
import FavoriteCategoryMenu from '../FavoriteCategoryMenu'
import ParamPills, { type ConversationTagProp } from './ParamPills'
import TaskActionsMenu from './TaskActionsMenu'

interface Props {
  task: TaskRecord
  isSelected?: boolean
  favoriteCategory: FavoriteCategory | null | undefined
  conversationTag?: ConversationTagProp
  onReuse: () => void
  onEditOutputs: () => void
  onDelete: () => void
  onOpenDetails: (event: React.MouseEvent) => void
}

const STAR =
  'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118L2.98 8.411c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z'

/** 图片下方的摘要与常用动作始终可见；更多操作不再挤占提示词和图片。 */
export default function InfoArea({
  task,
  isSelected,
  favoriteCategory,
  conversationTag,
  onReuse,
  onEditOutputs,
  onDelete,
  onOpenDetails,
}: Props) {
  const toggleTaskSelection = useStore((state) => state.toggleTaskSelection)
  const starIcon = (
    <svg
      className="h-5 w-5"
      fill={task.isFavorite ? 'currentColor' : 'none'}
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d={STAR} />
    </svg>
  )

  return (
    <div className="min-w-0 p-4">
      <p
        className="line-clamp-2 min-h-10 text-sm leading-5 text-content"
        title={task.prompt || undefined}
      >
        {task.prompt || '（无提示词）'}
      </p>
      <div className="mt-3">
        <ParamPills
          task={task}
          favoriteCategory={favoriteCategory}
          conversationTag={conversationTag}
        />
      </div>
      <div
        className="mt-3 flex items-center gap-1 border-t border-line pt-2"
        data-no-drag-select
        onClick={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
        onTouchEnd={(event) => event.stopPropagation()}
      >
        <label
          className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-surface-muted"
          title={isSelected ? '取消选择' : '选择任务'}
        >
          <input
            type="checkbox"
            checked={Boolean(isSelected)}
            onChange={() => toggleTaskSelection(task.id)}
            aria-label="选择这条任务"
            className="h-4 w-4 rounded border-line accent-brand"
          />
        </label>
        {task.isFavorite ? (
          <button
            type="button"
            className="ui-icon-button shrink-0 text-amber-600 dark:text-amber-400"
            title="取消收藏"
            aria-label="取消收藏"
            onClick={() => {
              void clearTaskFavorite(task.id).catch(() => {
                /* 存储层提示错误。 */
              })
            }}
          >
            {starIcon}
          </button>
        ) : (
          <div className="w-10 shrink-0 max-md:w-11">
            <FavoriteCategoryMenu
              includeDefaultFallback
              align="right"
              onSelect={(categoryId) => {
                if (categoryId)
                  void setTaskFavoriteCategory(task.id, categoryId).catch(() => {
                    /* 存储层提示错误。 */
                  })
              }}
              renderTrigger={({ toggle }) => (
                <button
                  type="button"
                  className="ui-icon-button shrink-0 text-content-muted"
                  title="收藏记录"
                  aria-label="收藏记录"
                  onClick={toggle}
                >
                  {starIcon}
                </button>
              )}
            />
          </div>
        )}
        <button
          type="button"
          className="ui-button min-w-0 flex-1 whitespace-nowrap px-2 text-content-muted"
          onClick={onOpenDetails}
        >
          查看详情
        </button>
        <TaskActionsMenu
          task={task}
          onReuse={onReuse}
          onEditOutputs={onEditOutputs}
          onDelete={onDelete}
        />
      </div>
    </div>
  )
}
