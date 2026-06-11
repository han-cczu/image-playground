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
} from '../../lib/favoriteCategories'
import {
  ARCHIVE_CONVERSATION_ID,
  genConversationId,
  isArchiveConversation,
} from '../../lib/conversations'
import {
  genSnippetId,
  MAX_SNIPPET_CONTENT_LEN,
  MAX_SNIPPET_NAME_LEN,
  MAX_SNIPPETS,
  normalizeSnippets,
} from '../../lib/promptSnippets'
import { MAX_BATCH_NOTE_LEN, normalizeBatchNotes, type BatchNote } from '../../lib/gridSheet'
import {
  deleteConversation as dbDeleteConversation,
  putConversation,
  putTask,
} from '../../lib/db'
import { rollbackStoredImages, terminateRunningTaskRuntimes } from '../../lib/taskRuntime'
import type { AppState } from '../index'

export function orderImagesWithMaskFirst(images: InputImage[], maskTargetImageId: string | null | undefined) {
  if (!maskTargetImageId) return images
  const maskIdx = images.findIndex((img) => img.id === maskTargetImageId)
  if (maskIdx <= 0) return images
  const next = [...images]
  const [maskImage] = next.splice(maskIdx, 1)
  next.unshift(maskImage)
  return next
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
    filterFavoriteCategoryId: filterFavoriteCategoryId && categoryIds.has(filterFavoriteCategoryId)
      ? filterFavoriteCategoryId
      : null,
  }
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

  // 收藏分类
  favoriteCategories: FavoriteCategory[]
  favoriteCategoriesInitialized: boolean
  setFavoriteCategories: (categories: FavoriteCategory[]) => void
  createFavoriteCategory: (input: { name: string; color?: string }) => string
  ensureDefaultFavoriteCategory: () => string
  updateFavoriteCategory: (id: string, patch: Partial<Pick<FavoriteCategory, 'name' | 'color'>>) => void
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
  renameConversation: (id: string, title: string) => Promise<void>
  deleteConversationWithTasks: (id: string) => void
  setActiveConversation: (id: string | null) => void
}

