import type { ApiProvider, AppSettings, GridAxis, InputImage, TaskParams, TaskRecord } from '../types'
import { useStore } from '../store'
import { getActiveApiProfile, validateApiProfile } from './api/apiProfiles'
import {
  getAllTasks,
  putTask,
  deleteTask as dbDeleteTask,
  getAllImages,
  deleteImage,
  storeImage,
  storedImageToDataUrl,
  getAllConversations,
  putConversation,
  persistConversationMigration,
} from './db'
import { callImageApi } from './api'
import { buildFinalPrompt } from './stylePresets'
import {
  countPromptExpansion,
  expandPromptTemplate,
  MAX_PROMPT_EXPANSION,
  MAX_PROMPT_EXPANSION_HARD,
} from './promptExpand'
import { mapWithConcurrency } from './concurrency'
import { collectReferencedImageIds } from './storageStats'
import { buildGridCells, countGridCells, reconstructMatrix } from './gridExperiment'
import { getImageDimensions, validateMaskMatchesImage } from './image/canvasImage'
import { orderInputImagesForMask } from './image/mask'
import { getChangedParams, normalizeParamsForSettings } from './api/paramCompatibility'
import {
  deleteCachedImage,
  ensureImageCached,
  setCachedImage,
} from './imageCache'
import {
  ARCHIVE_CONVERSATION_ID,
  CONVERSATION_MIGRATION_VERSION,
  createArchiveConversation,
  deriveConversationTitleFromPrompt,
  normalizeConversations,
  readConversationMigrationVersion,
  writeConversationMigrationVersion,
} from './conversations'
import { reseedConversationsFromFavoriteCategories } from './conversationMigration'
import { SORT_STEP, SORT_EPSILON, computeReorderedSortOrders } from './taskSort'

const syncHttpWatchdogTimers = new Map<string, ReturnType<typeof setTimeout>>()
const taskAbortControllers = new Map<string, AbortController>()
const SYNC_HTTP_INTERRUPTED_ERROR = '请求中断'
const TASK_CANCELLED_ERROR = '已取消生成'

function createSyncHttpTimeoutError(timeoutSeconds: number) {
  return `请求超时：超过 ${timeoutSeconds} 秒仍未完成，请稍后重试或提高超时时间。`
}

let uid = 0
function genId(): string {
  return Date.now().toString(36) + (++uid).toString(36) + Math.random().toString(36).slice(2, 6)
}

export function getCodexCliPromptKey(settings: AppSettings): string {
  const profile = getActiveApiProfile(settings)
  return `${profile.baseUrl}\n${profile.apiKey}`
}

function isSyncHttpTask(task: TaskRecord) {
  const provider = task.apiProvider ?? 'openai'
  return provider === 'openai' || provider === 'gemini'
}

function isRunningSyncHttpTask(task: TaskRecord) {
  return task.status === 'running' && isSyncHttpTask(task)
}

export function markInterruptedSyncHttpTasks(tasks: TaskRecord[], now = Date.now()) {
  const interruptedTasks: TaskRecord[] = []
  const updatedTasks = tasks.map((task) => {
    if (!isRunningSyncHttpTask(task)) return task

    const updated: TaskRecord = {
      ...task,
      status: 'error',
      error: SYNC_HTTP_INTERRUPTED_ERROR,
      finishedAt: now,
      elapsed: Math.max(0, now - task.createdAt),
    }
    interruptedTasks.push(updated)
    return updated
  })

  return { tasks: updatedTasks, interruptedTasks }
}

function clearSyncHttpWatchdogTimer(taskId: string) {
  const timer = syncHttpWatchdogTimers.get(taskId)
  if (timer) clearTimeout(timer)
  syncHttpWatchdogTimers.delete(taskId)
}

function clearTaskAbortController(taskId: string) {
  taskAbortControllers.delete(taskId)
}

function abortTaskRequest(taskId: string) {
  const controller = taskAbortControllers.get(taskId)
  if (controller && !controller.signal.aborted) controller.abort()
}

/** 统一收口在途任务的运行期资源:中止请求 + 清 watchdog 定时器 + 清 AbortController。 */
function terminateTaskRuntime(taskId: string) {
  abortTaskRequest(taskId)
  clearSyncHttpWatchdogTimer(taskId)
  clearTaskAbortController(taskId)
}

/**
 * 回滚一组刚 storeImage 的图片(成对删 DB + 内存缓存),但只删当前没有任何 task / inputImage 引用的,
 * 避免误删内容寻址去重命中的在用图。供 executeTask 写图后早退、蒙版保存竞态复用。
 */
export async function rollbackStoredImages(imageIds: string[]): Promise<void> {
  if (!imageIds.length) return
  const { tasks, inputImages } = useStore.getState()
  const stillUsed = new Set<string>()
  for (const t of tasks) {
    for (const id of t.inputImageIds || []) stillUsed.add(id)
    if (t.maskImageId) stillUsed.add(t.maskImageId)
    for (const id of t.outputImages || []) stillUsed.add(id)
  }
  for (const img of inputImages) stillUsed.add(img.id)
  for (const id of imageIds) {
    if (!stillUsed.has(id)) {
      await deleteImage(id)
      deleteCachedImage(id)
    }
  }
}

function updateTaskInStoreSilently(taskId: string, patch: Partial<TaskRecord>) {
  void updateTaskInStore(taskId, patch).catch(() => {
    /* updateTaskInStore already surfaced the persistence error */
  })
}

function failSyncHttpTaskIfStillRunning(taskId: string, error: string, now = Date.now()) {
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || !isRunningSyncHttpTask(task)) return false

  terminateTaskRuntime(taskId)

  updateTaskInStoreSilently(taskId, {
    status: 'error',
    error,
    finishedAt: now,
    elapsed: Math.max(0, now - task.createdAt),
  })
  return true
}

/**
 * 用户主动取消一个进行中的任务:中止请求 + 清理运行期资源,并落 'error' 态 + 取消文案。
 * TaskStatus 无 'cancelled',故复用 'error' + 专属文案(与 SYNC_HTTP_INTERRUPTED_ERROR 同构)。
 */
export function cancelTask(taskId: string, now = Date.now()): boolean {
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || task.status !== 'running') return false

  terminateTaskRuntime(taskId)
  updateTaskInStoreSilently(taskId, {
    status: 'error',
    error: TASK_CANCELLED_ERROR,
    finishedAt: now,
    elapsed: Math.max(0, now - task.createdAt),
  })
  return true
}

