import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * prefers-reduced-motion 块(src/index.css)对 `animation: none` 的静态契约。
 *
 * 背景:`.toast-enter` 的关键帧结束帧是 `translate(-50%, 0)`,靠 forwards 填充停在那里;而 Toast.tsx
 * 外层是 `fixed left-1/2`,整棵树没有任何 `-translate-x-1/2`,气泡的水平居中完全押在这个 -50% 上。
 * reduced-motion 块把 `.toast-enter` 一刀切 `animation: none` 后,填充值随之消失、transform 回落成 none:
 * 气泡左边缘落在视口正中,整体右偏半个宽度;390px 手机上错误文案右半截出屏、最右侧的关闭按钮够不到。
 * 修法是把定位职责从关键帧挪回基础规则(`.toast-enter { transform: translate(-50%, 0) }`),关键帧只
 * 负责过渡。这里把它推广成通用契约:凡是被 reduced-motion 置 none 的类,若其动画用 forwards/both 填充
 * 且结束帧 transform 非恒等(即靠填充值撑布局),基础规则必须静态声明同一 transform——否则开了
 * 「减弱动态效果」的用户拿到的是另一套布局,而这类问题在默认偏好下永远复现不出来。
 *
 * 为什么读源码而非渲染:jsdom 不做布局也不计算动画/媒体查询,真实几何只能靠 Playwright 真机看;
 * 而 vitest 把 CSS 导入替换成空串,src 侧又没有 node 类型可用 node:fs,所以沿用
 * app-enter-animation.test.mjs / verify-csp-hash.test.mjs 锁定源文件内容的做法。
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
// 先剥掉注释:注释里会提到 `.app-enter-main`、`translate(-50%, 0)` 之类的字样,不剥会污染下面的正则
const css = readFileSync(resolve(__dirname, '..', 'src', 'index.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

const FILL_MODES = ['none', 'forwards', 'backwards', 'both']

/** 按花括号配平截取从 `openIndex`(紧跟 `{` 之后)开始的块体,返回 [块体, 块尾右花括号之后的下标]。 */
function sliceBlock(source, openIndex) {
  let depth = 1
  let i = openIndex
  while (i < source.length && depth > 0) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') depth--
    i++
  }
  return [source.slice(openIndex, i - 1), i]
}

/** 抽出 `@keyframes name { ... }` 的完整块(含 from/to 的嵌套花括号),返回 name → 块体。 */
function parseKeyframes(source) {
  const result = new Map()
  const re = /@keyframes\s+([\w-]+)\s*\{/g
  let m
  while ((m = re.exec(source))) {
    const [body, end] = sliceBlock(source, re.lastIndex)
    result.set(m[1], body)
    re.lastIndex = end
  }
  return result
}

/** 收集所有 `@media (prefers-reduced-motion: reduce) { ... }` 块里被 `animation: none` 覆盖的类名。 */
function parseReducedMotionNoneClasses(source) {
  const classes = new Set()
  const re = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g
  while (re.exec(source)) {
    const [body, end] = sliceBlock(source, re.lastIndex)
    re.lastIndex = end
    const ruleRe = /([^{}]+)\{([^}]*)\}/g
    let r
    while ((r = ruleRe.exec(body))) {
      if (!/animation\s*:\s*none\s*;/.test(r[2])) continue
      for (const c of r[1].matchAll(/\.([\w-]+)/g)) classes.add(c[1])
    }
  }
  return classes
}

/**
 * 找类的基础规则(单选择器 `.cls { ... }` 且 animation 不为 none):解析 animation 简写得到 keyframes 名
 * 与 fill-mode,并取出同一规则里静态声明的 transform。reduced-motion 块里的多选择器规则只有最后一个
 * 选择器会命中此正则,且值为 none 会被跳过,不会覆盖真正的声明。
 */
function parseBaseRule(source, cls, keyframes) {
  const re = new RegExp(`(?:^|[^\\w-])\\.${cls}\\s*\\{([^}]*)\\}`, 'g')
  let m
  while ((m = re.exec(source))) {
    const anim = /animation\s*:\s*([^;]+);/.exec(m[1])
    if (!anim) continue
    const value = anim[1].trim()
    if (value === 'none') continue
    // cubic-bezier(...) 内含空格,按空白切开后的碎片既不是 fill-mode 关键字也不是 keyframes 名,无干扰
    const tokens = value.split(/\s+/)
    // 前置 (?:^|[\s;]) 排除 transform-origin
    const transform = /(?:^|[\s;])transform\s*:\s*([^;]+);/.exec(m[1])
    return {
      keyframeName: tokens.find((t) => keyframes.has(t)),
      // 简写省略 fill-mode 时初始值为 none
      fillMode: tokens.find((t) => FILL_MODES.includes(t)) ?? 'none',
      transform: transform ? transform[1].trim() : undefined,
    }
  }
  return undefined
}

/** 取关键帧结束帧(`to` / `100%`)声明的 transform;结束帧没写 transform 时终点就是基础值,返回 undefined。 */
function endFrameTransform(body) {
  const frame = /(?:^|[\s,}])(?:to|100%)\s*\{([^}]*)\}/.exec(body)
  if (!frame) return undefined
  const decl = /(?:^|[\s;])transform\s*:\s*([^;]+);/.exec(frame[1])
  return decl ? decl[1].trim() : undefined
}

