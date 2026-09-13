import PopoverSurface from './PopoverSurface'
import { useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'
import { usePopoverDismiss } from '../../hooks/usePopoverDismiss'
import { fuzzyMatch } from '../../lib/fuzzyMatch'
import { countPromptExpansion } from '../../lib/promptExpand'
import {
  MAX_SNIPPET_CONTENT_LEN,
  MAX_SNIPPET_NAME_LEN,
  MAX_SNIPPETS,
} from '../../lib/promptSnippets'
import type { PromptSnippet } from '../../types'

interface Props {
  /** 锚点（片段 pill）的元素引用，用于点击外部检测 */
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
  /** 把片段正文插入输入框光标处（由 InputBar/index.tsx 实现） */
  onInsert: (content: string) => void
}

/** 编辑态：null=列表；id 为 null=新建，否则编辑既有片段 */
interface EditState {
  id: string | null
  name: string
  content: string
}

/**
 * 提示词片段 popover：搜索 + 点击插入光标处 + 内联新建/编辑/删除 + 保存当前输入。
 *
 * 结构对齐 StylePickerPopover：anchorRef + onClose + Esc/outside-click。
 */
export default function SnippetPopover({ anchorRef, onClose, onInsert }: Props) {
  const snippets = useStore((s) => s.snippets)
  const prompt = useStore((s) => s.prompt)
  const createSnippet = useStore((s) => s.createSnippet)
  const updateSnippet = useStore((s) => s.updateSnippet)
  const deleteSnippet = useStore((s) => s.deleteSnippet)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const showToast = useStore((s) => s.showToast)

  const popoverRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [edit, setEdit] = useState<EditState | null>(null)

  // 删除确认弹窗(渲染在 App 根、popover DOM 之外)打开时整体让位:外点判定暂停
  // (点「取消」不应顺带关掉 popover),Esc 由后注册、处于栈顶的确认弹窗消费
  const confirmDialogOpen = useStore((s) => Boolean(s.confirmDialog))
  usePopoverDismiss(true, anchorRef, popoverRef, onClose, {
    disabled: confirmDialogOpen,
    // 编辑态下 Esc 先退回列表,再次 Esc 才关闭 popover
    onEscape: () => (edit !== null ? setEdit(null) : onClose()),
  })

  /** fuzzy 过滤排序：空 query 按 sortOrder（store 已保证有序），命中按得分降序 */
  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return snippets
    return snippets
      .map((snippet) => ({
        snippet,
        match: fuzzyMatch(q, `${snippet.name} ${snippet.content}`),
      }))
      .filter(
        (
          item,
        ): item is { snippet: PromptSnippet; match: NonNullable<ReturnType<typeof fuzzyMatch>> } =>
          item.match !== null,
      )
      .sort((a, b) => b.match.score - a.match.score)
      .map((item) => item.snippet)
  }, [snippets, query])

  const atLimit = snippets.length >= MAX_SNIPPETS

  const handleSaveEdit = () => {
    if (!edit) return
    if (!edit.content.trim()) {
      showToast('片段内容不能为空', 'error')
      return
    }
    if (edit.id) {
      updateSnippet(edit.id, { name: edit.name, content: edit.content })
    } else {
      const id = createSnippet({ name: edit.name, content: edit.content })
      if (!id) return // 满额时 createSnippet 已 toast
      showToast('片段已保存', 'success')
    }
    setEdit(null)
  }

  const handleDelete = (snippet: PromptSnippet) => {
    setConfirmDialog({
      title: '删除片段',
      message: `确定删除片段「${snippet.name}」？此操作不可恢复。`,
      confirmText: '删除',
      tone: 'danger',
      action: () => deleteSnippet(snippet.id),
    })
  }

  return (
    <PopoverSurface anchorRef={anchorRef} panelRef={popoverRef} label="提示词片段" width={320}>
      {edit ? (
        /* ===== 编辑/新建态 ===== */
        <div className="flex flex-col gap-2">
          <div className="px-1 pt-1 text-xs font-medium text-content-muted ">
            {edit.id ? '编辑片段' : '新建片段'}
          </div>
          <input
            value={edit.name}
            onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            maxLength={MAX_SNIPPET_NAME_LEN}
            placeholder="片段名称（搜索用）"
            aria-label="片段名称"
            className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-content outline-none focus:border-brand    "
          />
          <textarea
            value={edit.content}
            onChange={(e) => setEdit({ ...edit, content: e.target.value })}
            maxLength={MAX_SNIPPET_CONTENT_LEN}
            rows={4}
            placeholder="片段内容，可含 {a|b|c} 通配组"
            aria-label="片段内容"
            className="w-full resize-none rounded-lg border border-line bg-surface px-2 py-1.5 text-sm leading-relaxed text-content outline-none focus:border-brand custom-scrollbar    "
          />
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setEdit(null)}
              className="rounded-lg px-2.5 py-1.5 text-xs text-content-muted transition-colors hover:bg-surface-muted  "
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSaveEdit}
              disabled={!edit.content.trim()}
              className="rounded-lg bg-brand px-2.5 py-1.5 text-xs font-medium text-on-brand transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              保存
            </button>
          </div>
        </div>
      ) : (
        /* ===== 列表态 ===== */
        <div className="flex flex-col gap-1.5">
          {snippets.length > 0 && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索片段…"
              aria-label="搜索片段"
              className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-content outline-none focus:border-brand    "
            />
          )}

          {snippets.length === 0 ? (
            <div className="px-2 py-5 text-center text-xs text-content-muted ">
              还没有片段——保存当前输入试试
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-2 py-5 text-center text-xs text-content-muted ">无匹配片段</div>
          ) : (
            <ul
              aria-label="提示词片段"
              className="flex max-h-[260px] flex-col gap-0.5 overflow-y-auto custom-scrollbar"
            >
              {filtered.map((snippet) => {
                const expansion = countPromptExpansion(snippet.content)
                return (
                  <li key={snippet.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => {
                        onInsert(snippet.content)
                        onClose()
                      }}
                      title={`插入：${snippet.content.slice(0, 200)}`}
                      className="flex w-full flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-muted "
                    >
                      {/* 触屏下编辑/删除图标恒显(占右侧约 52px),名称行需让出右内边距,
                          否则长名称/×N 徽标会永久叠在透明背景的图标下;内容行已有 pr-12+px-2=56px 足够 */}
                      <span className="flex w-full items-center gap-1.5 [@media(hover:none)]:pr-14 [@media(any-pointer:coarse)]:pr-14">
                        <span className="truncate text-sm font-medium text-content ">
                          {snippet.name}
                        </span>
                        {expansion > 1 && (
                          <span
                            className="shrink-0 rounded-full bg-brand-soft px-1.5 text-[10px] font-medium text-brand-ink  "
                            title={`含通配组，提交时展开 ${expansion} 条`}
                          >
                            ×{expansion}
                          </span>
                        )}
                      </span>
                      <span className="w-full truncate pr-12 text-xs text-content-muted ">
                        {snippet.content}
                      </span>
                    </button>
                    {/* hover 操作：编辑 / 删除。hover:none 兜触屏、any-pointer:coarse 兜混合设备
                        (hover:hover 触屏本)、group-focus-within 兜键盘(display:none 不进 Tab 序) */}
                    <span className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 group-hover:flex group-focus-within:flex [@media(hover:none)]:flex [@media(any-pointer:coarse)]:flex">
                      <button
                        type="button"
                        onClick={() =>
                          setEdit({ id: snippet.id, name: snippet.name, content: snippet.content })
                        }
                        aria-label={`编辑片段 ${snippet.name}`}
                        className="rounded-md p-1 text-content-subtle transition-colors hover:bg-surface-muted hover:text-content-muted  "
                      >
                        <svg
                          className="h-3.5 w-3.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(snippet)}
                        aria-label={`删除片段 ${snippet.name}`}
                        className="rounded-md p-1 text-content-subtle transition-colors hover:bg-red-50 hover:text-red-500  "
                      >
                        <svg
                          className="h-3.5 w-3.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        </svg>
                      </button>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}

          {/* 底部操作 */}
          <div className="flex items-center gap-1.5 border-t border-line pt-1.5 ">
            <button
              type="button"
              disabled={atLimit}
              onClick={() => setEdit({ id: null, name: '', content: '' })}
              title={atLimit ? `片段已达上限（${MAX_SNIPPETS} 条）` : '新建片段'}
              className="flex-1 rounded-lg px-2 py-1.5 text-xs text-content-muted transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40  "
            >
              + 新建片段
            </button>
            <button
              type="button"
              disabled={atLimit || !prompt.trim()}
              onClick={() => setEdit({ id: null, name: '', content: prompt })}
              title={
                atLimit
                  ? `片段已达上限（${MAX_SNIPPETS} 条）`
                  : prompt.trim()
                    ? '把当前输入框内容存为片段'
                    : '输入框为空，无内容可保存'
              }
              className="flex-1 rounded-lg px-2 py-1.5 text-xs text-content-muted transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40  "
            >
              保存当前输入
            </button>
          </div>
        </div>
      )}
    </PopoverSurface>
  )
}