export const createTasksSlice: StateCreator<AppState, [], [], TasksSlice> = (set, get) => ({
  // Input
  prompt: '',
  setPrompt: (prompt) => set({ prompt }),
  inputImages: [],
  addInputImage: (img) =>
    set((s) => {
      if (s.inputImages.find((i) => i.id === img.id)) return s
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
      const inputImages = orderImagesWithMaskFirst(imgs, s.maskDraft?.targetImageId)
      const shouldClearMask =
        Boolean(s.maskDraft) && !inputImages.some((img) => img.id === s.maskDraft?.targetImageId)
      return {
        inputImages,
        ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
      }
    }),
  moveInputImage: (fromIdx, toIdx) =>
    set((s) => {
      if (fromIdx === toIdx) return s
      const next = [...s.inputImages]
      const [moved] = next.splice(fromIdx, 1)
      if (!moved) return s
      next.splice(toIdx, 0, moved)
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
  setMaskEditorImageId: (id) => set({ maskEditorImageId: id }),

  // Params
  params: { ...DEFAULT_PARAMS },
  setParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),

  // Tasks
  tasks: [],
  setTasks: (tasks) => set({ tasks }),

  // Favorite categories
  favoriteCategories: [createDefaultFavoriteCategory()],
  favoriteCategoriesInitialized: true,
  setFavoriteCategories: (favoriteCategories) =>
    set((state) => createCategoryStatePatch(favoriteCategories, state.filterFavoriteCategoryId)),
  createFavoriteCategory: ({ name, color }) => {
    const id = genCategoryId()
    set((state) => createCategoryStatePatch([
      ...state.favoriteCategories,
      {
        id,
        name: name.trim() || '未命名分类',
        color: color || DEFAULT_FAVORITE_CATEGORY_COLOR,
        sortOrder: state.favoriteCategories.length,
        createdAt: Date.now(),
      },
    ], state.filterFavoriteCategoryId))
    return id
  },
  ensureDefaultFavoriteCategory: () => {
    const existing = get().favoriteCategories.find((category) => category.id === DEFAULT_FAVORITE_CATEGORY_ID)
    if (existing) return existing.id

    set((state) => createCategoryStatePatch([
      ...state.favoriteCategories,
      {
        ...createDefaultFavoriteCategory(Date.now()),
        sortOrder: -1,
      },
    ], state.filterFavoriteCategoryId))
    return DEFAULT_FAVORITE_CATEGORY_ID
  },
  updateFavoriteCategory: (id, patch) =>
    set((state) => createCategoryStatePatch(state.favoriteCategories.map((category) =>
      category.id === id
        ? {
            ...category,
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.color !== undefined ? { color: patch.color } : {}),
          }
        : category,
    ), state.filterFavoriteCategoryId)),
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
    await Promise.all(dirtyTasks.map((task) => putTask(task)))
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
    const id = genConversationId()
    const now = Date.now()
    const next: Conversation = {
      id,
      title: seedTitle?.trim() || '新对话',
      createdAt: now,
      updatedAt: now,
    }
    set((state) => ({
      conversations: [next, ...state.conversations.filter((c) => c.id !== id)],
      activeConversationId: id,
    }))
    void putConversation(next).catch(() => {
      /* 持久化失败不阻塞 UI；后续可通过其他动作再次写入 */
    })
    return id
  },
  renameConversation: async (id, title) => {
    const trimmed = title.trim()
    if (!trimmed) return
    const state = get()
    if (isArchiveConversation(id)) {
      state.showToast('「历史记录」对话不可重命名', 'error')
      return
    }
    const target = state.conversations.find((c) => c.id === id)
    if (!target) return
    const updated: Conversation = { ...target, title: trimmed, updatedAt: Date.now() }
    set({
      conversations: state.conversations.map((c) => (c.id === id ? updated : c)),
    })
    await putConversation(updated)
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
      action: () => {
        void (async () => {
          try {
            // terminate + 同步更新 store 必须在任何 await 之前(契约见 terminateRunningTaskRuntimes,
            // 与 removeTask/removeMultipleTasks 的「先 setTasks 再 await db」安全模式一致):
            // 否则在途任务的 abort 异常会赶在级联删除事务后把幽灵 error 记录写回 tasks 表
            const latest = get()
            const deletedTasks = latest.tasks.filter((task) => task.conversationId === id)
            terminateRunningTaskRuntimes(deletedTasks)
            const remainingConversations = latest.conversations.filter((c) => c.id !== id)
            const remainingTasks = latest.tasks.filter((task) => task.conversationId !== id)
            const nextActive =
              latest.activeConversationId === id
                ? remainingConversations[0]?.id ?? ARCHIVE_CONVERSATION_ID
                : latest.activeConversationId
            set({
              conversations: remainingConversations,
              tasks: remainingTasks,
              activeConversationId: nextActive,
            })
            await dbDeleteConversation(id, true)
            latest.showToast('对话已删除', 'success')
            // 即时回收被删任务的孤儿图片(与 removeTask/removeMultipleTasks 行为对齐,
            // 不再留给下次启动的 initStore GC):rollbackStoredImages 只删当前无引用的,不误删共享图。
            // GC 失败是良性的(initStore 下次兜底),单独吞掉,不把已成功的删除误报成失败。
            try {
              const deletedImageIds = new Set<string>()
              for (const task of deletedTasks) {
                for (const imgId of task.inputImageIds || []) deletedImageIds.add(imgId)
                if (task.maskImageId) deletedImageIds.add(task.maskImageId)
                for (const imgId of task.outputImages || []) deletedImageIds.add(imgId)
              }
              await rollbackStoredImages([...deletedImageIds])
            } catch {
              /* 孤儿图留待 initStore GC 兜底 */
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            get().showToast(`删除对话失败：${message}`, 'error')
          }
        })()
      },
    })
  },
  // 切换对话时清空多选:选中集合不随视图过滤收窄,残留的跨对话选择会让后续批量操作
  // 作用到当前视图看不到的任务上(与 InputBar「全选当前可见」的口径修复同属一个问题域)。
  setActiveConversation: (id) =>
    set((state) =>
      state.activeConversationId === id
        ? { activeConversationId: id }
        : { activeConversationId: id, selectedTaskIds: [] },
    ),
})
