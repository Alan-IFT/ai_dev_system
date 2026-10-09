import { apply as applyGuard } from './guard/index.js';
import { registerStandardSkills } from './skills.js';
export { name, inject, Config } from './guard/index.js';
/**
 * 插件入口：守卫照旧；另在 `ctx.skills` 上注册标准技能提供者。
 * `skills` 服务不在（没装 dsh-skill）时跳过技能、守卫照常工作——不因缺技能服务挡住启动。
 * `enabled: false` 同时关守卫与技能（一个总开关，不再多一个配置键）。
 */
export function apply(ctx, rawConfig) {
    applyGuard(ctx, rawConfig);
    const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
    if (config.enabled === false)
        return;
    const logger = typeof ctx.logger === 'function' ? ctx.logger('ai-dev-std') : console;
    try {
        const dispose = registerStandardSkills(ctx);
        if (dispose)
            logger.info?.('ai-dev-std: registered standard skills (std-01 … std-04, std-templates)');
    }
    catch (error) {
        // 技能注册失败不得带走守卫：记一条警告，继续
        logger.warn?.(`ai-dev-std: standard skills not registered: ${String(error)}`);
    }
}
