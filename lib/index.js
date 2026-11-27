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
import { Config, readVolatile, resolveConfig } from './config.js';
import { BiliClient } from './bili.js';
import { SearchClient } from './search.js';
import { CommentClient } from './comments.js';
import { ReplyWatchStore } from './replywatch.js';
import { checkReplyWatches } from './replycheck.js';
import { StoryboardService } from './services.js';
import { registerTools } from './tools.js';
import { analyzeBili } from './analysis.js';
import { buildDouyinAnalysis, probeDouyinQuick } from './douyin.js';
import { fetchDouyinWork } from './amagi.js';
import { MIN_REAL_COOKIE_LENGTH, readCookieFromProfiles } from './profilecookie.js';
import { createAmagiCookieResolver } from './amagicookie.js';
import { watchProfileCookie } from './cookiewatch.js';
export { Config };
export const name = 'dsh-bili';
/** 只依赖工具注册表：本插件不碰会话/渠道，通道按需消费服务。 */
export const inject = ['tools'];
const LEVEL_RANK = { debug: 0, info: 1, warn: 2 };
export function apply(ctx, rawConfig) {
    // 宿主会把多行标量截断（长 cookie 被折成几十行，传过来只剩第一行）。
    // 与 B 站 cookie.txt 一致：完整值落到独立文件，读取时文件优先；profile/文件变化都会重读。
    // overrides 对象先建空，等 log / cookieFile 就绪后再填入 resolver（proxy 每次读都会重新取）。
    const cookieOverrides = {};
    const rawField = (key) => {
        const value = readVolatile(rawConfig[key]);
        return typeof value === 'string' ? value : '';
    };
    const config = resolveConfig(rawConfig, cookieOverrides);
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
    const configDir = dirname(cookieFile);
    cookieOverrides.amagiDouyinCookies = createAmagiCookieResolver({
        key: 'amagiDouyinCookies',
        file: join(configDir, 'amagi-douyin.txt'),
        passed: () => rawField('amagiDouyinCookies'),
        log,
    });
    cookieOverrides.amagiBilibiliCookies = createAmagiCookieResolver({
        key: 'amagiBilibiliCookies',
        file: join(configDir, 'amagi-bilibili.txt'),
        passed: () => rawField('amagiBilibiliCookies'),
        log,
    });
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
    // 宿主传过来的多行值可能被截断（线上实测只拿到 15/24 字符）：直接读原始配置文件自愈
    if (configCookie.length < MIN_REAL_COOKIE_LENGTH && fileCookie === '') {
        const fromProfile = readCookieFromProfiles();
        if (fromProfile !== undefined) {
            log('info', '宿主传入的 SESSDATA 只有 ' + String(configCookie.length) + ' 个字符（被截断），已从 '
                + fromProfile.file + ' 直接读到完整值（' + String(fromProfile.cookie.length) + ' 字符）');
            try {
                mkdirSync(dirname(cookieFile), { recursive: true });
                writeFileSync(cookieFile, fromProfile.cookie + '\n', 'utf8');
                fileCookie = fromProfile.cookie;
                log('info', '已自动保存 cookie 到 ' + cookieFile);
            }
            catch (error) {
                log('warn', '自动保存 cookie 文件失败: ' + (error instanceof Error ? error.message : String(error)));
            }
        }
    }
    if (fileCookie === '' && configCookie !== '' && configCookie.length < MIN_REAL_COOKIE_LENGTH) {
        log('warn', '配置里的 SESSDATA 只有 ' + String(configCookie.length) + ' 个字符，明显被截断了（正常整段 cookie 几百字符）。'
            + '插件会尝试直接读 profile 配置文件自愈；若仍失败，请检查 ' + cookieFile);
    }
    let cookieValue = fileCookie !== '' ? fileCookie : configCookie;
    let cookieSource = fileCookie !== '' ? cookieFile : 'config';
    log('info', 'cookie 来源=' + cookieSource + '，原始长度=' + String(cookieValue.length));
    // 设置页保存后"立即"同步：宿主改配置不会重跑 apply，所以低频轮询 profile 配置，
    // 只在 mtime/size 变化时重新解析并写 cookie.txt，同时热更新运行中的客户端（无需重启）。
    ctx.effect(() => watchProfileCookie({
        cookieFile,
        log,
        onCookie: (cookie) => {
            client.setCookie(cookie);
            search.setCookie(cookie);
            comments.setCookie(cookie);
        },
    }));
    // B 站滚动刷新 SESSDATA：跟随 Set-Cookie 回写文件（每分钟最多一次），避免"网页有效、插件失效"
    let lastCookiePersistAt = 0;
    const persistCookie = (next) => {
        const now = Date.now();
        if (now - lastCookiePersistAt < 60_000)
            return;
        lastCookiePersistAt = now;
        try {
            mkdirSync(dirname(cookieFile), { recursive: true });
            writeFileSync(cookieFile, next + '\n', 'utf8');
            log('info', '已跟随 B 站刷新 cookie（' + cookieFile + '）');
        }
        catch (error) {
            log('warn', '回写刷新后的 cookie 失败: ' + (error instanceof Error ? error.message : String(error)));
        }
    };
    const client = new BiliClient({
        // 交给 BiliClient.normalizeCookie 判断是「只填 SESSDATA 值」还是「整段 cookie」
        cookie: cookieValue,
        timeoutMs: config.timeoutMs,
        cacheTtlMs: Math.max(0, config.cacheTtlMinutes) * 60_000,
        log,
        onCookieRefresh: persistCookie,
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
    // 评论读缓存（风控保护）：和搜索分开，缓存键带页/排序
    const commentCache = new Map();
    const commentTtl = Math.max(0, config.commentCacheMinutes) * 60_000;
    // 评论/互动：读用 wbi，写要 allowWrite + bili_jct + 限频 + 风控冷却
    const comments = new CommentClient({
        cookie: client.cookieValue,
        timeoutMs: config.timeoutMs,
        wbiKeys: () => client.wbiKeys(),
        resolve: async (target) => {
            const info = await client.resolve(target);
            return { bvid: info.bvid, aid: info.aid, cid: info.cid, title: info.title };
        },
        write: {
            enabled: config.allowWrite,
            perHour: config.writePerHour,
            cooldownMinutes: config.writeCooldownMinutes,
        },
        auditFile: join(dshHome !== undefined && dshHome !== '' ? dshHome : join(homedir(), '.dsh'), 'dsh-bili', 'audit.jsonl'),
        cacheGet: (key) => {
            const hit = commentCache.get(key);
            if (hit === undefined)
                return undefined;
            if (commentTtl <= 0 || Date.now() - hit.at >= commentTtl) {
                commentCache.delete(key);
                return undefined;
            }
            return hit.value;
        },
        cacheSet: (key, value) => {
            commentCache.set(key, { value, at: Date.now() });
            if (commentCache.size > 300) {
                const oldest = [...commentCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 60);
                for (const [key2] of oldest)
                    commentCache.delete(key2);
            }
        },
        log,
    });
    const watches = new ReplyWatchStore({
        file: join(dshHome !== undefined && dshHome !== '' ? dshHome : join(homedir(), '.dsh'), 'dsh-bili', 'reply-watch.json'),
        keepDays: config.replyWatchDays,
        maxFailures: 3,
        log,
    });
    log('info', '回复监听保留 ' + (config.replyWatchDays > 0 ? String(config.replyWatchDays) + ' 天（过期自动清理）' : '永久'));
    registerTools(ctx, client, {
        subtitleMaxChars: config.subtitleMaxChars,
        storyboard,
        search,
        comments,
        watches,
        replyWatchMax: config.replyWatchMax,
        autoWatchOwnComments: config.autoWatchOwnComments,
        cookieInfo: () => ({ source: cookieSource, length: cookieValue.length, normalized: client.cookieValue.length }),
        biliAnalyze: (input) => analyzeBili(input, client, {
            ffmpegPath: config.ffmpegPath,
            ...(config.amagiBaseUrl === '' ? {} : { amagiBaseUrl: config.amagiBaseUrl }),
            ...(config.amagiBilibiliCookies === '' ? {} : { amagiBilibiliCookies: config.amagiBilibiliCookies }),
            ...(config.storyboard ? { storyboard } : {}),
            log,
        }),
        douyin: (input) => buildDouyinAnalysis(input, {
            maxHeight: config.douyinMaxHeight,
            maxDurationSec: Math.max(1, config.douyinMaxMinutes) * 60,
            ffmpegPath: config.ffmpegPath,
            ytdlpPath: config.ytdlpPath,
            ...(config.amagiBaseUrl === '' ? {} : { amagiBaseUrl: config.amagiBaseUrl }),
            ...(config.amagiDouyinCookies === '' ? {} : { amagiDouyinCookies: config.amagiDouyinCookies }),
            ...(config.douyinCookiesFile === '' ? {} : { cookiesFile: config.douyinCookiesFile }),
            ...(config.storyboard ? { storyboard } : {}),
            log,
        }),
        log,
    });
    // 给渠道插件留可选服务入口：ctx.get('dshBili') 存在时，napcat 之类可以直接调。
    try {
        const host = ctx;
        host.provide?.('dshBili', {
            resolve: (input) => client.resolve(input),
            subtitle: (input, options) => client.readSubtitle(input, options),
            card: (input) => client.card(input),
            /** 抖音元数据（优先 amagi；给 napcat 主动发言用，不下载视频） */
            douyinMeta: async (input) => {
                if (config.amagiBaseUrl !== '') {
                    const work = await fetchDouyinWork(input, {
                        baseUrl: config.amagiBaseUrl,
                        ...(config.amagiDouyinCookies === '' ? {} : { cookie: config.amagiDouyinCookies }),
                    });
                    return {
                        title: work.title, uploader: work.uploader, durationSec: work.durationSec,
                        description: work.description, url: work.webpageUrl,
                        ...(work.likes === undefined ? {} : { likes: work.likes }),
                        ...(work.cover === undefined ? {} : { cover: work.cover }),
                    };
                }
                const quick = await probeDouyinQuick(input);
                return {
                    title: quick.title, uploader: quick.uploader ?? '', durationSec: 0,
                    description: quick.description ?? '', url: quick.url,
                    ...(quick.likes === undefined ? {} : { likes: quick.likes }),
                };
            },
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
            /** 评论读取 */
            comments: (target, options) => comments.read(target, options ?? {}),
            /** 子评论 */
            commentReplies: (target, root, page) => comments.readReplies(target, root, page ?? 1),
            /** 写操作状态（是否开启 / csrf / 冷却 / 本小时已用） */
            writeStatus: () => comments.writeStatus(),
            /** 回复监听：登记表 */
            replyWatches: () => watches.list(),
            /**
             * 回复监听：检查并推进游标（渠道插件定时调用，发管理员私聊）
             * 返回 [{ watch, items }]，items 是自上次以来的新增
             */
            checkReplies: async () => checkReplyWatches({ watches, comments, log }),
        });
    }
    catch {
        log('debug', '宿主不支持 provide(dshBili)，跳过服务注册（工具仍可用）');
    }
    log('info', 'dsh-bili 已加载（解析/字幕/弹幕/分镜/搜索；' + (config.sessdata.trim() === '' ? '未登录' : '已配置 SESSDATA') + '）');
}
