import { describe, expect, it } from 'vitest'
import type { TaskRecord } from '../types'
import { normalizeTask, normalizeTasks, MAX_IMAGE_IDS_PER_TASK } from './tasks'

describe('normalizeTask', () => {
  it('丢弃无 id / 非对象的条目(返回 null)', () => {
    expect(normalizeTask(null)).toBeNull()
    expect(normalizeTask('x')).toBeNull()
    expect(normalizeTask({})).toBeNull()
    expect(normalizeTask({ id: '   ' })).toBeNull()
  })

  it('保留并归一化核心字段', () => {
    const task = normalizeTask({
      id: 't1',
      prompt: 'hello',
      status: 'done',
      createdAt: 123,
      inputImageIds: ['a', 'b'],
      outputImages: ['c'],
      isFavorite: true,
      conversationId: 'conv1',
    })
    expect(task).not.toBeNull()
    expect(task!.id).toBe('t1')
    expect(task!.prompt).toBe('hello')
    expect(task!.status).toBe('done')
    expect(task!.inputImageIds).toEqual(['a', 'b'])
    expect(task!.outputImages).toEqual(['c'])
    expect(task!.isFavorite).toBe(true)
    expect(task!.conversationId).toBe('conv1')
    expect(task!.params).toMatchObject({ size: 'auto', n: 1 })
  })

  it('非法 status 兜底为 done,缺字段回落默认', () => {
    const task = normalizeTask({ id: 't', status: 'weird', prompt: 42 })
    expect(task!.status).toBe('done')
    expect(task!.prompt).toBe('')
    expect(task!.error).toBeNull()
  })

  it('过滤非字符串 id 并按上限截断 inputImageIds/outputImages', () => {
    const many = Array.from({ length: MAX_IMAGE_IDS_PER_TASK + 10 }, (_, i) => `img${i}`)
    const task = normalizeTask({ id: 't', inputImageIds: ['ok', 1, null, 'ok2'], outputImages: many })
    expect(task!.inputImageIds).toEqual(['ok', 'ok2'])
    expect(task!.outputImages).toHaveLength(MAX_IMAGE_IDS_PER_TASK)
  })

  it('剔除 Record 字段中的危险 key,且不污染 Object.prototype', () => {
    const malicious = JSON.parse(
      '{"id":"t","revisedPromptByImage":{"__proto__":"polluted","good":"ok"},"actualParamsByImage":{"constructor":{"size":"x"},"img1":{"size":"1024x1024"}}}',
    )
    const task = normalizeTask(malicious)
    expect(task!.revisedPromptByImage).toEqual({ good: 'ok' })
    expect(task!.actualParamsByImage).toEqual({ img1: { size: '1024x1024' } })
    // 关键:原型未被污染
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('normalizeTasks 过滤掉非法条目', () => {
    const tasks = normalizeTasks([{ id: 'a' }, null, { id: '' }, { id: 'b' }, 'x'])
    expect(tasks.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('非数组输入返回空数组', () => {
    expect(normalizeTasks(undefined)).toEqual([])
    expect(normalizeTasks({})).toEqual([])
  })

  it('保留批量/网格结构字段 batchId/gridAxes/gridCoord(备份恢复不丢网格与批次笔记关联)', () => {
    const task = normalizeTask({
      id: 't',
      batchId: 'batch-1',
      gridAxes: {
        x: { kind: 'quality', values: [{ key: 'low', label: '低' }, { key: 'high', label: '高' }] },
        y: { kind: 'size', values: [{ key: '1K', label: '1024×1024' }] },
      },
      gridCoord: { x: 'low', y: '1K' },
    })
    expect(task!.batchId).toBe('batch-1')
    expect(task!.gridAxes).toEqual({
      x: { kind: 'quality', values: [{ key: 'low', label: '低' }, { key: 'high', label: '高' }] },
      y: { kind: 'size', values: [{ key: '1K', label: '1024×1024' }] },
    })
    expect(task!.gridCoord).toEqual({ x: 'low', y: '1K' })
  })

  it('单轴网格(无 y)往返保留;非法 y 轴降级为单轴且坐标同步降维', () => {
    const singleAxis = normalizeTask({
      id: 't',
      gridAxes: { x: { kind: 'prompt', values: [{ key: 'a cat', label: 'a cat' }] } },
      gridCoord: { x: 'a cat' },
    })
    expect(singleAxis!.gridAxes).toEqual({ x: { kind: 'prompt', values: [{ key: 'a cat', label: 'a cat' }] } })
    expect(singleAxis!.gridCoord).toEqual({ x: 'a cat' })

    // y 轴 kind 非法被剔除后,gridCoord.y 必须同步剔除——否则矩阵重建拿到「单轴 + 双维坐标」
    // 的不一致数据,所有格子落空,「补跑缺失格」会全量重复生成
    const badY = normalizeTask({
      id: 't',
      gridAxes: {
        x: { kind: 'n', values: [{ key: '2', label: '2 张' }] },
        y: { kind: 'not-a-real-axis', values: [{ key: 'x', label: 'x' }] },
      },
      gridCoord: { x: '2', y: 'x' },
    })
    expect(badY!.gridAxes).toEqual({ x: { kind: 'n', values: [{ key: '2', label: '2 张' }] } })
    expect(badY!.gridCoord).toEqual({ x: '2' })
  })

  it('gridAxes 与 gridCoord 必须成对:任一缺失/非法时双弃,降级为普通卡片', () => {
    // 只有轴没有坐标 → 双弃
    const axesOnly = normalizeTask({
      id: 't',
      gridAxes: { x: { kind: 'quality', values: [{ key: 'low', label: '低' }] } },
    })
    expect(axesOnly!.gridAxes).toBeUndefined()
    expect(axesOnly!.gridCoord).toBeUndefined()
    // 只有坐标没有轴 → 双弃
    const coordOnly = normalizeTask({ id: 't', gridCoord: { x: 'low' } })
    expect(coordOnly!.gridCoord).toBeUndefined()
    // 双轴但坐标缺 y → 轴降维保持成对
    const dualAxesSingleCoord = normalizeTask({
      id: 't',
      gridAxes: {
        x: { kind: 'quality', values: [{ key: 'low', label: '低' }] },
        y: { kind: 'size', values: [{ key: '1K', label: '1K' }] },
      },
      gridCoord: { x: 'low' },
    })
    expect(dualAxesSingleCoord!.gridAxes).toEqual({ x: { kind: 'quality', values: [{ key: 'low', label: '低' }] } })
    expect(dualAxesSingleCoord!.gridCoord).toEqual({ x: 'low' })
  })

  it('非法 gridAxes/gridCoord 被丢弃(kind 白名单 / values 结构 / 坐标类型)', () => {
    expect(normalizeTask({ id: 't', batchId: 42 })!.batchId).toBeUndefined()
    expect(normalizeTask({ id: 't', gridAxes: { x: { kind: 'evil', values: [{ key: 'a', label: 'a' }] } }, gridCoord: { x: 'a' } })!.gridAxes).toBeUndefined()
    expect(normalizeTask({ id: 't', gridAxes: { x: { kind: 'quality', values: [] } }, gridCoord: { x: 'a' } })!.gridAxes).toBeUndefined()
    expect(normalizeTask({ id: 't', gridAxes: { x: { kind: 'quality', values: [{ key: 1, label: 'a' }] } }, gridCoord: { x: 'a' } })!.gridAxes).toBeUndefined()
    expect(normalizeTask({ id: 't', gridCoord: { x: 42 } })!.gridCoord).toBeUndefined()
    expect(normalizeTask({ id: 't', gridCoord: 'low' })!.gridCoord).toBeUndefined()
  })

  it('往返保真:TaskRecord 全字段经 normalizeTask 后无字段被白名单剥掉(防再次漏字段)', () => {
    // 构造一条「每个字段都有值」的完整 TaskRecord;新增 TaskRecord 字段而忘改 normalizeTask 时此测试会失败。
    // 注意:每个字段取值必须**不同于**净化器的回退默认值(status 默认 'done'、output_compression/
    // moderation 默认透传 null/'auto' 等),否则对应断言空转,白名单回归不会被发现。
    const full: Required<TaskRecord> = {
      id: 't-full',
      prompt: 'p',
      params: { size: '1024x1024', quality: 'high', output_format: 'webp', output_compression: 80, moderation: 'low', n: 2, stylePreset: 'photo' },
      apiProvider: 'gemini',
      apiProfileId: 'profile-id-1',
      apiProfileName: 'My Profile',
      apiModel: 'gemini-2.5-flash-image',
      actualParams: { size: '1536x1024' },
      actualParamsByImage: { img1: { size: '1536x1024' } },
      revisedPromptByImage: { img1: 'revised' },
      partialFailureCount: 1,
      partialFailureMessage: 'one failed',
      persistenceError: 'disk full',
      inputImageIds: ['in1'],
      maskTargetImageId: 'in1',
      maskImageId: 'mask1',
      outputImages: ['out1'],
      status: 'error',
      error: 'oops',
      createdAt: 1000,
      finishedAt: 2000,
      elapsed: 1500,
      isFavorite: true,
      favoriteCategoryId: 'cat1',
      sortOrder: 5,
      conversationId: 'conv1',
      batchId: 'batch-1',
      gridAxes: { x: { kind: 'quality', values: [{ key: 'low', label: '低' }] } },
      gridCoord: { x: 'low' },
    }
    const roundTripped = normalizeTask(JSON.parse(JSON.stringify(full)))
    expect(roundTripped).not.toBeNull()
    for (const key of Object.keys(full) as Array<keyof TaskRecord>) {
      expect(roundTripped![key], `字段 ${key} 在归一化往返后丢失或被改写`).toEqual(full[key])
    }
  })
})
