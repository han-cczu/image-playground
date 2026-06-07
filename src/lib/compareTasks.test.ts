import { describe, expect, it } from 'vitest'
import { buildCompareRows } from './compareTasks'
import { DEFAULT_PARAMS } from '../types'
import type { TaskRecord } from '../types'

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-1',
    prompt: 'a cat',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputImages: ['img-1'],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1.234,
    ...overrides,
  }
}

describe('buildCompareRows', () => {
  it('returns [] for empty input', () => {
    expect(buildCompareRows([])).toEqual([])
  })

  it('produces rows in fixed order without compression for all-png columns', () => {
    const rows = buildCompareRows([makeTask(), makeTask({ id: 'task-2' })])
    expect(rows.map((r) => r.key)).toEqual([
      'prompt', 'style', 'size', 'quality', 'output_format', 'moderation', 'n', 'elapsed',
    ])
  })

  it('appends the compression row when any column is jpeg/webp', () => {
    const rows = buildCompareRows([
      makeTask(),
      makeTask({ id: 'task-2', params: { ...DEFAULT_PARAMS, output_format: 'jpeg', output_compression: 80 } }),
    ])
    expect(rows.map((r) => r.key)).toContain('output_compression')
    // 行序:压缩紧随格式之后
    expect(rows.map((r) => r.key)).toEqual([
      'prompt', 'style', 'size', 'quality', 'output_format', 'output_compression', 'moderation', 'n', 'elapsed',
    ])
  })

  it('adds a 模型 row when any column has source info; legacy tasks omit it (审查修复:仅模型不同零高亮)', () => {
    const rows = buildCompareRows([
      makeTask({ apiProvider: 'openai', apiProfileName: 'A', apiModel: 'gpt-image-1' }),
      makeTask({ id: 'task-2', apiProvider: 'gemini', apiProfileName: 'B', apiModel: 'gemini-image' }),
    ])
    const source = rows.find((r) => r.key === 'source')!
    expect(source.values).toEqual(['OpenAI · A · gpt-image-1', 'Gemini · B · gemini-image'])
    expect(source.differs).toBe(true)
    // 行序:模型紧随风格之后
    expect(rows.map((r) => r.key)).toEqual([
      'prompt', 'style', 'source', 'size', 'quality', 'output_format', 'moderation', 'n', 'elapsed',
    ])
    // 单列有来源信息也出行,缺失列兜底「未知」
    const partial = buildCompareRows([
      makeTask({ apiModel: 'gpt-image-1' }),
      makeTask({ id: 'task-2' }),
    ])
    expect(partial.find((r) => r.key === 'source')!.values).toEqual([
      '未知 · 未知 · gpt-image-1', '未知 · 未知 · 未知',
    ])
  })

  it('renders — for png columns in the compression row instead of literal "null" (审查修复)', () => {
    const rows = buildCompareRows([
      makeTask(), // png:output_compression 为 null
      makeTask({ id: 'task-2', params: { ...DEFAULT_PARAMS, output_format: 'jpeg', output_compression: 80 } }),
    ])
    const compression = rows.find((r) => r.key === 'output_compression')!
    expect(compression.values).toEqual(['—', '80'])
    expect(compression.differs).toBe(true)
  })

  it('flags differs only for rows whose values are not all the same', () => {
    const rows = buildCompareRows([
      makeTask({ prompt: 'a cat' }),
      makeTask({ id: 'task-2', prompt: 'a dog', params: { ...DEFAULT_PARAMS, quality: 'high' } }),
    ])
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(byKey.prompt.differs).toBe(true)
    expect(byKey.prompt.multiline).toBe(true)
    expect(byKey.quality.differs).toBe(true)
    expect(byKey.size.differs).toBe(false)
    expect(byKey.output_format.differs).toBe(false)
  })

  it('compares normalized display values: same requested auto but different actual → differs', () => {
    const rows = buildCompareRows([
      makeTask({ actualParams: { size: '1024x1024' } }),
      makeTask({ id: 'task-2', actualParams: { size: '1536x1024' } }),
    ])
    const size = rows.find((r) => r.key === 'size')!
    expect(size.values).toEqual(['1024x1024', '1536x1024'])
    expect(size.differs).toBe(true)
  })

  it('uses actual output count for n', () => {
    const rows = buildCompareRows([
      makeTask({ outputImages: ['a', 'b'] }),
      makeTask({ id: 'task-2', outputImages: ['c'] }),
    ])
    const n = rows.find((r) => r.key === 'n')!
    expect(n.values).toEqual(['2', '1'])
    expect(n.differs).toBe(true)
  })

  it('maps stylePreset to its Chinese label and 无 for none/unknown', () => {
    const rows = buildCompareRows([
      makeTask({ params: { ...DEFAULT_PARAMS, stylePreset: 'film' } }),
      makeTask({ id: 'task-2' }),
      makeTask({ id: 'task-3', params: { ...DEFAULT_PARAMS, stylePreset: '__proto__' } }),
    ])
    const style = rows.find((r) => r.key === 'style')!
    expect(style.values).toEqual(['胶片', '无', '无'])
    expect(style.differs).toBe(true)
  })

  it('never flags elapsed as differing and formats it with fallback', () => {
    const rows = buildCompareRows([
      makeTask({ elapsed: 1.234 }),
      makeTask({ id: 'task-2', elapsed: undefined as unknown as number }),
    ])
    const elapsed = rows.find((r) => r.key === 'elapsed')!
    expect(elapsed.values).toEqual(['1.2s', '—'])
    expect(elapsed.differs).toBe(false)
  })

  it('handles 3 and 4 columns keeping value order aligned with input', () => {
    const tasks = ['p1', 'p2', 'p3', 'p4'].map((p, i) => makeTask({ id: `t${i}`, prompt: p }))
    const rows = buildCompareRows(tasks)
    expect(rows.find((r) => r.key === 'prompt')!.values).toEqual(['p1', 'p2', 'p3', 'p4'])
  })
})
