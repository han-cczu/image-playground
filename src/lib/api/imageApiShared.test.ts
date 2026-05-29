import { describe, expect, it } from 'vitest'
import { extractResponsesImageBase64 } from './imageApiShared'

describe('extractResponsesImageBase64', () => {
  it('返回裸 base64 字符串(trim)', () => {
    expect(extractResponsesImageBase64('  aW1hZ2U=  ')).toBe('aW1hZ2U=')
  })

  it('透传 data URL 字符串', () => {
    const dataUrl = 'data:image/png;base64,aW1hZ2U='
    expect(extractResponsesImageBase64(dataUrl)).toBe(dataUrl)
  })

  it('对象形态:取 b64_json(M1 回归——此前对象形态被静默丢弃)', () => {
    expect(extractResponsesImageBase64({ b64_json: 'aW1hZ2U=' })).toBe('aW1hZ2U=')
  })

  it('对象形态:回退到 image / data 字段', () => {
    expect(extractResponsesImageBase64({ image: 'aW1n' })).toBe('aW1n')
    expect(extractResponsesImageBase64({ data: 'ZGF0YQ==' })).toBe('ZGF0YQ==')
  })

  it('对象字段优先级 b64_json > image > data', () => {
    expect(extractResponsesImageBase64({ b64_json: 'a', image: 'b', data: 'c' })).toBe('a')
    expect(extractResponsesImageBase64({ image: 'b', data: 'c' })).toBe('b')
  })

  it('空 / 无效输入返回 null(保留「未返回可用图片」兜底)', () => {
    expect(extractResponsesImageBase64('   ')).toBeNull()
    expect(extractResponsesImageBase64({})).toBeNull()
    expect(extractResponsesImageBase64({ b64_json: '  ' })).toBeNull()
    expect(extractResponsesImageBase64(undefined)).toBeNull()
    expect(extractResponsesImageBase64(null)).toBeNull()
  })
})