export function scheduleSyncHttpWatchdog(taskId: string, timeoutSeconds: number) {
  clearSyncHttpWatchdogTimer(taskId)
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || !isRunningSyncHttpTask(task)) return

  // watchdog 总在 executeTask 中、请求即将发起时被调度,故从「此刻」起算完整 timeout。
  // 不能再用 createdAt 偏移:批量路径下 N 条 task 在 enqueueTask 时统一写 createdAt,但要在并发闸
  // (runEnqueuedTasks)队列里排队等待才被取出执行;若按 createdAt 计时,排队时长会被错误计入,
  // 导致后段任务在请求真正开始前(或刚开始)就被误判「请求超时」而假失败。
  // 注:elapsed(用户感知总耗时)仍基于 createdAt,语义不同,不受此影响。
  const timeoutMs = Math.max(0, timeoutSeconds * 1000)
  const timer = setTimeout(() => {
    syncHttpWatchdogTimers.delete(taskId)
    const failed = failSyncHttpTaskIfStillRunning(taskId, createSyncHttpTimeoutError(timeoutSeconds))
    if (failed) useStore.getState().showToast('生成任务请求超时', 'error')
  }, timeoutMs)
  syncHttpWatchdogTimers.set(taskId, timer)
}

export function showCodexCliPrompt(force = false, reason = '接口返回的提示词已被改写') {
  const state = useStore.getState()
  const settings = state.settings
  const promptKey = getCodexCliPromptKey(settings)
  if (!force && (settings.codexCli || state.dismissedCodexCliPrompts.includes(promptKey))) return

  state.setConfirmDialog({
    title: '检测到 Codex CLI API',
    message: `${reason}，当前 API 来源很可能是 Codex CLI。\n\n是否开启 Codex CLI 兼容模式？开启后会禁用在此处无效的质量参数，并在 Images API 多图生成时使用并发请求，解决该 API 数量参数无效的问题。同时，提示词文本开头会加入简短的不改写要求，避免模型重写提示词，偏离原意。`,
    confirmText: '开启',
    action: () => {
      const state = useStore.getState()
      state.dismissCodexCliPrompt(promptKey)
      state.setSettings({ codexCli: true })
    },
    cancelAction: () => useStore.getState().dismissCodexCliPrompt(promptKey),
  })
}

/** 初始化：加载 conversations → 跑迁移 → 加载 tasks → 激活默认对话 → 清理孤立图片 */
export async function initStore() {
  // 启动时间戳:孤儿图清理只删早于此刻创建的图,放过 init 异步窗口里(另一标签)新写入的图。
  const initStartedAt = Date.now()
  /*
   * ========================================================================
   * 步骤1：加载 conversations 与原始 tasks
   * ========================================================================
   */
  // 1.1 conversations + tasks 各自 readonly 读取
  const [rawConversations, storedTasks] = await Promise.all([
    getAllConversations(),
    getAllTasks(),
  ])

  // 1.2 中断进行中的同步 HTTP 任务
  const { tasks: interruptedNormalizedTasks, interruptedTasks } = markInterruptedSyncHttpTasks(storedTasks)

  /*
   * ========================================================================
   * 步骤2：按 favoriteCategory 切分 reseed 迁移（幂等，靠 localStorage 防重跑）
   * ========================================================================
   */
  // 2.1 取出 zustand 中的 favoriteCategories（zustand-persist 同步水合）
  const persistedFavoriteCategories = useStore.getState().favoriteCategories
  const migrationVersion = readConversationMigrationVersion()
  const normalizedExistingConversations = normalizeConversations(rawConversations)
  // 2.2 已迁移过且无 task 缺 conversationId 时跳过
  const hasOrphanTasks = interruptedNormalizedTasks.some(
    (task) => !task.conversationId,
  )
  const shouldRunReseed =
    migrationVersion < CONVERSATION_MIGRATION_VERSION || hasOrphanTasks

  let finalConversations = normalizedExistingConversations
  let finalTasks = interruptedNormalizedTasks

  if (shouldRunReseed) {
    const { conversations: migratedConversations, dirtyTasks } =
      reseedConversationsFromFavoriteCategories({
        tasks: interruptedNormalizedTasks,
        favoriteCategories: persistedFavoriteCategories,
        existingConversations: normalizedExistingConversations,
      })

    // 2.3 单事务持久化（conversations + 受影响的 tasks）
    const dirtyIds = new Set(dirtyTasks.map((task) => task.id))
    const mergedTasks = interruptedNormalizedTasks.map(
      (task) => dirtyTasks.find((dirty) => dirty.id === task.id) ?? task,
    )
    const persistTasks = mergedTasks.filter(
      (task) => dirtyIds.has(task.id) || interruptedTasks.some((t) => t.id === task.id),
    )
    // 仅在确有变更时才写库,避免 localStorage 版本号被清空时每次启动空跑一次全表写事务(M4)
    const conversationsChanged = migratedConversations.length !== normalizedExistingConversations.length
    if (persistTasks.length || conversationsChanged) {
      await persistConversationMigration(migratedConversations, persistTasks)
    }
    writeConversationMigrationVersion(CONVERSATION_MIGRATION_VERSION)

    finalConversations = normalizeConversations(migratedConversations)
    finalTasks = mergedTasks
  } else if (interruptedTasks.length) {
    // 没跑 reseed 但有任务被标记中断时，单独持久化
    await Promise.all(interruptedTasks.map((task) => putTask(task)))
  }

  /*
   * ========================================================================
   * 步骤3：写入 store 并激活对话
   * ========================================================================
   */
  // 3.1 兜底确保 archive 存在
  if (!finalConversations.some((c) => c.id === ARCHIVE_CONVERSATION_ID)) {
    const archive = createArchiveConversation()
    await putConversation(archive)
    finalConversations = normalizeConversations([archive, ...finalConversations])
  }

  // 3.2 写入 store
  useStore.getState().setConversations(finalConversations)
  useStore.getState().setTasks(finalTasks)

  // 3.3 若没有 activeConversationId 或指向不存在的对话，激活 updatedAt 最新的对话
  const currentActiveId = useStore.getState().activeConversationId
  const idExists = currentActiveId
    ? finalConversations.some((c) => c.id === currentActiveId)
    : false
  if (!idExists) {
    const nextActive =
      finalConversations.find((c) => c.id !== ARCHIVE_CONVERSATION_ID) ?? finalConversations[0]
    useStore.getState().setActiveConversation(nextActive?.id ?? null)
  }

  const tasks = finalTasks

  // 收集所有任务引用的图片 id（与孤儿 GC / 存储统计共用同一判定，见 lib/storageStats）
  const persistedInputImages = useStore.getState().inputImages
  const referencedIds = collectReferencedImageIds(tasks, persistedInputImages)

  // 清理孤立图片（不预加载到内存，按需在 ensureImageCached 时加载）
  const images = await getAllImages()
  const imageById = new Map(images.map((img) => [img.id, img]))
  // 删除前重读最新引用集:init 的多个 await 窗口里,本页提交或另一标签页可能已新增引用 / 写入新图。
  // 叠加 createdAt >= initStartedAt 守卫,放过 init 期间另一标签刚 storeImage 但其 task 尚未被本页读到的新图。
  // 两层互补,最坏只漏删孤儿(良性存储泄漏),绝不误删在用图。
  const latestState = useStore.getState()
  const latestReferencedIds = collectReferencedImageIds(latestState.tasks, latestState.inputImages)
  for (const img of images) {
    if (referencedIds.has(img.id) || latestReferencedIds.has(img.id)) continue
    if ((img.createdAt ?? 0) >= initStartedAt) continue
    await deleteImage(img.id)
    deleteCachedImage(img.id)
  }
  // 输入图片需要立即可用（用于显示在输入栏），仍然缓存这部分
  const restoredInputImages = (
    await Promise.all(
      persistedInputImages.map(async (img) => {
        if (img.dataUrl) return img
        const storedImage = imageById.get(img.id)
        const dataUrl = storedImage ? await storedImageToDataUrl(storedImage) : ''
        return { ...img, dataUrl: dataUrl ?? '' }
      }),
    )
  ).filter((img) => img.dataUrl)
  for (const img of restoredInputImages) {
    setCachedImage(img.id, img.dataUrl)
  }
  if (restoredInputImages.length !== persistedInputImages.length || restoredInputImages.some((img, index) => img.dataUrl !== persistedInputImages[index]?.dataUrl)) {
    useStore.getState().setInputImages(restoredInputImages)
  }
}

