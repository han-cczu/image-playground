/**
 * 启动初始化与启动期孤儿图 GC 调度(taskRuntime 拆分轮,见 shared.ts 头注释)。
 */
import { useStore } from '../../store'
import {
  getAllTasks,
  getTask,
  putTask,
  getImage,
  storedImageToDataUrl,
  getAllConversations,
  putConversation,
  persistConversationMigration,
} from '../db'
import { queryHeldTaskLeases, watchTaskLeaseRelease } from './lease'
import { getDataJobInProgress } from '../dataJobState'
import { getInFlightImageIds } from '../inFlightImages'
import { updateTaskInStore } from './persistence'
import { collectReferencedImageIds, pruneOrphanImages } from '../storageStats'
import { setCachedImage } from '../imageCache'
import {
  ARCHIVE_CONVERSATION_ID,
  CONVERSATION_MIGRATION_VERSION,
  createArchiveConversation,
  normalizeConversations,
  readConversationMigrationVersion,
  writeConversationMigrationVersion,
} from '../conversations'
import { reseedConversationsFromFavoriteCategories } from '../conversationMigration'
import { normalizeStoredTasks } from '../tasks'
import { registerTaskRuntimeTestReset } from './shared'
import {
  isRunningSyncHttpTask,
  markInterruptedSyncHttpTasks,
  SYNC_HTTP_INTERRUPTED_ERROR,
} from './watchdog'

/**
 * 租约释放后的兜底:持有者若是崩溃/关闭而非正常收尾,库里这条任务仍是 running 且再无人执行,
 * 这里把它补标为「请求中断」。依据必须取自库而不是内存——持有者正常完成时,它写 done 落库、
 * 释放锁、本页收到 storage 事件刷新三件事之间没有顺序保证,内存副本可能还停在 running。
 */
async function markOrphanedTaskInterrupted(taskId: string): Promise<void> {
  const latest = await getTask(taskId)
  if (!latest || !isRunningSyncHttpTask(latest)) {
    // 完成/删除通知可能早于本页初始化写 store。这里同步当前记录,避免最后停在旧 running 副本上。
    useStore.setState((state) => ({
      tasks: state.tasks.flatMap((task) =>
        task.id === taskId ? (latest ? [latest] : []) : [task],
      ),
    }))
    return
  }
  const now = Date.now()
  await updateTaskInStore(taskId, {
    status: 'error',
    error: SYNC_HTTP_INTERRUPTED_ERROR,
    finishedAt: now,
    elapsed: Math.max(0, now - latest.createdAt),
  })
}

let initStorePromise: Promise<void> | null = null

registerTaskRuntimeTestReset(() => {
  initStorePromise = null
  pendingStartupOrphanGc = null
  if (startupOrphanGcTimer !== null) {
    clearTimeout(startupOrphanGcTimer)
    startupOrphanGcTimer = null
  }
})

/**
 * 启动期孤儿图 GC 的调度与频控。
 *
 * 为什么不再在 initStore 里同步 await:游标扫全 images 表在大库(数千张图)上是每次冷启动的
 * IO 尖刺(2026-06-10 审查报告 C1 轮已知遗留),而孤儿本身只是「良性存储泄漏」——晚删一天
 * 没有任何用户可见后果。故改为:24h 频控(localStorage 时间戳) + 空闲期执行(requestIdleCallback,
 * Safari 无 rIC 时退化为固定延迟),把扫表挪出首屏关键路径。
 *
 * 误删侧的双层守卫不变、且都推迟到「真正执行的时刻」评估:
 *  1. 执行时重读 store 最新引用集(此刻 initStore 已写完 store,天然覆盖 init 窗口内新增的引用);
 *  2. pruneOrphanImages 只删 createdAt < initStartedAt 的图,放过本次启动之后写入的新图。
 * 最坏情况仍只是漏删(下个符合频控条件的启动补收),绝不误删在用图。
 */
export const ORPHAN_GC_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000
const ORPHAN_GC_LAST_RUN_KEY = 'image-playground.lastOrphanGcAt'
/** 无 requestIdleCallback 的环境(Safari)退化为固定延迟,避开首屏渲染与首批封面加载 */
const ORPHAN_GC_FALLBACK_DELAY_MS = 5_000
/** rIC 的兜底触发上限:页面长期无空闲帧时也要在此时限内跑到 */
const ORPHAN_GC_IDLE_TIMEOUT_MS = 30_000

let pendingStartupOrphanGc: (() => Promise<void>) | null = null
let startupOrphanGcTimer: ReturnType<typeof setTimeout> | null = null

