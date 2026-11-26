import type { BiliClient, VideoInfo } from './bili.js';
export interface StoryboardServiceOptions {
    client: BiliClient;
    /** 是否启用抽帧 */
    enabled: boolean;
    frames: number;
    /** 超过这个分钟数就跳过（0=不限） */
    maxMinutes: number;
    ffmpegPath: string;
    ytdlpPath: string;
    /** 产物根目录（缺省 ~/.dsh/dsh-bili/storyboards） */
    outputRoot?: string;
    log: (level: 'debug' | 'info' | 'warn', message: string) => void;
}
export interface StoryboardOutcome {
    imagePath: string;
    title: string;
    durationSec: number;
    width: number;
    height: number;
    timeline: Array<{
        index: number;
        atSec: number;
        label: string;
    }>;
    withWaveform: boolean;
    /** 数据来源：bili=官方流 / ytdlp=下载 / file=本地文件 */
    source: 'bili' | 'ytdlp' | 'file';
}
/** 依赖状态（设置页/doctor 用） */
export interface DepsStatus {
    ffmpeg?: string;
    ffprobe?: string;
    ytdlp?: string;
    font?: string;
}
export declare class StoryboardService {
    private readonly options;
    private cachedDeps;
    private cachedYtDlp;
    private ytdlpProbed;
    constructor(options: StoryboardServiceOptions);
    private outputRoot;
    depsStatus(): Promise<DepsStatus>;
    private ensureDeps;
    private ensureYtDlp;
    /**
     * 生成分镜。失败抛错，由调用方决定是否降级。
     * @param input B 站链接 / 通用链接 / 本地路径
     */
    build(input: string): Promise<StoryboardOutcome>;
    /** 对本地视频文件生成分镜（amagi 兜底下载后使用） */
    buildFromLocalFile(filePath: string): Promise<StoryboardOutcome>;
    private buildFromFile;
    /** 把底层错误翻译成用户能行动的提示 */
    private explain;
    private assertDuration;
    /** 把临时目录里的成品图挪到稳定目录（work dir 会被随机命名） */
    /**
     * 用**已经取到的** B 站直连流生成分镜。
     * analyzeBili 先 streamUrl 抽音频，再调这里复用同一个流；否则二次 playurl 会拿到 403 的地址。
     */
    buildFromBiliStream(input: {
        info: VideoInfo;
        url: string;
        audioUrl?: string;
        candidates?: string[];
        audioCandidates?: string[];
        headers: Record<string, string>;
    }): Promise<StoryboardOutcome>;
    private persist;
}
