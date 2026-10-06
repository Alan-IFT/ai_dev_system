#!/usr/bin/env node
// 变异验证：把源文件里的某一处改坏，重新构建并跑测试，**测试必须变红**。
// 为什么要它：这个仓里已有三次实测证明「用例通过」不等于「用例有区分力」（设计 §12.4、§12.6）。
//
// 用法：node scripts/mutate.mjs <变异清单.json> [--tests "test/a.test.mjs test/b.test.mjs"]
// 变异清单：[{ "id": "Y1", "file": "src/core/yaml.ts", "from": "原文（必须在文件里恰好出现一次）", "to": "改成什么" }, ...]
// 输出：每条一行（✓ 被抓住 / ✗ 没被抓住 / ? 无效），最后汇总；有任何 ✗ 或 ? 就以非 0 退出。
//
// 安全性（这是它存在的第二个原因——第一版是一段内联脚本，出错时把未提交的源文件写坏了，事故见设计 §12.6）：
//  1. 开始前把每个涉及的文件整份备份到临时目录，**并在备份上记 sha256**；
//  2. 每条变异都在 try/finally 里还原；
//  3. 全部结束后再逐个核对「文件当前的 sha256 == 开始前的 sha256」，不等则报错并从备份恢复；
//  4. 进程被 Ctrl+C / 异常终止时（SIGINT、uncaughtException）同样从备份恢复。
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const listFile = args[0]
if (!listFile) { console.error('用法：node scripts/mutate.mjs <变异清单.json> [--tests "..."]'); process.exit(2) }
const ti = args.indexOf('--tests')
const tests = ti >= 0 && args[ti + 1] ? args[ti + 1].split(/\s+/).filter(Boolean) : ['test/*.test.mjs']

const sha = (buf) => createHash('sha256').update(buf).digest('hex')
const muts = JSON.parse(readFileSync(resolve(listFile), 'utf8'))
const files = [...new Set(muts.map((m) => m.file))]
const tmp = mkdtempSync(join(tmpdir(), 'mutate-'))
const backup = new Map()      // file → { path, sha }
for (const f of files) {
  const abs = join(root, f)
  const b = join(tmp, f.replace(/[\\/]/g, '__'))
  copyFileSync(abs, b)
  backup.set(f, { path: b, sha: sha(readFileSync(abs)) })
}
const restoreAll = () => { for (const [f, { path }] of backup) copyFileSync(path, join(root, f)) }
const verify = () => [...backup].filter(([f, { sha: s }]) => sha(readFileSync(join(root, f))) !== s).map(([f]) => f)
process.on('SIGINT', () => { restoreAll(); process.exit(130) })
process.on('uncaughtException', (e) => { restoreAll(); console.error(e); process.exit(1) })

const node = process.execPath
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const build = () => spawnSync(node, [tsc, '-p', join(root, 'tsconfig.json')], { cwd: root, encoding: 'utf8' })
const runTests = () => spawnSync(node, ['--test', ...tests], { cwd: root, encoding: 'utf8' })
const failed = (out) => {
  const names = new Set()
  for (const l of out.split('\n')) { const m = /^\s*✖ (.+?)(?:\s+\(\d[\d.]*ms\))?$/.exec(l); if (m && m[1] !== 'failing tests:') names.add(m[1]) }
  return names
}

// 基线：不变异时必须全绿，否则后面的「红」没有意义
restoreAll()
let r = build()
if (r.status !== 0) { console.error('基线构建失败：\n' + r.stdout + r.stderr); rmSync(tmp, { recursive: true, force: true }); process.exit(2) }
r = runTests()
const base = failed(r.stdout)
if (r.status !== 0 || base.size) { console.error(`基线测试不是全绿（失败 ${base.size} 条），先修再变异：\n  ${[...base].slice(0, 5).join('\n  ')}`); rmSync(tmp, { recursive: true, force: true }); process.exit(2) }

let bad = 0
let unverified = 0          // 清单里标了 unobservable 的变异：性质没有可观察的副作用，测试抓不住是**已知**的——如实计数，既不算通过也不算失败
try {
  for (const m of muts) {
    const abs = join(root, m.file)
    const text = readFileSync(backup.get(m.file).path, 'utf8')
    // 复合变异：`multi` 是若干 {from,to}，**同时**应用（用来验证纵深防御：两道互为冗余的防线各自去掉都被另一道兜住，只有同时去掉才该变红）
    // posixOnly：这条变异要在 POSIX 上才有可观察的差别（O_NOFOLLOW、O_NONBLOCK、FIFO）。Windows 上跳过并如实报告，不假装验证过。
    if (m.posixOnly && process.platform === 'win32') { console.log(`△ ${m.id.padEnd(6)} ${m.title ?? ''}  本平台（Windows）不适用，未验证——在 Ubuntu 容器里跑`); unverified++; continue }
    const steps = m.multi ?? [{ from: m.from, to: m.to }]
    const counts = steps.map((s) => text.split(s.from).length - 1)
    if (counts.some((n) => n !== 1)) { console.log(`? ${m.id.padEnd(6)} ${m.title ?? ''}  锚点在 ${m.file} 里出现 ${counts.join('/')} 次（每个都要恰好 1 次），无效`); bad++; continue }
    try {
      let mutated = text
      for (const s of steps) mutated = mutated.replace(s.from, () => s.to)
      writeFileSync(abs, mutated)
      const b = build()
      if (b.status !== 0) { console.log(`? ${m.id.padEnd(6)} ${m.title ?? ''}  变异后编译不过，无效（换一种写法）`); bad++; continue }
      const t = runTests()
      const f = failed(t.stdout)
      if (f.size > 0) console.log(`✓ ${m.id.padEnd(6)} ${m.title ?? ''}  失败 ${f.size} 条`)
      else if (m.unobservable) { console.log(`△ ${m.id.padEnd(6)} ${m.title ?? ''}  已知未验证：${m.unobservable}`); unverified++ }
      else { console.log(`✗ ${m.id.padEnd(6)} ${m.title ?? ''}  **没被抓住**`); bad++ }
    } finally {
      copyFileSync(backup.get(m.file).path, abs)
    }
  }
} finally {
  restoreAll()
}
const drift = verify()
build()
rmSync(tmp, { recursive: true, force: true })
if (drift.length) { console.error('还原后文件哈希与开始前不一致：' + drift.join(', ')); process.exit(3) }
console.log(`\n${muts.length} 条变异；${muts.length - bad - unverified} 条被抓住，${unverified} 条已知未验证（unobservable，不折算通过），${bad} 条没被抓住或无效。文件已还原并校验哈希。`)
process.exit(bad ? 1 : 0)
