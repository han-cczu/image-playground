import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useLockBodyScroll } from '../hooks/useLockBodyScroll'
import { useFocusTrap } from '../hooks/useFocusTrap'
import {
  buildCommands,
  COMMAND_GROUP_LABELS,
  COMMAND_GROUP_ORDER,
  type Command,
} from '../lib/commands'
import { fuzzyMatch } from '../lib/fuzzyMatch'

interface MatchedCommand {
  command: Command
  /** 命中下标（基于 `${title} ${keywords}` 的码点），高亮时只取 title 范围内的 */
  indices: number[]
  score: number
}

/** 标题渲染：按码点切分并高亮命中字符（仅 title 范围内的下标） */
function HighlightedTitle({ title, indices }: { title: string; indices: number[] }) {
  const chars = useMemo(() => Array.from(title), [title])
  const hits = useMemo(
    () => new Set(indices.filter((i) => i < chars.length)),
    [indices, chars.length],
  )
  if (hits.size === 0) return <>{title}</>
  return (
    <>
      {chars.map((ch, i) =>
        hits.has(i) ? (
          <span key={i} className="text-blue-600 dark:text-blue-400">
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  )
}

/** 外层只负责开关：关闭时整体卸载内层，打开时挂载即获得全新 query/高亮状态。 */
export default function CommandPalette() {
  const showCommandPalette = useStore((s) => s.showCommandPalette)
  const setShowCommandPalette = useStore((s) => s.setShowCommandPalette)

  const close = useCallback(() => setShowCommandPalette(false), [setShowCommandPalette])

  if (!showCommandPalette) return null
  return <CommandPalettePanel close={close} />
}

function CommandPalettePanel({ close }: { close: () => void }) {
  // buildCommands 依赖的 store 切片：值订阅保证响应式，action 引用在 zustand 中稳定
  const galleryView = useStore((s) => s.galleryView)
  const setGalleryView = useStore((s) => s.setGalleryView)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const conversations = useStore((s) => s.conversations)
  const activeConversationId = useStore((s) => s.activeConversationId)
  const createConversation = useStore((s) => s.createConversation)
  const setActiveConversation = useStore((s) => s.setActiveConversation)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const commands = useMemo(
    () =>
      buildCommands({
        store: {
          galleryView,
          setGalleryView,
          setShowSettings,
          toggleSidebar,
          conversations,
          activeConversationId,
          createConversation,
          setActiveConversation,
          settings,
          setSettings,
        },
        close,
      }),
    [
      galleryView,
      setGalleryView,
      setShowSettings,
      toggleSidebar,
      conversations,
      activeConversationId,
      createConversation,
      setActiveConversation,
      settings,
      setSettings,
      close,
    ],
  )

  /** 过滤 + 评分排序，再按组稳定分桶（组按固定顺序，组内按得分降序） */
  const { groups, flat } = useMemo(() => {
    const matched: MatchedCommand[] = []
    for (const command of commands) {
      if (command.enabled === false) continue
      const m = fuzzyMatch(query, `${command.title} ${command.keywords ?? ''}`)
      if (!m) continue
      matched.push({ command, indices: m.indices, score: m.score })
    }
    matched.sort((a, b) => b.score - a.score)
    const groups = COMMAND_GROUP_ORDER.map((group) => ({
      group,
      items: matched.filter((m) => m.command.group === group),
    })).filter((g) => g.items.length > 0)
    return { groups, flat: groups.flatMap((g) => g.items) }
  }, [commands, query])

  // 列表收缩时夹紧高亮下标，避免越界
  const clampedIndex = flat.length === 0 ? -1 : Math.min(activeIndex, flat.length - 1)

  // 高亮项滚入可视区
  useEffect(() => {
    if (clampedIndex < 0) return
    listRef.current
      ?.querySelector(`[data-command-index="${clampedIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [clampedIndex])

  useCloseOnEscape(true, close)
  useLockBodyScroll(true)
  useFocusTrap(true, panelRef)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (flat.length === 0) return
      const delta = e.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((clampedIndex + delta + flat.length) % flat.length)
      return
    }
    if (e.key === 'Enter') {
      // IME 组字确认的 Enter 不执行命令
      if (e.nativeEvent.isComposing) return
      e.preventDefault()
      if (clampedIndex >= 0) flat[clampedIndex].command.run()
    }
  }

  // 渲染时为每项计算扁平下标（组结构与 flat 同源同序）
  let flatIndex = -1

  return (
    <div
      data-no-drag-select
      className="fixed inset-0 z-[105] flex items-start justify-center p-4 pt-[12vh] md:pt-[18vh]"
    >
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in"
        onClick={close}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="relative z-10 flex w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-white/50 bg-white/95 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10"
      >
        <div className="flex items-center gap-3 border-b border-gray-200/70 px-4 py-3 dark:border-white/[0.08]">
          <svg
            className="h-5 w-5 shrink-0 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z"
            />
          </svg>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIndex(0)
            }}
            placeholder="输入命令…"
            aria-label="搜索命令"
            className="w-full bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400 dark:text-gray-100"
          />
          <kbd className="hidden shrink-0 rounded-md border border-gray-200/80 px-1.5 py-0.5 text-[10px] text-gray-400 sm:block dark:border-white/[0.1]">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2 custom-scrollbar">
          {flat.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-gray-400">无匹配命令</div>
          ) : (
            groups.map(({ group, items }) => (
              <div key={group} className="mb-1 last:mb-0">
                <div className="px-3 pb-1 pt-2 text-[11px] font-medium text-gray-400 dark:text-gray-500">
                  {COMMAND_GROUP_LABELS[group]}
                </div>
                {items.map(({ command, indices }) => {
                  flatIndex++
                  const index = flatIndex
                  const isHighlighted = index === clampedIndex
                  return (
                    <button
                      key={command.id}
                      type="button"
                      data-command-index={index}
                      onClick={() => command.run()}
                      onMouseMove={() => {
                        if (activeIndex !== index) setActiveIndex(index)
                      }}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                        isHighlighted
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                          : 'text-gray-700 dark:text-gray-200'
                      }`}
                    >
                      <span className="truncate">
                        <HighlightedTitle title={command.title} indices={indices} />
                      </span>
                      {command.active && (
                        <svg
                          className="h-4 w-4 shrink-0 text-blue-500 dark:text-blue-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          aria-label="当前"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      )}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-gray-200/70 px-4 py-2 text-[11px] text-gray-400 dark:border-white/[0.08] dark:text-gray-500">
          ↑↓ 选择 · Enter 执行 · Esc 关闭
        </div>
      </div>
    </div>
  )
}
