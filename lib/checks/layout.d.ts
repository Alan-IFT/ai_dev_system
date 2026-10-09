import { type Config } from '../core/cfg.js';
import { type Finding } from '../core/finding.js';
export declare const NAME = "layout";
export declare const STANDARD_REFS: string[];
/** 全部分档的工件 role 名（`tailoring[].check` 可写 `layout:<role>` 或裸 `<role>`）；汇总层校验裁剪名用（Python 版读 `_TIER_ITEMS` 的第 0 列）。 */
export declare function tierRoles(): string[];
export declare function scope(cfg: Config): {
    covered: string[];
    not_covered: string[];
};
export declare function run(cfg: Config): Finding[];
export declare function selftest(): Finding[];
