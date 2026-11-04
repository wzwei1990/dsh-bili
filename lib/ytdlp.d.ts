import { type BinaryResult } from './deps.js';
export interface YtDlpOptions {
    /** yt-dlp 可执行文件路径（空 = 自动探测） */
    bin?: string;
    /** 最高分辨率（默认 720） */
    maxHeight?: number;
    /** 最大时长秒数（超过直接拒绝，防止拉长片） */
    maxDurationSec?: number;
    /** 下载目录 */
    dir: string;
    /** 超时（毫秒） */
    timeoutMs?: number;
}
export interface YtDlpResult {
    filePath: string;
    title?: string;
    durationSec?: number;
}
/**
 * 探测 yt-dlp。找不到独立可执行文件时，再试 `python -m yt_dlp`（conda/pip 装的常见情况）。
 * 返回的 path 可能是 "python"，调用方用 ytdlpArgs() 拼参数即可。
 */
export declare function resolveYtDlp(configured?: string): Promise<BinaryResult | undefined>;
/** yt-dlp 的调用参数：独立可执行文件直接跑；python 兜底要加 `-m yt_dlp` */
export declare function ytdlpArgs(bin: string, args: string[]): string[];
/** 是否为"通用链接"（http/https，非 B 站） */
export declare function isGenericVideoUrl(input: string): boolean;
/**
 * 下载一个通用链接为单文件视频。
 * 失败时抛错（上层降级成"打不开"）。
 */
export declare function downloadWithYtDlp(url: string, options: YtDlpOptions): Promise<YtDlpResult>;
/** 清理下载目录 */
export declare function cleanupDownload(dir: string): Promise<void>;
