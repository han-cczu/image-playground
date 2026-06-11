import { useCallback, useEffect, useState, type CSSProperties, type RefObject } from 'react'

export interface PopoverPlacement {
  /** 向上展开(上方空间更宽裕时翻转) */
  openUp: boolean
  /** fixed 模式下 portal 菜单的定位样式(left + top/bottom + width/transform) */
  menuStyle: CSSProperties
  /** 打开前同步调用一次,保证首帧方向/位置正确(effect 重算只覆盖打开期间的变化) */
  update: () => void
}

interface PopoverPlacementOptions {
  /** 打开期间监听 resize(fixed 模式再加捕获相 scroll)自动重算 */
  open: boolean
  /**
   * 预估菜单高度:仅当下方空间不足该值且上方更宽裕时才向上翻;
   * 不传则退化为「上方空间更大即翻」(Select 的原始启发式)。
   */
  estimatedHeight?: number
  /** fixed 模式(portal 到 body):输出 menuStyle;默认 inline(absolute 跟随文档流),只需 openUp */
  fixed?: boolean
  align?: 'left' | 'right'
  matchTriggerWidth?: boolean
  /** 与触发器的间距 px,默认 6(仅 fixed 模式参与定位) */
  gap?: number
}

/**
 * 浮层翻转定位:统一「上下空间检测 + 向上/向下展开 + fixed portal 定位」的重复实现
 * (原 FavoriteCategoryMenu / Select 各写一份)。横向视口钳制是另一回事,见 ViewportTooltip。
 */
export function usePopoverPlacement(
  triggerRef: RefObject<HTMLElement | null>,
  options: PopoverPlacementOptions,
): PopoverPlacement {
  const { open, estimatedHeight, fixed = false, align = 'left', matchTriggerWidth = false, gap = 6 } = options
  const [openUp, setOpenUp] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})

  const update = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const spaceAbove = rect.top
    const spaceBelow = window.innerHeight - rect.bottom
    const nextOpenUp = spaceAbove > spaceBelow && (estimatedHeight === undefined || spaceBelow < estimatedHeight)
    setOpenUp(nextOpenUp)
    if (fixed) {
      setMenuStyle({
        left: align === 'right' ? rect.right : rect.left,
        top: nextOpenUp ? undefined : rect.bottom + gap,
        bottom: nextOpenUp ? window.innerHeight - rect.top + gap : undefined,
        width: matchTriggerWidth ? rect.width : undefined,
        transform: align === 'right' ? 'translateX(-100%)' : undefined,
      })
    }
  }, [align, estimatedHeight, fixed, gap, matchTriggerWidth, triggerRef])

  useEffect(() => {
    if (!open) return
    update()
    window.addEventListener('resize', update)
    // inline 模式菜单随文档流滚动,无需 scroll 重算;fixed portal 脱离文档流必须跟随
    if (fixed) window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      if (fixed) window.removeEventListener('scroll', update, true)
    }
  }, [open, fixed, update])

  return { openUp, menuStyle, update }
}
