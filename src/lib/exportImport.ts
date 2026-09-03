import {
  zip,
  strToU8,
  strFromU8,
  Unzip,
  UnzipPassThrough,
  AsyncUnzipInflate,
  type Zippable,
  type Unzipped,
} from 'fflate'
import { getDataJobInProgress, setDataJobInProgress, type DataJob } from './dataJobState'
import type {
  AppSettings,
  Conversation,
  ExportData,
  InputImage,
  StoredImage,
  TaskRecord,
} from '../types'
import { DEFAULT_PARAMS } from '../types'
import { useStore } from '../store'
import { mergeImportedSettings, DEFAULT_SETTINGS, normalizeSettings } from './api/apiProfiles'
import {
  createDefaultFavoriteCategory,
  mergeFavoriteCategories,
  normalizeFavoriteCategories,
} from './favoriteCategories'
import { mergeSnippets, normalizeSnippets } from './promptSnippets'
import { mergeBatchNotes, normalizeBatchNotes } from './gridSheet'
import {
  getAllTasks,
  clearTasks as dbClearTasks,
  getAllImages,
  putImage,
  clearImages,
  blobToDataUrl,
  storedImageToBytes,
  getAllConversations,
  persistConversationMigration,
  clearConversations as dbClearConversations,
} from './db'
import { clearImageCache } from './imageCache'
import {
  ARCHIVE_CONVERSATION_ID,
  createArchiveConversation,
  normalizeConversations,
} from './conversations'
import { reseedConversationsFromFavoriteCategories } from './conversationMigration'
import {
  MAX_INPUT_IMAGES_PER_SUBMISSION,
  MAX_TASK_TEXT_LEN,
  normalizeTaskParams,
  normalizeTasks,
} from './tasks'
import {
  SYNC_HTTP_INTERRUPTED_ERROR,
  createCancelledTask,
  rollbackStoredImages,
  terminateRunningTaskRuntimes,
} from './taskRuntime'
import { collectReferencedImageIds } from './storageStats'

export type ImportMode = 'merge' | 'replace'

interface ImportDataOptions {
  mode?: ImportMode
}

/** 导入 ZIP 文件总大小上限:解压会把全部条目一次性放进内存,无上限时 zip bomb / 超大备份可 OOM。 */
const MAX_IMPORT_FILE_BYTES = 400 * 1024 * 1024
const MAX_IMPORT_ENTRY_BYTES = MAX_IMPORT_FILE_BYTES

/**
 * fflate 异步 zip/unzip 的 Promise 封装。准确口径(审查修正):
 * - fflate 没有 worker「池」——每个 ≥160KB 的 level>0 条目各 spawn 一个独立 Worker 且无并发上限,
 *   还会把 buffer postMessage 克隆一份。因此图片条目必须 per-file level 0(见 exportData):
 *   PNG/JPEG/WebP 已压缩,level 6 再压收益≈0,level 0 走同步直存,不建 worker、不复制、导入侧解压
 *   也退化为纯内存 slice——大库导出的 worker 风暴与 3-4 倍内存峰值由此消除,主线程重活只剩 CRC32。
 * - 仅 manifest.json(level 6,可能 ≥160KB)会进 worker;worker 从 blob URL 创建,
 *   CSP 需 worker-src blob:(各部署配置已同步放行)。
 * - worker 本体加载失败(如部署漏配 CSP)时 fflate 的回调永不触发,必须配 watchdog:
 *   超时 terminate 并 reject,否则防重入锁与忙碌态会永久卡死且无任何提示。
 */
const WORKER_WATCHDOG_MS = 120_000
const ZIP_MTIME_MIN_MS = Date.UTC(1980, 0, 1)
const ZIP_MTIME_MAX_MS = Date.UTC(2099, 11, 31, 23, 59, 59)

function toZipMtime(timestamp: number): Date {
  if (!Number.isFinite(timestamp)) return new Date(ZIP_MTIME_MIN_MS)
  return new Date(Math.min(ZIP_MTIME_MAX_MS, Math.max(ZIP_MTIME_MIN_MS, timestamp)))
}

function zipAsync(files: Zippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const finish = (cb: () => void) => {
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      cb()
    }
    const terminator = zip(files, { level: 6 }, (err, data) =>
      err ? finish(() => reject(err)) : finish(() => resolve(data)),
    )
    if (!settled) {
      timer = setTimeout(() => {
        terminator()
        reject(new Error('压缩超时:worker 可能创建失败,请检查部署的 CSP 是否放行 worker-src blob:'))
      }, WORKER_WATCHDOG_MS)
    }
  })
}

function isImportImageEntryName(name: string): boolean {
  return /^images\/[^/]+\.(png|jpg|jpeg|webp|svg|gif|avif)$/.test(name)
}

/** 仅测试可传:生产调用一律走默认预算。 */
interface UnzipBudget {
  entryBytes: number
  totalBytes: number
}

