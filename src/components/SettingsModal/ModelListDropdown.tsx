import { useEffect, useRef } from 'react'
import type { JSX } from 'react'

export interface ModelListDropdownProps {
  value: string
  onChange: (model: string) => void
  onFetch: () => Promise<void>
  isLoading: boolean
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  modelList: string[] | null
  error: string | null
  placeholder?: string
  showFetchButton?: boolean
}

export function ModelListDropdown({
  value,
  onChange,
  onFetch,
  isLoading,
  isOpen,
  onOpenChange,
  modelList,
  error,
  placeholder,
  showFetchButton = true,
}: ModelListDropdownProps): JSX.Element {
  const fieldRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (fieldRef.current && !fieldRef.current.contains(e.target as Node)) {
        onOpenChange(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [isOpen, onOpenChange])

  return (
    <div ref={fieldRef} className="relative">
      <div className="flex items-stretch gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          type="text"
          placeholder={placeholder}
          className="flex-1 min-w-0 ui-field text-base md:text-sm"
        />
        {showFetchButton && (
          <button
            type="button"
            onClick={onFetch}
            disabled={isLoading}
            title="从 API 拉取模型列表"
            aria-label="从 API 拉取模型列表"
            className="flex-shrink-0 rounded-xl border border-line bg-surface px-2.5 text-content-muted transition hover:bg-surface-muted hover:text-content disabled:opacity-50 disabled:cursor-not-allowed dark:border-line dark:bg-surface-raised dark:text-content-muted dark:hover:bg-surface-raised dark:hover:text-content"
          >
            <svg
              className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <path d="M21 12a9 9 0 0 1-15.5 6.36L3 21" />
              <path d="M3 12a9 9 0 0 1 15.5-6.36L21 3" />
              <path d="M21 3v6h-6" />
              <path d="M3 21v-6h6" />
            </svg>
          </button>
        )}
      </div>
      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-surface dark:bg-surface-muted backdrop-blur-xl border border-line dark:border-line rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] py-1 max-h-60 overflow-y-auto ring-1 ring-black/5 dark:ring-line animate-dropdown-down">
          {isLoading ? (
            <div className="px-3 py-2 text-xs text-content-muted dark:text-content-muted">
              加载中…
            </div>
          ) : error ? (
            <div className="px-3 py-2 text-xs text-red-500 dark:text-red-400 break-all">
              {error}
              <div className="mt-1 text-content-subtle dark:text-content-subtle">
                可继续手动填写模型 ID。
              </div>
            </div>
          ) : modelList && modelList.length > 0 ? (
            modelList.map((id) => (
              <div
                key={id}
                onClick={() => {
                  onChange(id)
                  onOpenChange(false)
                }}
                className={`px-3 py-2 text-xs cursor-pointer transition-colors break-all ${
                  id === value
                    ? 'bg-brand-soft dark:bg-brand-soft text-brand-ink dark:text-brand-ink font-medium'
                    : 'text-content dark:text-content hover:bg-surface-muted dark:hover:bg-surface-raised'
                }`}
              >
                {id}
              </div>
            ))
          ) : (
            <div className="px-3 py-2 text-xs text-content-muted dark:text-content-muted">
              暂无可用模型
            </div>
          )}
        </div>
      )}
    </div>
  )
}
