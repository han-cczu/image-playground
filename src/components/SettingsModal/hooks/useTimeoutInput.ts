import { useCallback, useEffect, useMemo, useState } from 'react'
import { normalizeTimeoutInput } from '../timeout'

export interface UseTimeoutInputOptions {
  /** 初始值:打开面板时来自 store settings(而非 draft),与原 useState 初始化一致 */
  initialTimeout: number
  /** 当前激活 profile 的 id,切换 profile 时把输入框同步回真实值 */
  activeId: string
  /** 当前激活 profile 的 timeout:外部改写时同步输入框,同时作为 flush 的 fallback */
  activeTimeout: number
  /** flush 时是否把 0/负数也回退到 fallback(优化器/图说器为 true;API 配置历史上放行,默认 false) */
  rejectNonPositiveOnFlush?: boolean
}

export interface TimeoutInputController {
  /** 输入框字符串状态(onChange 阶段不 normalize,保持自由输入) */
  value: string
  /** 受控 onChange 直通(身份稳定,可直接作为 onTimeoutChange 传给子组件) */
  setValue: (v: string) => void
  /** 把输入框重置为某个 timeout 数值(打开面板/导入/清空/重置 draft/失焦回写时用) */
  reset: (timeout: number) => void
  /** 保存与脏检测时把输入框内容折叠为合法 timeout(不合法回退当前激活值) */
  flush: () => number
}

/**
 * 「字符串输入态 + 激活 profile 变化时回写 + 保存/脏检测时 flush」的共享逻辑,
 * API / 提示词优化器 / 图说器三套 timeout 输入框共用。
 */
export function useTimeoutInput(options: UseTimeoutInputOptions): TimeoutInputController {
  const { initialTimeout, activeId, activeTimeout, rejectNonPositiveOnFlush = false } = options
  const [value, setValue] = useState(String(initialTimeout))

  // 切换激活 profile 或其 timeout 被外部改写时,把输入框同步回真实值
  useEffect(() => {
    setValue(String(activeTimeout))
  }, [activeId, activeTimeout])

  const flush = useCallback(
    () => normalizeTimeoutInput(value, activeTimeout, { rejectNonPositive: rejectNonPositiveOnFlush }),
    [value, activeTimeout, rejectNonPositiveOnFlush],
  )

  const reset = useCallback((timeout: number) => setValue(String(timeout)), [])

  // controller 对象 useMemo 化:身份仅随 value/flush 变化,调用方可整体放进依赖数组
  // (失效粒度与单列 flush 一致,且满足 exhaustive-deps 的对象级追踪)
  return useMemo(() => ({ value, setValue, reset, flush }), [value, reset, flush])
}