async function maybeUpdateConversationOnFirstTask(conversationId: string, newTask: TaskRecord) {
  const state = useStore.getState()
  const target = state.conversations.find((c) => c.id === conversationId)
  if (!target) return
  // archive 永远保持「历史记录」标题
  if (target.id === ARCHIVE_CONVERSATION_ID) return

  // 判断是否为该对话首条 task（除新建的这一条）
  const hadPriorTask = state.tasks.some(
    (task) => task.id !== newTask.id && task.conversationId === conversationId,
  )
  const isFirstTask = !hadPriorTask
  const isUnnamed = !target.title || target.title === '新对话'

  const nextTitle = isFirstTask && isUnnamed
    ? deriveConversationTitleFromPrompt(newTask.prompt)
    : target.title
  const updated = {
    ...target,
    title: nextTitle,
    updatedAt: newTask.createdAt,
  }
  useStore.getState().setConversations(
    state.conversations.map((c) => (c.id === conversationId ? updated : c)),
  )
  try {
    await putConversation(updated)
  } catch {
    /* 持久化失败不阻塞 UI；下次 submit 会再次尝试更新 */
  }
}

/** 参数化提交原语：构造一条 TaskRecord、落库（失败回滚内存态）、返回 taskId（失败返回 null）。 */
interface EnqueueTaskSpec {
  /** 已展开的具体 prompt（用户原文，不含风格前缀；风格仍在 executeTask 内拼接） */
  prompt: string
  /** 已归一化的参数 */
  params: TaskParams
  apiProvider: ApiProvider
  apiProfileName: string
  apiModel: string
  /** 已持久化的输入图 id */
  inputImageIds: string[]
  maskTargetImageId: string | null
  maskImageId: string | null
  conversationId: string
  /** 同一次批量提交展开出的多条 task 的关联 id；单条提交不设 */
  batchId?: string
  /** XY 网格轴定义；仅网格提交设 */
  gridAxes?: { x: GridAxis; y?: GridAxis }
  /** XY 网格坐标；仅网格提交设 */
  gridCoord?: { x: string; y?: string }
}

/**
 * 构造 + 落库一条 running 任务。不触发 executeTask、不回填对话标题——这两件事的时机
 * 交由调用方决定（单条立即执行；批量先全部落库再受控调度）。
 */
async function enqueueTask(spec: EnqueueTaskSpec): Promise<string | null> {
  const taskId = genId()
  const task: TaskRecord = {
    id: taskId,
    prompt: spec.prompt,
    params: spec.params,
    apiProvider: spec.apiProvider,
    apiProfileName: spec.apiProfileName,
    apiModel: spec.apiModel,
    inputImageIds: spec.inputImageIds,
    maskTargetImageId: spec.maskTargetImageId,
    maskImageId: spec.maskImageId,
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: Date.now(),
    finishedAt: null,
    elapsed: null,
    conversationId: spec.conversationId,
    ...(spec.batchId ? { batchId: spec.batchId } : {}),
    ...(spec.gridAxes ? { gridAxes: spec.gridAxes, gridCoord: spec.gridCoord } : {}),
  }

  const latestTasks = useStore.getState().tasks
  useStore.getState().setTasks([task, ...latestTasks])
  try {
    await putTask(task)
  } catch (err) {
    // 持久化失败:回滚内存里这条 running 任务,否则会留下无请求 / 无 watchdog 的「幽灵 running」卡片;
    // 调用方多为 fire-and-forget,reject 会逃逸成未捕获 rejection。
    const message = err instanceof Error ? err.message : String(err)
    const state = useStore.getState()
    state.setTasks(state.tasks.filter((t) => t.id !== taskId))
    state.showToast(`保存任务失败：${message}`, 'error')
    return null
  }
  return taskId
}

/** 批量执行的并发上限:批量场景叠加 callImageApi 内部多图拆单会相乘,保守取值避免触发上游 429。 */
const BATCH_CONCURRENCY = 3

/**
 * 以并发上限调度一批已落库 task 的 executeTask。每个 task 的成功/失败/取消已由 executeTask
 * 内部完整收口（落 done/error 态、watchdog、孤儿回滚），故调度器不让单个失败中断整批、也不抛错。
 */
async function runEnqueuedTasks(taskIds: string[], limit = BATCH_CONCURRENCY): Promise<void> {
  await mapWithConcurrency(taskIds, limit, (id) => executeTask(id))
}

interface PreparedSubmission {
  normalizedParams: TaskParams
  inputImageIds: string[]
  maskImageId: string | null
  maskTargetImageId: string | null
  activeConversationId: string
}

