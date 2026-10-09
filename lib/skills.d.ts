import type { Context } from '@deepseek-ai/cordis';
/** 提供者名。`runtime` 是注册表保留名，不能用。 */
export declare const PROVIDER_NAME = "ai-dev-std-standard";
declare const INVOCATION: {
    readonly modelInvocable: true;
    readonly userInvocable: true;
};
declare const RESOURCE_BASE: {
    readonly kind: 'directory';
    readonly path: string;
};
/** 技能元信息：名字与描述。**与 scripts/build-skills.mjs 的 SKILLS 同源**——测试断言两边一致。 */
export interface SkillMeta {
    name: string;
    description: string;
    whenToUse: string;
}
/** 读 skills/ 下的元信息：每个 `<name>.md` 第一行是生成注释，元信息放在 skills/index.json（由 build-skills 同时生成）。 */
export declare function loadMeta(): SkillMeta[];
interface Candidate {
    name: string;
    description: string;
    whenToUse: string;
    invocation: typeof INVOCATION;
    provider: string;
    source: 'bundled';
    resourceBase: typeof RESOURCE_BASE;
    rank: number;
    locator: URL;
}
/** 构造提供者。`meta` 与 `dir` 只为测试注入，生产路径不传。 */
export declare function makeProvider(meta?: readonly SkillMeta[], dir?: URL): {
    name: string;
    list: () => Promise<Candidate[]>;
    get(candidate: {
        name: string;
        locator: unknown;
    }): Promise<{
        name: string;
        description: string;
        whenToUse: string;
        invocation: {
            readonly modelInvocable: true;
            readonly userInvocable: true;
        };
        provider: string;
        source: "bundled";
        resourceBase: {
            readonly kind: 'directory';
            readonly path: string;
        };
        content: string;
    } | undefined>;
};
/** 列出 skills/ 下实际存在的技能文件名（测试用：与元信息对账）。 */
export declare function skillFiles(dir?: URL): string[];
/**
 * 在 `ctx.skills` 上注册标准技能提供者。**`skills` 服务不在时静默跳过**：没装 `dsh-skill` 的会话本来就没有技能机制，
 * 此时守卫与 std-check 照常工作，不因缺技能服务而挡住启动。
 */
export declare function registerStandardSkills(ctx: Context): (() => void) | undefined;
export {};
