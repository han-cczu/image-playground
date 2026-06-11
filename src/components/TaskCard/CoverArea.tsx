import type { TaskRecord } from '../../types'
import { cancelTask } from '../../store'

interface Props {
  task: TaskRecord
  /** useLazyCoverImage 产出的封面图源(objectURL/dataUrl);空串表示未加载 */
  thumbSrc: string
  coverRatio: string
  coverSize: string
  /** MM:SS 计时文本(running 走表,结束态读 elapsed) */
  duration: string
}

/** 左侧图片区域:运行中转圈(可取消)/失败图标/完成封面,左上角耗时或比例+分辨率标签 */
export default function CoverArea({ task, thumbSrc, coverRatio, coverSize, duration }: Props) {
  const showRunningTimer = task.status === 'running'

  return (
    <div className="w-40 min-w-[10rem] h-full bg-gray-100 dark:bg-black/20 relative flex items-center justify-center overflow-hidden flex-shrink-0">
      {task.status === 'running' && (
        <div className="flex flex-col items-center gap-2">
          <svg
            className="w-8 h-8 text-blue-400 animate-spin"
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
          <span className="text-xs text-gray-400 dark:text-gray-500">生成中...</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              cancelTask(task.id)
            }}
            className="mt-0.5 rounded-full px-2 py-0.5 text-[11px] text-gray-500 transition hover:bg-gray-200 hover:text-red-500 dark:text-gray-400 dark:hover:bg-white/10"
          >
            取消
          </button>
        </div>
      )}
      {task.status === 'error' && (
        <div className="flex flex-col items-center gap-1 px-2">
          <svg
            className="w-7 h-7 text-red-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="text-xs text-red-400 text-center leading-tight">
            失败
          </span>
        </div>
      )}
      {task.status === 'done' && thumbSrc && (
        <>
          <img
            src={thumbSrc}
            // 供 ImageContextMenu 按 id 重取:blob: src 在菜单打开期间可能因卡片卸载被 revoke
            data-image-id={task.outputImages?.[0]}
            className="saveable-image w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.06]"
            loading="lazy"
            alt=""
          />
          {task.outputImages.length > 1 && (
            <span className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
              {task.outputImages.length}
            </span>
          )}
        </>
      )}
      {task.status === 'done' && !thumbSrc && (
        <svg
          className="w-8 h-8 text-gray-300"
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
      <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
        {showRunningTimer || task.status !== 'done' || !coverRatio || !coverSize ? (
          <span className="flex items-center gap-1 bg-black/50 text-white text-[10px] sm:text-xs px-1.5 py-0.5 rounded backdrop-blur-sm font-mono">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {duration}
          </span>
        ) : (
          <>
            <span className="bg-black/50 text-white text-[10px] sm:text-xs px-1.5 py-0.5 rounded backdrop-blur-sm font-mono">
              {coverRatio}
            </span>
            <span className="bg-black/50 text-white/90 text-[10px] sm:text-xs px-1.5 py-0.5 rounded backdrop-blur-sm font-medium">
              {coverSize}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
