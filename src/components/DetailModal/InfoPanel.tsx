import { useStore, updateTaskInStore, showCodexCliPrompt, getCodexCliPromptKey } from '../../store'
import { ActualValueBadge, DetailParamValue } from '../../lib/paramDisplay'
import {
  copyBlobToClipboard,
  copyTextToClipboard,
  getClipboardFailureMessage,
} from '../../lib/image/clipboard'
import type { LineageLink } from '../../lib/lineage'
import FavoriteCategoryMenu from '../FavoriteCategoryMenu'
import type { TaskRecord, TaskParams } from '../../types'
import { MAX_INPUT_IMAGE_BYTES } from '../../lib/taskRuntime'

const REFERENCE_IMAGE_FETCH_TIMEOUT_MS = 60_000

interface InfoPanelProps {
  task: TaskRecord
  parentLinks: LineageLink[]
  childLinks: LineageLink[]
  /** 图片 id → 可渲染 src(cache-first 加载结果),供参考图与血缘缩略图共用 */
  imageSrcs: Record<string, string>
  maskPreviewSrc: string
  currentOutputImageId: string
  /** 耗时文案;无 elapsed 记录时为 null */
  durationText: string | null
}

/** 参数网格单元卡片:标签 + 参数值(原参数区重复 5 次的同构 JSX 收口于此) */
function ParamCard({
  task,
  label,
  paramKey,
  actualParams,
}: {
  task: TaskRecord
  label: string
  paramKey: keyof TaskParams
  actualParams?: Partial<TaskParams>
}) {
  return (
    <div className="bg-surface-muted dark:bg-surface-raised rounded-lg px-3 py-2">
      <span className="text-content-subtle dark:text-content-subtle">{label}</span>
      <br />
      <DetailParamValue
        task={task}
        paramKey={paramKey}
        className="font-medium"
        actualParams={actualParams}
      />
    </div>
  )
}

function assertReferenceImageSize(bytes: number) {
  if (bytes > MAX_INPUT_IMAGE_BYTES) {
    throw new Error(`图片过大:超过 ${Math.round(MAX_INPUT_IMAGE_BYTES / 1024 / 1024)}MB 上限`)
  }
}

function createAbortError(): DOMException {
  return new DOMException('aborted', 'AbortError')
}

function readBlobWithAbort(response: Response, signal: AbortSignal): Promise<Blob> {
  if (signal.aborted) throw createAbortError()
  if (!response.body) {
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(createAbortError())
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        response
          .blob()
          .then(resolve, reject)
          .finally(() => {
            signal.removeEventListener('abort', onAbort)
          })
      } catch (err) {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      }
    })
  }

  return new Promise((resolve, reject) => {
    const reader = response.body!.getReader()
    const chunks: Uint8Array[] = []
    let bytes = 0
    let settled = false
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
      try {
        reader.releaseLock()
      } catch {
        /* Ignore cleanup errors; abort/read failures carry the useful signal. */
      }
    }
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }
    const onAbort = () => {
      void reader.cancel().catch(() => undefined)
      finish(() => reject(createAbortError()))
    }
    signal.addEventListener('abort', onAbort, { once: true })

    const pump = (): void => {
      try {
        reader.read().then(
          ({ done, value }) => {
            if (done) {
              finish(() =>
                resolve(
                  new Blob(
                    chunks.map((chunk) => new Uint8Array(chunk)),
                    { type: response.headers.get('Content-Type') || 'application/octet-stream' },
                  ),
                ),
              )
              return
            }
            if (value) {
              bytes += value.byteLength
              if (bytes > MAX_INPUT_IMAGE_BYTES) {
                void reader.cancel().catch(() => undefined)
                finish(() =>
                  reject(
                    new Error(
                      `图片过大:超过 ${Math.round(MAX_INPUT_IMAGE_BYTES / 1024 / 1024)}MB 上限`,
                    ),
                  ),
                )
                return
              }
              chunks.push(value)
            }
            pump()
          },
          (err) => finish(() => reject(err)),
        )
      } catch (err) {
        finish(() => reject(err))
      }
    }
    pump()
  })
}

