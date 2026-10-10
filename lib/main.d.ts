import type { CheckModule } from './checks/index.js';
import type { Finding } from './core/finding.js';
export interface Args {
    root: string;
    selftest: boolean;
    json: boolean;
    noScope: boolean;
    config: string | null;
    migrate: boolean;
}
/** 参数解析：与 Python argparse 的行为对齐到本工具用到的子集；认不出的参数直接报错退出 2（不静默忽略）。 */
export declare function parseArgs(argv: readonly string[]): Args | string;
export interface Io {
    out: (text: string) => void;
    err: (text: string) => void;
}
/**
 * 新插件是否已装入 DSH profile：看 `$DSH_PROFILE_DIR/node_modules/dsh-project-std/lib/cli.js` 在不在。
 * 只读环境变量与一个文件的存在性；DSH 之外没有 DSH_PROFILE_DIR，如实返回"检测不到"并说明原因——不猜。
 */
export declare function pluginInstalled(env?: NodeJS.ProcessEnv): true | {
    ok: false;
    why: string;
};
/**
 * 返回退出码，不直接调 `process.exit`（它同步结束进程、接不住，设计 §12.31 取舍 3；测试也要能调）。
 * `extraSelftest`：`--selftest` 时追加的汇总层/stdlib 层自检（由入口注入，见头注释）；封签之外追加的部分不进身份比对，与 Python 版一致（其 `_sealed` 只包 findings 的收尾）。
 */
export declare function main(argv: readonly string[], extraSelftest?: () => Finding[], io?: Io, mods?: ReadonlyArray<CheckModule>): number;
