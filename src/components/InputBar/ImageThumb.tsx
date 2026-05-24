import type { ReactNode } from 'react'
import type { InputImage } from '../../types'
import ViewportTooltip from '../ViewportTooltip'

/** 通用悬浮气泡提示 */
function ButtonTooltip({ visible, text }: { visible: boolean; text: ReactNode }) {
  return (
    <ViewportTooltip visible={visible} className="z-10 whitespace-nowrap">
      {text}
    </ViewportTooltip>
  )
}

/** 单张缩略图需要的拖拽 / 触摸回调集合（由 ImageGrid 提供） */
export interface ImageDragHandlers {
  draggable: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
  onTouchStart: (e: React.TouchEvent) => void
  onTouchMove: (e: React.TouchEvent) => void
  onTouchEnd: (e: React.TouchEvent) => void
  onTouchCancel: () => void
  /** 缩略图被点击时（已通过 suppress-click 判定）触发的行为 */
  onClickImage: () => void
  /** 该缩略图整体是否处于拖拽中（半透明态） */
  isImageDragging: boolean
  /** 是否在该缩略图左侧显示插入指示线 */
  showDropBefore: boolean
  /** 是否在该缩略图右侧显示插入指示线 */
  showDropAfter: boolean
  /** touchAction：遮罩图为 auto，其余为 none */
  touchAction: 'auto' | 'none'
}

export interface ImageThumbProps {
  image: InputImage
  index: number
  isMaskTarget: boolean
  maskPreviewUrl: string
  hintVisible: boolean
  /** 当前是否存在遮罩主图（用于决定能否编辑 / 提示文案） */
  hasMaskTarget: boolean
  onRemove: (index: number) => void
  onEditMask: (id: string) => void
  dragHandlers: ImageDragHandlers
  hintHandlers: { onTouchStart: () => void; onHintShow: () => void; onHintHide: () => void }
}

export default function ImageThumb({
  image: img,
  index: idx,
  isMaskTarget,
  maskPreviewUrl,
  hintVisible,
  hasMaskTarget,
  onRemove,
  onEditMask,
  dragHandlers,
  hintHandlers,
}: ImageThumbProps) {
  const canEdit = !hasMaskTarget || isMaskTarget
  const imageHintText = isMaskTarget
    ? '遮罩图必须为第一张图'
    : hasMaskTarget
      ? '只能有一张遮罩图'
      : ''
  const displaySrc = isMaskTarget && maskPreviewUrl ? maskPreviewUrl : img.dataUrl

  return (
    <div
      key={img.id}
      data-input-image-index={idx}
      className={`relative group inline-block shrink-0 transition-opacity ${dragHandlers.isImageDragging ? 'opacity-40' : ''}`}
      style={{ touchAction: dragHandlers.touchAction }}
      draggable={dragHandlers.draggable}
      onMouseEnter={hintHandlers.onHintShow}
      onMouseLeave={hintHandlers.onHintHide}
      onDragStart={dragHandlers.onDragStart}
      onDragOver={dragHandlers.onDragOver}
      onDrop={dragHandlers.onDrop}
      onDragEnd={dragHandlers.onDragEnd}
      onTouchStart={dragHandlers.onTouchStart}
      onTouchMove={dragHandlers.onTouchMove}
      onTouchEnd={dragHandlers.onTouchEnd}
      onTouchCancel={dragHandlers.onTouchCancel}
    >
      <ButtonTooltip
        visible={hintVisible}
        text={imageHintText}
      />
      {dragHandlers.showDropBefore && (
        <div className="absolute -left-[5px] top-0 bottom-0 w-[2px] bg-blue-500 rounded-full z-40 shadow-sm pointer-events-none" />
      )}
      {dragHandlers.showDropAfter && (
        <div className="absolute -right-[5px] top-0 bottom-0 w-[2px] bg-blue-500 rounded-full z-40 shadow-sm pointer-events-none" />
      )}
      <div
        className={`relative w-[52px] h-[52px] rounded-xl overflow-hidden shadow-sm cursor-grab active:cursor-grabbing select-none ${
          isMaskTarget
            ? 'border-2 border-blue-500'
            : 'border border-gray-200 dark:border-white/[0.08]'
        }`}
        onClick={dragHandlers.onClickImage}
      >
        {displaySrc && (
          <img
            src={displaySrc}
            className="w-full h-full object-cover hover:opacity-90 transition-opacity pointer-events-none"
            alt=""
          />
        )}
        {isMaskTarget && (
          <span className="absolute left-1 top-1 rounded bg-blue-500/90 px-1.5 py-0.5 text-[8px] leading-none text-white font-bold tracking-wider backdrop-blur-sm z-10 pointer-events-none">
            MASK
          </span>
        )}
        {canEdit && (
          <button
            className="absolute inset-0 w-full h-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer z-20 focus:outline-none border-none"
            onClick={(e) => {
              e.stopPropagation()
              onEditMask(img.id)
            }}
            title={isMaskTarget ? '编辑遮罩' : '添加遮罩'}
          >
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
        )}
      </div>
      {!isMaskTarget && (
        <span
          className="absolute -top-2 -right-2 w-[22px] h-[22px] rounded-full bg-red-500 text-white flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-red-600 z-30"
          onClick={(e) => {
            e.stopPropagation()
            onRemove(idx)
          }}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </span>
      )}
    </div>
  )
}
