import type { StateCreator } from 'zustand'
import type {
  Conversation,
  FavoriteCategory,
  PromptSnippet,
  TaskParams,
  InputImage,
  MaskDraft,
  TaskRecord,
} from '../../types'
import { DEFAULT_PARAMS } from '../../types'
import {
  DEFAULT_FAVORITE_CATEGORY_COLOR,
  DEFAULT_FAVORITE_CATEGORY_ID,
  createDefaultFavoriteCategory,
  normalizeFavoriteCategories,
  MAX_FAVORITE_CATEGORIES,
} from '../../lib/favoriteCategories'
import {
  ARCHIVE_CONVERSATION_ID,
  MAX_CONVERSATIONS,
  findReusableEmptyConversation,
  normalizeConversations,
  MAX_CONVERSATION_ID_LEN,
  genConversationId,
  isArchiveConversation,
  isConversationLimitReached,
  normalizeConversationTitle,
} from '../../lib/conversations'
import {
  clearPendingIndexedDbConversationDelete,
  clearPendingIndexedDbConversationWrite,
  clearPendingIndexedDbTaskDelete,
  markPendingIndexedDbConversationDelete,
  markPendingIndexedDbConversationWrite,
  markPendingIndexedDbTaskDelete,
} from '../idbSyncState'
import {
  genSnippetId,
  MAX_SNIPPET_CONTENT_LEN,
  MAX_SNIPPET_NAME_LEN,
  MAX_SNIPPETS,
  normalizeSnippets,
} from '../../lib/promptSnippets'
import { MAX_BATCH_NOTE_LEN, normalizeBatchNotes, type BatchNote } from '../../lib/gridSheet'
import { MAX_INPUT_IMAGES_PER_SUBMISSION, MAX_TASK_TEXT_LEN } from '../../lib/tasks'
import { normalizeParamsForSettings } from '../../lib/api/paramCompatibility'
import { collectReferencedImageIds } from '../../lib/storageStats'
import { deleteConversation as dbDeleteConversation, putConversation, putTask } from '../../lib/db'
import {
  clearTransientUiReferencesForDeletedTasks,
  createCancelledTask,
  rollbackStoredImages,
  terminateRunningTaskRuntimes,
} from '../../lib/taskRuntime'
import type { AppState } from '../index'

export function orderImagesWithMaskFirst(
  images: InputImage[],
  maskTargetImageId: string | null | undefined,
) {
  if (!maskTargetImageId) return images
  const maskIdx = images.findIndex((img) => img.id === maskTargetImageId)
  if (maskIdx <= 0) return images
  const next = [...images]
  const [maskImage] = next.splice(maskIdx, 1)
  next.unshift(maskImage)
  return next
}

function dedupeInputImagesById(images: InputImage[]): InputImage[] {
  const seen = new Set<string>()
  const result: InputImage[] = []
  for (const img of images) {
    if (seen.has(img.id)) continue
    seen.add(img.id)
    result.push(img)
    if (result.length >= MAX_INPUT_IMAGES_PER_SUBMISSION) break
  }
  return result
}

function sameStringList(a: string[] | null, b: string[] | null): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

function restoreRemovedItemsByPreviousOrder<T extends { id: string }>(
  latest: T[],
  previousOrder: T[],
  restoredById: Map<string, T>,
): T[] {
  let result = latest.map((item) => restoredById.get(item.id) ?? item)

  for (const restored of restoredById.values()) {
    if (result.some((item) => item.id === restored.id)) continue

    const previousIndex = previousOrder.findIndex((item) => item.id === restored.id)
    let insertAt = result.length

    if (previousIndex >= 0) {
      for (let i = previousIndex + 1; i < previousOrder.length; i += 1) {
        const nextIndex = result.findIndex((item) => item.id === previousOrder[i].id)
        if (nextIndex >= 0) {
          insertAt = nextIndex
          break
        }
      }
      if (insertAt === result.length) {
        for (let i = previousIndex - 1; i >= 0; i -= 1) {
          const prevIndex = result.findIndex((item) => item.id === previousOrder[i].id)
          if (prevIndex >= 0) {
            insertAt = prevIndex + 1
            break
          }
        }
      }
    }

    result = [...result.slice(0, insertAt), restored, ...result.slice(insertAt)]
  }

  return result
}

