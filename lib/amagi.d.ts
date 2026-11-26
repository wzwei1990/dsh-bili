export interface DouyinWorkMeta {
    id: string;
    title: string;
    uploader: string;
    durationSec: number;
    cover?: string;
    playUrl?: string;
    likes?: number;
    comments?: number;
    description: string;
    webpageUrl: string;
}
export interface AmagiOptions {
    /** 例如 http://amagi:4567 或 http://127.0.0.1:4567 */
    baseUrl: string;
    timeoutMs?: number;
}
interface AmagiResponse {
    success?: boolean;
    message?: string;
    data?: {
        aweme_detail?: {
            aweme_id?: string;
            desc?: string;
            create_time?: number;
            author?: {
                nickname?: string;
            };
            video?: {
                duration?: number;
                ratio?: string;
                play_addr?: {
                    url_list?: string[];
                };
                cover?: {
                    url_list?: string[];
                };
            };
            statistics?: {
                digg_count?: number;
                comment_count?: number;
                share_count?: number;
            };
        };
    };
}
/** 从 amagi 响应里抽统一的元数据（纯函数，可单测） */
export declare function parseAmagiWork(json: AmagiResponse, fallbackUrl: string): DouyinWorkMeta | undefined;
export declare function amagiDouyinUrl(baseUrl: string, awemeId: string): string;
/** 从任意抖音链接/分享文案里取作品 id */
export declare function douyinIdOf(input: string): string | undefined;
/** 调 amagi 拿作品详情（标题/作者/时长/直链） */
export declare function fetchDouyinWork(input: string, options: AmagiOptions): Promise<DouyinWorkMeta>;
/** 把 amagi 返回的直链下载到本地（免 cookie，带抖音 Referer） */
export declare function downloadDouyinPlayUrl(url: string, filePath: string): Promise<void>;
export {};
