/**
 * 抖音解析（A 档：yt-dlp + ffmpeg，不依赖任何签名服务）。
 *
 * 产出**平台中立的分析素材**（不绑定任何下游工具）：
 *   - 元数据（标题/作者/时长/分辨率/fps）
 *   - 本地视频文件（后续可再抽帧/分析）
 *   - 16k 单声道音频（交给 tts_transcribe 做 ASR）
 *   - 9 帧分镜拼图（复用 StoryboardService）
 *
 * 不做 a_bogus 签名逆向；需要 cookies 时由 yt-dlp 自己处理（后续可用 ytdlpPath 包装脚本补 --cookies）。
 */
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveStoryboardDeps, runBinary } from './deps.js';
import { downloadWithYtDlp, resolveYtDlp, ytdlpArgs } from './ytdlp.js';
import { downloadDouyinPlayUrl, fetchDouyinWork } from './amagi.js';
/** 抖音合法主域（防止把任意 URL 交给下载器/请求器） */
const DOUYIN_HOST_SUFFIXES = ['douyin.com', 'iesdouyin.com'];
export function isDouyinUrl(input) {
    try {
        const { hostname } = new URL(input.trim());
        return DOUYIN_HOST_SUFFIXES.some(suffix => hostname === suffix || hostname.endsWith('.' + suffix));
    }
    catch {
        return false;
    }
}
/** 从一段话里抠出第一个抖音链接（消息里常带口令/表情） */
export function extractDouyinUrl(text) {
    const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
    for (const match of matches) {
        const cleaned = match.replace(/[)，。！？、；：]+$/u, '');
        if (isDouyinUrl(cleaned))
            return cleaned;
    }
    return undefined;
}
/** 从链接里取作品 id（/video/123、/note/123、?modal_id=123） */
export function pickAwemeId(url) {
    const patterns = [/\/video\/(\d{5,})/, /\/note\/(\d{5,})/, /\/share\/video\/(\d{5,})/, /[?&]modal_id=(\d{5,})/];
    for (const pattern of patterns) {
        const hit = pattern.exec(url);
        if (hit?.[1] !== undefined)
            return hit[1];
    }
    return undefined;
}
function defaultRoot() {
    const home = process.env.DSH_HOME;
    const base = home !== undefined && home !== '' ? home : join(homedir(), '.dsh');
    return join(base, 'dsh-bili', 'douyin');
}
/** 展开 v.douyin.com 短链；失败时返回原链接 */
export async function resolveDouyinShortUrl(url) {
    if (!/v\.douyin\.com|iesdouyin\.com/i.test(url))
        return url;
    try {
        const response = await fetch(url, {
            redirect: 'follow',
            signal: AbortSignal.timeout(15_000),
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36' },
        });
        return response.url === '' ? url : response.url;
    }
    catch {
        return url;
    }
}
/**
 * 从抖音网页 HTML 里解析标题/描述/作者/点赞。
 * 不登录也能拿到 `<meta name="description">`（实测 2026-11-26）。
 */
