/**
 * 在途图片登记表:已 storeImage 落库、但还没被任何 task / inputImage 记录引用的图片。
 *
 * 为什么需要:孤儿判定的「唯一来源」是 collectReferencedImageIds(tasks, inputImages),而 storeImage 与
 * 「把 id 写进任务记录」之间隔着请求、哈希去重、逐张落库等多个 await。这段窗口里:
 * - 启动期孤儿 GC / 设置页「清理孤儿图片」会把它们当无引用图删掉(输出图刚落库就被删,任务完成后卡片空白);
 * - 取消/失败任务的 rollbackStoredImages 会把内容寻址去重命中的、兄弟任务仍在途的同 hash 图一并删掉。
 * 登记按 owner 分组(taskId 或提交会话),owner 收尾统一注销;查询可排除自己(回滚自己的图时只看别人的在途)。
 * 纯内存、无依赖,页面刷新即清空——那时任务也都被 initStore 标成中断了,不存在在途图。
 */
const inFlightByOwner = new Map<string, Set<string>>()

export function registerInFlightImages(owner: string, imageIds: Iterable<string>): void {
  const set = inFlightByOwner.get(owner) ?? new Set<string>()
  for (const id of imageIds) set.add(id)
  if (set.size) inFlightByOwner.set(owner, set)
}

export function releaseInFlightImages(owner: string): void {
  inFlightByOwner.delete(owner)
}

/** 当前全部在途图片 id;excludeOwner 用于「回滚自己的图,但不能删别人还在用的」。 */
export function getInFlightImageIds(excludeOwner?: string): Set<string> {
  const result = new Set<string>()
  for (const [owner, ids] of inFlightByOwner) {
    if (owner === excludeOwner) continue
    for (const id of ids) result.add(id)
  }
  return result
}

/** 仅测试用 */
export function resetInFlightImagesForTest(): void {
  inFlightByOwner.clear()
}
