import { Config, resolveConfig } from './config.js';
import { BiliClient } from './bili.js';
import { SearchClient } from './search.js';
import { StoryboardService } from './services.js';
import { registerTools } from './tools.js';
export { Config };
export const name = 'dsh-bili';
/** 只依赖工具注册表：本插件不碰会话/渠道，通道按需消费服务。 */
export const inject = ['tools'];
const LEVEL_RANK = { debug: 0, info: 1, warn: 2 };
export function apply(ctx, rawConfig) {
    const config = resolveConfig(rawConfig);
    const threshold = LEVEL_RANK[config.logLevel] ?? 1;
    const log = (level, message) => {
        if ((LEVEL_RANK[level] ?? 1) < threshold)
            return;
        const line = '[dsh-bili] ' + message;
        if (level === 'warn')
            console.warn(line);
        else
            console.log(line);
    };
    const client = new BiliClient({
        // 交给 BiliClient.normalizeCookie 判断是「只填 SESSDATA 值」还是「整段 cookie」
        cookie: config.sessdata,
        timeoutMs: config.timeoutMs,
        cacheTtlMs: Math.max(0, config.cacheTtlMinutes) * 60_000,
        log,
    });
    const storyboard = new StoryboardService({
        client,
        enabled: config.storyboard,
        frames: config.storyboardFrames,
        maxMinutes: config.maxStoryboardMinutes,
        ffmpegPath: config.ffmpegPath,
        ytdlpPath: config.ytdlpPath,
        log,
    });
    // 搜索缓存（内存）：同一关键词/UP 短时间内不重复打接口
    const searchCache = new Map();
    const cacheTtl = Math.max(0, config.searchCacheMinutes) * 60_000;
    const search = new SearchClient({
        cookie: client.cookieValue,
        timeoutMs: config.timeoutMs,
        cacheGet: (key) => {
            const hit = searchCache.get(key);
            if (hit === undefined)
                return undefined;
            if (cacheTtl > 0 && Date.now() - hit.at >= cacheTtl) {
                searchCache.delete(key);
                return undefined;
            }
            return hit.value;
        },
        cacheSet: (key, value) => {
            searchCache.set(key, { value, at: Date.now() });
            if (searchCache.size > 500) {
                const oldest = [...searchCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 100);
                for (const [key2] of oldest)
                    searchCache.delete(key2);
            }
        },
        wbiKeys: () => client.wbiKeys(),
        log,
    });
    registerTools(ctx, client, {
        subtitleMaxChars: config.subtitleMaxChars,
        storyboard,
        search,
        log,
    });
    // 给渠道插件留可选服务入口：ctx.get('dshBili') 存在时，napcat 之类可以直接调。
    try {
        const host = ctx;
        host.provide?.('dshBili', {
            resolve: (input) => client.resolve(input),
            subtitle: (input, options) => client.readSubtitle(input, options),
            card: (input) => client.card(input),
            /** 弹幕概况（免登录）：高光时段 + 被反复刷的弹幕 */
            danmaku: (input, options) => client.danmaku(input, options),
            /** 分镜：B 站链接 / 其它链接（yt-dlp）/ 本地文件都行 */
            storyboard: (input) => storyboard.build(input),
            depsStatus: () => storyboard.depsStatus(),
            /** 搜索 */
            search: (query, options) => search.search(query, options),
            /** 查 UP（名字或 mid） */
            resolveUp: (target) => search.resolveUp(target),
            /** UP 投稿 */
            upVideos: (mid, page, pageSize) => search.upVideos(mid, page ?? 1, pageSize ?? 10),
            /** UP 动态 */
            upDynamics: (mid, limit) => search.upDynamics(mid, limit ?? 10),
        });
    }
    catch {
        log('debug', '宿主不支持 provide(dshBili)，跳过服务注册（工具仍可用）');
    }
    log('info', 'dsh-bili 已加载（解析/字幕/弹幕/分镜/搜索；' + (config.sessdata.trim() === '' ? '未登录' : '已配置 SESSDATA') + '）');
}
