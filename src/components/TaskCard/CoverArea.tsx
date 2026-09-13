import type { TaskRecord } from '../../types'
import { cancelTask, useStore } from '../../store'

interface Props {
  task: TaskRecord
  /** useLazyCoverImage 产出的封面图源(objectURL/dataUrl);空串表示未加载 */
  thumbSrc: string
  coverRatio: string
  coverSize: string
  /** MM:SS 计时文本(running 走表,结束态读 elapsed) */
  duration: string
}

/** 4:3 预览画布：图片完整呈现，计时与真实输出张数不会因视觉裁切而丢失。 */
export default function CoverArea({ task, thumbSrc, coverRatio, coverSize, duration }: Props) {
  const showRunningTimer = task.status === 'running'
  // cancel.ts 以 error + 此专属消息记录主动取消；精确匹配，避免把上游含“取消”的报错误认成取消。
  const isCancelled = task.status === 'error' && task.error === '已取消生成'
  // 自动重试瞬态徽标:仅 running 时订阅有意义;条目对象整体替换,zustand 引用比较天然精确
  const retryInfo = useStore((s) =>
    task.status === 'running' ? s.taskRetryInfo[task.id] : undefined,
  )

  return (
    <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-surface-muted">
      {task.status === 'running' && (
        <div className="flex flex-col items-center gap-2">
          <svg
            className="h-8 w-8 animate-spin text-brand-ink motion-reduce:animate-none"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <span className="text-xs text-content-muted">
            {retryInfo ? `第 ${retryInfo.attempt}/${retryInfo.maxAttempts} 次重试中` : '生成中...'}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              cancelTask(task.id)
            }}
            className="ui-button mt-0.5 text-content-muted hover:text-red-600 dark:hover:text-red-400"
          >
            取消
          </button>
        </div>
      )}
      {task.status === 'error' && (
        <div className="flex flex-col items-center gap-1 px-2">
          <svg
            className={`w-7 h-7 ${isCancelled ? 'text-content-muted' : 'text-red-400'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d={
                isCancelled
                  ? 'M8 12h8m5 0a9 9 0 11-18 0 9 9 0 0118 0z'
                  : 'M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
              }
            />
          </svg>
          <span
            className={`text-center text-xs leading-tight ${isCancelled ? 'text-content-muted' : 'text-red-600 dark:text-red-400'}`}
          >
            {isCancelled ? '已取消' : '失败'}
          </span>
        </div>
      )}
      {task.status === 'done' && thumbSrc && (
        <>
          <img
            src={thumbSrc}
            // 供 ImageContextMenu 按 id 重取:blob: src 在菜单打开期间可能因卡片卸载被 revoke
            data-image-id={task.outputImages?.[0]}
            className="saveable-image h-full w-full object-contain"
            loading="lazy"
            alt={task.prompt ? `生成图片：${task.prompt.slice(0, 80)}` : '生成图片'}
          />
          {task.outputImages.length > 1 && (
            <span className="absolute bottom-2 right-2 rounded-md bg-surface/95 px-2 py-1 text-xs font-medium text-content">
              {task.outputImages.length} 张输出
            </span>
          )}
        </>
      )}
      {task.status === 'done' && !thumbSrc && (
        <svg
          className="h-8 w-8 text-content-subtle"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      )}
      {/* 运行中显示耗时，完成后显示封面图比例与分辨率标签 */}
      <div className="absolute left-2 top-2 flex max-w-[calc(100%-68px)] flex-wrap items-center gap-1">
        {showRunningTimer || task.status !== 'done' || !coverRatio || !coverSize ? (
          <span className="flex items-center gap-1 rounded-md bg-surface/95 px-2 py-1 font-mono text-xs text-content-muted">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            {duration}
          </span>
        ) : (
          <>
            <span className="rounded-md bg-surface/95 px-2 py-1 font-mono text-xs text-content-muted">
              {coverRatio}
            </span>
            <span className="rounded-md bg-surface/95 px-2 py-1 text-xs font-medium text-content-muted">
              {coverSize}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