export function parseDouyinHtml(html, url) {
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const descMatch = /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i.exec(html)
        ?? /<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["']/i.exec(html);
    const rawTitle = titleMatch?.[1]?.trim() ?? '';
    const description = descMatch?.[1]?.trim() ?? '';
    if (rawTitle === '' && description === '')
        return undefined;
    const title = rawTitle.replace(/\s*-\s*抖音\s*$/u, '').trim();
    // 描述格式：「<正文> #tag ... - 作者于20261122发布在抖音，已经收获了228.3万个喜欢」
    const tail = /-\s*(.+?)于(\d{8})发布在抖音[，,]\s*已经收获了([\d.]+[万亿]?)个?喜欢/u.exec(description);
    return {
        title: title === '' ? description.split('\n')[0] ?? '' : title,
        ...(tail?.[1] === undefined ? {} : { uploader: tail[1].trim() }),
        ...(tail?.[2] === undefined ? {} : { publishedAt: tail[2] }),
        ...(tail?.[3] === undefined ? {} : { likes: tail[3] }),
        ...(description === '' ? {} : { description }),
        url,
    };
}
/** 只读网页元数据（快，不下载、不需要 cookies） */
export async function probeDouyinQuick(input) {
    const url = extractDouyinUrl(input) ?? (isDouyinUrl(input) ? input.trim() : undefined);
    if (url === undefined)
        throw new Error('没找到抖音链接（支持 douyin.com / v.douyin.com / iesdouyin.com）');
    const finalUrl = await resolveDouyinShortUrl(url);
    const response = await fetch(finalUrl, {
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
            'Accept-Language': 'zh-CN,zh;q=0.9',
        },
    });
    if (!response.ok)
        throw new Error('抖音网页返回 HTTP ' + String(response.status));
    const html = await response.text();
    const parsed = parseDouyinHtml(html, finalUrl);
    if (parsed === undefined)
        throw new Error('抖音网页里没有可解析的标题/描述（可能需要登录或链接失效）');
    return parsed;
}
async function ytdlpBin(options) {
    if (options.ytdlpPath !== undefined && options.ytdlpPath !== '')
        return options.ytdlpPath;
    const found = await resolveYtDlp();
    if (found === undefined)
        throw new Error('没有找到 yt-dlp：抖音解析需要它（请安装 yt-dlp 或在设置里填 ytdlpPath）');
    return found.path;
}
/** yt-dlp -J 拿元数据（不下载） */
export async function probeDouyin(url, options = {}) {
    const bin = await ytdlpBin(options);
    const baseArgs = ['-J', '--no-playlist', '--no-warnings'];
    if (options.cookiesFile !== undefined && options.cookiesFile !== '')
        baseArgs.unshift('--cookies', options.cookiesFile);
    try {
        return await probeWithYtDlp(bin, url, baseArgs);
    }
    catch (error) {
        // yt-dlp 被抖音要求 fresh cookies 时，退回网页 meta（不登录也能拿标题/作者/点赞）
        const quick = await probeDouyinQuick(url).catch(() => undefined);
        if (quick !== undefined) {
            return {
                title: quick.title,
                uploader: quick.uploader ?? '',
                durationSec: 0,
                webpageUrl: quick.url,
            };
        }
        throw error;
    }
}
async function probeWithYtDlp(bin, url, args0) {
    const output = await runBinary(bin, ytdlpArgs(bin, args0.concat([url])), 60_000);
    // yt-dlp 正常只输出一行 JSON；保险起见取最后一个 `{` 开头的行
    const line = output.trim().split(/\r?\n/).filter(item => item.startsWith('{')).pop();
    if (line === undefined)
        throw new Error('yt-dlp 没有返回可解析的元数据（链接可能需要登录/cookies）');
    let json;
    try {
        json = JSON.parse(line);
    }
    catch {
        throw new Error('yt-dlp 元数据不是合法 JSON');
    }
    return {
        ...(json.id === undefined ? {} : { id: String(json.id) }),
        title: String(json.title ?? '抖音视频'),
        uploader: String(json.uploader ?? json.channel ?? ''),
        durationSec: Number(json.duration ?? 0),
        ...(json.width === undefined ? {} : { width: Number(json.width) }),
        ...(json.height === undefined ? {} : { height: Number(json.height) }),
        ...(json.fps === undefined ? {} : { fps: Number(json.fps) }),
        ...(json.thumbnail === undefined ? {} : { thumbnail: String(json.thumbnail) }),
        webpageUrl: String(json.webpage_url ?? url),
        ...(json.ext === undefined ? {} : { ext: String(json.ext) }),
    };
}
/** 抽 16k 单声道 wav（给 ASR 用） */
async function extractAudio(ffmpeg, videoPath, audioPath) {
    await runBinary(ffmpeg, ['-y', '-i', videoPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audioPath], 120_000);
}
/**
 * 解析一个抖音链接：元数据 + 下载 + 音频 + 分镜。
 * @param input 分享链接或含链接的一段话
 */
