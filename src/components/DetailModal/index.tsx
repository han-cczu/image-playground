import { useEffect, useState, useMemo } from 'react'
import { useStore } from '../../store'
import Modal, { ModalCloseButton } from '../Modal'
import { findChildTasks, findParentTasks } from '../../lib/lineage'
import { useDetailImages, useMaskPreview, useRunningNow } from './hooks'
import ImagePanel from './ImagePanel'
import InfoPanel from './InfoPanel'
import ActionBar from './ActionBar'

export default function DetailModal() {
  const tasks = useStore((s) => s.tasks)
  const detailTaskId = useStore((s) => s.detailTaskId)
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)

  const [imageIndex, setImageIndex] = useState(0)

  const task = useMemo(
    () => tasks.find((t) => t.id === detailTaskId) ?? null,
    [tasks, detailTaskId],
  )

  // 创作血缘:读时按内容寻址 id 求交推断父/子任务（零持久化字段）。
  const parentLinks = useMemo(() => (task ? findParentTasks(task, tasks) : []), [task, tasks])
  const childLinks = useMemo(() => (task ? findChildTasks(task, tasks) : []), [task, tasks])

  // Reset index when task changes
  useEffect(() => {
    setImageIndex(0)
  }, [detailTaskId])

  const now = useRunningNow(task?.status)

  const currentOutputImageId = task?.outputImages?.[imageIndex] || ''
  const { imageSrcs, imageRatios, imageSizes } = useDetailImages(task, currentOutputImageId)
  const currentOutputImageSrc = currentOutputImageId ? imageSrcs[currentOutputImageId] || '' : ''
  const maskTargetId = task?.maskTargetImageId || null
  const maskTargetSrc = maskTargetId ? imageSrcs[maskTargetId] || '' : ''
  const maskSrc = task?.maskImageId ? imageSrcs[task.maskImageId] || '' : ''
  const maskPreviewSrc = useMaskPreview(maskTargetSrc, maskSrc)

  if (!task) return null

  const currentImageRatio = currentOutputImageId ? imageRatios[currentOutputImageId] : ''
  const currentImageSize = currentOutputImageId ? imageSizes[currentOutputImageId] : ''

  const formatDuration = () => {
    if (task.status === 'running') {
      const seconds = Math.max(0, Math.floor((now - task.createdAt) / 1000))
      const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
      const ss = String(seconds % 60).padStart(2, '0')
      return `${mm}:${ss}`
    }
    if (task.elapsed == null) return null
    const seconds = Math.floor(task.elapsed / 1000)
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
    const ss = String(seconds % 60).padStart(2, '0')
    return `${mm}:${ss}`
  }
  // 各处展示共用同一份耗时文案(纯函数,运行中由 now 驱动每秒重算)
  const durationText = formatDuration()

  return (
    <Modal
      onClose={() => setDetailTaskId(null)}
      ariaLabel="记录详情"
      tone="deep"
      panelClassName="w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col md:flex-row"
    >
        <div className="flex h-14 items-center justify-end px-4 md:hidden">
          <ModalCloseButton
            onClick={() => setDetailTaskId(null)}
            iconClassName="w-6 h-6"
          />
        </div>

        {/* 左侧：图片 */}
        <ImagePanel
          task={task}
          imageIndex={imageIndex}
          setImageIndex={setImageIndex}
          currentOutputImageSrc={currentOutputImageSrc}
          currentImageRatio={currentImageRatio}
          currentImageSize={currentImageSize}
          durationText={durationText}
        />

        {/* 右侧：信息 */}
        <div className="md:w-1/2 w-full p-5 overflow-y-auto flex flex-col">
          <button
            onClick={() => setDetailTaskId(null)}
            className="absolute top-3 right-3 hidden p-1 rounded-full hover:bg-gray-100 dark:hover:bg-white/[0.06] transition text-gray-400 z-10 md:block"
            aria-label="关闭"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <InfoPanel
            task={task}
            parentLinks={parentLinks}
            childLinks={childLinks}
            imageSrcs={imageSrcs}
            maskPreviewSrc={maskPreviewSrc}
            currentOutputImageId={currentOutputImageId}
            durationText={durationText}
          />

          {/* 操作按钮 */}
          <ActionBar task={task} />
        </div>
    </Modal>
  )
}
