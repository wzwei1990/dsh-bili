/**
 * 模型侧工具：bili_read（一次拿全「视频信息 + 字幕」）、bili_subtitle、bili_card。
 *
 * 设计：工具只负责"取到内容"，总结交给模型 —— 这样模型能按群聊语气自由发挥。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { BiliClient, VideoInfo } from './bili.js';
import type { StoryboardService } from './services.js';
export interface ToolDeps {
    subtitleMaxChars: number;
    storyboard: StoryboardService;
    log: (level: 'debug' | 'info' | 'warn', message: string) => void;
}
/** 把视频信息 + 字幕拼成给模型读的文本。 */
export declare function digestOf(info: VideoInfo, subtitle: string, truncated: boolean): string;
export declare function registerTools(ctx: Context, client: BiliClient, deps: ToolDeps): void;
