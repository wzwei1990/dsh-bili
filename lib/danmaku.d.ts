export interface DanmakuItem {
    /** 出现时间（秒） */
    at: number;
    text: string;
    /** 弹幕模式：1~3 滚动，4 底部，5 顶部 */
    mode: number;
}
export interface DanmakuPeak {
    startSec: number;
    endSec: number;
    count: number;
    samples: string[];
}
export interface DanmakuSummary {
    total: number;
    /** 每秒弹幕数，用于判断"热闹程度" */
    density: number;
    peaks: DanmakuPeak[];
    /** 采样到的代表性弹幕（去重、去纯符号） */
    samples: string[];
}
/** 解析 dm/list.so 的 XML；坏数据直接跳过，不抛错。 */
export declare function parseDanmakuXml(xml: string): DanmakuItem[];
export declare function isUsefulDanmaku(text: string): boolean;
/**
 * 把弹幕压成"高光时刻 + 代表弹幕"。
 * @param bucketSec 分桶粒度（默认 30 秒）
 * @param peakCount 取几个高光桶
 */
export declare function summarizeDanmaku(items: readonly DanmakuItem[], durationSec: number, options?: {
    bucketSec?: number;
    peakCount?: number;
    samplePerPeak?: number;
}): DanmakuSummary;
/** 选样本：去掉噪声、去重，优先"重复出现"的梗（次数降序） */
export declare function pickSamples(items: readonly DanmakuItem[], limit: number): string[];
export declare function clockOf(seconds: number): string;
/** 给模型看的紧凑文本（不做判断，只给事实与样本） */
export declare function danmakuText(summary: DanmakuSummary, durationSec: number, url: string): string;
/** 拉弹幕 XML（调用方给 cid） */
export declare function fetchDanmakuXml(cid: number, options?: {
    cookie?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
}): Promise<string>;