/**
 * 恒等变换判定:none,或每个函数都是零位移 / 单位缩放 / 零旋转。
 * 认不出的函数(matrix、perspective……)一律按非恒等处理——宁可让契约误报,也不放过靠填充值撑布局的类。
 */
function isIdentityTransform(value) {
  const v = value.trim().toLowerCase()
  if (v === 'none') return true
  const isZero = (a) => /\d/.test(a) && /^[+-]?0*(?:\.0+)?(?:[a-z%]+)?$/.test(a)
  const isOne = (a) => /^\+?1(?:\.0+)?$/.test(a)
  const fnRe = /([a-z0-9]+)\(([^)]*)\)/g
  let consumed = ''
  let m
  while ((m = fnRe.exec(v))) {
    consumed += m[0]
    const args = m[2].split(',').map((a) => a.trim())
    if (/^translate(?:x|y|z|3d)?$/.test(m[1])) {
      if (!args.every(isZero)) return false
    } else if (/^scale(?:x|y|z|3d)?$/.test(m[1])) {
      if (!args.every(isOne)) return false
    } else if (/^(?:rotate(?:x|y|z)?|skew(?:x|y)?)$/.test(m[1])) {
      if (!args.every(isZero)) return false
    } else {
      return false
    }
  }
  // 函数之外还剩别的东西(未知关键字)→ 认不出,按非恒等
  return v.replace(/\s+/g, '') === consumed.replace(/\s+/g, '')
}

const norm = (s) => s.toLowerCase().replace(/\s+/g, '')

describe('prefers-reduced-motion 下被置 animation:none 的类(src/index.css)', () => {
  const keyframes = parseKeyframes(css)
  const classes = parseReducedMotionNoneClasses(css)
  const rules = new Map([...classes].map((cls) => [cls, parseBaseRule(css, cls, keyframes)]))

  it('reduced-motion 块能被解析到,且每个类都有引用真实 keyframes 的基础规则(防止正则失配后测试空转)', () => {
    expect(classes.has('toast-enter')).toBe(true)
    // 目前三块合计 17 个类(toast + 8 个 animate-* + 4 个 app-enter-* + 3 个光晕 + card-enter)
    expect(classes.size).toBeGreaterThanOrEqual(10)
    for (const [cls, rule] of rules) {
      expect(rule, `${cls} 的基础规则未找到`).toBeDefined()
      expect(rule.keyframeName, `${cls} 引用的 keyframes 未找到`).toBeDefined()
    }
  })

  it('靠 forwards/both 填充把非恒等 transform 留作布局的类,基础规则必须静态声明同一 transform:否则 animation:none 后布局塌掉', () => {
    let checked = 0
    for (const [cls, rule] of rules) {
      if (!['forwards', 'both'].includes(rule.fillMode)) continue
      const end = endFrameTransform(keyframes.get(rule.keyframeName) ?? '')
      if (end === undefined || isIdentityTransform(end)) continue
      checked++
      expect(
        rule.transform,
        `${cls}:结束帧 transform 为 ${end},但基础规则没有静态 transform,reduced-motion 下会丢掉这段位移`,
      ).toBeDefined()
      expect(
        norm(rule.transform ?? ''),
        `${cls}:基础规则 transform 与结束帧不一致,动画结束瞬间会跳一下`,
      ).toBe(norm(end))
    }
    // 目前只有 .toast-enter 属于这一类;数量断言防止关键帧解析失败后循环空转
    expect(checked).toBeGreaterThanOrEqual(1)
  })

  it('.toast-enter 的居中契约:基础规则与关键帧每一帧都带 translate(-50%, …)——Toast.tsx 外层 fixed left-1/2 没有 -translate-x-1/2 兜底', () => {
    const rule = rules.get('toast-enter')
    expect(norm(rule?.transform ?? '')).toBe('translate(-50%,0)')
    const body = keyframes.get('toast-enter') ?? ''
    const frameTransforms = [...body.matchAll(/transform\s*:\s*([^;]+);/g)].map((m) => norm(m[1]))
    // 两帧都要写 transform:关键帧的 transform 会整体覆盖基础值,任何一帧漏掉 -50% 都会在入场时水平跳变
    expect(frameTransforms).toHaveLength(2)
    for (const t of frameTransforms) {
      expect(t.startsWith('translate(-50%,'), `关键帧 transform ${t} 丢了 -50% 水平分量`).toBe(true)
    }
  })
})
