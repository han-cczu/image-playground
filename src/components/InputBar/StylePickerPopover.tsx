import { useEffect, useRef } from 'react'
import { useStore } from '../../store'
import { STYLE_PRESETS, type StylePresetKey } from '../../lib/stylePresets'

interface Props {
  /** 锚点（风格 pill）的元素引用，用于点击外部检测 */
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
}

interface StyleItem {
  /** undefined 表示"无风格" */
  key: StylePresetKey | undefined
  label: string
}

const ITEMS: StyleItem[] = [
  { key: undefined, label: '无风格' },
  ...(Object.entries(STYLE_PRESETS).map(([key, value]) => ({
    key: key as StylePresetKey,
    label: value.label,
  }))),
]

/**
 * 风格预设 popover：列出"无风格 + 8 种风格"共 9 个选项。
 *
 * 结构对齐 AdvancedParamsPopover：anchorRef + onClose + Esc/outside-click。
 */
export default function StylePickerPopover({ anchorRef, onClose }: Props) {
  const params = useStore((s) => s.params)
  const setParams = useStore((s) => s.setParams)

  const popoverRef = useRef<HTMLDivElement>(null)

  /** Esc 关闭、点击外部关闭 */
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
      if (popoverRef.current?.contains(target)) return
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

  const handleSelect = (key: StylePresetKey | undefined) => {
    setParams({ stylePreset: key })
    onClose()
  }

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-full left-0 mb-2 min-w-[200px] rounded-2xl border border-gray-200/70 bg-white/95 p-2 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10 z-40"
    >
      <ul
        aria-label="选择风格预设"
        className="flex max-h-[320px] flex-col gap-0.5 overflow-y-auto"
      >
        {ITEMS.map((item) => {
          const active = params.stylePreset === item.key
          return (
            <li key={item.key ?? '__none__'}>
              <button
                type="button"
                onClick={() => handleSelect(item.key)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                  active
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]'
                }`}
              >
                <span className="font-medium">{item.label}</span>
                {active && (
                  <svg
                    className="h-4 w-4 shrink-0 text-blue-500"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
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