/**
 * 采集全局态的共享副作用段(submitTask 与 submitGridTask 共用):mask 处理(含整图确认）→
 * 输入图持久化 → 参数归一化回写 → 确保 active conversation。返回准备结果,或在确认中断 /
 * mask 失败时返回 null(由调用方 return)。
 *
 * 注意:profile / prompt 校验**不在此处**,留在各调用方最前,以保持 submitTask 校验顺序不变。
 * 整图遮罩确认的重入由 onFullMaskRetry 回调驱动,调用方须透传自身的全部确认标志(避免双确认
 * 互相丢标志形成弹窗循环)。副作用顺序严禁乱序(submitTask 单条路径等价性依赖于此)。
 */
async function prepareSubmission(
  options: { allowFullMask?: boolean },
  onFullMaskRetry: () => void,
): Promise<PreparedSubmission | null> {
  const { settings, inputImages, maskDraft, params, showToast, setConfirmDialog } = useStore.getState()

  let orderedInputImages = inputImages
  let maskImageId: string | null = null
  let maskTargetImageId: string | null = null

  if (maskDraft) {
    try {
      orderedInputImages = orderInputImagesForMask(inputImages, maskDraft.targetImageId)
      const coverage = await validateMaskMatchesImage(maskDraft.maskDataUrl, orderedInputImages[0].dataUrl)
      if (coverage === 'full' && !options.allowFullMask) {
        setConfirmDialog({
          title: '确认编辑整张图片？',
          message: '当前遮罩覆盖了整张图片，提交后可能会重绘全部内容。是否继续？',
          confirmText: '继续提交',
          tone: 'warning',
          action: onFullMaskRetry,
        })
        return null
      }
      maskImageId = await storeImage(maskDraft.maskDataUrl, 'mask')
      setCachedImage(maskImageId, maskDraft.maskDataUrl)
      maskTargetImageId = maskDraft.targetImageId
    } catch (err) {
      if (!inputImages.some((img) => img.id === maskDraft.targetImageId)) {
        useStore.getState().clearMaskDraft()
      }
      showToast(err instanceof Error ? err.message : String(err), 'error')
      return null
    }
  }

  // 持久化输入图片到 IndexedDB（此前只在内存缓存中）
  for (const img of orderedInputImages) {
    await storeImage(img.dataUrl)
  }

  const normalizedParams = normalizeParamsForSettings(params, settings)
  const normalizedParamPatch = getChangedParams(params, normalizedParams)
  if (Object.keys(normalizedParamPatch).length) {
    useStore.getState().setParams(normalizedParamPatch)
  }

  // 确保当前有 active conversation；首装/异常情况下兜底创建
  let activeConversationId = useStore.getState().activeConversationId
  if (!activeConversationId) {
    activeConversationId = useStore.getState().createConversation()
  }

  return {
    normalizedParams,
    inputImageIds: orderedInputImages.map((i) => i.id),
    maskImageId,
    maskTargetImageId,
    activeConversationId,
  }
}

/** 提交新任务 */
export async function submitTask(options: { allowFullMask?: boolean; allowLargeBatch?: boolean } = {}) {
  const { settings, prompt, params, showToast, setConfirmDialog } = useStore.getState()

  const activeProfile = getActiveApiProfile(settings)
  if (validateApiProfile(activeProfile)) {
    showToast(`请先完善当前 Provider：${validateApiProfile(activeProfile)}`, 'error')
    useStore.getState().setShowSettings(true)
    return
  }

  if (!prompt.trim()) {
    showToast('请输入提示词', 'error')
    return
  }

  // 提示词通配展开规模把关:只依赖 prompt,放在 mask 处理 / 输入图持久化等任何副作用之前,
  // 这样确认/拒绝发生时尚未产生任何需要回滚的副作用。countPromptExpansion 不构造数组,可安全预判。
  const trimmedPrompt = prompt.trim()
  const expansionCount = countPromptExpansion(trimmedPrompt)
  if (expansionCount > MAX_PROMPT_EXPANSION_HARD) {
    showToast(
      `通配展开将生成 ${expansionCount} 张，超过上限 ${MAX_PROMPT_EXPANSION_HARD}，请精简提示词中的 {…|…} 组合`,
      'error',
    )
    return
  }
  if (expansionCount > MAX_PROMPT_EXPANSION && !options.allowLargeBatch) {
    const totalImages = expansionCount * params.n
    setConfirmDialog({
      title: '批量生成确认',
      message:
        params.n > 1
          ? `检测到提示词通配，将展开为 ${expansionCount} 条提示词，每条 ${params.n} 张，共 ${totalImages} 张图片。是否继续？`
          : `检测到提示词通配，将展开为 ${expansionCount} 条提示词（共 ${expansionCount} 张图片）。是否继续？`,
      confirmText: '继续生成',
      tone: 'warning',
      action: () => {
        void submitTask({ ...options, allowLargeBatch: true })
      },
    })
    return
  }

  const prepared = await prepareSubmission(options, () => {
    // 保留其它确认标志(如 allowLargeBatch),避免大批量 + 整图遮罩双确认互相丢标志形成弹窗循环。
    void submitTask({ ...options, allowFullMask: true })
  })
  if (!prepared) return
  const { normalizedParams, inputImageIds, maskImageId, maskTargetImageId, activeConversationId } = prepared

  // 通配展开:无通配时为 [trimmedPrompt] 原样(与重构前单条路径严格等价)。
  const prompts = expandPromptTemplate(trimmedPrompt)
  const batchId = prompts.length > 1 ? genId() : undefined
  if (prompts.length > 1) {
    // 提交前预告本批将生成的总图片数(展开数 × n),让用户对「一条提示词变多条」有知情(对齐 spec §6)。
    showToast(`通配将生成 ${prompts.length} 条提示词、共 ${prompts.length * normalizedParams.n} 张图片`, 'success')
  }
  const taskIds: string[] = []
  for (const expandedPrompt of prompts) {
    const id = await enqueueTask({
      prompt: expandedPrompt,
      params: normalizedParams,
      apiProvider: activeProfile.provider,
      apiProfileName: activeProfile.name,
      apiModel: activeProfile.model,
      inputImageIds,
      maskTargetImageId,
      maskImageId,
      conversationId: activeConversationId,
      batchId,
    })
    if (id) taskIds.push(id)
  }
  // 全部落库失败:enqueueTask 已逐条回滚内存态并 toast,直接返回。
  if (!taskIds.length) return

  // 首条 task 提交后，若对话仍为「新对话」初始 title，则用 prompt 前 N 字回填，并更新 updatedAt
  const firstTask = useStore.getState().tasks.find((t) => t.id === taskIds[0])
  if (firstTask) void maybeUpdateConversationOnFirstTask(activeConversationId, firstTask)

  if (settings.clearInputAfterSubmit) {
    useStore.getState().setPrompt('')
    useStore.getState().clearInputImages()
  }

  // 异步调用 API:单条直接执行(与重构前一致);批量经并发闸限流调度。
  if (taskIds.length === 1) {
    executeTask(taskIds[0])
  } else {
    void runEnqueuedTasks(taskIds)
  }
}

