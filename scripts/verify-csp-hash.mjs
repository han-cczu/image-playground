#!/usr/bin/env node
// 构建后守卫:校验 dist/index.html 内联主题引导脚本的 sha256 与四处部署配置里的 CSP script-src hash 一致。
// 失配即 exit 1——把「强制 CSP 后内联脚本被拦截 → 首屏白屏 / FOUC」从运行期事故前移为构建期硬失败。
//
// 背景:CSP hash 对换行符敏感。Windows(core.autocrlf=true)工作树是 CRLF、Linux/Docker/CI 检出是 LF,
// 二者算出的 hash 不同。.gitattributes 已把 index.html 锁为 LF 让产物字节跨平台一致;本守卫兜底任何漂移
//(改了内联脚本忘了重算、或 EOL 配置失效)。注意:**绝不归一化** dist 字节——按浏览器实际看到的字节算。
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 逐字复用同一 CSP 策略的四处配置,hash 必须全部一致(详见 docs/security-headers.md)。
const CONFIG_FILES = ['public/_headers', 'nginx-security-headers.inc', 'Caddyfile', 'Caddyfile.lan']

/** 提取 HTML 中首个「无 src、无 type」的内联 <script> 文本(即主题引导脚本);找不到返回 null。 */
export function extractInlineScript(html) {
  const re = /<script(\b[^>]*)>([\s\S]*?)<\/script>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || ''
    if (/\bsrc\s*=/i.test(attrs) || /\btype\s*=/i.test(attrs)) continue
    return m[2]
  }
  return null
}

/** 对脚本文本算 base64 SHA-256,返回 CSP 形态 'sha256-...'。不做任何换行归一化。 */
export function sha256Base64(text) {
  return 'sha256-' + createHash('sha256').update(text, 'utf8').digest('base64')
}

/** 从配置文本里抽出 script-src 的 'sha256-...';找不到返回 null。 */
export function extractConfigHash(configText) {
  const m = configText.match(/'(sha256-[A-Za-z0-9+/=]+)'/)
  return m ? m[1] : null
}

function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const root = resolve(__dirname, '..')
  const distIndex = resolve(root, 'dist', 'index.html')

  if (!existsSync(distIndex)) {
    console.error(`[verify-csp-hash] 找不到 ${distIndex},请确认 vite build 先执行成功。`)
    process.exit(1)
  }

  const script = extractInlineScript(readFileSync(distIndex, 'utf-8'))
  if (script === null) {
    console.error('[verify-csp-hash] dist/index.html 未找到内联主题脚本(无 src/type 的 <script>)。')
    process.exit(1)
  }
  const actual = sha256Base64(script)

  let ok = true
  for (const rel of CONFIG_FILES) {
    const p = resolve(root, rel)
    if (!existsSync(p)) {
      console.error(`[verify-csp-hash] 缺少配置文件 ${rel}`)
      ok = false
      continue
    }
    const configured = extractConfigHash(readFileSync(p, 'utf-8'))
    if (configured !== actual) {
      console.error(`[verify-csp-hash] ${rel} 的 CSP hash 与产物不一致:\n  配置 = ${configured}\n  产物 = ${actual}`)
      ok = false
    }
  }

  if (!ok) {
    console.error('[verify-csp-hash] CSP 内联脚本 hash 失配。改了 index.html 内联脚本后请重算并同步四处配置(见 docs/security-headers.md)。')
    process.exit(1)
  }
  console.log(`[verify-csp-hash] OK — 内联脚本 hash ${actual} 与四处配置一致。`)
}

// 判定脚本是否作为入口被直接执行(而非被 import,如单测)。Windows 下 argv[1] 与 import.meta.url 形态不同,
// 必须用 pathToFileURL 归一,否则 import.meta.url 永不相等、main() 静默不执行。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
