import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import Modal from './Modal'
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

/** combobox/listbox ARIA 链路的 DOM id（面板单例,静态 id 不冲突;命令 id 全局唯一） */
const LISTBOX_ID = 'command-palette-listbox'
const optionDomId = (commandId: string) => `command-option-${commandId}`

/**
 * Enter 执行命令后,在 window 捕获层吞掉本次按住期间的后续 Enter(keydown/keyup),
 * 直到用户松开为止——防止焦点还原到背景按钮后,OS 按键重复直接激活它。
 * 模块级单例:重复调用先清理旧监听,页面失焦(blur)兜底移除。
 */
let removeEnterSwallow: (() => void) | null = null
function swallowEnterUntilKeyup() {
  removeEnterSwallow?.()
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Enter') return
    ev.preventDefault()
    ev.stopPropagation()
    if (ev.type === 'keyup') cleanup()
  }
  const cleanup = () => {
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('keyup', onKey, true)
    window.removeEventListener('blur', cleanup)
    removeEnterSwallow = null
  }
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('keyup', onKey, true)
  window.addEventListener('blur', cleanup)
  removeEnterSwallow = cleanup
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
  const prompt = useStore((s) => s.prompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const snippets = useStore((s) => s.snippets)
  // 布尔 selector:zustand 仅在值翻转时重渲染,避免批量生成期间 tasks 引用高频变化重建命令列表
  const hasRunningTasks = useStore((s) => s.tasks.some((t) => t.status === 'running'))
  const showToast = useStore((s) => s.showToast)

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
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
          prompt,
          setPrompt,
          snippets,
          hasRunningTasks,
          showToast,
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
      prompt,
      setPrompt,
      snippets,
      hasRunningTasks,
      showToast,
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (flat.length === 0) return
      const delta = e.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((clampedIndex + delta + flat.length) % flat.length)
      return
    }
    if (e.key === 'Enter') {
      // IME 组字确认的 Enter 不执行命令;OS 按键重复的 Enter 也不执行(只认新按下)
      if (e.nativeEvent.isComposing || e.repeat) return
      e.preventDefault()
      if (clampedIndex < 0) return
      // 执行后面板关闭,useFocusTrap 会把焦点还原给打开前的元素(常是 InputBar 提交按钮);
      // 长按 Enter 的后续重复 keydown 会落在该元素上、原生激活其 click(误触提交)。
      // 在捕获层吞掉本次按住期间的所有 Enter,直到 keyup 释放(页面失焦时兜底清理)。
      swallowEnterUntilKeyup()
      flat[clampedIndex].command.run()
    }
  }

  // 渲染时为每项计算扁平下标（组结构与 flat 同源同序）
  let flatIndex = -1

  return (
    <Modal
      onClose={close}
      ariaLabel="命令面板"
      containerClassName="z-[105] items-start pt-[12vh] md:pt-[18vh]"
      panelClassName="flex w-full max-w-xl flex-col overflow-hidden"
      onPanelKeyDown={handleKeyDown}
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
          {/* activedescendant 模式:焦点恒在 input,↑↓ 只移高亮,读屏靠 aria-activedescendant 播报 */}
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIndex(0)
            }}
            placeholder="输入命令…"
            aria-label="搜索命令"
            role="combobox"
            aria-expanded="true"
            aria-controls={LISTBOX_ID}
            aria-autocomplete="list"
            aria-activedescendant={
              clampedIndex >= 0 ? optionDomId(flat[clampedIndex].command.id) : undefined
            }
            className="w-full bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400 dark:text-gray-100"
          />
          <kbd className="hidden shrink-0 rounded-md border border-gray-200/80 px-1.5 py-0.5 text-[10px] text-gray-400 sm:block dark:border-white/[0.1]">
            Esc
          </kbd>
        </div>

        {/* 空态放 listbox 外:listbox 的合法子节点只有 group/option;role=status 让零结果对读屏可感知 */}
        {flat.length === 0 && (
          <div role="status" className="px-3 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            无匹配命令
          </div>
        )}
        <div
          ref={listRef}
          id={LISTBOX_ID}
          role="listbox"
          aria-label="命令列表"
          className={`max-h-[50vh] overflow-y-auto custom-scrollbar ${flat.length === 0 ? '' : 'p-2'}`}
        >
          {flat.length > 0 &&
            groups.map(({ group, items }) => (
              <div
                key={group}
                role="group"
                aria-label={COMMAND_GROUP_LABELS[group]}
                className="mb-1 last:mb-0"
              >
                {/* 组名由 group 的 aria-label 承担,标题对读屏隐藏,listbox 子树只留 group/option */}
                <div
                  aria-hidden="true"
                  className="px-3 pb-1 pt-2 text-[11px] font-medium text-gray-500 dark:text-gray-400"
                >
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
                      role="option"
                      id={optionDomId(command.id)}
                      // activedescendant 模式:DOM 焦点恒在 input,option 退出 Tab 序,否则 Tab 聚焦项与 Enter 执行的高亮项错位
                      tabIndex={-1}
                      aria-selected={isHighlighted}
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
                      {/* option 子树按 presentational 处理,svg 的 aria-label 会被剪枝;sr-only 文本走 name-from-contents 可靠曝光 */}
                      {command.active && <span className="sr-only">（当前）</span>}
                      {command.active && (
                        <svg
                          className="h-4 w-4 shrink-0 text-blue-500 dark:text-blue-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
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
            ))}
        </div>

        <div className="border-t border-gray-200/70 px-4 py-2 text-[11px] text-gray-500 dark:border-white/[0.08] dark:text-gray-400">
          ↑↓ 选择 · Enter 执行 · Esc 关闭
        </div>
    </Modal>
  )
}
