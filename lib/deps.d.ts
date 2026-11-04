export interface BinaryResult {
    path: string;
    version?: string;
    source: 'config' | 'env' | 'path' | 'known-location';
}
/** 跑一次 `<bin> -version`，拿到就说明可用。 */
export declare function probeBinary(bin: string, args?: string[]): Promise<string | undefined>;
/**
 * 解析一个外部可执行文件的位置。
 * @param name 基础名（如 ffmpeg）
 * @param configured 配置里写死的路径（可为空）
 * @param envVar 环境变量名（如 FFMPEG_PATH）
 */
export declare function resolveBinary(name: string, configured?: string, envVar?: string): Promise<BinaryResult | undefined>;
export interface StoryboardDeps {
    ffmpeg?: BinaryResult;
    ffprobe?: BinaryResult;
}
export declare function resolveStoryboardDeps(options?: {
    ffmpegPath?: string;
}): Promise<StoryboardDeps>;
/** 跑一条 ffmpeg/ffprobe 命令，返回 stdout（失败抛错带 stderr 尾巴）。 */
export declare function runBinary(bin: string, args: string[], timeoutMs?: number): Promise<string>;
