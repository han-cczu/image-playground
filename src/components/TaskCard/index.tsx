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
  dragHandle?: DragHandle
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
  dragHandle,
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
    <div ref={attachCoverRef} className="relative rounded-xl">
      {/* 侧滑底图 */}
      <SwipeBackground
        isSwiping={isSwiping}
        swipeOffset={swipeOffset}
        swipeStartedSelected={swipeStartedSelected}
        swipeActionActive={swipeActionActive}
      />

      <div
        className={`group relative bg-white dark:bg-gray-900 rounded-xl border overflow-hidden cursor-pointer duration-200 hover:shadow-lg dark:hover:shadow-[0_10px_40px_-12px_rgba(99,102,241,0.35)] dark:hover:bg-gray-800/80 ${
          !isSwiping ? 'transition-[box-shadow,border-color,background-color,transform]' : 'transition-[box-shadow,border-color,background-color]'
        } ${
          task.status === 'running'
            ? 'border-blue-400 generating'
            : isSelected
            ? 'border-blue-500 shadow-md ring-2 ring-blue-500/50'
            : 'border-gray-200 dark:border-white/[0.08] hover:border-gray-300 dark:hover:border-white/[0.18]'
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
        {/* 选中时的角标 */}
      {isSelected && (
        <div className="absolute top-2 right-2 z-10 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center shadow-sm">
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}
      {/* 拖拽手柄（仅桌面端） */}
      {dragHandle && (
        <button
          type="button"
          ref={dragHandle.ref}
          {...(dragHandle.disabled ? {} : dragHandle.attributes)}
          {...(dragHandle.disabled ? {} : dragHandle.listeners)}
          onClick={(e) => e.stopPropagation()}
          title={dragHandle.disabled ? '清除筛选后可调整顺序' : '拖动调整顺序'}
          aria-label="拖动调整顺序"
          className={`hidden sm:flex absolute top-2 z-10 w-5 h-5 items-center justify-center rounded-md transition-opacity ${
            isSelected ? 'right-9' : 'right-2'
          } ${
            dragHandle.disabled
              ? 'opacity-20 cursor-not-allowed text-gray-400 dark:text-gray-500'
              : 'opacity-0 group-hover:opacity-60 hover:!opacity-100 cursor-grab active:cursor-grabbing text-gray-500 dark:text-gray-400 bg-white/70 dark:bg-gray-900/70 backdrop-blur'
          }`}
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
      <div className="flex h-40">
        {/* 左侧图片区域 */}
        <CoverArea
          task={task}
          thumbSrc={thumbSrc}
          coverRatio={coverRatio}
          coverSize={coverSize}
          duration={duration}
        />

        {/* 右侧信息区域 */}
        <InfoArea
          task={task}
          favoriteCategory={favoriteCategory}
          conversationTag={conversationTag}
          onReuse={onReuse}
          onEditOutputs={onEditOutputs}
          onDelete={onDelete}
        />
      </div>
      </div>
    </div>
  )
}

export default memo(TaskCard)
