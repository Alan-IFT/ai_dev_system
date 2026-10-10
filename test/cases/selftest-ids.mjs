// 各检查器 selftest() 应产出的 (id, status) 清单：钉住「自检不许悄悄少一条、多一条、或状态变了」。
// id 是标题的哈希，所以每行后面附标题便于人读；改标题会改 id（例外登记册按 id 认），因此标题不许随手改。
// 最初取自迁移期 Python 版黄金探针（adoption 一栏扣掉了随废弃宿主与版本记录判据删除的、加上 TS 新增的，见 expected-changes）；今后增删探针时手工改这里。

/** adoption（2 条） */
export const ADOPTION = [
  ["adoption/b6031618", "PASS", "裁剪 adoption 时本检查记一条 SKIP、compatibility.policy 照判（不可裁剪，D-126）。原先这条行为只被真…"],
  ["adoption/f32dd8ac", "PASS", "替代 adoption/d5d57eb2 的前一半：compatibility.policy（01 §5.3）缺、空串、空列表、false …"],
]

/** cross-repo（17 条） */
export const CROSS_REPO = [
  ["cross-repo/061c4b39", "PASS", "判据八：别名与在册仓名只差大小写也算相撞，记未定不扫描（B10）"],
  ["cross-repo/44876fb7", "PASS", "反例：退役仓规则未失效 + 系统入口未登记该仓，应判 FAIL"],
  ["cross-repo/4533eaab", "PASS", "第二跳不跟随、不探测指向仓外的链接（入口两跳到不了系统仓照判 FAIL）"],
  ["cross-repo/62179520", "PASS", "判据八一仓一次 git grep、命中逐别名归属；退役仓扫描清单不重复列"],
  ["cross-repo/6fda752c", "PASS", "登记行的英文状态词按独立记号认，filesystem 不算 system"],
  ["cross-repo/8d32ebfd", "PASS", "判据八正例：别的仓里没有出现历史别名，应判 PASS"],
  ["cross-repo/91ef9316", "PASS", "链接抽取对 `](` 连写 2000 次、连续空行与无 `]` 的 `[` 行须线性，且照常认出带标题、尖括号与引用式的链接"],
  ["cross-repo/a69d375a", "PASS", "id 区分力：两个仓各有一处绝对路径引用，两条未定的 id 须按仓名分开"],
  ["cross-repo/bea26eb8", "PASS", "兄弟仓读到的文件须在该仓真实位置之内：入口符号链接出仓记未定不读；声明仓之外的引用记未定不探测"],
  ["cross-repo/c39ccf26", "PASS", "判据八收窄反例：同行带改名标记不得报；别名撞在册仓名必须记未定且不扫描"],
  ["cross-repo/d4e89795", "PASS", "本机只有一个仓：system+archived 不出未定，path 不在只由判据二报一次，跨仓引用记不适用"],
  ["cross-repo/dea7d4d9", "PASS", "判据八：路径含冒号的 layout.frozen 目录照样豁免（B9）"],
  ["cross-repo/f4f9b1c3", "PASS", "退役仓规则位置是出仓软链接：只记一条未定（写条目名），不列仓外文件名、不报 PASS"],
  ["cross-repo/f58c51d8", "PASS", "repos 两项同名须整条记未定（配置读不出），不得让无入口的那个仓借名报 PASS"],
  ["cross-repo/f5a8de1d", "PASS", "正例：承载仓唯一、各仓有入口、投影可达、状态已登记、退役仓已标失效，应判 PASS"],
  ["cross-repo/fbed81f3", "PASS", "判据八反例：历史别名出现在别的仓里，应判 FAIL"],
  ["cross-repo/fea41078", "PASS", "archived 无 path 夹具：判据二应 PASS，需读其本地文件的各条应记不适用，全程不得出现未定"],
]

