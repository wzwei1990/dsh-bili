export interface SearchHit {
    bvid: string;
    aid: number;
    title: string;
    up: string;
    mid: number;
    play: number;
    danmaku: number;
    durationSec: number;
    pubdate: number;
    cover: string;
    url: string;
    description?: string;
}
export interface SearchOptions {
    page?: number;
    /** 排序：totalrank 综合 / click 播放 / pubdate 最新 / dm 弹幕 / stow 收藏 */
    order?: 'totalrank' | 'click' | 'pubdate' | 'dm' | 'stow';
    /** 时长：1=<10min 2=10~30min 3=30~60min 4=>60min（0=不限） */
    duration?: 0 | 1 | 2 | 3 | 4;
}
export interface UserHit {
    mid: number;
    name: string;
    fans: number;
    videos: number;
    sign?: string;
    avatar?: string;
}
export interface UpInfo {
    mid: number;
    name: string;
    fans: number;
    sign?: string;
    avatar?: string;
    level?: number;
}
export interface UpVideo {
    bvid: string;
    title: string;
    pubdate: number;
    durationSec: number;
    play: number;
    url: string;
}
export interface UpDynamic {
    id: string;
    type: string;
    text: string;
    pubdate: number;
    url: string;
    imageCount: number;
}
export interface WbiKeys {
    imgKey: string;
    subKey: string;
}
export interface SearchClientOptions {
    cookie?: string;
    timeoutMs?: number;
    cacheTtlMs?: number;
    /** 取 wbi 密钥（由 BiliClient 提供，避免重复实现 nav/游客 cookie） */
    wbiKeys: () => Promise<WbiKeys | undefined>;
    cacheGet?: <T>(key: string) => T | undefined;
    cacheSet?: (key: string, value: unknown) => void;
    log?: (level: 'debug' | 'info' | 'warn', message: string) => void;
}
/** "12:34" / "1:02:03" → 秒 */
export declare function parseClock(text: string): number;
export declare const SPACE_COOLDOWN_MS: number;
export declare function spaceRiskRemainingMs(now?: number): number;
export declare class SearchClient {
    private readonly options;
    constructor(options: SearchClientOptions);
    private httpOptions;
    private cacheGet;
    private cacheSet;
    private log;
    private signed;
    /** 搜视频 */
    search(keyword: string, options?: SearchOptions): Promise<{
        hits: SearchHit[];
        total: number;
        page: number;
    }>;
    /** 按名字找 UP（订阅时用） */
    searchUser(keyword: string): Promise<UserHit[]>;
    /** UP 基本信息 */
    upInfo(mid: number): Promise<UpInfo>;
    /** UP 的投稿（按发布时间倒序） */
    upVideos(mid: number, page?: number, pageSize?: number): Promise<UpVideo[]>;
    /** UP 的动态（图文/转发都算） */
    upDynamics(mid: number, limit?: number): Promise<UpDynamic[]>;
    /** 名字或 mid → mid（"订阅半佛仙人"用） */
    resolveUp(target: string): Promise<UpInfo>;
}
