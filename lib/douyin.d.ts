import type { StoryboardService, StoryboardOutcome } from './services.js';
export declare function isDouyinUrl(input: string): boolean;
/** 从一段话里抠出第一个抖音链接（消息里常带口令/表情） */
export declare function extractDouyinUrl(text: string): string | undefined;
/** 从链接里取作品 id（/video/123、/note/123、?modal_id=123） */
export declare function pickAwemeId(url: string): string | undefined;
export interface DouyinMeta {
    id?: string;
    title: string;
    uploader: string;
    durationSec: number;
    width?: number;
    height?: number;
    fps?: number;
    thumbnail?: string;
    webpageUrl: string;
    ext?: string;
}
export interface DouyinOptions {
    /** 下载分辨率上限（默认 720） */
    maxHeight?: number;
    /** 最大时长秒数（默认 600） */
    maxDurationSec?: number;
    /** 缓存根目录（默认 ~/.dsh/dsh-bili/douyin） */
    rootDir?: string;
    /** ffmpeg 路径（空=自动探测） */
    ffmpegPath?: string;
    /** yt-dlp 路径（空=自动探测） */
    ytdlpPath?: string;
    /** Netscape cookies.txt（yt-dlp 路径用；amagi 路径不需要） */
    cookiesFile?: string;
    /** amagi 服务地址（如 http://amagi:4567）；配了就优先走它 */
    amagiBaseUrl?: string;
    /** 分镜服务（不传就不生成分镜图） */
    storyboard?: StoryboardService;
    log?: (level: 'debug' | 'info' | 'warn', message: string) => void;
}
export interface DouyinAnalysis {
    meta: DouyinMeta;
    videoPath: string;
    audioPath?: string;
    storyboard?: StoryboardOutcome;
}
export interface DouyinQuickMeta {
    title: string;
    uploader?: string;
    description?: string;
    likes?: string;
    publishedAt?: string;
    url: string;
}
/** 展开 v.douyin.com 短链；失败时返回原链接 */
export declare function resolveDouyinShortUrl(url: string): Promise<string>;
/**
 * 从抖音网页 HTML 里解析标题/描述/作者/点赞。
 * 不登录也能拿到 `<meta name="description">`（实测 2026-11-26）。
 */
export declare function parseDouyinHtml(html: string, url: string): DouyinQuickMeta | undefined;
/** 只读网页元数据（快，不下载、不需要 cookies） */
export declare function probeDouyinQuick(input: string): Promise<DouyinQuickMeta>;
/** yt-dlp -J 拿元数据（不下载） */
export declare function probeDouyin(url: string, options?: DouyinOptions): Promise<DouyinMeta>;
/**
 * 解析一个抖音链接：元数据 + 下载 + 音频 + 分镜。
 * @param input 分享链接或含链接的一段话
 */
export declare function buildDouyinAnalysis(input: string, options?: DouyinOptions): Promise<DouyinAnalysis>;
