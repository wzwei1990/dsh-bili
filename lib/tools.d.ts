/**
 * 模型侧工具：bili_read（一次拿全「视频信息 + 字幕」）、bili_subtitle、bili_card。
 *
 * 设计：工具只负责"取到内容"，总结交给模型 —— 这样模型能按群聊语气自由发挥。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { BiliClient, VideoInfo } from './bili.js';
import type { StoryboardService } from './services.js';
import type { SearchClient } from './search.js';
import type { CommentClient } from './comments.js';
import type { ReplyWatchStore } from './replywatch.js';
export interface ToolDeps {
    subtitleMaxChars: number;
    storyboard: StoryboardService;
    search: SearchClient;
    /** 评论/互动（读写） */
    comments: CommentClient;
    /** 回复监听登记表 */
    watches: ReplyWatchStore;
    /** 最多登记几条监听 */
    replyWatchMax: number;
    /** 发完评论是否自动盯它 */
    autoWatchOwnComments: boolean;
    /** cookie 来源诊断（来源路径 + 原始/规整后长度） */
    cookieInfo?: () => {
        source: string;
        length: number;
        normalized: number;
    };
    log: (level: 'debug' | 'info' | 'warn', message: string) => void;
}
/** 把视频信息 + 字幕拼成给模型读的文本。 */
export declare function digestOf(info: VideoInfo, subtitle: string, truncated: boolean): string;
export declare function registerTools(ctx: Context, client: BiliClient, deps: ToolDeps): void;
