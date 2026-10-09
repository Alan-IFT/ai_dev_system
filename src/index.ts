// ai-dev-std 插件包入口（DSH 按 package.json 的 main 加载它）。
// 两个子系统并列：守卫（受控动作询问，见 guard/）与标准技能（把随包分发的标准正文交给会话，见 skills.ts）。
import type { Context } from '@deepseek-ai/cordis'
import { apply as applyGuard, type GuardConfig } from './guard/index.js'
import { registerStandardSkills } from './skills.js'

export { name, inject, Config } from './guard/index.js'

/**
 * 插件入口：守卫照旧；另在 `ctx.skills` 上注册标准技能提供者。
 * `skills` 服务不在（没装 dsh-skill）时跳过技能、守卫照常工作——不因缺技能服务挡住启动。
 * `enabled: false` 同时关守卫与技能（一个总开关，不再多一个配置键）。
 */
export function apply(ctx: Context, rawConfig?: GuardConfig | null): void {
  applyGuard(ctx, rawConfig)
  const config: GuardConfig = rawConfig && typeof rawConfig === 'object' ? rawConfig : {}
  if (config.enabled === false) return
  const logger = typeof ctx.logger === 'function' ? ctx.logger('ai-dev-std') : console
  try {
    const dispose = registerStandardSkills(ctx)
    if (dispose) logger.info?.('ai-dev-std: registered standard skills (std-01 … std-04, std-templates)')
  } catch (error) {
    // 技能注册失败不得带走守卫：记一条警告，继续
    logger.warn?.(`ai-dev-std: standard skills not registered: ${String(error)}`)
  }
}
