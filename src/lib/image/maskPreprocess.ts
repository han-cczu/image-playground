import type { InputImage } from '../../types'
import { canvasToBlob, loadImage, releaseCanvasBitmap } from './canvasImage'

export const DEFAULT_MASK_WORKING_MAX_EDGE = 1920
export const MASK_WORKING_DIMENSION_MULTIPLE = 16

export interface MaskWorkingSize {
  width: number
  height: number
  scale: number
  wasResized: boolean
}

export interface PreparedMaskTarget extends MaskWorkingSize {
  dataUrl: string
  originalWidth: number
  originalHeight: number
  wasConvertedToPng: boolean
}

function floorToMultiple(value: number, multiple: number): number {
  return Math.max(multiple, Math.floor(value / multiple) * multiple)
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('图片导出失败'))
    reader.readAsDataURL(blob)
  })
}

export function calculateMaskWorkingSize(
  width: number,
  height: number,
  maxEdge = DEFAULT_MASK_WORKING_MAX_EDGE,
  multiple = MASK_WORKING_DIMENSION_MULTIPLE,
): MaskWorkingSize {
  const longestEdge = Math.max(width, height)
  if (longestEdge <= maxEdge) {
    return {
      width,
      height,
      scale: 1,
      wasResized: false,
    }
  }

  const scale = maxEdge / longestEdge
  return {
    width: floorToMultiple(width * scale, multiple),
    height: floorToMultiple(height * scale, multiple),
    scale,
    wasResized: true,
  }
}

export async function prepareMaskTargetDataUrl(dataUrl: string): Promise<PreparedMaskTarget> {
  const image = await loadImage(dataUrl)
  const size = calculateMaskWorkingSize(image.naturalWidth, image.naturalHeight)
  const isPng = /^data:image\/png(?:[;,]|$)/i.test(dataUrl)

  if (!size.wasResized && isPng) {
    return {
      ...size,
      dataUrl,
      originalWidth: image.naturalWidth,
      originalHeight: image.naturalHeight,
      wasConvertedToPng: false,
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  let blob: Blob
  try {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('当前浏览器不支持 Canvas')
    // 工作尺寸按轴各自向下取到 16 的倍数,与原图比例最多差 15px:按比例从原图中心裁出对应区域再缩放,
    // 而不是把整图拉伸进去——拉伸会把替换掉用户参考图的工作图非等比压扁
    const sourceWidth = Math.min(image.naturalWidth, size.width / size.scale)
    const sourceHeight = Math.min(image.naturalHeight, size.height / size.scale)
    const sourceX = (image.naturalWidth - sourceWidth) / 2
    const sourceY = (image.naturalHeight - sourceHeight) / 2
    ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, size.width, size.height)
    blob = await canvasToBlob(canvas, 'image/png')
  } finally {
    // 与同文件其它 helper 的约定一致:位图已进 blob,画布立即归零释放
    releaseCanvasBitmap(canvas)
  }
  return {
    ...size,
    dataUrl: await blobToDataUrl(blob),
    originalWidth: image.naturalWidth,
    originalHeight: image.naturalHeight,
    wasConvertedToPng: true,
  }
}

export function replaceMaskTargetImage(
  inputImages: InputImage[],
  targetImageId: string,
  workingImage: InputImage,
): InputImage[] {
  const nextImages: InputImage[] = []
  let inserted = false

  for (const image of inputImages) {
    if (image.id === targetImageId) {
      if (!inserted) {
        nextImages.push(workingImage)
        inserted = true
      }
      continue
    }

    if (image.id === workingImage.id) {
      if (!inserted) {
        nextImages.push(workingImage)
        inserted = true
      }
      continue
    }

    nextImages.push(image)
  }

  return inserted ? nextImages : [workingImage, ...nextImages]
}
