import { useRef } from 'react'
import { useStore } from '../../store'
import { usePopoverDismiss } from '../../hooks/usePopoverDismiss'
import { calculateImageSize, normalizeImageSize, detectTier, detectRatioFromSize, type SizeTier } from '../../lib/image/size'

/**
 * 分辨率 pill 弹出菜单：自动 / 1K / 2K / 4K。
 * 切换分辨率时保留当前 ratio：从 params.size 还原比例后乘上新的 tier 再写回 params。
 */
export default function ResolutionMenu({
  anchorRef,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const params = useStore((s) => s.params)
  const setParams = useStore((s) => s.setParams)
  const ref = useRef<HTMLDivElement>(null)

  usePopoverDismiss(true, anchorRef, ref, onClose)

  const currentTier = detectTier(params.size)
  const apply = (tier: SizeTier | 'auto') => {
    if (tier === 'auto') {
      setParams({ size: 'auto' })
      onClose()
      return
    }
    const ratio = detectRatioFromSize(params.size) ?? '1:1'
    const nextSize = calculateImageSize(tier, ratio)
    if (nextSize) setParams({ size: normalizeImageSize(nextSize) })
    onClose()
  }

  const items: Array<{ value: SizeTier | 'auto'; label: string; hint: string }> = [
    { value: 'auto', label: '自动', hint: '由模型决定' },
    { value: '1K', label: '1K', hint: '约 1024px 短边' },
    { value: '2K', label: '2K', hint: '约 2048px 长边' },
    { value: '4K', label: '4K', hint: '约 3840px 长边' },
  ]

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="选择输出分辨率"
      className="absolute bottom-full left-0 mb-2 min-w-[180px] rounded-2xl border border-gray-200/70 bg-white/95 p-2 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10 z-40"
    >
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const active = currentTier === item.value
          return (
            <li key={item.value}>
              <button
                type="button"
                onClick={() => apply(item.value)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                  active
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]'
                }`}
              >
                <span className="flex flex-col leading-tight">
                  <span className="font-medium">{item.label}</span>
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">{item.hint}</span>
                </span>
                {active && (
                  <svg className="h-4 w-4 shrink-0 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
