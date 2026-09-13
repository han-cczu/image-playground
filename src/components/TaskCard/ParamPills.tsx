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

/** 摘要只保留尺寸、数量和模型，完整参数继续在详情中展示；分类与对话标签可换行。 */
export default function ParamPills({ task, favoriteCategory, conversationTag }: Props) {
  const aggregateActualParams = task.outputImages?.length
    ? { ...task.actualParams, n: task.outputImages.length }
    : task.actualParams

  return (
    <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-1.5">
      <ParamValue
        task={task}
        paramKey="size"
        className="text-xs px-1.5 py-0.5 rounded flex-shrink-0"
      />
      <span className="inline-flex items-center gap-1 text-xs text-content-muted">
        <ParamValue
          task={task}
          paramKey="n"
          className="shrink-0 rounded px-1.5 py-0.5"
          actualParams={aggregateActualParams}
        />
        张
      </span>
      {task.apiModel && (
        <span
          className="min-w-0 max-w-40 truncate rounded bg-surface-muted px-1.5 py-0.5 text-xs text-content-muted"
          title={task.apiModel}
        >
          {task.apiModel}
        </span>
      )}
      {task.maskImageId && (
        <span className="shrink-0 rounded bg-brand-soft px-1.5 py-0.5 text-xs text-brand-ink">
          遮罩
        </span>
      )}
      {favoriteCategory && task.isFavorite && (
        <span
          className="flex min-w-0 max-w-28 items-center gap-1 rounded bg-surface-muted px-1.5 py-0.5 text-xs text-content-muted"
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
          className="flex min-h-8 min-w-0 max-w-[180px] items-center gap-1 rounded bg-surface-muted px-2 text-xs text-content-muted hover:bg-brand-soft hover:text-brand-ink"
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
