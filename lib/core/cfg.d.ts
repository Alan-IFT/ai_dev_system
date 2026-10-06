import type { YamlValue } from './yaml.js';
/** 配置对象：`load_config` 的结果。顶层键是任意 YAML 值；`_root`、`_path` 由代码注入（契约 §4）。 */
export type Config = {
    [k: string]: YamlValue | undefined;
};
/** 按 'budgets.entry_lines' 取值，缺失返回 default。中间任何一层不是映射、或缺键，都返回 default。 */
export declare function cfgGet(cfg: unknown, path: string, dflt?: YamlValue | undefined): YamlValue | undefined;
/** 01 §4.1 六态 → 别名（小写），唯一一份（01 §1 G2）：freshness 与 evidence 都按它判进行中 / 完成 / 认不出。 */
export declare const WORK_ITEM_STATES: ReadonlyArray<readonly [string, readonly string[]]>;
export declare const DECLARED_STATES: ReadonlyArray<readonly [string, string]>;
/** 01 §3.5 文档状态四值 → 别名（小写），唯一一份。与 WORK_ITEM_STATES 不得有交集，项目声明的 work_item_*_states 撞上它整份拒收。 */
export declare const DOC_STATES: ReadonlyArray<readonly [string, readonly string[]]>;
/** 状态词表配置（列表或单个字符串），未配取 default。归一为去空白小写的列表。 */
export declare function stateList(cfg: unknown, path: string, dflt: readonly string[]): string[];
/** Python 的真值：None、False、0、0.0、''、[]、{} 为假。 */
export declare function pyTruthy(v: unknown): boolean;
/** Python 的 `str(x)`：对本模块会遇到的 YAML 值（字符串、整数、浮点、布尔、None）足够。布尔是 `True`/`False`，None 是 `None`。 */
export declare function pyStr(v: unknown): string;
/**
 * status 开头的状态词归到哪一类：别名之后是结尾或非字母数字即命中，长别名优先；认不出返回 null。
 * 「字母数字」按 Python 的 `str.isalnum()` ——Unicode 字母与数字，设计 §12.6 D5：JS 用 `[\p{L}\p{N}]`，已分配码点上与 Python 等价。
 */
export declare function leadWord(status: string | null | undefined, words: ReadonlyArray<readonly [string, string]>): string | null;
/** 工作项状态值归到 01 §4.1 六态之一，认不出返回 null（D-127）。project.yaml 的 work_item_*_states **并入**对应态，不替换缺省。 */
export declare function stateClass(cfg: unknown, status: string | null | undefined): string | null;
