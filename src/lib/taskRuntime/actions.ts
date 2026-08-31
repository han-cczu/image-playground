/**
 * 卡片级任务操作:重试 / 复用配置 / 编辑输出(taskRuntime 拆分轮,见 shared.ts 头注释)。
 * retryTask 同时依赖 submit(单条重试)与 grid(网格补跑分支),故单独成模块避免 submit↔grid 环。
 */
import type { InputImage, TaskRecord } from '../../types'
import { useStore } from '../../store'
import { getActiveApiProfile } from '../api/apiProfiles'
import { normalizeParamsForSettings } from '../api/paramCompatibility'
import { ensureImageCached } from '../imageCache'
import { ARCHIVE_CONVERSATION_ID } from '../conversations'
import { MAX_INPUT_IMAGES_PER_SUBMISSION } from '../tasks'
import { enqueueTask, executeTask } from './submit'
import { retryGridCell } from './grid'

/** 重试失败的任务：创建新任务并执行 */
export async function retryTask(task: TaskRecord) {
  // 网格 task 重试走补跑分支:结果回到矩阵原坐标(否则跑出矩阵成散图)。
  if (task.batchId && task.gridCoord) {
    retryGridCell(task.batchId, task.gridCoord, task)
    return
  }
  const { settings, activeConversationId } = useStore.getState()
  const activeProfile = getActiveApiProfile(settings)
  // 复用 enqueueTask 原语(含写失败回滚)。重试不继承 batchId:视为一次新的独立生成。
  const id = await enqueueTask({
    prompt: task.prompt,
    params: normalizeParamsForSettings(task.params, settings),
    apiProvider: activeProfile.provider,
    apiProfileId: activeProfile.id,
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
  const { settings, setPrompt, setInputImages, setMaskDraft, clearMaskDraft } = useStore.getState()
  setPrompt(task.prompt)
  useStore.setState({ params: normalizeParamsForSettings(task.params, settings) })

  // 恢复输入图片
  const imgs: InputImage[] = []
  let failedImages = 0
  let skippedImages = 0
  const seenInputImageIds = new Set<string>()
  for (const imgId of task.inputImageIds) {
    if (seenInputImageIds.has(imgId)) continue
    seenInputImageIds.add(imgId)
    if (imgs.length >= MAX_INPUT_IMAGES_PER_SUBMISSION) {
      skippedImages++
      continue
    }
    let dataUrl: string | undefined
    try {
      dataUrl = await ensureImageCached(imgId)
    } catch {
      failedImages++
      continue
    }
    if (dataUrl) {
      imgs.push({ id: imgId, dataUrl })
    } else {
      failedImages++
    }
  }
  setInputImages(imgs)
  const maskTargetImageId =
    task.maskTargetImageId ?? (task.maskImageId ? task.inputImageIds[0] : null)
  if (maskTargetImageId && task.maskImageId && imgs.some((img) => img.id === maskTargetImageId)) {
    let maskDataUrl: string | undefined
    try {
      maskDataUrl = await ensureImageCached(task.maskImageId)
    } catch {
      failedImages++
    }
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
  if (failedImages) {
    useStore.getState().showToast(`已复用配置，但 ${failedImages} 张图片无法读取`, 'error')
    return
  }
  if (skippedImages) {
    useStore
      .getState()
      .showToast(`已复用配置，但超过上限的 ${skippedImages} 张参考图未加入`, 'error')
    return
  }
  useStore.getState().showToast('已复用配置到输入框', 'success')
}

/** 编辑输出：将输出图加入输入 */
export async function editOutputs(task: TaskRecord) {
  const { inputImages, addInputImage } = useStore.getState()
  if (!task.outputImages?.length) return

  let added = 0
  let failed = 0
  let skippedFull = 0
  const seenImageIds = new Set(inputImages.map((image) => image.id))
  for (const imgId of task.outputImages) {
    if (seenImageIds.has(imgId)) continue
    if (useStore.getState().inputImages.length >= MAX_INPUT_IMAGES_PER_SUBMISSION) {
      seenImageIds.add(imgId)
      skippedFull++
      continue
    }
    let dataUrl: string | undefined
    try {
      dataUrl = await ensureImageCached(imgId)
    } catch {
      failed++
      continue
    }
    if (dataUrl) {
      const beforeInputCount = useStore.getState().inputImages.length
      addInputImage({ id: imgId, dataUrl })
      const afterInputImages = useStore.getState().inputImages
      const isNowInput = afterInputImages.some((image) => image.id === imgId)
      if (isNowInput) seenImageIds.add(imgId)
      if (isNowInput && afterInputImages.length > beforeInputCount) {
        added++
      } else if (!isNowInput && afterInputImages.length >= MAX_INPUT_IMAGES_PER_SUBMISSION) {
        seenImageIds.add(imgId)
        skippedFull++
      }
    } else {
      failed++
    }
  }
  if (failed) {
    useStore.getState().showToast(`添加输出图失败：${failed} 张图片无法读取`, 'error')
    return
  }
  if (skippedFull && added === 0) {
    useStore
      .getState()
      .showToast(`参考图数量已达上限（${MAX_INPUT_IMAGES_PER_SUBMISSION} 张）`, 'error')
    return
  }
  if (added === 0) {
    useStore.getState().showToast('输出图已在输入中', 'info')
    return
  }
  useStore.getState().showToast(`已添加 ${added} 张输出图到输入`, 'success')
}
