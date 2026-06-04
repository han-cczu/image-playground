import { describe, expect, it } from 'vitest'
import {
  countPromptExpansion,
  expandPromptTemplate,
  MAX_PROMPT_EXPANSION,
  MAX_PROMPT_EXPANSION_HARD,
} from './promptExpand'

describe('expandPromptTemplate', () => {
  it('returns the original prompt verbatim when there is no wildcard group', () => {
    expect(expandPromptTemplate('a realistic cat')).toEqual(['a realistic cat'])
  })

  it('expands a single group into one prompt per option', () => {
    expect(expandPromptTemplate('a {orange|black|white} cat')).toEqual([
      'a orange cat',
      'a black cat',
      'a white cat',
    ])
  })

  it('takes the cartesian product of multiple groups, in stable order', () => {
    expect(expandPromptTemplate('{a|b}{c|d}')).toEqual(['ac', 'ad', 'bc', 'bd'])
  })

  it('does NOT trigger on a brace group without a pipe (e.g. JSON fragments)', () => {
    expect(expandPromptTemplate('{"k":1}')).toEqual(['{"k":1}'])
    expect(expandPromptTemplate('a {single} word')).toEqual(['a {single} word'])
  })

  it('preserves empty options as empty strings', () => {
    expect(expandPromptTemplate('{a||b}')).toEqual(['a', '', 'b'])
  })

  it('preserves whitespace inside options', () => {
    expect(expandPromptTemplate('{ a | b }')).toEqual([' a ', ' b '])
  })

  it('returns the template verbatim when no active wildcard group exists (escapes NOT unescaped)', () => {
    // 无活动通配组时整串原样返回,普通 prompt(含反斜杠/转义序列/花括号)零改写。
    expect(expandPromptTemplate('\\{红\\|蓝\\}')).toEqual(['\\{红\\|蓝\\}'])
    expect(expandPromptTemplate('path C:\\\\Users')).toEqual(['path C:\\\\Users'])
  })

  it('unescapes literal braces inside a template that DOES have an active group', () => {
    // \{x\} 去转义为 {x},与真实通配组 {a|b} 共存时还原
    expect(expandPromptTemplate('\\{x\\} {a|b}')).toEqual(['{x} a', '{x} b'])
  })

  it('honors an escaped pipe inside an otherwise-real group', () => {
    // {a|b\|c} -> options "a" and "b|c"
    expect(expandPromptTemplate('{a|b\\|c}')).toEqual(['a', 'b|c'])
  })

  it('falls back to the literal template on an unclosed brace', () => {
    expect(expandPromptTemplate('{a|b')).toEqual(['{a|b'])
  })

  it('does not support nesting: inner braces are treated literally', () => {
    // {a|{b|c}} closes at the first unescaped '}', leaving a trailing '}'
    expect(expandPromptTemplate('{a|{b|c}}')).toEqual(['a}', '{b}', 'c}'])
  })

  it('returns [""] for an empty template', () => {
    expect(expandPromptTemplate('')).toEqual([''])
  })

  it('expands a realistic mixed template', () => {
    expect(expandPromptTemplate('一只{橘色|黑色}的{猫|狗}')).toEqual([
      '一只橘色的猫',
      '一只橘色的狗',
      '一只黑色的猫',
      '一只黑色的狗',
    ])
  })
})

describe('countPromptExpansion', () => {
  it('returns 1 when there is no wildcard group', () => {
    expect(countPromptExpansion('plain prompt')).toBe(1)
    expect(countPromptExpansion('{"k":1}')).toBe(1)
  })

  it('equals the product of group option counts', () => {
    expect(countPromptExpansion('{a|b}{c|d|e}')).toBe(6)
  })

  it('stays consistent with expandPromptTemplate().length', () => {
    const samples = [
      'no wildcard',
      'a {x|y} b',
      '{a|b}{c|d}',
      '{a||b}',
      '{a|{b|c}}',
      '\\{x\\|y\\}',
      '{a|b',
      '',
    ]
    for (const s of samples) {
      expect(countPromptExpansion(s)).toBe(expandPromptTemplate(s).length)
    }
  })

  it('computes large counts without building the array', () => {
    // 10 groups of 2 options = 2^10 = 1024; count must not allocate the result.
    const template = '{a|b}'.repeat(10)
    expect(countPromptExpansion(template)).toBe(1024)
  })
})

describe('expansion limit constants', () => {
  it('exposes a soft limit below the hard limit', () => {
    expect(MAX_PROMPT_EXPANSION).toBeLessThan(MAX_PROMPT_EXPANSION_HARD)
    expect(MAX_PROMPT_EXPANSION).toBeGreaterThan(0)
  })
})
