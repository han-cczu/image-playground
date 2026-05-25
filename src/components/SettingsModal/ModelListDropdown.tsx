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
          className="flex-1 min-w-0 rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
        />
        {showFetchButton && (
          <button
            type="button"
            onClick={onFetch}
            disabled={isLoading}
            title="从 API 拉取模型列表"
            aria-label="从 API 拉取模型列表"
            className="flex-shrink-0 rounded-xl border border-gray-200/70 bg-white/60 px-2.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
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
        <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-gray-200/60 dark:border-white/[0.08] rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] py-1 max-h-60 overflow-y-auto ring-1 ring-black/5 dark:ring-white/10 animate-dropdown-down">
          {isLoading ? (
            <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">加载中…</div>
          ) : error ? (
            <div className="px-3 py-2 text-xs text-red-500 dark:text-red-400 break-all">
              {error}
              <div className="mt-1 text-gray-400 dark:text-gray-500">可继续手动填写模型 ID。</div>
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
                    ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.06]'
                }`}
              >
                {id}
              </div>
            ))
          ) : (
            <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">暂无可用模型</div>
          )}
        </div>
      )}
    </div>
  )
}