/** derived-artifacts（9 条） */
export const DERIVED = [
  ["derived-artifacts/0deeb94a", "PASS", "正例：声明齐全且不落后应全判 PASS"],
  ["derived-artifacts/6315086a", "PASS", "反例五：源路径带 [ ] 按字面取提交时间，不被通配到别的文件"],
  ["derived-artifacts/71329c97", "PASS", "R2-7：一个派生物配两个源，落后按 (派生物, 源) 分开，头部只判一次"],
  ["derived-artifacts/84c53b3c", "PASS", "反例：派生物头部无自我声明应判 FAIL"],
  ["derived-artifacts/85ca4565", "PASS", "反例二：派生物落后于源应判 FAIL"],
  ["derived-artifacts/c98ad9cd", "PASS", "反例三：只有生成器署名、未指明源，须仍判 FAIL，且证据须引原文而非说『没有任何标记』"],
  ["derived-artifacts/cb742bc7", "PASS", "反例四：两条声明各缺自己的源，两条未定的 id 须按 artifact 路径分开；FAIL 的 id 不随声明序号漂"],
  ["derived-artifacts/cba90804", "PASS", "反例：浅克隆下取不到真实提交先后，陈旧与否记未定"],
  ["derived-artifacts/f6b98540", "PASS", "反例六：源文件名按路径/词边界匹配，api 不命中 rapid、api.md，map.json 不命中 map.json.bak；中文紧贴、…"],
]

/** drift（27 条） */
export const DRIFT = [
  ["drift/003009a0", "PASS", "PASS 的两个方向：判据 1 这次干净，须出一条 `drift/future-date` PASS 让它看得出跑过；判据 4 这次有问题，…"],
  ["drift/08a632f8", "PASS", "3d 正例：索引「文件」列写裸 `ADR-0002`，实物叫 `ADR-0002-y.md`，两段式定位须找到它"],
  ["drift/212fc47e", "PASS", "3e 反例：索引「文件」列指向仓外（绝对路径、`..`）不得探测存在性，按缺实物记未定"],
  ["drift/24028bac", "PASS", "2f/2g/2h：4 反引号外层内嵌 ``` 后的真标记、行首 ```x``` 后的真标记、表格行 `| Revision | 2 |` 都…"],
  ["drift/25db4efe", "PASS", "4i 反例：work_root 子目录 artifacts/ 下以 WI-0003 开头的留证不是工作项文件，须报 missing；直接一层…"],
  ["drift/2bd07a2e", "PASS", "1c 反例：提交后追加的未提交行，基准取运行时刻，证据要写明『未提交』"],
  ["drift/2ebe56f8", "PASS", "2a 反例 + 2b/2c 正例：`> **修订二**：` 须报出；『正文里补充索引后』（标记词在第 3 位）与 decisions 之外的…"],
  ["drift/393f682d", "PASS", "3a 反例：索引列了 ADR-0002 而目录里没有实物，须聚合成一条 adr-index-missing 未定"],
  ["drift/4c7b151a", "PASS", "4d 正例：layout.artifacts.status 指向目录时视为存在，不报 status-missing；ID 取目录下直接一层 …"],
  ["drift/558cca22", "PASS", "4h 反例：WI-0002 只在正文里被提到、没有 work_item_id 行，仍须报 missing"],
  ["drift/69bda0c1", "PASS", "4f 正例：状态文件列了 ID 而工作项目录不在，只记一条 work-root-absent（SKIP），不逐 ID 报 work-item…"],
  ["drift/6c1e72af", "PASS", "4a 附带：未声明 layout.work_root 时取常量 docs/state/work，证据里须注明用的是默认"],
  ["drift/76b4f6f0", "PASS", "4i 附带：`work_root: work/` 带尾斜杠时，直接一层的 WI-0004-a.md 照样算载体"],
  ["drift/7f93d59d", "PASS", "5 ADR 目录没定位到：L1 记不适用，L2 与档位不明记未定"],
  ["drift/8bb89ca3", "PASS", "3c 正例：同一棵树，ADR 目录靠目录名回退猜到时，同一条须降为 UNDETERMINED 不是 FAIL"],
  ["drift/8e9aa534", "PASS", "1f 反例：同一提交里写『2026-09-15 裁定』须照报——UTC+14 下也还没到那天"],
  ["drift/902071d7", "PASS", "4a 反例 + 4b/4c 正例：STATUS 写了 WI-0001 而 work/ 下没有它，须报一条未定；有文件的 WI-0003 与只…"],
  ["drift/9c5ad6f7", "PASS", "4j 反例：只有 WI-0010-x.md 时 WI-001 仍须报 missing"],
  ["drift/ad517f0c", "PASS", "3b 反例：目录里有 ADR-0003 实物而索引没列，且项目**声明了** layout.artifacts.decisions，须判 F…"],
  ["drift/ce4f755e", "PASS", "4g 正例：状态源文件里行首 `work_item_id：WI-0001` 的小节就是该工作项的载体，不得报 missing"],
  ["drift/cf72a0ca", "PASS", "1e 正例：-0700 时区 09-13 晚上的提交里写『2026-09-14 裁定』不得报——同一时刻在东边已是 09-14"],
  ["drift/daab791c", "PASS", "1a 反例 + 1b/1d 正例：『2026-09-22 裁定』写于 09-21 须报出且状态是 UNDETERMINED；保留至/到期/复…"],
  ["drift/ecabd3e9", "PASS", "4e 反例：layout.artifacts.status 指向的路径文件与目录都不存在，仍须报 status-missing"],
  ["drift/f20d0eed", "PASS", "1h 反例：SHA-256 仓里写于 09-21 的『2026-09-22 裁定』须报出，行号按 \\n 计为第 2 行"],
  ["drift/f317c944", "PASS", "1g 反例：含 \\x0c、U+2028 与孤立 \\r（B14）的行里写于 09-21 的『2026-09-22 裁定』须报出，行号按 \\n …"],
  ["drift/f52f8369", "PASS", "4k 反例：一份文档、一份状态源读不了只各记一条未定，其余照判（未来日期照报、工作项照核）"],
  ["drift/fa3e02e6", "PASS", "2d 正例 + 2e 反例：围栏代码块内、`revision id …` 叙述行、「修订后」开头的指代句都不得命中；`## 修订记录`、`修…"],
]

