/**
 * 设置页保存后"立即"把 cookie 同步进 cookie.txt（2026-11-13）。
 *
 * 背景：原来只在插件初始化（apply）时同步一次。用户在设置页改 SESSDATA 后，
 * 宿主只写 profile 的 cordis.patch.yml，并不会重跑 apply —— 于是 cookie.txt
 * 还是旧值，bili_doctor 报"未登录"，用户以为保存失败。
 *
 * 做法：低频轮询 profile 配置文件（默认 5s），只在 mtime/size 变化时才解析，
 * 发现值变了就写进 cookie 文件。开销只有一次 stat，不读文件内容。
 */
import { statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { readCookieFromProfiles, MIN_REAL_COOKIE_LENGTH } from './profilecookie.js';
/** profile 配置文件的 mtime+size 指纹（找不到就返回空表） */
function stampOf(profileFiles) {
    const out = [];
    for (const file of profileFiles) {
        try {
            const st = statSync(file);
            out.push({ file, mtimeMs: st.mtimeMs, size: st.size });
        }
        catch {
            // 文件不存在（profile 没这个插件）就跳过
        }
    }
    return out;
}
function sameStamps(a, b) {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i += 1) {
        const x = a[i];
        const y = b[i];
        if (x.file !== y.file || x.mtimeMs !== y.mtimeMs || x.size !== y.size)
            return false;
    }
    return true;
}
/**
 * 启动监听，返回停止函数（挂到 ctx.effect 的 disposer）。
 * 首次调用只记录指纹，不会重复写文件；之后只有真正变化才同步。
 */
export function watchProfileCookie(options) {
    const { cookieFile, log } = options;
    const intervalMs = Math.max(1000, options.intervalMs ?? 5000);
    let stamps = [];
    let lastWritten = '';
    const currentFiles = () => {
        const probe = readCookieFromProfiles();
        return probe === undefined ? [] : [probe.file];
    };
    // 初始指纹：包含所有可能存在的 profile 文件
    const known = [
        ...currentFiles(),
        ...['web', 'desktop'].map(p => `${process.env.HOME ?? ''}/.dsh/profiles/${p}/cordis.patch.yml`.replace(/^\/?/, '')),
    ].filter(f => f !== '');
    stamps = stampOf(known);
    const timer = setInterval(() => {
        try {
            // 目录里可能新增 profile 文件，所以每轮重新枚举一次（stat 成本极低）
            const files = Array.from(new Set([...known, ...currentFiles()]));
            const next = stampOf(files);
            if (sameStamps(stamps, next))
                return;
            stamps = next;
            const probe = readCookieFromProfiles();
            if (probe === undefined)
                return;
            const cookie = probe.cookie.trim();
            if (cookie.length < MIN_REAL_COOKIE_LENGTH || cookie === lastWritten)
                return;
            try {
                mkdirSync(dirname(cookieFile), { recursive: true });
                writeFileSync(cookieFile, cookie + '\n', 'utf8');
                lastWritten = cookie;
                log('info', '设置页 cookie 已变化 → 已同步到 ' + cookieFile + '（长度 ' + String(cookie.length) + '）');
            }
            catch (error) {
                log('warn', '同步 cookie 文件失败: ' + (error instanceof Error ? error.message : String(error)));
            }
        }
        catch {
            // 轮询失败不该影响插件主干
        }
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
}
