import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { FavoriteCategory } from '../types'
import { useStore } from '../store'
import {
  DEFAULT_FAVORITE_CATEGORY_ID,
  createDefaultFavoriteCategory,
} from '../lib/favoriteCategories'

interface TriggerArgs {
  isOpen: boolean
  label: string
  selectedCategory: FavoriteCategory | null
  toggle: (e: React.MouseEvent) => void
}

interface FavoriteCategoryMenuProps {
  value?: string | null
  includeAll?: boolean
  allLabel?: string
  includeUnassigned?: boolean
  unassignedLabel?: string
  includeDefaultFallback?: boolean
  createPlaceholder?: string
  align?: 'left' | 'right'
  menuClassName?: string
  matchTriggerWidth?: boolean
  onSelect: (categoryId: string | null) => void
  renderTrigger: (args: TriggerArgs) => ReactNode
}

export default function FavoriteCategoryMenu({
  value = null,
  includeAll = false,
  allLabel = '全部分类',
  includeUnassigned = false,
  unassignedLabel = '不分组',
  includeDefaultFallback = false,
  createPlaceholder = '分类名称',
  align = 'left',
  menuClassName = 'w-44',
  matchTriggerWidth = false,
  onSelect,
  renderTrigger,
}: FavoriteCategoryMenuProps) {
  const favoriteCategories = useStore((s) => s.favoriteCategories)
  const createFavoriteCategory = useStore((s) => s.createFavoriteCategory)
  const ensureDefaultFavoriteCategory = useStore((s) => s.ensureDefaultFavoriteCategory)
  const [isOpen, setIsOpen] = useState(false)
  const [openUp, setOpenUp] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [draftName, setDraftName] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPosition, setMenuPosition] = useState<CSSProperties>({})

  const categories = useMemo(() => {
    const hasDefault = favoriteCategories.some((category) => category.id === DEFAULT_FAVORITE_CATEGORY_ID)
    if (!includeDefaultFallback || hasDefault) return favoriteCategories
    return [createDefaultFavoriteCategory(), ...favoriteCategories]
  }, [favoriteCategories, includeDefaultFallback])

  const selectedCategory = value
    ? categories.find((category) => category.id === value) ?? null
    : null
  const label = selectedCategory?.name.trim() || (value ? '未命名分类' : includeUnassigned ? unassignedLabel : allLabel)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const updateMenuPosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const spaceAbove = rect.top
    const spaceBelow = window.innerHeight - rect.bottom
    const estimatedMenuHeight = Math.min((categories.length + 3) * 36 + 48, 280)
    const nextOpenUp = spaceAbove > spaceBelow && spaceBelow < estimatedMenuHeight
    setOpenUp(nextOpenUp)
    setMenuPosition({
      left: align === 'right' ? rect.right : rect.left,
      top: nextOpenUp ? undefined : rect.bottom + 6,
      bottom: nextOpenUp ? window.innerHeight - rect.top + 6 : undefined,
      width: matchTriggerWidth ? rect.width : undefined,
      transform: align === 'right' ? 'translateX(-100%)' : undefined,
    })
  }, [align, categories.length, matchTriggerWidth])

  useEffect(() => {
    if (!isOpen) return
    updateMenuPosition()
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [isOpen, updateMenuPosition])

  useEffect(() => {
    if (!isOpen) {
      setIsCreating(false)
      setDraftName('')
      return
    }
    if (isCreating) {
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [isCreating, isOpen])

  const closeMenu = () => {
    setIsOpen(false)
  }

  const toggle = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!isOpen) updateMenuPosition()
    setIsOpen((current) => !current)
  }, [isOpen, updateMenuPosition])

  const selectCategory = (categoryId: string | null) => {
    if (!categoryId) {
      onSelect(null)
      closeMenu()
      return
    }
    const nextCategoryId = categoryId === DEFAULT_FAVORITE_CATEGORY_ID
      ? ensureDefaultFavoriteCategory()
      : categoryId
    onSelect(nextCategoryId)
    closeMenu()
  }

  const createCategory = () => {
    const name = draftName.trim()
    if (!name) return
    const categoryId = createFavoriteCategory({ name })
    onSelect(categoryId)
    closeMenu()
  }

  const menu = isOpen ? createPortal(
    <div
      ref={menuRef}
      className={`fixed z-[90] ${menuClassName} max-h-72 overflow-y-auto rounded-xl border border-gray-200/60 bg-white/95 py-1 shadow-[0_8px_30px_rgb(0,0,0,0.12)] ring-1 ring-black/5 backdrop-blur-xl dark:border-white/[0.08] dark:bg-gray-900/95 dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] dark:ring-white/10 ${
        openUp ? 'animate-dropdown-up' : 'animate-dropdown-down'
      }`}
      style={menuPosition}
      onClick={(e) => e.stopPropagation()}
    >
      {includeAll && (
        <button
          type="button"
          onClick={() => selectCategory(null)}
          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
            !value
              ? 'bg-blue-50 font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-400'
              : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.06]'
          }`}
        >
          <span className="min-w-0 truncate">{allLabel}</span>
        </button>
      )}

      {includeUnassigned && (
        <button
          type="button"
          onClick={() => selectCategory(null)}
          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
            !value
              ? 'bg-blue-50 font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-400'
              : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.06]'
          }`}
        >
          <span className="h-2 w-2 shrink-0 rounded-full border border-dashed border-gray-300 dark:border-gray-600" />
          <span className="min-w-0 truncate">{unassignedLabel}</span>
        </button>
      )}

      {categories.map((category) => {
        const name = category.name.trim() || '未命名分类'
        return (
          <button
            key={category.id}
            type="button"
            onClick={() => selectCategory(category.id)}
            title={name}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
              category.id === value
                ? 'bg-blue-50 font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-400'
                : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.06]'
            }`}
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: category.color }} />
            <span className="min-w-0 truncate">{name}</span>
          </button>
        )
      })}

      <div className="my-1 h-px bg-gray-100 dark:bg-white/[0.08]" />

      {isCreating ? (
        <div className="px-2 py-1">
          <div className="flex gap-1.5">
            <input
              ref={inputRef}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  createCategory()
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setIsCreating(false)
                  setDraftName('')
                }
              }}
              placeholder={createPlaceholder}
              className="min-w-0 flex-1 rounded-lg border border-gray-200/70 bg-white/70 px-2 py-1.5 text-xs text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:focus:border-blue-500/50"
            />
            <button
              type="button"
              onClick={createCategory}
              disabled={!draftName.trim()}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-500 text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="确认新建分类"
              title="确认"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10"
        >
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span className="min-w-0 truncate">新建分类</span>
        </button>
      )}
    </div>,
    document.body,
  ) : null

  return (
    <div ref={containerRef} className="relative w-full" onClick={(e) => e.stopPropagation()}>
      <div ref={triggerRef}>
        {renderTrigger({ isOpen, label, selectedCategory, toggle })}
      </div>
      {menu}
    </div>
  )
}
