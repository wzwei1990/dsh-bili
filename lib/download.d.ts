export interface ParallelDownloadOptions {
    /** 并发段数（默认 4） */
    concurrency?: number;
    /** 每段超时（毫秒，默认 15000） */
    timeoutMs?: number;
    /** 小于这个体积就单连接下载（默认 4MB） */
    minParallelBytes?: number;
    /** 整体截止时间（ms 时间戳）；超过就不再发起新请求 */
    deadlineAt?: number;
}
/** 分段并行下载；失败自动回退单连接 */
export declare function downloadParallel(url: string, headers: Record<string, string>, filePath: string, options?: ParallelDownloadOptions): Promise<number>;