function shouldRunStartupOrphanGc(now: number): boolean {
  try {
    const raw = localStorage.getItem(ORPHAN_GC_LAST_RUN_KEY)
    if (raw !== null) {
      const last = Number(raw)
      // 时间戳落在未来(时钟回拨/脏数据)视为无效:照常执行并在完成后覆写
      if (Number.isFinite(last) && last <= now && now - last < ORPHAN_GC_MIN_INTERVAL_MS)
        return false
    }
  } catch {
    /* localStorage 不可用(隐私模式等):退回每次启动执行,与旧行为一致 */
  }
  return true
}

function scheduleStartupOrphanGc(initStartedAt: number): void {
  if (!shouldRunStartupOrphanGc(initStartedAt)) return
  pendingStartupOrphanGc = async () => {
    // 导入/清空进行中就放弃本轮、也不盖频控戳:导入写图与任务落库不在一个事务,窗口里的图在引用集之外
    if (getDataJobInProgress()) return
    const latestState = useStore.getState()
    const referencedIds = collectReferencedImageIds(latestState.tasks, latestState.inputImages)
    // 在途图(已落库、任务记录尚未引用)同样不是孤儿
    for (const id of getInFlightImageIds()) referencedIds.add(id)
    await pruneOrphanImages(referencedIds, initStartedAt)
    try {
      localStorage.setItem(ORPHAN_GC_LAST_RUN_KEY, String(Date.now()))
    } catch {
      /* 写失败仅影响频控,不影响本次清理结果 */
    }
  }
  const kick = () => {
    const pending = pendingStartupOrphanGc
    pendingStartupOrphanGc = null
    startupOrphanGcTimer = null
    // GC 失败不再向上冒泡(旧实现会连累 initStore 走失败 banner):清理失败不该被当成「数据可能丢失」
    if (pending) void pending().catch((err) => console.error('孤儿图片清理失败:', err))
  }
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(kick, { timeout: ORPHAN_GC_IDLE_TIMEOUT_MS })
  } else {
    const timer = setTimeout(kick, ORPHAN_GC_FALLBACK_DELAY_MS)
    startupOrphanGcTimer = timer
    // node 测试环境下不阻塞进程退出;浏览器 setTimeout 返回 number,无 unref(DOM lib 类型如此,故经 unknown 探测)
    const maybeUnref = timer as unknown as { unref?: () => void }
    if (typeof maybeUnref?.unref === 'function') maybeUnref.unref()
  }
}

/** 仅测试用:绕过 idle 调度立即执行待运行的启动期孤儿 GC(无待运行任务时为 no-op) */
export async function __runPendingStartupOrphanGcForTests(): Promise<void> {
  const pending = pendingStartupOrphanGc
  pendingStartupOrphanGc = null
  if (startupOrphanGcTimer !== null) {
    clearTimeout(startupOrphanGcTimer)
    startupOrphanGcTimer = null
  }
  if (pending) await pending()
}

/** 初始化：加载 conversations → 跑迁移 → 加载 tasks → 激活默认对话 → 调度孤儿图清理 */
export async function initStore() {
  if (initStorePromise) return initStorePromise
  initStorePromise = initStoreOnce().finally(() => {
    initStorePromise = null
  })
  return initStorePromise
}

