/**
 * B 站 CDN 候选排序与探测（参考 karin-plugin-kkk #373，2026-11-19）。
 *
 * 背景：DASH 返回的 baseUrl 经常落在 PCDN 线路上（不稳定/易 403），
 * backup_url 里通常有官方 CDN。先排序、再用 32KB Range 探测，能显著减少
 * ffmpeg 直接上去 403/超时的情况。
 */
/** 去重 + 官方 CDN 优先、PCDN 最后（稳定排序，同分保持原顺序） */
export declare function rankBiliCandidates(urls: readonly string[]): string[];
/** 32KB Range 探测（3 秒）；返回 true 表示这条线路当前可用 */
export declare function probeBiliCandidate(url: string, headers: Record<string, string>, timeoutMs?: number): Promise<boolean>;
/**
 * 排序 + 探测，并告诉调用方是否有可用线路（false 时可直接走 amagi 兜底）。
 */
export declare function probeBiliCandidates(urls: readonly string[], headers: Record<string, string>, options?: {
    probeLimit?: number;
    timeoutMs?: number;
}): Promise<{
    ordered: string[];
    working: boolean;
}>;
/**
 * 排序后探测前 N 条，命中的提前；全部探测失败就按排序原样返回（交给上层再试）。
 */
export declare function pickBiliCandidates(urls: readonly string[], headers: Record<string, string>, options?: {
    probeLimit?: number;
    timeoutMs?: number;
}): Promise<string[]>;
