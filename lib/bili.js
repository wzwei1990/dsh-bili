/**
 * B 站只读客户端（v0.1：解析链接 + 视频信息 + 字幕）。
 *
 * 接口全部是公开接口，不需要登录也能拿到大部分视频的元信息；
 * 字幕是否可见取决于视频是否上传 CC 字幕 / 是否登录，拿不到就如实返回空。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { followRedirect, getJson, HttpError } from './http.js';
import { fetchDanmakuXml, parseDanmakuXml, summarizeDanmaku } from './danmaku.js';
import { signQuery } from './wbi.js';
/**
 * cookie 规整：用户可能①只填 SESSDATA 的值，也可能②直接粘贴整段 cookie（含 DedeUserID 等，常带换行）。
 * 统一行为：去掉换行/多余空格、补齐分隔符；只填值的情况补上 `SESSDATA=` 前缀。
 */
export function normalizeCookie(raw) {
    const flattened = raw.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
    if (flattened === '')
        return '';
    const looksLikeCookie = /(?:^|;\s*)[A-Za-z0-9_]+=/.test(flattened);
    const value = looksLikeCookie ? flattened : 'SESSDATA=' + flattened;
    // 用 "; " 重新拼接，去掉空段与尾部散落的分号
    const pairs = value
        .split(';')
        .map(pair => pair.trim())
        .filter(pair => pair !== '' && pair.includes('='));
    return pairs.join('; ');
}
const API = 'https://api.bilibili.com';
/** 从任意文本里抠出 BV 号 / av 号 / b23 短链。 */
export function extractTarget(input) {
    const text = (input ?? '').trim();
    if (text === '')
        return { kind: 'none', value: '' };
    const bv = /\b(BV[0-9A-Za-z]{10})\b/.exec(text);
    if (bv !== null)
        return { kind: 'bvid', value: bv[1] ?? '' };
    const av = /\bav(\d{1,12})\b/i.exec(text);
    if (av !== null)
        return { kind: 'aid', value: av[1] ?? '' };
    const short = /(b23\.tv|bili2233\.cn)\/([0-9A-Za-z]+)/.exec(text);
    if (short !== null)
        return { kind: 'short', value: 'https://' + (short[1] ?? '') + '/' + (short[2] ?? '') };
    return { kind: 'none', value: '' };
}
/** 把字幕 cue 列表合并成段落文本（每段约 30 秒或 80 字，便于模型阅读）。 */
export function mergeCues(cues) {
    const lines = [];
    let buffer = [];
    let start = cues[0]?.from ?? 0;
    let lastEnd = start;
    const flush = () => {
        if (buffer.length === 0)
            return;
        const minutes = Math.floor(start / 60);
        const seconds = Math.floor(start % 60);
        const stamp = String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
        lines.push('[' + stamp + '] ' + buffer.join(''));
        buffer = [];
    };
    for (const cue of cues) {
        // 先判断边界再入 buffer：跨过 30 秒或攒够 80 字就另起一段，
        // 否则边界那句会被算进上一段（旧实现的 bug）。
        if (buffer.length > 0) {
            const span = cue.from - start;
            const length = buffer.join('').length;
            if (span >= 30 || length >= 80) {
                flush();
                start = cue.from;
            }
        }
        if (buffer.length === 0)
            start = cue.from;
        buffer.push(cue.content.trim());
        lastEnd = cue.from;
    }
    flush();
    void lastEnd;
    return lines.join('\n');
}
export class BiliClient {
    cookie;
    buvidReady = false;
    timeoutMs;
    cacheTtlMs;
    cacheDir;
    log;
    memory = new Map();
    wbiKeys;
    constructor(options = {}) {
        this.cookie = normalizeCookie(options.cookie ?? '');
        this.timeoutMs = options.timeoutMs ?? 15000;
        this.cacheTtlMs = options.cacheTtlMs ?? 24 * 60 * 60_000;
        this.cacheDir = options.cacheDir ?? join(homedir(), '.dsh', 'dsh-bili', 'cache');
        this.log = options.log ?? (() => undefined);
    }
    httpOptions() {
        return { cookie: this.cookie, timeoutMs: this.timeoutMs };
    }
    /** 解链接 → 统一成 bvid（b23 短链会先跟随跳转）。 */
    async normalize(input) {
        let target = extractTarget(input);
        if (target.kind === 'short') {
            const finalUrl = await followRedirect(target.value, this.httpOptions());
            target = extractTarget(finalUrl);
            this.log('debug', '短链跳转到: ' + finalUrl);
        }
        if (target.kind === 'bvid')
            return { bvid: target.value };
        if (target.kind === 'aid')
            return { aid: Number(target.value) };
        throw new HttpError('没找到 B 站视频标识（支持 BV 号、av 号、b23.tv 短链、含链接的文本）');
    }
    /** 视频元信息（缓存按 bvid）。 */
    async resolve(input) {
        const id = await this.normalize(input);
        const key = 'view:' + (id.bvid ?? 'aid' + String(id.aid ?? 0));
        const cached = this.cacheGet(key);
        if (cached !== undefined)
            return cached;
        const query = id.bvid !== undefined ? 'bvid=' + id.bvid : 'aid=' + String(id.aid);
        const json = await getJson(API + '/x/web-interface/view?' + query, this.httpOptions());
        assertOk(json);
        const data = json.data;
        const info = {
            bvid: data.bvid,
            aid: data.aid,
            cid: data.cid,
            title: data.title,
            up: data.owner?.name ?? '未知UP',
            durationSec: data.duration,
            cover: data.pic,
            desc: data.desc ?? '',
            pageUrl: 'https://www.bilibili.com/video/' + data.bvid,
            publishedAt: data.pubdate ?? 0,
            stats: {
                view: data.stat?.view ?? 0,
                danmaku: data.stat?.danmaku ?? 0,
                like: data.stat?.like ?? 0,
                coin: data.stat?.coin ?? 0,
                favorite: data.stat?.favorite ?? 0,
            },
            pages: (data.pages ?? []).map(page => ({
                cid: page.cid,
                page: page.page,
                part: page.part,
                durationSec: page.duration,
            })),
        };
        this.cacheSet(key, info);
        return info;
    }
    /** 卡片信息（发给群里的"分享"用）。 */
    async card(input) {
        const info = await this.resolve(input);
        return {
            bvid: info.bvid,
            title: info.title,
            up: info.up,
            durationSec: info.durationSec,
            cover: info.cover,
            pageUrl: info.pageUrl,
            desc: info.desc.slice(0, 120),
        };
    }
    /** 字幕轨列表（可能为空：UP 没传字幕 / 需要登录）。 */
    async subtitleTracks(input, cid) {
        const info = await this.resolve(input);
        const targetCid = cid ?? info.cid;
        const keys = await this.ensureWbiKeys();
        const url = keys === undefined
            ? API + '/x/player/v2?bvid=' + encodeURIComponent(info.bvid) + '&cid=' + String(targetCid)
            : API + '/x/player/wbi/v2?' + signQuery({ bvid: info.bvid, cid: targetCid }, keys.imgKey, keys.subKey);
        const json = await getJson(url, this.httpOptions());
        assertOk(json);
        const list = json.data?.subtitle?.subtitles ?? [];
        const tracks = list.map(item => ({
            lang: item.lan,
            label: item.lan_doc ?? item.lan,
            url: item.subtitle_url.startsWith('//') ? 'https:' + item.subtitle_url : item.subtitle_url,
            ai: item.ai_type !== undefined && item.ai_type > 0,
        }));
        return { info, tracks };
    }
    /** 字幕正文：优先中文（含 AI 字幕），没有就返回空并说明。 */
    /**
     * 拉弹幕并压成"高光时段 + 代表弹幕"。
     * 免登录可用（实测 dm/list.so 返回明文 XML）；有 cookie 时带上即可。
     */
    async danmaku(input, options = {}) {
        const info = await this.resolve(input);
        const cid = options.cid ?? info.cid;
        const cacheKey = 'dm:' + info.bvid + ':' + String(cid);
        const cached = this.cacheGet(cacheKey);
        if (cached !== undefined)
            return { info, summary: cached };
        const xml = await fetchDanmakuXml(cid, { cookie: this.httpOptions().cookie, timeoutMs: this.httpOptions().timeoutMs });
        const items = parseDanmakuXml(xml);
        const summary = summarizeDanmaku(items, info.durationSec);
        this.cacheSet(cacheKey, summary);
        return { info, summary };
    }
    async readSubtitle(input, options = {}) {
        const { info, tracks } = await this.subtitleTracks(input, options.cid);
        const maxChars = Math.max(200, options.maxChars ?? 6000);
        if (tracks.length === 0) {
            return { bvid: info.bvid, lang: '', label: '', text: '', cueCount: 0, truncated: false };
        }
        const picked = tracks.find(track => track.lang.toLowerCase() === 'zh-cn')
            ?? tracks.find(track => track.lang.toLowerCase().startsWith('zh'))
            ?? tracks[0];
        if (picked === undefined) {
            return { bvid: info.bvid, lang: '', label: '', text: '', cueCount: 0, truncated: false };
        }
        const cacheKey = 'sub:' + info.bvid + ':' + picked.lang;
        const cached = this.cacheGet(cacheKey);
        if (cached !== undefined)
            return trimTo(cached, maxChars);
        const json = await getJson(picked.url, this.httpOptions());
        const cues = (json.body ?? []).map(cue => ({ from: cue.from, content: cue.content }));
        const result = {
            bvid: info.bvid,
            lang: picked.lang,
            label: picked.label,
            text: mergeCues(cues),
            cueCount: cues.length,
            truncated: false,
        };
        this.cacheSet(cacheKey, result);
        return trimTo(result, maxChars);
    }
    /**
     * 取可直连的视频流地址（给 ffmpeg 抽帧用）。
     * 优先 DASH（fnval=16），退回 durl；都不行就抛错由上层降级。
     */
    async streamUrl(input, options = {}) {
        const info = await this.resolve(input);
        const qn = Math.max(16, Math.min(112, Math.round(options.quality ?? 64)));
        // 先补游客 buvid3：B 站对"没有 buvid3 的裸请求"很容易回 412
        await this.ensureVisitorCookie();
        const query = { bvid: info.bvid, cid: info.cid, qn, fnval: 16, fourk: 1 };
        const params = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString();
        // 先走免签名接口：免登录下它最稳（实测容器/云端 wbi 签名反而容易被 412 风控）
        let json = await getJson(API + '/x/player/playurl?' + params, this.httpOptions());
        if (json.code !== 0) {
            const keys = await this.ensureWbiKeys();
            if (keys !== undefined) {
                json = await getJson(API + '/x/player/wbi/playurl?' + signQuery(query, keys.imgKey, keys.subKey), this.httpOptions());
            }
        }
        if (json.code !== 0)
            throw new HttpError('取视频流失败（B站返回 ' + String(json.code) + '：' + (json.message ?? '') + '）', undefined, json.code);
        const dashUrl = json.data?.dash?.video?.[0]?.baseUrl ?? json.data?.dash?.video?.[0]?.base_url;
        const fallback = json.data?.durl?.[0]?.url;
        const stream = (dashUrl ?? fallback ?? '').trim();
        if (stream === '')
            throw new HttpError('B站没有返回可用的视频流地址');
        const audio = (json.data?.dash?.audio?.[0]?.baseUrl ?? json.data?.dash?.audio?.[0]?.base_url ?? '').trim();
        const result = { info, url: stream, headers: this.streamHeaders(), quality: qn };
        if (audio !== '')
            result.audioUrl = audio;
        return result;
    }
    /**
     * 拉流必须带 Referer/UA（B 站防盗链）；有 cookie 一并带上。
     * Referer 用**视频页**而不是首页：CDN 会对比，首页 Referer 偶尔被 403。
     */
    streamHeaders(pageUrl = 'https://www.bilibili.com/') {
        const headers = {
            Referer: pageUrl,
            Origin: 'https://www.bilibili.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        };
        if (this.cookie.trim() !== '')
            headers.Cookie = this.cookie;
        return headers;
    }
    /** cookie 的形态摘要（排障用：只给长度/段数/是否含关键字，不泄露值） */
    get cookieShape() {
        if (this.cookie === '')
            return undefined;
        const parts = this.cookie.split(';').length;
        const hasSession = this.cookie.includes('SESSDATA=');
        const hasBuvid = this.cookie.includes('buvid3=');
        const dup = (this.cookie.match(/SESSDATA=/g) ?? []).length > 1 ? '，⚠️ 出现两次 SESSDATA（可能把整段 cookie 又加了前缀）' : '';
        return '长度 ' + String(this.cookie.length) + '，' + String(parts) + ' 段，含 SESSDATA=' + String(hasSession) + '，含 buvid3=' + String(hasBuvid) + dup;
    }
    /**
     * 查登录状态（给设置页/doctor 用）：返回昵称与 mid，未登录时给出原因。
     * 顺带说明：SESSDATA 是登录凭证，时间戳没过期也可能被服务器判定失效。
     */
    async loginState() {
        if (this.cookie.trim() === '')
            return { configured: false, isLogin: false, message: '未配置 SESSDATA' };
        try {
            const json = await getJson(API + '/x/web-interface/nav', this.httpOptions());
            const data = json.data;
            if (json.code === 0 && data?.isLogin === true) {
                return {
                    configured: true,
                    isLogin: true,
                    ...(data.uname === undefined ? {} : { uname: data.uname }),
                    ...(data.mid === undefined ? {} : { mid: data.mid }),
                    ...(data.level_info?.current_level === undefined ? {} : { level: data.level_info.current_level }),
                };
            }
            return { configured: true, isLogin: false, message: json.message ?? ('code ' + String(json.code)) };
        }
        catch (error) {
            return { configured: true, isLogin: false, message: error instanceof Error ? error.message : String(error) };
        }
    }
    /** WBI 密钥对（缓存 2 小时；nav 接口未登录也返回密钥）。 */
    /**
     * 拿 WBI 密钥。未登录时 nav 会返回 -101，所以先补一个游客 cookie（buvid3）再试；
     * 仍然拿不到就返回 undefined —— 上层退回不需要签名的老接口 `/x/player/v2`。
     */
    async ensureWbiKeys() {
        const now = Date.now();
        if (this.wbiKeys !== undefined && now - this.wbiKeys.at < 2 * 60 * 60_000) {
            return { imgKey: this.wbiKeys.imgKey, subKey: this.wbiKeys.subKey };
        }
        if (!(await this.ensureVisitorCookie()))
            return undefined;
        try {
            const json = await getJson(API + '/x/web-interface/nav', this.httpOptions());
            if (json.code !== 0)
                return undefined;
            const imgKey = json.data?.wbi_img?.img_url ?? '';
            const subKey = json.data?.wbi_img?.sub_url ?? '';
            if (imgKey === '' || subKey === '')
                return undefined;
            this.wbiKeys = { imgKey, subKey, at: now };
            return { imgKey, subKey };
        }
        catch (error) {
            this.log('debug', 'WBI 密钥获取失败（退回老接口）: ' + (error instanceof Error ? error.message : String(error)));
            return undefined;
        }
    }
    /** 没有 cookie 时补一个游客 buvid3，否则 nav 接口必然 -101。 */
    async ensureVisitorCookie() {
        if (this.buvidReady)
            return true;
        if (this.cookie.includes('buvid3=')) {
            this.buvidReady = true;
            return true;
        }
        try {
            const json = await getJson(API + '/x/frontend/finger/spi', this.httpOptions());
            const b3 = json.data?.b_3 ?? '';
            const b4 = json.data?.b_4 ?? '';
            if (b3 === '')
                return false;
            this.cookie = (this.cookie === '' ? '' : this.cookie + '; ') + 'buvid3=' + b3 + (b4 === '' ? '' : '; buvid4=' + b4);
            this.buvidReady = true;
            this.log('debug', '已补游客 cookie（buvid3）');
            return true;
        }
        catch {
            return false;
        }
    }
    cacheGet(key) {
        if (this.cacheTtlMs <= 0)
            return undefined;
        const memory = this.memory.get(key);
        if (memory !== undefined && Date.now() - memory.at < this.cacheTtlMs)
            return memory.value;
        try {
            const file = join(this.cacheDir, key.replace(/[^A-Za-z0-9_.-]/g, '_') + '.json');
            if (!existsSync(file))
                return undefined;
            const raw = JSON.parse(readFileSync(file, 'utf8'));
            if (Date.now() - raw.at >= this.cacheTtlMs)
                return undefined;
            this.memory.set(key, raw);
            return raw.value;
        }
        catch {
            return undefined;
        }
    }
    cacheSet(key, value) {
        if (this.cacheTtlMs <= 0)
            return;
        const entry = { at: Date.now(), value };
        this.memory.set(key, entry);
        try {
            mkdirSync(this.cacheDir, { recursive: true });
            writeFileSync(join(this.cacheDir, key.replace(/[^A-Za-z0-9_.-]/g, '_') + '.json'), JSON.stringify(entry), 'utf8');
        }
        catch (error) {
            this.log('debug', '写缓存失败: ' + (error instanceof Error ? error.message : String(error)));
        }
    }
}
/** 截断超长字幕（保留头部，标注截断）。 */
export function trimTo(result, maxChars) {
    if (result.text.length <= maxChars)
        return result;
    return { ...result, text: result.text.slice(0, maxChars) + '\n…（字幕过长，已截断）', truncated: true };
}
function assertOk(json) {
    if (json.code !== 0)
        throw new HttpError('B 站接口返回 ' + String(json.code) + ': ' + (json.message || '未知错误'), undefined, json.code);
}
