import { type Config } from '../core/cfg.js';
import { type Finding } from '../core/finding.js';
export declare const NAME = "adoption";
export declare const STANDARD_REFS: string[];
export declare function scope(cfg: Config): {
    covered: string[];
    not_covered: string[];
};
export declare function run(cfg: Config): Finding[];
/** 01 §5.3：`project.yaml` 的 `compatibility.policy` 必填。 */
export declare function compatibility(cfg: Config): Finding;
export declare function selftest(): Finding[];
