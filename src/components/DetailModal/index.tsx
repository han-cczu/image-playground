import { useState, useMemo } from 'react'
import { useStore } from '../../store'
import Modal, { ModalCloseButton, ModalTitle } from '../Modal'
import { findChildTasks, findParentTasks } from '../../lib/lineage'
import { useDetailImages, useMaskPreview, useRunningNow } from './hooks'
import ImagePanel from './ImagePanel'
import InfoPanel from './InfoPanel'
import ActionBar from './ActionBar'

export default function DetailModal() {
  const tasks = useStore((s) => s.tasks)
  const detailTaskId = useStore((s) => s.detailTaskId)
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)

  const task = useMemo(
    () => tasks.find((t) => t.id === detailTaskId) ?? null,
    [tasks, detailTaskId],
  )

  // 创作血缘:读时按内容寻址 id 求交推断父/子任务（零持久化字段）。
  const parentLinks = useMemo(() => (task ? findParentTasks(task, tasks) : []), [task, tasks])
  const childLinks = useMemo(() => (task ? findChildTasks(task, tasks) : []), [task, tasks])

  if (!task) return null

  return (
    <DetailModalPanel
      key={task.id}
      task={task}
      parentLinks={parentLinks}
      childLinks={childLinks}
      onClose={() => setDetailTaskId(null)}
    />
  )
}

function DetailModalPanel({
  task,
  parentLinks,
  childLinks,
  onClose,
}: {
  task: NonNullable<ReturnType<typeof useStore.getState>['tasks'][number]>
  parentLinks: ReturnType<typeof findParentTasks>
  childLinks: ReturnType<typeof findChildTasks>
  onClose: () => void
}) {
  const [imageIndex, setImageIndex] = useState(0)

  const now = useRunningNow(task?.status)

  const currentOutputImageId = task?.outputImages?.[imageIndex] || ''
  const { imageSrcs, imageRatios, imageSizes } = useDetailImages(task, currentOutputImageId)
  const currentOutputImageSrc = currentOutputImageId ? imageSrcs[currentOutputImageId] || '' : ''
  const maskTargetId = task?.maskTargetImageId || null
  const maskTargetSrc = maskTargetId ? imageSrcs[maskTargetId] || '' : ''
  const maskSrc = task?.maskImageId ? imageSrcs[task.maskImageId] || '' : ''
  const maskPreviewSrc = useMaskPreview(maskTargetSrc, maskSrc)

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
      onClose={onClose}
      ariaLabel="记录详情"
      tone="deep"
      panelClassName="flex max-h-[90dvh] w-full max-w-[1120px] flex-col overflow-hidden"
    >
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-4 py-3 md:px-5">
        <div className="min-w-0">
          <ModalTitle>作品详情</ModalTitle>
          <p className="mt-1 truncate text-xs text-content-muted">
            {task.apiModel || '图像创作'}
            {task.outputImages.length > 0 ? ` · ${task.outputImages.length} 张输出` : ''}
          </p>
        </div>
        <ModalCloseButton onClick={onClose} />
      </div>

      {/* 桌面高度跟随可用视口，图片不设刚性最小高度；低高度窗口仍能完整缩放预览。 */}
      <div className="custom-scrollbar min-h-0 overflow-y-auto md:flex md:h-[min(680px,72dvh)] md:overflow-hidden">
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
        <div className="flex min-h-0 w-full flex-col border-t border-line md:w-[340px] md:shrink-0 md:border-l md:border-t-0 lg:w-[360px]">
          <div className="custom-scrollbar min-h-0 p-5 md:overflow-y-auto">
            <InfoPanel
              task={task}
              parentLinks={parentLinks}
              childLinks={childLinks}
              imageSrcs={imageSrcs}
              maskPreviewSrc={maskPreviewSrc}
              currentOutputImageId={currentOutputImageId}
              durationText={durationText}
            />
          </div>
          {/* 操作按钮 */}
          <ActionBar task={task} />
        </div>
      </div>
    </Modal>
  )
}
