export interface VideoInfo {
    bvid: string;
    aid: number;
    cid: number;
    title: string;
    up: string;
    durationSec: number;
    cover: string;
    desc: string;
    pageUrl: string;
    publishedAt: number;
    stats: {
        view: number;
        danmaku: number;
        like: number;
        coin: number;
        favorite: number;
    };
    pages: Array<{
        cid: number;
        page: number;
        part: string;
        durationSec: number;
    }>;
}
export interface SubtitleTrack {
    lang: string;
    label: string;
    url: string;
    ai: boolean;
}
export interface SubtitleResult {
    bvid: string;
    lang: string;
    label: string;
    text: string;
    cueCount: number;
    truncated: boolean;
}
export interface CardInfo {
    bvid: string;
    title: string;
    up: string;
    durationSec: number;
    cover: string;
    pageUrl: string;
    desc: string;
}
export interface BiliClientOptions {
    cookie?: string;
    timeoutMs?: number;
    cacheTtlMs?: number;
    log?: (level: 'debug' | 'info' | 'warn', message: string) => void;
    /** 缓存目录（默认 <home>/.dsh/dsh-bili/cache） */
    cacheDir?: string;
}
/** 从任意文本里抠出 BV 号 / av 号 / b23 短链。 */
export declare function extractTarget(input: string): {
    kind: 'bvid' | 'aid' | 'short' | 'none';
    value: string;
};
/** 把字幕 cue 列表合并成段落文本（每段约 30 秒或 80 字，便于模型阅读）。 */
export declare function mergeCues(cues: ReadonlyArray<{
    from: number;
    content: string;
}>): string;
export declare class BiliClient {
    private cookie;
    private buvidReady;
    private readonly timeoutMs;
    private readonly cacheTtlMs;
    private readonly cacheDir;
    private readonly log;
    private readonly memory;
    private wbiKeys;
    constructor(options?: BiliClientOptions);
    private httpOptions;
    /** 解链接 → 统一成 bvid（b23 短链会先跟随跳转）。 */
    normalize(input: string): Promise<{
        bvid?: string;
        aid?: number;
    }>;
    /** 视频元信息（缓存按 bvid）。 */
    resolve(input: string): Promise<VideoInfo>;
    /** 卡片信息（发给群里的"分享"用）。 */
    card(input: string): Promise<CardInfo>;
    /** 字幕轨列表（可能为空：UP 没传字幕 / 需要登录）。 */
    subtitleTracks(input: string, cid?: number): Promise<{
        info: VideoInfo;
        tracks: SubtitleTrack[];
    }>;
    /** 字幕正文：优先中文（含 AI 字幕），没有就返回空并说明。 */
    readSubtitle(input: string, options?: {
        maxChars?: number;
        cid?: number;
    }): Promise<SubtitleResult>;
    /** WBI 密钥对（缓存 2 小时；nav 接口未登录也返回密钥）。 */
    /**
     * 拿 WBI 密钥。未登录时 nav 会返回 -101，所以先补一个游客 cookie（buvid3）再试；
     * 仍然拿不到就返回 undefined —— 上层退回不需要签名的老接口 `/x/player/v2`。
     */
    private ensureWbiKeys;
    /** 没有 cookie 时补一个游客 buvid3，否则 nav 接口必然 -101。 */
    private ensureVisitorCookie;
    private cacheGet;
    private cacheSet;
}
/** 截断超长字幕（保留头部，标注截断）。 */
export declare function trimTo(result: SubtitleResult, maxChars: number): SubtitleResult;
