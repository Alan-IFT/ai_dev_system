#!/usr/bin/env node
// 从 标准/ 与 templates/ 生成插件随包分发的技能正文（skills/*.md）。设计 §12.33。
//
// 为什么是生成而不是手工复制：技能正文是标准的**副本**，手工维护必然漂移（N2「副本即缺陷」）。所以它是构建产物，
// 提交进 git（与 lib/ 同理：pnpm 从 git 装包不执行 prepare），由 `scripts/check-skills-sync.mjs` 钉住「技能正文 == 从当前标准生成的结果」。
//
// 切分：四章各一条技能（std-01 … std-04），模板一条（std-templates）；每条正文开头放「节目录」，让模型知道该读哪一段。
// 不入包：标准/参考资料/（证据）、标准/示例项目-*/（示例）——默认不加载，也不是被执行的标准。
//
// 相对链接：316 处，在单条技能正文里会断。链接文字保留、目标去掉（`[01 §3.1](…#x)` → `01 §3.1`）；指向包外或不入包文档的链接同样只留文字。
//
// 用法：node scripts/build-skills.mjs [--check]     --check：只比较不写，不一致退出 1（给 check-skills-sync 用）
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'skills')

/** 技能清单：name 是技能名（kebab-case，≤ 注册表的 SKILL_NAME 文法）；描述用于目录，≤ 500 字（目录里会被截）。 */
export const SKILLS = [
  { name: 'std-01-project-management', file: '标准/01-项目管理标准.md', description: '项目管理标准（01）：文档树与职责卡、元信息与状态、篇幅预算、工作项生命周期、会话协议、变更分级、评审发布事故、周期性维护、采用与例外。写或改项目文档、开工收工、判断某份文档该有什么、处理例外与升级时加载。', whenToUse: '用户或任务引用「01 §x.y」，或要决定文档放哪、工作项怎么流转、一次变更算几级时。' },
  { name: 'std-02-architecture', file: '标准/02-项目架构描述规范.md', description: '项目架构描述规范（02）：架构文档集、系统全景与质量场景、模块文档、依赖规则、契约与变更流程（expand→migrate→contract）、数据所有权、不变量、ADR、漂移检测。写或改架构文档、模块文档、契约、ADR 时加载。', whenToUse: '用户或任务引用「02 §x.y」，或要描述架构、登记契约、写决策记录时。' },
  { name: 'std-03-agent-context', file: '标准/03-Agent信息获取与上下文管理.md', description: 'Agent 信息获取与上下文管理（03）：信息层级与默认加载合同、工作项级上下文清单、按需层、压缩与交接、子执行者委托、记忆沉淀。配置入口文件、写上下文清单、排查「agent 读错了／读多了」时加载。', whenToUse: '用户或任务引用「03 §x.y」，或要配置 AGENTS.md 的加载合同、写交接稿、委托子 agent 时。' },
  { name: 'std-04-reliability-ops', file: '标准/04-可靠性安全与运行维护.md', description: '可靠性、安全与运行维护（04）：服务责任卡与质量目标、告警到恢复、备份与数据生命周期、安全与供应链、渐进发布、AI 协作运行的可观测与可重复、交付含模型能力的产品时的运行责任。项目有部署、持久数据或外部依赖时加载。', whenToUse: '用户或任务引用「04 §x.y」，或涉及发布、事故、恢复演练、依赖审计、AI 运行记录时。' },
]

const TEMPLATES = { name: 'std-templates', dir: 'templates', description: '标准配套模板：入口 AGENTS.md、工作项、ADR、架构、PRD、状态、交接、评估清单，以及 agent-skills 下的评审／交接／测试／安全等技能模板，和文件树与落地路径。新建这些文档、需要起手模板时加载。', whenToUse: '要新建工作项、ADR、状态文件、交接稿或入口文件，需要标准给的起手结构时。' }

/** git 的 blob 哈希（`git hash-object`）：`sha1("blob <字节数>\0" + 内容)`。不调 git 子进程——纯函数，行尾已归一成 LF，与 git 在 LF 检出下的值一致。 */
export function blobHash(text) {
  const buf = Buffer.from(text, 'utf8')
  return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex').slice(0, 12)
}

