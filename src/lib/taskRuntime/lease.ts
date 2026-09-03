/**
 * 任务租约:标记「这条 running 任务正被某个活着的标签页执行」。
 *
 * 为什么需要它:initStore 会把库里所有 running 的同步 HTTP 任务翻成「请求中断」(刷新/崩溃后的孤儿
 * running 没有执行体,不翻就永远转圈)。但 running 记录本身分不清「孤儿」与「另一个标签页正在跑」——
 * 用户在 A 标签页批量生成时新开 B 标签页(或 PWA 再打开),B 的 initStore 会把 A 的在途任务全部写成
 * 中断,A 再经跨标签页刷新中止真实请求、整批排队成员被「排队跳过」,已消耗的配额全部作废。
 *
 * 实现用 Web Locks API 而不是 localStorage 心跳:锁由浏览器在文档卸载/崩溃时自动释放,不需要 TTL、
 * 不受后台标签页定时器节流影响(Chrome 对隐藏 5 分钟以上的页面把定时器压到每分钟一次,心跳会假死),
 * 也不会像 localStorage 写入那样触发别的标签页的 storage 同步。持锁页面同时被排除出 bfcache,
 * 不会出现「文档还活着但已冻结」的假持有。
 *
 * 不支持 Web Locks 的环境(极旧浏览器、node 测试)一律退化为旧行为:查不到任何租约 → 全部标记中断。
 */

const LEASE_NAME_PREFIX = 'image-playground:task:'

/** 本标签页持有的租约:taskId → 释放函数(resolve 传给 locks.request 的挂起 promise 即释放锁)。 */
const releaseByTask = new Map<string, () => void>()

function getLockManager(): LockManager | null {
  try {
    if (typeof navigator === 'undefined') return null
    const locks = navigator.locks
    return locks && typeof locks.request === 'function' ? locks : null
  } catch {
    return null
  }
}

export function isTaskLeaseSupported(): boolean {
  return getLockManager() !== null
}

/**
 * 为任务持有租约,直到 releaseTaskLease / 文档卸载。必须在任务以 running 落库**之前**调用:
 * 别的标签页只要在库里看到 running,就一定能查到对应的锁,否则中间有一段无主窗口。
 * 幂等:重复调用不会叠加持锁。
 */
export function acquireTaskLease(taskId: string): void {
  const locks = getLockManager()
  if (!locks || releaseByTask.has(taskId)) return
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  releaseByTask.set(taskId, release)
  // ifAvailable:任务只会被入队它的那个标签页执行,锁理应总是空闲;若被别人持有(理论上不会发生)
  // 不排队等待,以免请求挂在别的文档上,直接放弃持有。
  void locks
    .request(LEASE_NAME_PREFIX + taskId, { mode: 'exclusive', ifAvailable: true }, (lock) => {
      if (!lock) {
        releaseByTask.delete(taskId)
        return undefined
      }
      return held
    })
    .catch(() => {
      // 锁请求失败(如文档正在卸载)等价于没有租约:退回旧行为即可,不向用户报错
      releaseByTask.delete(taskId)
    })
}

/** 释放租约。任务落终态、被取消/删除、入队失败回滚时都要调用;对未持有的 taskId 无操作。 */
export function releaseTaskLease(taskId: string): void {
  const release = releaseByTask.get(taskId)
  if (!release) return
  releaseByTask.delete(taskId)
  release()
}

/** 仅测试用:释放本标签页持有的全部租约。 */
export function releaseAllTaskLeasesForTest(): void {
  for (const taskId of Array.from(releaseByTask.keys())) releaseTaskLease(taskId)
}

/** 查询当前被任意标签页(含本页)持有租约的任务 id 集合;不支持或查询失败时返回空集(= 旧行为)。 */
export async function queryHeldTaskLeases(): Promise<Set<string>> {
  const locks = getLockManager()
  if (!locks || typeof locks.query !== 'function') return new Set()
  try {
    const snapshot = await locks.query()
    const held = new Set<string>()
    for (const lock of snapshot.held ?? []) {
      if (lock.name?.startsWith(LEASE_NAME_PREFIX))
        held.add(lock.name.slice(LEASE_NAME_PREFIX.length))
    }
    return held
  } catch {
    return new Set()
  }
}

/**
 * 等某条任务的租约被释放后回调一次——持有它的标签页正常收尾会释放,崩溃/关闭也会由浏览器释放。
 * initStore 对「有人持锁」而跳过标记的任务挂这个观察者:持有者若崩溃,这条任务就成了真正的孤儿
 * running,由观察者补做中断标记;持有者正常完成时回调方读库看到终态,自然无事可做。
 * 排队等待锁的请求不会阻塞任何人,拿到锁后立即归还。
 */
export function watchTaskLeaseRelease(taskId: string, onReleased: () => void): void {
  const locks = getLockManager()
  if (!locks) return
  void locks
    .request(LEASE_NAME_PREFIX + taskId, { mode: 'exclusive' }, () => {
      onReleased()
    })
    .catch(() => {
      /* 文档卸载时挂起的请求会被拒绝,无需处理 */
    })
}
