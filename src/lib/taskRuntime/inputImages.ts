/**
 * 参考图入库入口:文件上传 / URL 拉取,含大小与像素守卫(taskRuntime 拆分轮,见 shared.ts 头注释)。
 */
import { useStore } from '../../store'
import { storeImage } from '../db'
import { setCachedImage } from '../imageCache'
import { getImageDimensions } from '../image/canvasImage'
import { fileToImageDataUrl, getImageFileMime } from '../image/fileMime'
import { MAX_INPUT_IMAGES_PER_SUBMISSION } from '../tasks'
import { rollbackStoredImagesSilently } from './persistence'

/** 输入图片单文件大小上限;上传/拖放/粘贴最终都汇聚到 addImageFromFile,在此单点设限即覆盖三入口。 */
export const MAX_INPUT_IMAGE_BYTES = 50 * 1024 * 1024
const ADD_IMAGE_FROM_URL_TIMEOUT_MS = 60_000

/** 输入图片解码后总像素(宽×高)上限。仅限文件字节不够:高压缩比图可解码成上亿像素位图,缩略图/遮罩主图全尺寸解码时 OOM。 */
export const MAX_INPUT_IMAGE_PIXELS = 64 * 1024 * 1024 // 约 6400 万像素(8192×8192)

export async function assertImagePixelLimit(dataUrl: string): Promise<void> {
  const { width, height } = await getImageDimensions(dataUrl)
  if (width * height > MAX_INPUT_IMAGE_PIXELS) {
    throw new Error(
      `图片分辨率过大:${width}×${height} 超过约 ${Math.round(MAX_INPUT_IMAGE_PIXELS / 1_000_000)} 百万像素上限`,
    )
  }
}

/** 添加图片到输入（文件上传） */
export async function addImageFromFile(file: File): Promise<void> {
  if (!getImageFileMime(file)) return
  if (useStore.getState().inputImages.length >= MAX_INPUT_IMAGES_PER_SUBMISSION) {
    throw new Error(`参考图数量已达上限（${MAX_INPUT_IMAGES_PER_SUBMISSION} 张）`)
  }
  if (file.size > MAX_INPUT_IMAGE_BYTES) {
    throw new Error(`图片过大:超过 ${Math.round(MAX_INPUT_IMAGE_BYTES / 1024 / 1024)}MB 上限`)
  }
  const dataUrl = await fileToImageDataUrl(file)
  await assertImagePixelLimit(dataUrl)
  const id = await storeImage(dataUrl, 'upload')
  setCachedImage(id, dataUrl)
  const beforeCount = useStore.getState().inputImages.length
  useStore.getState().addInputImage({ id, dataUrl })
  const afterInputImages = useStore.getState().inputImages
  if (
    !afterInputImages.some((image) => image.id === id) ||
    afterInputImages.length === beforeCount
  ) {
    await rollbackStoredImagesSilently([id])
    throw new Error(
      afterInputImages.some((image) => image.id === id)
        ? '图片已在参考图中'
        : `参考图数量已达上限（${MAX_INPUT_IMAGES_PER_SUBMISSION} 张）`,
    )
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

/** 添加图片到输入（右键菜单）—— 支持 data/blob/http URL */
export async function addImageFromUrl(src: string): Promise<void> {
  if (useStore.getState().inputImages.length >= MAX_INPUT_IMAGES_PER_SUBMISSION) {
    throw new Error(`参考图数量已达上限（${MAX_INPUT_IMAGES_PER_SUBMISSION} 张）`)
  }
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), ADD_IMAGE_FROM_URL_TIMEOUT_MS)
  try {
    const res = await fetch(src, { signal: controller.signal })
    if (!res.ok) throw new Error(`图片 URL 下载失败：HTTP ${res.status}`)
    const contentLength = Number(res.headers.get('Content-Length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_INPUT_IMAGE_BYTES) {
      throw new Error(`图片过大:超过 ${Math.round(MAX_INPUT_IMAGE_BYTES / 1024 / 1024)}MB 上限`)
    }
    const blob = await readBlobWithAbort(res, controller.signal)
    if (!blob.type.startsWith('image/')) throw new Error('不是有效的图片')
    if (blob.size > MAX_INPUT_IMAGE_BYTES) {
      throw new Error(`图片过大:超过 ${Math.round(MAX_INPUT_IMAGE_BYTES / 1024 / 1024)}MB 上限`)
    }
    const dataUrl = await blobToDataUrl(blob)
    await assertImagePixelLimit(dataUrl)
    const id = await storeImage(dataUrl, 'upload')
    setCachedImage(id, dataUrl)
    const beforeCount = useStore.getState().inputImages.length
    useStore.getState().addInputImage({ id, dataUrl })
    const afterInputImages = useStore.getState().inputImages
    if (
      !afterInputImages.some((image) => image.id === id) ||
      afterInputImages.length === beforeCount
    ) {
      await rollbackStoredImagesSilently([id])
      throw new Error(
        afterInputImages.some((image) => image.id === id)
          ? '图片已在参考图中'
          : `参考图数量已达上限（${MAX_INPUT_IMAGES_PER_SUBMISSION} 张）`,
      )
    }
  } catch (err) {
    if (controller.signal.aborted) throw new Error('图片 URL 下载超时', { cause: err })
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