/**
 * 流式解压导入包,并按「实际解压出的字节」设预算(2026-06-10 审查遗留 low:zip 炸弹解压态上限)。
 *
 * 为什么弃用高层 unzip() + filter:filter 只能读 zip header 的**声明**尺寸(originalSize),
 * 而声明值可伪造——恶意 zip 声明 1KB、DEFLATE 流实际膨胀出数 GB,filter 全数放行后在解压期
 * OOM。流式 Unzip 在 ondata 逐块计数,任一条目或累计总量超限立即 terminate 全部流并整体报错
 * (声明与实际不符 = 损坏或恶意输入,不做静默跳过)。
 *
 * 与旧行为保持一致的部分:
 * - 条目名过滤(仅 manifest.json 与 images/*)与「声明尺寸超限 → 静默跳过该条目」的宽容语义
 *   照旧(诚实的超大备份图跳过后 import 侧照常报「N 张图片缺失」);流式读的是 local header
 *   的声明值(高层 unzip 读 central directory,两者在诚实 zip 中一致)。
 * - 小条目(<320KB)走 AsyncUnzipInflate 的同步回退不建 worker;大 manifest 仍进 worker
 *   (CSP 已放行 worker-src blob:),故保留同款 watchdog。
 */
function unzipImportArchive(
  data: Uint8Array,
  budget: UnzipBudget = { entryBytes: MAX_IMPORT_ENTRY_BYTES, totalBytes: MAX_IMPORT_FILE_BYTES },
): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    const out: Unzipped = {}
    const activeTerminators: Array<() => void> = []
    let declaredTotalBytes = 0
    let actualTotalBytes = 0
    let pendingFiles = 0
    let parsed = false
    let settled = false

    const finish = (cb: () => void) => {
      if (settled) return
      settled = true
      // timer 在下方同步段内初始化;任何回调(含 push 期间的同步 ondata)都晚于它,无 TDZ 风险
      clearTimeout(timer)
      // 终止仍在解压的 worker 流(同步回退流没有可终止的 worker,terminate 为空实现或缺失,均安全)
      for (const terminate of activeTerminators) {
        try {
          terminate()
        } catch {
          /* 已完成/已终止的流重复 terminate 不应连累收尾 */
        }
      }
      activeTerminators.length = 0
      cb()
    }
    const maybeResolve = () => {
      if (parsed && pendingFiles === 0) finish(() => resolve(out))
    }

    const unzipper = new Unzip((file) => {
      if (settled) return
      const isManifest = file.name === 'manifest.json'
      if (!isManifest && !isImportImageEntryName(file.name)) return
      // 声明尺寸可用时预筛(与旧 filter 同口径:超限静默跳过,不为它解压一个字节);
      // 流式打包的 zip 无 local header 尺寸(数据描述符),此时放行,由下方实际计数兜底。
      // manifest.json 只受单条上限约束、不计入 totalBytes:导出侧按压缩后体积判上限,导入侧按解压后字节计,
      // 图片本就不可压缩,两边差额全落在 manifest 上——它被总预算挤掉后会误报「缺少 manifest.json」;
      // 超过单条上限则显式报错,不能静默跳过。
      if (file.originalSize !== undefined) {
        if (!Number.isFinite(file.originalSize) || file.originalSize > budget.entryBytes) {
          if (isManifest) {
            return finish(() =>
              reject(
                new Error(
                  `manifest.json 超过 ${Math.round(budget.entryBytes / 1024 / 1024)}MB 上限,无法导入`,
                ),
              ),
            )
          }
          return
        }
        if (!isManifest) {
          if (declaredTotalBytes + file.originalSize > budget.totalBytes) return
          declaredTotalBytes += file.originalSize
        }
      }
      pendingFiles++
      if (typeof file.terminate === 'function') activeTerminators.push(file.terminate)
      const chunks: Uint8Array[] = []
      let entryBytes = 0
      file.ondata = (err, chunk, final) => {
        if (settled) return
        if (err) return finish(() => reject(err))
        if (chunk) {
          entryBytes += chunk.length
          if (!isManifest) actualTotalBytes += chunk.length
          if (isManifest && entryBytes > budget.entryBytes) {
            return finish(() =>
              reject(
                new Error(
                  `manifest.json 超过 ${Math.round(budget.entryBytes / 1024 / 1024)}MB 上限,无法导入`,
                ),
              ),
            )
          }
          if (entryBytes > budget.entryBytes || actualTotalBytes > budget.totalBytes) {
            return finish(() =>
              reject(
                new Error(
                  `导入文件解压后超过 ${Math.round(budget.totalBytes / 1024 / 1024)}MB 上限(zip 声明尺寸与实际不符,文件可能已损坏或被恶意构造)`,
                ),
              ),
            )
          }
          chunks.push(chunk)
        }
        if (final) {
          const merged = new Uint8Array(entryBytes)
          let offset = 0
          for (const part of chunks) {
            merged.set(part, offset)
            offset += part.length
          }
          out[file.name] = merged
          pendingFiles--
          maybeResolve()
        }
      }
      try {
        file.start()
      } catch (err) {
        // 未注册的压缩算法等:与高层 unzip() 一致,整体报错而不是静默丢条目
        finish(() => reject(err instanceof Error ? err : new Error(String(err))))
      }
    })
    unzipper.register(UnzipPassThrough)
    unzipper.register(AsyncUnzipInflate)
    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new Error('解压超时:worker 可能创建失败,请检查部署的 CSP 是否放行 worker-src blob:'),
        ),
      )
    }, WORKER_WATCHDOG_MS)
    try {
      unzipper.push(data, true)
    } catch (err) {
      return finish(() => reject(err instanceof Error ? err : new Error(String(err))))
    }
    parsed = true
    maybeResolve()
  })
}

