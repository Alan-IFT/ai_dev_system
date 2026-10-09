#!/usr/bin/env node
// 校验 skills/ 与标准一致（设计 §12.33）：技能正文是从 标准/ 与 templates/ 生成的构建产物，提交进 git；
// 标准改了没重新生成、或技能被手改，就是副本漂移（N2）。只读：不改 skills/，不改 标准/。
// 退出码：0 一致；1 不一致；2 校验本身没跑成——没跑成按失败处理，不当通过（01 §2 N1）。
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const r = spawnSync(process.execPath, [join(root, 'scripts', 'build-skills.mjs'), '--check'], { cwd: root, encoding: 'utf8' })
if (r.error) { console.error('skills 校验没跑成：' + r.error.message); process.exit(2) }
process.stdout.write(r.stdout || '')
process.stderr.write(r.stderr || '')
process.exit(r.status === null ? 2 : r.status)
