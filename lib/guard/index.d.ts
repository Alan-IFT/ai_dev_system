import type { Context } from '@deepseek-ai/cordis';
/** Cordis 插件名。 */
export declare const name = "ai-dev-std";
/** 不依赖任何服务：tools/pre-execute 是 ctx 上的事件，缺 tools 服务时 on 不会触发，也不会崩。 */
export declare const inject: never[];
export declare const Config: any;
/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{enabled?: boolean, root?: string}} [config]
 */
export declare function apply(ctx: Context, rawConfig?: {
    enabled?: boolean;
    root?: string;
} | null): void;
