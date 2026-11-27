import type { BiliClient, VideoInfo } from './bili.js';
import type { StoryboardService, StoryboardOutcome } from './services.js';
export interface BiliAnalysis {
    platform: 'bili';
    info: VideoInfo;
    audioPath?: string;
    storyboard?: StoryboardOutcome;
    /** 分镜失败原因（给工具输出用，避免静默） */
    storyboardError?: string;
}
export interface BiliAnalysisOptions {
    /** 音频/中间产物根目录（默认 ~/.dsh/dsh-bili/analysis） */
    rootDir?: string;
    ffmpegPath?: string;
    /** amagi 服务地址（B 站 CDN 被风控时的兜底流） */
    amagiBaseUrl?: string;
    /** amagi 用的 B 站 cookie（随请求下发） */
    amagiBilibiliCookies?: string;
    /** 分镜服务（不传就不生成分镜图） */
    storyboard?: StoryboardService;
    log?: (level: 'debug' | 'info' | 'warn', message: string) => void;
}
/**
 * 分析一个 B 站视频：元信息 + 音频 + 分镜。
 * @param input 链接 / BV / av / 包含链接的一段话
 */
export declare function analyzeBili(input: string, client: BiliClient, options?: BiliAnalysisOptions): Promise<BiliAnalysis>;
