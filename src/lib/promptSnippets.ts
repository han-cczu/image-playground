import type { PromptSnippet } from '../types'

/** 片段数量上限：防 localStorage 膨胀（200 × 5KB 最坏 ≈ 1MB） */
export const MAX_SNIPPETS = 200
export const MAX_SNIPPET_NAME_LEN = 50
export const MAX_SNIPPET_CONTENT_LEN = 5000

let snippetUid = 0
export function genSnippetId(): string {
  return `snip-${Date.now().toString(36)}-${(++snippetUid).toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * 损坏数据兜底：跳过无效项、修补缺失字段、按 sortOrder 重排为连续整数。
 * 结构对齐 normalizeFavoriteCategories（持久化状态与导入备份共用）。
 */
export function normalizeSnippets(value: unknown, now = Date.now()): PromptSnippet[] {
  if (!Array.isArray(value)) return []

  const byId = new Map<string, PromptSnippet>()
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return
    const item = entry as Partial<PromptSnippet>
    if (typeof item.id !== 'string' || !item.id.trim()) return
    // content 是片段的本体：缺失/空串的记录没有意义，直接跳过
    if (typeof item.content !== 'string' || !item.content.trim()) return

    const createdAt =
      typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : now
    byId.set(item.id, {
      id: item.id,
      name:
        typeof item.name === 'string' && item.name.trim()
          ? item.name.trim().slice(0, MAX_SNIPPET_NAME_LEN)
          : '未命名片段',
      content: item.content.slice(0, MAX_SNIPPET_CONTENT_LEN),
      createdAt,
      updatedAt:
        typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt)
          ? item.updatedAt
          : createdAt,
      sortOrder:
        typeof item.sortOrder === 'number' && Number.isFinite(item.sortOrder)
          ? item.sortOrder
          : index,
    })
  })

  return Array.from(byId.values())
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map((snippet, index) => ({ ...snippet, sortOrder: index }))
    .slice(0, MAX_SNIPPETS)
}

/**
 * 导入合并：本地同 id 优先，备份只追加新 id；超 MAX_SNIPPETS 由 normalize 截断。
 * 语义对齐 mergeFavoriteCategories。
 */
export function mergeSnippets(
  local: PromptSnippet[],
  imported: PromptSnippet[],
): PromptSnippet[] {
  const localIds = new Set(local.map((snippet) => snippet.id))
  return normalizeSnippets([
    ...local,
    ...imported.filter((snippet) => !localIds.has(snippet.id)),
  ])
}

/**
 * 光标处插入：返回新文本与新光标位（插入段末尾）。
 *
 * 下标是 **UTF-16 单元**（textarea selectionStart/selectionEnd 语义），
 * 与 fuzzyMatch 的码点下标无关，不混用。
 * selStart > selEnd 时自动交换；越界钳制到 [0, text.length]。
 * 原样插入，不自作聪明加分隔符。
 */
export function insertAtCursor(
  text: string,
  selStart: number,
  selEnd: number,
  snippet: string,
): { next: string; caret: number } {
  const clamp = (n: number) => Math.min(Math.max(Number.isFinite(n) ? Math.trunc(n) : text.length, 0), text.length)
  let start = clamp(selStart)
  let end = clamp(selEnd)
  if (start > end) [start, end] = [end, start]

  const next = text.slice(0, start) + snippet + text.slice(end)
  return { next, caret: start + snippet.length }
}
