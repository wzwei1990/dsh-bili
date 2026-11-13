export interface CommentAuthor {
    mid: number;
    name: string;
    level: number;
}
export interface CommentItem {
    rpid: number;
    /** 根评论 id（一级评论 = rpid） */
    root: number;
    parent: number;
    author: CommentAuthor;
    message: string;
    like: number;
    replyCount: number;
    ctime: number;
    isUp: boolean;
}
export interface CommentPage {
    items: CommentItem[];
    /** 下一页游标（0 = 结束） */
    cursor: number;
    end: boolean;
    total: number;
}
export interface VideoRef {
    bvid: string;
    aid: number;
    cid: number;
    title: string;
}
export interface WritePolicy {
    /** 是否允许写操作 */
    enabled: boolean;
    /** 每小时最多几次写 */
    perHour: number;
    /** 命中风控后的冷却分钟 */
    cooldownMinutes: number;
}
export interface CommentClientOptions {
    cookie: string;
    timeoutMs: number;
    wbiKeys: () => Promise<{
        imgKey: string;
        subKey: string;
    } | undefined>;
    /** 目标 → 视频元信息（aid/cid/bvid） */
    resolve: (target: string) => Promise<VideoRef>;
    write: WritePolicy;
    /** 审计文件（不传则不记） */
    auditFile?: string;
    /** 读缓存（可选；命中风控时能少打接口） */
    cacheGet?: <T>(key: string) => T | undefined;
    cacheSet?: (key: string, value: unknown) => void;
    log: (level: 'debug' | 'info' | 'warn', message: string) => void;
}
export interface ReadOptions {
    /** 排序：0=按时间 1=按点赞 2=按回复 */
    sort?: 0 | 1 | 2;
    /** 页码（从 1 开始） */
    page?: number;
    /** 每页条数（1~20） */
    pageSize?: number;
}
export declare class CommentClient {
    /** 运行时替换 cookie（设置页保存后热更新用）。 */
    setCookie(raw: string): void;
    private readonly options;
    private readonly writes;
    private cooldownUntil;
    constructor(options: CommentClientOptions);
    /** 从 cookie 里取 CSRF token */
    csrf(): string;
    /** 写操作是否可用（给 doctor/工具提示用） */
    writeStatus(): {
        enabled: boolean;
        csrf: boolean;
        cooldownMs: number;
        usedLastHour: number;
    };
    private recentWrites;
    /** 写操作前的统一门禁 */
    private guard;
    private audit;
    /** 命中风控 → 进冷却 */
    private markRisk;
    private headers;
    private signedUrl;
    /** 读一级评论 */
    read(target: string, options?: ReadOptions): Promise<CommentPage & {
        video: VideoRef;
    }>;
    /**
     * 读一条根评论下的子评论。
     * `fromEnd = true` 时先取总数再跳最后一页（回复很多的热评，最新回复在最后一页）。
     */
    readReplies(target: string, root: number, page?: number, options?: {
        fromEnd?: boolean;
    }): Promise<{
        items: CommentItem[];
        end: boolean;
    }>;
    private readRepliesPage;
    /** 发评论 / 回复（root 传了就回复那条评论） */
    post(target: string, message: string, options?: {
        root?: number;
        parent?: number;
    }): Promise<{
        rpid: number;
        video: VideoRef;
    }>;
    /** 点赞 / 取消点赞 */
    like(target: string, on?: boolean): Promise<{
        video: VideoRef;
        on: boolean;
    }>;
    /** 投币（count 1~2） */
    coin(target: string, count?: number, alsoLike?: boolean): Promise<{
        video: VideoRef;
        count: number;
    }>;
    /** 发弹幕 */
    sendDanmaku(target: string, text: string, options?: {
        progressSec?: number;
        mode?: number;
    }): Promise<{
        video: VideoRef;
        progress: number;
    }>;
    private toComment;
    private getJson;
    private postForm;
}
