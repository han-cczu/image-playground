import { useEffect, useRef } from 'react'

interface MaskInfoPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function MaskInfoPopover({ open, onOpenChange }: MaskInfoPopoverProps) {
  const maskInfoTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (maskInfoTimerRef.current != null) {
      window.clearTimeout(maskInfoTimerRef.current)
    }
  }, [])

  const clearMaskInfoTimer = () => {
    if (maskInfoTimerRef.current != null) {
      window.clearTimeout(maskInfoTimerRef.current)
      maskInfoTimerRef.current = null
    }
  }

  const showMaskInfoPopover = () => onOpenChange(true)

  const hideMaskInfoPopover = () => {
    onOpenChange(false)
    clearMaskInfoTimer()
  }

  const startMaskInfoTouch = () => {
    maskInfoTimerRef.current = window.setTimeout(() => {
      onOpenChange(true)
      maskInfoTimerRef.current = null
    }, 450)
  }

  return (
    <div className="relative flex items-center gap-1.5">
      <h2 className="text-sm font-medium text-gray-700 dark:text-gray-200" id="mask-editor-title">编辑遮罩</h2>
      <button
        type="button"
        onClick={showMaskInfoPopover}
        onMouseEnter={showMaskInfoPopover}
        onMouseLeave={hideMaskInfoPopover}
        onTouchStart={startMaskInfoTouch}
        onTouchEnd={clearMaskInfoTimer}
        onTouchCancel={hideMaskInfoPopover}
        className="flex h-6 w-6 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        aria-label="遮罩编辑说明"
        title="遮罩编辑说明"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-2 w-64 rounded-xl border border-gray-200/80 bg-white px-3 py-2 text-xs leading-5 text-gray-600 shadow-lg dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-300">
          <div className="absolute -top-1.5 left-16 h-3 w-3 rotate-45 border-l border-t border-gray-200/80 bg-white dark:border-white/[0.08] dark:bg-gray-900" />
          根据官方文档说明，此功能仅基于提示词，无法完全控制模型编辑区域
        </div>
      )}
    </div>
  )
}
