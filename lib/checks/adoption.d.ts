import { type Config } from '../core/cfg.js';
import { type Finding } from '../core/finding.js';
export declare const NAME = "adoption";
export declare const STANDARD_REFS: string[];
/** 把 STANDARD_VERSION 拆开。返回 [版本值, 采用日期, 键值对列表]。
 *
 * 实物形状取自 `标准/示例项目-连锁零售中台/governance/STANDARD_VERSION`：
 *     1.0
 *     adopted_at: 2025-03-03
 *     last_evaluated_upgrade: 2026-09-07 (no newer version)
 * 首行是**裸的版本值**，其后是 `键: 值`。所以判据是：第一条不含键冒号的非空行即版本值；也接受 `version: 1.0` 这种写法。`#` 开头的行当注释。
 * 这不是 YAML——`parseYamlSubset` 会在首行那个裸值上直接抛错。 */
export declare function parse(text: string): [string | null, string | null, Array<[string, string]>];
export declare function scope(cfg: Config): {
    covered: string[];
    not_covered: string[];
};
export declare function run(cfg: Config): Finding[];
/** 全文非空行（去首尾空白）用「；」连起来，取前 200 个码点；空文件写「（空文件）」。进 evidence，所以要与 Python 逐字相同。 */
export declare function rawHead(text: string): string;
/** 01 §5.3：`project.yaml` 的 `compatibility.policy` 必填。 */
export declare function compatibility(cfg: Config): Finding;
export declare function selftest(): Finding[];
