#!/usr/bin/env node
// 校验 lib/ 与 src/ 一致（重构设计 §4：lib/ 是提交进 git 的发布产物，src/ 才是手写源，二者不一致就是没构建就提交）。
// 做法：把 src/ 重新编译到一个临时目录，与已提交的 lib/ 逐文件逐字节比较。只读：不改 lib/，不改 src/。
// 退出码：0 一致；1 不一致（列出差异）；2 校验本身没跑成（缺 tsc 等）——没跑成按失败处理，不当通过（01 §2 N1）。
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
if (!existsSync(tsc)) { console.error('lib 校验没跑成：找不到 node_modules/typescript（先 pnpm install）。按失败处理。'); process.exit(2) }

const tmp = mkdtempSync(join(tmpdir(), 'lib-sync-'))
try {
  const r = spawnSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.json'), '--outDir', tmp], { cwd: root, encoding: 'utf8' })
  if (r.status !== 0) { console.error('lib 校验没跑成：tsc 失败。\n' + (r.stdout || '') + (r.stderr || '')); process.exit(2) }

  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])
  const norm = (buf) => buf.toString('utf8').replace(/\r\n/g, '\n')   // 行尾不当差异：Windows 检出可能是 CRLF，索引里是 LF
  const built = new Map(walk(tmp).map((f) => [relative(tmp, f).split('\\').join('/'), norm(readFileSync(f))]))
  const libDir = join(root, 'lib')
  const committed = existsSync(libDir) && statSync(libDir).isDirectory()
    ? new Map(walk(libDir).map((f) => [relative(libDir, f).split('\\').join('/'), norm(readFileSync(f))]))
    : new Map()

  const problems = []
  for (const [k, v] of built) {
    if (!committed.has(k)) problems.push(`lib/${k}：src 能构建出来，但 lib/ 里没有（忘了构建？）`)
    else if (committed.get(k) !== v) problems.push(`lib/${k}：内容与从当前 src 构建的结果不同（src 改了没重新构建，或 lib 被手改）`)
  }
  for (const k of committed.keys()) if (!built.has(k)) problems.push(`lib/${k}：src 里已没有对应源码，是过期产物（该删）`)

  if (problems.length) { console.error('lib/ 与 src/ 不一致：\n  ' + problems.join('\n  ')); process.exit(1) }
  console.log(`lib/ 与 src/ 一致（${built.size} 个文件）`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}