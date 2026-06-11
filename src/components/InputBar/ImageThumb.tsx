import type { InputImage } from '../../types'
import ButtonTooltip from './ButtonTooltip'

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
  hintHandlers: { onHintShow: () => void; onHintHide: () => void }
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
      {/* 本体仅在 !canEdit(无内部覆盖按钮)时可交互:role=button 与真 button 一样要求子树
         presentational,canEdit 时内嵌编辑按钮会构成 nested-interactive 违例;且指针在
         canEdit 时本就只能命中 inset-0 覆盖按钮,键盘入口由它独占,两种输入行为一致 */}
      <div
        {...(!canEdit
          ? {
              role: 'button' as const,
              tabIndex: 0,
              'aria-label': '查看大图',
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  dragHandlers.onClickImage()
                }
              },
            }
          : {})}
        className={`relative w-[52px] h-[52px] rounded-xl overflow-hidden shadow-sm cursor-grab active:cursor-grabbing select-none outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
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
          /* 焦点环用 ring-inset:父层 overflow-hidden 会裁掉外扩的 box-shadow */
          <button
            type="button"
            className="absolute inset-0 w-full h-full bg-black/40 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400 transition-opacity flex items-center justify-center cursor-pointer z-20 outline-none border-none"
            onClick={(e) => {
              e.stopPropagation()
              onEditMask(img.id)
            }}
            title={isMaskTarget ? '编辑遮罩' : '添加遮罩'}
            aria-label={isMaskTarget ? '编辑遮罩' : '添加遮罩'}
          >
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
        )}
      </div>
      {!isMaskTarget && (
        /* hover 显示;group-focus-within 兜键盘(display:none 不进 Tab 序),
           hover:none 兜触屏、any-pointer:coarse 兜混合设备(hover:hover 的触屏本) */
        <button
          type="button"
          aria-label="移除此图"
          title="移除此图"
          className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-red-500 text-white hidden group-hover:flex group-focus-within:flex [@media(hover:none)]:flex [@media(any-pointer:coarse)]:flex items-center justify-center cursor-pointer shadow-md hover:bg-red-600 z-30 outline-none focus-visible:ring-2 focus-visible:ring-blue-400 transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            onRemove(idx)
          }}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}
