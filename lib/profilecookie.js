/**
 * 从 profile 的原始 cordis.patch.yml 里直接把 cookie 读出来（2026-11-05）。
 *
 * 背景：宿主把插件配置传过来时，多行 plain scalar（我们的 sessdata 是 14 行 cookie）
 * 会被截断（线上实测只拿到 15 / 24 个字符），导致登录永远失败。
 * 配置文件本身是完整的，所以这里绕过宿主，自己解析一遍：
 *   - 找到 `- id: dsh-bili` 块
 *   - 取 `sessdata:` 后面的值（含后续缩进续行，YAML plain scalar 的折叠写法）
 *   - 拼成一行
 *
 * 只在"宿主给的值看起来不完整"时使用，正常情况不生效。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
/** cookie 至少要这么长才算"像真的"（整段通常几百字符，只填 SESSDATA 值也有 200+） */
export const MIN_REAL_COOKIE_LENGTH = 100;
/** 从一段 YAML 文本里抽出 dsh-bili 的 sessdata（支持多行 plain scalar） */
export function extractSessdataFromYaml(text, pluginId = 'dsh-bili') {
    const lines = text.split(/\r?\n/);
    let blockStart = -1;
    for (let i = 0; i < lines.length; i += 1) {
        if (new RegExp('^\\s*-\\s*id:\\s*' + pluginId + '\\s*$').test(lines[i] ?? '')) {
            blockStart = i;
            break;
        }
    }
    if (blockStart < 0)
        return '';
    let keyLine = -1;
    for (let i = blockStart + 1; i < Math.min(lines.length, blockStart + 300); i += 1) {
        const line = lines[i] ?? '';
        // 遇到下一层插件条目就停
        if (/^\s*-\s*id:/.test(line))
            break;
        if (/^\s*sessdata:\s*(.*)$/.test(line)) {
            keyLine = i;
            break;
        }
    }
    if (keyLine < 0)
        return '';
    const firstMatch = /^\s*sessdata:\s*(.*)$/.exec(lines[keyLine] ?? '');
    const parts = [firstMatch?.[1] ?? ''];
    // 续行：只要不是"新 key"（形如 `  timeoutMs:`）或"新插件条目"（`- id:`）或空行，就算续行。
    // 不依赖缩进——线上文件缩进不一定是我们预期的 4 空格。
    for (let i = keyLine + 1; i < Math.min(lines.length, keyLine + 200); i += 1) {
        const line = lines[i] ?? '';
        if (line.trim() === '')
            break;
        if (/^\s*-\s*id:/.test(line))
            break;
        if (/^\s*[\w-]+:\s/.test(line))
            break;
        parts.push(line.trim());
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
}
/** 在 DSH_HOME 下的所有 profile 里找 dsh-bili 的 sessdata */
export function readCookieFromProfiles() {
    const homeEnv = process.env.DSH_HOME;
    const bases = [
        homeEnv !== undefined && homeEnv !== '' ? homeEnv : '',
        join(homedir(), '.dsh'),
    ].filter(base => base !== '');
    for (const home of [...new Set(bases)]) {
        const profilesDir = join(home, 'profiles');
        if (!existsSync(profilesDir))
            continue;
        let names = [];
        try {
            names = readdirSync(profilesDir);
        }
        catch {
            continue;
        }
        for (const name of names) {
            const file = join(profilesDir, name, 'cordis.patch.yml');
            if (!existsSync(file))
                continue;
            try {
                const cookie = extractSessdataFromYaml(readFileSync(file, 'utf8'));
                if (cookie.length >= MIN_REAL_COOKIE_LENGTH)
                    return { cookie, file };
            }
            catch {
                // 读不了就换下一个
            }
        }
    }
    return undefined;
}
