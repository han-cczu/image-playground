import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractInlineScript, sha256Base64, extractConfigHash } from './verify-csp-hash.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// 锁定值:index.html 内联主题脚本(LF + 已改键 image-playground)的 sha256。
const EXPECTED = 'sha256-ceZQVieuEu3wrVZesSAxmbWRpR45TuEEt523Sm1QRJs='

describe('extractInlineScript', () => {
  it('返回无 src/type 的内联 <script> 文本', () => {
    const html = `<head><script>var a=1;</script><script type="module" src="./x.js"></script></head>`
    expect(extractInlineScript(html)).toBe('var a=1;')
  })

  it('跳过 module/src 脚本,无内联时返回 null', () => {
    const html = `<script type="module" crossorigin src="./assets/index.js"></script>`
    expect(extractInlineScript(html)).toBeNull()
  })
})

describe('sha256Base64', () => {
  it('对空串等于已知 SHA-256(算法锚定)', () => {
    expect(sha256Base64('')).toBe('sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=')
  })

  it('对 CRLF 与 LF 敏感(产出不同 hash)', () => {
    expect(sha256Base64('a\nb\n')).not.toBe(sha256Base64('a\r\nb\r\n'))
  })
})

describe('extractConfigHash', () => {
  it('从 CSP 串里抽出 sha256 token', () => {
    expect(extractConfigHash(`script-src 'self' 'sha256-ABC+def/123='; style-src 'self'`)).toBe('sha256-ABC+def/123=')
  })

  it('无 hash 时返回 null', () => {
    expect(extractConfigHash(`script-src 'self'`)).toBeNull()
  })
})

describe('CSP hash 不变量(锁定 index.html ↔ 四处部署配置)', () => {
  const lfInlineScript = () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf-8').replace(/\r\n/g, '\n')
    const s = extractInlineScript(html)
    if (s === null) throw new Error('index.html 无内联脚本')
    return s
  }

  it('index.html 内联脚本(LF)的 hash 等于锁定值', () => {
    expect(sha256Base64(lfInlineScript())).toBe(EXPECTED)
  })

  it('CRLF 版与 LF 版 hash 不同(证明 .gitattributes eol=lf 必要)', () => {
    const lf = lfInlineScript()
    expect(sha256Base64(lf.replace(/\n/g, '\r\n'))).not.toBe(sha256Base64(lf))
  })

  it('四处部署配置的 CSP hash 全部等于锁定值', () => {
    for (const rel of ['public/_headers', 'nginx-security-headers.inc', 'Caddyfile', 'Caddyfile.lan']) {
      const configured = extractConfigHash(readFileSync(resolve(root, rel), 'utf-8'))
      expect(configured, rel).toBe(EXPECTED)
    }
  })
})
