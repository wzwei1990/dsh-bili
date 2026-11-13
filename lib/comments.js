/**
 * B 站评论 / 互动（2026-11-05 新增）。
 *
 * 分两类：
 *   - 读：评论列表、子评论（wbi 签名，宽松）
 *   - 写：发评论/回复、点赞、投币、发弹幕（需要 SESSDATA + bili_jct，风控最敏感）
 *
 * 写操作的安全纪律（参考 dsh-bili-scroll / dsh-bili-interactor 的门禁形态）：
 *   1. 默认关闭（`allowWrite: false`），要显式打开
 *   2. 每小时有上限，超了直接拒绝
 *   3. 命中风控（412 / -352 / -799）后进入冷却，冷却期内一律拒绝
 *   4. 每一次写都记审计（时间/动作/目标/参数摘要/结果）
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { HttpError, UA } from './http.js';
import { signQuery } from './wbi.js';
const API = 'https://api.bilibili.com';
/** 风控类错误码：命中后短时间别再写 */
const RISK_CODES = new Set([412, -352, -799, -509]);
/** 这些错误说明是"配置/权限问题"，不是风控 */
const CONFIG_CODES = new Set([-101, -111]);
function explainCommentError(code, message) {
    if (CONFIG_CODES.has(code)) {
        return '需要登录态（SESSDATA' + (code === -111 ? ' + bili_jct' : '') + '）：B站返回 ' + String(code) + ' ' + message;
    }
    if (RISK_CODES.has(code))
        return 'B站风控（' + String(code) + ' ' + message + '），稍后再试';
    if (code === 12002)
        return '评论被吞了（B站 12002：内容被拦截或需要验证）';
    return 'B站返回 ' + String(code) + '：' + message;
}
export class CommentClient {
    /** 运行时替换 cookie（设置页保存后热更新用）。 */
    setCookie(raw) {
        this.options.cookie = raw;
    }
    options;
    writes = [];
    cooldownUntil = 0;
    constructor(options) {
        this.options = options;
    }
    /** 从 cookie 里取 CSRF token */
    csrf() {
        const match = /(?:^|;\s*)bili_jct=([^;]+)/.exec(this.options.cookie);
        return match?.[1]?.trim() ?? '';
    }
    /** 写操作是否可用（给 doctor/工具提示用） */
    writeStatus() {
        return {
            enabled: this.options.write.enabled,
            csrf: this.csrf() !== '',
            cooldownMs: Math.max(0, this.cooldownUntil - Date.now()),
            usedLastHour: this.recentWrites(),
        };
    }
    recentWrites() {
        const cutoff = Date.now() - 3600_000;
        while (this.writes.length > 0 && (this.writes[0] ?? 0) < cutoff)
            this.writes.shift();
        return this.writes.length;
    }
    /** 写操作前的统一门禁 */
    guard(action) {
        if (!this.options.write.enabled) {
            throw new Error('写操作未开启：请在 dsh-bili 设置里打开「允许写操作」（' + action + '）');
        }
        if (this.csrf() === '') {
            throw new Error('cookie 里没有 bili_jct（CSRF token）：请重新复制一份完整 cookie');
        }
        const remaining = this.cooldownUntil - Date.now();
        if (remaining > 0) {
            throw new Error('风控冷却中（还要 ' + Math.ceil(remaining / 60_000) + ' 分钟），' + action + ' 暂缓');
        }
        if (this.recentWrites() >= this.options.write.perHour) {
            throw new Error('本小时写操作已达上限（' + String(this.options.write.perHour) + ' 次），' + action + ' 暂缓');
        }
        this.writes.push(Date.now());
    }
    audit(action, target, detail, result) {
        const file = this.options.auditFile;
        if (file === undefined || file === '')
            return;
        try {
            mkdirSync(dirname(file), { recursive: true });
            const line = JSON.stringify({
                at: new Date().toISOString(),
                action,
                target,
                detail,
                result,
            });
            if (!existsSync(file)) {
                // 第一次写先建空文件（appendFileSync 也会建，这里只是显式一点）
            }
            appendFileSync(file, line + '\n', 'utf8');
        }
        catch (error) {
            this.options.log('warn', '写审计失败: ' + (error instanceof Error ? error.message : String(error)));
        }
    }
    /** 命中风控 → 进冷却 */
    markRisk() {
        this.cooldownUntil = Date.now() + Math.max(1, this.options.write.cooldownMinutes) * 60_000;
    }
    headers(referer) {
        const headers = {
            'User-Agent': UA,
            Referer: referer,
            Origin: 'https://www.bilibili.com',
        };
        if (this.options.cookie !== '')
            headers.Cookie = this.options.cookie;
        return headers;
    }
    async signedUrl(path, query) {
        const keys = await this.options.wbiKeys();
        if (keys === undefined)
            throw new HttpError('拿不到 WBI 密钥');
        return API + path + '?' + signQuery(query, keys.imgKey, keys.subKey);
    }
    /** 读一级评论 */
    async read(target, options = {}) {
        const page = Math.max(1, Math.round(options.page ?? 1));
        const pageSize = Math.max(1, Math.min(20, Math.round(options.pageSize ?? 20)));
        const sort = options.sort ?? 1;
        const cacheKey = 'comments:' + target + ':' + String(page) + ':' + String(sort) + ':' + String(pageSize);
        const cached = this.options.cacheGet?.(cacheKey);
        if (cached !== undefined)
            return cached;
        const video = await this.options.resolve(target);
        const url = await this.signedUrl('/x/v2/reply/wbi/main', {
            oid: video.aid,
            type: 1,
            mode: sort === 0 ? 2 : 3,
            next: page - 1,
            ps: pageSize,
        });
        const json = await this.getJson(url, 'https://www.bilibili.com/video/' + video.bvid);
        if (json.code !== 0)
            throw new HttpError(explainCommentError(json.code, json.message ?? ''), undefined, json.code);
        const items = (json.data?.replies ?? []).map(item => this.toComment(item, video));
        const result = {
            video,
            items,
            cursor: Number(json.data?.cursor?.next ?? 0),
            end: json.data?.cursor?.is_end === true,
            total: Number(json.data?.cursor?.all_count ?? 0),
        };
        this.options.cacheSet?.(cacheKey, result);
        return result;
    }
    /**
     * 读一条根评论下的子评论。
     * `fromEnd = true` 时先取总数再跳最后一页（回复很多的热评，最新回复在最后一页）。
     */
    async readReplies(target, root, page = 1, options = {}) {
        const video = await this.options.resolve(target);
        let targetPage = Math.max(1, page);
        if (options.fromEnd === true && page === 1) {
            const head = await this.readRepliesPage(video, root, 1);
            const count = head.total;
            targetPage = Math.max(1, Math.ceil(count / 20));
            if (targetPage === 1)
                return { items: head.items, end: true };
        }
        const result = await this.readRepliesPage(video, root, targetPage);
        return { items: result.items, end: targetPage * 20 >= result.total };
    }
    async readRepliesPage(video, root, page) {
        const url = await this.signedUrl('/x/v2/reply/reply', {
            oid: video.aid,
            type: 1,
            root,
            pn: Math.max(1, page),
            ps: 20,
        });
        const json = await this.getJson(url, 'https://www.bilibili.com/video/' + video.bvid);
        if (json.code !== 0)
            throw new HttpError(explainCommentError(json.code, json.message ?? ''), undefined, json.code);
        const items = (json.data?.replies ?? []).map(item => this.toComment(item, video));
        return { items, total: Number(json.data?.page?.count ?? items.length) };
    }
    /** 发评论 / 回复（root 传了就回复那条评论） */
    async post(target, message, options = {}) {
        const trimmed = message.trim();
        if (trimmed === '')
            throw new Error('评论内容不能为空');
        this.guard('发评论');
        const video = await this.options.resolve(target);
        const form = new URLSearchParams();
        form.set('oid', String(video.aid));
        form.set('type', '1');
        form.set('message', trimmed);
        form.set('plat', '1');
        form.set('csrf', this.csrf());
        form.set('csrf_token', this.csrf());
        if (options.root !== undefined) {
            form.set('root', String(options.root));
            form.set('parent', String(options.parent ?? options.root));
        }
        try {
            const json = await this.postForm('/x/v2/reply/add', form, 'https://www.bilibili.com/video/' + video.bvid);
            if (json.code !== 0) {
                if (RISK_CODES.has(json.code))
                    this.markRisk();
                throw new HttpError(explainCommentError(json.code, json.message ?? ''), undefined, json.code);
            }
            const rpid = Number(json.data?.rpid ?? json.data?.rpid_str ?? 0);
            this.audit('comment', video.bvid, trimmed.slice(0, 80), 'ok rpid=' + String(rpid));
            return { rpid, video };
        }
        catch (error) {
            this.audit('comment', video.bvid, trimmed.slice(0, 80), 'fail ' + (error instanceof Error ? error.message : String(error)));
            throw error;
        }
    }
    /** 点赞 / 取消点赞 */
    async like(target, on = true) {
        this.guard(on ? '点赞' : '取消点赞');
        const video = await this.options.resolve(target);
        const form = new URLSearchParams();
        form.set('aid', String(video.aid));
        form.set('like', on ? '1' : '2');
        form.set('csrf', this.csrf());
        try {
            const json = await this.postForm('/x/web-interface/archive/like', form, 'https://www.bilibili.com/video/' + video.bvid);
            if (json.code !== 0) {
                if (RISK_CODES.has(json.code))
                    this.markRisk();
                throw new HttpError(explainCommentError(json.code, json.message ?? ''), undefined, json.code);
            }
            this.audit('like', video.bvid, on ? 'on' : 'off', 'ok');
            return { video, on };
        }
        catch (error) {
            this.audit('like', video.bvid, on ? 'on' : 'off', 'fail ' + (error instanceof Error ? error.message : String(error)));
            throw error;
        }
    }
    /** 投币（count 1~2） */
    async coin(target, count = 1, alsoLike = false) {
        this.guard('投币');
        const video = await this.options.resolve(target);
        const form = new URLSearchParams();
        form.set('bvid', video.bvid);
        form.set('multiply', String(Math.max(1, Math.min(2, Math.round(count)))));
        form.set('select_like', alsoLike ? '1' : '0');
        form.set('csrf', this.csrf());
        try {
            const json = await this.postForm('/x/web-interface/coin/add', form, 'https://www.bilibili.com/video/' + video.bvid);
            if (json.code !== 0) {
                if (RISK_CODES.has(json.code))
                    this.markRisk();
                throw new HttpError(explainCommentError(json.code, json.message ?? ''), undefined, json.code);
            }
            this.audit('coin', video.bvid, String(count), 'ok');
            return { video, count };
        }
        catch (error) {
            this.audit('coin', video.bvid, String(count), 'fail ' + (error instanceof Error ? error.message : String(error)));
            throw error;
        }
    }
    /** 发弹幕 */
    async sendDanmaku(target, text, options = {}) {
        const trimmed = text.trim();
        if (trimmed === '')
            throw new Error('弹幕内容不能为空');
        this.guard('发弹幕');
        const video = await this.options.resolve(target);
        const progress = Math.max(0, Math.round((options.progressSec ?? 1) * 1000));
        const form = new URLSearchParams();
        form.set('type', '1');
        form.set('oid', String(video.cid));
        form.set('msg', trimmed);
        form.set('bvid', video.bvid);
        form.set('progress', String(progress));
        form.set('mode', String(options.mode ?? 1));
        form.set('fontsize', '25');
        form.set('color', '16777215');
        form.set('csrf', this.csrf());
        form.set('csrf_token', this.csrf());
        try {
            const json = await this.postForm('/x/v2/dm/post', form, 'https://www.bilibili.com/video/' + video.bvid);
            if (json.code !== 0) {
                if (RISK_CODES.has(json.code))
                    this.markRisk();
                throw new HttpError(explainCommentError(json.code, json.message ?? ''), undefined, json.code);
            }
            this.audit('danmaku', video.bvid, trimmed.slice(0, 40) + ' @' + String(options.progressSec ?? 1) + 's', 'ok');
            return { video, progress };
        }
        catch (error) {
            this.audit('danmaku', video.bvid, trimmed.slice(0, 40), 'fail ' + (error instanceof Error ? error.message : String(error)));
            throw error;
        }
    }
    toComment(raw, video) {
        const member = (raw.member ?? {});
        const content = (raw.content ?? {});
        const replies = (raw.replies ?? []);
        return {
            rpid: Number(raw.rpid ?? 0),
            root: Number(raw.root ?? raw.rpid ?? 0),
            parent: Number(raw.parent ?? 0),
            author: {
                mid: Number(member.mid ?? 0),
                name: String(member.uname ?? ''),
                level: Number((member.level_info ?? {}).current_level ?? 0),
            },
            message: String(content.message ?? ''),
            like: Number(raw.like ?? 0),
            replyCount: Number(raw.rcount ?? replies.length),
            ctime: Number(raw.ctime ?? 0),
            isUp: Number(member.mid ?? 0) === 0 ? false : false,
        };
    }
    async getJson(url, referer) {
        const response = await fetch(url, {
            headers: this.headers(referer),
            signal: AbortSignal.timeout(this.options.timeoutMs),
        });
        if (!response.ok)
            throw new HttpError('请求失败 HTTP ' + String(response.status), response.status);
        return (await response.json());
    }
    async postForm(path, form, referer) {
        const response = await fetch(API + path, {
            method: 'POST',
            headers: Object.assign(this.headers(referer), {
                'Content-Type': 'application/x-www-form-urlencoded',
            }),
            body: form.toString(),
            signal: AbortSignal.timeout(this.options.timeoutMs),
        });
        if (!response.ok) {
            if (response.status === 412) {
                this.markRisk();
                throw new HttpError('B站风控（HTTP 412），已进入冷却', response.status);
            }
            throw new HttpError('请求失败 HTTP ' + String(response.status), response.status);
        }
        return (await response.json());
    }
}
