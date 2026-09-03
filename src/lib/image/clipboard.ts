import { toPngBlob } from './canvasImage'

export async function copyTextToClipboard(text: string) {
  let asyncClipboardError: unknown = null

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch (err) {
      asyncClipboardError = err
    }
  }

  if (copyTextWithExecCommand(text)) return

  throw asyncClipboardError ?? new Error('Clipboard API is not available')
}

/**
 * 把图片写入剪贴板。接受 Blob 或「将来才拿到的 Blob」:Safari(WebKit)要求 clipboard.write 必须在
 * 用户手势的同步段内调用,await 取图/转码之后再 write 会因用户激活失效而固定报 NotAllowedError——
 * 所以这里绝不在 write 之前 await,取图与 PNG 转码都塞进 ClipboardItem 的 Promise 值里由浏览器等待。
 * 浏览器异步剪贴板对图片只可靠支持 image/png(写 jpeg/webp 会抛错),toPngBlob 保证输出 png,键固定写死。
 */
export async function copyBlobToClipboard(source: Blob | Promise<Blob>) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('Clipboard image API is not available')
  }

  const png = Promise.resolve(source).then(toPngBlob)
  // 取图/转码失败时 write 会拒绝,但拒绝原因是浏览器包装过的;这里再 await 一次原始 promise,
  // 把「获取图片失败 / 非图片 / 超限」等真实原因抛给调用方(先挂空 catch 避免 write 先拒绝时留下未处理 rejection)
  png.catch(() => {})
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
  await png
}

export function getClipboardFailureMessage(fallback: string, err: unknown) {
  if (isEmbeddedPage() && isClipboardPermissionError(err)) {
    return '复制失败：内嵌页面未授予剪贴板权限'
  }

  return fallback
}

function copyTextWithExecCommand(text: string) {
  const previousActiveElement = document.activeElement
  const previousSelection =
    previousActiveElement instanceof HTMLInputElement ||
    previousActiveElement instanceof HTMLTextAreaElement
      ? {
          element: previousActiveElement,
          start: previousActiveElement.selectionStart,
          end: previousActiveElement.selectionEnd,
          direction: previousActiveElement.selectionDirection,
        }
      : null
  const previousRanges = previousSelection ? [] : saveDocumentSelectionRanges()

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'

  document.body.appendChild(textarea)
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)

  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
    try {
      restorePreviousSelection(previousSelection, previousRanges, previousActiveElement)
    } catch {
      // 复制已经完成;焦点/选区恢复失败不能反向污染复制结果。
    }
  }
}

function saveDocumentSelectionRanges(): Range[] {
  const selection = window.getSelection?.()
  if (!selection) return []
  const ranges: Range[] = []
  for (let i = 0; i < selection.rangeCount; i += 1) {
    ranges.push(selection.getRangeAt(i).cloneRange())
  }
  return ranges
}

function restorePreviousSelection(
  previousSelection: {
    element: HTMLInputElement | HTMLTextAreaElement
    start: number | null
    end: number | null
    direction: 'forward' | 'backward' | 'none' | null
  } | null,
  previousRanges: Range[],
  previousActiveElement: Element | null,
) {
  if (previousSelection) {
    previousSelection.element.focus()
    if (previousSelection.start !== null && previousSelection.end !== null) {
      previousSelection.element.setSelectionRange(
        previousSelection.start,
        previousSelection.end,
        previousSelection.direction ?? 'none',
      )
    }
    return
  }

  const selection = window.getSelection?.()
  if (selection && previousRanges.length) {
    selection.removeAllRanges()
    for (const range of previousRanges) selection.addRange(range)
  }

  if (previousActiveElement instanceof HTMLElement || previousActiveElement instanceof SVGElement) {
    previousActiveElement.focus()
  }
}

function isEmbeddedPage() {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

function isClipboardPermissionError(err: unknown) {
  if (!(err instanceof Error)) return false

  return (
    err.name === 'NotAllowedError' ||
    /permission|permissions policy|not allowed|denied/i.test(err.message)
  )
}
