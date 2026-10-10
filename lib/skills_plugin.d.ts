import type { Context } from '@deepseek-ai/cordis';
/** Cordis 插件名。 */
export declare const name = "ai-dev-std-skills";
/** 依赖 `skills` 服务（`@deepseek-ai/dsh-skill`）。 */
export declare const inject: string[];
export interface SkillsConfig {
    enabled?: boolean;
}
/** 在 `ctx.skills` 上注册标准技能提供者。`enabled: false` 时什么也不做。注册抛错只记警告，不带走别的插件。 */
export declare function apply(ctx: Context, rawConfig?: SkillsConfig | null): void;
