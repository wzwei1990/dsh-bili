/**
 * 回复监听的"检查"逻辑（2026-11-05）。
 *
 * 抽出成独立函数，让两个消费者共用同一份游标：
 *   - 模型侧工具 bili_reply_check（按需查）
 *   - 渠道侧（napcat）定时查 → 只发管理员私聊
 * 共享游标的意义：谁查过就不会重复报给另一边。
 */
import type { CommentClient, CommentItem } from './comments.js';
import type { ReplyWatch, ReplyWatchStore } from './replywatch.js';
export interface ReplyCheckResult {
    watch: ReplyWatch;
    /** 自上次以来的新增（最多 20 条） */
    items: CommentItem[];
    /** 失败信息（评论被删 / 风控 / 网络） */
    error?: string;
    /** 这次失败是否触发了自动清理 */
    removed?: boolean;
}
export interface ReplyCheckOptions {
    watches: ReplyWatchStore;
    comments: CommentClient;
    log?: (level: 'debug' | 'info' | 'warn', message: string) => void;
    /** 只看这一条监听 */
    only?: string;
}
/** 检查所有（或指定）监听，推进游标，返回增量 */
export declare function checkReplyWatches(options: ReplyCheckOptions): Promise<ReplyCheckResult[]>;
/** 把增量格式化成一段人可读的文本（私聊通知用） */
export declare function formatReplyCheck(results: ReplyCheckResult[], options?: {
    max?: number;
    title?: string;
}): string;
