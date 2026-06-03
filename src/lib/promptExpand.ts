/**
 * 提示词通配展开：把含 `{a|b|c}` 通配组的模板做笛卡尔展开为具体 prompt 列表。
 *
 * 设计要点（与 spec 2026-06-03-batch-experiment-foundation 对齐）：
 * - 纯函数，无副作用、不读全局态。
 * - 仅「含 `|` 的花括号组」才触发展开；不含 `|` 的 `{...}`（如 JSON 片段 `{"k":1}`）原样保留。
 * - 不支持嵌套 `{a|{b|c}}`：只解析单层，内层花括号按字面处理。
 * - 转义 `\{` `\}` `\|` `\\` 表示字面字符，**仅当模板含活动通配组时**展开后还原为去转义字符；
 *   无任何活动通配组时整串**原样返回**（保证普通 prompt——含反斜杠/花括号/竖线——零改写，
 *   这对 submitTask 单条路径的等价性至关重要）。
 * - 选项内首尾空白保留；空选项（`{a||b}` 的空段）保留为空字符串，不做裁剪。
 * - 不配对花括号等异常一律容错：当作无通配，返回 `[template]`（绝不抛错阻断提交）。
 */

/** 展开数软上限：超过需由调用方二次确认（见 submitTask）。 */
export const MAX_PROMPT_EXPANSION = 20

/** 展开数硬上限：超过应由调用方直接拒绝（防 2^N 组合爆炸），不给确认机会。 */
export const MAX_PROMPT_EXPANSION_HARD = 200

type Segment =
  | { type: 'literal'; text: string }
  | { type: 'choice'; options: string[] }

const ESCAPABLE = new Set(['{', '}', '|', '\\'])

/**
 * 从 `start`（指向 `{`）尝试解析一个通配组：扫描到下一个**未转义**的 `}`，
 * 中间内容按**未转义**的 `|` 切分为选项，每个选项去转义。
 *
 * 返回：
 * - 合法通配组（≥2 个选项）：`{ options, endIndex }`，endIndex 指向 `}` 之后。
 * - 否则（无闭合 `}` / 无 `|` 只有单段）：`null`，调用方把 `{` 当字面处理。
 */
function tryParseGroup(template: string, start: number): { options: string[]; endIndex: number } | null {
  const options: string[] = []
  let current = ''
  let i = start + 1 // 跳过起始 '{'

  while (i < template.length) {
    const c = template[i]
    if (c === '\\' && i + 1 < template.length && ESCAPABLE.has(template[i + 1])) {
      current += template[i + 1]
      i += 2
      continue
    }
    if (c === '{') {
      // 不支持嵌套：内层 '{' 按字面计入当前选项。
      current += c
      i += 1
      continue
    }
    if (c === '|') {
      options.push(current)
      current = ''
      i += 1
      continue
    }
    if (c === '}') {
      options.push(current)
      // 仅当切出 ≥2 段（即至少有一个未转义 '|'）才视为通配组。
      if (options.length < 2) return null
      return { options, endIndex: i + 1 }
    }
    current += c
    i += 1
  }
  // 扫到结尾仍未闭合：不是合法通配组。
  return null
}

/** 把模板解析为 literal / choice 段序列。 */
function parseSegments(template: string): Segment[] {
  const segments: Segment[] = []
  let literal = ''
  let i = 0

  const flushLiteral = () => {
    if (literal) {
      segments.push({ type: 'literal', text: literal })
      literal = ''
    }
  }

  while (i < template.length) {
    const c = template[i]
    if (c === '\\' && i + 1 < template.length && ESCAPABLE.has(template[i + 1])) {
      literal += template[i + 1]
      i += 2
      continue
    }
    if (c === '{') {
      const group = tryParseGroup(template, i)
      if (group) {
        flushLiteral()
        segments.push({ type: 'choice', options: group.options })
        i = group.endIndex
        continue
      }
      // 不是通配组：'{' 当字面，后续字符（含 '}'）正常累积。
      literal += '{'
      i += 1
      continue
    }
    literal += c
    i += 1
  }

  flushLiteral()
  // 全空模板时也返回一个空 literal 段，保证 expand 产出 ['']。
  if (segments.length === 0) segments.push({ type: 'literal', text: '' })
  return segments
}

/**
 * 计算模板的展开数（各通配组选项数之乘积），**不构造结果数组**。
 *
 * 供调用方在真正展开前预判规模：当展开数可能是 2^N 级别时，先用本函数判断、
 * 再决定是否展开 / 确认 / 拒绝，避免在确认前就分配超大数组。
 * 与 `expandPromptTemplate(template).length` 始终一致。
 */
export function countPromptExpansion(template: string): number {
  let count = 1
  for (const seg of parseSegments(template)) {
    if (seg.type === 'choice') count *= seg.options.length
  }
  return count
}

/**
 * 把含通配的模板笛卡尔展开为具体 prompt 列表。无通配组时返回 `[template]`（去转义后）。
 *
 * 注意：本函数会构造完整结果数组，调用方应先用 `countPromptExpansion` 把关规模。
 */
export function expandPromptTemplate(template: string): string[] {
  const segments = parseSegments(template)
  // 无活动通配组:整串原样返回,不做去转义——保证普通 prompt 严格无改写。
  if (!segments.some((seg) => seg.type === 'choice')) return [template]

  let results = ['']
  for (const seg of segments) {
    if (seg.type === 'literal') {
      results = results.map((r) => r + seg.text)
    } else {
      const next: string[] = []
      for (const r of results) {
        for (const opt of seg.options) next.push(r + opt)
      }
      results = next
    }
  }
  return results
}
