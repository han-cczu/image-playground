import { describe, expect, it } from 'vitest'
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
})