async function fetchReferenceImageBlob(src: string): Promise<Blob> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REFERENCE_IMAGE_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(src, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const contentLength = Number(res.headers.get('Content-Length'))
    if (Number.isFinite(contentLength)) assertReferenceImageSize(contentLength)
    const blob = await readBlobWithAbort(res, controller.signal)
    if (!blob.type.startsWith('image/')) throw new Error('不是有效的图片文件')
    assertReferenceImageSize(blob.size)
    return blob
  } catch (err) {
    if (controller.signal.aborted) throw new Error('图片读取超时', { cause: err })
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

/** 血缘链接卡片:共享图缩略图 + 状态点 + 提示词,点击替换式跳到对应任务详情 */
function LineageLinkButton({
  link,
  src,
  onOpen,
}: {
  link: LineageLink
  src: string
  onOpen: (taskId: string) => void
}) {
  const statusColor =
    link.task.status === 'done'
      ? 'bg-green-400'
      : link.task.status === 'error'
        ? 'bg-red-400'
        : 'bg-brand'
  return (
    <button
      onClick={() => onOpen(link.task.id)}
      className="flex max-w-[180px] items-center gap-2 rounded-lg border border-line p-1 pr-2.5 transition hover:bg-surface-muted dark:border-line dark:hover:bg-surface-raised"
      title={link.task.prompt || '(无提示词)'}
    >
      <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-surface-muted dark:bg-black/20">
        {src && <img src={src} className="h-full w-full object-cover" alt="" />}
        <span
          className={`absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full ring-1 ring-white dark:ring-line ${statusColor}`}
        />
      </span>
      <span className="min-w-0 truncate text-xs text-content dark:text-content">
        {link.task.prompt || '(无提示词)'}
      </span>
    </button>
  )
}

/** 右侧信息面板:提示词、参考图、创作血缘、参数网格、时间与收藏分类 */
export default function InfoPanel({
  task,
  parentLinks,
  childLinks,
  imageSrcs,
  maskPreviewSrc,
  currentOutputImageId,
  durationText,
}: InfoPanelProps) {
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const setLineageTaskId = useStore((s) => s.setLineageTaskId)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const settings = useStore((s) => s.settings)
  const dismissedCodexCliPrompts = useStore((s) => s.dismissedCodexCliPrompts)
  const favoriteCategories = useStore((s) => s.favoriteCategories)

  const maskTargetId = task.maskTargetImageId || null
  const allInputImageIds = task.inputImageIds ?? []

  const outputLen = task.outputImages?.length || 0
  const currentActualParams = currentOutputImageId
    ? task.actualParamsByImage?.[currentOutputImageId]
    : undefined
  const currentRevisedPrompt = currentOutputImageId
    ? task.revisedPromptByImage?.[currentOutputImageId]?.trim()
    : ''
  const showRevisedPrompt = Boolean(
    currentRevisedPrompt && currentRevisedPrompt !== task.prompt.trim(),
  )
  const codexCliPromptKey = getCodexCliPromptKey(settings)
  const hasHandledPromptWarning =
    settings.codexCli || dismissedCodexCliPrompts.includes(codexCliPromptKey)
  const showPromptWarning = Boolean(
    currentOutputImageId &&
    (!currentRevisedPrompt || showRevisedPrompt) &&
    !hasHandledPromptWarning,
  )
  const aggregateActualParams =
    outputLen > 0 ? { ...task.actualParams, n: outputLen } : task.actualParams
  const taskProvider = task.apiProvider
  const taskProviderName = taskProvider === 'gemini' ? 'Gemini' : taskProvider ? 'OpenAI' : '未知'
  const taskProfileName = task.apiProfileName || '未知'
  const taskModel = task.apiModel || '未知'
  const showSourceInfo = Boolean(task.apiProvider || task.apiProfileName || task.apiModel)
  const currentCategory = task.favoriteCategoryId
    ? favoriteCategories.find((category) => category.id === task.favoriteCategoryId)
    : null

  const formatTime = (ts: number | null) => {
    if (!ts) return ''
    return new Date(ts).toLocaleString('zh-CN')
  }

  const handleCopyPrompt = async () => {
    if (!task.prompt) return
    try {
      await copyTextToClipboard(task.prompt)
      useStore.getState().showToast('提示词已复制', 'success')
    } catch (err) {
      useStore.getState().showToast(getClipboardFailureMessage('复制提示词失败', err), 'error')
    }
  }

  const handleShowPromptWarning = () => {
    showCodexCliPrompt(
      true,
      currentRevisedPrompt ? '接口返回的提示词已被改写' : '接口没有返回官方 API 会返回的部分信息',
    )
  }

  const handleCopyInputImage = async () => {
    const imgId = allInputImageIds[0]
    const src = imgId ? imageSrcs[imgId] : ''
    if (!src) return
    try {
      // 取图链作为 Promise 传入,clipboard.write 留在点击手势的同步段内(Safari 用户激活要求)
      await copyBlobToClipboard(fetchReferenceImageBlob(src))
      useStore.getState().showToast('参考图已复制', 'success')
    } catch (err) {
      console.error(err)
      useStore.getState().showToast(getClipboardFailureMessage('复制参考图失败', err), 'error')
    }
  }

  const handleCategoryChange = (categoryId: string | null) => {
    void updateTaskInStore(task.id, {
      isFavorite: categoryId ? true : task.isFavorite,
      favoriteCategoryId: categoryId,
    }).catch(() => {
      /* updateTaskInStore already surfaced the persistence error */
    })
  }

  return (
    <div data-selectable-text className="min-w-0 flex-1 break-words text-content">
      <div className="flex items-center gap-1.5 mb-2">
        <h3 className="text-xs font-semibold text-content-muted">输入内容</h3>
        {task.prompt && (
          <button
            onClick={handleCopyPrompt}
            className="ui-icon-button -my-2 text-content-muted"
            title="复制提示词"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          </button>
        )}
        {showPromptWarning && (
          <span className="relative inline-flex">
            <button
              type="button"
              className="p-1 rounded text-amber-500 hover:bg-amber-50 dark:text-yellow-300 dark:hover:bg-yellow-500/10 transition"
              onClick={handleShowPromptWarning}
              aria-label="提示词已被改写"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                />
              </svg>
            </button>
          </span>
        )}
      </div>
      <p className="text-sm text-content dark:text-content leading-relaxed whitespace-pre-wrap mb-4">
        {task.prompt || '(无提示词)'}
      </p>
      {showRevisedPrompt && currentRevisedPrompt && (
        <div className="mb-4">
          <ActualValueBadge
            value={currentRevisedPrompt}
            className="max-w-full rounded px-2 py-1 text-left text-xs leading-relaxed whitespace-pre-wrap"
          />
        </div>
      )}

      {/* 参考图 */}
      {allInputImageIds.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-1.5 mb-2">
            <h3 className="text-xs font-semibold text-content-muted">参考图</h3>
            <button
              onClick={handleCopyInputImage}
              className="ui-icon-button -my-2 text-content-muted"
              title="复制参考图"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            </button>
          </div>
          <div className="flex gap-2 flex-wrap">
            {allInputImageIds.map((imgId, index) => {
              const isMaskTarget = imgId === maskTargetId
              const displaySrc =
                isMaskTarget && maskPreviewSrc ? maskPreviewSrc : imageSrcs[imgId] || ''
              return (
                <div key={`${imgId}-${index}`} className="relative group inline-block">
                  <button
                    type="button"
                    className={`relative block w-16 h-16 rounded-lg overflow-hidden border cursor-pointer hover:opacity-80 transition ${
                      isMaskTarget
                        ? 'border-brand border-2 shadow-sm'
                        : 'border-line dark:border-line'
                    }`}
                    onClick={() => setLightboxImageId(imgId, allInputImageIds)}
                    aria-label={isMaskTarget ? '放大查看参考图(遮罩目标)' : '放大查看参考图'}
                    title="点击放大"
                  >
                    {displaySrc && (
                      <img src={displaySrc} className="w-full h-full object-cover" alt="" />
                    )}
                    {isMaskTarget && (
                      <span className="absolute left-1 top-1 rounded bg-brand px-1.5 py-0.5 text-[8px] leading-none text-on-brand font-bold tracking-wider backdrop-blur-sm z-10 pointer-events-none">
                        MASK
                      </span>
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 创作血缘(单跳预览 + 完整谱系入口) */}
      {(parentLinks.length > 0 || childLinks.length > 0) && (
        <div className="mb-4 space-y-3">
          {parentLinks.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-content-muted mb-2">派生自</h3>
              <div className="flex flex-wrap gap-2">
                {parentLinks.map((link) => (
                  <LineageLinkButton
                    key={link.task.id}
                    link={link}
                    src={imageSrcs[link.sharedImageIds[0]] || ''}
                    onOpen={setDetailTaskId}
                  />
                ))}
              </div>
            </div>
          )}
          {childLinks.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-content-muted mb-2">衍生出</h3>
              <div className="flex flex-wrap gap-2">
                {childLinks.map((link) => (
                  <LineageLinkButton
                    key={link.task.id}
                    link={link}
                    src={imageSrcs[link.sharedImageIds[0]] || ''}
                    onOpen={setDetailTaskId}
                  />
                ))}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              // 替换式打开谱系树:关 DetailModal,以当前 task 为中心
              const id = task.id
              setDetailTaskId(null)
              setLineageTaskId(id)
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand bg-brand-soft px-2.5 py-1.5 text-xs font-medium text-brand-ink transition hover:bg-brand-soft dark:border-brand dark:bg-brand-soft dark:text-brand-ink dark:hover:bg-brand-soft"
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="5" r="2.5" />
              <circle cx="6" cy="19" r="2.5" />
              <circle cx="18" cy="19" r="2.5" />
              <path d="M12 7.5v3M12 10.5 6.8 16.6M12 10.5l5.2 6.1" />
            </svg>
            查看完整谱系
          </button>
        </div>
      )}

      {/* 参数 */}
      <h3 className="text-xs font-semibold text-content-muted mb-2">参数配置</h3>
      {showSourceInfo && (
        <div className="mb-2 rounded-lg bg-surface-muted px-3 py-2 text-xs dark:bg-surface-raised">
          <span className="text-content-subtle dark:text-content-subtle">来源</span>
          <br />
          <span className="font-medium text-content dark:text-content">{taskProviderName}</span>
          <span className="text-content-subtle dark:text-content-subtle">
            {' '}
            · {taskProfileName} · {taskModel}
          </span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 text-xs mb-4">
        <ParamCard task={task} label="尺寸" paramKey="size" actualParams={currentActualParams} />
        <ParamCard task={task} label="质量" paramKey="quality" actualParams={currentActualParams} />
        <ParamCard
          task={task}
          label="格式"
          paramKey="output_format"
          actualParams={currentActualParams}
        />
        <ParamCard
          task={task}
          label="审核"
          paramKey="moderation"
          actualParams={currentActualParams}
        />
        <ParamCard task={task} label="数量" paramKey="n" actualParams={aggregateActualParams} />
        {task.params.output_compression != null && (
          <ParamCard
            task={task}
            label="压缩率"
            paramKey="output_compression"
            actualParams={currentActualParams}
          />
        )}
      </div>

      {/* 时间 */}
      <div className="text-xs text-content-subtle dark:text-content-subtle mb-4">
        <span>创建于 {formatTime(task.createdAt)}</span>
        {durationText && <span> · 耗时 {durationText}</span>}
      </div>

      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold text-content-muted">收藏分类</span>
          {currentCategory && task.isFavorite && (
            <span
              className="flex min-w-0 max-w-[55%] items-center gap-1 text-[10px] text-content-subtle dark:text-content-subtle"
              title={currentCategory.name}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: currentCategory.color }}
              />
              <span className="min-w-0 truncate">
                {currentCategory.name.trim() || '未命名分类'}
              </span>
            </span>
          )}
        </div>
        <FavoriteCategoryMenu
          value={task.favoriteCategoryId ?? null}
          includeUnassigned
          includeDefaultFallback
          onSelect={handleCategoryChange}
          menuClassName="w-full"
          matchTriggerWidth
          renderTrigger={({ isOpen, label, selectedCategory, toggle }) => (
            <button
              type="button"
              onClick={toggle}
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-content outline-none transition hover:bg-surface-muted focus:border-brand dark:border-line dark:bg-surface-raised dark:text-content dark:hover:bg-surface-raised dark:focus:border-brand"
              title={label}
            >
              <span className="flex min-w-0 items-center gap-2">
                {selectedCategory ? (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: selectedCategory.color }}
                  />
                ) : (
                  <span className="h-2 w-2 shrink-0 rounded-full border border-dashed border-line dark:border-line" />
                )}
                <span className="min-w-0 truncate">{label}</span>
              </span>
              <svg
                className={`h-3.5 w-3.5 shrink-0 text-content-subtle transition-transform duration-200 dark:text-content-subtle ${isOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
          )}
        />
      </div>
    </div>
  )
}
