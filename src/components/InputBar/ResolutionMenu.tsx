import { useRef, useEffect } from 'react'
import { useStore } from '../../store'
import { calculateImageSize, normalizeImageSize, type SizeTier } from '../../lib/image/size'

/** 从 size 字符串推断当前 tier（1K/2K/4K/auto/custom） */
function detectTier(size: string): SizeTier | 'auto' | 'custom' {
  const trimmed = (size || '').trim()
  if (!trimmed || trimmed === 'auto') return 'auto'
  const m = trimmed.match(/^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/)
  if (!m) return 'custom'
  const w = Number(m[1])
  const h = Number(m[2])
  const longSide = Math.max(w, h)
  // 阈值在两档分辨率之间取中点
  if (longSide <= 1536) return '1K'
  if (longSide <= 2944) return '2K'
  return '4K'
}

/** 从 size 字符串推断比例字符串（保留简化形式以便复用 calculateImageSize） */
function detectRatioFromSize(size: string): string | null {
  const trimmed = (size || '').trim()
  if (!trimmed || trimmed === 'auto') return null
  const m = trimmed.match(/^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/)
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
  return `${w}:${h}`
}

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (ref.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [anchorRef, onClose])

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
      aria-modal="true"
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
                  <span className="text-[11px] text-gray-400 dark:text-gray-500">{item.hint}</span>
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
