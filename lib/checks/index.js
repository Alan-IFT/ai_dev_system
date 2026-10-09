// 检查器注册表：显式的一张表，不扫目录（设计 §12.31 取舍 4）。
//
// Python 版 `discover()` 扫 `checks/check_*.py` 并按文件名排序加载。TS 版编译后目录里的文件集合由 `check-lib-sync` 钉住等于 `src/`，
// 但「新增一个文件就多一个检查器」让身份哈希与目录扫描互相牵制，且需要动态 `import`；改成显式表：次序固定、增减检查器必须改这里（被测试钉住）。
// **次序与 Python 的文件名排序结果相同**（adoption → cross-repo → derived → drift → entry-budget → evidence → freshness → layout → links → single-authority）：
// 文本报告里各检查器的条目次序因此不变。
import * as adoption from './adoption.js';
import * as crossRepo from './cross_repo.js';
import * as derived from './derived.js';
import * as drift from './drift.js';
import * as entryBudget from './entry_budget.js';
import * as evidence from './evidence.js';
import * as freshness from './freshness.js';
import * as layout from './layout.js';
import * as links from './links.js';
import * as singleAuthority from './single_authority.js';
export const CHECKS = [adoption, crossRepo, derived, drift, entryBudget, evidence, freshness, layout, links, singleAuthority];
/** `tailoring[].check` 除检查器短名外还认 `layout:<role>` 与裸 `<role>`（只有 layout 有分档工件）。 */
export function tailorableNames() {
    const names = new Set(CHECKS.map((m) => m.NAME));
    for (const role of layout.tierRoles()) {
        names.add(role);
        names.add(`${layout.NAME}:${role}`);
    }
    return [...names];
}
