/**
 * 相对时间格式化（不依赖 dayjs，使用 Intl.RelativeTimeFormat）。
 * 输入毫秒时间戳，输出例如「刚刚」「3 分钟前」「2 小时前」「昨天」「3 天前」。
 */
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

let cachedFormatter: Intl.RelativeTimeFormat | null = null

function getFormatter(): Intl.RelativeTimeFormat {
  if (cachedFormatter) return cachedFormatter
  try {
    cachedFormatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })
  } catch {
    // 兜底：手写中文
    cachedFormatter = {
      format: (value: number, unit: Intl.RelativeTimeFormatUnit) => {
        const abs = Math.abs(value)
        const map: Record<string, string> = {
          second: '秒',
          minute: '分钟',
          hour: '小时',
          day: '天',
        }
        return value < 0 ? `${abs} ${map[unit] ?? unit}前` : `${abs} ${map[unit] ?? unit}后`
      },
    } as Intl.RelativeTimeFormat
  }
  return cachedFormatter
}

export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const diff = timestamp - now
  const abs = Math.abs(diff)
  if (abs < 30 * SECOND) return '刚刚'

  const fmt = getFormatter()
  if (abs < HOUR) return fmt.format(Math.round(diff / MINUTE), 'minute')
  if (abs < DAY) return fmt.format(Math.round(diff / HOUR), 'hour')
  if (abs < 30 * DAY) return fmt.format(Math.round(diff / DAY), 'day')

  // 30 天以上直接展示日期
  try {
    const d = new Date(timestamp)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  } catch {
    return fmt.format(Math.round(diff / DAY), 'day')
  }
}
