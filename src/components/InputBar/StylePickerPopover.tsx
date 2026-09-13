import PopoverSurface from './PopoverSurface'
import { useRef } from 'react'
import { useStore } from '../../store'
import { usePopoverDismiss } from '../../hooks/usePopoverDismiss'
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
  ...Object.entries(STYLE_PRESETS).map(([key, value]) => ({
    key: key as StylePresetKey,
    label: value.label,
  })),
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

  usePopoverDismiss(true, anchorRef, popoverRef, onClose)

  const handleSelect = (key: StylePresetKey | undefined) => {
    setParams({ stylePreset: key })
    onClose()
  }

  return (
    <PopoverSurface anchorRef={anchorRef} panelRef={popoverRef} label="选择风格预设" width={230}>
      <ul aria-label="选择风格预设" className="flex max-h-[320px] flex-col gap-0.5 overflow-y-auto">
        {ITEMS.map((item) => {
          const active = params.stylePreset === item.key
          return (
            <li key={item.key ?? '__none__'}>
              <button
                type="button"
                onClick={() => handleSelect(item.key)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                  active
                    ? 'bg-brand-soft text-brand-ink  '
                    : 'text-content hover:bg-surface-muted  '
                }`}
              >
                <span className="font-medium">{item.label}</span>
                {active && (
                  <svg
                    className="h-4 w-4 shrink-0 text-brand-ink"
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
    </PopoverSurface>
  )
}
