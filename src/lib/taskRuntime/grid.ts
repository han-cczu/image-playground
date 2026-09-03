/**
 * XY 参数网格的提交与补跑(taskRuntime 拆分轮,见 shared.ts 头注释)。
 * 复用 submit 模块的 enqueueTask/runEnqueuedTasks/prepareSubmission/executeTask 原语。
 */
import type { ApiProfile, AppSettings, GridAxis, TaskRecord } from '../../types'
import { useStore } from '../../store'
import { getActiveApiProfile, normalizeSettings, validateApiProfile } from '../api/apiProfiles'
import { MAX_PROMPT_EXPANSION, MAX_PROMPT_EXPANSION_HARD } from '../promptExpand'
import { normalizeParamsForSettings } from '../api/paramCompatibility'
import {
  buildGridCells,
  countGridCells,
  countGridImages,
  reconstructMatrix,
} from '../gridExperiment'
import { ARCHIVE_CONVERSATION_ID } from '../conversations'
import { genId } from './shared'
import {
  enqueueTask,
  executeTask,
  maybeUpdateConversationOnFirstTask,
  prepareSubmission,
  resolveExecutionProfile,
  runEnqueuedTasks,
  runExclusiveSubmission,
} from './submit'

export interface GridSubmitConfig {
  x: GridAxis
  y?: GridAxis
}

/** 提交 XY 参数网格:笛卡尔积 + 复用 batchId/enqueueTask/runEnqueuedTasks。 */
export function submitGridTask(
  gridConfig: GridSubmitConfig,
  options: { allowFullMask?: boolean; allowLargeBatch?: boolean } = {},
): Promise<void> {
  // 与 submitTask 共用同一把提交互斥(见 runExclusiveSubmission):网格提交的入队窗口更长,重入更容易撞上
  return runExclusiveSubmission(() => submitGridTaskInner(gridConfig, options))
}

