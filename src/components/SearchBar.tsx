import { useEffect, useState } from 'react'
import { useStore } from '../store'
import Select from './Select'
import FavoriteCategoryMenu from './FavoriteCategoryMenu'

export default function SearchBar() {
  const searchQuery = useStore((s) => s.searchQuery)
  const searchQueryVersion = useStore((s) => s.searchQueryVersion)
  const setSearchQuery = useStore((s) => s.setSearchQuery)

  // 输入即时反馈走本地态,防抖 200ms 才写 store——store 写入触发 App + TaskGrid 双重全量
  // filterAndSortTasks(每 task JSON.stringify),逐字键入大库会卡。
  const [draftQuery, setDraftQuery] = useState<{
    baseQuery: string
    baseVersion: number
    value: string
  } | null>(null)
  const localQuery =
    draftQuery?.baseQuery === searchQuery && draftQuery.baseVersion === searchQueryVersion
      ? draftQuery.value
      : searchQuery
  useEffect(() => {
    if (
      draftQuery === null ||
      draftQuery.baseQuery !== searchQuery ||
      draftQuery.baseVersion !== searchQueryVersion ||
      draftQuery.value === searchQuery
    ) {
      return
    }
    const timer = setTimeout(() => {
      setSearchQuery(draftQuery.value)
      setDraftQuery(null)
    }, 200)
    return () => clearTimeout(timer)
  }, [draftQuery, searchQuery, searchQueryVersion, setSearchQuery])
  const filterStatus = useStore((s) => s.filterStatus)
  const setFilterStatus = useStore((s) => s.setFilterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const setFilterFavorite = useStore((s) => s.setFilterFavorite)
  const filterFavoriteCategoryId = useStore((s) => s.filterFavoriteCategoryId)
  const setFilterFavoriteCategoryId = useStore((s) => s.setFilterFavoriteCategoryId)
  const categoryName = useStore(
    (s) =>
      s.favoriteCategories.find((category) => category.id === s.filterFavoriteCategoryId)?.name,
  )
  const hasFilters =
    Boolean(localQuery.trim()) ||
    filterStatus !== 'all' ||
    filterFavorite ||
    Boolean(filterFavoriteCategoryId)
  const clearFilters = () => {
    setDraftQuery(null)
    setSearchQuery('')
    setFilterStatus('all')
    setFilterFavorite(false)
    setFilterFavoriteCategoryId(null)
  }

  return (
    <div data-no-drag-select className="mb-5">
      <div className="flex flex-col gap-3 xl:flex-row">
        <div className="order-2 grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] gap-2 flex-shrink-0 z-20 sm:flex">
          <button
            onClick={() => setFilterFavorite(!filterFavorite)}
            type="button"
            aria-label={filterFavorite ? '取消只看收藏' : '只看收藏'}
            aria-pressed={filterFavorite}
            className={`min-h-11 p-2.5 rounded-lg border transition-colors ${
              filterFavorite
                ? 'border-brand/25 bg-brand-soft text-brand-ink'
                : 'border-line bg-surface text-content-muted hover:bg-surface-raised'
            }`}
            title={filterFavorite ? '取消只看收藏' : '只看收藏'}
          >
            <svg
              className="w-5 h-5"
              fill={filterFavorite ? 'currentColor' : 'none'}
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
              />
            </svg>
          </button>
          <div className="relative min-w-0 sm:w-28">
            <Select
              value={filterStatus}
              onChange={setFilterStatus}
              options={[
                { label: '全部状态', value: 'all' },
                { label: '已完成', value: 'done' },
                { label: '生成中', value: 'running' },
                { label: '失败', value: 'error' },
              ]}
              className="ui-field min-h-11 hover:bg-surface-muted"
            />
          </div>
          <div className="relative min-w-0 sm:w-32">
            <FavoriteCategoryMenu
              value={filterFavoriteCategoryId}
              includeAll
              onSelect={setFilterFavoriteCategoryId}
              menuClassName="w-48"
              matchTriggerWidth
              renderTrigger={({ isOpen, label, selectedCategory, toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  className="ui-field flex min-h-11 w-full items-center justify-between gap-1 hover:bg-surface-muted"
                  aria-expanded={isOpen}
                  aria-label={`收藏分类：${label}`}
                  title={label}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {selectedCategory && (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: selectedCategory.color }}
                      />
                    )}
                    <span className="min-w-0 truncate">{label}</span>
                  </span>
                  <svg
                    className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform duration-200 dark:text-gray-500 ${isOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
              )}
            />
          </div>
        </div>
        <div className="relative order-1 min-w-0 flex-1 z-10">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            value={localQuery}
            onChange={(e) =>
              setDraftQuery({
                baseQuery: searchQuery,
                baseVersion: searchQueryVersion,
                value: e.target.value,
              })
            }
            type="text"
            aria-label="搜索提示词和参数"
            placeholder="搜索提示词、参数..."
            className="ui-field min-h-11 w-full pl-10 pr-4"
          />
        </div>
      </div>
      {hasFilters && (
        <div
          className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-content-muted"
          aria-live="polite"
        >
          <span>当前筛选：</span>
          {localQuery.trim() && (
            <span className="max-w-64 truncate">关键词「{localQuery.trim()}」</span>
          )}
          {filterStatus !== 'all' && (
            <span>{{ running: '生成中', done: '已完成', error: '失败' }[filterStatus]}</span>
          )}
          {filterFavorite && <span>仅收藏</span>}
          {filterFavoriteCategoryId && <span>分类：{categoryName ?? '已选分类'}</span>}
          <button
            type="button"
            className="min-h-8 font-medium text-brand-ink underline underline-offset-4"
            onClick={clearFilters}
          >
            清除筛选
          </button>
        </div>
      )}
    </div>
  )
}