/** 仅测试用:以自定义预算跑流式解压,用小体积构造出「声明与实际不符」的炸弹场景。 */
export function __unzipImportArchiveForTests(
  data: Uint8Array,
  budget: UnzipBudget,
): Promise<Unzipped> {
  return unzipImportArchive(data, budget)
}

/**
 * 防重入 + 互斥:导出/导入/清空都是触碰整库的长任务,任意两个并发(设置面板 busy 只挡本面板,
 * 命令面板仍可触发导出)会与清库/写回交错,产出「任务有、图片缺」的撕裂备份还提示成功。
 * 单一互斥位:任一进行中,其余一律拒绝。
 */
const DATA_JOB_LABEL: Record<DataJob, string> = { export: '导出', import: '导入', clear: '清空' }

/** 申请互斥位:成功返回 true;已有任务进行中则 toast 并返回 false。 */
function acquireDataJob(job: DataJob): boolean {
  const inProgress = getDataJobInProgress()
  if (inProgress) {
    useStore.getState().showToast(`数据${DATA_JOB_LABEL[inProgress]}正在进行中,请稍后再试`, 'error')
    return false
  }
  setDataJobInProgress(job)
  return true
}

function getImageExt(mime: string): string {
  const normalized = mime.toLowerCase()
  if (normalized === 'image/jpeg') return 'jpg'
  if (normalized === 'image/svg+xml') return 'svg'
  const ext = normalized.split('/')[1]?.split('+')[0]
  if (ext === 'png' || ext === 'jpg' || ext === 'webp' || ext === 'gif' || ext === 'avif') {
    return ext
  }
  return 'png'
}

function getMimeFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? 'png'
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    gif: 'image/gif',
    avif: 'image/avif',
  }
  return mimeMap[ext] ?? 'image/png'
}

function isSupportedImportedImageMime(mime: string): boolean {
  const normalized = mime.toLowerCase()
  return (
    normalized === 'image/png' ||
    normalized === 'image/jpeg' ||
    normalized === 'image/webp' ||
    normalized === 'image/svg+xml' ||
    normalized === 'image/gif' ||
    normalized === 'image/avif'
  )
}

function readImportedImageMime(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().toLowerCase()
  return isSupportedImportedImageMime(trimmed) ? trimmed : undefined
}

/** 校验图片条目 path:必须形如 images/<id>.<ext> 且 id 与 manifest key 一致,否则返回 null 跳过(防 ZIP 路径穿越 / id 错配)。 */
function resolveImageEntry(id: string, filePath: string, manifestMime?: string): string | null {
  if (filePath.includes('..')) return null
  const match = /^images\/(.+)\.(png|jpg|jpeg|webp|svg|gif|avif)$/.exec(filePath)
  if (!match || match[1] !== id) return null
  const pathMime = getMimeFromPath(filePath)
  if (!manifestMime) return pathMime
  return manifestMime === pathMime ? manifestMime : null
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeImportedPrompt(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_TASK_TEXT_LEN) : ''
}

function normalizeInputImageReferences(value: unknown): Pick<InputImage, 'id' | 'dataUrl'>[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: Pick<InputImage, 'id' | 'dataUrl'>[] = []
  for (const item of value) {
    if (!isPlainRecord(item) || typeof item.id !== 'string' || !item.id.trim()) continue
    const id = item.id.slice(0, MAX_TASK_TEXT_LEN)
    if (seen.has(id)) continue
    seen.add(id)
    result.push({ id, dataUrl: '' })
    if (result.length >= MAX_INPUT_IMAGES_PER_SUBMISSION) break
  }
  return result
}

function isStoredImageSource(value: unknown): value is NonNullable<StoredImage['source']> {
  return value === 'upload' || value === 'generated' || value === 'mask'
}

function readImportedImageInfo(value: unknown): ExportData['imageFiles'][string] | null {
  if (!isPlainRecord(value)) return null
  const path = value.path
  if (typeof path !== 'string') return null
  return {
    path,
    mime: readImportedImageMime(value.mime),
    createdAt:
      typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
        ? value.createdAt
        : undefined,
    source: isStoredImageSource(value.source) ? value.source : undefined,
  }
}

/**
 * 把本轮导入集与 reseed 的 conversationId 补丁叠加到「此刻」的实时任务列表上。
 *
 * 为什么不用导入开始时的 DB 快照:导入是秒级 await(解压 + 逐张 putImage),merge 模式不终止在途任务、
 * replace 模式清库后 InputBar 也没有导入互斥——窗口内完成的任务已被 updateTaskInStore 写成 done,
 * 用户可能删了旧记录或又提交了新任务。若尾部用快照整体 setTasks:done 会被打回 running(没有 watchdog
 * 永远转圈,再点「取消」会拿这份陈旧记录覆写 DB 里真实的 done,输出图沦为孤儿被启动 GC 删掉),被删记录
 * 借快照复活,新任务则直接从 store 消失、executeTask 完成时找不到记录即丢弃结果(配额已耗)。
 *
 * 同一函数在写库前(取 toPersist)与写 store 前(取 nextTasks)各调一次,两次都以调用时刻的实时列表为基底,
 * 因此 persistConversationMigration 期间完成的任务也不会被最终 setTasks 回退。
 * - 导入集里与实时列表同 id 的记录以实时版本为准(不覆写、不重复写库);
 * - reseed 补丁只改 conversationId,既有记录的其余字段一律取实时版本。
 */