/** entry-budget（10 条） */
export const ENTRY_BUDGET = [
  ["entry-budget/18715b4e", "PASS", "反例：声明的状态 100 行 / 声明预算 80 应判 FAIL doc-over"],
  ["entry-budget/2219d8c9", "PASS", "正例：入口 3 行 / 预算 10 应判 PASS"],
  ["entry-budget/26639848", "PASS", "正例：budgets.status_lines=120 时同一份 100 行应判 PASS"],
  ["entry-budget/586164be", "PASS", "反例：入口 20 行 / 预算 10 应判 FAIL"],
  ["entry-budget/75d53bfe", "PASS", "候选状态 WORK.md 100 行只记未定 candidate-over（契约 §1.1）"],
  ["entry-budget/aee57032", "PASS", "状态声明为目录记 SKIP status-dir"],
  ["entry-budget/b0c4b872", "PASS", "反例：工作项 160、交接 70、模块 201 判 FAIL；状态兼工作项 100 行记未定 merged-over；无状态字段的不算工作项"],
  ["entry-budget/d9c82b5e", "PASS", "未声明预算不判：声明的状态 100 行、四个预算键都没有，只得四条 SKIP budget-undeclared"],
  ["entry-budget/e91915e1", "PASS", "正例：各在预算上限内 PASS；合并工件超过最宽的 150 判 FAIL"],
  ["entry-budget/f7c0a097", "PASS", "出仓符号链接：不列仓外文件名、一份出仓不吞掉整类、入口出仓记 SKIP、出仓工作项记 outside-root"],
]

