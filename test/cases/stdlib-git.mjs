// stdlib-git 的规格（测试 git.test.mjs）
// 行为规格：各函数在各输入上应有的返回值。最初取自迁移期对 Python 版的实测（原为 stdlib-git.json），Python 版与生成脚本已删除；
// 今后行为有意改变时手工改这里的期望值并说明原因。提炼的验收见 scripts/mutate-compare.mjs（变异清单每条的结局不许变坏）。

/** scrub（3 项） */
export const SCRUB = {
  after: { GIT_CEILING_DIRECTORIES: '/c', GIT_CONFIG_COUNT: '8', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_KEY_1: 'core.hooksPath', GIT_CONFIG_KEY_2: 'core.sshCommand', GIT_CONFIG_KEY_3: 'core.gitProxy', GIT_CONFIG_KEY_4: 'core.askPass', GIT_CONFIG_KEY_5: 'diff.external', GIT_CONFIG_KEY_6: 'core.pager', GIT_CONFIG_KEY_7: 'log.showSignature', GIT_CONFIG_VALUE_0: 'false', GIT_CONFIG_VALUE_1: 'nul', GIT_CONFIG_VALUE_2: 'true', GIT_CONFIG_VALUE_3: 'true', GIT_CONFIG_VALUE_4: 'true', GIT_CONFIG_VALUE_5: 'true', GIT_CONFIG_VALUE_6: 'cat', GIT_CONFIG_VALUE_7: 'false', GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0', HOME: '/h', OTHER: 'keep', PATH: '/x' },
  before: { GIT_CEILING_DIRECTORIES: '/c', GIT_CONFIG_COUNT: '3', GIT_CONFIG_KEY_0: 'a.b', GIT_CONFIG_KEY_1: 'd.e', GIT_CONFIG_VALUE_0: 'c', GIT_CONFIG_VALUE_1: 'f', GIT_DIR: '/evil', GIT_INDEX_FILE: '/evil/idx', GIT_PAGER: 'less', GIT_WORK_TREE: '/w', HOME: '/h', OTHER: 'keep', PATH: '/x' },
  devnull: 'nul',
}

/** version（12 条） */
export const VERSION = [
  { in: 'git version 2.56.0.windows.1', out: null },
  { in: 'git version 2.31.0', out: null },
  { in: 'git version 2.30.9', out: 'git 2.30 低于 2.31：经 GIT_CONFIG_COUNT 注入的加固（fsmonitor、过滤器、pager 等）会被静默忽略，被扫仓配置里的外部程序可能被执行；请升级 git' },
  { in: 'git version 1.9.0', out: 'git 1.9 低于 2.31：经 GIT_CONFIG_COUNT 注入的加固（fsmonitor、过滤器、pager 等）会被静默忽略，被扫仓配置里的外部程序可能被执行；请升级 git' },
  { in: 'git version 10.0', out: null },
  { in: '2.31', out: null },
  { in: 'garbage', out: '认不出 git 版本（\'garbage\'）；加固配置要 git ≥ 2.31 才生效' },
  { in: '', out: '认不出 git 版本（\'\'）；加固配置要 git ≥ 2.31 才生效' },
  { in: 'git version 2', out: '认不出 git 版本（\'git version 2\'）；加固配置要 git ≥ 2.31 才生效' },
  { in: 'git version 3.0.0', out: null },
  { in: 'git version 2.4.12', out: 'git 2.4 低于 2.31：经 GIT_CONFIG_COUNT 注入的加固（fsmonitor、过滤器、pager 等）会被静默忽略，被扫仓配置里的外部程序可能被执行；请升级 git' },
  { in: 'git version 02.031.0', out: null },
]
