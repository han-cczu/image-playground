/**
 * 轻量子序列模糊匹配（命令面板用，不引第三方 fuzzy 库）。
 *
 * 规则：query 的字符（忽略空白）按序出现在 text 中即命中；大小写不敏感。
 * 评分偏好连续命中与词首命中，便于「nc」优先匹配「New Conversation」而非「inception」。
 */

export interface FuzzyMatchResult {
  /** 得分，越大越好（仅同一 query 下可比较） */
  score: number
  /**
   * 命中字符下标，供高亮。注意是**码点**下标（基于 Array.from(text)），
   * 渲染高亮时同样用 Array.from(text) 切分，避免代理对错位。
   */
  indices: number[]
}

/** 字母或数字（含 CJK），用于判断词边界：前一字符非此类即视为词首。 */
const WORD_CHAR = /[\p{L}\p{N}]/u

/** 每命中一个字符的基础分 */
const CHAR_SCORE = 1
/** 与上一命中字符紧邻（连续命中）的加分 */
const CONSECUTIVE_BONUS = 2
/** 命中位置处于词首（文本开头或前一字符非字母数字）的加分 */
const WORD_START_BONUS = 3

/**
 * 单字符大小写不敏感比较。逐码点各自 toLowerCase（而非整串小写）：
 * 整串 toLowerCase 在某些字符上会改变码点数（如土耳其语 'İ' U+0130 → 'i'+U+0307），
 * 导致 indices 与原文 Array.from(text) 的下标空间错位、高亮错字符。
 * 折叠后扩成多码点时取首码点近似（'İ' 仍可被 'i' 命中）。
 */
function charMatches(textChar: string, queryChar: string): boolean {
  const lower = textChar.toLowerCase()
  return lower === queryChar || (lower.length > 1 && Array.from(lower)[0] === queryChar)
}

/**
 * 子序列模糊匹配：不命中返回 null；空 query（含纯空白）命中所有，score 0。
 * 贪心从左到右取每个 query 字符的最早出现位置，轻量且确定。
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatchResult | null {
  // query 中的空白视为分词符，不参与匹配（「new conv」可命中「New Conversation」）
  const queryChars = Array.from(query.toLowerCase()).filter((ch) => !/\s/u.test(ch))
  if (queryChars.length === 0) return { score: 0, indices: [] }

  // 在原文码点上匹配（不整串小写），保证 indices 与渲染端 Array.from(text) 同一下标空间
  const textChars = Array.from(text)
  const indices: number[] = []
  let score = 0
  let searchFrom = 0
  let prevMatched = -2 // 哨兵：保证首字符不触发连续加分

  for (const ch of queryChars) {
    let found = -1
    for (let i = searchFrom; i < textChars.length; i++) {
      if (charMatches(textChars[i], ch)) {
        found = i
        break
      }
    }
    if (found === -1) return null

    score += CHAR_SCORE
    if (found === prevMatched + 1) score += CONSECUTIVE_BONUS
    const isWordStart = found === 0 || !WORD_CHAR.test(textChars[found - 1])
    if (isWordStart) score += WORD_START_BONUS

    indices.push(found)
    prevMatched = found
    searchFrom = found + 1
  }

  return { score, indices }
}
