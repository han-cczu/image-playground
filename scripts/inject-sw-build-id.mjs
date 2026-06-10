#!/usr/bin/env node
// 构建后处理：
//  1) 把 dist/sw.js 中的 __CACHE_NAME__ 占位符替换为 image-playground-<git-hash>-<timestamp>
//     ——每次部署必须生成全新 CACHE_NAME,否则旧 SW 不会 activate 清缓存;
//  2) 把 __PRECACHE_MANIFEST__ 占位符替换为 dist/assets/ 全部 hashed 文件清单(JSON 数组),
//     install 期整套预缓存,离线保障不再依赖 fetch 期 runtime-cache 的「部分缓存」。
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PLACEHOLDER = '__CACHE_NAME__'
const PRECACHE_PLACEHOLDER = '__PRECACHE_MANIFEST__'
const CACHE_PREFIX = 'image-playground-'

export function readGitShortHash() {
  // Docker 构建上下文排除 .git(.dockerignore),git 命令必失败——先看环境变量
  // GIT_COMMIT(由 Dockerfile ARG / docker-compose build args 传入),否则 CACHE_NAME
  // 恒为 nogit-<timestamp>,与 README「自动注入 commit hash」的承诺不符。
  const fromEnv = process.env.GIT_COMMIT?.trim()
  if (fromEnv) return fromEnv
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

/** 列出 dist/assets/ 的全部文件(扁平目录),输出 SW 相对路径('./assets/x')。 */
export function listPrecacheAssets(distDir) {
  const assetsDir = resolve(distDir, 'assets')
  if (!existsSync(assetsDir)) return []
  return readdirSync(assetsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `./assets/${entry.name}`)
    .sort()
}

export function injectPrecacheManifest(swContent, assetPaths) {
  if (!swContent.includes(PRECACHE_PLACEHOLDER)) {
    throw new Error(`sw.js 中找不到占位符 ${PRECACHE_PLACEHOLDER}，预缓存清单注入失败。`)
  }
  const manifest = JSON.stringify(assetPaths)
  if (manifest.includes("'")) {
    // 清单被嵌进单引号 JS 字符串字面量,文件名含单引号会破坏语法(vite hashed 文件名不会,防御性校验)
    throw new Error('预缓存清单包含单引号,无法安全嵌入 sw.js 字符串字面量。')
  }
  return swContent.split(PRECACHE_PLACEHOLDER).join(manifest)
}

function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const distDir = resolve(__dirname, '..', 'dist')
  const swPath = resolve(distDir, 'sw.js')

  if (!existsSync(swPath)) {
    console.error(`[inject-sw-build-id] 找不到 ${swPath}，请确认 vite build 先执行成功。`)
    process.exit(1)
  }

  const original = readFileSync(swPath, 'utf-8')
  const buildId = generateBuildId({ gitHash: readGitShortHash(), now: Date.now() })

  try {
    const { content, cacheName } = injectBuildId(original, buildId)
    const assets = listPrecacheAssets(distDir)
    if (assets.length === 0) {
      throw new Error('dist/assets/ 为空——预缓存清单不应为空,构建产物可能不完整。')
    }
    const finalContent = injectPrecacheManifest(content, assets)
    writeFileSync(swPath, finalContent, 'utf-8')
    console.log(`[inject-sw-build-id] CACHE_NAME = ${cacheName}`)
    console.log(`[inject-sw-build-id] 预缓存清单 ${assets.length} 个 hashed assets`)
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
