import { type Config } from './cfg.js';
/** 01 §3.5 的「状态」字段在文档头部叫什么。中英两写都算；**新增写法只在这里加，不在检查器里另起一张表**。 */
export declare const STATUS_FIELDS: readonly string[];
/** 01 §3.5 的日期字段名缺省（`metadata_fields` 未配时取它，契约 §5）。 */
export declare const DEFAULT_DATE_FIELDS: readonly string[];
export declare const HEAD_CHARS = 4000;
export declare const LIST_CAP = 12;
/**
 * Python 的 `s[:n]`：按**码点**取前 n 个字符。JS 的 `s.slice(0, n)` 按 UTF-16 码元计，BMP 之外的字符（emoji、CJK 扩展区）占 2 个码元，
 * 含这类字符的文本会被少取（设计 §12.6 D18）。进判据的截取（头部区域、日期字段查找范围）必须用这个。
 * 纯展示的截断（evidence 里的前 N 字）不进判据，不要求等价，但同一处用它也无妨。
 * 快路径：码元数 ≤ n 时码点数必然 ≤ n，原样返回；否则逐码点数到 n。
 */
export declare function headChars(s: string, n: number): string;
/**
 * 在文本里找 `名字: 值` 或 `名字：值`。返回 [值, 命中的名字]，找不到返回 [null, null]。
 *
 * 值以换行、表格竖线或全角空格为界——示例项目把三个字段写在同一行，用全角空格分隔。
 * 字段名两侧可带加粗、斜体或反引号（`**状态**：done`、`` `status`: done ``）。
 * 冒号两侧只认同一行的空白：`状态：` 后面是空行时不许把下一行吞成值——值为空等于没写这个字段。
 * 名字前不认 `-`：`build-status: passing` 不是 `status`（列表项 `- status:` 靠空白分隔照认）。
 * 只取第一次出现：它的值为空就是缺字段，不往后文找同名字段（R1-05）；冒号后的全角空格照跳过。
 * 线性：名字只在行首或空白、`|`、`>` 之后起算，两侧装饰限 4 个——满行 `*` 曾是平方级（R1-01、R2-11）。
 */
export declare function findField(text: string, names: readonly unknown[]): [string | null, string | null];
/**
 * 文件头部区域（D-134）：以 `---` 起头的 YAML 头里有状态字段时只取它；否则取到第一个二级及以下标题之前
 * （含 YAML 头之后的引导段——日期写在 YAML、状态写在一级标题下是合法写法）；都不超过 HEAD_CHARS。
 *
 * 状态字段只从这里读——`## 背景` 之类小节里的 `状态：active` 字样不算。YAML 分支不可省：findField 按字段名
 * 顺序（状态→status→state）逐个找，不是取位置上第一次出现，YAML 写 `status:` 、正文写 `状态：` 时会读到正文。
 */
export declare function headOf(text: string): string;
/** 去掉 markdown 的加粗与反引号标记，再去首尾空白。输入按 Python 的 `str()` 转字符串。 */
export declare function clean(value: unknown): string;
/** 头部区域（headOf）的状态值（去装饰、去括注、小写）；没有状态字段返回 null。 */
export declare function itemStatus(text: string): string | null;
export declare function normRel(p: unknown): string;
/** rel 是否落在 sub 目录下。sub 为空或 '.' 视为整仓。 */
export declare function under(rel: string, sub: string): boolean;
/** 工作项文件的命名：01 §3.2 职责卡与 §3.3 阅读路径写作 `state/work/WI-*`；与 drift 认 ID 的 `WI-<三位以上数字>` 同一形式。 */
export declare const WORK_ITEM_NAME: RegExp;
export declare function isWorkItemName(rel: unknown): boolean;
/** 01 §3.1 文档树的根。契约 §5：`layout.docs_root` 缺省取它并在证据里注明。 */
export declare const DEFAULT_DOCS_ROOT = "docs";
/** 01 §3.1 大项目树的 `docs/state/work/`（工作项，一件一文件）。契约 §5：缺省取它并在证据里注明。 */
export declare const DEFAULT_WORK_ROOT = "docs/state/work";
/** ★ 状态工件没在 layout.artifacts.status 声明落点时的候选。 */
export declare const STATUS_CANDIDATES: readonly string[];
/** ★ 验收工件没在 layout.artifacts.acceptance 声明落点时的候选。 */
export declare const ACCEPTANCE_CANDIDATES: readonly string[];
/** 会话交接没在 layout.artifacts.handoff 声明落点时的候选。 */
export declare const HANDOFF_CANDIDATES: readonly string[];
/**
 * ★ 入口没在 layout.entry 声明时的候选，按此顺序取第一个存在的。`CLAUDE.md` 是 Claude Code 时代的**兼容候选名**（D-135：受支持宿主只有 DeepSeek Harness）。
 * **本块保持原行为，阶段 4 统一清**——现在删会让黄金样本里依赖它的几条对不上。
 */
export declare const ENTRY_CANDIDATES: readonly string[];
/** 文档根：`layout.docs_root`，未配则取 DEFAULT_DOCS_ROOT。返回 [相对路径, 证据注记]。 */
export declare function docsRootOf(cfg: Config): [string, string];
/** 以 `docs/` 开头的候选/缺省路径，按项目的 layout.docs_root 改基（缺省 docs 即不改）。 */
export declare function rebaseDocs(rel: unknown, docsRoot: unknown): string;
/** 工作项目录：`layout.work_root`，未配则取 DEFAULT_WORK_ROOT（随 docs_root 改基）。返回 [相对路径, 证据注记]。 */
export declare function workRoot(cfg: Config): [string, string];
/**
 * 入口文件：项目声明优先，未声明则取 ENTRY_CANDIDATES 里第一个存在的。返回 [相对路径列表, 注记]。
 * 注记为空＝取自项目声明（`layout.entry`，未配时认 `layout.artifacts.entry`），原样返回、不判存在；
 * 注记非空＝取自候选，列表只含命中的那一个，候选全不在时为空。候选是工具约定：据此只许出 PASS 或未定，不许出 FAIL（契约 §1.1）。
 */
export declare function entryFiles(cfg: Config): [string[], string];
/** 是否落在只读归档区（不承担更新义务，见 01 §3.1）。 */
export declare function inFrozen(cfg: Config, relpath: string): boolean;
/** 项目是否把该检查裁剪掉了。返回 [是否裁剪, 理由]。 */
export declare function isTailoredOut(cfg: Config, checkName: string): [boolean, string | null];
/**
 * 项目是否在 tailoring 里登记了 layout 的这个工件不适用。返回 [是否裁剪, 理由]。
 * 接受 `check: layout:<role>` 与 `check: <role>` 两种写法。layout 据它跳过该工件，freshness 据它判断该工件的元信息是否已由 layout 报（D-131）。
 */
export declare function artifactTailored(cfg: Config, role: string): [boolean, string | null];
/** 文档日期字段名：`metadata_fields`（字符串列表，也接受单个字符串）。返回 [名字列表, 是否用的默认值]。 */
export declare function dateFieldsOf(cfg: Config): [string[], boolean];
/**
 * 工作项目录里带状态字段的文件是工作项还是文档，及其状态归类（D-134，freshness 与 evidence 只此一处分流）。
 * 返回 [身份, 归类]：身份是 "work_item" 或 "document"；归类是 01 §4.1 六态之一或 01 §3.5 四值之一，认不出为 null。
 */
export declare function statusKind(cfg: Config, rel: string, status: string | null): ['work_item' | 'document', string | null];
