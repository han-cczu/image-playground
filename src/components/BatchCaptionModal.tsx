import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, getCachedImage, ensureImageCached } from '../store'
import Modal, { ModalCloseButton, ModalHeaderBar, ModalTitle } from './Modal'
import { mapWithConcurrency } from '../lib/concurrency'
import { captionImageStream } from '../lib/api/captionImageApi'

type ItemStatus = 'pending' | 'running' | 'done' | 'error'
interface BatchItem {
  imageId: string
  status: ItemStatus
  text: string
  error: string
}

/**
 * 批量反推:对选中的多张图并发反推(复用 settings.batchConcurrency + mapWithConcurrency),
 * 每图独立 AbortController,逐图卡片展示结果,可单条复制 / 一键全部存为片段库。
 * 不复用 runEnqueuedTasks(反推不产 TaskRecord);批量路径不订阅 onDelta(只取全文,降 N 路渲染)。
 * 照搬 CompareModal 骨架:外层开关 + 内层 key 重置 + Modal 原语。
 */
export default function BatchCaptionModal() {
  const captionBatchImageIds = useStore((s) => s.captionBatchImageIds)
  const setCaptionBatchImageIds = useStore((s) => s.setCaptionBatchImageIds)

  if (!captionBatchImageIds || captionBatchImageIds.length === 0) return null
  return (
    <BatchCaptionPanel
      key={captionBatchImageIds.join(',')}
      imageIds={captionBatchImageIds}
      close={() => setCaptionBatchImageIds(null)}
    />
  )
}

