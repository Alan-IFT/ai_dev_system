// 标准技能子插件（package 的 `./skills` 入口）。设计 §12.33、§12.35。
//
// 为什么单独成一个插件而不是写在守卫的 apply 里：Cordis 的 `inject` 是**整个插件一份**。守卫不依赖任何服务（`inject = []`），
// 技能注册依赖 `skills` 服务（官方样例 `skill-badge` 同样 `inject = ['skills']`）。若合在一起写 `inject = ['skills']`，
// 没装 dsh-skill 的 profile 里守卫也起不来；若合在一起写 `inject = []`，apply 里取 `ctx.skills` 会抛
// `cannot get property "skills" without inject`（这是第一次在真实 DSH 里装入时实测到的，单测用假 ctx 看不出来）。
// 拆成两个入口后：技能行等 `skills` 服务（缺它就是 Cordis 的 PENDING，不报错），守卫行照常挂。
// 先例：dsh-mnemon 的 cordis.patch.yml 也把一个包挂成多行（`name: dsh-mnemon/bundle`）。

import type { Context } from '@deepseek-ai/cordis'
import { registerStandardSkills } from './skills.js'

/** Cordis 插件名。 */
export const name = 'dsh-project-std-skills'

/** 依赖 `skills` 服务（`@deepseek-ai/dsh-skill`）。 */
export const inject = ['skills']

export interface SkillsConfig { enabled?: boolean }

/** 在 `ctx.skills` 上注册标准技能提供者。`enabled: false` 时什么也不做。注册抛错只记警告，不带走别的插件。 */
export function apply(ctx: Context, rawConfig?: SkillsConfig | null): void {
  const config: SkillsConfig = rawConfig && typeof rawConfig === 'object' ? rawConfig : {}
  if (config.enabled === false) return
  const logger = typeof ctx.logger === 'function' ? ctx.logger(name) : console
  try {
    const dispose = registerStandardSkills(ctx)
    if (dispose) logger.info?.(`${name}: registered standard skills (std-01 … std-04, std-templates)`)
    else logger.warn?.(`${name}: 没有可用的 skills 服务，标准技能未注册`)
  } catch (error) {
    logger.warn?.(`${name}: standard skills not registered: ${String(error)}`)
  }
}
