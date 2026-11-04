/**
 * B 站弹幕：免登录、明文 XML、一条视频通常几百到上千条。
 *
 * 为什么值得做（2026-11-04 与用户确认）：
 *   群里发视频链接，真正有价值的是"机器人看过了、能接话"，
 *   而弹幕正好是**观众反应 + 时间轴**：
 *     - 哪个时间段被刷屏 → 高光/名场面
 *     - 大家在刷什么梗 → 接梗素材
 *     - 弹幕密度/情绪词 → 好不好看
 *
 * 接口：`api.bilibili.com/x/v1/dm/list.so?oid=<cid>`，返回明文 XML（实测不压缩、不需要 SESSDATA）。
 */
import { HttpError } from './http.js';
/** 解析 dm/list.so 的 XML；坏数据直接跳过，不抛错。 */
export function parseDanmakuXml(xml) {
    const items = [];
    const pattern = /<d p="([^"]*)">([^<]*)<\/d>/g;
    let match;
    while ((match = pattern.exec(xml)) !== null) {
        const fields = (match[1] ?? '').split(',');
        const at = Number(fields[0]);
        const text = decodeXmlEntities((match[2] ?? '').trim());
        if (!Number.isFinite(at) || text === '')
            continue;
        items.push({ at, text, mode: Number(fields[1] ?? '1') });
    }
    return items;
}
function decodeXmlEntities(value) {
    return value
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)));
}
/** 过滤噪声弹幕：纯符号/纯数字/超长/无意义口头禅 */
const NOISE = [
    /^[\s\p{P}\p{S}]+$/u,
    /^\d+$/,
    /^(哈哈+|hhh+|233+|awsl+|好家伙|前方高能|打卡|第一|来了|沙发|1|啊+)$/i,
];
export function isUsefulDanmaku(text) {
    const clean = text.trim();
    if (clean.length < 2 || clean.length > 24)
        return false;
    if (NOISE.some(pattern => pattern.test(clean)))
        return false;
    return true;
}
/**
 * 把弹幕压成"高光时刻 + 代表弹幕"。
 * @param bucketSec 分桶粒度（默认 30 秒）
 * @param peakCount 取几个高光桶
 */
export function summarizeDanmaku(items, durationSec, options = {}) {
    const bucketSec = Math.max(5, options.bucketSec ?? 30);
    const peakCount = Math.max(1, options.peakCount ?? 3);
    const samplePerPeak = Math.max(1, options.samplePerPeak ?? 5);
    const buckets = new Map();
    for (const item of items) {
        const index = Math.max(0, Math.floor(item.at / bucketSec));
        const list = buckets.get(index) ?? [];
        list.push(item);
        buckets.set(index, list);
    }
    const ranked = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length);
    const peaks = ranked.slice(0, peakCount).map(([index, list]) => {
        const samples = pickSamples(list, samplePerPeak);
        return { startSec: index * bucketSec, endSec: index * bucketSec + bucketSec, count: list.length, samples };
    });
    // 全局代表弹幕：优先峰值段里"被重复刷"的句子（梗）
    const all = pickSamples(items, 12);
    const density = durationSec > 0 ? Number((items.length / durationSec).toFixed(2)) : 0;
    return { total: items.length, density, peaks, samples: all };
}
/** 选样本：去掉噪声、去重，优先"重复出现"的梗（次数降序） */
export function pickSamples(items, limit) {
    const counter = new Map();
    for (const item of items) {
        if (!isUsefulDanmaku(item.text))
            continue;
        counter.set(item.text, (counter.get(item.text) ?? 0) + 1);
    }
    return [...counter.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([text]) => text);
}
export function clockOf(seconds) {
    const total = Math.max(0, Math.round(seconds));
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    return String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
}
/** 给模型看的紧凑文本（不做判断，只给事实与样本） */
export function danmakuText(summary, durationSec, url) {
    const lines = [
        '【弹幕概况】共 ' + summary.total + ' 条，全长 ' + clockOf(durationSec) + '，平均每秒 ' + summary.density + ' 条',
    ];
    if (summary.peaks.length > 0) {
        lines.push('【弹幕最密集的时段】');
        for (const peak of summary.peaks) {
            const samples = peak.samples.length > 0 ? '：' + peak.samples.join(' / ') : '';
            lines.push('- ' + clockOf(peak.startSec) + '–' + clockOf(peak.endSec) + '（' + peak.count + ' 条）' + samples);
        }
    }
    if (summary.samples.length > 0)
        lines.push('【被反复刷的弹幕】' + summary.samples.join(' / '));
    lines.push('来源：' + url);
    return lines.join('\n');
}
/** 拉弹幕 XML（调用方给 cid） */
export async function fetchDanmakuXml(cid, options = {}) {
    const timeoutMs = options.timeoutMs ?? 15000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const fetchImpl = options.fetchImpl ?? fetch;
    try {
        const response = await fetchImpl('https://api.bilibili.com/x/v1/dm/list.so?oid=' + String(cid), {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                Referer: 'https://www.bilibili.com/',
                ...(options.cookie !== undefined && options.cookie !== '' ? { Cookie: options.cookie } : {}),
            },
            signal: controller.signal,
        });
        if (!response.ok)
            throw new HttpError('弹幕接口 HTTP ' + String(response.status), response.status);
        const buffer = await response.arrayBuffer();
        return new TextDecoder('utf-8').decode(buffer);
    }
    catch (error) {
        if (error instanceof HttpError)
            throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new HttpError(controller.signal.aborted ? '弹幕请求超时（' + String(timeoutMs) + 'ms）' : message);
    }
    finally {
        clearTimeout(timer);
    }
}
