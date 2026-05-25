/**
 * 遮罩画布操作工具函数（视图层专用）。
 */

/**
 * 将画布填充为纯白色（代表「无遮罩区域」的初始状态）。
 * 操作序列：重置合成模式 → clearRect → 白色 fillRect。
 */
export function fillWhiteMask(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')
  ctx.globalCompositeOperation = 'source-over'
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
}
