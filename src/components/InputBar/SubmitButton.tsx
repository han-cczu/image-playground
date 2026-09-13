import { useHintTooltip } from '../../hooks/useHintTooltip'
import ButtonTooltip from './ButtonTooltip'

export interface SubmitButtonProps {
  canSubmit: boolean
  hasMask: boolean
  onSubmit: () => void | Promise<void>
  onOpenSettings: () => void
  needsConfig: boolean
}

export default function SubmitButton({
  canSubmit,
  hasMask,
  onSubmit,
  onOpenSettings,
  needsConfig,
}: SubmitButtonProps) {
  // 未配置 API 的引导气泡:hover/聚焦/触屏轻点均可见,原实现把 hover 状态提升到父级并无必要
  const hint = useHintTooltip<HTMLDivElement>({ enabled: needsConfig })

  const handleClick = () => {
    if (needsConfig) {
      onOpenSettings()
      return
    }
    const result = onSubmit()
    if (result) {
      void result.catch(() => {
        /* submitTask surfaces recoverable errors via toast */
      })
    }
  }

  return (
    <div
      data-tour-id="submit"
      className="relative flex shrink-0 items-end pb-0.5"
      {...hint.anchorProps}
    >
      <ButtonTooltip visible={needsConfig && hint.visible} text="尚未完成 API 配置，点击打开设置" />
      <button
        type="button"
        onClick={handleClick}
        disabled={needsConfig ? false : !canSubmit}
        className="ui-button min-h-11 gap-2 bg-brand px-4 font-semibold text-on-brand shadow-sm hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
        title={
          needsConfig ? '请先配置 API' : hasMask ? '遮罩编辑 (Ctrl+Enter)' : '生成 (Ctrl+Enter)'
        }
        aria-label={needsConfig ? '配置 API' : hasMask ? '提交遮罩编辑' : '提交生成'}
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 12l14-7-3 7 3 7-14-7z"
          />
        </svg>
        <span>{needsConfig ? '配置 API' : hasMask ? '应用遮罩' : '生成'}</span>
      </button>
    </div>
  )
}