function overlayImportOnLiveTasks(
  liveTasks: TaskRecord[],
  importedTasks: TaskRecord[],
  reseedTargets: Map<string, string | undefined>,
): { nextTasks: TaskRecord[]; toPersist: TaskRecord[] } {
  const withReseed = (task: TaskRecord): TaskRecord => {
    if (!reseedTargets.has(task.id)) return task
    const target = reseedTargets.get(task.id)
    return task.conversationId === target ? task : { ...task, conversationId: target }
  }
  const liveIds = new Set(liveTasks.map((task) => task.id))
  const imported = importedTasks.filter((task) => !liveIds.has(task.id)).map(withReseed)
  const dirtyExisting: TaskRecord[] = []
  const live = liveTasks.map((task) => {
    const next = withReseed(task)
    if (next !== task) dirtyExisting.push(next)
    return next
  })
  return { nextTasks: [...live, ...imported], toPersist: [...imported, ...dirtyExisting] }
}

function createUiClearSnapshot(now = Date.now()) {
  const state = useStore.getState()
  const snapshot = {
    tasks: state.tasks,
    inputImages: state.inputImages,
    maskDraft: state.maskDraft,
    maskEditorImageId: state.maskEditorImageId,
    settings: state.settings,
    params: state.params,
    favoriteCategories: state.favoriteCategories,
    conversations: state.conversations,
    activeConversationId: state.activeConversationId,
    snippets: state.snippets,
    batchNotes: state.batchNotes,
    dismissedCodexCliPrompts: state.dismissedCodexCliPrompts,
    selectedTaskIds: state.selectedTaskIds,
    detailTaskId: state.detailTaskId,
    lineageTaskId: state.lineageTaskId,
    compareTaskIds: state.compareTaskIds,
    lightboxImageId: state.lightboxImageId,
    lightboxImageList: state.lightboxImageList,
    captionBatchImageIds: state.captionBatchImageIds,
    captionSource: state.captionSource,
  }

  return () => {
    useStore.setState({
      tasks: snapshot.tasks.map((task) =>
        task.status === 'running' ? createCancelledTask(task, now) : task,
      ),
      inputImages: snapshot.inputImages,
      maskDraft: snapshot.maskDraft,
      maskEditorImageId: snapshot.maskEditorImageId,
      settings: snapshot.settings,
      params: snapshot.params,
      favoriteCategories: snapshot.favoriteCategories,
      conversations: snapshot.conversations,
      activeConversationId: snapshot.activeConversationId,
      snippets: snapshot.snippets,
      batchNotes: snapshot.batchNotes,
      dismissedCodexCliPrompts: snapshot.dismissedCodexCliPrompts,
      selectedTaskIds: snapshot.selectedTaskIds,
      detailTaskId: snapshot.detailTaskId,
      lineageTaskId: snapshot.lineageTaskId,
      compareTaskIds: snapshot.compareTaskIds,
      lightboxImageId: snapshot.lightboxImageId,
      lightboxImageList: snapshot.lightboxImageList,
      captionBatchImageIds: snapshot.captionBatchImageIds,
      captionSource: snapshot.captionSource,
    })
  }
}

function clearTransientUiForClearedData() {
  useStore.setState({
    selectedTaskIds: [],
    detailTaskId: null,
    lineageTaskId: null,
    compareTaskIds: null,
    lightboxImageId: null,
    lightboxImageList: [],
    maskDraft: null,
    maskEditorImageId: null,
    captionBatchImageIds: null,
    captionSource: null,
  })
}

/**
 * 清库后把 store 复位到「空库默认态」。
 * resetSettings 区分两个调用方:「清空所有数据」承诺连供应商配置一起清,传 true;「替换导入」只清任务/
 * 图片/会话,settings 走后续 mergeImportedSettings 合并,必须传 false——否则合并时「当前」已是纯默认态,
 * mergeImportedSettings 会整包采用备份,而备份经 redactSettingsForExport 抹空了全部 apiKey,三套密钥
 * 在成功 toast 下静默归零,与确认弹窗「已有密钥不会被空密钥覆盖」相反(c6b41bf 曾因此回归)。
 */
function applyClearedDefaultState(archive: Conversation, options: { resetSettings: boolean }) {
  useStore.setState({
    tasks: [],
    prompt: '',
    inputImages: [],
    maskDraft: null,
    maskEditorImageId: null,
    favoriteCategories: [createDefaultFavoriteCategory()],
    favoriteCategoriesInitialized: true,
    snippets: [],
    batchNotes: {},
    conversations: [archive],
    activeConversationId: archive.id,
    dismissedCodexCliPrompts: [],
    ...(options.resetSettings ? { settings: normalizeSettings(DEFAULT_SETTINGS) } : {}),
    params: { ...DEFAULT_PARAMS },
  })
  clearTransientUiForClearedData()
}

export function redactSettingsForExport(settings: AppSettings): AppSettings {
  const normalized = normalizeSettings(settings)
  return {
    ...normalized,
    apiKey: '',
    profiles: normalized.profiles.map((profile) => ({
      ...profile,
      apiKey: '',
    })),
    promptOptimizer: {
      ...normalized.promptOptimizer,
      apiKey: '',
    },
    optimizerProfiles: normalized.optimizerProfiles.map((profile) => ({
      ...profile,
      apiKey: '',
    })),
    captioner: {
      ...normalized.captioner,
      apiKey: '',
    },
    captionerProfiles: normalized.captionerProfiles.map((profile) => ({
      ...profile,
      apiKey: '',
    })),
  }
}

