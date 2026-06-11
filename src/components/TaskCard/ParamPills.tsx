import type { FavoriteCategory, TaskRecord } from '../../types'
import { ParamValue } from '../../lib/paramDisplay'

export interface ConversationTagProp {
  id: string
  title: string
  color: string
  onClick: () => void
}

interface Props {
  task: TaskRecord
  /** 已按 task.favoriteCategoryId 解析出的收藏分类;无收藏或找不到时为 null/undefined */
  favoriteCategory: FavoriteCategory | null | undefined
  conversationTag?: ConversationTagProp
}

/** 参数 pills 行(横向滚动):常规参数 + mask/收藏分类/所属对话等特殊 pill */
export default function ParamPills({ task, favoriteCategory, conversationTag }: Props) {
  const aggregateActualParams = task.outputImages?.length
    ? { ...task.actualParams, n: task.outputImages.length }
    : task.actualParams

  return (
    <div className="flex overflow-x-auto hide-scrollbar gap-1.5 whitespace-nowrap mask-edge-r min-w-0 pr-2">
      <ParamValue task={task} paramKey="quality" className="text-xs px-1.5 py-0.5 rounded flex-shrink-0" />
      <ParamValue task={task} paramKey="size" className="text-xs px-1.5 py-0.5 rounded flex-shrink-0" />
      <ParamValue task={task} paramKey="output_format" className="text-xs px-1.5 py-0.5 rounded flex-shrink-0" />
      <ParamValue task={task} paramKey="n" className="text-xs px-1.5 py-0.5 rounded flex-shrink-0" actualParams={aggregateActualParams} />
      {task.maskImageId && (
        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 flex-shrink-0">
          mask
        </span>
      )}
      {favoriteCategory && task.isFavorite && (
        <span
          className="min-w-0 max-w-28 text-xs px-1.5 py-0.5 rounded bg-gray-50 dark:bg-white/[0.04] text-gray-600 dark:text-gray-300 flex items-center gap-1 flex-shrink-0"
          title={favoriteCategory.name}
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: favoriteCategory.color }}
          />
          <span className="min-w-0 truncate">{favoriteCategory.name.trim() || '未命名分类'}</span>
        </span>
      )}
      {conversationTag && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            conversationTag.onClick()
          }}
          className="min-w-0 max-w-[140px] text-xs px-1.5 py-0.5 rounded bg-gray-50 dark:bg-white/[0.04] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.08] flex items-center gap-1 flex-shrink-0"
          title={`来自对话「${conversationTag.title}」`}
          aria-label={`跳转到对话「${conversationTag.title}」`}
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: conversationTag.color }}
            aria-hidden="true"
          />
          <span className="min-w-0 truncate">{conversationTag.title}</span>
        </button>
      )}
    </div>
  )
}
