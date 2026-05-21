#!/usr/bin/env node
// 构建后处理：把 dist/sw.js 中的 __CACHE_NAME__ 占位符替换为 image-playground-<git-hash>-<timestamp>。
// 设计理由见 .trellis/spec/frontend/service-worker.md（每次部署必须生成全新 CACHE_NAME，否则旧 SW 不会 activate 清缓存）。
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PLACEHOLDER = '__CACHE_NAME__'
const CACHE_PREFIX = 'image-playground-'

export function readGitShortHash() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return null
  }
}

export function generateBuildId({ gitHash, now }) {
  const hash = gitHash && /^[0-9a-f]{4,40}$/i.test(gitHash) ? gitHash : 'nogit'
  return `${hash}-${now}`
}

export function injectBuildId(swContent, buildId) {
  if (!swContent.includes(PLACEHOLDER)) {
    throw new Error(`sw.js 中找不到占位符 ${PLACEHOLDER}，构建产物可能已被处理过或源文件未使用占位符。`)
  }
  const cacheName = `${CACHE_PREFIX}${buildId}`
  const next = swContent.split(PLACEHOLDER).join(cacheName)
  if (next.includes(PLACEHOLDER)) {
    throw new Error(`替换后 ${PLACEHOLDER} 仍残留，注入失败。`)
  }
  return { content: next, cacheName }
}

function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const swPath = resolve(__dirname, '..', 'dist', 'sw.js')

  if (!existsSync(swPath)) {
    console.error(`[inject-sw-build-id] 找不到 ${swPath}，请确认 vite build 先执行成功。`)
    process.exit(1)
  }

  const original = readFileSync(swPath, 'utf-8')
  const buildId = generateBuildId({ gitHash: readGitShortHash(), now: Date.now() })

  try {
    const { content, cacheName } = injectBuildId(original, buildId)
    writeFileSync(swPath, content, 'utf-8')
    console.log(`[inject-sw-build-id] CACHE_NAME = ${cacheName}`)
  } catch (err) {
    console.error(`[inject-sw-build-id] ${err.message}`)
    process.exit(1)
  }
}

// 判定脚本是否作为入口被直接执行（而非被 import）。
// 必须用 pathToFileURL：Windows 下 argv[1] 形如 D:\foo\bar.mjs，而 import.meta.url 形如 file:///D:/foo/bar.mjs，
// 直接字符串拼 `file://${argv[1]}` 在 Windows 永远不相等，会让脚本静默不执行 main()。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
