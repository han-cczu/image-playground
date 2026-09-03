/**
 * 任务提交与执行主链路(taskRuntime 拆分轮,见 shared.ts 头注释):
 * enqueueTask 参数化提交原语 → runEnqueuedTasks 并发闸 → executeTask 请求执行,
 * 以及 submitTask 用户入口与 profile 固化解析(resolveExecutionProfile)。
 * enqueueTask / runEnqueuedTasks / prepareSubmission / executeTask 供 grid/actions
 * 模块复用,不经 index 对外导出。
 */
import type {
  ApiProfile,
  ApiProvider,
  GridAxis,
  AppSettings,
  TaskParams,
  TaskRecord,
} from '../../types'
import { useStore } from '../../store'
import { getActiveApiProfile, normalizeSettings, validateApiProfile } from '../api/apiProfiles'
import { putTask, putConversation, storeImage } from '../db'
import { callImageApi } from '../api'
import { buildFinalPrompt } from '../stylePresets'
import {
  countPromptExpansion,
  expandPromptTemplate,
  MAX_PROMPT_EXPANSION,
  MAX_PROMPT_EXPANSION_HARD,
} from '../promptExpand'
import { mapWithConcurrency } from '../concurrency'
import { validateMaskMatchesImage } from '../image/canvasImage'
import { orderInputImagesForMask } from '../image/mask'
import { getChangedParams, normalizeParamsForSettings } from '../api/paramCompatibility'
import { ensureImageCached, evictCachedImageDataUrl, setCachedImage } from '../imageCache'
import { ARCHIVE_CONVERSATION_ID, deriveConversationTitleFromPrompt } from '../conversations'
import { MAX_TASK_TEXT_LEN } from '../tasks'
import {
  clearPendingIndexedDbConversationWrite,
  clearPendingIndexedDbTaskWrite,
  markPendingIndexedDbConversationWrite,
  markPendingIndexedDbTaskWrite,
} from '../../store/idbSyncState'
import {
  genId,
  taskAbortControllers,
  clearSyncHttpWatchdogTimer,
  clearTaskAbortController,
  registerTaskRuntimeTestReset,
  sleepForRetryBackoff,
  terminateTaskRuntime,
} from './shared'
import { registerWatchdogTimeoutRetryArbiter, scheduleSyncHttpWatchdog } from './watchdog'
import { acquireTaskLease, releaseTaskLease } from './lease'
import { registerInFlightImages, releaseInFlightImages } from '../inFlightImages'
import { computeRetryDelayMs, getRetryAfterMs, isTransientTaskError } from './retryPolicy'
import {
  persistTaskSilently,
  rollbackStoredImagesSilently,
  updateTaskInStore,
  updateTaskInStoreSilently,
} from './persistence'
import { showCodexCliPrompt } from './codexCli'

function normalizeTaskRuntimeText(value: unknown): string {
  return (value instanceof Error ? value.message : String(value)).slice(0, MAX_TASK_TEXT_LEN)
}

export async function maybeUpdateConversationOnFirstTask(
  conversationId: string,
  newTask: TaskRecord,
) {
  const state = useStore.getState()
  const target = state.conversations.find((c) => c.id === conversationId)
  if (!target) return
  // archive 永远保持「历史记录」标题
  if (target.id === ARCHIVE_CONVERSATION_ID) return

  // 判断是否为该对话首条 task(除新建的这一条与同批兄弟:通配/XY 网格一次入队多条,首条回填时
  // 兄弟已在 store 里,若把它们当「先前任务」,新对话标题永远停留在「新对话」)
  const hadPriorTask = state.tasks.some(
    (task) =>
      task.id !== newTask.id &&
      task.conversationId === conversationId &&
      (!newTask.batchId || task.batchId !== newTask.batchId),
  )
  const isFirstTask = !hadPriorTask
  const isUnnamed = !target.title || target.title === '新对话'

  const nextTitle =
    isFirstTask && isUnnamed ? deriveConversationTitleFromPrompt(newTask.prompt) : target.title
  const updated = {
    ...target,
    title: nextTitle,
    updatedAt: newTask.createdAt,
  }
  // 登记在途写入(总账见 idbSyncState.ts):落盘前的跨标签页刷新不得把回填的标题/updatedAt 打回旧值
  markPendingIndexedDbConversationWrite(conversationId)
  useStore
    .getState()
    .setConversations(state.conversations.map((c) => (c.id === conversationId ? updated : c)))
  try {
    await putConversation(updated)
  } catch {
    /* 持久化失败不阻塞 UI；下次 submit 会再次尝试更新 */
  } finally {
    clearPendingIndexedDbConversationWrite(conversationId)
  }
}

