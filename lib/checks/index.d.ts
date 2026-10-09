import type { Config } from '../core/cfg.js';
import type { Finding } from '../core/finding.js';
/** 每个检查器模块对汇总层承诺的接口（契约 §3、§4）。 */
export interface CheckModule {
    NAME: string;
    run(cfg: Config): Finding[];
    selftest(): Finding[];
    scope(cfg: Config): {
        covered: string[];
        not_covered: string[];
    };
}
export declare const CHECKS: ReadonlyArray<CheckModule>;
/** `tailoring[].check` 除检查器短名外还认 `layout:<role>` 与裸 `<role>`（只有 layout 有分档工件）。 */
export declare function tailorableNames(): string[];
