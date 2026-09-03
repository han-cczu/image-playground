import { assertUsableMaskCoverage, classifyMaskAlpha, type MaskCoverage } from './mask'

export interface ImageDimensions {
  width: number
  height: number
}

export async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = dataUrl
  })
}

export async function getImageDimensions(dataUrl: string): Promise<ImageDimensions> {
  const image = await loadImage(dataUrl)
  return { width: image.naturalWidth, height: image.naturalHeight }
}

/**
 * data URL → Blob。不用 fetch(data:) 解码:四套部署配置的 CSP connect-src 都没放行 data:,
 * 一旦从 Report-Only 转为强制,所有编辑/遮罩请求会在这里整体失败;本地 atob 解码不受 CSP 约束。
 */
export async function dataUrlToBlob(dataUrl: string, fallbackType = 'image/png'): Promise<Blob> {
  const match = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(dataUrl)
  if (!match) throw new Error('无效的 data URL')
  const [, mime, params, payload] = match
  const isBase64 = params.split(';').some((param) => param.toLowerCase() === 'base64')
  let buffer: ArrayBuffer
  if (isBase64) {
    const binary = atob(payload.replace(/\s/g, ''))
    buffer = new ArrayBuffer(binary.length)
    const bytes = new Uint8Array(buffer)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  } else {
    const encoded = new TextEncoder().encode(decodeURIComponent(payload))
    buffer = encoded.buffer.slice(
      encoded.byteOffset,
      encoded.byteOffset + encoded.byteLength,
    ) as ArrayBuffer
  }
  return new Blob([buffer], { type: mime || fallbackType })
}

export async function imageDataUrlToPngBlob(dataUrl: string): Promise<Blob> {
  const image = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  try {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('当前浏览器不支持 Canvas')
    ctx.drawImage(image, 0, 0)
    return await canvasToBlob(canvas, 'image/png')
  } finally {
    releaseCanvasBitmap(canvas)
  }
}

/**
 * 把任意图片 Blob 转成 image/png Blob:已是 png 直接返回,否则经离屏 canvas 重绘导出。
 * 供剪贴板写入复用——浏览器异步剪贴板对图片只可靠支持 image/png。
 */
export async function toPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob
  const url = URL.createObjectURL(blob)
  try {
    const image = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    try {
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('当前浏览器不支持 Canvas')
      ctx.drawImage(image, 0, 0)
      return await canvasToBlob(canvas, 'image/png')
    } finally {
      releaseCanvasBitmap(canvas)
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function maskDataUrlToPngBlob(maskDataUrl: string): Promise<Blob> {
  const blob = await dataUrlToBlob(maskDataUrl, 'image/png')
  if (blob.type !== 'image/png') {
    return imageDataUrlToPngBlob(maskDataUrl)
  }
  return blob
}

export async function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = 'image/png',
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('图片导出失败'))
        else resolve(blob)
      },
      type,
      quality,
    )
  })
}

/** 把离屏 canvas 尺寸归零立即释放位图内存(等 GC 回收前,几张 4K 画布就能占掉数百 MB) */
export function releaseCanvasBitmap(canvas: HTMLCanvasElement): void {
  canvas.width = 0
  canvas.height = 0
}

export async function validateMaskMatchesImage(
  maskDataUrl: string,
  imageDataUrl: string,
): Promise<MaskCoverage> {
  const [maskImage, sourceImage] = await Promise.all([
    loadImage(maskDataUrl),
    loadImage(imageDataUrl),
  ])
  if (
    maskImage.naturalWidth !== sourceImage.naturalWidth ||
    maskImage.naturalHeight !== sourceImage.naturalHeight
  ) {
    throw new Error('遮罩尺寸与遮罩主图不一致，请重新绘制遮罩')
  }

  const canvas = document.createElement('canvas')
  canvas.width = maskImage.naturalWidth
  canvas.height = maskImage.naturalHeight
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('当前浏览器不支持 Canvas')
    ctx.drawImage(maskImage, 0, 0)
    // getImageData 返回独立副本,释放 canvas 不影响 coverage
    const coverage = classifyMaskAlpha(ctx.getImageData(0, 0, canvas.width, canvas.height))
    assertUsableMaskCoverage(coverage)
    return coverage
  } finally {
    releaseCanvasBitmap(canvas)
  }
}

export async function createMaskPreviewDataUrl(
  imageDataUrl: string,
  maskDataUrl: string,
): Promise<string> {
  const [image, mask] = await Promise.all([loadImage(imageDataUrl), loadImage(maskDataUrl)])
  if (image.naturalWidth !== mask.naturalWidth || image.naturalHeight !== mask.naturalHeight) {
    throw new Error('遮罩尺寸与遮罩主图不一致，请重新绘制遮罩')
  }

  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')

  ctx.drawImage(image, 0, 0)

  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = mask.naturalWidth
  maskCanvas.height = mask.naturalHeight
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })
  if (!maskCtx) throw new Error('当前浏览器不支持 Canvas')
  maskCtx.drawImage(mask, 0, 0)
  const maskPixels = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height)

  const overlay = ctx.createImageData(canvas.width, canvas.height)
  for (let i = 0; i < maskPixels.data.length; i += 4) {
    const editStrength = 255 - maskPixels.data[i + 3]
    overlay.data[i] = 59
    overlay.data[i + 1] = 130
    overlay.data[i + 2] = 246
    overlay.data[i + 3] = Math.round(editStrength * 0.58)
  }

  const overlayCanvas = document.createElement('canvas')
  overlayCanvas.width = canvas.width
  overlayCanvas.height = canvas.height
  const overlayCtx = overlayCanvas.getContext('2d')
  if (!overlayCtx) throw new Error('当前浏览器不支持 Canvas')
  overlayCtx.putImageData(overlay, 0, 0)
  ctx.drawImage(overlayCanvas, 0, 0)
  const dataUrl = canvas.toDataURL('image/png')
  // 主动释放离屏 canvas 的位图内存(iOS Safari 有总 canvas 内存上限,高分辨率频繁预览易触顶)。
  maskCanvas.width = maskCanvas.height = 0
  overlayCanvas.width = overlayCanvas.height = 0
  canvas.width = canvas.height = 0
  return dataUrl
}
