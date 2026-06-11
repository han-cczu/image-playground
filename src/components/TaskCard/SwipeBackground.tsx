interface Props {
  isSwiping: boolean
  swipeOffset: number
  swipeStartedSelected: boolean
  swipeActionActive: boolean
}

/**
 * 侧滑底图:位于卡片下层,随卡片位移露出;|offset| ≥ 40 或动作已触发时
 * 高亮(选择=蓝底勾、取消选择=灰底叉),否则保持浅灰待命态。
 */
export default function SwipeBackground({
  isSwiping,
  swipeOffset,
  swipeStartedSelected,
  swipeActionActive,
}: Props) {
  const isSwipeReady = Math.abs(swipeOffset) >= 40
  const showSwipeAction = isSwipeReady || swipeActionActive
  const swipeBgClass = showSwipeAction
    ? swipeStartedSelected
      ? 'bg-gray-500 dark:bg-gray-600'
      : 'bg-blue-500'
    : 'bg-gray-200 dark:bg-gray-700'

  return (
    <div
      className={`absolute inset-0 rounded-xl flex items-center transition-opacity duration-200 pointer-events-none ${
        isSwiping || swipeOffset || swipeActionActive ? 'opacity-100' : 'opacity-0'
      } ${swipeBgClass} ${
        swipeOffset > 0 ? 'justify-start pl-6' : 'justify-end pr-6'
      }`}
    >
      <svg className={`w-8 h-8 transition-transform duration-150 ${showSwipeAction ? 'scale-110 text-white' : 'scale-90 text-white/60'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        {swipeStartedSelected && showSwipeAction ? (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        )}
      </svg>
    </div>
  )
}
