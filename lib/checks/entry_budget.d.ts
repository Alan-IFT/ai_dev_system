import { type Config } from '../core/cfg.js';
import { type Finding } from '../core/finding.js';
export declare const NAME = "entry-budget";
export declare const STANDARD_REFS: string[];
export declare function scope(cfg: Config): {
    covered: string[];
    not_covered: string[];
};
export declare function run(cfg: Config): Finding[];
export declare function selftest(): Finding[];