export interface GridSubmitConfig {
  x: GridAxis
  y?: GridAxis
}

/** 提交 XY 参数网格:笛卡尔积 + 复用 batchId/enqueueTask/runEnqueuedTasks。 */
export async function submitGridTask(
  gridConfig: GridSubmitConfig,
  options: { allowFullMask?: boolean; allowLargeBatch?: boolean } = {},
) {
  const { settings, prompt, params, showToast, setConfirmDialog } = useStore.getState()

  // profile 校验(与 submitTask 同款,最前)
  const activeProfile = getActiveApiProfile(settings)
  const profileError = validateApiProfile(activeProfile)
  if (profileError) {
    showToast(`请先完善当前 Provider：${profileError}`, 'error')
    useStore.getState().setShowSettings(true)
    return
  }
  if (!prompt.trim()) {
    showToast('请输入提示词', 'error')
    return
  }
  if (!gridConfig.x || gridConfig.x.values.length < 2) {
    showToast('请在 X 轴至少选择 2 个取值', 'error')
    return
  }

  // 规模把关(复用通配阈值)
  const cellCount = countGridCells(gridConfig)
  const yCount = gridConfig.y ? gridConfig.y.values.length : 1
  if (cellCount > MAX_PROMPT_EXPANSION_HARD) {
    showToast(`网格将生成 ${cellCount} 格，超过上限 ${MAX_PROMPT_EXPANSION_HARD}，请减少轴取值`, 'error')
    return
  }
  if (cellCount > MAX_PROMPT_EXPANSION && !options.allowLargeBatch) {
    const totalImages = cellCount * params.n
    setConfirmDialog({
      title: '批量生成确认',
      message:
        params.n > 1
          ? `网格将生成 ${gridConfig.x.values.length}×${yCount} = ${cellCount} 格，每格 ${params.n} 张，共 ${totalImages} 张图片。是否继续？`
          : `网格将生成 ${gridConfig.x.values.length}×${yCount} = ${cellCount} 格（共 ${cellCount} 张图片）。是否继续？`,
      confirmText: '继续生成',
      tone: 'warning',
      action: () => {
        void submitGridTask(gridConfig, { ...options, allowLargeBatch: true })
      },
    })
    return
  }

  const prepared = await prepareSubmission(options, () => {
    void submitGridTask(gridConfig, { ...options, allowFullMask: true })
  })
  if (!prepared) return
  const { normalizedParams, inputImageIds, maskImageId, maskTargetImageId, activeConversationId } = prepared

  // 笛卡尔积(base 用归一化后的 params 与当前 prompt;prompt 轴取值来自通配展开,见 gridExperiment)
  const cells = buildGridCells(gridConfig, { params: normalizedParams, prompt: prompt.trim() })
  const gridAxes = { x: gridConfig.x, ...(gridConfig.y ? { y: gridConfig.y } : {}) }
  const batchId = genId()
  showToast(`网格生成：${gridConfig.x.values.length}×${yCount}，共 ${cells.length * normalizedParams.n} 张图片`, 'success')

  const taskIds: string[] = []
  for (const cell of cells) {
    const id = await enqueueTask({
      prompt: cell.prompt,
      params: cell.params,
      apiProvider: activeProfile.provider,
      apiProfileName: activeProfile.name,
      apiModel: activeProfile.model,
      inputImageIds,
      maskTargetImageId,
      maskImageId,
      conversationId: activeConversationId,
      batchId,
      gridAxes,
      gridCoord: cell.gridCoord,
    })
    if (id) taskIds.push(id)
  }
  if (!taskIds.length) return

  const firstTask = useStore.getState().tasks.find((t) => t.id === taskIds[0])
  if (firstTask) void maybeUpdateConversationOnFirstTask(activeConversationId, firstTask)

  if (settings.clearInputAfterSubmit) {
    useStore.getState().setPrompt('')
    useStore.getState().clearInputImages()
  }

  void runEnqueuedTasks(taskIds)
}

/** 内部:为某网格坐标构造 cell spec 并 enqueue(从存活成员快照取非轴 params/输入图/conversation),返回 taskId。 */
async function enqueueGridCell(
  batchId: string,
  coord: { x: string; y?: string },
  sample: TaskRecord,
): Promise<string | null> {
  if (!sample.gridAxes) return null
  const { settings, activeConversationId } = useStore.getState()
  const activeProfile = getActiveApiProfile(settings)
  const xVal = sample.gridAxes.x.values.find((v) => v.key === coord.x)
  const yVal = coord.y != null ? sample.gridAxes.y?.values.find((v) => v.key === coord.y) : undefined
  if (!xVal) return null
  // 用单值轴重建该格(非轴 params 取 sample 快照),buildGridCells 负责轴 override。
  const cellAxes = {
    x: { ...sample.gridAxes.x, values: [xVal] },
    ...(sample.gridAxes.y && yVal ? { y: { ...sample.gridAxes.y, values: [yVal] } } : {}),
  }
  const [cell] = buildGridCells(cellAxes, { params: { ...sample.params }, prompt: sample.prompt })
  if (!cell) return null
  return enqueueTask({
    prompt: cell.prompt,
    params: cell.params,
    apiProvider: activeProfile.provider,
    apiProfileName: activeProfile.name,
    apiModel: activeProfile.model,
    inputImageIds: [...sample.inputImageIds],
    maskTargetImageId: sample.maskTargetImageId ?? null,
    maskImageId: sample.maskImageId ?? null,
    conversationId: sample.conversationId ?? activeConversationId ?? ARCHIVE_CONVERSATION_ID,
    batchId,
    gridAxes: sample.gridAxes,
    gridCoord: cell.gridCoord,
  })
}

/** 补跑单个网格格(结果回到矩阵原坐标)。 */
export function retryGridCell(batchId: string, coord: { x: string; y?: string }): void {
  const sample = useStore.getState().tasks.find((t) => t.batchId === batchId && t.gridAxes)
  if (!sample) return
  void enqueueGridCell(batchId, coord, sample).then((id) => {
    if (id) executeTask(id)
  })
}

