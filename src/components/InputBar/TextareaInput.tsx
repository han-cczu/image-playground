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
    <div className="relative min-w-0 flex-1">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        placeholder="描述你想要的图片，支持粘贴图片..."
        aria-label="描述图片"
        className="ui-field w-full resize-none border-transparent bg-surface py-3 pl-1 pr-11 text-base leading-relaxed placeholder:text-content-subtle md:text-sm"
      />
      {value.trim().length > 0 && (
        <button
          type="button"
          onClick={() => {
            onClear()
            requestAnimationFrame(() => adjustHeight())
            textareaRef.current?.focus()
          }}
          className="ui-icon-button absolute right-0 top-0 min-h-10 min-w-10 text-content-muted"
          aria-label="清空输入"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </div>
  )
}
