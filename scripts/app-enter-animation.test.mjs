import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 首屏入场动画 `.app-enter-*`(src/index.css)的静态契约。
 *
 * 为什么放在 scripts/ 且读源码而非渲染:jsdom 不做布局,算不出 transform 对包含块的影响,
 * 真正的几何行为只能靠 Playwright 真机看;而 vitest 默认把 CSS 导入(含 `?raw`)替换成空串,
 * src 侧又没有 node 类型可用 node:fs,所以沿用 verify-csp-hash.test.mjs 锁定源文件内容的做法。
 *
 * 背景:`.app-enter-main` 包住 SearchBar + TaskGrid,`.app-enter-header` 是 sticky 顶栏,
 * 它们的 keyframes 都动 transform。fill-mode 为 both/forwards 时,动画结束后 transform 计算值
 * 永久停在 `translateY(0)`(非 none),按 CSS Transforms 规范该元素就成了所有 fixed 后代的包含块
 * 并新建层叠上下文——TaskGrid 的框选矩形(position:fixed,left/top 直接写 clientX/clientY 视口
 * 坐标)会被整体平移 wrapper 的视口偏移(侧栏宽 + 顶栏高)并随内容滚动,「看到的框」与「实际
 * 选中」不一致。backwards 既在延迟期停在 from 帧(opacity 0,不闪现),结束后又不残留计算值,
 * 是唯一同时满足两点的取值;prefers-reduced-motion 下 animation:none 不复现,所以此坑容易漏测。
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(__dirname, '..', 'src', 'index.css'), 'utf8')

const FILL_MODES = ['none', 'forwards', 'backwards', 'both']

/** 抽出 `@keyframes name { ... }` 的完整块(含 from/to 的嵌套花括号),返回 name → 块体。 */
function parseKeyframes(source) {
  const result = new Map()
  const re = /@keyframes\s+([\w-]+)\s*\{/g
  let m
  while ((m = re.exec(source))) {
    let depth = 1
    let i = re.lastIndex
    while (i < source.length && depth > 0) {
      const ch = source[i]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      i++
    }
    result.set(m[1], source.slice(re.lastIndex, i - 1))
  }
  return result
}

/**
 * 收集单选择器的 `.app-enter-xxx { animation: ...; }` 规则并解析 animation 简写。
 * prefers-reduced-motion 块里是多选择器 + `animation: none`:前几个选择器后面跟逗号不会命中,
 * 最后一个命中后因值为 none 被跳过——不能让它覆盖掉真正的入场声明。
 */
function parseAppEnterRules(source, keyframes) {
  const result = new Map()
  const re = /\.(app-enter-[\w-]+)\s*\{([^}]*)\}/g
  let m
  while ((m = re.exec(source))) {
    const decl = /animation\s*:\s*([^;]+);/.exec(m[2])
    if (!decl) continue
    const value = decl[1].trim()
    if (value === 'none') continue
    // cubic-bezier(...) 内含空格,按空白切开后的碎片既不是 fill-mode 关键字也不是 keyframes 名,无干扰
    const tokens = value.split(/\s+/)
    result.set(m[1], {
      keyframeName: tokens.find((t) => keyframes.has(t)),
      // 简写省略 fill-mode 时初始值为 none
      fillMode: tokens.find((t) => FILL_MODES.includes(t)) ?? 'none',
    })
  }
  return result
}

describe('首屏入场动画 .app-enter-*(src/index.css)', () => {
  const keyframes = parseKeyframes(css)
  const rules = parseAppEnterRules(css, keyframes)

  it('四个入场规则都能被解析到且引用的 keyframes 存在(防止正则失配后测试空转)', () => {
    expect([...rules.keys()].sort()).toEqual([
      'app-enter-header',
      'app-enter-inputbar',
      'app-enter-main',
      'app-enter-sidebar',
    ])
    for (const [cls, anim] of rules) {
      expect(anim.keyframeName, `${cls} 引用的 keyframes 未找到`).toBeDefined()
    }
  })

  it('动 transform 的入场动画不得用 both/forwards 填充:残留 transform 会把 fixed 后代(框选矩形)的包含块改成本元素', () => {
    let checked = 0
    for (const [cls, anim] of rules) {
      const body = keyframes.get(anim.keyframeName ?? '') ?? ''
      if (!/transform\s*:/.test(body)) continue
      checked++
      expect(['both', 'forwards'], `${cls} 的 fill-mode 为 ${anim.fillMode}`).not.toContain(
        anim.fillMode,
      )
    }
    // header / main / inputbar 三条都动 transform;数量断言防止 keyframes 解析失败后循环空转
    expect(checked).toBeGreaterThanOrEqual(3)
  })

  it('入场规则统一用 backwards:延迟期停在 from 帧不闪现,结束后计算值回到自然值(含只动 opacity 的 sidebar,避免日后"统一成 both"顺手回退)', () => {
    expect(rules.size).toBe(4)
    for (const [cls, anim] of rules) {
      expect(anim.fillMode, cls).toBe('backwards')
    }
  })
})