/** 补跑网格中「缺失或全部失败」的格(scope:全部 / 指定行 / 指定列)。 */
export function retryGridMissing(batchId: string, scope: 'all' | { row: string } | { col: string }): void {
  const members = useStore.getState().tasks.filter((t) => t.batchId === batchId && t.gridAxes)
  const sample = members[0]
  const matrix = reconstructMatrix(members)
  if (!sample || !matrix) return

  const targets: { x: string; y?: string }[] = []
  for (const col of matrix.cols) {
    if (typeof scope === 'object' && 'col' in scope && col.key !== scope.col) continue
    for (const row of matrix.rows) {
      if (typeof scope === 'object' && 'row' in scope && row.key !== scope.row) continue
      const cellTasks = matrix.cellTasks(col.key, row.key)
      const hasLive = cellTasks.some((t) => t.status === 'done' || t.status === 'running')
      if (!hasLive) targets.push({ x: col.key, ...(matrix.axes.y ? { y: row.key } : {}) })
    }
  }
  if (!targets.length) return
  void (async () => {
    const ids: string[] = []
    for (const coord of targets) {
      const id = await enqueueGridCell(batchId, coord, sample)
      if (id) ids.push(id)
    }
    if (ids.length) void runEnqueuedTasks(ids)
  })()
}

async function executeTask(taskId: string) {
  const { settings } = useStore.getState()
  const task = useStore.getState().tasks.find((t) => t.id === taskId)
  if (!task) return
  const activeProfile = getActiveApiProfile(settings)
  const taskProvider = task.apiProvider ?? activeProfile.provider

  if (taskProvider === 'openai' || taskProvider === 'gemini') {
    taskAbortControllers.set(taskId, new AbortController())
    scheduleSyncHttpWatchdog(taskId, activeProfile.timeout)
  }
  // 取消/删除在途任务会 abort 控制器并把它移出 map(terminateTaskRuntime)。先把 signal 取到局部:
  // 即便随后控制器被移出 map,这个 detached signal 仍能让下游 fetch 观察到 aborted=true 而真正中止;
  // 否则在输入图 await 窗口内取消时,callImageApi 再从 map 读会拿到 undefined,请求跑到 provider timeout 才停。
  const requestSignal = taskAbortControllers.get(taskId)?.signal

  try {
    // 获取输入图片 data URLs
    const inputDataUrls: string[] = []
    for (const imgId of task.inputImageIds) {
      const dataUrl = await ensureImageCached(imgId)
      if (!dataUrl) throw new Error('输入图片已不存在')
      inputDataUrls.push(dataUrl)
    }
    let maskDataUrl: string | undefined
    if (task.maskImageId) {
      maskDataUrl = await ensureImageCached(task.maskImageId)
      if (!maskDataUrl) throw new Error('遮罩图片已不存在')
    }

    // 风格预设：把英文修饰词作为前缀拼到 prompt，task.prompt 本身保持用户原始输入不变
    const finalPrompt = buildFinalPrompt(task.prompt, task.params.stylePreset)

    const result = await callImageApi({
      settings,
      prompt: finalPrompt,
      params: task.params,
      inputImageDataUrls: inputDataUrls,
      maskDataUrl,
      signal: requestSignal,
    })

    const latestBeforeSuccess = useStore.getState().tasks.find((t) => t.id === taskId)
    if (!latestBeforeSuccess || latestBeforeSuccess.status !== 'running') return

    // 存储输出图片
    const outputIds: string[] = []
    for (const dataUrl of result.images) {
      const imgId = await storeImage(dataUrl, 'generated')
      setCachedImage(imgId, dataUrl)
      outputIds.push(imgId)
    }
    const actualParamsByImage = result.actualParamsList?.reduce<Record<string, Partial<TaskParams>>>((acc, params, index) => {
      const imgId = outputIds[index]
      if (imgId && params && Object.keys(params).length > 0) acc[imgId] = params
      return acc
    }, {})
    const revisedPromptByImage = result.revisedPrompts?.reduce<Record<string, string>>((acc, revisedPrompt, index) => {
      const imgId = outputIds[index]
      if (imgId && revisedPrompt && revisedPrompt.trim()) acc[imgId] = revisedPrompt
      return acc
    }, {})
    const promptWasRevised = result.revisedPrompts?.some(
      (revisedPrompt) => revisedPrompt?.trim() && revisedPrompt.trim() !== finalPrompt.trim(),
    )
    const hasRevisedPromptValue = result.revisedPrompts?.some((revisedPrompt) => revisedPrompt?.trim())
    if (taskProvider === 'openai' && activeProfile.provider === 'openai' && !activeProfile.codexCli) {
      if (promptWasRevised) {
        showCodexCliPrompt()
      } else if (!hasRevisedPromptValue) {
        showCodexCliPrompt(false, '接口没有返回官方 API 会返回的部分信息')
      }
    }

    // 更新任务
    const latestBeforeUpdate = useStore.getState().tasks.find((t) => t.id === taskId)
    if (!latestBeforeUpdate || latestBeforeUpdate.status !== 'running') {
      // 任务在写图期间被删/取消:回滚已存但无引用的输出图,避免孤儿记录泄漏
      await rollbackStoredImages(outputIds)
      return
    }
    clearSyncHttpWatchdogTimer(taskId)
    await updateTaskInStore(taskId, {
      outputImages: outputIds,
      actualParams: { ...result.actualParams, n: outputIds.length },
      actualParamsByImage: actualParamsByImage && Object.keys(actualParamsByImage).length > 0 ? actualParamsByImage : undefined,
      revisedPromptByImage: revisedPromptByImage && Object.keys(revisedPromptByImage).length > 0 ? revisedPromptByImage : undefined,
      partialFailureCount: result.partialFailureCount,
      partialFailureMessage: result.partialFailureMessage,
      status: 'done',
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    })

    if (result.partialFailureCount) {
      useStore
        .getState()
        .showToast(`部分完成：成功 ${outputIds.length} 张，失败 ${result.partialFailureCount} 个请求`, 'error')
    } else {
      useStore.getState().showToast(`生成完成，共 ${outputIds.length} 张图片`, 'success')
    }
    const currentMask = useStore.getState().maskDraft
    if (
      maskDataUrl &&
      currentMask &&
      currentMask.targetImageId === task.maskTargetImageId &&
      currentMask.maskDataUrl === maskDataUrl
    ) {
      useStore.getState().clearMaskDraft()
    }
  } catch (err) {
    clearSyncHttpWatchdogTimer(taskId)
    // 任务可能在请求进行中被删除/取消:find 不到或已非 running 时直接退出,不要用 `?? task` 复活已删任务。
    const latestTask = useStore.getState().tasks.find((t) => t.id === taskId)
    if (!latestTask || latestTask.status !== 'running') return
    // L7:用 silent 变体(内部已 toast + 标 persistenceError 并吞错),避免错误态写库再次失败时
    // 越过 catch 逃逸成未捕获 rejection、并跳过下面的 setDetailTaskId。
    updateTaskInStoreSilently(taskId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    })
    // 批量任务(batchId 存在)失败时逐个自动弹详情会互相打架,改由失败卡片的 error 态呈现;
    // 单任务保持原行为:失败即弹详情。
    if (!task.batchId) useStore.getState().setDetailTaskId(taskId)
  } finally {
    clearTaskAbortController(taskId)
    // 释放输入图片的内存缓存（已持久化到 IndexedDB，后续按需从 DB 加载）
    for (const imgId of task.inputImageIds) {
      deleteCachedImage(imgId)
    }
  }
}