let categoryUid = 0
function genCategoryId(): string {
  return `cat-${Date.now().toString(36)}-${(++categoryUid).toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function reorderCategories(categories: FavoriteCategory[]): FavoriteCategory[] {
  return normalizeFavoriteCategories(categories)
}

function createCategoryStatePatch(
  categories: FavoriteCategory[],
  filterFavoriteCategoryId: string | null,
) {
  /*
   * ========================================================================
   * 步骤1：归一化分类状态
   * ========================================================================
   * 目标：
   *   1) 保持分类顺序连续，避免删除或导入后 sortOrder 断档
   *   2) 清理已经不存在的分类筛选条件
   */
  // 1.1 归一化分类排序
  const favoriteCategories = reorderCategories(categories)

  // 1.2 校验当前筛选分类是否仍存在
  const categoryIds = new Set(favoriteCategories.map((category) => category.id))
  return {
    favoriteCategories,
    filterFavoriteCategoryId:
      filterFavoriteCategoryId && categoryIds.has(filterFavoriteCategoryId)
        ? filterFavoriteCategoryId
        : null,
  }
}

export interface TaskRetryInfo {
  /** 即将进行的是第几次重试(从 1 起) */
  attempt: number
  /** 本任务允许的最大重试次数(executeTask 入口快照) */
  maxAttempts: number
  /** 预计下次尝试的时间戳(ms) */
  nextRetryAt: number
}

export interface TasksSlice {
  // 输入
  prompt: string
  setPrompt: (p: string) => void
  inputImages: InputImage[]
  addInputImage: (img: InputImage) => void
  removeInputImage: (idx: number) => void
  clearInputImages: () => void
  setInputImages: (imgs: InputImage[]) => void
  /**
   * toIdx 是「移除前数组」的插入缝隙下标(0..length,length 表示末尾),与 ImageGrid 的
   * 指示线位置/noop 判定同一语义;不是移动后的最终下标。新调用方若按最终下标传参会偏一格。
   */
  moveInputImage: (fromIdx: number, toIdx: number) => void
  maskDraft: MaskDraft | null
  setMaskDraft: (draft: MaskDraft | null) => void
  clearMaskDraft: () => void
  maskEditorImageId: string | null
  setMaskEditorImageId: (id: string | null) => void

  // 参数
  params: TaskParams
  setParams: (p: Partial<TaskParams>) => void

  // 任务列表
  tasks: TaskRecord[]
  setTasks: (t: TaskRecord[]) => void

  // 自动重试瞬态(仅驱动卡片「第 N/M 次重试中」徽标;不进 persist/TaskRecord/导出,刷新即清)
  taskRetryInfo: Record<string, TaskRetryInfo>
  /** info 为 null 时删除条目(任务落终态/取消/删除时清理) */
  setTaskRetryInfo: (taskId: string, info: TaskRetryInfo | null) => void

  // 收藏分类
  favoriteCategories: FavoriteCategory[]
  favoriteCategoriesInitialized: boolean
  setFavoriteCategories: (categories: FavoriteCategory[]) => void
  /** 满 MAX_FAVORITE_CATEGORIES 时返回 null(带 toast) */
  createFavoriteCategory: (input: { name: string; color?: string }) => string | null
  /** 默认分类不存在且已满 MAX_FAVORITE_CATEGORIES 时返回 null(带 toast) */
  ensureDefaultFavoriteCategory: () => string | null
  updateFavoriteCategory: (
    id: string,
    patch: Partial<Pick<FavoriteCategory, 'name' | 'color'>>,
  ) => void
  deleteFavoriteCategory: (id: string) => Promise<void>
  moveFavoriteCategory: (id: string, direction: -1 | 1) => void

  // 提示词片段（snippets）
  snippets: PromptSnippet[]
  setSnippets: (snippets: PromptSnippet[]) => void
  /** 满 MAX_SNIPPETS 或 content 为空时返回 null（前者带 toast） */
  createSnippet: (input: { name: string; content: string }) => string | null
  updateSnippet: (id: string, patch: Partial<Pick<PromptSnippet, 'name' | 'content'>>) => void
  deleteSnippet: (id: string) => void
  moveSnippet: (id: string, direction: -1 | 1) => void

  // 批次笔记（batchId → 笔记;批次实体不进 IDB,笔记走 persist）
  batchNotes: Record<string, BatchNote>
  /** trim 后为空 → 删除条目;超长截断 */
  setBatchNote: (batchId: string, text: string) => void

  // 对话（conversations）
  conversations: Conversation[]
  activeConversationId: string | null
  setConversations: (conversations: Conversation[]) => void
  createConversation: (seedTitle?: string) => string
  /** 侧栏 / 命令面板「新建对话」共用:已有可复用的空「新对话」就切过去,否则新建——避免连按堆积同名空对话并写库 */
  createOrReuseEmptyConversation: () => string
  renameConversation: (id: string, title: string) => Promise<void>
  deleteConversationWithTasks: (id: string) => void
  setActiveConversation: (id: string | null) => void
}

export const createTasksSlice: StateCreator<AppState, [], [], TasksSlice> = (set, get) => ({
  // Input
  prompt: '',
  setPrompt: (prompt) => set({ prompt: prompt.slice(0, MAX_TASK_TEXT_LEN) }),
  inputImages: [],
  addInputImage: (img) =>
    set((s) => {
      if (s.inputImages.find((i) => i.id === img.id)) return s
      if (s.inputImages.length >= MAX_INPUT_IMAGES_PER_SUBMISSION) return s
      return { inputImages: [...s.inputImages, img] }
    }),
  removeInputImage: (idx) =>
    set((s) => {
      const removed = s.inputImages[idx]
      const shouldClearMask = removed?.id === s.maskDraft?.targetImageId
      return {
        inputImages: s.inputImages.filter((_, i) => i !== idx),
        ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
      }
    }),
  clearInputImages: () =>
    set(() => ({ inputImages: [], maskDraft: null, maskEditorImageId: null })),
  setInputImages: (imgs) =>
    set((s) => {
      const inputImages = orderImagesWithMaskFirst(
        dedupeInputImagesById(imgs),
        s.maskDraft?.targetImageId,
      )
      const shouldClearMask =
        Boolean(s.maskDraft) && !inputImages.some((img) => img.id === s.maskDraft?.targetImageId)
      return {
        inputImages,
        ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
      }
    }),
  moveInputImage: (fromIdx, toIdx) =>
    set((s) => {
      // 自身左右两个缝隙都是原地不动(UI 已过滤,store 自己也防,免得空转一次 set)
      if (toIdx === fromIdx || toIdx === fromIdx + 1) return s
      const next = [...s.inputImages]
      const [moved] = next.splice(fromIdx, 1)
      if (!moved) return s
      // 缝隙下标以移除前数组为准:移除 fromIdx 后其后的元素整体前移一位,
      // 向前拖(toIdx > fromIdx)若不减 1 就会比指示线多后移一格
      next.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, moved)
      const reordered = orderImagesWithMaskFirst(next, s.maskDraft?.targetImageId)
      return { inputImages: reordered }
    }),
  maskDraft: null,
  setMaskDraft: (maskDraft) =>
    set((s) => {
      if (!maskDraft) return { maskDraft: null }
      const inputImages = orderImagesWithMaskFirst(s.inputImages, maskDraft.targetImageId)
      return { maskDraft, inputImages }
    }),
  clearMaskDraft: () => set({ maskDraft: null, maskEditorImageId: null }),
  maskEditorImageId: null,
  setMaskEditorImageId: (id) =>
    set({ maskEditorImageId: id === null ? null : id.slice(0, MAX_TASK_TEXT_LEN) }),

  // Params
  params: { ...DEFAULT_PARAMS },
  setParams: (p) =>
    set((s) => ({
      params: normalizeParamsForSettings({ ...s.params, ...p }, s.settings),
    })),

  // Tasks
  tasks: [],
  setTasks: (tasks) => set({ tasks }),

  taskRetryInfo: {},
  setTaskRetryInfo: (taskId, info) =>
    set((s) => {
      if (info === null) {
        if (!(taskId in s.taskRetryInfo)) return s
        const next = { ...s.taskRetryInfo }
        delete next[taskId]
        return { taskRetryInfo: next }
      }
      return { taskRetryInfo: { ...s.taskRetryInfo, [taskId]: info } }
    }),

  // Favorite categories
  favoriteCategories: [createDefaultFavoriteCategory()],
  favoriteCategoriesInitialized: true,
  setFavoriteCategories: (favoriteCategories) =>
    set((state) => createCategoryStatePatch(favoriteCategories, state.filterFavoriteCategoryId)),
  createFavoriteCategory: ({ name, color }) => {
    // 写入侧拦上限:normalizeFavoriteCategories 在持久化恢复时会 slice(0, MAX),超出的分类会被静默切掉,
    // 而这里若照样返回 id,任务就被收藏到一个重启后不存在的幽灵分类
    if (get().favoriteCategories.length >= MAX_FAVORITE_CATEGORIES) {
      get().showToast(`收藏分类已达上限（${MAX_FAVORITE_CATEGORIES} 个），请先清理`, 'error')
      return null
    }
    const id = genCategoryId()
    set((state) =>
      createCategoryStatePatch(
        [
          ...state.favoriteCategories,
          {
            id,
            name: name.trim() || '未命名分类',
            color: color || DEFAULT_FAVORITE_CATEGORY_COLOR,
            sortOrder: state.favoriteCategories.length,
            createdAt: Date.now(),
          },
        ],
        state.filterFavoriteCategoryId,
      ),
    )
    return id
  },
  ensureDefaultFavoriteCategory: () => {
    const existing = get().favoriteCategories.find(
      (category) => category.id === DEFAULT_FAVORITE_CATEGORY_ID,
    )
    if (existing) return existing.id
    if (get().favoriteCategories.length >= MAX_FAVORITE_CATEGORIES) {
      get().showToast(`收藏分类已达上限（${MAX_FAVORITE_CATEGORIES} 个），请先清理`, 'error')
      return null
    }

    set((state) =>
      createCategoryStatePatch(
        [
          ...state.favoriteCategories,
          {
            ...createDefaultFavoriteCategory(Date.now()),
            sortOrder: -1,
          },
        ],
        state.filterFavoriteCategoryId,
      ),
    )
    return DEFAULT_FAVORITE_CATEGORY_ID
  },
  updateFavoriteCategory: (id, patch) =>
    set((state) =>
      createCategoryStatePatch(
        state.favoriteCategories.map((category) =>
          category.id === id
            ? {
                ...category,
                ...(patch.name !== undefined ? { name: patch.name } : {}),
                ...(patch.color !== undefined ? { color: patch.color } : {}),
              }
            : category,
        ),
        state.filterFavoriteCategoryId,
      ),
    ),
  deleteFavoriteCategory: async (id) => {
    const state = get()

    /*
     * ========================================================================
     * 步骤1：清理分类引用
     * ========================================================================
     * 数据源：
     *   1) 当前 Zustand 任务列表
     *   2) 待删除的收藏分类 id
     * 操作要点：
     *   1) UI 状态先同步清空引用
     *   2) 只持久化实际受影响的任务
     */
    // 1.1 清空使用该分类的任务引用
    const nextTasks = state.tasks.map((task) =>
      task.favoriteCategoryId === id ? { ...task, favoriteCategoryId: null } : task,
    )

    // 1.2 更新分类列表、筛选条件和任务列表
    set({
      ...createCategoryStatePatch(
        state.favoriteCategories.filter((category) => category.id !== id),
        state.filterFavoriteCategoryId,
      ),
      tasks: nextTasks,
    })

    // 1.3 持久化受影响任务（基于原 categoryId 直接定位 dirty，去掉对列表同序的依赖）
    const dirtyTasks = state.tasks
      .filter((task) => task.favoriteCategoryId === id)
      .map((task) => ({ ...task, favoriteCategoryId: null }))
    try {
      await Promise.all(dirtyTasks.map((task) => putTask(task)))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set((latest) => ({
        tasks: latest.tasks.map((task) =>
          dirtyTasks.some((dirty) => dirty.id === task.id)
            ? { ...task, persistenceError: message }
            : task,
        ),
      }))
      get().showToast(`保存任务失败：${message}`, 'error')
      throw err
    }
  },
  moveFavoriteCategory: (id, direction) =>
    set((state) => {
      const categories = reorderCategories(state.favoriteCategories)
      const index = categories.findIndex((category) => category.id === id)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= categories.length) return state

      const next = [...categories]
      const [moved] = next.splice(index, 1)
      next.splice(nextIndex, 0, moved)
      return { favoriteCategories: next.map((category, sortOrder) => ({ ...category, sortOrder })) }
    }),

  // Prompt snippets
  snippets: [],
  setSnippets: (snippets) => set({ snippets: normalizeSnippets(snippets) }),
  createSnippet: ({ name, content }) => {
    const trimmedContent = content.trim()
    if (!trimmedContent) return null
    const state = get()
    if (state.snippets.length >= MAX_SNIPPETS) {
      state.showToast(`片段已达上限（${MAX_SNIPPETS} 条），请先清理`, 'error')
      return null
    }
    const id = genSnippetId()
    const now = Date.now()
    set((s) => ({
      snippets: [
        ...s.snippets,
        {
          id,
          name: name.trim().slice(0, MAX_SNIPPET_NAME_LEN) || '未命名片段',
          content: trimmedContent.slice(0, MAX_SNIPPET_CONTENT_LEN),
          createdAt: now,
          updatedAt: now,
          sortOrder: s.snippets.length,
        },
      ],
    }))
    return id
  },
  updateSnippet: (id, patch) =>
    set((s) => ({
      snippets: s.snippets.map((snippet) => {
        if (snippet.id !== id) return snippet
        // content 提供但 trim 后为空 → 忽略该字段（片段本体不允许置空）
        const nextContent =
          patch.content !== undefined && patch.content.trim()
            ? patch.content.trim().slice(0, MAX_SNIPPET_CONTENT_LEN)
            : snippet.content
        const nextName =
          patch.name !== undefined
            ? patch.name.trim().slice(0, MAX_SNIPPET_NAME_LEN) || '未命名片段'
            : snippet.name
        if (nextContent === snippet.content && nextName === snippet.name) return snippet
        return { ...snippet, name: nextName, content: nextContent, updatedAt: Date.now() }
      }),
    })),
  deleteSnippet: (id) =>
    set((s) => ({
      snippets: s.snippets
        .filter((snippet) => snippet.id !== id)
        .map((snippet, sortOrder) => ({ ...snippet, sortOrder })),
    })),
  moveSnippet: (id, direction) =>
    set((s) => {
      const index = s.snippets.findIndex((snippet) => snippet.id === id)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= s.snippets.length) return s
      const next = [...s.snippets]
      const [moved] = next.splice(index, 1)
      next.splice(nextIndex, 0, moved)
      return { snippets: next.map((snippet, sortOrder) => ({ ...snippet, sortOrder })) }
    }),

  // Batch notes
  batchNotes: {},
  setBatchNote: (batchId, text) =>
    set((s) => {
      const trimmed = text.trim().slice(0, MAX_BATCH_NOTE_LEN)
      if (!trimmed) {
        if (!(batchId in s.batchNotes)) return s
        const next = { ...s.batchNotes }
        delete next[batchId]
        return { batchNotes: next }
      }
      // 写入路径同样过 normalize 截断条数:cap 只在读取/合并时生效的话,
      // live map 可超 MAX_BATCH_NOTES 直到下次 reload 才被裁(新条目 updatedAt 最新,必被保留)
      return {
        batchNotes: normalizeBatchNotes({
          ...s.batchNotes,
          [batchId]: { text: trimmed, updatedAt: Date.now() },
        }),
      }
    }),

  // Conversations
  conversations: [],
  activeConversationId: null,
  setConversations: (conversations) => set({ conversations }),
  createConversation: (seedTitle) => {
    const current = get()
    // 写入侧拦上限:超过后 normalizeConversations 会在下次读库时静默截掉 updatedAt 最旧的对话
    //(记录仍在 IDB 里但侧栏看不到、其任务在任何对话视图都不可见)。达上限时不建新对话,
    // 停留在当前对话(没有则回落到最新的普通对话 / archive),让调用方拿到的 id 始终有效。
    if (isConversationLimitReached(current.conversations)) {
      current.showToast(
        `对话已达上限（${MAX_CONVERSATIONS - 1} 个），请先删除不需要的对话`,
        'error',
      )
      const fallbackId =
        current.activeConversationId ??
        current.conversations.find((c) => c.id !== ARCHIVE_CONVERSATION_ID)?.id ??
        ARCHIVE_CONVERSATION_ID
      if (fallbackId !== current.activeConversationId) {
        set({ activeConversationId: fallbackId, selectedTaskIds: [] })
      }
      return fallbackId
    }
    const id = genConversationId()
    const now = Date.now()
    const next: Conversation = {
      id,
      title: normalizeConversationTitle(seedTitle),
      createdAt: now,
      updatedAt: now,
    }
    // 登记在途写入(与 set 同一同步段):跨标签页刷新的快照里还没有这条新对话,不能把它连同 activeConversationId 一起抹掉
    markPendingIndexedDbConversationWrite(id)
    set((state) => ({
      conversations: [next, ...state.conversations.filter((c) => c.id !== id)],
      activeConversationId: id,
      selectedTaskIds: [],
    }))
    void putConversation(next)
      .catch((err: unknown) => {
        // 不回滚内存态(任务可能已挂在该对话上,回滚会造成更严重的内存/库不一致),但要让用户知道:
        // 静默吞掉的话这条对话重启后从侧栏消失,其任务只剩图库可见
        const message = err instanceof Error ? err.message : String(err)
        get().showToast(`保存对话失败：${message}`, 'error')
      })
      .finally(() => clearPendingIndexedDbConversationWrite(id))
    return id
  },
  createOrReuseEmptyConversation: () => {
    const state = get()
    const taskCountByConversation = new Map<string, number>()
    for (const task of state.tasks) {
      if (!task.conversationId) continue
      taskCountByConversation.set(
        task.conversationId,
        (taskCountByConversation.get(task.conversationId) ?? 0) + 1,
      )
    }
    const reusable = findReusableEmptyConversation(
      normalizeConversations(state.conversations),
      taskCountByConversation,
    )
    if (reusable) {
      if (state.activeConversationId !== reusable.id) {
        set({ activeConversationId: reusable.id, selectedTaskIds: [] })
      }
      return reusable.id
    }
    return state.createConversation()
  },
  renameConversation: async (id, title) => {
    if (!title.trim()) return
    const normalizedTitle = normalizeConversationTitle(title)
    const state = get()
    if (isArchiveConversation(id)) {
      state.showToast('「历史记录」对话不可重命名', 'error')
      return
    }
    const target = state.conversations.find((c) => c.id === id)
    if (!target) return
    const updated: Conversation = { ...target, title: normalizedTitle, updatedAt: Date.now() }
    markPendingIndexedDbConversationWrite(id)
    set({
      conversations: state.conversations.map((c) => (c.id === id ? updated : c)),
    })
    try {
      await putConversation(updated)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set((latest) => ({
        conversations: latest.conversations.map((conversation) =>
          conversation.id === id && conversation === updated ? target : conversation,
        ),
      }))
      get().showToast(`重命名对话失败：${message}`, 'error')
      throw err
    } finally {
      clearPendingIndexedDbConversationWrite(id)
    }
  },
  deleteConversationWithTasks: (id) => {
    const state = get()
    if (isArchiveConversation(id)) {
      state.showToast('「历史记录」对话不可删除', 'error')
      return
    }
    const target = state.conversations.find((c) => c.id === id)
    if (!target) return

    const affectedTaskCount = state.tasks.filter((task) => task.conversationId === id).length
    state.setConfirmDialog({
      title: '删除对话',
      message:
        affectedTaskCount > 0
          ? `确定删除对话「${target.title}」？该对话下的 ${affectedTaskCount} 条任务将一并删除，且不可恢复。`
          : `确定删除对话「${target.title}」？`,
      confirmText: '删除',
      tone: 'danger',
      // 连带删除整段对话+全部任务+图片且不可恢复,影响面远超单条删除:加冷静期防连点误触
      minConfirmDelayMs: 700,
      action: async () => {
        try {
          // terminate + 同步更新 store 必须在任何 await 之前(契约见 terminateRunningTaskRuntimes,
          // 与 removeTask/removeMultipleTasks 的「先 setTasks 再 await db」安全模式一致):
          // 否则在途任务的 abort 异常会赶在级联删除事务后把幽灵 error 记录写回 tasks 表
          const latest = get()
          const previousConversations = latest.conversations
          const previousTasks = latest.tasks
          const previousActiveConversationId = latest.activeConversationId
          const previousSelectedTaskIds = latest.selectedTaskIds
          const previousDetailTaskId = latest.detailTaskId
          const previousLineageTaskId = latest.lineageTaskId
          const previousCompareTaskIds = latest.compareTaskIds
          const previousLightboxImageId = latest.lightboxImageId
          const previousLightboxImageList = latest.lightboxImageList
          const previousCaptionBatchImageIds = latest.captionBatchImageIds
          const previousMaskEditorImageId = latest.maskEditorImageId
          const deletedTasks = latest.tasks.filter((task) => task.conversationId === id)
          const latestTargetConversation = latest.conversations.find((c) => c.id === id)
          const deleteStartedAt = Date.now()
          const cancelledDeletedTasks = deletedTasks
            .filter((task) => task.status === 'running')
            .map((task) => createCancelledTask(task, deleteStartedAt))
          const cancelledTaskById = new Map(cancelledDeletedTasks.map((task) => [task.id, task]))
          const previousTasksAfterAbort = previousTasks.map(
            (task) => cancelledTaskById.get(task.id) ?? task,
          )
          const previousDeletedTaskById = new Map(
            previousTasksAfterAbort
              .filter((task) => task.conversationId === id)
              .map((task) => [task.id, task]),
          )
          const previousTargetConversationById = latestTargetConversation
            ? new Map([[id, latestTargetConversation]])
            : new Map<string, Conversation>()
          terminateRunningTaskRuntimes(deletedTasks)
          const remainingConversations = latest.conversations.filter((c) => c.id !== id)
          const remainingTasks = latest.tasks.filter((task) => task.conversationId !== id)
          // 下一个激活项按侧栏可见顺序(updatedAt 降序,archive 沉底)选,与 initStore / 跨标签页刷新同口径;
          // remainingConversations[0] 是 store 插入序,用户看到的会是「跳到了一个不相邻的对话」
          const nextActive =
            latest.activeConversationId === id
              ? (normalizeConversations(remainingConversations).find(
                  (c) => c.id !== ARCHIVE_CONVERSATION_ID,
                )?.id ?? ARCHIVE_CONVERSATION_ID)
              : latest.activeConversationId
          // 删除登记与 set 同一同步段:级联删除落盘前的跨标签页刷新不得把对话与其任务借快照复活
          markPendingIndexedDbConversationDelete(id)
          for (const task of deletedTasks) markPendingIndexedDbTaskDelete(task.id)
          const clearDeleteMarks = () => {
            clearPendingIndexedDbConversationDelete(id)
            for (const task of deletedTasks) clearPendingIndexedDbTaskDelete(task.id)
          }
          set({
            conversations: remainingConversations,
            tasks: remainingTasks,
            activeConversationId: nextActive,
          })
          clearTransientUiReferencesForDeletedTasks(deletedTasks)
          const optimisticUiAfterDelete = get()
          try {
            await dbDeleteConversation(id, true)
            clearDeleteMarks()
          } catch (err) {
            clearDeleteMarks()
            set((current) => ({
              conversations: restoreRemovedItemsByPreviousOrder(
                current.conversations,
                previousConversations,
                previousTargetConversationById,
              ),
              tasks: restoreRemovedItemsByPreviousOrder(
                current.tasks,
                previousTasks,
                previousDeletedTaskById,
              ),
              activeConversationId:
                current.activeConversationId === nextActive
                  ? previousActiveConversationId
                  : current.activeConversationId,
              selectedTaskIds: sameStringList(
                current.selectedTaskIds,
                optimisticUiAfterDelete.selectedTaskIds,
              )
                ? previousSelectedTaskIds
                : current.selectedTaskIds,
              detailTaskId:
                current.detailTaskId === optimisticUiAfterDelete.detailTaskId
                  ? previousDetailTaskId
                  : current.detailTaskId,
              lineageTaskId:
                current.lineageTaskId === optimisticUiAfterDelete.lineageTaskId
                  ? previousLineageTaskId
                  : current.lineageTaskId,
              compareTaskIds: sameStringList(
                current.compareTaskIds,
                optimisticUiAfterDelete.compareTaskIds,
              )
                ? previousCompareTaskIds
                : current.compareTaskIds,
              lightboxImageId:
                current.lightboxImageId === optimisticUiAfterDelete.lightboxImageId
                  ? previousLightboxImageId
                  : current.lightboxImageId,
              lightboxImageList: sameStringList(
                current.lightboxImageList,
                optimisticUiAfterDelete.lightboxImageList,
              )
                ? previousLightboxImageList
                : current.lightboxImageList,
              captionBatchImageIds: sameStringList(
                current.captionBatchImageIds,
                optimisticUiAfterDelete.captionBatchImageIds,
              )
                ? previousCaptionBatchImageIds
                : current.captionBatchImageIds,
              maskEditorImageId:
                current.maskEditorImageId === optimisticUiAfterDelete.maskEditorImageId
                  ? previousMaskEditorImageId
                  : current.maskEditorImageId,
            }))
            await Promise.all(
              cancelledDeletedTasks.map(async (task) => {
                try {
                  await putTask(task)
                } catch (persistErr) {
                  const message =
                    persistErr instanceof Error ? persistErr.message : String(persistErr)
                  set((state) => ({
                    tasks: state.tasks.map((item) =>
                      item.id === task.id ? { ...item, persistenceError: message } : item,
                    ),
                  }))
                  get().showToast(`保存任务失败：${message}`, 'error')
                }
              }),
            )
            throw err
          }
          get().showToast('对话已删除', 'success')
          // 即时回收被删任务的孤儿图片(与 removeTask/removeMultipleTasks 行为对齐,
          // 不再留给下次启动的 initStore GC):rollbackStoredImages 只删当前无引用的,不误删共享图。
          // GC 失败是良性的(initStore 下次兜底),单独吞掉,不把已成功的删除误报成失败。
          try {
            const deletedImageIds = collectReferencedImageIds(deletedTasks, [])
            await rollbackStoredImages([...deletedImageIds])
          } catch {
            /* 孤儿图留待 initStore GC 兜底 */
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          get().showToast(`删除对话失败：${message}`, 'error')
        }
      },
    })
  },
  // 切换对话时清空多选:选中集合不随视图过滤收窄,残留的跨对话选择会让后续批量操作
  // 作用到当前视图看不到的任务上(与 InputBar「全选当前可见」的口径修复同属一个问题域)。
  setActiveConversation: (id) =>
    set((state) => {
      const activeConversationId = id === null ? null : id.slice(0, MAX_CONVERSATION_ID_LEN)
      return state.activeConversationId === activeConversationId
        ? { activeConversationId }
        : { activeConversationId, selectedTaskIds: [] }
    }),
})