async function initStoreOnce() {
  // 启动时间戳:孤儿图清理只删早于此刻创建的图,放过 init 异步窗口里(另一标签)新写入的图。
  const initStartedAt = Date.now()
  /*
   * ========================================================================
   * 步骤1：加载 conversations 与原始 tasks
   * ========================================================================
   */
  // 1.1 conversations + tasks 各自 readonly 读取
  const [rawConversations, storedTaskRecords] = await Promise.all([
    getAllConversations(),
    getAllTasks(),
  ])
  // 自家库读取走不截断版本:这里的结果就是孤儿 GC 的引用集来源,少一条任务就多删一批在用图
  const storedTasks = normalizeStoredTasks(storedTaskRecords, initStartedAt)

  // 1.2 中断进行中的同步 HTTP 任务——但跳过仍被别的标签页持有租约的(它们不是孤儿,正在跑;
  // 不跳过就会把用户在 A 页的整批在途任务全部写成中断,再经跨标签页刷新中止 A 页的真实请求)。
  // 被跳过的挂一个租约释放观察者:持有者崩溃时由本页补标中断,不留幽灵 running。
  const heldLeases = await queryHeldTaskLeases()
  // 读到 running 后、查询租约前,持有者可能已完成落库并释放锁。无锁候选必须再读当前记录,
  // 否则旧快照会把成功结果覆写为 error,甚至复活已删除的任务。新任务在入库前已等待获锁。
  const checkedTasks = (
    await Promise.all(
      storedTasks.map((task) =>
        isRunningSyncHttpTask(task) && !heldLeases.has(task.id) ? getTask(task.id) : task,
      ),
    )
  ).filter((task) => task !== undefined)
  const {
    tasks: interruptedNormalizedTasks,
    interruptedTasks,
    skippedOwnedTasks,
  } = markInterruptedSyncHttpTasks(checkedTasks, initStartedAt, heldLeases)

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
  const hasOrphanTasks = interruptedNormalizedTasks.some((task) => !task.conversationId)
  const shouldRunReseed = migrationVersion < CONVERSATION_MIGRATION_VERSION || hasOrphanTasks

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
    const conversationsChanged =
      migratedConversations.length !== normalizedExistingConversations.length
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

  // 3.2 写入 store。tasks 不进 zustand-persist,此刻内存里只可能有 init 窗口内新提交的任务(用户在
  // 首屏读库的几百毫秒里就点了发送):按 id 合并而不是整体覆盖,否则它们从内存消失、完成时找不到记录丢结果。
  useStore.getState().setConversations(finalConversations)
  const snapshotTaskIds = new Set(finalTasks.map((task) => task.id))
  const memoryOnlyTasks = useStore.getState().tasks.filter((task) => !snapshotTaskIds.has(task.id))
  useStore
    .getState()
    .setTasks(memoryOnlyTasks.length ? [...memoryOnlyTasks, ...finalTasks] : finalTasks)

  // 必须在任务进 store 后挂观察者:锁可能已在初始化期间释放,回调会立即执行;提前挂会找不到记录,
  // 或把刚补标的终态再次被初始化快照覆盖。
  for (const owned of skippedOwnedTasks) {
    watchTaskLeaseRelease(owned.id, () =>
      markOrphanedTaskInterrupted(owned.id).catch((err) => console.error('补标孤儿任务失败:', err)),
    )
  }

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

  // 孤儿图清理移出关键路径:此刻 store 已写完,交给空闲期调度(引用集判定推迟到执行时刻,
  // 见 scheduleStartupOrphanGc 头注释;与孤儿 GC / 存储统计共用 collectReferencedImageIds 判定)
  scheduleStartupOrphanGc(initStartedAt)

  const persistedInputImages = useStore.getState().inputImages

  // 输入图片需要立即可用（用于显示在输入栏），仍然缓存这部分
  const restoredInputImages = (
    await Promise.all(
      persistedInputImages.map(async (img) => {
        if (img.dataUrl) return img
        const storedImage = await getImage(img.id)
        const dataUrl = storedImage ? await storedImageToDataUrl(storedImage).catch(() => '') : ''
        return { ...img, dataUrl: dataUrl ?? '' }
      }),
    )
  ).filter((img) => img.dataUrl)
  for (const img of restoredInputImages) {
    setCachedImage(img.id, img.dataUrl)
  }
  const latestInputImages = useStore.getState().inputImages
  const restoredById = new Map(restoredInputImages.map((img) => [img.id, img]))
  const persistedInputIds = new Set(persistedInputImages.map((img) => img.id))
  const nextInputImages = latestInputImages.flatMap((img) => {
    const restored = restoredById.get(img.id)
    if (restored) return [restored]
    if (persistedInputIds.has(img.id) && !img.dataUrl) return []
    return [img]
  })
  const changed =
    nextInputImages.length !== latestInputImages.length ||
    nextInputImages.some(
      (img, index) =>
        img.id !== latestInputImages[index]?.id ||
        img.dataUrl !== latestInputImages[index]?.dataUrl,
    )
  if (changed) {
    useStore.getState().setInputImages(nextInputImages)
  }

  // 请求持久化存储授权:未授权时整个源的 IndexedDB/localStorage 处于浏览器 best-effort 驱逐域,
  // Chromium/Firefox 磁盘压力下按 LRU 整源清空——对「数据全在本地」的应用这是地基级保护。
  // Chromium 不弹 UI(按互动启发式静默裁决)、Safari 自动裁决;唯独 Firefox 会弹授权框,
  // 启动时无用户手势就弹、且未授权前每次启动都弹——该场景跳过自动申请,留给存储面板的
  // 「申请持久化」按钮(用户手势内弹框是合理交互)。对 Safari ITP 的 7 天清除无效(仅添加
  // 主屏幕豁免)。fire-and-forget:失败不影响启动,授权状态由存储面板展示(storageStats.persisted)。
  void (async () => {
    try {
      if (typeof navigator === 'undefined' || !navigator.storage?.persist) return
      const isFirefox = /firefox/i.test(navigator.userAgent)
      if (isFirefox) {
        const status = await navigator.permissions
          ?.query?.({ name: 'persistent-storage' as PermissionName })
          .catch(() => null)
        // 已授权时 persist() 只是确认不弹框;'prompt' 状态会弹 → 跳过
        if (!status || status.state !== 'granted') return
      }
      await navigator.storage.persist()
    } catch {
      /* 授权失败/不支持不影响启动 */
    }
  })()
}
