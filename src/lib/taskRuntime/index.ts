/**
 * taskRuntime 公开 API 汇总(拆分轮唯一对外入口,见 shared.ts 头注释)。
 *
 * 原 taskRuntime.ts 近 2000 行单文件按职责拆为十一个模块;外部导入路径 './taskRuntime'
 * 与全部导出名保持不变,store/index.ts 的 re-export 链不受影响。内部共享件(shared 的
 * 运行期 Map、persistence/submit 的原语)只供模块间导入,不在此导出。
 */
export { resetTaskRuntimeForTest } from './shared'
export { rollbackStoredImages, updateTaskInStore } from './persistence'
export {
  SYNC_HTTP_INTERRUPTED_ERROR,
  markInterruptedSyncHttpTasks,
  scheduleSyncHttpWatchdog,
} from './watchdog'
export {
  type CancelBatchResult,
  cancelAllRunning,
  cancelBatch,
  cancelTask,
  createCancelledTask,
  terminateRunningTaskRuntimes,
} from './cancel'
export { getCodexCliPromptKey, showCodexCliPrompt } from './codexCli'
export { ORPHAN_GC_MIN_INTERVAL_MS, __runPendingStartupOrphanGcForTests, initStore } from './init'
export { resolveExecutionProfile, submitTask } from './submit'
export { type GridSubmitConfig, retryGridCell, retryGridMissing, submitGridTask } from './grid'
export { editOutputs, retryTask, reuseConfig } from './actions'
export {
  clearTransientUiReferencesForDeletedTasks,
  clearTaskFavorite,
  getTaskSortKey,
  removeMultipleTasks,
  removeTask,
  reorderTask,
  setTaskFavoriteCategory,
} from './mutations'
export {
  MAX_INPUT_IMAGE_BYTES,
  MAX_INPUT_IMAGE_PIXELS,
  addImageFromFile,
  addImageFromUrl,
  assertImagePixelLimit,
} from './inputImages'
