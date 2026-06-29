import type { TaskParams, TaskRecord } from '../types'

type ParamKey = keyof TaskParams

export function getParamDisplay(
  task: TaskRecord,
  paramKey: ParamKey,
  actualParams = task.actualParams,
) {
  const requestedValue = task.params[paramKey]
  const actualValue =
    paramKey === 'n' && task.outputImages?.length > 0
      ? task.outputImages.length
      : actualParams?.[paramKey]
  const hasActualValue = actualValue !== undefined && actualValue !== null
  const displayValue = hasActualValue ? actualValue : requestedValue
  const isMismatch =
    hasActualValue && requestedValue !== 'auto' && String(actualValue) !== String(requestedValue)

  return {
    displayValue: String(displayValue),
    isMismatch,
    requestedValue: String(requestedValue),
    isAutoResolved:
      hasActualValue && requestedValue === 'auto' && String(actualValue) !== String(requestedValue),
  }
}
