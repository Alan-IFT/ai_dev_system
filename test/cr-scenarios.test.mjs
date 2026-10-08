// cross_repo 的整仓场景与纯函数：回放 golden/unit/cr-scenarios.json（Python 版 run() 与各纯函数的完整输出），TS 版逐字段比对。
// 为什么要这份：真实仓里只有 cms 一个声明了 repos（11 条输出），退役仓规则、跨仓断链、别名召回、嵌套仓、各种上限几乎全无真实输入；而这个检查器的行为大多是「多仓整体」的。
// 生成见 golden/make_scen_cr.py。入口文件统一叫 AGENTS.md；退役仓场景都显式写 layout.rule_files（默认清单是有意差异，见 check-cross-repo.test.mjs）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, nameAppears, hasStatusToken, hasInvalidationMarker, linkTargets, parseGrepZ } from '../lib/checks/cross_repo.js'

const here = dirname(fileURLToPath(import.meta.url))
const gold = JSON.parse(readFileSync(join(here, '..', 'golden', 'unit', 'cr-scenarios.json'), 'utf8'))

const tmps = []
test.after(() => { for (const t of tmps) rmSync(t, { recursive: true, force: true, maxRetries: 3 }) })
const GID = ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false']
const git = (d, args) => { const r = spawnSync('git', ['-C', d, ...GID, ...args], { encoding: 'utf8', timeout: 60_000 }); if (r.status !== 0) throw new Error(`git ${args.join(' ')} 退出码 ${r.status}：${(r.stderr || '').slice(0, 200)}`) }

function build(sc) {
  const tmp = mkdtempSync(join(tmpdir(), 'crscn-')); tmps.push(tmp)
  const root = join(tmp, 'w'); mkdirSync(root)
  for (const [rel, body] of sc.files) { const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, Buffer.from(body, sc.binary.includes(rel) ? 'latin1' : 'utf8')) } // 样本里 bytes 内容存成 latin-1 字符串（逐字节一一对应），其余是 UTF-8 文本
  for (const op of sc.ops) { // 与 make_scen_cr.py 的 ops 对应：目录符号链接要在建 git 仓之前建好
    if (op[0] === 'mkdir') mkdirSync(join(root, op[1]), { recursive: true })
    else if (op[0] === 'symlink_dir') symlinkSync(join(root, op[2]), join(root, op[1]), 'dir')
    else if (op[0] === 'symlink_file') { mkdirSync(dirname(join(root, op[1])), { recursive: true }); symlinkSync(join(root, op[2]), join(root, op[1]), 'file') }
  }
  for (const d of sc.git) { git(join(root, d), ['init', '-q']); git(join(root, d), ['add', '-A', '-f']) }
  return root
}

// <ROOT> 之后的路径分隔符随平台（Windows 反斜杠、POSIX 斜杠）：与 make_scen_cr.py 同样统一成 /，样本才能跨平台比
const slashes = (s) => s.replace(/<ROOT>([^\s；）、:]*)/g, (_, rest) => '<ROOT>' + rest.replaceAll('\\', '/'))
const norm = (rows, root) => rows.map((r) => ({ ...r, ...Object.fromEntries(['title', 'reason', 'why', 'evidence'].map((k) => [k, slashes(r[k].replaceAll(root.replaceAll('\\', '/'), '<ROOT>').replaceAll(root, '<ROOT>'))])) }))

for (const sc of gold.scenarios) {
  test(`场景 ${sc.name}：${sc.note}`, () => {
    const root = build(sc)
    const cfg = { _root: root, layout: sc.cfg_layout, repos: sc.repos, ...sc.extra }
    const got = run(cfg).map((f) => ({ id: f.id, status: f.status, where: f.where ?? null, title: f.title, reason: f.reason ?? '', why: f.why ?? '', evidence: f.evidence ?? '' }))
    assert.deepEqual(norm(got, root), sc.out)
  })
}

const bad = (arr, f) => arr.filter((g) => JSON.stringify(f(g)) !== JSON.stringify(g[g.length - 1])).map((g) => ({ in: JSON.stringify(g.slice(0, -1)).slice(0, 60), want: g[g.length - 1], got: f(g) }))
test('nameAppears：全部输入对 Python 逐条一致（ASCII 边界类、IGNORECASE 的 Unicode 折叠含 İ ı ſ K、正则元字符转义）', () => assert.deepEqual(bad(gold.pure.name_appears, (g) => nameAppears(g[0], g[1])).slice(0, 3), []))
test('hasStatusToken：全部行对 Python 逐条一致（英文状态词按记号认，中文按子串）', () => assert.deepEqual(bad(gold.pure.status_token, (g) => hasStatusToken(g[0])).slice(0, 3), []))
test('hasInvalidationMarker：全部文本对 Python 逐条一致（中文原文子串、英文小写后子串）', () => assert.deepEqual(bad(gold.pure.marker, (g) => hasInvalidationMarker(g[0])).slice(0, 3), []))
test('linkTargets：全部文本对 Python 逐条一致（内联与引用式、尖括号、标题、锚点与查询、协议头、去重保序）', () => assert.deepEqual(bad(gold.pure.link_targets, (g) => linkTargets(g[0])).slice(0, 3), []))
test('parseGrepZ：全部输入对 Python 逐条一致（NUL 记号流、路径含换行、行号非数字、记号数不成对、行文截 120 个码点）', () => assert.deepEqual(bad(gold.pure.parse_grep_z, (g) => parseGrepZ(g[0])).slice(0, 3), []))
test('样本规模', () => assert.ok(gold.scenarios.length >= 60 && gold.pure.name_appears.length >= 55 && gold.pure.link_targets.length >= 75))
