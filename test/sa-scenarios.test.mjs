// single_authority 的整仓场景：回放 golden/unit/sa-scenarios.json（Python 版 run() 在每个场景上的完整输出），TS 版逐字段比对。
// 为什么要这份：变异验证第一轮漏了 78 条，绝大多数是「多文件整体行为」——排序次序（码点 vs 码元）、单类上限与「共 N 组」汇总、块的延长与覆盖、读不了/已删/出仓软链接的分流、
// 派生声明的各种形态。这些靠单行的纯函数样本钉不住。场景生成见 golden/make_scen_sa.py。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from '../lib/checks/single_authority.js'
import { SCENARIOS } from './cases/sa-scenarios.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const gold = { scenarios: SCENARIOS }

// 场景里的 seq／rep 内容按这里的 tag／seqLines 展开（最初与 Python 生成脚本同一份算法）（Python 里 CH 是 40 个汉字；第三位取 i // 1600）
const CH = [...'甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往']
const tag = (i) => CH[i % 40] + CH[Math.floor(i / 40) % 40] + CH[Math.floor(i / 1600) % 40]
const seqLines = (n, salt = 0) => Array.from({ length: n }, (_, i) => [tag(salt + i), '内容', tag(salt + i * 3 + 1), '说明', tag(salt + i * 5 + 2), '记录', tag(salt + i * 11 + 4), '备注', tag(salt + i * 13 + 5), '结尾'].join(''))

const GID = ['-c', 'user.name=a', '-c', 'user.email=a@b', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false']
// 每一步都检查退出码：夹具没建好就当场报错，不能带着残缺的仓去比（并发跑多个测试文件时 git 偶发失败，曾表现为报告里整条数值声明消失）
const git = (args) => { const r = spawnSync('git', args, { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${args.slice(-3).join(' ')} 退出码 ${r.status}：${(r.stderr || '').slice(0, 200)}`); return r }
const track = (t) => { git(['-c', 'init.defaultBranch=main', 'init', '-q', t]); git(['-C', t, ...GID, 'add', '-A', '-f']); git(['-C', t, ...GID, 'commit', '-q', '-m', 's']) }
const content = (c) => typeof c === 'string' ? Buffer.from(c, 'utf8') : c.rep ? Buffer.alloc(c.rep[1] * Buffer.byteLength(c.rep[0]), c.rep[0]) : Buffer.from([...seqLines(c.seq[0]), c.seq[1]].join('\n') + '\n', 'utf8')

const tmps = []
test.after(() => { for (const t of tmps) rmSync(t, { recursive: true, force: true }) })

function build(sc) {
  const tmp = mkdtempSync(join(tmpdir(), 'sascn-')); const outside = mkdtempSync(join(tmpdir(), 'sascn-out-')); tmps.push(tmp, outside)
  const root = join(tmp, 'r'); mkdirSync(root)
  for (const [rel, c] of sc.files) { const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content(c)) }
  for (const op of sc.ops) {
    if (op.op !== 'symlink') continue
    const tgt = join(outside, op.target)
    if (op.kind === 'dir') { mkdirSync(tgt, { recursive: true }); writeFileSync(join(tgt, 'in.md'), '# 仓外\n') }
    try { symlinkSync(tgt, join(root, op.path), op.kind === 'dir' ? 'dir' : 'file') } catch { return null } // Windows 无权限建文件符号链接：此场景不成立
  }
  track(root)
  for (const op of sc.ops) {
    if (op.op === 'delete') unlinkSync(join(root, op.path))
  }
  return { root, tmp, outside }
}

for (const sc of gold.scenarios) {
  test(`场景 ${sc.name}：${sc.note}`, (t) => {
    const b = build(sc)
    if (!b) return t.skip('本平台建不了该场景需要的符号链接')
    const got = run({ _root: b.root, layout: { frozen: [] }, ...sc.cfg }).map((f) => ({ id: f.id, status: f.status, where: f.where ?? null, title: f.title, reason: f.reason ?? '', why: f.why ?? '', evidence: f.evidence ?? '' }))
    if (JSON.stringify(got) !== JSON.stringify(sc.out)) { // 诊断：失败时把仓里 git 实际跟踪的文件与磁盘内容一并带出来
      const ls = spawnSync('git', ['-C', b.root, 'ls-files', '-z'], { encoding: 'utf8' })
      const diskOk = sc.files.every(([rel, c]) => typeof c !== 'string' || readFileSync(join(b.root, rel), 'utf8') === c)
      console.error(`[诊断 ${sc.name}] ls-files 退出码 ${ls.status}，${ls.stdout.split('\0').filter(Boolean).length}/${sc.files.length} 个；磁盘内容与样本一致=${diskOk}；输出条数 ${got.length}/${sc.out.length}；缺的 id：${sc.out.filter((o) => !got.some((g) => g.id === o.id)).map((o) => o.id).join(' ')}`)
      got.forEach((g, i) => { const w = sc.out[i]; for (const k of Object.keys(g)) if (w && g[k] !== w[k]) console.error(`[诊断差异] #${i} ${k}\n   TS : ${JSON.stringify(g[k])}\n   PY : ${JSON.stringify(w[k])}`) })
    }
    assert.deepEqual(got, sc.out)
  })
}
