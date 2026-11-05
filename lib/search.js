/**
 * B 站搜索与 UP 查询（2026-11-05）。
 *
 * 接口（实测通过，需 SESSDATA + wbi 签名）：
 *   - 搜视频：/x/web-interface/wbi/search/type?search_type=video
 *   - 搜用户：search_type=bili_user（用于"按名字订阅"）
 *   - UP 信息：/x/space/wbi/acc/info
 *   - UP 投稿：/x/space/wbi/arc/search（order=pubdate）
 *   - UP 动态：/x/polymer/web-dynamic/v1/feed/space
 *
 * 风控：搜索比详情接口更容易 412，所以结果走缓存（默认 5 分钟），并复用 http.ts 的 412 冷却。
 */
import { getJson, HttpError } from './http.js';
import { signQuery } from './wbi.js';
const API = 'https://api.bilibili.com';
const DURATION_RANGE = {
    1: [1, 600],
    2: [600, 1800],
    3: [1800, 3600],
    4: [3600, 0],
};
function stripTags(value) {
    return value
        .replace(/<[^>]+>/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}
/** "12:34" / "1:02:03" → 秒 */
export function parseClock(text) {
    const parts = text.split(':').map(part => Number(part));
    if (parts.some(part => !Number.isFinite(part)))
        return 0;
    const [a, b, c] = parts;
    if (parts.length === 2 && a !== undefined && b !== undefined)
        return a * 60 + b;
    if (parts.length === 3 && a !== undefined && b !== undefined && c !== undefined)
        return a * 3600 + b * 60 + c;
    return 0;
}
/**
 * 空间接口（acc/info、arc/search、feed/space）风控比搜索严得多：
 * 412 / -352 / -799 都表示"请求过于频繁"，同一 IP 上要冷却一段时间。
 * 这里做一个进程级冷却，避免订阅轮询继续撞墙。
 */
let spaceRiskUntil = 0;
export const SPACE_COOLDOWN_MS = 10 * 60_000;
export function spaceRiskRemainingMs(now = Date.now()) {
    return Math.max(0, spaceRiskUntil - now);
}
function markSpaceRisk() {
    spaceRiskUntil = Math.max(spaceRiskUntil, Date.now() + SPACE_COOLDOWN_MS);
}
function isRiskCode(code, message) {
    return code === 412 || code === -352 || code === -799 || /频繁|风控/.test(message);
}
/** 把风控类错误翻译成能行动的提示 */
function explainRisk(message) {
    if (/-352|风控/.test(message)) {
        return message + ' —— B站空间接口风控较严：配置有效 SESSDATA 后基本可绕过（搜索接口不受影响）';
    }
    if (/412/.test(message)) {
        return message + ' —— 请求被风控，请配置有效 SESSDATA 或稍后重试';
    }
    return message;
}
export class SearchClient {
    options;
    constructor(options) {
        this.options = options;
    }
    httpOptions() {
        const out = {};
        if (this.options.cookie !== undefined && this.options.cookie !== '')
            out.cookie = this.options.cookie;
        if (this.options.timeoutMs !== undefined)
            out.timeoutMs = this.options.timeoutMs;
        return out;
    }
    cacheGet(key) {
        return this.options.cacheGet?.(key);
    }
    cacheSet(key, value) {
        this.options.cacheSet?.(key, value);
    }
    log(level, message) {
        this.options.log?.(level, message);
    }
    async signed(path, query) {
        const keys = await this.options.wbiKeys();
        if (keys === undefined)
            throw new HttpError('拿不到 WBI 密钥（可能未配置 SESSDATA）');
        return API + path + '?' + signQuery(query, keys.imgKey, keys.subKey);
    }
    /** 搜视频 */
    async search(keyword, options = {}) {
        const trimmed = keyword.trim();
        if (trimmed === '')
            throw new Error('搜索词不能为空');
        const page = Math.max(1, Math.round(options.page ?? 1));
        const order = options.order ?? 'totalrank';
        const cacheKey = 'search:' + order + ':' + String(options.duration ?? 0) + ':' + String(page) + ':' + trimmed;
        const cached = this.cacheGet(cacheKey);
        if (cached !== undefined)
            return cached;
        const query = {
            search_type: 'video',
            keyword: trimmed,
            page,
            order,
        };
        if (options.duration !== undefined && options.duration !== 0) {
            const range = DURATION_RANGE[options.duration];
            if (range !== undefined) {
                query.duration = options.duration;
                query.tids = 0;
            }
        }
        const json = await getJson(await this.signed('/x/web-interface/wbi/search/type', query), this.httpOptions());
        if (json.code !== 0)
            throw new HttpError('搜索失败（B站返回 ' + String(json.code) + '：' + (json.message ?? '') + '）', undefined, json.code);
        const hits = (json.data?.result ?? []).map(item => {
            const bvid = String(item.bvid ?? '');
            return {
                bvid,
                aid: Number(item.aid ?? 0),
                title: stripTags(String(item.title ?? '')),
                up: stripTags(String(item.author ?? '')),
                mid: Number(item.mid ?? 0),
                play: Number(item.play ?? 0),
                danmaku: Number(item.video_review ?? 0),
                durationSec: parseClock(String(item.duration ?? '')),
                pubdate: Number(item.pubdate ?? 0),
                cover: String(item.pic ?? ''),
                url: bvid === '' ? '' : 'https://www.bilibili.com/video/' + bvid,
                ...(item.description === undefined ? {} : { description: stripTags(String(item.description)) }),
            };
        }).filter(hit => hit.bvid !== '');
        const result = { hits, total: Number(json.data?.numResults ?? hits.length), page };
        this.cacheSet(cacheKey, result);
        this.log('debug', '搜索 "' + trimmed + '" → ' + hits.length + ' 条');
        return result;
    }
    /** 按名字找 UP（订阅时用） */
    async searchUser(keyword) {
        const trimmed = keyword.trim();
        if (trimmed === '')
            throw new Error('名字不能为空');
        const cacheKey = 'search-user:' + trimmed;
        const cached = this.cacheGet(cacheKey);
        if (cached !== undefined)
            return cached;
        const json = await getJson(await this.signed('/x/web-interface/wbi/search/type', { search_type: 'bili_user', keyword: trimmed, page: 1 }), this.httpOptions());
        if (json.code !== 0)
            throw new HttpError('搜索 UP 失败（B站返回 ' + String(json.code) + '：' + (json.message ?? '') + '）', undefined, json.code);
        const users = (json.data?.result ?? []).map(item => ({
            mid: Number(item.mid ?? 0),
            name: stripTags(String(item.uname ?? '')),
            fans: Number(item.fans ?? 0),
            videos: Number(item.videos ?? 0),
            ...(item.usign === undefined ? {} : { sign: stripTags(String(item.usign)) }),
            ...(item.upic === undefined ? {} : { avatar: String(item.upic) }),
        })).filter(user => user.mid > 0);
        this.cacheSet(cacheKey, users);
        return users;
    }
    /** UP 基本信息 */
    async upInfo(mid) {
        const cacheKey = 'up-info:' + String(mid);
        const cached = this.cacheGet(cacheKey);
        if (cached !== undefined)
            return cached;
        const json = await getJson(await this.signed('/x/space/wbi/acc/info', { mid }), this.httpOptions());
        if (json.code !== 0) {
            if (isRiskCode(json.code, json.message ?? ''))
                markSpaceRisk();
            throw new HttpError(explainRisk('读取 UP 信息失败（B站返回 ' + String(json.code) + '：' + (json.message ?? '') + '）'), undefined, json.code);
        }
        const data = json.data ?? {};
        // acc/info 不返回粉丝数，单独查 relation/stat（不需要 wbi）
        let fans = Number(data.fans ?? 0);
        if (fans === 0) {
            try {
                const stat = await getJson(API + '/x/relation/stat?vmid=' + String(mid), this.httpOptions());
                if (stat.code === 0)
                    fans = Number(stat.data?.follower ?? 0);
            }
            catch {
                // 拿不到就保持 0，不影响主流程
            }
        }
        const info = {
            mid,
            name: stripTags(String(data.name ?? '')),
            fans,
            ...(data.sign === undefined ? {} : { sign: stripTags(String(data.sign)) }),
            ...(data.face === undefined ? {} : { avatar: String(data.face) }),
            ...(data.level === undefined ? {} : { level: Number(data.level) }),
        };
        this.cacheSet(cacheKey, info);
        return info;
    }
    /** UP 的投稿（按发布时间倒序） */
    async upVideos(mid, page = 1, pageSize = 10) {
        const cacheKey = 'up-videos:' + String(mid) + ':' + String(page);
        const cached = this.cacheGet(cacheKey);
        if (cached !== undefined)
            return cached;
        const json = await getJson(await this.signed('/x/space/wbi/arc/search', { mid, pn: Math.max(1, page), ps: Math.max(1, Math.min(50, pageSize)), order: 'pubdate' }), this.httpOptions());
        if (json.code !== 0) {
            if (isRiskCode(json.code, json.message ?? ''))
                markSpaceRisk();
            throw new HttpError(explainRisk('读取投稿失败（B站返回 ' + String(json.code) + '：' + (json.message ?? '') + '）'), undefined, json.code);
        }
        const list = json.data?.list?.vlist ?? [];
        const videos = list.map(item => {
            const bvid = String(item.bvid ?? '');
            return {
                bvid,
                title: stripTags(String(item.title ?? '')),
                pubdate: Number(item.created ?? 0),
                durationSec: parseClock(String(item.length ?? '')),
                play: Number(item.play ?? 0),
                url: bvid === '' ? '' : 'https://www.bilibili.com/video/' + bvid,
            };
        }).filter(video => video.bvid !== '');
        this.cacheSet(cacheKey, videos);
        return videos;
    }
    /** UP 的动态（图文/转发都算） */
    async upDynamics(mid, limit = 10) {
        const cacheKey = 'up-dyn:' + String(mid);
        const cached = this.cacheGet(cacheKey);
        if (cached !== undefined)
            return cached.slice(0, limit);
        const json = await getJson(await this.signed('/x/polymer/web-dynamic/v1/feed/space', { host_mid: mid, offset: '' }), this.httpOptions());
        if (json.code !== 0) {
            if (isRiskCode(json.code, json.message ?? ''))
                markSpaceRisk();
            throw new HttpError(explainRisk('读取动态失败（B站返回 ' + String(json.code) + '：' + (json.message ?? '') + '）'), undefined, json.code);
        }
        const items = json.data?.items ?? [];
        const dynamics = [];
        for (const item of items) {
            const id = String(item.id_str ?? '');
            const type = String(item.type ?? '');
            const modules = (item.modules ?? {});
            const author = modules.module_author ?? {};
            const dynamic = (modules.module_dynamic ?? {});
            const major = (dynamic.major ?? {});
            const desc = (major.desc ?? dynamic.desc ?? {});
            const text = String(desc.text ?? (desc.rich_text_nodes ?? []).map(node => String(node.text ?? '')).join('') ?? '').trim();
            const stat = (modules.module_stat ?? {});
            const comment = (stat.comment ?? {});
            const pubTs = Number(author.pub_ts ?? 0);
            const imageCount = Array.isArray(major.draw?.items)
                ? (major.draw.items ?? []).length
                : 0;
            if (id === '')
                continue;
            dynamics.push({
                id,
                type,
                text: text.slice(0, 300),
                pubdate: pubTs,
                url: 'https://t.bilibili.com/' + id,
                imageCount,
            });
        }
        this.cacheSet(cacheKey, dynamics);
        return dynamics.slice(0, limit);
    }
    /** 名字或 mid → mid（"订阅半佛仙人"用） */
    async resolveUp(target) {
        const trimmed = target.trim();
        if (trimmed === '')
            throw new Error('UP 名字或 mid 不能为空');
        if (/^\d+$/.test(trimmed))
            return this.upInfo(Number(trimmed));
        const users = await this.searchUser(trimmed);
        if (users.length === 0)
            throw new Error('没有搜到 UP：' + trimmed);
        // 同名的可能有小号（实测"半佛仙人"能搜到粉丝 0 的同名号），
        // 用 名字精确匹配(2 分) + log10(粉丝) 打分，既优先精确名也避免选中僵尸号。
        const score = (user) => {
            const exact = user.name === trimmed ? 2 : user.name.includes(trimmed) ? 1 : 0;
            return exact + Math.log10(Math.max(1, user.fans));
        };
        const picked = [...users].sort((a, b) => score(b) - score(a))[0];
        if (picked === undefined)
            throw new Error('没有搜到 UP：' + trimmed);
        this.log('debug', 'UP 候选：' + users.slice(0, 5).map(u => u.name + '(' + u.mid + ',粉丝' + u.fans + ')').join(' / '));
        return this.upInfo(picked.mid);
    }
}
