import type { Context } from '@deepseek-ai/cordis';
import { type GuardConfig } from './guard/index.js';
export { name, inject, Config } from './guard/index.js';
/**
 * 插件入口：守卫照旧；另在 `ctx.skills` 上注册标准技能提供者。
 * `skills` 服务不在（没装 dsh-skill）时跳过技能、守卫照常工作——不因缺技能服务挡住启动。
 * `enabled: false` 同时关守卫与技能（一个总开关，不再多一个配置键）。
 */
export declare function apply(ctx: Context, rawConfig?: GuardConfig | null): void;
