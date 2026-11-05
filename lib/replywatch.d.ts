export interface ReplyWatch {
    /** 监听 id（稳定，用于取消） */
    id: string;
    /** 视频（BV 号）：每次检查都要用它重新解析 aid */
    bvid: string;
    /** 根评论 rpid（0 = 监听整个视频的新评论） */
    root: number;
    /** 已见到的最大 rpid（用于判断增量） */
    lastSeenRpid: number;
    /** 备注（谁让盯的、为什么） */
    note: string;
    createdAt: number;
    lastCheckAt: number;
    /** 到期时间戳（0 = 永不过期） */
    expiresAt: number;
    /** 连续检查失败次数（评论被删等），达到阈值自动清理 */
    failures: number;
}
export interface ReplyWatchStoreOptions {
    file: string;
    /** 登记后保留多少天（0 = 永不过期） */
    keepDays?: number;
    /** 连续失败几次自动清理 */
    maxFailures?: number;
    log?: (level: 'debug' | 'info' | 'warn', message: string) => void;
}
export declare class ReplyWatchStore {
    private readonly options;
    private items;
    private loaded;
    constructor(options: ReplyWatchStoreOptions);
    private load;
    private save;
    list(): ReplyWatch[];
    find(id: string): ReplyWatch | undefined;
    /** 同一个 (bvid, root) 已存在时直接返回旧的，不重复登记 */
    add(input: {
        bvid: string;
        root: number;
        lastSeenRpid?: number;
        note?: string;
        max: number;
    }): {
        watch: ReplyWatch;
        created: boolean;
    };
    remove(id: string): boolean;
    touch(id: string, lastSeenRpid: number): void;
    /** 记一次检查失败；连续失败到阈值就自动清掉（评论被删/视频删档） */
    markFailure(id: string): {
        removed: boolean;
        failures: number;
    };
    /** 清理过期监听；返回被清掉的 id */
    prune(now?: number): string[];
}
