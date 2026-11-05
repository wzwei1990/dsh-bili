import { type DanmakuSummary } from './danmaku.js';
/**
 * cookie 规整：用户可能①只填 SESSDATA 的值，也可能②直接粘贴整段 cookie（含 DedeUserID 等，常带换行）。
 * 统一行为：去掉换行/多余空格、补齐分隔符；只填值的情况补上 `SESSDATA=` 前缀。
 */
export declare function normalizeCookie(raw: string): string;
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
    private wbiKeyCache;
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
    /**
     * 拉弹幕并压成"高光时段 + 代表弹幕"。
     * 免登录可用（实测 dm/list.so 返回明文 XML）；有 cookie 时带上即可。
     */
    danmaku(input: string, options?: {
        cid?: number;
    }): Promise<{
        info: VideoInfo;
        summary: DanmakuSummary;
    }>;
    readSubtitle(input: string, options?: {
        maxChars?: number;
        cid?: number;
    }): Promise<SubtitleResult>;
    /**
     * 取可直连的视频流地址（给 ffmpeg 抽帧用）。
     * 优先 DASH（fnval=16），退回 durl；都不行就抛错由上层降级。
     */
    streamUrl(input: string, options?: {
        quality?: number;
    }): Promise<{
        info: VideoInfo;
        url: string;
        /** DASH 的音频流（波形图用；没有就是 undefined） */
        audioUrl?: string;
        headers: Record<string, string>;
        quality: number;
    }>;
    /**
     * 拉流必须带 Referer/UA（B 站防盗链）；有 cookie 一并带上。
     * Referer 用**视频页**而不是首页：CDN 会对比，首页 Referer 偶尔被 403。
     */
    private streamHeaders;
    /** cookie 的形态摘要（排障用：只给长度/段数/是否含关键字，不泄露值） */
    get cookieShape(): string | undefined;
    /**
     * 查登录状态（给设置页/doctor 用）：返回昵称与 mid，未登录时给出原因。
     * 顺带说明：SESSDATA 是登录凭证，时间戳没过期也可能被服务器判定失效。
     */
    loginState(): Promise<{
        configured: boolean;
        isLogin: boolean;
        uname?: string;
        mid?: number;
        level?: number;
        message?: string;
    }>;
    /** 规整后的 cookie 字符串（已压平换行），供搜索等模块复用。 */
    get cookieValue(): string;
    /** 供搜索模块复用的 WBI 密钥（同一套游客 cookie 与缓存）。 */
    wbiKeys(): Promise<{
        imgKey: string;
        subKey: string;
    } | undefined>;
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