function BatchCaptionPanel({ imageIds, close }: { imageIds: string[]; close: () => void }) {
  const captioner = useStore((s) => s.settings.captioner)
  const batchConcurrency = useStore((s) => s.settings.batchConcurrency)
  const createSnippet = useStore((s) => s.createSnippet)
  const showToast = useStore((s) => s.showToast)

  const [items, setItems] = useState<BatchItem[]>(() =>
    imageIds.map((imageId) => ({ imageId, status: 'pending', text: '', error: '' })),
  )
  const controllersRef = useRef<AbortController[]>([])
  const [running, setRunning] = useState(true)

  // 缩略图 cache-first(照搬 CompareModal)
  const [thumbs, setThumbs] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const id of imageIds) {
      const cached = getCachedImage(id)
      if (cached) initial[id] = cached
    }
    return initial
  })
  useEffect(() => {
    let cancelled = false
    for (const id of imageIds) {
      if (getCachedImage(id)) continue
      ensureImageCached(id).then((url) => {
        if (!cancelled && url) setThumbs((prev) => (prev[id] ? prev : { ...prev, [id]: url }))
      })
    }
    return () => {
      cancelled = true
    }
  }, [imageIds])

  const update = (imageId: string, patch: Partial<BatchItem>) =>
    setItems((prev) => prev.map((it) => (it.imageId === imageId ? { ...it, ...patch } : it)))

  const apiKeyMissing = !captioner.apiKey.trim()

  // 批量反推:并发闸复用 settings.batchConcurrency,每图独立 AbortController
  useEffect(() => {
    // 未配置 key:不发 N 个必失败请求,统一标记一次(前置校验,见下方提示条)
    if (apiKeyMissing) {
      setRunning(false)
      return
    }
    let disposed = false
    const controllers = imageIds.map(() => new AbortController())
    controllersRef.current = controllers
    void mapWithConcurrency(imageIds, Math.max(1, batchConcurrency), async (imageId, i) => {
      if (disposed || controllers[i].signal.aborted) return
      update(imageId, { status: 'running' })
      try {
        const dataUrl = getCachedImage(imageId) ?? (await ensureImageCached(imageId))
        if (!dataUrl) throw new Error('图片加载失败')
        const text = await captionImageStream(captioner, dataUrl, { signal: controllers[i].signal })
        if (!disposed) update(imageId, { status: 'done', text })
      } catch (err) {
        if (!disposed) update(imageId, { status: 'error', error: err instanceof Error ? err.message : String(err) })
      }
    }).finally(() => {
      if (!disposed) setRunning(false)
    })
    return () => {
      disposed = true
      for (const c of controllers) if (!c.signal.aborted) c.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageIds])

  const cancelAll = () => {
    for (const c of controllersRef.current) if (!c.signal.aborted) c.abort()
    // 把尚未完成的(pending/running)标为已取消,否则被取消的待处理图永远停在"排队中…"
    setItems((prev) =>
      prev.map((it) =>
        it.status === 'pending' || it.status === 'running'
          ? { ...it, status: 'error', error: '已取消' }
          : it,
      ),
    )
  }

  const doneItems = useMemo(() => items.filter((it) => it.status === 'done' && it.text.trim()), [items])

  const saveAllAsSnippets = () => {
    let saved = 0
    let skipped = 0
    for (const it of doneItems) {
      // 用反推文本前 ~24 字符当片段名
      const id = createSnippet({ name: it.text.trim().slice(0, 24) || '反推片段', content: it.text.trim() })
      if (id) {
        saved += 1
      } else {
        // createSnippet 撞 MAX_SNIPPETS 返回 null 且自身已 toast 一次;此后必继续失败 → 停止避免 N 个 toast 刷屏
        skipped = doneItems.length - saved
        break
      }
    }
    if (saved > 0) {
      showToast(skipped > 0 ? `已存 ${saved} 条片段,${skipped} 条因达上限跳过` : `已存 ${saved} 条片段`, 'success')
    } else if (skipped > 0) {
      showToast('片段库已达上限,未能保存', 'error')
    }
  }

  const copyText = (text: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => showToast('已复制', 'success'),
      () => showToast('复制失败', 'error'),
    )
  }

  const doneCount = items.filter((it) => it.status === 'done').length
  const errorCount = items.filter((it) => it.status === 'error').length

  return (
    <Modal
      onClose={close}
      ariaLabel="批量反推"
      panelClassName="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden"
    >
        <ModalHeaderBar>
          <ModalTitle>
            批量反推
            <span className="text-xs font-normal text-gray-400 dark:text-gray-500">
              {doneCount}/{items.length} 完成{errorCount > 0 ? ` · ${errorCount} 失败` : ''}
            </span>
          </ModalTitle>
          <div className="flex items-center gap-2">
            {running && (
              <button
                type="button"
                onClick={cancelAll}
                className="rounded-lg bg-red-50 px-2.5 py-1 text-xs text-red-600 transition hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
              >
                取消全部
              </button>
            )}
            {doneItems.length > 0 && (
              <button
                type="button"
                onClick={saveAllAsSnippets}
                className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs text-blue-600 transition hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/20"
              >
                全部存为片段
              </button>
            )}
            <ModalCloseButton onClick={close} label="关闭批量反推" />
          </div>
        </ModalHeaderBar>

        <div className="flex-1 space-y-3 overflow-y-auto p-5 custom-scrollbar">
          {apiKeyMissing && (
            <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              反推 API 尚未配置 Key,请先在设置中配置「反推提示词 API」。
            </div>
          )}
          {items.map((it) => (
            <div
              key={it.imageId}
              className="flex gap-3 rounded-2xl border border-gray-200/60 p-3 dark:border-white/[0.06]"
            >
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-black/20">
                {thumbs[it.imageId] && (
                  <img src={thumbs[it.imageId]} className="h-full w-full object-cover" alt="" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                {it.status === 'running' || it.status === 'pending' ? (
                  <div className="text-xs text-gray-400 dark:text-gray-500">
                    {it.status === 'running' ? '反推中…' : '排队中…'}
                  </div>
                ) : it.status === 'error' ? (
                  <div className="text-xs text-red-500 dark:text-red-400">反推失败：{it.error}</div>
                ) : (
                  <>
                    <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-600 dark:text-gray-300">
                      {it.text}
                    </div>
                    <button
                      type="button"
                      onClick={() => copyText(it.text)}
                      className="mt-1.5 text-xs text-blue-500 transition hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      复制
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
    </Modal>
  )
}