export async function buildDouyinAnalysis(input, options = {}) {
    const log = options.log ?? (() => undefined);
    const url = extractDouyinUrl(input) ?? (isDouyinUrl(input) ? input.trim() : undefined);
    if (url === undefined)
        throw new Error('没找到抖音链接（支持 douyin.com / v.douyin.com / iesdouyin.com）');
    const root = options.rootDir ?? defaultRoot();
    // ① 元数据：优先 amagi（本地签名、无头可用）；没配再退回 yt-dlp/网页 meta
    let amagi;
    if (options.amagiBaseUrl !== undefined && options.amagiBaseUrl.trim() !== '') {
        try {
            log('info', '抖音解析：走 amagi ' + options.amagiBaseUrl);
            amagi = await fetchDouyinWork(url, {
                baseUrl: options.amagiBaseUrl,
                ...(options.amagiDouyinCookies === undefined ? {} : { cookie: options.amagiDouyinCookies }),
            });
        }
        catch (error) {
            log('warn', '抖音解析：amagi 失败，退回 yt-dlp: ' + (error instanceof Error ? error.message : String(error)));
        }
    }
    const meta = amagi === undefined
        ? await probeDouyin(url, options)
        : {
            id: amagi.id,
            title: amagi.title,
            uploader: amagi.uploader,
            durationSec: amagi.durationSec,
            ...(amagi.width === undefined ? {} : { width: amagi.width }),
            ...(amagi.height === undefined ? {} : { height: amagi.height }),
            ...(amagi.cover === undefined ? {} : { thumbnail: amagi.cover }),
            webpageUrl: amagi.webpageUrl,
        };
    const id = meta.id ?? pickAwemeId(url) ?? String(Date.now());
    const dir = join(root, id);
    await mkdir(dir, { recursive: true });
    // ② 视频：amagi 给直链就直接下载（免 cookie）；否则走 yt-dlp
    let videoPath;
    if (amagi?.playUrl !== undefined) {
        log('info', '抖音解析：下载 amagi 直链');
        videoPath = join(dir, 'src.mp4');
        await downloadDouyinPlayUrl(amagi.playUrl, videoPath);
    }
    else {
        const bin = await ytdlpBin(options);
        log('info', '抖音解析：下载视频（≤' + String(options.maxHeight ?? 720) + 'p）');
        const downloaded = await downloadWithYtDlp(url, {
            bin,
            dir,
            maxHeight: options.maxHeight ?? 720,
            ...(options.maxDurationSec === undefined ? { maxDurationSec: 600 } : { maxDurationSec: options.maxDurationSec }),
            ...(options.cookiesFile === undefined ? {} : { cookiesFile: options.cookiesFile }),
            timeoutMs: 300_000,
        });
        videoPath = downloaded.filePath;
    }
    // 音频：失败不阻塞（分镜/元数据仍然可用）
    let audioPath;
    try {
        const deps = await resolveStoryboardDeps({ ffmpegPath: options.ffmpegPath ?? '' });
        if (deps.ffmpeg === undefined)
            throw new Error('没有找到 ffmpeg');
        const wav = join(dir, 'audio.wav');
        await extractAudio(deps.ffmpeg.path, videoPath, wav);
        audioPath = wav;
    }
    catch (error) {
        log('warn', '抖音解析：抽音频失败（仍可看分镜）: ' + (error instanceof Error ? error.message : String(error)));
    }
    // 分镜：复用现有 StoryboardService（内部会再探测一次 ffmpeg）
    let storyboard;
    if (options.storyboard !== undefined) {
        try {
            storyboard = await options.storyboard.build(videoPath);
        }
        catch (error) {
            log('warn', '抖音解析：分镜生成失败: ' + (error instanceof Error ? error.message : String(error)));
        }
    }
    return {
        meta,
        videoPath,
        ...(audioPath === undefined ? {} : { audioPath }),
        ...(storyboard === undefined ? {} : { storyboard }),
    };
}