/** evidence（17 条） */
export const EVIDENCE = [
  ["evidence/484069ac", "PASS", "正例：六字段齐全且限制非空，应判 PASS"],
  ["evidence/4ea8639d", "PASS", "R2-5：工作项目录链到项目之外只记 SKIP 指向 layout"],
  ["evidence/4ee18995", "PASS", "反例：已完成工作项⑥确认方法写的是占位，应判 FAIL"],
  ["evidence/6dc6acd4", "PASS", "C06：证据条目里代码块的 # 注释不当标题，六字段齐全判 PASS"],
  ["evidence/7080d91d", "PASS", "反例：已完成工作项缺⑥确认方法，应判 FAIL"],
  ["evidence/7c25a3c8", "PASS", "R2-11：表格分隔行判定线性、结果不变"],
  ["evidence/7e3300b0", "PASS", "R2-2：证据段里没有字段行的小标题不当成一条空证据"],
  ["evidence/8a965b19", "PASS", "C08：字段表写法里格子与表外的「输出: …」不凭空生出「（整段）」证据"],
  ["evidence/9916d797", "PASS", "只看直接一层、读不到状态的静默跳过：子目录里的完成态留证不查，current.md 与无状态 WI 不报"],
  ["evidence/9e399694", "PASS", "R2-1：说明词、URL、时刻不算认不出的标签，一行认不出最多顶一个缺项"],
  ["evidence/aeb98658", "PASS", "约定：## Evidence 下六字段齐全判 PASS；认不出证据段只记未定，不判 FAIL"],
  ["evidence/af5bdaad", "PASS", "C07：自造字段名认不出只记未定（fields-unrecognized），不判 FAIL"],
  ["evidence/c62fff65", "PASS", "反例：落在 layout.frozen 里的已完成工作项，缺⑥仍应判 FAIL"],
  ["evidence/cfb87f64", "PASS", "反例：两份工作项读不了，各出一条 unreadable/<路径>，不出 internal-error"],
  ["evidence/d96285be", "PASS", "R2-12：长围栏只被同字符、不短于开栏的行闭合"],
  ["evidence/e65cf7ce", "PASS", "C13：### 小标题起头的证据条目按条目判，同级标题结束证据段"],
  ["evidence/f64e08d6", "PASS", "C19：字段表条目的 id 取条目名与文件，不随行号漂"],
]