function sanitizeImportedTasksForFavoriteCategories(
  tasks: TaskRecord[],
  validCategoryIds: Set<string>,
): TaskRecord[] {
  /*
   * ========================================================================
   * 步骤1：校验导入任务分类引用
   * ========================================================================
   * 数据源：
   *   1) 备份 manifest 中的任务记录
   *   2) 同一份备份 manifest 中的分类元数据 id
   * 操作要点：
   *   1) 保留能找到元数据的收藏分类 id
   *   2) 清理非收藏或缺失元数据的悬空分类引用
   */
  // 1.1 清理悬空分类引用
  return tasks.map((task) => {
    const categoryId = task.favoriteCategoryId?.trim() || null
    if (!categoryId) return task
    if (task.isFavorite && validCategoryIds.has(categoryId)) return task
    return { ...task, favoriteCategoryId: null }
  })
}

/** 清空所有数据（含配置重置） */
export async function clearAllData() {
  if (!acquireDataJob('clear')) return
  try {
    await clearAllDataInner()
  } catch (err) {
    useStore
      .getState()
      .showToast(`清空数据失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    throw err
  } finally {
    setDataJobInProgress(null)
  }
}

async function clearAllDataInner() {
  const stateBeforeClear = useStore.getState()
  const restoreClearedUiSnapshot = createUiClearSnapshot()
  const { setTasks } = stateBeforeClear
  // 清库前先中止全部在途请求并回收 watchdog/controller:不终止则请求继续白烧 API 配额;
  // 不能用 cancelTask(其 fire-and-forget 写库可能在清库后落盘,把幽灵记录写回空表)。
  // terminate 与 setTasks([]) 必须在同一同步段、先于任何 await:abort 异常到达 executeTask
  // catch 时 store 里必须已无该任务,守卫才会早退而不是把幽灵 error 写回刚清空的表(见
  // terminateRunningTaskRuntimes 的调用契约);排队成员同理被入口守卫拦下。
  terminateRunningTaskRuntimes(useStore.getState().tasks)
  setTasks([])
  clearTransientUiForClearedData()
  try {
    await dbClearTasks()
    await clearImages()
    await dbClearConversations()
  } catch (err) {
    restoreClearedUiSnapshot()
    throw err
  }
  clearImageCache()
  const archive = createArchiveConversation()
  applyClearedDefaultState(archive, { resetSettings: true })
  await persistConversationMigration([archive], [])
  useStore.getState().showToast('所有数据已清空', 'success')
}

/** 导出数据为 ZIP */
export async function exportData() {
  if (!acquireDataJob('export')) return
  try {
    const tasks = await getAllTasks()
    const images = await getAllImages()
    const conversations = await getAllConversations()
    const { settings, favoriteCategories, snippets, batchNotes, prompt, params, inputImages } =
      useStore.getState()
    const exportedAt = Date.now()
    const exportedInputImages = normalizeInputImageReferences(inputImages)

    // 批次笔记:仅导出仍有 task 引用的(孤儿笔记不进备份)
    const referencedBatchIds = new Set(tasks.map((task) => task.batchId).filter(Boolean))
    const exportedBatchNotes = Object.fromEntries(
      Object.entries(normalizeBatchNotes(batchNotes)).filter(([batchId]) =>
        referencedBatchIds.has(batchId),
      ),
    )
    const imageCreatedAtFallback = new Map<string, number>()

    const referencedImageIds = collectReferencedImageIds(tasks, exportedInputImages)
    for (const task of tasks) {
      for (const id of collectReferencedImageIds([task], [])) {
        if (!referencedImageIds.has(id)) continue
        const prev = imageCreatedAtFallback.get(id)
        if (prev == null || task.createdAt < prev) {
          imageCreatedAtFallback.set(id, task.createdAt)
        }
      }
    }

    const imageFiles: ExportData['imageFiles'] = {}
    const zipFiles: Zippable = {}

    for (const img of images) {
      if (!referencedImageIds.has(img.id)) continue
      let imageBytes: Awaited<ReturnType<typeof storedImageToBytes>>
      try {
        imageBytes = await storedImageToBytes(img)
      } catch {
        continue
      }
      if (!imageBytes) continue
      const { bytes, mime } = imageBytes
      const ext = getImageExt(mime)
      const path = `images/${img.id}.${ext}`
      const createdAt = img.createdAt ?? imageCreatedAtFallback.get(img.id) ?? exportedAt
      imageFiles[img.id] = { path, mime, createdAt, source: img.source }
      // level 0(仅存储不压缩):图片本就是压缩格式,level 6 收益≈0 还会让 fflate 给每个
      // ≥160KB 条目各 spawn 一个 worker(无并发上限)+ postMessage 克隆 buffer——几百张图
      // 同时几百个 worker、内存 3-4 倍峰值,移动端直接 OOM。level 0 同步直存,导入侧解压
      // 这些条目也退化为纯内存 slice(不再有主线程 inflate 冻结)。
      zipFiles[path] = [bytes, { mtime: toZipMtime(createdAt), level: 0 }]
    }
    const skippedReferencedImageCount = referencedImageIds.size - Object.keys(imageFiles).length

    const manifest: ExportData = {
      version: 5,
      exportedAt: new Date(exportedAt).toISOString(),
      settings: redactSettingsForExport(settings),
      prompt: normalizeImportedPrompt(prompt),
      params: normalizeTaskParams(params),
      inputImages: exportedInputImages,
      favoriteCategories: normalizeFavoriteCategories(favoriteCategories),
      snippets: normalizeSnippets(snippets),
      batchNotes: exportedBatchNotes,
      conversations: normalizeConversations(conversations),
      tasks,
      imageFiles,
    }

    zipFiles['manifest.json'] = [
      strToU8(JSON.stringify(manifest, null, 2)),
      { mtime: toZipMtime(exportedAt) },
    ]

    const zipped = await zipAsync(zipFiles)
    const blob = new Blob([copyBytesToArrayBuffer(zipped)], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = `image-playground-${Date.now()}.zip`
      a.click()
    } finally {
      URL.revokeObjectURL(url)
    }
    // 导出与导入的上限必须对称:超过导入上限的备份「导出成功却永远无法恢复」,
    // 且 PNG/WebP 已压缩、zip 几乎不再缩小,用户没有产品内自救路径——必须在导出时就告知。
    // 用信息弹窗而非 toast:这条关键警告约 60 字,3 秒自动消失的 toast 来不及读完。
    if (skippedReferencedImageCount > 0) {
      useStore
        .getState()
        .showToast(`备份不完整：${skippedReferencedImageCount} 张图片无法读取，已跳过`, 'error')
    }
    if (zipped.byteLength > MAX_IMPORT_FILE_BYTES) {
      useStore.getState().setConfirmDialog({
        title: '备份超过导入上限',
        message: `备份已导出,但大小 ${Math.round(zipped.byteLength / 1024 / 1024)}MB 超过导入上限 ${Math.round(MAX_IMPORT_FILE_BYTES / 1024 / 1024)}MB,这份备份将无法直接导入恢复。\n\n建议清理无用记录或孤儿图片后重新备份。`,
        confirmText: '知道了',
        icon: 'info',
        showCancel: false,
        action: () => {},
      })
    } else if (skippedReferencedImageCount === 0) {
      useStore.getState().showToast('数据已导出', 'success')
    }
  } catch (e) {
    useStore
      .getState()
      .showToast(`导出失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    setDataJobInProgress(null)
  }
}

/** 导入 ZIP 数据 */
export async function importData(file: File, options: ImportDataOptions = {}): Promise<boolean> {
  if (!acquireDataJob('import')) return false
  // 替换导入只有走到清库那一步才算「触碰了本地数据」;之前的解析/校验失败本地一字未改,
  // 不该吓用户「数据可能不完整」
  let localDataTouched = false
  try {
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      throw new Error(`导入文件过大:超过 ${Math.round(MAX_IMPORT_FILE_BYTES / 1024 / 1024)}MB 上限`)
    }
    const buffer = await file.arrayBuffer()
    const unzipped = await unzipImportArchive(new Uint8Array(buffer))

    const manifestBytes = unzipped['manifest.json']
    if (!manifestBytes) throw new Error('ZIP 中缺少 manifest.json')

    const data: ExportData = JSON.parse(strFromU8(manifestBytes))
    if (!Array.isArray(data.tasks) || !isPlainRecord(data.imageFiles)) {
      throw new Error('无效的数据格式')
    }

    const isReplaceMode = (options.mode ?? 'merge') === 'replace'
    // 既有 id 在清空之前读取(replace 模式短路为空集,不触达活库;merge 模式无清空):供下方去重。
    const existingTasks = isReplaceMode ? [] : await getAllTasks()
    const existingTaskIds = new Set(existingTasks.map((task) => task.id))
    const existingImageIds = isReplaceMode
      ? new Set<string>()
      : new Set((await getAllImages()).map((image) => image.id))
    const hasFavoriteCategoryMetadata = Array.isArray(data.favoriteCategories)
    const importedCategories = hasFavoriteCategoryMetadata
      ? normalizeFavoriteCategories(data.favoriteCategories)
      : []
    const importedCategoryIds = new Set(importedCategories.map((category) => category.id))
    const importedPrompt = normalizeImportedPrompt(data.prompt)
    const importedParams = normalizeTaskParams(data.params)
    const importedInputImages = normalizeInputImageReferences(data.inputImages)
    // 对不可信 task 做字段级白名单归一化(防缺字段 / 类型错误 / __proto__ 污染直入 IndexedDB)
    // 备份里 status:'running' 的任务在导入端没有执行体,会成为无请求、无 watchdog 的幽灵 running
    // 卡片,统一落「请求中断」错误态(与 initStore 启动恢复同口径)。耗时未知,不按导入时刻伪造。
    const normalizedImportedTasks = normalizeTasks(data.tasks).map((task) =>
      task.status === 'running'
        ? {
            ...task,
            status: 'error' as const,
            error: SYNC_HTTP_INTERRUPTED_ERROR,
            finishedAt: task.createdAt,
            elapsed: null,
          }
        : task,
    )
    const importedTasks = sanitizeImportedTasksForFavoriteCategories(
      normalizedImportedTasks,
      importedCategoryIds,
    )
    const tasksToWrite = importedTasks.filter((task) => !existingTaskIds.has(task.id))
    const tasksAfterImport = isReplaceMode ? tasksToWrite : [...existingTasks, ...tasksToWrite]
    const importedReferencedImageIds = collectReferencedImageIds(
      tasksToWrite,
      isReplaceMode ? importedInputImages : [],
    )
    const importAvailableImageIds = new Set<string>()
    for (const id of importedReferencedImageIds) {
      if (existingImageIds.has(id)) importAvailableImageIds.add(id)
    }
    const inputImageDataUrls = new Map<string, string>()

    // 先把全部待写图片解码 + 校验到内存(路径穿越 / id 错配 / 字节缺失在此 continue 跳过),全部就绪后才清空,
    // 把 replace 模式的不可恢复窗口从「清空 → 解码 → 写回」收敛为「清空 → 纯写回」。
    const imagesToWrite: StoredImage[] = []
    for (const [id, rawInfo] of Object.entries(data.imageFiles)) {
      if (!importedReferencedImageIds.has(id)) continue
      if (existingImageIds.has(id)) {
        importAvailableImageIds.add(id)
        continue
      }
      const info = readImportedImageInfo(rawInfo)
      if (!info) continue
      // 校验 path 严格形如 images/<id>.<ext> 且与 id 一致,拒绝路径穿越 / id 错配的条目
      const mime = resolveImageEntry(id, info.path, info.mime)
      if (!mime) continue
      const bytes = unzipped[info.path]
      if (!bytes) continue
      const blob = new Blob([copyBytesToArrayBuffer(bytes)], { type: mime })
      imagesToWrite.push({ id, blob, mime, createdAt: info.createdAt, source: info.source })
      importAvailableImageIds.add(id)
      if (isReplaceMode && importedInputImages.some((image) => image.id === id)) {
        inputImageDataUrls.set(id, await blobToDataUrl(blob, mime))
      }
    }
    const missingReferencedImageCount =
      importedReferencedImageIds.size - importAvailableImageIds.size

    // 全部待写记录就绪后才清空旧库(replace 模式),最大限度缩小数据丢失窗口。
    if (isReplaceMode) {
      localDataTouched = true
      // 同 clearAllData:terminate + 同步清 store 必须先于任何 await(契约见
      // terminateRunningTaskRuntimes),否则 abort 异常会把幽灵 error 记录写回刚清空的表,
      // 且本函数末尾的 getAllTasks() 重读会当场把幽灵带回 UI。
      const state = useStore.getState()
      const restoreClearedUiSnapshot = createUiClearSnapshot()
      terminateRunningTaskRuntimes(state.tasks)
      state.setTasks([])
      clearTransientUiForClearedData()
      state.setConversations([])
      state.setActiveConversation(null)
      state.clearInputImages()
      state.clearMaskDraft()
      clearImageCache()
      try {
        await dbClearTasks()
        await clearImages()
        await dbClearConversations()
      } catch (err) {
        restoreClearedUiSnapshot()
        throw err
      }
      // settings 不在被清空的三张表里(走 localStorage),替换导入自始至终不重置它:成功路径交给下方
      // mergeImportedSettings 以真实当前配置为基准合并,失败路径也不该顺带把密钥清掉。
      applyClearedDefaultState(createArchiveConversation(), { resetSettings: false })
    }

    const stateBeforeStoreMutation = useStore.getState()
    const nextFavoriteCategories = isReplaceMode
      ? hasFavoriteCategoryMetadata
        ? importedCategories
        : [createDefaultFavoriteCategory()]
      : importedCategories.length
        ? mergeFavoriteCategories(stateBeforeStoreMutation.favoriteCategories, importedCategories)
        : stateBeforeStoreMutation.favoriteCategories

    /*
     * 步骤2：预计算 conversations（兼容旧导出无 conversations 字段）。
     * 关键点：task 写入和 conversation migration 必须合并到一个 IndexedDB 事务；
     * 否则后半段迁移失败会留下“导入失败但 task/image/settings 已部分生效”的不一致状态。
     */
    const hasConversationsMetadata = Array.isArray(data.conversations)
    let finalConversations: Conversation[]
    // reseed 只记录「哪条任务要落到哪个对话」;真正写库/写 store 时再叠加到实时记录上(见 overlayImportOnLiveTasks)
    const reseedTargets = new Map<string, string | undefined>()
    const existingConversations = isReplaceMode ? [] : await getAllConversations()
    if (hasConversationsMetadata) {
      const importedConversations = normalizeConversations(data.conversations)
      const conversationById = new Map<string, Conversation>()
      for (const conv of existingConversations) conversationById.set(conv.id, conv)
      for (const conv of importedConversations) {
        if (!conversationById.has(conv.id)) conversationById.set(conv.id, conv)
      }
      if (!conversationById.has(ARCHIVE_CONVERSATION_ID)) {
        conversationById.set(ARCHIVE_CONVERSATION_ID, createArchiveConversation())
      }
      finalConversations = Array.from(conversationById.values())

      const knownConversationIds = new Set(
        finalConversations.map((conversation) => conversation.id),
      )
      const importedTaskIds = new Set(tasksToWrite.map((task) => task.id))
      const orphanTasks = tasksAfterImport
        .filter(
          (task) =>
            !task.conversationId ||
            (importedTaskIds.has(task.id) && !knownConversationIds.has(task.conversationId)),
        )
        .map((task) =>
          task.conversationId && !knownConversationIds.has(task.conversationId)
            ? { ...task, conversationId: undefined }
            : task,
        )
      if (orphanTasks.length) {
        const reseed = reseedConversationsFromFavoriteCategories({
          tasks: orphanTasks,
          favoriteCategories: nextFavoriteCategories,
          existingConversations: finalConversations,
        })
        finalConversations = reseed.conversations
        for (const task of reseed.dirtyTasks) reseedTargets.set(task.id, task.conversationId)
      }
    } else {
      const reseed = reseedConversationsFromFavoriteCategories({
        tasks: tasksAfterImport,
        favoriteCategories: nextFavoriteCategories,
        existingConversations,
      })
      finalConversations = reseed.conversations
      for (const task of reseed.dirtyTasks) reseedTargets.set(task.id, task.conversationId)
    }

    // 纯写回(已无解码 / 校验)。图片 store 与 tasks/conversations 不在同一 IDB 事务,
    // 因此任一后续写入失败都要回滚本轮刚写且未被既有 task 引用的图片。
    const writtenImageIds: string[] = []
    try {
      for (const image of imagesToWrite) {
        await putImage(image)
        writtenImageIds.push(image.id)
      }
      // 写库集在逐张写图之后才组装:既有记录要取写库时刻的实时版本,否则写图期间完成的任务会在 DB 里被打回 running
      const { toPersist } = overlayImportOnLiveTasks(
        useStore.getState().tasks,
        tasksToWrite,
        reseedTargets,
      )
      await persistConversationMigration(finalConversations, toPersist)
    } catch (err) {
      // 引用集取实时 store 而非快照:导入期间完成的任务若恰好产出了与本轮导入同 hash 的图,也不能被回滚删掉
      const existingReferencedImageIds = collectReferencedImageIds(useStore.getState().tasks, [])
      const rollbackImageIds = writtenImageIds.filter((id) => !existingReferencedImageIds.has(id))
      try {
        await rollbackStoredImages(rollbackImageIds)
      } catch (rollbackErr) {
        useStore
          .getState()
          .showToast(
            `清理导入图片失败：${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
            'error',
          )
      }
      throw err
    }

    if (isPlainRecord(data.settings)) {
      const state = useStore.getState()
      state.setSettings(mergeImportedSettings(state.settings, data.settings))
    }

    if (isReplaceMode) {
      const restoredInputImages = importedInputImages.flatMap((image): InputImage[] => {
        if (!importAvailableImageIds.has(image.id)) return []
        const dataUrl = inputImageDataUrls.get(image.id)
        return dataUrl ? [{ id: image.id, dataUrl }] : []
      })
      const state = useStore.getState()
      state.setPrompt(importedPrompt)
      state.setParams(importedParams)
      state.setInputImages(restoredInputImages)
    }

    if (isReplaceMode) {
      useStore.getState().setFavoriteCategories(nextFavoriteCategories)
    } else if (importedCategories.length) {
      useStore.getState().setFavoriteCategories(nextFavoriteCategories)
    }

    // 提示词片段:旧备份无 snippets 字段 → 空数组(replace 清空 / merge 不变)
    const importedSnippets = normalizeSnippets(data.snippets)
    if (isReplaceMode) {
      useStore.getState().setSnippets(importedSnippets)
    } else if (importedSnippets.length) {
      const state = useStore.getState()
      state.setSnippets(mergeSnippets(state.snippets, importedSnippets))
    }

    // 批次笔记:merge=本地同 batchId 优先;replace=直接覆盖;旧备份缺字段同上
    const importedBatchNotes = normalizeBatchNotes(data.batchNotes)
    if (isReplaceMode) {
      useStore.setState({ batchNotes: importedBatchNotes })
    } else if (Object.keys(importedBatchNotes).length) {
      const localNotes = useStore.getState().batchNotes
      useStore.setState({ batchNotes: mergeBatchNotes(localNotes, importedBatchNotes) })
    }

    const normalizedFinalConversations = normalizeConversations(finalConversations)
    useStore.getState().setConversations(normalizedFinalConversations)
    const activeConversationId = useStore.getState().activeConversationId
    const activeConversationExists = normalizedFinalConversations.some(
      (conversation) => conversation.id === activeConversationId,
    )
    if (isReplaceMode || !activeConversationId || !activeConversationExists) {
      const nextActive =
        normalizedFinalConversations.find((c) => c.id !== ARCHIVE_CONVERSATION_ID) ??
        normalizedFinalConversations[0]
      useStore.getState().setActiveConversation(nextActive?.id ?? null)
    }

    // 以此刻的实时列表为基底写回(不是导入开始时的快照):见 overlayImportOnLiveTasks 头注释
    useStore
      .getState()
      .setTasks(
        overlayImportOnLiveTasks(useStore.getState().tasks, tasksToWrite, reseedTargets).nextTasks,
      )
    if (missingReferencedImageCount > 0) {
      useStore
        .getState()
        .showToast(
          `导入完成，但 ${missingReferencedImageCount} 张图片缺失或无效，相关记录可能无法显示图片`,
          'error',
        )
    } else {
      useStore.getState().showToast(`已导入 ${tasksToWrite.length} 条记录`, 'success')
    }
    return true
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const isReplace = (options.mode ?? 'merge') === 'replace' && localDataTouched
    useStore
      .getState()
      .showToast(
        isReplace
          ? `替换导入失败：${message}。数据可能不完整,请重新导入或清空后重试。`
          : `导入失败：${message}`,
        'error',
      )
    return false
  } finally {
    setDataJobInProgress(null)
  }
}
