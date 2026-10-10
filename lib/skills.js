// 标准技能提供者：把随包分发的标准正文（skills/*.md）作为 DSH 技能暴露给会话。设计 §12.33。
//
// 做法对照一手来源：deepseek-ai/deepseek-harness 的 `packages/skill/skill-badge/src/index.ts`（官方样例）——插件 `inject: ['skills']`，
// `apply(ctx)` 里 `ctx.skills.registerProvider(() => provider)`；provider 有 `name`、`list()`、`get(candidate)`，正文放包内文件，
// `resourceBase` 指向包内目录。注册是同步的，返回 disposer；`dsh-tool-skill` 负责把目录与 `skill` 加载工具交给模型。
//
// **为什么是技能而不是项目里的 `.std/` 副本**：标准的副本放进每个采用项目，副本必然漂移（N2），升级一次要在每个项目里重做一遍。
// 技能随插件走：装插件即得、升级插件即升、项目里零副本。**确定性层（std-check、守卫）完全不碰模型**——技能只是把标准正文交给会话模型，由它决定读哪一节。
//
// 技能正文是 `scripts/build-skills.mjs` 从 标准/ 与 templates/ 生成的构建产物，提交进 git，由 `scripts/check-skills-sync.mjs` 钉住与标准一致。
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
/** 提供者名。`runtime` 是注册表保留名，不能用。 */
export const PROVIDER_NAME = 'ai-dev-std-standard';
/** 与 `@deepseek-ai/dsh-skill` 的 `BUNDLED_SKILL_RANK` 同值（600）：随包分发的技能。不 import 它，免得为一个常量多一个运行时依赖。 */
const BUNDLED_SKILL_RANK = 600;
const INVOCATION = { modelInvocable: true, userInvocable: true };
const SKILLS_DIR = new URL('../skills/', import.meta.url);
const RESOURCE_BASE = { kind: 'directory', path: fileURLToPath(SKILLS_DIR) };
/** 读 skills/ 下的元信息：每个 `<name>.md` 第一行是生成注释，元信息放在 skills/index.json（由 build-skills 同时生成）。 */
export function loadMeta(dir = SKILLS_DIR) {
    const raw = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
    if (!Array.isArray(raw))
        throw new TypeError('skills/index.json 应是数组');
    return raw.map((m) => {
        const o = m;
        if (typeof o.name !== 'string' || typeof o.description !== 'string' || typeof o.whenToUse !== 'string')
            throw new TypeError(`skills/index.json 条目缺字段：${JSON.stringify(m)}`);
        return { name: o.name, description: o.description, whenToUse: o.whenToUse };
    });
}
/** 构造提供者。`meta` 与 `dir` 只为测试注入，生产路径不传。 */
export function makeProvider(meta = loadMeta(), dir = SKILLS_DIR) {
    const candidates = meta.map((m) => ({
        name: m.name, description: m.description, whenToUse: m.whenToUse, invocation: INVOCATION, provider: PROVIDER_NAME,
        source: 'bundled', resourceBase: RESOURCE_BASE, rank: BUNDLED_SKILL_RANK, locator: new URL(`${m.name}.md`, dir),
    }));
    return {
        name: PROVIDER_NAME,
        list: () => Promise.resolve(candidates),
        async get(candidate) {
            const c = candidates.find((x) => x.name === candidate.name);
            if (c === undefined)
                return undefined;
            return {
                name: c.name, description: c.description, whenToUse: c.whenToUse, invocation: c.invocation, provider: c.provider, source: c.source,
                resourceBase: c.resourceBase, content: readFileSync(c.locator, 'utf8'),
            };
        },
    };
}
/** 列出 skills/ 下实际存在的技能文件名（测试用：与元信息对账）。 */
export function skillFiles(dir = SKILLS_DIR) {
    return readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
}
/**
 * 在 `ctx.skills` 上注册标准技能提供者。**`skills` 服务不在时静默跳过**：没装 `dsh-skill` 的会话本来就没有技能机制，
 * 此时守卫与 std-check 照常工作，不因缺技能服务而挡住启动。
 */
export function registerStandardSkills(ctx) {
    const skills = ctx.skills;
    if (typeof skills?.registerProvider !== 'function')
        return undefined;
    return skills.registerProvider(() => makeProvider());
}