/** freshness（22 条） */
export const FRESHNESS = [
  ["freshness/01289e83", "PASS", "反例九：metadata_required 命中而没认出状态字段的文档记一条聚合未定，状态字段只认头部；带状态的、layout 已查的（声明…"],
  ["freshness/0a05251c", "PASS", "反例六：未配 metadata_required 时目录名约定命中的无日期文档只记未定，不判 FAIL"],
  ["freshness/0b94170e", "PASS", "反例七之二：文件名带 [ ] 的超龄工作项按字面取提交时间，仍判 FAIL"],
  ["freshness/0cd46a1d", "PASS", "正例：昨天更新的文档 + 昨天刚转换的进行中工作项，应各判一条 PASS"],
  ["freshness/2b433830", "PASS", "反例七：退到提交时间的超龄工作项，完整仓判 FAIL、浅克隆记未定"],
  ["freshness/35b1b5b7", "PASS", "C22：工作项目录在文档根下时每份只读一遍，浅克隆只探测一次"],
  ["freshness/513ddf5b", "PASS", "C10：取最后一条转换记录；备注日期与别处的 from 行不洗白停滞工作项，空记录记未定"],
  ["freshness/531a0810", "PASS", "反例九之二：验收工件被 tailoring 裁掉、或 layout 整个被裁时，它缺状态字段由 freshness 报一条未定"],
  ["freshness/61c2e67f", "PASS", "反例八之三：! 排除的文档只记一条不适用、文档根外的不扫，未排除的无日期照判 FAIL；开头带 ./ 的写法同判"],
  ["freshness/6679be9e", "PASS", "反例五：同一份文档放得更久，标题里的天数变而 id 不变（id = freshness/stale/<路径>）"],
  ["freshness/687491e5", "PASS", "R2-3：只认第一段连续的记录行，其后的备注列表与第二张表不算转换记录"],
  ["freshness/9aa28016", "PASS", "反例八：docs_root 之外的 metadata_required 前缀照扫，无日期判 FAIL、有日期判 PASS"],
  ["freshness/a5390e4b", "PASS", "反例八之二：layout.frozen 内的前缀不产出失败或未定；metadata_required 写成 ./ 、. 、空、/ 或 .. …"],
  ["freshness/ae8f6e57", "PASS", "反例四之二：metadata_required: [] 时无日期文档整轮记一条不适用，不留聚合未定（键缺失才记未定，见反例三）"],
  ["freshness/be54df7f", "PASS", "反例八之四：! 后为空、/ 或 .. 起头、. 、./ ，排除不在包含之下、只有排除、与包含相同，均整份拒收；裸写 ! 提示加引号；合法排除…"],
  ["freshness/bff0c5f4", "PASS", "反例五之二：超龄天数与聚合份数变了，FAIL 与未定的 id 都不变"],
  ["freshness/c73e5abb", "PASS", "C18：日期晚基准日一天按当天算，晚两天记未定"],
  ["freshness/ccaf1e76", "PASS", "C11：未声明 metadata_fields 时 metadata_required 命中的无日期文档只记未定"],
  ["freshness/d36757c0", "PASS", "反例四：配了 metadata_required: [docs/ops] 后，命中的判 FAIL、未命中的判不适用，不再有未分类（钉死『替换…"],
  ["freshness/dd8bd1e6", "PASS", "反例：无日期文档 + 停滞 100 天的进行中工作项，应各判一条 FAIL"],
  ["freshness/e1f85afc", "PASS", "工作项按 WI-* 命名认：current.md/handoff.md 不报 no-status、子目录不数，无状态的 WI-* 记未定"],
  ["freshness/f1c4cea6", "PASS", "反例三：路径不匹配目录名约定（含中文名）的无日期文档，未配 metadata_required 时须记聚合未定，不得逐份记不适用"],
]

/** layout（10 条） */
export const LAYOUT = [
  ["layout/16529259", "PASS", "反例：layout.artifacts 声明了 ★ 状态工件却不存在，应判 FAIL"],
  ["layout/221ad24d", "PASS", "正例：L0 五件齐且元信息齐应全判 PASS"],
  ["layout/26a898b5", "PASS", "C09：声明的工作项目录不在，任何档都由 layout 报且只报一条 FAIL"],
  ["layout/a54cd26c", "PASS", "C16：入口与状态工件链到项目之外记未定，不判在、不判缺"],
  ["layout/b2b2fe90", "PASS", "R2-6：同一目录兼作几类工件时「是目录，不逐份判元信息」只出一条"],
  ["layout/b8cc4d11", "PASS", "约定：未声明 metadata_fields 时缺元信息只记未定；同行并排的字段须认得出"],
  ["layout/bdf7f191", "PASS", "探测：★ 工件未声明落点且候选未命中，应判未定、不得判 FAIL"],
  ["layout/c2053d7b", "PASS", "反例：声明的 ★ 状态工件缺头部元信息，应判 FAIL"],
  ["layout/d1d7742e", "PASS", "find_field：满行 * 线性；常见写法照认；首个同名字段为空即缺；全角空格照跳"],
  ["layout/f5113e31", "PASS", "C14：扫描根带 [ ] 时 glob 候选按字面拼根，tools/check_x.py 判在"],
]

