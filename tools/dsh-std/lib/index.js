// dsh-std —— DeepSeek Harness 原生插件：标准仓的执行层（D-135）。
//
// 做两件事，都落在 DSH 的 `tools/pre-execute` 瀑布上：
//   1. 受控动作（01 §5.5）：命中清单的调用返回 {kind:'ask'}，由 DSH 的 dsh-user-approval 找人批准；
//      应答缺席、被拒、取消一律是拒绝（fail-closed，DSH 一侧保证）。
//   2. 内嵌标准目录 .std/ 只读（01 §8）：对写工具与疑似写的命令返回 {kind:'deny'}。
//
// 它不是安全边界：见 README「盲区」。真正的权限边界仍是 DSH 的沙箱模式与审批策略。
//
// 写法对照一手来源：@deepseek-ai/dsh-hooks-claude-code 的 `ctx.on('tools/pre-execute', async (exec, next) => …)`；
// 该监听返回 deny／ask 或 `next()`。**本插件不使用 `ctx.tools.guard()`**（早先的决策记录曾这样写，已更正）。

import { createRequire } from 'node:module'
import { decide } from './policy.js'

/** Cordis 插件名。 */
export const name = 'dsh-std'

/** 不依赖任何服务：tools/pre-execute 是 ctx 上的事件，缺 tools 服务时 on 不会触发，也不会崩。 */
export const inject = []

/**
 * 配置 schema：enabled 总开关；root 是项目根（缺省取会话工作目录，再缺省取进程 cwd；会话在子目录开时仍可能判偏，建议写上）。
 * 写法照本机已装的本地包 dsh-user-preferences：用 @deepseek-ai/schemastery 惰性构造 schema，解析不到就不导出 Config（undefined），
 * 不因此挡住启动。**未实机验证 DSH 会不会剥掉 Config 里没声明的字段**——所以 root 声明在 schema 里。
 */
function buildConfig() {
  try {
    const require = createRequire(import.meta.url)
    const z = require('@deepseek-ai/schemastery')
    const schema = z?.default ?? z
    if (typeof schema?.object !== 'function') return undefined
    return schema.object({
      enabled: schema.boolean().default(true),
      root: schema.string().default(''),
    })
  } catch {
    return undefined
  }
}

export const Config = buildConfig()

/** 判定的严重度：deny 最严，其次 ask，最后 allow。合并时取最严的一个。 */
const RANK = { allow: 0, ask: 1, deny: 2 }

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{enabled?: boolean, root?: string}} [config]
 */
export function apply(ctx, rawConfig) {
  const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {}   // apply(ctx, null) 不崩
  if (config.enabled === false) return
  const logger = typeof ctx.logger === 'function' ? ctx.logger(name) : console

  ctx.on('tools/pre-execute', async (exec, next) => {
    // 下游决定先规整：只认 {kind:'allow'|'ask'|'deny'}（用 hasOwn，避开 'toString' 这类原型键）；
    // 其它任何值（字符串、数字、空对象、未知 kind）一律当 ask 处理并保留原值不外泄——不当放行（独立审查指出此前会原样透传）。
    let downstream
    try {
      const raw = await next()
      downstream = raw === undefined || raw === null ? { kind: 'allow' } : raw
    } catch (error) {
      logger.warn?.(`${name}: next() threw, treating as ask: ${String(error)}`)
      downstream = { kind: 'ask', reason: `下游判定出错，按未定处理，先问人：${String(error)}` }
    }
    // 读 downstream.kind 可能抛（带 getter 的对象、Proxy）：放进 try，抛了按认不出处理
    let downKind = null
    try {
      downKind = downstream && typeof downstream === 'object' && Object.prototype.hasOwnProperty.call(RANK, downstream.kind) ? downstream.kind : null
    } catch { downKind = null }
    if (downKind === null) downstream = { kind: 'ask', reason: '下游返回了认不出的决定，按未定处理，先问人' }

    // 项目根的取值优先级：插件配置 root > 会话工作目录（exec.agent.session.header.cwd，dsh-hooks-claude-code 给外部钩子传的 cwd 就取自它）> 进程 cwd。
    // 会话 cwd 不是项目根时（在子目录开会话）仍可能判偏，所以 README 仍建议写 root。
    // 取会话 cwd 也可能抛（getter）：抛了就当没有，回落进程 cwd
    let root = config.root
    if (!root) { try { root = exec?.agent?.session?.header?.cwd } catch { root = undefined } }

    let verdict
    try {
      verdict = decide({ name: exec?.name, arguments: exec?.arguments }, { root })
    } catch (error) {
      // 判定自己崩了：按未定处理，不放行（01 §2 N1）。
      logger.warn?.(`${name}: decide() threw, falling back to ask: ${String(error)}`)
      verdict = { kind: 'ask', reason: `守卫判定出错，按未定处理，先问人：${String(error)}` }
    }

    // 合并取最严：下游 ask 而本插件要 deny 时必须是 deny；下游 deny 而本插件 allow／ask 时保持 deny——只收紧不放宽。
    const down = RANK[downstream.kind]
    const mine = RANK[verdict.kind]
    if (mine > down) return { kind: verdict.kind, reason: verdict.reason }
    return downstream
  })

  logger.info?.(`${name}: loaded (pre-execute guard for controlled actions and read-only .std/)`)
}
