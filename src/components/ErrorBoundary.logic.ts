/**
 * 简单 hash，用于 prod 模式给用户一个可反馈的错误 id。
 *
 * 故意不使用加密强度算法 —— 只需「同一 error message + stack」始终得到同一 6 字符 id，
 * 用户反馈时可由开发者反查 log。
 */
export function hashString(input: string): string {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i)
    h |= 0
  }
  // toString(36) 在负数前面会加 '-'，先转无符号
  const unsigned = h >>> 0
  return unsigned.toString(36).padStart(6, '0').slice(-6)
}

export interface RetryStateInput {
  retryFailedCount: number
  retryPending: boolean
}

export interface RetryStateAction {
  type: 'retry' | 'errorDuringRetry' | 'errorFresh' | 'recoverConfirmed'
}

/**
 * 纯函数 reducer：boundary 内 retry/error 状态机。
 *
 * 状态语义：
 *   - 处于 retryPending（刚点过重试）时再次接到 error  -> retryFailedCount + 1，仍 pending
 *   - 非 pending 时接到 error                          -> retryFailedCount 不变（首次错误）
 *   - 点击重试                                          -> 进入 pending（计数等下次错误才加）
 *   - 子树成功渲染（外部确认）                          -> 退出 pending，计数归零
 */
export function computeRetryState(
  prev: RetryStateInput,
  action: RetryStateAction,
): RetryStateInput {
  switch (action.type) {
    case 'retry':
      return { retryFailedCount: prev.retryFailedCount, retryPending: true }
    case 'errorDuringRetry':
      return {
        retryFailedCount: prev.retryFailedCount + 1,
        retryPending: true,
      }
    case 'errorFresh':
      return { retryFailedCount: prev.retryFailedCount, retryPending: false }
    case 'recoverConfirmed':
      return { retryFailedCount: 0, retryPending: false }
  }
}
