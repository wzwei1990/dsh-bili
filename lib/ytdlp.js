/**
 * yt-dlp 桥：只有"非 B 站链接"才需要它（B 站走官方 playurl，不需要下载器）。
 *
 * 探测顺序：配置 → 环境变量 YTDLP_PATH → PATH → 常见路径。
 * 下载策略：只要单文件 mp4（-f bv*+ba/b），限制分辨率（默认 720p 以内）与时长，
 * 避免为了看一眼视频而拉一个 4K 原盘。
 */
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runBinary } from './deps.js';
/** 探测 yt-dlp（独立函数，方便 UI 显示依赖状态） */
export async function resolveYtDlp(configured = '') {
    // 延迟 import，避免循环依赖
    const { resolveBinary } = await import('./deps.js');
    return resolveBinary('yt-dlp', configured, 'YTDLP_PATH');
}
/** 是否为"通用链接"（http/https，非 B 站） */
export function isGenericVideoUrl(input) {
    if (!/^https?:\/\//i.test(input.trim()))
        return false;
    return !/(?:^https?:\/\/)?(?:www\.|m\.)?(?:bilibili\.com|b23\.tv)/i.test(input);
}
/**
 * 下载一个通用链接为单文件视频。
 * 失败时抛错（上层降级成"打不开"）。
 */
export async function downloadWithYtDlp(url, options) {
    const bin = options.bin ?? (await resolveYtDlp())?.path;
    if (bin === undefined || bin === '')
        throw new Error('没有找到 yt-dlp（非 B 站链接需要它）');
    await mkdir(options.dir, { recursive: true });
    const maxHeight = Math.max(144, Math.min(2160, options.maxHeight ?? 720));
    const timeoutMs = options.timeoutMs ?? 180_000;
    const args = [
        '--no-playlist',
        '--no-warnings',
        '--no-progress',
        '-f', 'bv*[height<=' + String(maxHeight) + ']+ba/b[height<=' + String(maxHeight) + ']/b',
        '--merge-output-format', 'mp4',
        '-o', join(options.dir, 'src.%(ext)s'),
        url,
    ];
    if (options.maxDurationSec !== undefined && options.maxDurationSec > 0) {
        args.splice(0, 0, '--match-filter', 'duration<=' + String(Math.round(options.maxDurationSec)));
    }
    await runBinary(bin, args, timeoutMs);
    const files = (await readdir(options.dir)).filter(name => /^src\./.test(name));
    const file = files[0];
    if (file === undefined)
        throw new Error('yt-dlp 没有产出文件');
    return { filePath: join(options.dir, file) };
}
/** 清理下载目录 */
export async function cleanupDownload(dir) {
    try {
        await rm(dir, { recursive: true, force: true });
    }
    catch {
        // 忽略
    }
}
