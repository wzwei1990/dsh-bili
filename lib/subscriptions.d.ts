import type { SearchClient, UpDynamic, UpVideo } from './search.js';
export type SubscriptionType = 'video' | 'dynamic';
export interface Subscription {
    id: string;
    mid: number;
    name: string;
    types: SubscriptionType[];
    /** 推送目标（例如 group:660610917）；空数组表示只进 outbox，不主动推送 */
    groups: string[];
    lastSeenPubdate: number;
    recentIds: string[];
    failures: number;
    /** 下次检查时间（ms） */
    nextCheckAt: number;
    enabled: boolean;
    createdAt: number;
}
export interface OutboxItem {
    id: string;
    kind: SubscriptionType;
    mid: number;
    upName: string;
    title: string;
    url: string;
    pubdate: number;
    addedAt: number;
    /** 该条要推给哪些目标（继承订阅的 groups；空数组=只进 outbox） */
    groups: string[];
    /** 已投递到的消费方（比如 napcat:group:660610917） */
    deliveredTo: string[];
    /** 摘要（动态正文/视频时长等） */
    extra?: string;
}
export interface SubscriptionStoreOptions {
    /** 数据目录，缺省 ~/.dsh/dsh-bili */
    dir?: string;
    log?: (level: 'debug' | 'info' | 'warn', message: string) => void;
}
export declare class SubscriptionStore {
    private readonly options;
    private readonly subsFile;
    private readonly outboxFile;
    private loaded;
    private subs;
    private outbox;
    constructor(options?: SubscriptionStoreOptions);
    private log;
    /** 读盘（幂等） */
    load(): Promise<void>;
    private save;
    list(): Subscription[];
    find(id: string): Subscription | undefined;
    findByMid(mid: number): Subscription | undefined;
    maxOf(limit: number): boolean;
    /** 新增或更新（同 mid 视为同一个 UP，合并类型与群） */
    upsert(input: {
        mid: number;
        name: string;
        types?: SubscriptionType[];
        groups?: string[];
        lastSeenPubdate?: number;
        now?: number;
    }): Promise<{
        subscription: Subscription;
        created: boolean;
    }>;
    remove(identifier: {
        mid?: number;
        id?: string;
        group?: string;
    }): Promise<number>;
    update(subscription: Subscription): Promise<void>;
    /** 待检查的订阅（按 nextCheckAt 升序） */
    due(now?: number, limit?: number): Subscription[];
    /**
     * 待推送。
     * @param consumer 已投递给谁（如 napcat:group:660610917），已投递的跳过
     * @param limit 最多返回多少条
     * @param target 只取"目标里包含这个 target"的条目（如 group:660610917）
     */
    pending(consumer?: string, limit?: number, target?: string): OutboxItem[];
    /** 标记已投递（不清除，保留历史；超过上限时裁剪） */
    ack(ids: readonly string[], consumer: string, keep?: number): Promise<void>;
    /** 追加一批新内容到 outbox（同一 id 不重复） */
    push(items: readonly Omit<OutboxItem, 'deliveredTo' | 'addedAt'>[]): Promise<number>;
}
export interface PollerOptions {
    store: SubscriptionStore;
    search: SearchClient;
    intervalMinutes: number;
    /** 单个订阅失败后的退避（分钟），按失败次数递增 */
    backoffMinutes?: number[];
    log?: (level: 'debug' | 'info' | 'warn', message: string) => void;
}
export interface PollResult {
    subscription: Subscription;
    videos: UpVideo[];
    dynamics: UpDynamic[];
    added: number;
    error?: string;
}
/** 检查一个订阅：拉投稿/动态 → 与 lastSeen 比较 → 写 outbox */
export declare function pollSubscription(subscription: Subscription, options: PollerOptions): Promise<PollResult>;
