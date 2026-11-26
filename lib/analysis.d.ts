import type { BiliClient, VideoInfo } from './bili.js';
import type { StoryboardService, StoryboardOutcome } from './services.js';
export interface BiliAnalysis {
    platform: 'bili';
    info: VideoInfo;
    audioPath?: string;
    storyboard?: StoryboardOutcome;
}
export interface BiliAnalysisOptions {
    /** 音频/中间产物根目录（默认 ~/.dsh/dsh-bili/analysis） */
    rootDir?: string;
    ffmpegPath?: string;
    /** 分镜服务（不传就不生成分镜图） */
    storyboard?: StoryboardService;
    log?: (level: 'debug' | 'info' | 'warn', message: string) => void;
}
/**
 * 分析一个 B 站视频：元信息 + 音频 + 分镜。
 * @param input 链接 / BV / av / 包含链接的一段话
 */
export declare function analyzeBili(input: string, client: BiliClient, options?: BiliAnalysisOptions): Promise<BiliAnalysis>;
