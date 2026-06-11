/** 缩放倍率徽标(是否显示由父级条件渲染控制,保持原 DOM 结构) */
export function ZoomBadge({ zoomPercent }: { zoomPercent: number }) {
  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-none">
      <span className="px-3 py-1.5 bg-black/50 text-white/80 text-xs rounded-full backdrop-blur-sm transition-opacity duration-500">
        {zoomPercent}%
      </span>
    </div>
  )
}

/** 多图浏览时的「当前/总数」索引指示 */
export function IndexIndicator({ currentIndex, total }: { currentIndex: number; total: number }) {
  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-none">
      <span className="px-3 py-1.5 bg-black/50 text-white/80 text-xs rounded-full backdrop-blur-sm">
        {currentIndex + 1} / {total}
      </span>
    </div>
  )
}