export async function updateTaskInStore(taskId: string, patch: Partial<TaskRecord>): Promise<void> {
  const { tasks, setTasks } = useStore.getState()
  const updated = tasks.map((t) =>
    t.id === taskId ? { ...t, ...patch } : t,
  )
  setTasks(updated)
  const task = updated.find((t) => t.id === taskId)
  if (!task) return

  try {
    await putTask(task)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const state = useStore.getState()
    state.setTasks(state.tasks.map((item) =>
      item.id === taskId ? { ...item, persistenceError: message } : item,
    ))
    state.showToast(`保存任务失败：${message}`, 'error')
    throw err
  }
}

export function setTaskFavoriteCategory(taskId: string, categoryId: string): Promise<void> {
  return updateTaskInStore(taskId, {
    isFavorite: true,
    favoriteCategoryId: categoryId,
  })
}

export function clearTaskFavorite(taskId: string): Promise<void> {
  return updateTaskInStore(taskId, {
    isFavorite: false,
    favoriteCategoryId: null,
  })
}

export function getTaskSortKey(task: TaskRecord): number {
  return task.sortOrder ?? task.createdAt
}

/**
 * 将 taskId 移到 prevTaskId 与 nextTaskId 之间。任一邻居为 null 表示拖到最前/最后。
 * 常规走 gap-based 中点(仅写被拖动任务);中点逼近浮点精度时,对全量任务整数化重排自愈。
 */
export function reorderTask(
  taskId: string,
  prevTaskId: string | null,
  nextTaskId: string | null,
) {
  const { tasks, setTasks } = useStore.getState()
  const prev = prevTaskId ? tasks.find((t) => t.id === prevTaskId) : null
  const next = nextTaskId ? tasks.find((t) => t.id === nextTaskId) : null

  // 中点与邻居差逼近浮点精度(反复同隙插入耗尽精度):对「被拖动任务所属对话」子集整数化重排自愈,再放置被拖动项。
  // 只在同对话子集内重排,避免一次普通拖拽就重写并落库其它所有对话的 sortOrder(整表写放大);
  // 拖拽本就限定在无筛选/同对话视图,prev/next 也来自当前对话,故子集已足够。
  if (prev && next && Math.abs(getTaskSortKey(prev) - getTaskSortKey(next)) < SORT_EPSILON) {
    const dragged = tasks.find((t) => t.id === taskId)
    const scoped = dragged ? tasks.filter((t) => t.conversationId === dragged.conversationId) : tasks
    const orderedIds = [...scoped]
      .sort((a, b) => {
        const ka = getTaskSortKey(a)
        const kb = getTaskSortKey(b)
        if (ka !== kb) return kb - ka
        if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
        return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
      })
      .map((t) => t.id)
    const newOrders = computeReorderedSortOrders(orderedIds, taskId, prevTaskId, nextTaskId)
    const changed: TaskRecord[] = []
    const updated = tasks.map((t) => {
      const order = newOrders.get(t.id)
      if (order != null && order !== t.sortOrder) {
        const updatedTask = { ...t, sortOrder: order }
        changed.push(updatedTask)
        return updatedTask
      }
      return t
    })
    setTasks(updated)
    void Promise.all(changed.map((t) => putTask(t).catch(() => {})))
    return
  }

  let newSortOrder: number
  if (prev && next) {
    newSortOrder = (getTaskSortKey(prev) + getTaskSortKey(next)) / 2
  } else if (prev) {
    newSortOrder = getTaskSortKey(prev) - SORT_STEP
  } else if (next) {
    newSortOrder = getTaskSortKey(next) + SORT_STEP
  } else {
    return
  }

  updateTaskInStoreSilently(taskId, { sortOrder: newSortOrder })
}

/** 重试失败的任务：创建新任务并执行 */
export async function retryTask(task: TaskRecord) {
  // 网格 task 重试走补跑分支:结果回到矩阵原坐标(否则跑出矩阵成散图)。
  if (task.batchId && task.gridCoord) {
    retryGridCell(task.batchId, task.gridCoord)
    return
  }
  const { settings, activeConversationId } = useStore.getState()
  const activeProfile = getActiveApiProfile(settings)
  // 复用 enqueueTask 原语(含写失败回滚)。重试不继承 batchId:视为一次新的独立生成。
  const id = await enqueueTask({
    prompt: task.prompt,
    params: normalizeParamsForSettings(task.params, settings),
    apiProvider: activeProfile.provider,
    apiProfileName: activeProfile.name,
    apiModel: activeProfile.model,
    inputImageIds: [...task.inputImageIds],
    maskTargetImageId: task.maskTargetImageId ?? null,
    maskImageId: task.maskImageId ?? null,
    conversationId: task.conversationId ?? activeConversationId ?? ARCHIVE_CONVERSATION_ID,
  })
  if (id) executeTask(id)
}

/** 复用配置 */
export async function reuseConfig(task: TaskRecord) {
  const { settings, setPrompt, setParams, setInputImages, setMaskDraft, clearMaskDraft, showToast } = useStore.getState()
  setPrompt(task.prompt)
  setParams(normalizeParamsForSettings(task.params, settings))

  // 恢复输入图片
  const imgs: InputImage[] = []
  for (const imgId of task.inputImageIds) {
    const dataUrl = await ensureImageCached(imgId)
    if (dataUrl) {
      imgs.push({ id: imgId, dataUrl })
    }
  }
  setInputImages(imgs)
  const maskTargetImageId = task.maskTargetImageId ?? (task.maskImageId ? task.inputImageIds[0] : null)
  if (maskTargetImageId && task.maskImageId && imgs.some((img) => img.id === maskTargetImageId)) {
    const maskDataUrl = await ensureImageCached(task.maskImageId)
    if (maskDataUrl) {
      setMaskDraft({
        targetImageId: maskTargetImageId,
        maskDataUrl,
        updatedAt: Date.now(),
      })
    } else {
      clearMaskDraft()
    }
  } else {
    clearMaskDraft()
  }
  showToast('已复用配置到输入框', 'success')
}