/** links（8 条） */
export const LINKS = [
  ["links/10cb18c5", "PASS", "反例二：同一份文件里同一个链接目标重复出现，应合并成一条、行号进证据、id 带源文件"],
  ["links/110b581d", "PASS", "C22：互相链接的两份 markdown 各只读一遍"],
  ["links/455346eb", "PASS", "正例：文件与两个锚点都在，应全判 PASS"],
  ["links/489c701e", "PASS", "反例五：同一缺失目标只出一条 FAIL、id 不随行号漂；查询串与带协议的目标不当本地路径"],
  ["links/58cb6a20", "PASS", "反例三：项目之外的链接目标与出仓符号链接记未定、不读内容；长空白、满行 [ / < / _ 的标题线性"],
  ["links/70c608a0", "PASS", "反例：指向不存在的 missing.md 应判 FAIL"],
  ["links/bcfcd52e", "PASS", "反例四：下划线锚点、setext 锚点、仓根路径、<> 包裹路径按实际渲染认；仓根找不到记未定"],
  ["links/f5fc8e2d", "PASS", "R2-9：文件:行号 按本地路径核，只有查询串的链接不当锚点"],
]

/** single-authority（18 条） */
export const SINGLE_AUTHORITY = [
  ["single-authority/1309a62b", "PASS", "线性：6 万字符的竖线行、链接后长空白行、满行「第 12 个」与满行 `[` 须在 2 秒内，结构行认法不变"],
  ["single-authority/3b942f4b", "PASS", "边界三：纯代码仓的判据 2、3 须记未定，不得记 PASS"],
  ["single-authority/51a2defa", "PASS", "边界四：两份逐字节相同的 .py 仍须判 FAIL（判据 1 不收窄）"],
  ["single-authority/60fc1353", "PASS", "探测三之三：文档编号「01 项…」跨 3 个文件不得报，同批的真计数声明「44 篇…」必须照报"],
  ["single-authority/62ad9df7", "PASS", "边界一：重复只在 .py 之间应不判 FAIL、不记未定，且汇总成一条 SKIP（id 不变）"],
  ["single-authority/78590db1", "PASS", "探测三之三：再加一个抄同一数值的文件，标题计数变而 id 不变"],
  ["single-authority/83ee8c35", "PASS", "探测三：重复数值声明出现在 3 个文件应判未定、不得升格为失败"],
  ["single-authority/b5a13fc1", "PASS", "探测三之四：序数「第 N 个」「第 N、M 个」跨 3 个文件不得报，同批的基数「23 个…」「3、18 个…」必须照报"],
  ["single-authority/ba5e3c46", "PASS", "边界五：.txt 与 .rst 之间的重复段落仍须判 FAIL"],
  ["single-authority/bdf73afe", "PASS", "探测三之二：只出现在链接文本里的数字，跨 3 个文件也不报"],
  ["single-authority/be24cd33", "PASS", "反例二之二：行内 ```x``` 与外层 4 反引号围栏之后的重复段落仍须判 FAIL"],
  ["single-authority/bf7520e9", "PASS", "反例一之三：仓外软链接不得被 isfile 探测、记一条未定；已删未提交的文件不记未定"],
  ["single-authority/c5d56c63", "PASS", "反例二：跨文件重复的三行段落应判 FAIL"],
  ["single-authority/ced71be1", "PASS", "边界一之二：同形数值只在 .py 之间应汇总成一条 SKIP（id 不变）"],
  ["single-authority/d2880d07", "PASS", "边界二：文档抄源码的一段仍须判 FAIL，落点在 .md"],
  ["single-authority/d9b9a4c7", "PASS", "探测三之五：「1,614」与「1614」同键，「3,45」「1、2」「21，933」不并数"],
  ["single-authority/da5a5c20", "PASS", "反例一：两个逐字节相同的文件应判 FAIL"],
  ["single-authority/f7c9be5f", "PASS", "正例：三份互不相同的文档应全判 PASS"],
]
