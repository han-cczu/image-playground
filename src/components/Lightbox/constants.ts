// Lightbox 手势相关共享常量与工具函数(从原单文件中抽出,数值保持不变)

export const MIN_SCALE = 1
export const MAX_SCALE = 10

/** 滚轮每档缩放倍率 */
export const WHEEL_ZOOM_FACTOR = 1.15
/** 双击(鼠标/触控)放大到的目标倍率 */
export const DOUBLE_TAP_SCALE = 3
/** 缩放倍率徽标自动隐藏延时(ms) */
export const ZOOM_BADGE_HIDE_MS = 1500
/** 触控双击判定时间窗口(ms) */
export const DOUBLE_TAP_INTERVAL_MS = 300
/** 触控双击判定允许的两次落点偏移(px) */
export const DOUBLE_TAP_SLOP_PX = 30
/** 单击延迟关闭等待(ms):略大于双击窗口,保证第二击落在窗口内时能取消关闭 */
export const TAP_CLOSE_DELAY_MS = 310
/** 鼠标拖拽判定阈值(px):超过即视为拖拽而非点击 */
export const DRAG_THRESHOLD_PX = 3

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}
