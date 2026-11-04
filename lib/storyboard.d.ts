import { type StoryboardDeps } from './deps.js';
export interface StoryboardOptions {
    /** 视频流地址（已包含签名） */
    streamUrl: string;
    /** 音频流（DASH 单独一条；有就画响度波形） */
    audioUrl?: string;
    /** 请求流时要带的头（B 站需要 Referer/UA） */
    headers?: Record<string, string>;
    /** 抽几帧（默认 9；建议 4/9/16） */
    frames?: number;
    /** 每格宽度（默认 480） */
    cellWidth?: number;
    /** 输出目录（缺省用系统临时目录） */
    workDir?: string;
    /** ffmpeg / ffprobe 位置 */
    deps: StoryboardDeps;
    /** 可选：字体文件（有就给每格加时间戳；没有就跳过） */
    fontFile?: string;
    timeoutMs?: number;
}
export interface StoryboardResult {
    /** 拼好的分镜图（绝对路径） */
    imagePath: string;
    /** 时间轴：第几格对应第几秒 */
    timeline: Array<{
        index: number;
        atSec: number;
        label: string;
    }>;
    durationSec: number;
    width: number;
    height: number;
    /** 是否有波形条 */
    withWaveform: boolean;
    /** 是否烧了时间戳文字 */
    numbered: boolean;
}
export declare function clockOf(seconds: number): string;
/** 均匀取点：跳过片头 5% 与片尾 5%，每段取中点（不是分段首帧，首帧常是转场黑帧）。 */
export declare function pickTimestamps(durationSec: number, frames: number): number[];
/** 猜一个可用字体（有就用，没有就跳过标注）：Windows 中文/西文，Linux 常见路径。 */
export declare function findStoryboardFont(): string | undefined;
export declare function guessFont(): string | undefined;
export declare function buildStoryboard(options: StoryboardOptions): Promise<StoryboardResult>;
/** 清理临时目录（尽力而为） */
export declare function cleanupStoryboard(dir: string): Promise<void>;