/** 去掉相对链接的目标，只留文字；绝对链接（http/https）与页内锚点保留。图片链接同样处理。 */
export function stripRelLinks(text) {
  return text.replace(/(!?)\[([^\]]*)\]\((?!https?:|#|mailto:)([^)]*)\)/g, (_m, bang, label) => (bang ? '' : label))
}

/**
 * 抽出章内的 ## / ### 标题（带行号），生成「节目录」。`offset` 是技能文件里排在章正文**之前**的行数（头部自己占的）：
 * 目录里的行号必须是**技能文件内**的行号——模型按它定位，差一行就读错一节。
 */
export function outline(lines, offset = 0) {
  const out = []
  lines.forEach((l, i) => { if (/^#{2,3} /.test(l)) out.push(`- 第 ${i + 1 + offset} 行　${l.replace(/^#+\s*/, '')}`) })
  return out
}

function chapter(spec) {
  const src = readFileSync(join(root, spec.file), 'utf8').replace(/\r\n/g, '\n')
  const body = stripRelLinks(src)
  const lines = body.split('\n')
  const head = (offset) => [
    // 02 §9.1：头部声明「派生缓存，权威是 X」并记 source_rev。source_rev 取源文件的 git 内容哈希（blob），不取提交号——
    // 提交号会因「提交 skills/ 自己」而变，造成永远对不齐；内容哈希只随源内容变，生成两次结果相同（幂等，--check 才可能为零）。
    `<!-- 派生缓存，权威是 ${spec.file}；source_rev: ${blobHash(src)}；由 scripts/build-skills.mjs 生成，不要手改（改权威，再重新生成）。-->`,
    `> 本技能是标准「${lines[0].replace(/^#\s*/, '')}」的**完整正文**（相对链接已去掉目标、只留文字）。引用写法「NN §x.y」＝本文第 x.y 节：先看下面的节目录定位，再读该节，**不要通读整章**。`,
    '',
    '## 节目录（行号是本技能文件内的行号）',
    '',
    ...outline(lines, offset),
    '',
    '---',
    '',
  ].join('\n')
  // 头部行数 = 头部里换行符数（头部以 '\n' 结尾的空串收尾，join 后最后一个元素是 ''，正文紧接其后）。目录条数不随偏移变，所以一次试算即得。
  const headLines = head(0).split('\n').length - 1
  return head(headLines) + body
}

function templates(spec) {
  const dir = join(root, spec.dir)
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
  const files = walk(dir).map((f) => f.slice(dir.length + 1).split('\\').join('/')).sort()
  // 模板由 20 个文件拼成一份：source_rev 取「各文件 blob 哈希按路径序拼接」的哈希，任一模板变了它就变
  const rev = blobHash(files.map((f) => `${f}:${blobHash(readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n'))}`).join('\n'))
  const parts = [
    `<!-- 派生缓存，权威是 templates/ 下的各模板文件；source_rev: ${rev}；由 scripts/build-skills.mjs 生成，不要手改。-->`,
    '> 标准配套模板全集。每份模板前有一行 `=== 模板：<相对路径> ===`，其后到下一份之前就是该模板的原文。',
    '',
    '## 模板目录',
    '',
    ...files.map((f) => `- ${f}`),
    '',
  ]
  for (const f of files) {
    // 模板里的相对链接对它们原来所在的目录才有效，并进一份文件后全是断链：与章一样去掉目标、只留文字
    const text = stripRelLinks(readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n'))
    parts.push('---', '', `=== 模板：${f} ===`, '', text.replace(/\n+$/, ''), '')
  }
  return parts.join('\n')
}

/** 生成全部：返回 [{name, file, description, whenToUse, content}]。 */
export function buildAll() {
  const out = SKILLS.map((s) => ({ ...s, file: `${s.name}.md`, content: chapter(s) }))
  out.push({ name: TEMPLATES.name, file: `${TEMPLATES.name}.md`, description: TEMPLATES.description, whenToUse: TEMPLATES.whenToUse, content: templates(TEMPLATES) })
  return out
}

/** skills/index.json：运行时提供者读它（名字、描述、适用场景）；与技能正文同源生成，不手写。 */
export function buildIndex(built) {
  return JSON.stringify(built.map(({ name, description, whenToUse }) => ({ name, description, whenToUse })), null, 1) + '\n'
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('build-skills.mjs')) {
  const check = process.argv.includes('--check')
  const built = buildAll()
  const problems = []
  if (!check) mkdirSync(OUT, { recursive: true })
  const files = [...built.map((s) => [s.file, s.content]), ['index.json', buildIndex(built)]]
  for (const [file, content] of files) {
    const path = join(OUT, file)
    const cur = existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : null
    if (cur !== content) problems.push(file)
    if (!check) writeFileSync(path, content, 'utf8')
  }
  // 清单外的多余文件
  if (existsSync(OUT)) for (const f of readdirSync(OUT)) if (!files.some(([n]) => n === f)) problems.push(`${f}（清单外的多余文件）`)
  if (check) { if (problems.length) { console.error('skills/ 与从当前标准生成的结果不一致：\n  ' + problems.join('\n  ')); process.exit(1) } console.log(`skills/ 与标准一致（${built.length} 个技能）`) }
  else console.log(`已生成 ${built.length} 个技能到 skills/：${built.map((s) => s.file).join('、')}`)
}