async function submitGridTaskInner(
  gridConfig: GridSubmitConfig,
  options: { allowFullMask?: boolean; allowLargeBatch?: boolean },
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
    showToast(
      `网格将生成 ${cellCount} 格，超过上限 ${MAX_PROMPT_EXPANSION_HARD}，请减少轴取值`,
      'error',
    )
    return
  }
  if (cellCount > MAX_PROMPT_EXPANSION && !options.allowLargeBatch) {
    const previewParams = normalizeParamsForSettings(params, settings)
    const totalImages = countGridImages(gridConfig, previewParams.n)
    setConfirmDialog({
      title: '批量生成确认',
      message:
        previewParams.n > 1
          ? `网格将生成 ${gridConfig.x.values.length}×${yCount} = ${cellCount} 格，每格 ${previewParams.n} 张，共 ${totalImages} 张图片。是否继续？`
          : `网格将生成 ${gridConfig.x.values.length}×${yCount} = ${cellCount} 格（共 ${cellCount} 张图片）。是否继续？`,
      confirmText: '继续生成',
      tone: 'warning',
      action: () => {
        return submitGridTask(gridConfig, { ...options, allowLargeBatch: true })
      },
    })
    return
  }

  const prepared = await prepareSubmission(options, () => {
    return submitGridTask(gridConfig, { ...options, allowFullMask: true })
  })
  if (!prepared) return
  const { normalizedParams, inputImageIds, maskImageId, maskTargetImageId, activeConversationId } =
    prepared

  // 笛卡尔积(base 用归一化后的 params 与当前 prompt;prompt 轴取值来自通配展开,见 gridExperiment)
  const cells = buildGridCells(gridConfig, {
    settings,
    params: normalizedParams,
    prompt: prompt.trim(),
  })
  const gridAxes = { x: gridConfig.x, ...(gridConfig.y ? { y: gridConfig.y } : {}) }
  const batchId = genId()
  // 真实总图 = Σ 各格 n(n 作轴时各格不同)
  const totalImages = cells.reduce((sum, c) => sum + c.params.n, 0)
  useStore
    .getState()
    .showToast(
      `网格生成：${gridConfig.x.values.length}×${yCount}，共 ${totalImages} 张图片`,
      'success',
    )

  const taskIds: string[] = []
  for (const cell of cells) {
    const id = await enqueueTask({
      prompt: cell.prompt,
      params: cell.params,
      apiProvider: activeProfile.provider,
      apiProfileId: activeProfile.id,
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
  const retryProfile = getGridRetryProfile(settings, sample)
  const retrySettings = settingsWithProfile(settings, retryProfile)
  const xVal = sample.gridAxes.x.values.find((v) => v.key === coord.x)
  const yVal =
    coord.y != null ? sample.gridAxes.y?.values.find((v) => v.key === coord.y) : undefined
  if (!xVal) return null
  // 用单值轴重建该格(非轴 params 取 sample 快照),buildGridCells 负责轴 override。
  const cellAxes = {
    x: { ...sample.gridAxes.x, values: [xVal] },
    ...(sample.gridAxes.y && yVal ? { y: { ...sample.gridAxes.y, values: [yVal] } } : {}),
  }
  const [cell] = buildGridCells(cellAxes, {
    settings: retrySettings,
    params: normalizeParamsForSettings(sample.params, retrySettings),
    prompt: sample.prompt,
  })
  if (!cell) return null
  return enqueueTask({
    prompt: cell.prompt,
    params: cell.params,
    apiProvider: retryProfile.provider,
    apiProfileId: retryProfile.id,
    apiProfileName: retryProfile.name,
    apiModel: retryProfile.model,
    inputImageIds: [...sample.inputImageIds],
    maskTargetImageId: sample.maskTargetImageId ?? null,
    maskImageId: sample.maskImageId ?? null,
    conversationId: sample.conversationId ?? activeConversationId ?? ARCHIVE_CONVERSATION_ID,
    batchId,
    gridAxes: sample.gridAxes,
    gridCoord: cell.gridCoord,
  })
}

function getGridRetryProfile(settings: AppSettings, sample: TaskRecord): ApiProfile {
  const hasPinnedProfile = Boolean(
    sample.apiProfileId || sample.apiProfileName || sample.apiProvider || sample.apiModel,
  )
  if (hasPinnedProfile) {
    const resolved = resolveExecutionProfile(settings, sample)
    if (resolved) return resolved.profile
  }
  return getActiveApiProfile(settings)
}

function settingsWithProfile(settings: AppSettings, profile: ApiProfile): AppSettings {
  const profiles = settings.profiles.some((candidate) => candidate.id === profile.id)
    ? settings.profiles.map((candidate) => (candidate.id === profile.id ? profile : candidate))
    : [profile, ...settings.profiles]
  return normalizeSettings({ ...settings, profiles, activeProfileId: profile.id })
}

/** 补跑单个网格格(结果回到矩阵原坐标)。 */
export function retryGridCell(
  batchId: string,
  coord: { x: string; y?: string },
  sampleOverride?: TaskRecord,
): void {
  const sample =
    sampleOverride ?? useStore.getState().tasks.find((t) => t.batchId === batchId && t.gridAxes)
  if (!sample) return
  void enqueueGridCell(batchId, coord, sample).then((id) => {
    if (id) executeTask(id)
  })
}

/** 补跑网格中「缺失或全部失败」的格(scope:全部 / 指定行 / 指定列)。 */
export function retryGridMissing(
  batchId: string,
  scope: 'all' | { row: string } | { col: string },
): void {
  const members = useStore.getState().tasks.filter((t) => t.batchId === batchId && t.gridAxes)
  const sample = members[0]
  const matrix = reconstructMatrix(members)
  if (!sample || !matrix) return

  const targets: Array<{ coord: { x: string; y?: string }; sample: TaskRecord }> = []
  for (const col of matrix.cols) {
    if (typeof scope === 'object' && 'col' in scope && col.key !== scope.col) continue
    for (const row of matrix.rows) {
      if (typeof scope === 'object' && 'row' in scope && row.key !== scope.row) continue
      const cellTasks = matrix.cellTasks(col.key, row.key)
      const representative = latestGridCellTask(cellTasks)
      const hasLive = representative?.status === 'done' || representative?.status === 'running'
      if (!hasLive) {
        targets.push({
          coord: { x: col.key, ...(matrix.axes.y ? { y: row.key } : {}) },
          sample: representative ?? sample,
        })
      }
    }
  }
  if (!targets.length) return
  void (async () => {
    const ids: string[] = []
    for (const target of targets) {
      const id = await enqueueGridCell(batchId, target.coord, target.sample)
      if (id) ids.push(id)
    }
    if (ids.length) void runEnqueuedTasks(ids)
  })()
}

function latestGridCellTask(tasks: TaskRecord[]): TaskRecord | null {
  if (!tasks.length) return null
  return tasks.reduce((latest, task) => (task.createdAt > latest.createdAt ? task : latest))
}
