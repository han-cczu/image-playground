import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, getCachedImage, ensureImageCached } from '../store'
import Modal, { ModalCloseButton, ModalHeaderBar, ModalTitle } from './Modal'
import { mapWithConcurrency } from '../lib/concurrency'
import { captionImageStream } from '../lib/api/captionImageApi'
import { copyTextToClipboard } from '../lib/image/clipboard'

type ItemStatus = 'pending' | 'running' | 'done' | 'error'
interface BatchItem {
  imageId: string
  status: ItemStatus
  text: string
  error: string
}

function getCachedThumbs(imageIds: string[]): Record<string, string> {
  const initial: Record<string, string> = {}
  for (const id of imageIds) {
    const cached = getCachedImage(id)
    if (cached) initial[id] = cached
  }
  return initial
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
  const imageIds = useMemo(
    () => (captionBatchImageIds ? Array.from(new Set(captionBatchImageIds)) : []),
    [captionBatchImageIds],
  )

  if (imageIds.length === 0) return null
  return (
    <BatchCaptionPanel
      key={imageIds.join(',')}
      imageIds={imageIds}
      close={() => setCaptionBatchImageIds(null)}
    />
  )
}

function BatchCaptionPanel({ imageIds, close }: { imageIds: string[]; close: () => void }) {
  const captioner = useStore((s) => s.settings.captioner)
  const batchConcurrency = useStore((s) => s.settings.batchConcurrency)
  const createSnippet = useStore((s) => s.createSnippet)
  const showToast = useStore((s) => s.showToast)
  const [runConfig] = useState(() => ({
    captioner,
    batchConcurrency,
  }))
  const apiKeyMissing = !runConfig.captioner.apiKey.trim()

  const [items, setItems] = useState<BatchItem[]>(() =>
    imageIds.map((imageId) => ({
      imageId,
      status: apiKeyMissing ? 'error' : 'pending',
      text: '',
      error: apiKeyMissing ? 'API Key 未配置' : '',
    })),
  )
  const controllersRef = useRef<AbortController[]>([])

  // 缩略图 cache-first(照搬 CompareModal)
  const [thumbs, setThumbs] = useState<Record<string, string>>(() => getCachedThumbs(imageIds))
  useEffect(() => {
    let cancelled = false
    const cached = getCachedThumbs(imageIds)
    if (Object.keys(cached).length > 0) {
      queueMicrotask(() => {
        if (!cancelled) setThumbs((prev) => ({ ...prev, ...cached }))
      })
    }
    for (const id of imageIds) {
      if (cached[id]) continue
      ensureImageCached(id)
        .then((url) => {
          if (!cancelled && url) setThumbs((prev) => (prev[id] ? prev : { ...prev, [id]: url }))
        })
        .catch(() => {
          /* Missing/corrupt images render without thumbnails; per-item caption errors are handled below. */
        })
    }
    return () => {
      cancelled = true
    }
  }, [imageIds])

  const update = (imageId: string, patch: Partial<BatchItem>) =>
    setItems((prev) => prev.map((it) => (it.imageId === imageId ? { ...it, ...patch } : it)))

  const running =
    !apiKeyMissing && items.some((it) => it.status === 'pending' || it.status === 'running')

  // 批量反推:并发闸复用 settings.batchConcurrency,每图独立 AbortController
  useEffect(() => {
    // 未配置 key:不发 N 个必失败请求,统一标记一次(前置校验,见下方提示条)
    if (apiKeyMissing) {
      return
    }
    let disposed = false
    const controllers = imageIds.map(() => new AbortController())
    controllersRef.current = controllers
    void mapWithConcurrency(
      imageIds,
      Math.max(1, runConfig.batchConcurrency),
      async (imageId, i) => {
        if (disposed || controllers[i].signal.aborted) return
        update(imageId, { status: 'running' })
        try {
          const dataUrl = getCachedImage(imageId) ?? (await ensureImageCached(imageId))
          if (disposed || controllers[i].signal.aborted) return
          if (!dataUrl) throw new Error('图片加载失败')
          const text = await captionImageStream(runConfig.captioner, dataUrl, {
            signal: controllers[i].signal,
          })
          if (!disposed && !controllers[i].signal.aborted) update(imageId, { status: 'done', text })
        } catch (err) {
          if (!disposed && !controllers[i].signal.aborted)
            update(imageId, {
              status: 'error',
              error: err instanceof Error ? err.message : String(err),
            })
        }
      },
    )
    return () => {
      disposed = true
      for (const c of controllers) if (!c.signal.aborted) c.abort()
    }
  }, [apiKeyMissing, imageIds, runConfig])

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

  const doneItems = useMemo(
    () => items.filter((it) => it.status === 'done' && it.text.trim()),
    [items],
  )

  const saveAllAsSnippets = () => {
    let saved = 0
    let skipped = 0
    for (const it of doneItems) {
      // 用反推文本前 ~24 字符当片段名
      const id = createSnippet({
        name: it.text.trim().slice(0, 24) || '反推片段',
        content: it.text.trim(),
      })
      if (id) {
        saved += 1
      } else {
        // createSnippet 撞 MAX_SNIPPETS 返回 null 且自身已 toast 一次;此后必继续失败 → 停止避免 N 个 toast 刷屏
        skipped = doneItems.length - saved
        break
      }
    }
    if (saved > 0) {
      showToast(
        skipped > 0 ? `已存 ${saved} 条片段,${skipped} 条因达上限跳过` : `已存 ${saved} 条片段`,
        'success',
      )
    } else if (skipped > 0) {
      showToast('片段库已达上限,未能保存', 'error')
    }
  }

  const copyText = (text: string) => {
    void copyTextToClipboard(text).then(
      () => useStore.getState().showToast('已复制', 'success'),
      () => useStore.getState().showToast('复制失败', 'error'),
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
          <span className="text-xs font-normal text-content-subtle dark:text-content-subtle">
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
              className="rounded-lg bg-brand-soft px-2.5 py-1 text-xs text-brand-ink transition hover:bg-brand-soft dark:bg-brand-soft dark:text-brand-ink dark:hover:bg-brand-soft"
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
            className="flex gap-3 rounded-2xl border border-line p-3 dark:border-line"
          >
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-surface-muted dark:bg-black/20">
              {thumbs[it.imageId] && (
                <img src={thumbs[it.imageId]} className="h-full w-full object-cover" alt="" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              {it.status === 'running' || it.status === 'pending' ? (
                <div className="text-xs text-content-subtle dark:text-content-subtle">
                  {it.status === 'running' ? '反推中…' : '排队中…'}
                </div>
              ) : it.status === 'error' ? (
                <div className="text-xs text-red-500 dark:text-red-400">反推失败：{it.error}</div>
              ) : (
                <>
                  <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-content dark:text-content">
                    {it.text}
                  </div>
                  <button
                    type="button"
                    onClick={() => copyText(it.text)}
                    className="mt-1.5 text-xs text-brand-ink transition hover:text-brand-ink dark:text-brand-ink dark:hover:text-brand-ink"
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
