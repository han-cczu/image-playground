import ButtonTooltip from './ButtonTooltip'

export interface SubmitButtonProps {
  canSubmit: boolean
  hasMask: boolean
  hover: boolean
  onHoverChange: (hover: boolean) => void
  onSubmit: () => void
  onOpenSettings: () => void
  needsConfig: boolean
}

export default function SubmitButton({
  canSubmit,
  hasMask,
  hover,
  onHoverChange,
  onSubmit,
  onOpenSettings,
  needsConfig,
}: SubmitButtonProps) {
  return (
    <div
      data-tour-id="submit"
      className="relative flex shrink-0 items-end pb-0.5"
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <ButtonTooltip visible={needsConfig && hover} text="尚未完成 API 配置，请点 sidebar 底部齿轮按钮打开设置" />
      <button
        type="button"
        onClick={() => (needsConfig ? onOpenSettings() : onSubmit())}
        disabled={needsConfig ? false : !canSubmit}
        className={`flex h-11 w-11 items-center justify-center rounded-2xl transition-all ${
          needsConfig
            ? 'bg-gray-300 dark:bg-white/[0.06] text-white cursor-pointer shadow-sm hover:shadow'
            : 'bg-gradient-to-br from-blue-500 to-indigo-500 text-white shadow-[0_4px_20px_-6px_rgba(79,70,229,0.6)] hover:from-blue-400 hover:to-indigo-400 hover:shadow-[0_6px_26px_-6px_rgba(79,70,229,0.85)] active:scale-95 disabled:from-gray-300 disabled:to-gray-300 disabled:shadow-none disabled:opacity-50 disabled:cursor-not-allowed dark:disabled:from-white/[0.04] dark:disabled:to-white/[0.04]'
        }`}
        title={needsConfig ? '请先配置 API' : hasMask ? '遮罩编辑 (Ctrl+Enter)' : '生成 (Ctrl+Enter)'}
        aria-label={hasMask ? '提交遮罩编辑' : '提交生成'}
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12l14-7-3 7 3 7-14-7z" />
        </svg>
      </button>
    </div>
  )
}
