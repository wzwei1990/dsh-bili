/**
 * dsh-bili —— B 站只读能力层。
 *
 * 职责边界（2026-11-05 调整，与用户确认的 A 方案）：
 *   ✅ 链接解析 / 视频信息 / 字幕 / 弹幕 / 分镜 / 搜索 / UP 查询
 *   ❌ 订阅与推送 —— 属于"有收件人的渠道插件"（例如 dsh-napcat），本插件只提供数据
 *
 * 设计原则：
 * - 不依赖任何 IM 插件；渠道按需消费 `dshBili` 服务。
 * - 网络失败、无字幕、接口风控都返回结构化错误，不抛异常炸宿主。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
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
    // cookie 来源：文件优先（配置文件里的多行值可能被宿主截断）
    const dshHome = process.env.DSH_HOME;
    const cookieFile = config.cookieFile !== ''
        ? config.cookieFile
        : join(dshHome !== undefined && dshHome !== '' ? dshHome : join(homedir(), '.dsh'), 'dsh-bili', 'cookie.txt');
    // 读取 cookie：文件优先；配置里的值只要够长就顺手同步进文件（"每次改自动保存一份"）
    const configCookie = config.sessdata.trim();
    let fileCookie = '';
    if (existsSync(cookieFile)) {
        try {
            fileCookie = readFileSync(cookieFile, 'utf8').trim();
        }
        catch {
            log('warn', '读 cookie 文件失败：' + cookieFile);
        }
    }
    // 够长才算"像真的 cookie"（整段通常几百字符；只填 SESSDATA 值也 >100）
    const looksReal = (value) => value.length >= 100;
    if (looksReal(configCookie) && configCookie !== fileCookie) {
        try {
            mkdirSync(dirname(cookieFile), { recursive: true });
            writeFileSync(cookieFile, configCookie + '\n', 'utf8');
            fileCookie = configCookie;
            log('info', '已把配置里的 cookie 自动保存到 ' + cookieFile + '（长度 ' + String(configCookie.length) + '）');
        }
        catch (error) {
            log('warn', '写 cookie 文件失败（继续用配置里的值）: ' + (error instanceof Error ? error.message : String(error)));
        }
    }
    let cookieValue = fileCookie !== '' ? fileCookie : configCookie;
    let cookieSource = fileCookie !== '' ? cookieFile : 'config';
    log('info', 'cookie 来源=' + cookieSource + '，原始长度=' + String(cookieValue.length));
    const client = new BiliClient({
        // 交给 BiliClient.normalizeCookie 判断是「只填 SESSDATA 值」还是「整段 cookie」
        cookie: cookieValue,
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
        cookieInfo: () => ({ source: cookieSource, length: cookieValue.length, normalized: client.cookieValue.length }),
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
            cookieInfo: () => ({ source: cookieSource, length: cookieValue.length, normalized: client.cookieValue.length }),
            /** 搜索 */
            search: (query, options) => search.search(query, options),
            /** 按名字搜用户（未登录也能用） */
            searchUser: (query) => search.searchUser(query),
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
