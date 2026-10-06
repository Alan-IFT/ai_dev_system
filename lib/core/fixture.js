// 自检夹具：写文件、建 git 仓（对应 tools/std/stdlib.py 的 write_text / write_files / GIT_FIXTURE_ID / git_fixture / git_track）。各检查器与 check_all 的自检共用。
//
// **只用于本工具自建的夹具仓，不得用于被扫仓**：它不走 filterEnv，被扫仓的 git 调用一律经 filterEnv（见 git.ts 头注释）。
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
/** 写文本文件：UTF-8、LF（不做行尾转换），父目录不存在就建。 */
export function writeText(path, text) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, { encoding: 'utf8' });
}
/** 按 {相对路径: 内容} 在 root 下摆自检样本。 */
export function writeFiles(root, files) {
    for (const [rel, body] of Object.entries(files))
        writeText(join(root, rel), body);
}
/** 夹具不受全局配置左右：固定身份、不签名、不跑全局钩子、不转换换行。 */
export const GIT_FIXTURE_ID = [
    '-c', 'user.email=std@example.invalid', '-c', 'user.name=std', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false',
];
/** 在本工具自建的夹具仓里跑一条 git；退出码非 0 即抛。 */
export function gitFixture(repo, args, env) {
    const r = spawnSync('git', ['-C', repo, '-c', 'init.defaultBranch=main', ...GIT_FIXTURE_ID, ...args], { timeout: 60_000, env: env ?? process.env });
    if (r.status !== 0)
        throw new Error(`git ${args.join(' ')} 退出码 ${r.status}：${(r.stderr ?? Buffer.alloc(0)).toString('utf8').slice(0, 200)}`);
}
/**
 * 自检样本要被 git 跟踪才进得了扫描范围；给了 when 再以该时间真提交一次。返回 null 或错误串。
 * 只用于本工具自建的夹具仓，不得用于被扫仓（不走 filterEnv）。
 */
export function gitTrack(tmp, when) {
    const cmds = [
        ['git', '-c', 'init.defaultBranch=main', 'init', '-q', tmp],
        ['git', '-C', tmp, '-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', 'add', '-A', '-f'],
    ];
    let env;
    if (when) {
        cmds.push(['git', '-C', tmp, ...GIT_FIXTURE_ID, 'commit', '-q', '-m', 's']);
        env = { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when };
    }
    for (const cmd of cmds) {
        const r = spawnSync(cmd[0], cmd.slice(1), { timeout: 60_000, encoding: 'utf8', env: env ?? process.env });
        if (r.error)
            return `${cmd[0]} 跑不了：${r.error.message}`;
        if (r.status !== 0)
            return `${cmd.slice(0, 3).join(' ')} 退出码 ${r.status}：${(r.stderr || '').slice(0, 200)}`;
    }
    return null;
}
