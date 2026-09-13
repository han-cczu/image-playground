import { memo } from 'react'
import type { DraggableAttributes } from '@dnd-kit/core'
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities'
import type { TaskRecord } from '../../types'
import { useStore } from '../../store'
import { useLazyCoverImage } from '../../hooks/useLazyCoverImage'
import { useSwipeSelection } from './useSwipeSelection'
import { useTaskTimer } from './useTaskTimer'
import { useCoverMeta } from './useCoverMeta'
import SwipeBackground from './SwipeBackground'
import CoverArea from './CoverArea'
import InfoArea from './InfoArea'
import type { ConversationTagProp } from './ParamPills'

interface DragHandle {
  ref: (node: HTMLElement | null) => void
  listeners: SyntheticListenerMap | undefined
  attributes: DraggableAttributes
  disabled: boolean
}

interface Props {
  task: TaskRecord
  onReuse: () => void
  onEditOutputs: () => void
  onDelete: () => void
  onClick: (e: React.MouseEvent | React.TouchEvent) => void
  isSelected?: boolean
  dragActivatorRef?: DragHandle['ref']
  dragListeners?: DragHandle['listeners']
  dragAttributes?: DragHandle['attributes']
  dragDisabled?: boolean
  /** 图库视图下渲染所属对话标签；undefined 时不渲染 */
  conversationTag?: ConversationTagProp
}

// React.memo:大库框选 setSelectedTaskIds 触发 TaskGrid 重渲染时,props 未变的卡跳过 reconcile
function TaskCard({
  task,
  onReuse,
  onEditOutputs,
  onDelete,
  onClick,
  isSelected,
  dragActivatorRef,
  dragListeners,
  dragAttributes,
  dragDisabled,
  conversationTag,
}: Props) {
  // 封面懒加载:进视口附近才读 IDB;走 objectURL 而非 dataUrl,全尺寸 base64 不再常驻 JS 堆
  const { src: thumbSrc, attachRef: attachCoverRef } = useLazyCoverImage(task.outputImages?.[0])
  const { coverRatio, coverSize } = useCoverMeta(thumbSrc, task.outputImages)
  const duration = useTaskTimer(task)
  const {
    swipeOffset,
    isSwiping,
    swipeStartedSelected,
    swipeActionActive,
    suppressClickUntilRef,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
  } = useSwipeSelection(task.id, isSelected)
  const favoriteCategories = useStore((s) => s.favoriteCategories)

  const favoriteCategory = task.favoriteCategoryId
    ? favoriteCategories.find((category) => category.id === task.favoriteCategoryId)
    : null

  return (
    <div ref={attachCoverRef} className="relative rounded-2xl">
      {/* 侧滑底图 */}
      <SwipeBackground
        isSwiping={isSwiping}
        swipeOffset={swipeOffset}
        swipeStartedSelected={swipeStartedSelected}
        swipeActionActive={swipeActionActive}
      />

      <div
        className={`group relative overflow-hidden rounded-2xl border bg-surface text-content shadow-sm cursor-pointer duration-150 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
          !isSwiping
            ? 'transition-[box-shadow,border-color,background-color,transform]'
            : 'transition-[box-shadow,border-color,background-color]'
        } ${
          isSelected
            ? 'border-brand ring-2 ring-brand/25'
            : task.status === 'running'
              ? 'border-brand/50'
              : 'border-line hover:border-brand/40'
        }`}
        style={{
          transform: swipeOffset ? `translateX(${swipeOffset}px)` : undefined,
          // 横向滑动选择交给手势、纵向仍可滚动;用 CSS 抑制方向冲突(passive 监听下 preventDefault 无效)
          touchAction: 'pan-y',
        }}
        // 打开详情是卡片的核心交互,裸 div onClick 键盘完全不可达:补 tabIndex/键盘激活。
        // 不用 role="button":卡片内嵌着收藏/重试/拖拽手柄等真实 button,button 角色按 ARIA 规范
        // 不允许交互式后代(children-presentational),屏幕阅读器会把整卡读成单个按钮吞掉内部操作;
        // role="group" + aria-label 保留可聚焦与可命名,内部按钮语义完整
        role="group"
        tabIndex={0}
        aria-label={`任务：${task.prompt.slice(0, 50) || '未命名'}，按 Enter 查看详情`}
        onClick={(e) => {
          if (Date.now() < suppressClickUntilRef.current) {
            e.preventDefault()
            e.stopPropagation()
            return
          }
          onClick(e)
        }}
        onKeyDown={(e) => {
          // 只响应卡片自身的按键,不劫持内部按钮(收藏/重试/手柄)的 Enter/Space
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick(e as unknown as React.MouseEvent)
          }
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
      >
        {/* 拖拽手柄（仅桌面端） */}
        {dragActivatorRef && (
          <button
            type="button"
            ref={dragActivatorRef}
            {...(dragDisabled ? {} : dragAttributes)}
            {...(dragDisabled ? {} : dragListeners)}
            onClick={(e) => e.stopPropagation()}
            disabled={dragDisabled}
            title={dragDisabled ? '当前视图不支持调整顺序' : '拖动调整顺序；空格拾起、方向键移动'}
            aria-label="拖动调整顺序"
            className="absolute right-2 top-2 z-10 hidden h-11 w-11 items-center justify-center rounded-lg bg-surface/90 text-content-muted shadow-sm transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-30 sm:flex cursor-grab active:cursor-grabbing"
            style={{ touchAction: 'none' }}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="9" cy="6" r="1.5" />
              <circle cx="15" cy="6" r="1.5" />
              <circle cx="9" cy="12" r="1.5" />
              <circle cx="15" cy="12" r="1.5" />
              <circle cx="9" cy="18" r="1.5" />
              <circle cx="15" cy="18" r="1.5" />
            </svg>
          </button>
        )}
        <div>
          {/* 固定比例的预览画布保留图片完整构图，任务仍以一张卡表示。 */}
          <CoverArea
            task={task}
            thumbSrc={thumbSrc}
            coverRatio={coverRatio}
            coverSize={coverSize}
            duration={duration}
          />

          {/* 摘要、选择、收藏和详情始终可见。 */}
          <InfoArea
            task={task}
            isSelected={isSelected}
            favoriteCategory={favoriteCategory}
            conversationTag={conversationTag}
            onReuse={onReuse}
            onEditOutputs={onEditOutputs}
            onDelete={onDelete}
            onOpenDetails={onClick}
          />
        </div>
      </div>
    </div>
  )
}

export default memo(TaskCard)
