#!/usr/bin/env node
// 发布前机械检查：要打的标签必须等于 `v` + package.json 的 version，且 version 是合法 semver、标签尚未存在、工作区干净、HEAD 在 main 上且已推送。
// 为什么是脚本不是自觉：版本号有两处（package.json 与 git 标签），靠人记会漂；标签一旦推出去就是别人 lockfile 里的东西，打错了难收回。
//
// 用法：node scripts/check-release-tag.mjs <标签名>      例：node scripts/check-release-tag.mjs v0.1.0
//       node scripts/check-release-tag.mjs --list         只列现有标签的分类
// 退出码：0 通过、1 有不满足的条件、2 脚本自己跑不了（不在 git 仓库、参数缺失）
//
// 只读：不打标签、不推送、不改任何文件。打标签由人执行（对外可见、难以撤回）。
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const git = (...a) => spawnSync('git', ['-C', root, '-c', 'core.quotepath=false', ...a], { encoding: 'utf8' })

// 官方 semver 2.0.0 的正则（semver.org 给出的那条），不自己发明
export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

/** 把标签分成三类：semver（v 开头加合法 semver）、legacy-date（旧日期式，含 -pre.N）、other。 */
export function classify(tag) {
  if (tag.startsWith('v') && SEMVER.test(tag.slice(1))) return 'semver'
  if (/^\d{4}-\d{2}-\d{2}(-pre)?(\.\d+)?$/.test(tag)) return 'legacy-date'
  return 'other'
}

/** 纯函数：给定标签名与 package.json 的 version，返回不满足的条件（空数组 = 满足）。 */
export function tagProblems(tag, version) {
  const out = []
  if (typeof version !== 'string' || !SEMVER.test(version)) out.push(`package.json 的 version 不是合法 semver：${JSON.stringify(version)}`)
  if (!tag.startsWith('v')) out.push(`标签名必须以 v 开头，实得 ${JSON.stringify(tag)}`)
  else if (!SEMVER.test(tag.slice(1))) out.push(`标签 ${JSON.stringify(tag)} 去掉 v 后不是合法 semver`)
  if (tag !== 'v' + version) out.push(`标签 ${JSON.stringify(tag)} 与 package.json 的 version 不一致（应为 ${JSON.stringify('v' + version)}）——两处版本号必须同一个，先改 package.json 再打标签`)
  return out
}

function main(argv) {
  const r = git('rev-parse', '--is-inside-work-tree')
  if (r.status !== 0) { console.error('不在 git 工作区：' + (r.stderr || '').trim()); return 2 }
  if (argv[0] === '--list') {
    const tags = git('tag', '--list').stdout.split('\n').filter(Boolean)
    const by = { semver: [], 'legacy-date': [], other: [] }; for (const t of tags) by[classify(t)].push(t)
    for (const [k, v] of Object.entries(by)) console.log(`${k.padEnd(12)} ${v.length}：${v.join(' ') || '—'}`)
    return 0
  }
  const tag = argv[0]; if (!tag) { console.error('用法：node scripts/check-release-tag.mjs <标签名> | --list'); return 2 }
  let version; try { version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version } catch (e) { console.error('读不了 package.json：' + e.message); return 2 }
  const bad = tagProblems(tag, version)
  if (git('rev-parse', '-q', '--verify', `refs/tags/${tag}`).status === 0) bad.push(`标签 ${tag} 已存在（本地）`)
  const remote = git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`); if (remote.status === 0 && remote.stdout.trim()) bad.push(`标签 ${tag} 已存在（远端）`)
  else if (remote.status !== 0) bad.push(`查不了远端标签（ls-remote 失败：${(remote.stderr || '').trim().split('\n')[0]}）——没查成不当作"不存在"`)
  const dirty = git('status', '--porcelain').stdout.trim(); if (dirty) bad.push(`工作区不干净（${dirty.split('\n').length} 项）：标签应指向一个完整提交`)
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim(); if (branch !== 'main') bad.push(`当前分支是 ${JSON.stringify(branch)}，不是 main`)
  const head = git('rev-parse', 'HEAD').stdout.trim(), up = git('rev-parse', 'origin/main').stdout.trim(); if (head !== up) bad.push(`HEAD(${head.slice(0, 7)}) 与 origin/main(${up.slice(0, 7)}) 不一致：先推送再打标签`)
  if (bad.length === 0) { console.log(`发布标签检查：通过——${tag} = v${version}，指向 ${head.slice(0, 7)}（main，已推送，工作区干净）`); return 0 }
  console.log(`发布标签检查：未通过（${bad.length} 项）`); for (const b of bad) console.log('  ✗ ' + b); return 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2))
