import { useEffect, useState } from 'react'
import type { TaskRecord } from '../../types'

/**
 * 任务计时:running 态每秒走表(基于 createdAt),结束态读 task.elapsed。
 * 返回 MM:SS 格式字符串;elapsed 缺失时回退 '00:00'。
 */
export function useTaskTimer(task: TaskRecord): string {
  const [now, setNow] = useState(Date.now())

  // 定时更新运行中任务的计时
  useEffect(() => {
    if (task.status !== 'running') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    setNow(Date.now())
    return () => clearInterval(id)
  }, [task.status])

  let seconds: number
  if (task.status === 'running') {
    seconds = Math.floor((now - task.createdAt) / 1000)
  } else if (task.elapsed != null) {
    seconds = Math.floor(task.elapsed / 1000)
  } else {
    return '00:00'
  }
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return `${mm}:${ss}`
}
