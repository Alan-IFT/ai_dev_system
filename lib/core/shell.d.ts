import { FAIL, PASS, SKIP, UNDETERMINED, type Finding, type FindingInit } from './finding.js';
import type { Config } from './cfg.js';
/** Python 的 `type(exc).__name__`：本模块只需要把 JS 的 Error 映射到一个稳定的类名，供 reason 里显示。系统错误带 `code` 的映射成 Python 的类名。 */
export declare function excTypeName(e: unknown): string;
/** 检查器内部异常一律转 UNDETERMINED，绝不吞掉记 PASS。 */
export declare function undeterminedFromException(check: string, exc: unknown, what: string): Finding;
/** 检查器 run() 的公共外壳：项目已裁剪记一条 SKIP；fn(cfg) 的内部异常一律转未定（契约 §1、§4）。 */
export declare function runGuarded(check: string, fn: (cfg: Config) => Finding[], cfg: Config): Finding[];
/** 自检的一条断言：ok 为真记 PASS，否则 FAIL（契约 §3）。 */
export declare function probe(check: string, ok: boolean, title: string, init?: FindingInit): Finding;
/** 自检的一条断言自己跑崩了：记 FAIL，不按通过记。 */
export declare function probeCrashed(check: string, what: string, exc: unknown): Finding;
/**
 * 读不了的文件（超限、不是常规文件、出仓、IO 错）：是对象的事，不是检查器故障，不落兜底 id。每个检查器内同一文件只报一次（同一 id，调用方去重）。
 */
export declare function unreadable(check: string, rel: string, exc: unknown): Finding;
/** 同一 id 只留第一条（契约 §1 同一事实只报一次）：一份文件被几条判据读、各自读不了时用。 */
export declare function once(findings: readonly Finding[]): Finding[];
/** 字面在项目内、真实位置出仓的路径：记未定，不判缺失、不探测目标在不在（契约 §5）。 */
export declare function outsideRoot(check: string, rel: string): Finding;
/**
 * 工作项目录不在时返回一条 SKIP，在则返回 null。给以工作项为对象的检查器用。
 * 「目录在不在」是 01 §3.1 的存在性事实，由 layout 报一次（契约 §1「同一事实只报一次」）；evidence / freshness 从前各报一条未定，采用方得为同一件事登记两行。
 */
export declare function workRootAbsent(check: string, cfg: Config): Finding | null;
/**
 * 给一组依赖某项缺省的 finding 在 `evidence` 末尾统一补上注记（契约 §5：取了默认就得说）。只改证据不改标题，id 不变。注记为空或已含时不动。返回原列表。
 * `freshness` 与 `drift` 共用（Python 版在 stdlib）。
 */
export declare function noteDefault(findings: Finding[], n: string): Finding[];
/**
 * 把一批同类路径聚成一条 Finding，证据最多列 LIST_CAP 条。
 * `kind` 必填：标题带份数，不给 kind 时兜底 id 随份数变，登记行就成孤儿（契约 §4、§9；D-123）。
 */
export declare function agg(check: string, status: string, title: string, paths: readonly string[], reason: string, why: string, kind: string): Finding;
export { FAIL, PASS, SKIP, UNDETERMINED };