/** 编辑输出：将输出图加入输入 */
export async function editOutputs(task: TaskRecord) {
  const { inputImages, addInputImage, showToast } = useStore.getState()
  if (!task.outputImages?.length) return

  let added = 0
  for (const imgId of task.outputImages) {
    if (inputImages.find((i) => i.id === imgId)) continue
    const dataUrl = await ensureImageCached(imgId)
    if (dataUrl) {
      addInputImage({ id: imgId, dataUrl })
      added++
    }
  }
  showToast(`已添加 ${added} 张输出图到输入`, 'success')
}

/** 删除多条任务 */
export async function removeMultipleTasks(taskIds: string[]) {
  const { tasks, setTasks, inputImages, showToast, selectedTaskIds } = useStore.getState()

  if (!taskIds.length) return

  const toDelete = new Set(taskIds)
  const remaining = tasks.filter(t => !toDelete.has(t.id))

  // 收集所有被删除任务的关联图片
  const deletedImageIds = new Set<string>()
  for (const t of tasks) {
    if (toDelete.has(t.id)) {
      if (t.status === 'running') terminateTaskRuntime(t.id)
      for (const id of t.inputImageIds || []) deletedImageIds.add(id)
      if (t.maskImageId) deletedImageIds.add(t.maskImageId)
      for (const id of t.outputImages || []) deletedImageIds.add(id)
    }
  }

  setTasks(remaining)
  for (const id of taskIds) {
    await dbDeleteTask(id)
  }

  // 找出其他任务仍引用的图片
  const stillUsed = new Set<string>()
  for (const t of remaining) {
    for (const id of t.inputImageIds || []) stillUsed.add(id)
    if (t.maskImageId) stillUsed.add(t.maskImageId)
    for (const id of t.outputImages || []) stillUsed.add(id)
  }
  for (const img of inputImages) stillUsed.add(img.id)

  // 删除孤立图片
  for (const imgId of deletedImageIds) {
    if (!stillUsed.has(imgId)) {
      await deleteImage(imgId)
      deleteCachedImage(imgId)
    }
  }

  // 如果删除的任务在选中列表中，则移除
  const newSelection = selectedTaskIds.filter(id => !toDelete.has(id))
  if (newSelection.length !== selectedTaskIds.length) {
    useStore.getState().setSelectedTaskIds(newSelection)
  }

  showToast(`已删除 ${taskIds.length} 条记录`, 'success')
}

/** 删除单条任务 */
export async function removeTask(task: TaskRecord) {
  const { tasks, setTasks, inputImages, showToast } = useStore.getState()

  // 删除在途任务前先中止请求并清 watchdog/controller,避免请求继续跑、watchdog 误报、控制器残留
  if (task.status === 'running') terminateTaskRuntime(task.id)

  // 收集此任务关联的图片
  const taskImageIds = new Set([
    ...(task.inputImageIds || []),
    ...(task.maskImageId ? [task.maskImageId] : []),
    ...(task.outputImages || []),
  ])

  // 从列表移除
  const remaining = tasks.filter((t) => t.id !== task.id)
  setTasks(remaining)
  await dbDeleteTask(task.id)

  // 找出其他任务仍引用的图片
  const stillUsed = new Set<string>()
  for (const t of remaining) {
    for (const id of t.inputImageIds || []) stillUsed.add(id)
    if (t.maskImageId) stillUsed.add(t.maskImageId)
    for (const id of t.outputImages || []) stillUsed.add(id)
  }
  for (const img of inputImages) stillUsed.add(img.id)

  // 删除孤立图片
  for (const imgId of taskImageIds) {
    if (!stillUsed.has(imgId)) {
      await deleteImage(imgId)
      deleteCachedImage(imgId)
    }
  }

  showToast('记录已删除', 'success')
}

/** 输入图片单文件大小上限;上传/拖放/粘贴最终都汇聚到 addImageFromFile,在此单点设限即覆盖三入口。 */
export const MAX_INPUT_IMAGE_BYTES = 50 * 1024 * 1024

/** 输入图片解码后总像素(宽×高)上限。仅限文件字节不够:高压缩比图可解码成上亿像素位图,缩略图/遮罩主图全尺寸解码时 OOM。 */
export const MAX_INPUT_IMAGE_PIXELS = 64 * 1024 * 1024 // 约 6400 万像素(8192×8192)

async function assertImagePixelLimit(dataUrl: string): Promise<void> {
  const { width, height } = await getImageDimensions(dataUrl)
  if (width * height > MAX_INPUT_IMAGE_PIXELS) {
    throw new Error(`图片分辨率过大:${width}×${height} 超过约 ${Math.round(MAX_INPUT_IMAGE_PIXELS / 1_000_000)} 百万像素上限`)
  }
}

/** 添加图片到输入（文件上传） */
export async function addImageFromFile(file: File): Promise<void> {
  if (!file.type.startsWith('image/')) return
  if (file.size > MAX_INPUT_IMAGE_BYTES) {
    throw new Error(`图片过大:超过 ${Math.round(MAX_INPUT_IMAGE_BYTES / 1024 / 1024)}MB 上限`)
  }
  const dataUrl = await fileToDataUrl(file)
  await assertImagePixelLimit(dataUrl)
  const id = await storeImage(dataUrl, 'upload')
  setCachedImage(id, dataUrl)
  useStore.getState().addInputImage({ id, dataUrl })
}

/** 添加图片到输入（右键菜单）—— 支持 data/blob/http URL */
export async function addImageFromUrl(src: string): Promise<void> {
  const res = await fetch(src)
  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) throw new Error('不是有效的图片')
  if (blob.size > MAX_INPUT_IMAGE_BYTES) {
    throw new Error(`图片过大:超过 ${Math.round(MAX_INPUT_IMAGE_BYTES / 1024 / 1024)}MB 上限`)
  }
  const dataUrl = await blobToDataUrl(blob)
  await assertImagePixelLimit(dataUrl)
  const id = await storeImage(dataUrl, 'upload')
  setCachedImage(id, dataUrl)
  useStore.getState().addInputImage({ id, dataUrl })
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
