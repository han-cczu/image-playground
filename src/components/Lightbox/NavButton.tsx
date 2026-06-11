const navBtnClass =
  'absolute top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 text-white hover:bg-black/60 transition-all z-10 backdrop-blur-sm'

interface NavButtonProps {
  direction: 'prev' | 'next'
  onNavigate: () => void
}

/** 左右切换按钮:方向参数化;点击需阻止冒泡,避免触发容器的单击关闭 */
export default function NavButton({ direction, onNavigate }: NavButtonProps) {
  const isPrev = direction === 'prev'
  const label = isPrev ? '上一张' : '下一张'
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`${navBtnClass} ${isPrev ? 'left-3 sm:left-5' : 'right-3 sm:right-5'}`}
      onClick={(e) => { e.stopPropagation(); onNavigate() }}
    >
      <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d={isPrev ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'}
        />
      </svg>
    </button>
  )
}
