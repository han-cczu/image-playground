import type { TaskParams, TaskRecord } from '../types'
import { useHintTooltip } from '../hooks/useHintTooltip'
import ViewportTooltip from '../components/ViewportTooltip'
import { getParamDisplay } from './paramDisplayLogic'

type ParamKey = keyof TaskParams

interface ParamValueProps {
  task: TaskRecord
  paramKey: ParamKey
  className?: string
  actualParams?: Partial<TaskParams>
}

interface ActualValueBadgeProps {
  value: string
  className?: string
  variant?: 'highlight' | 'normal'
}

export function ActualValueBadge({
  value,
  className = '',
  variant = 'highlight',
}: ActualValueBadgeProps) {
  const hint = useHintTooltip<HTMLSpanElement>()
  const colorClass =
    variant === 'normal'
      ? 'bg-gray-100 text-gray-500 dark:bg-white/[0.04] dark:text-gray-400'
      : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300'

  // 不用 role="button":角标没有可执行动作,Enter/Space 也无响应,挂 button 语义反而误导读屏;
  // tabIndex 仅为键盘聚焦查看提示,读屏用户由 aria-label 直接获得完整信息
  return (
    <span
      {...hint.anchorProps}
      className={`relative inline-flex cursor-help ${colorClass} ${className}`}
      tabIndex={0}
      aria-label={`${value}（API 实际响应值）`}
    >
      {value}
      <ViewportTooltip visible={hint.visible} className="whitespace-nowrap">
        API 实际响应值
      </ViewportTooltip>
    </span>
  )
}

export function ParamValue({ task, paramKey, className = '', actualParams }: ParamValueProps) {
  const { displayValue, isMismatch } = getParamDisplay(task, paramKey, actualParams)

  if (isMismatch) {
    return <ActualValueBadge value={displayValue} className={className} />
  }

  return (
    <span
      className={`${className} bg-gray-100 text-gray-500 dark:bg-white/[0.04] dark:text-gray-400`}
    >
      {displayValue}
    </span>
  )
}

export function DetailParamValue({
  task,
  paramKey,
  className = '',
  actualParams,
}: ParamValueProps) {
  const { displayValue, isMismatch, requestedValue, isAutoResolved } = getParamDisplay(
    task,
    paramKey,
    actualParams,
  )

  if (!isMismatch) {
    if (isAutoResolved) {
      return (
        <span className={`inline-flex items-center gap-1 ${className}`}>
          <span className="text-gray-700 dark:text-gray-300">{requestedValue}</span>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <ActualValueBadge value={displayValue} variant="normal" className="rounded px-1 py-0.5" />
        </span>
      )
    }
    return <span className={`text-gray-700 dark:text-gray-300 ${className}`}>{displayValue}</span>
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span className="text-gray-700 dark:text-gray-300">{requestedValue}</span>
      <span className="text-gray-300 dark:text-gray-600">|</span>
      <ActualValueBadge value={displayValue} className="rounded px-1 py-0.5" />
    </span>
  )
}
