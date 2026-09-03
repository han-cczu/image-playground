/**
 * 导出 / 导入 / 清空 三类数据任务的互斥位。单独成模块(无依赖):exportImport 持有它,
 * taskRuntime/init 的启动期孤儿 GC 也要读它——GC 若在导入写图窗口里跑,会把刚导入、尚未被任务记录
 * 引用的图片整批删掉;而 init 直接 import exportImport 会形成 taskRuntime ↔ exportImport 的循环依赖。
 */
export type DataJob = 'export' | 'import' | 'clear'

let dataJobInProgress: DataJob | null = null

export function getDataJobInProgress(): DataJob | null {
  return dataJobInProgress
}

export function setDataJobInProgress(job: DataJob | null): void {
  dataJobInProgress = job
}
