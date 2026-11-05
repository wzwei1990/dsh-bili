/**
 * 配置面：全部 volatile（改设置不重载插件），与 dsh-napcat 的做法一致。
 */
import z from '@deepseek-ai/schemastery';
export interface ConfigShape {
    /** B 站登录 Cookie 里的 SESSDATA（可选：字幕/更高频接口需要，公开视频信息不需要） */
    sessdata: string;
    /** 单次 HTTP 超时（毫秒） */
    timeoutMs: number;
    /** 字幕正文最多返回多少字符（太长会撑爆上下文，超出截断并在文本里标注） */
    /** 搜索/UP 结果缓存（分钟） */
    searchCacheMinutes: number;
    /** 订阅轮询总开关 */
    /** 轮询间隔（分钟，最小 5） */
    /** 订阅数量上限 */
    /** 默认订阅类型（逗号分隔：video,dynamic） */
    subtitleMaxChars: number;
    /** 是否抽帧做分镜图（默认开；超长视频会跳过） */
    storyboard: boolean;
    /** 分镜帧数（4/9/16） */
    storyboardFrames: number;
    /** 超过这个时长就不抽帧（分钟，0=不限） */
    maxStoryboardMinutes: number;
    /** ffmpeg 路径（空=自动探测） */
    ffmpegPath: string;
    /** yt-dlp 路径（空=自动探测；只用于非 B 站链接） */
    ytdlpPath: string;
    /** 视频信息/字幕缓存有效期（分钟，0=不缓存） */
    cacheTtlMinutes: number;
    /** 日志级别 */
    logLevel: 'debug' | 'info' | 'warn';
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    sessdata: z<string, string, "volatile-defined">;
    timeoutMs: z<number, number, "volatile-defined">;
    storyboard: z<boolean, boolean, "volatile-defined">;
    storyboardFrames: z<number, number, "volatile-defined">;
    maxStoryboardMinutes: z<number, number, "volatile-defined">;
    ffmpegPath: z<string, string, "volatile-defined">;
    ytdlpPath: z<string, string, "volatile-defined">;
    searchCacheMinutes: z<number, number, "volatile-defined">;
    subtitleMaxChars: z<number, number, "volatile-defined">;
    cacheTtlMinutes: z<number, number, "volatile-defined">;
    logLevel: z<"debug" | "info" | "warn", "debug" | "info" | "warn", "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    sessdata: z<string, string, "volatile-defined">;
    timeoutMs: z<number, number, "volatile-defined">;
    storyboard: z<boolean, boolean, "volatile-defined">;
    storyboardFrames: z<number, number, "volatile-defined">;
    maxStoryboardMinutes: z<number, number, "volatile-defined">;
    ffmpegPath: z<string, string, "volatile-defined">;
    ytdlpPath: z<string, string, "volatile-defined">;
    searchCacheMinutes: z<number, number, "volatile-defined">;
    subtitleMaxChars: z<number, number, "volatile-defined">;
    cacheTtlMinutes: z<number, number, "volatile-defined">;
    logLevel: z<"debug" | "info" | "warn", "debug" | "info" | "warn", "volatile-defined">;
}>>, "plain">;
export declare const DEFAULTS: ConfigShape;
/** volatile 字段可能没有默认值，统一内置默认补一遍。 */
export declare function resolveConfig(input: Partial<ConfigShape> | undefined): ConfigShape;
