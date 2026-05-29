import { useState, useRef, useEffect, useCallback } from 'react'

interface Option {
  label: string
  value: string | number
}

interface SelectProps {
  value: string | number
  onChange: (value: any) => void
  options: Option[]
  disabled?: boolean
  className?: string
}

export default function Select({ value, onChange, options, disabled, className }: SelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [openUp, setOpenUp] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<(HTMLDivElement | null)[]>([])

  const selectedOption = options.find((o) => o.value === value)
  const selectedIndex = options.findIndex((o) => o.value === value)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 打开后把焦点移到 active 项(roving focus),键盘用户可见高亮并被读屏播报
  useEffect(() => {
    if (isOpen && activeIndex >= 0) optionRefs.current[activeIndex]?.focus()
  }, [isOpen, activeIndex])

  const openMenu = useCallback((index: number) => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setOpenUp(rect.top > window.innerHeight - rect.bottom)
    }
    setActiveIndex(index)
    setIsOpen(true)
  }, [])

  const commit = useCallback(
    (index: number) => {
      const option = options[index]
      if (option) onChange(option.value)
      setIsOpen(false)
      triggerRef.current?.focus()
    },
    [options, onChange],
  )

  const handleTriggerClick = (e: React.MouseEvent) => {
    if (disabled) return
    e.stopPropagation()
    if (isOpen) setIsOpen(false)
    else openMenu(selectedIndex >= 0 ? selectedIndex : 0)
  }

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault()
      openMenu(selectedIndex >= 0 ? selectedIndex : 0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      openMenu(options.length - 1)
    }
  }

  const handleListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(options.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(0, i - 1))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActiveIndex(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActiveIndex(options.length - 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      commit(activeIndex)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setIsOpen(false)
      triggerRef.current?.focus()
    } else if (e.key === 'Tab') {
      setIsOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        className={`flex items-center justify-between gap-1 w-full cursor-pointer select-none text-left ${className ?? ''} ${
          disabled ? '!opacity-50 !cursor-not-allowed !bg-gray-100/50 dark:!bg-white/[0.05]' : ''
        }`}
      >
        <span className="truncate">{selectedOption?.label ?? value}</span>
        <svg
          className={`w-3.5 h-3.5 flex-shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div
          role="listbox"
          tabIndex={-1}
          onKeyDown={handleListKeyDown}
          className={`absolute z-50 w-full bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-gray-200/60 dark:border-white/[0.08] rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] overflow-hidden py-1 max-h-60 overflow-y-auto ring-1 ring-black/5 dark:ring-white/10 ${
            openUp ? 'bottom-full mb-1.5 animate-dropdown-up' : 'top-full mt-1.5 animate-dropdown-down'
          }`}
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              ref={(el) => {
                optionRefs.current[index] = el
              }}
              role="option"
              aria-selected={option.value === value}
              tabIndex={-1}
              onClick={() => commit(index)}
              className={`px-3 py-2 text-xs cursor-pointer transition-colors outline-none focus:bg-gray-100 dark:focus:bg-white/[0.1] ${
                option.value === value
                  ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.06]'
              }`}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