/** 参数化提交原语：构造一条 TaskRecord、落库（失败回滚内存态）、返回 taskId（失败返回 null）。 */
export interface EnqueueTaskSpec {
  /** 已展开的具体 prompt（用户原文，不含风格前缀；风格仍在 executeTask 内拼接） */
  prompt: string
  /** 已归一化的参数 */
  params: TaskParams
  apiProvider: ApiProvider
  apiProfileId: string
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
export async function enqueueTask(spec: EnqueueTaskSpec): Promise<string | null> {
  const taskId = genId()
  const task: TaskRecord = {
    id: taskId,
    prompt: spec.prompt,
    params: spec.params,
    apiProvider: spec.apiProvider,
    apiProfileId: spec.apiProfileId,
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
  markPendingIndexedDbTaskWrite(taskId)
  // 租约必须先于 running 落库:别的标签页一旦在库里看到 running,就要能查到本页持锁,否则其 initStore
  // 会把这条正在跑的任务当孤儿翻成「请求中断」(见 lease.ts 头注释)。executeTask 收尾统一释放。
  acquireTaskLease(taskId)
  try {
    await putTask(task)
  } catch (err) {
    // 持久化失败:回滚内存里这条 running 任务,否则会留下无请求 / 无 watchdog 的「幽灵 running」卡片;
    // 调用方多为 fire-and-forget,reject 会逃逸成未捕获 rejection。
    const message = err instanceof Error ? err.message : String(err)
    const state = useStore.getState()
    state.setTasks(state.tasks.filter((t) => t.id !== taskId))
    state.showToast(`保存任务失败：${message}`, 'error')
    releaseTaskLease(taskId)
    return null
  } finally {
    clearPendingIndexedDbTaskWrite(taskId)
  }
  return taskId
}

/**
 * 以并发上限调度一批已落库 task 的 executeTask。每个 task 的成功/失败/取消已由 executeTask
 * 内部完整收口（落 done/error 态、watchdog、孤儿回滚），故调度器不让单个失败中断整批、也不抛错。
 * 并发上限默认读 settings.batchConcurrency(normalizeSettings 已 clamp 到 1~6,读取处信任);
 * mapWithConcurrency 开闸即固定 worker 数,改设置仅对新批次生效。
 */
export async function runEnqueuedTasks(taskIds: string[], limit?: number): Promise<void> {
  const effective = limit ?? useStore.getState().settings.batchConcurrency
  try {
    await mapWithConcurrency(taskIds, effective, (id) => executeTask(id))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const error = `批量调度失败：${message}`
    const taskIdSet = new Set(taskIds)
    const now = Date.now()
    const failedTasks: TaskRecord[] = []
    const nextTasks = useStore.getState().tasks.map((task) => {
      if (taskIdSet.has(task.id) && task.status === 'running') {
        const failedTask: TaskRecord = {
          ...task,
          status: 'error',
          error,
          finishedAt: now,
          elapsed: Math.max(0, now - task.createdAt),
        }
        failedTasks.push(failedTask)
        return failedTask
      }
      return task
    })
    useStore.getState().setTasks(nextTasks)
    useStore.getState().showToast(error, 'error')
    await Promise.all(failedTasks.map((task) => persistTaskSilently(task)))
  }
}

export interface PreparedSubmission {
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
export async function prepareSubmission(
  options: { allowFullMask?: boolean },
  onFullMaskRetry: () => void,
): Promise<PreparedSubmission | null> {
  const { settings, inputImages, maskDraft, params, setConfirmDialog } = useStore.getState()

  let orderedInputImages = inputImages
  let maskImageId: string | null = null
  let maskTargetImageId: string | null = null

  if (maskDraft) {
    try {
      orderedInputImages = orderInputImagesForMask(inputImages, maskDraft.targetImageId)
      const coverage = await validateMaskMatchesImage(
        maskDraft.maskDataUrl,
        orderedInputImages[0].dataUrl,
      )
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
      // 已落库、尚未进任何任务记录:登记为在途,否则这段窗口里跑的孤儿 GC / 手动清理会把它删掉
      registerInFlightImages(SUBMISSION_OWNER, [maskImageId])
      setCachedImage(maskImageId, maskDraft.maskDataUrl)
      maskTargetImageId = maskDraft.targetImageId
    } catch (err) {
      if (!inputImages.some((img) => img.id === maskDraft.targetImageId)) {
        useStore.getState().clearMaskDraft()
      }
      useStore.getState().showToast(err instanceof Error ? err.message : String(err), 'error')
      return null
    }
  }

  // 持久化输入图片到 IndexedDB（此前只在内存缓存中）
  const storedInputImageIds: string[] = []
  try {
    for (const img of orderedInputImages) {
      const storedId = await storeImage(img.dataUrl)
      registerInFlightImages(SUBMISSION_OWNER, [storedId])
      storedInputImageIds.push(storedId)
    }
  } catch (err) {
    await rollbackStoredImagesSilently(
      [...storedInputImageIds, ...(maskImageId ? [maskImageId] : [])],
      SUBMISSION_OWNER,
    )
    useStore
      .getState()
      .showToast(`保存输入图片失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    return null
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
let submissionInFlight = false
/** prepareSubmission 落库的遮罩/输入图的在途 owner;提交互斥保证同一时刻只有一个提交会话 */
const SUBMISSION_OWNER = 'submission'
registerTaskRuntimeTestReset(() => {
  submissionInFlight = false
})

/**
 * 提交互斥:submitTask / submitGridTask 从校验到全部入队之间有多个 await(遮罩落库、输入图哈希去重、
 * 逐条 putTask),这段窗口里再点发送 / 连按 Ctrl+Enter 会把完整流程再跑一遍——同一提示词入队两次、
 * 各自调用付费 API。窗口内的重入直接忽略(不 toast:连点本就是无意的)。
 * 确认弹窗路径不受影响:弹窗弹出时首次调用已经返回、互斥已释放,用户点「继续」再次进入是新的一轮。
 * 在途态同步到 ui.submitting 供 InputBar 禁用按钮 / 快捷键。
 */
export async function runExclusiveSubmission(run: () => Promise<void>): Promise<void> {
  if (submissionInFlight) return
  submissionInFlight = true
  useStore.getState().setSubmitting(true)
  try {
    await run()
  } finally {
    submissionInFlight = false
    // 提交会话结束:遮罩/输入图要么已被入队的任务记录引用、要么已回滚
    releaseInFlightImages(SUBMISSION_OWNER)
    useStore.getState().setSubmitting(false)
  }
}

export function submitTask(
  options: { allowFullMask?: boolean; allowLargeBatch?: boolean } = {},
): Promise<void> {
  return runExclusiveSubmission(() => submitTaskInner(options))
}

async function submitTaskInner(options: { allowFullMask?: boolean; allowLargeBatch?: boolean }) {
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
    const previewParams = normalizeParamsForSettings(params, settings)
    const totalImages = expansionCount * previewParams.n
    setConfirmDialog({
      title: '批量生成确认',
      message:
        previewParams.n > 1
          ? `检测到提示词通配，将展开为 ${expansionCount} 条提示词，每条 ${previewParams.n} 张，共 ${totalImages} 张图片。是否继续？`
          : `检测到提示词通配，将展开为 ${expansionCount} 条提示词（共 ${expansionCount} 张图片）。是否继续？`,
      confirmText: '继续生成',
      tone: 'warning',
      action: () => {
        return submitTask({ ...options, allowLargeBatch: true })
      },
    })
    return
  }

  const prepared = await prepareSubmission(options, () => {
    // 保留其它确认标志(如 allowLargeBatch),避免大批量 + 整图遮罩双确认互相丢标志形成弹窗循环。
    return submitTask({ ...options, allowFullMask: true })
  })
  if (!prepared) return
  const { normalizedParams, inputImageIds, maskImageId, maskTargetImageId, activeConversationId } =
    prepared

  // 通配展开:无通配时为 [trimmedPrompt] 原样(与重构前单条路径严格等价)。
  const prompts = expandPromptTemplate(trimmedPrompt)
  const batchId = prompts.length > 1 ? genId() : undefined
  if (prompts.length > 1) {
    // 提交前预告本批将生成的总图片数(展开数 × n),让用户对「一条提示词变多条」有知情(对齐 spec §6)。
    useStore
      .getState()
      .showToast(
        `通配将生成 ${prompts.length} 条提示词、共 ${prompts.length * normalizedParams.n} 张图片`,
        'success',
      )
  }
  const taskIds: string[] = []
  for (const expandedPrompt of prompts) {
    const id = await enqueueTask({
      prompt: expandedPrompt,
      params: normalizedParams,
      apiProvider: activeProfile.provider,
      apiProfileId: activeProfile.id,
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

/**
 * 执行时把请求绑定回任务入队时固化的 profile / 模型,而不是「被并发闸取出那一刻的 active profile」。
 * 批量/网格任务可在队列里排数分钟,期间切 profile / 改模型会让剩余成员静默换供应商执行,
 * 而卡片/对比视图/对照导出展示的仍是入队元数据——对照实验样本被污染且事后不可检测。
 * 解析规则(导出仅为单测):
 * - 旧记录无 apiProfileId 也无 apiProfileName → 沿用 active profile(原行为);
 * - 有 apiProfileId → 按 id 精确解析(显示名可重复——新建默认恒为「新配置」且无唯一性约束,
 *   按名匹配会在重名场景把任务静默投到另一个同名 profile 的 baseUrl/apiKey 上);
 * - 仅有 apiProfileName 的旧记录 → 按名解析,命中多个同名时返回 null(无法确定入队目标,不猜);
 * - 查不到 / provider 已变 → 返回 null,调用方落 error(宁可失败也不静默换供应商)。
 * 解析回 active profile 本身时沿用 getActiveApiProfile 结果(保留顶层镜像字段语义)。
 * 模型固定为 task.apiModel(同一 profile 内改模型同样构成漂移)。
 */
export function resolveExecutionProfile(
  settings: AppSettings,
  task: TaskRecord,
): { profile: ApiProfile; isActive: boolean } | null {
  const active = getActiveApiProfile(settings)
  if (!task.apiProfileId && !task.apiProfileName) return { profile: active, isActive: true }

  const profiles = normalizeSettings(settings).profiles
  let base: ApiProfile | null
  if (task.apiProfileId) {
    base = profiles.find((p) => p.id === task.apiProfileId) ?? null
  } else {
    const matches = profiles.filter((p) => p.name === task.apiProfileName)
    base = matches.length === 1 ? matches[0] : null
  }
  if (!base) return null
  if (task.apiProvider && base.provider !== task.apiProvider) return null

  const isActive = base.id === active.id
  const resolved = isActive ? active : base
  const model = task.apiModel?.trim() ? task.apiModel : resolved.model
  return { profile: model === resolved.model ? resolved : { ...resolved, model }, isActive }
}

// ===== 自动重试(spec: docs/superpowers/specs/2026-08-31-auto-retry-design.md) =====

/** 运行期重试进度(仅本模块;watchdog 经注册制回调读取,不反向依赖本模块) */
interface RetryProgress {
  /** 已用掉的重试次数(0 = 首次尝试进行中) */
  retriesUsed: number
  /** 入口快照的最大重试次数 */
  max: number
  /**
   * 本次 attempt 所处阶段:load = 输入图/遮罩加载(IDB 读),request = 请求已发起。
   * 仲裁器只在 request 阶段允许超时接管——加载阶段的 await 不观察 signal,abort 对它无效。
   */
  phase: 'load' | 'request'
}
const retryProgressByTask = new Map<string, RetryProgress>()
/** watchdog 超时接管标记:置位后本次 attempt 的 AbortError 应判为「超时(可重试)」而非「用户取消」 */
const timeoutRetryFlags = new Set<string>()

registerWatchdogTimeoutRetryArbiter((taskId) => {
  const progress = retryProgressByTask.get(taskId)
  const retriesUsed = progress?.retriesUsed ?? 0
  // 尝试耗尽/未在执行循环内:交回 watchdog 兜底直落(retriesUsed 供其拼接文案后缀)。
  // 兜底不能挪进循环:循环靠请求 reject 推进,不响应 abort 的挂死请求只有直落能终结。
  if (!progress || progress.retriesUsed >= progress.max) return { kind: 'fail', retriesUsed }
  // 仍在输入图加载阶段:一律直落,不接管。接管的全部前提是「abort 能让本次 attempt reject 回到循环」,
  // 而 ensureImageCached 的 IDB 读不接收 signal;IDB 挂起时接管 = 清掉 watchdog 后再无人看护,
  // 任务永久 running、无 toast 无 error,批量场景该 worker 槽位也随之死占(自动重试轮曾出过此回归)。
  // 加载阶段也没发过请求,重试本身无收益(重试拿到的仍是同一个挂起的 inFlight load)。
  if (progress.phase !== 'request') return { kind: 'fail', retriesUsed }
  const task = useStore.getState().tasks.find((t) => t.id === taskId)
  if (!task || task.status !== 'running') return { kind: 'fail', retriesUsed }
  timeoutRetryFlags.add(taskId)
  // 中止在途请求:fetch 以 AbortError 拒绝进入 attempt 的 catch,循环凭标记识别为超时重试。
  // 注意必须在置标记之后 terminate(先 abort 会让 catch 抢在标记前消费)。
  terminateTaskRuntime(taskId)
  return { kind: 'takeover' }
})

registerTaskRuntimeTestReset(() => {
  retryProgressByTask.clear()
  timeoutRetryFlags.clear()
})

type AttemptOutcome =
  /** 成功落 done */
  | { kind: 'completed' }
  /** 任务已被取消/删除(status 守卫命中),善后已完成,循环直接退出 */
  | { kind: 'settled' }
  | { kind: 'failed'; err: unknown }

export async function executeTask(taskId: string) {
  try {
    await executeTaskInner(taskId)
  } finally {
    // 任务在这里落定(done / error / 早退),租约随之释放;取消/删除路径由 terminateTaskRuntime 释放。
    releaseTaskLease(taskId)
    // 输出图要么已写进任务记录、要么已回滚,在途登记到此为止
    releaseInFlightImages(taskId)
  }
}

async function executeTaskInner(taskId: string) {
  const { settings } = useStore.getState()
  const task = useStore.getState().tasks.find((t) => t.id === taskId)
  if (!task) return
  // 状态守卫(批次取消的「排队跳过」机制):排队成员被 cancelBatch 翻 error 后,并发闸 worker
  // 取出时在建 controller / 起 watchdog / 发请求之前直接早退,不空打配额。
  // 安全性:enqueueTask 恒写 'running',所有新建/补跑路径取出执行瞬间必是 running,不误伤。
  if (task.status !== 'running') return
  const resolved = resolveExecutionProfile(settings, task)
  if (!resolved) {
    updateTaskInStoreSilently(taskId, {
      status: 'error',
      error: `提交时使用的 API Profile「${task.apiProfileName ?? ''}」已被删除、无法唯一定位或已切换 Provider，请基于当前配置重新提交`,
      finishedAt: Date.now(),
      elapsed: Math.max(0, Date.now() - task.createdAt),
    })
    return
  }
  const { profile: executionProfile, isActive: executingOnActiveProfile } = resolved
  const taskProvider = task.apiProvider ?? executionProfile.provider
  // 入口快照(与 batchConcurrency 同口径):normalizeSettings 已 clamp 到 0~3,读取处信任;
  // 改设置对在途任务不生效。
  const maxAutoRetries = settings.autoRetryMax

  try {
    for (let retriesUsed = 0; ; retriesUsed++) {
      // 每轮从 load 阶段起算,attemptTask 在请求发起前翻到 request
      retryProgressByTask.set(taskId, { retriesUsed, max: maxAutoRetries, phase: 'load' })
      const outcome = await attemptTask(
        taskId,
        task,
        settings,
        executionProfile,
        executingOnActiveProfile,
        taskProvider,
      )
      // 标记按 attempt 消费:无论本轮结局如何都取走,避免陈旧标记污染下一轮判定
      const hadTimeoutRetryFlag = timeoutRetryFlags.delete(taskId)
      if (outcome.kind !== 'failed') return

      // 任务可能在请求进行中被删除/取消:find 不到或已非 running 时直接退出,不要复活已删任务。
      const latestAfterFail = useStore.getState().tasks.find((t) => t.id === taskId)
      if (!latestAfterFail || latestAfterFail.status !== 'running') return

      const transient = isTransientTaskError(outcome.err, hadTimeoutRetryFlag)
      if (!transient || retriesUsed >= maxAutoRetries) {
        failTaskWithError(taskId, task, outcome.err, retriesUsed)
        return
      }

      const attempt = retriesUsed + 1
      const delayMs = computeRetryDelayMs(attempt, getRetryAfterMs(outcome.err))
      useStore.getState().setTaskRetryInfo(taskId, {
        attempt,
        maxAttempts: maxAutoRetries,
        nextRetryAt: Date.now() + delayMs,
      })
      // 可唤醒睡眠:取消/删除路径经 terminateTaskRuntime 立即唤醒,醒来后由 status 守卫退出,
      // 不会让并发闸 worker 槽位死等退避到期(退避期间占槽本身是刻意的 429 背压,见 spec D3)。
      await sleepForRetryBackoff(taskId, delayMs)
      useStore.getState().setTaskRetryInfo(taskId, null)
      const awake = useStore.getState().tasks.find((t) => t.id === taskId)
      if (!awake || awake.status !== 'running') return
    }
  } finally {
    retryProgressByTask.delete(taskId)
    timeoutRetryFlags.delete(taskId)
    useStore.getState().setTaskRetryInfo(taskId, null)
    // 释放输入图片的内存缓存（已持久化到 IndexedDB，后续按需从 DB 加载）
    for (const imgId of task.inputImageIds) {
      evictCachedImageDataUrl(imgId)
    }
  }
}

/** 终态落 error(文案追加自动重试次数便于事后判读)。调用方已确认任务仍是 running。 */
function failTaskWithError(taskId: string, task: TaskRecord, err: unknown, retriesUsed: number) {
  // L7:用 silent 变体(内部已 toast + 标 persistenceError 并吞错),避免错误态写库再次失败时
  // 越过 catch 逃逸成未捕获 rejection、并跳过下面的 setDetailTaskId。
  const finishedAt = Date.now()
  const baseError = normalizeTaskRuntimeText(err)
  updateTaskInStoreSilently(taskId, {
    status: 'error',
    error: retriesUsed > 0 ? `${baseError}(已自动重试 ${retriesUsed} 次)` : baseError,
    finishedAt,
    elapsed: Math.max(0, finishedAt - task.createdAt),
  })
  // 批量任务(batchId 存在)失败时逐个自动弹详情会互相打架,改由失败卡片的 error 态呈现;
  // 单任务保持原行为:失败即弹详情。
  if (!task.batchId) useStore.getState().setDetailTaskId(taskId)
}

/** 单次请求尝试:controller/watchdog 建立 → 输入图加载 → 请求 → 成功落态。失败只报告不落态(命运归 executeTask 循环)。 */
async function attemptTask(
  taskId: string,
  task: TaskRecord,
  settings: AppSettings,
  executionProfile: ApiProfile,
  executingOnActiveProfile: boolean,
  taskProvider: ApiProvider,
): Promise<AttemptOutcome> {
  if (taskProvider === 'openai' || taskProvider === 'gemini') {
    taskAbortControllers.set(taskId, new AbortController())
    // 先以完整预算守住输入图加载阶段(IDB 读挂起时任务不会永久卡 running):此阶段超时由仲裁器
    // 按 phase='load' 交回 watchdog 直落,不进自动重试(见仲裁器注释);
    // 请求发起前会再重置一次,网络阶段同样拿到完整预算。
    scheduleSyncHttpWatchdog(taskId, executionProfile.timeout)
  }
  // 取消/删除在途任务会 abort 控制器并把它移出 map(terminateTaskRuntime)。先把 signal 取到局部:
  // 即便随后控制器被移出 map,这个 detached signal 仍能让下游 fetch 观察到 aborted=true 而真正中止;
  // 否则在输入图 await 窗口内取消时,callImageApi 再从 map 读会拿到 undefined,请求跑到 provider timeout 才停。
  const requestSignal = taskAbortControllers.get(taskId)?.signal
  const outputIds: string[] = []

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

    // 进入请求阶段:从这里起超时才允许被重试接管(fetch 响应 abort,attempt 必定 reject 回到循环)。
    // 必须在下面重置 watchdog 之前翻转,否则新定时器到期时仲裁器仍按 load 阶段直落。
    const progress = retryProgressByTask.get(taskId)
    if (progress) retryProgressByTask.set(taskId, { ...progress, phase: 'request' })

    // 请求真正发起前重置 watchdog:输入图加载耗时不再蚕食网络阶段预算(批量大图场景)。
    if (taskProvider === 'openai' || taskProvider === 'gemini') {
      scheduleSyncHttpWatchdog(taskId, executionProfile.timeout)
    }

    const result = await callImageApi(
      {
        settings,
        prompt: finalPrompt,
        params: task.params,
        inputImageDataUrls: inputDataUrls,
        maskDataUrl,
        signal: requestSignal,
      },
      executionProfile,
    )

    // 响应已返回,立即解除 watchdog:后续 SHA-256/IDB 写图窗口不再可能把已成功的生成
    // 误翻「请求超时」并触发 rollbackStoredImages 删掉刚存的输出图(配额已消耗、结果却被销毁)。
    clearSyncHttpWatchdogTimer(taskId)

    const latestBeforeSuccess = useStore.getState().tasks.find((t) => t.id === taskId)
    if (!latestBeforeSuccess || latestBeforeSuccess.status !== 'running') return { kind: 'settled' }

    // 存储输出图片
    for (const dataUrl of result.images) {
      const imgId = await storeImage(dataUrl, 'generated')
      // 落库到写进任务记录之间登记为在途(executeTask 收尾注销):GC / 清理 / 兄弟任务的回滚都不得碰它
      registerInFlightImages(taskId, [imgId])
      setCachedImage(imgId, dataUrl)
      outputIds.push(imgId)
    }
    const actualParamsByImage = result.actualParamsList?.reduce<
      Record<string, Partial<TaskParams>>
    >((acc, params, index) => {
      const imgId = outputIds[index]
      if (imgId && params && Object.keys(params).length > 0) acc[imgId] = params
      return acc
    }, {})
    const revisedPromptByImage = result.revisedPrompts?.reduce<Record<string, string>>(
      (acc, revisedPrompt, index) => {
        const imgId = outputIds[index]
        if (imgId && revisedPrompt && revisedPrompt.trim()) acc[imgId] = revisedPrompt
        return acc
      },
      {},
    )
    const promptWasRevised = result.revisedPrompts?.some(
      (revisedPrompt) => revisedPrompt?.trim() && revisedPrompt.trim() !== finalPrompt.trim(),
    )
    const hasRevisedPromptValue = result.revisedPrompts?.some((revisedPrompt) =>
      revisedPrompt?.trim(),
    )
    // codexCli 提示引导的是 active profile 的设置,执行 profile 与 active 不一致(排队期间切走)时不提示
    if (
      executingOnActiveProfile &&
      taskProvider === 'openai' &&
      executionProfile.provider === 'openai' &&
      !executionProfile.codexCli
    ) {
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
      await rollbackStoredImagesSilently(outputIds, taskId)
      return { kind: 'settled' }
    }
    const finishedAt = Date.now()
    await updateTaskInStore(taskId, {
      outputImages: outputIds,
      actualParams: { ...result.actualParams, n: outputIds.length },
      actualParamsByImage:
        actualParamsByImage && Object.keys(actualParamsByImage).length > 0
          ? actualParamsByImage
          : undefined,
      revisedPromptByImage:
        revisedPromptByImage && Object.keys(revisedPromptByImage).length > 0
          ? revisedPromptByImage
          : undefined,
      partialFailureCount: result.partialFailureCount,
      partialFailureMessage:
        typeof result.partialFailureMessage === 'string'
          ? result.partialFailureMessage.slice(0, MAX_TASK_TEXT_LEN)
          : undefined,
      status: 'done',
      finishedAt,
      elapsed: Math.max(0, finishedAt - task.createdAt),
    })

    if (result.partialFailureCount) {
      useStore
        .getState()
        .showToast(
          `部分完成：成功 ${outputIds.length} 张，失败 ${result.partialFailureCount} 个请求`,
          'error',
        )
    } else {
      useStore.getState().showToast(`生成完成，共 ${outputIds.length} 张图片`, 'success')
    }
    const { maskDraft: currentMask, maskEditorImageId } = useStore.getState()
    if (
      maskDataUrl &&
      currentMask &&
      currentMask.targetImageId === task.maskTargetImageId &&
      currentMask.maskDataUrl === maskDataUrl &&
      // 遮罩编辑器开着就不动:clearMaskDraft 会连带置空 maskEditorImageId,等于在用户涂抹到一半时
      // 把编辑器整个卸掉、未保存的笔画全部丢失(保存中则被静默回滚)。留着这份「已消费」草稿无害——
      // 用户保存会覆盖它、关闭不保存则维持提交前的状态,与任务完成前的体验一致。
      maskEditorImageId === null
    ) {
      useStore.getState().clearMaskDraft()
    }
    return { kind: 'completed' }
  } catch (err) {
    clearSyncHttpWatchdogTimer(taskId)
    await rollbackStoredImagesSilently(outputIds, taskId)
    // 落不落 error、重不重试由 executeTask 循环统一裁决(任务命运单一所有权)
    return { kind: 'failed', err }
  } finally {
    clearTaskAbortController(taskId)
  }
}
