export interface TextareaInputProps {
  value: string
  onChange: (value: string) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onClear: () => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  adjustHeight: () => void
}

export default function TextareaInput({
  value,
  onChange,
  onKeyDown,
  onClear,
  textareaRef,
  adjustHeight,
}: TextareaInputProps) {
  return (
    <div className="relative flex-1">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        placeholder="描述你想要的图片，支持粘贴图片..."
        aria-label="描述图片"
        className="w-full px-4 py-3 rounded-2xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] text-sm focus:outline-none leading-relaxed resize-none shadow-sm transition-[border-color,box-shadow] duration-200"
      />
      {value.trim().length > 0 && (
        <button
          type="button"
          onClick={() => {
            onClear()
            requestAnimationFrame(() => adjustHeight())
            textareaRef.current?.focus()
          }}
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-white/[0.06] dark:hover:text-gray-300 transition-colors"
          aria-label="清空输入"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}
