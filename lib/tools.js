import { defineTool } from '@deepseek-ai/dsh-tools';
import { danmakuText } from './danmaku.js';
import { checkReplyWatches } from './replycheck.js';
/** 文本输出工具的统一 shape（与 dsh-napcat 一致）。 */
function textOutput() {
    return {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
    };
}
function durationText(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (value) => String(value).padStart(2, '0');
    return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
}
function statText(info) {
    const fmt = (value) => value >= 10000 ? (value / 10000).toFixed(1) + '万' : String(value);
    return '播放 ' + fmt(info.stats.view) + ' · 弹幕 ' + fmt(info.stats.danmaku) + ' · 点赞 ' + fmt(info.stats.like);
}
/** 把视频信息 + 字幕拼成给模型读的文本。 */
export function digestOf(info, subtitle, truncated) {
    const lines = [];
    lines.push('【B站视频】' + info.title);
    lines.push('UP主：' + info.up + '　时长：' + durationText(info.durationSec) + '　' + statText(info));
    lines.push('链接：' + info.pageUrl);
    if (info.desc.trim() !== '')
        lines.push('简介：' + info.desc.trim().slice(0, 300));
    if (subtitle.trim() === '') {
        lines.push('');
        lines.push('（这个视频没有可用字幕：UP 没上传 CC，或需要登录才能看。只能依据标题/简介来判断；想要画面级理解得靠 ASR，暂未支持。）');
    }
    else {
        lines.push('');
        lines.push('【字幕正文' + (truncated ? '（已截断）' : '') + '】');
        lines.push(subtitle);
    }
    return lines.join('\n');
}
export function registerTools(ctx, client, deps) {
    const { storyboard, search } = deps;
    ctx.tools.register(defineTool({
        name: 'bili_read',
        description: '读取一个 B 站视频：返回标题、UP主、时长、播放量、简介和字幕正文（供你总结/回答）。支持 BV 号、av 号、b23.tv 短链，或任何包含链接的文本。',
        parameters: {
            url: { type: 'string', required: true, description: 'B 站链接 / BV 号 / av 号，或含链接的一段话' },
            max_chars: { type: 'number', description: '字幕最多返回多少字符（默认按配置 6000）' },
        },
        output: textOutput(),
        isConcurrencySafe: () => true,
        execute: async (args) => {
            const input = args;
            const maxChars = Number.isFinite(Number(input.max_chars)) ? Number(input.max_chars) : deps.subtitleMaxChars;
            const info = await client.resolve(input.url);
            try {
                const subtitle = await client.readSubtitle(input.url, { maxChars });
                return digestOf(info, subtitle.text, subtitle.truncated);
            }
            catch (error) {
                deps.log('warn', '读字幕失败（只返回视频信息）: ' + (error instanceof Error ? error.message : String(error)));
                return digestOf(info, '', false);
            }
        },
    }));
    ctx.tools.register(defineTool({
        name: 'bili_subtitle',
        description: '只取 B 站视频的字幕正文（带 [mm:ss] 时间戳段落）。视频没字幕时返回一句说明。',
        parameters: {
            url: { type: 'string', required: true, description: 'B 站链接 / BV 号 / av 号' },
            max_chars: { type: 'number', description: '最多返回多少字符' },
        },
        output: textOutput(),
        isConcurrencySafe: () => true,
        execute: async (args) => {
            const input = args;
            const maxChars = Number.isFinite(Number(input.max_chars)) ? Number(input.max_chars) : deps.subtitleMaxChars;
            const subtitle = await client.readSubtitle(input.url, { maxChars });
            if (subtitle.text.trim() === '')
                return '这个视频没有可用字幕（UP 未上传 CC，或需要登录）。';
            return subtitle.text;
        },
    }));
    ctx.tools.register(defineTool({
        name: 'bili_danmaku',
        description: '读一个 B 站视频的弹幕概况：总条数、最密集的时段（高光/名场面）、被反复刷的弹幕。免登录可用，适合"这视频哪里最精彩/观众怎么评价"。',
        parameters: {
            url: { type: 'string', required: true, description: 'B 站链接 / BV 号 / av 号' },
            page: { type: 'number', description: '分P 的 cid（可选，默认第 1 P）' },
        },
        output: textOutput(),
        isConcurrencySafe: () => true,
        execute: async (args) => {
            const input = args;
            try {
                const { info, summary } = await client.danmaku(input.url, Number.isFinite(Number(input.page)) ? { cid: Number(input.page) } : {});
                return '【' + info.title + '】 ' + info.up + ' · ' + durationText(info.durationSec) + '\n'
                    + danmakuText(summary, info.durationSec, info.pageUrl);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                deps.log('warn', '读弹幕失败: ' + message);
                return '读弹幕失败：' + message;
            }
        },
    }));
    ctx.tools.register(defineTool({
        name: 'bili_storyboard',
        description: '给一个 B 站视频（或其它网站链接 / 本地视频文件）抽 9 帧拼成一张分镜图，附时间轴与音频响度条。用于"看一下画面里是什么"。需要 ffmpeg；非 B 站链接还需要 yt-dlp。',
        parameters: {
            url: { type: 'string', required: true, description: 'B 站链接 / 任意视频链接 / 本地视频文件路径' },
        },
        output: textOutput(),
        isConcurrencySafe: () => false,
        execute: async (args) => {
            const input = args;
            try {
                const result = await storyboard.build(input.url);
                const lines = [
                    '【分镜】' + result.title,
                    '来源：' + result.source + ' · 时长 ' + durationText(result.durationSec) + ' · 波形' + (result.withWaveform ? '有' : '无'),
                    '时间轴：' + result.timeline.map((t) => '#' + String(t.index) + ' ' + t.label).join('  '),
                    '图片：' + result.imagePath,
                ];
                return lines.join('\n');
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                deps.log('warn', '分镜失败: ' + message);
                const hint = message.includes('412') || message.includes('风控')
                    ? '\n提示：B站对机房/云服务器 IP 风控较严，配置 SESSDATA（登录态）后基本可绕过。'
                    : message.includes('yt-dlp')
                        ? '\n提示：非 B 站链接需要 yt-dlp；检查是否已安装并在 PATH 里。'
                        : '';
                return '分镜失败：' + message + hint;
            }
        },
    }));
    ctx.tools.register(defineTool({
        name: 'bili_doctor',
        description: '自检：B 站登录状态（SESSDATA 是否有效）+ ffmpeg/yt-dlp 是否可用。字幕读不到、分镜生成失败时先跑这个。',
        parameters: {},
        output: textOutput(),
        isConcurrencySafe: () => true,
        execute: async () => {
            const lines = [];
            try {
                const login = await client.loginState();
                if (!login.configured) {
                    lines.push('B站登录：未配置 SESSDATA（视频信息/弹幕仍可用；字幕大概率拿不到）');
                }
                else if (login.isLogin !== true && client.cookieShape !== undefined) {
                    lines.push('B站登录：❌ SESSDATA 无效或已过期（' + (login.message ?? '未知原因') + '）');
                    lines.push('  cookie 形态：' + client.cookieShape);
                    const info = deps.cookieInfo?.();
                    if (info !== undefined) {
                        lines.push('  cookie 来源：' + info.source + '（原始长度 ' + String(info.length) + '，规整后 ' + String(info.normalized) + '）');
                        if (info.length > 0 && info.length < 100) {
                            lines.push('  提示：配置里传进来的 cookie 太短，可能被 YAML 多行值截断了 → 把整段 cookie 存成文件 ~/.dsh/dsh-bili/cookie.txt 即可');
                        }
                    }
                }
                else if (login.isLogin) {
                    lines.push('B站登录：✅ 有效（' + (login.uname ?? '?') + '，uid ' + String(login.mid ?? '?') + '，Lv' + String(login.level ?? '?') + '）');
                }
                else {
                    lines.push('B站登录：❌ SESSDATA 无效或已过期（' + (login.message ?? '未知原因') + '）');
                    lines.push('  处理：浏览器登录 bilibili.com → F12 → Application → Cookies → 复制 SESSDATA 的值（只要值，不要整段 cookie）');
                }
            }
            catch (error) {
                lines.push('B站登录：检查失败 — ' + (error instanceof Error ? error.message : String(error)));
            }
            try {
                const deps = await storyboard.depsStatus();
                lines.push('ffmpeg：' + (deps.ffmpeg ?? '未找到（分镜不可用）'));
                lines.push('ffprobe：' + (deps.ffprobe ?? '未找到'));
                lines.push('yt-dlp：' + (deps.ytdlp ?? '未找到（非 B 站链接不可用；B 站不需要它）'));
                lines.push('分镜字体：' + (deps.font ?? '没有可用字体（分镜不带时间戳文字）'));
            }
            catch (error) {
                lines.push('依赖检查失败 — ' + (error instanceof Error ? error.message : String(error)));
            }
            return lines.join('\n');
        },
    }));
    ctx.tools.register(defineTool({
        name: 'bili_card',
        description: '取一个 B 站视频的分享卡片信息（标题/UP主/时长/封面/链接），用于在聊天里分享。',
        parameters: {
            url: { type: 'string', required: true, description: 'B 站链接 / BV 号 / av 号' },
        },
        output: textOutput(),
        isConcurrencySafe: () => true,
        execute: async (args) => {
            const input = args;
            const card = await client.card(input.url);
            return [
                '标题：' + card.title,
                'UP主：' + card.up,
                '时长：' + durationText(card.durationSec),
                '链接：' + card.pageUrl,
                '封面：' + card.cover,
            ].join('\n');
        },
    }));
    ctx.tools.register(defineTool({
        name: 'bili_search',
        description: '搜索 B 站视频：返回标题/UP主/播放/时长/链接。可用于"找某个攻略视频""最近有什么新内容"。',
        parameters: {
            query: { type: 'string', required: true, description: '搜索词' },
            page: { type: 'number', description: '页码（默认 1）' },
            order: { type: 'string', description: '排序：totalrank 综合 / click 播放 / pubdate 最新 / dm 弹幕 / stow 收藏' },
            duration: { type: 'number', description: '时长过滤：1=<10分钟 2=10-30 3=30-60 4=>60；0=不限' },
        },
        output: textOutput(),
        isConcurrencySafe: () => true,
        execute: async (args) => {
            const input = args;
            try {
                const order = ['totalrank', 'click', 'pubdate', 'dm', 'stow'].includes(String(input.order)) ? input.order : undefined;
                const duration = [0, 1, 2, 3, 4].includes(Number(input.duration)) ? Number(input.duration) : undefined;
                const result = await search.search(input.query, {
                    ...(Number.isFinite(Number(input.page)) ? { page: Number(input.page) } : {}),
                    ...(order === undefined ? {} : { order }),
                    ...(duration === undefined ? {} : { duration }),
                });
                if (result.hits.length === 0)
                    return '没有搜到结果：' + input.query;
                const lines = ['搜索「' + input.query + '」共 ' + result.total + ' 条，第 ' + result.page + ' 页：'];
                for (const hit of result.hits.slice(0, 10)) {
                    lines.push('· ' + hit.title + '（' + hit.up + ' · ' + durationText(hit.durationSec) + ' · ' + String(hit.play) + ' 播放）');
                    lines.push('  ' + hit.url);
                }
                return lines.join('\n');
            }
            catch (error) {
                return '搜索失败：' + (error instanceof Error ? error.message : String(error));
            }
        },
    }));
    ctx.tools.register(defineTool({
        name: 'bili_up',
        description: '查一个 UP 主：名字或 mid 都能用，返回粉丝数、简介和最近 5 个投稿。',
        parameters: {
            target: { type: 'string', required: true, description: 'UP 名字或 mid' },
        },
        output: textOutput(),
        isConcurrencySafe: () => true,
        execute: async (args) => {
            const input = args;
            try {
                const info = await search.resolveUp(input.target);
                const videos = await search.upVideos(info.mid, 1, 5).catch(() => []);
                const lines = ['【' + info.name + '】mid=' + String(info.mid) + ' · 粉丝 ' + String(info.fans)];
                if (info.sign !== undefined && info.sign !== '')
                    lines.push('简介：' + info.sign);
                lines.push('主页：https://space.bilibili.com/' + String(info.mid));
                if (videos.length > 0) {
                    lines.push('最近投稿：');
                    for (const video of videos) {
                        lines.push('· ' + video.title + '（' + new Date(video.pubdate * 1000).toLocaleDateString('zh-CN') + '）' + video.url);
                    }
                }
                return lines.join('\n');
            }
            catch (error) {
                return '查 UP 失败：' + (error instanceof Error ? error.message : String(error));
            }
        },
    }));
    // ---- 评论 / 互动（2026-11-05） ----
    ctx.tools.register(defineTool({
        name: 'bili_comments',
        description: '读一个 B 站视频的评论（一级评论，含作者/点赞数/回复数）。适合"观众怎么评价""有没有神评"。分页用 page 参数。',
        parameters: {
            url: { type: 'string', required: true, description: 'B 站链接 / BV 号 / av 号' },
            page: { type: 'number', description: '页码，从 1 开始（默认 1）' },
            sort: { type: 'number', description: '排序：0=按时间 1=按点赞（默认） 2=按回复' },
            pageSize: { type: 'number', description: '每页条数 1~20（默认 20）' },
        },
        output: textOutput(),
        isConcurrencySafe: () => true,
        execute: async (args) => {
            const input = args;
            try {
                const sort = input.sort === 0 || input.sort === 2 ? input.sort : 1;
                const page = await deps.comments.read(input.url, {
                    page: Number(input.page ?? 1),
                    sort,
                    pageSize: Number(input.pageSize ?? 20),
                });
                if (page.items.length === 0)
                    return '【' + page.video.title + '】没有评论（或该视频关闭了评论区）。';
                const lines = page.items.map((item, index) => {
                    const time = new Date(item.ctime * 1000).toLocaleString('zh-CN', { hour12: false });
                    const head = String((page.items.length === 0 ? index : (Number(input.page ?? 1) - 1) * Number(input.pageSize ?? 20) + index + 1)) + '. '
                        + (item.author.name || '匿名') + '（Lv' + String(item.author.level) + '）' + ' 赞' + String(item.like)
                        + (item.replyCount > 0 ? ' 回' + String(item.replyCount) : '') + ' ' + time;
                    const body = item.message.replace(/\n+/g, ' ').slice(0, 200);
                    return head + '\n   rpid=' + String(item.rpid) + ' | ' + body;
                });
                return '【' + page.video.title + '】评论 共 ' + String(page.total) + ' 条，本页 ' + String(page.items.length) + ' 条'
                    + (page.end ? '（已到末页）' : '（下一页 page=' + String(Number(input.page ?? 1) + 1) + '）') + '\n\n'
                    + lines.join('\n');
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                deps.log('warn', '读评论失败: ' + message);
                return '读评论失败：' + message;
            }
        },
    }));
    ctx.tools.register(defineTool({
        name: 'bili_comment_replies',
        description: '读某条评论下的回复（子评论）。需要先通过 bili_comments 拿到 rpid。',
        parameters: {
            url: { type: 'string', required: true, description: 'B 站链接 / BV 号 / av 号' },
            root: { type: 'number', required: true, description: '根评论 id（rpid）' },
            page: { type: 'number', description: '页码（默认 1）' },
        },
        output: textOutput(),
        isConcurrencySafe: () => true,
        execute: async (args) => {
            const input = args;
            try {
                const page = await deps.comments.readReplies(input.url, Number(input.root), Number(input.page ?? 1));
                if (page.items.length === 0)
                    return '这条评论下没有回复。';
                return page.items.map(item => '· ' + (item.author.name || '匿名') + '：' + item.message.replace(/\n+/g, ' ').slice(0, 200)
                    + '（rpid=' + String(item.rpid) + '）').join('\n');
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return '读回复失败：' + message;
            }
        },
    }));
    ctx.tools.register(defineTool({
        name: 'bili_comment',
        description: '【写操作】在视频下发评论，或回复某条评论（传 root）。需要管理员开启「允许写操作」，会真实作用于你的账号。',
        parameters: {
            url: { type: 'string', required: true, description: 'B 站链接 / BV 号 / av 号' },
            message: { type: 'string', required: true, description: '评论内容' },
            root: { type: 'number', description: '要回复的根评论 rpid（可选；不传=发新评论）' },
        },
        output: textOutput(),
        isConcurrencySafe: () => false,
        execute: async (args) => {
            const input = args;
            try {
                const result = await deps.comments.post(input.url, input.message, input.root === undefined ? {} : { root: Number(input.root) });
                let watchNote = '';
                if (deps.autoWatchOwnComments && result.rpid > 0) {
                    try {
                        const watch = deps.watches.add({ bvid: result.video.bvid, root: result.rpid, lastSeenRpid: 0, note: '自己发的评论', max: deps.replyWatchMax });
                        watchNote = '\n已自动盯这条评论（有人回复后调 bili_reply_check 就能看到），监听 id=' + watch.watch.id;
                    }
                    catch (error) {
                        watchNote = '\n（监听登记失败：' + (error instanceof Error ? error.message : String(error)) + '）';
                    }
                }
                return '已发布评论（rpid=' + String(result.rpid) + '）：' + result.video.title
                    + '\n链接：https://www.bilibili.com/video/' + result.video.bvid + watchNote;
            }
            catch (error) {
                return '发评论失败：' + (error instanceof Error ? error.message : String(error));
            }
        },
    }));
    ctx.tools.register(defineTool({
        name: 'bili_like',
        description: '【写操作】给视频点赞或取消点赞。需要开启「允许写操作」。',
        parameters: {
            url: { type: 'string', required: true, description: 'B 站链接 / BV 号 / av 号' },
            off: { type: 'boolean', description: '传 true = 取消点赞（默认点赞）' },
        },
        output: textOutput(),
        isConcurrencySafe: () => false,
        execute: async (args) => {
            const input = args;
            try {
                const result = await deps.comments.like(input.url, input.off !== true);
                return (result.on ? '已点赞：' : '已取消点赞：') + result.video.title;
            }
            catch (error) {
                return '点赞失败：' + (error instanceof Error ? error.message : String(error));
            }
        },
    }));
    ctx.tools.register(defineTool({
        name: 'bili_coin',
        description: '【写操作】给视频投币（1 或 2 枚）。需要开启「允许写操作」。',
        parameters: {
            url: { type: 'string', required: true, description: 'B 站链接 / BV 号 / av 号' },
            count: { type: 'number', description: '投几枚（1 或 2，默认 1）' },
            alsoLike: { type: 'boolean', description: '投币时同时点赞（默认 false）' },
        },
        output: textOutput(),
        isConcurrencySafe: () => false,
        execute: async (args) => {
            const input = args;
            try {
                const result = await deps.comments.coin(input.url, Number(input.count ?? 1), input.alsoLike === true);
                return '已投币 ' + String(result.count) + ' 枚：' + result.video.title;
            }
            catch (error) {
                return '投币失败：' + (error instanceof Error ? error.message : String(error));
            }
        },
    }));
    ctx.tools.register(defineTool({
        name: 'bili_danmaku_send',
        description: '【写操作】给视频发一条弹幕。需要开启「允许写操作」。注意：弹幕会出现在视频画面上，谨慎使用。',
        parameters: {
            url: { type: 'string', required: true, description: 'B 站链接 / BV 号 / av 号' },
            text: { type: 'string', required: true, description: '弹幕内容' },
            at: { type: 'number', description: '出现时间点（秒，默认 1）' },
            mode: { type: 'number', description: '模式：1=滚动（默认） 4=底部 5=顶部' },
        },
        output: textOutput(),
        isConcurrencySafe: () => false,
        execute: async (args) => {
            const input = args;
            try {
                const result = await deps.comments.sendDanmaku(input.url, input.text, {
                    progressSec: Number(input.at ?? 1),
                    ...(input.mode === undefined ? {} : { mode: Number(input.mode) }),
                });
                return '已发送弹幕（' + String(result.progress / 1000) + 's）：' + result.video.title;
            }
            catch (error) {
                return '发弹幕失败：' + (error instanceof Error ? error.message : String(error));
            }
        },
    }));
    // ---- 回复监听（2026-11-05） ----
    ctx.tools.register(defineTool({
        name: 'bili_reply_watch',
        description: '登记/取消/查看"回复监听"：盯住某条评论（rpid）或整个视频的新评论。登记后用 bili_reply_check 拉增量。',
        parameters: {
            action: { type: 'string', required: true, description: 'add=登记 remove=取消 list=查看' },
            url: { type: 'string', description: 'B 站链接 / BV 号（add 时必填）' },
            root: { type: 'number', description: '根评论 rpid（add 时用；0=盯整个视频的新评论）' },
            note: { type: 'string', description: '备注：为什么盯它' },
            id: { type: 'string', description: '监听 id（remove 时必填）' },
        },
        output: textOutput(),
        isConcurrencySafe: () => false,
        execute: async (args) => {
            const input = args;
            const action = input.action.trim();
            if (action === 'list') {
                const items = deps.watches.list();
                if (items.length === 0)
                    return '当前没有回复监听。';
                const now = Date.now();
                return items.map(item => {
                    const left = item.expiresAt > 0
                        ? '（还剩 ' + String(Math.max(0, Math.ceil((item.expiresAt - now) / 86_400_000))) + ' 天）'
                        : '（永久）';
                    return '· ' + item.id + '  ' + item.bvid + (item.root > 0 ? '  rpid=' + String(item.root) : '  整个视频')
                        + (item.note !== '' ? '  「' + item.note + '」' : '') + '  已见 ' + String(item.lastSeenRpid) + ' ' + left;
                }).join('\n');
            }
            if (action === 'remove') {
                if (input.id === undefined || input.id.trim() === '')
                    return 'remove 需要 id。';
                return deps.watches.remove(input.id.trim()) ? '已取消监听 ' + input.id : '没有这个监听：' + input.id;
            }
            if (action === 'add') {
                if (input.url === undefined || input.url.trim() === '')
                    return 'add 需要 url。';
                try {
                    const info = await client.resolve(input.url);
                    const root = Math.max(0, Math.round(Number(input.root ?? 0)));
                    // 已存在时以当前最大 rpid 作为游标，避免把历史回复全算成新的
                    let baseline = 0;
                    if (root > 0) {
                        const replies = await deps.comments.readReplies(input.url, root, 1);
                        baseline = replies.items.reduce((max, item) => Math.max(max, item.rpid), 0);
                    }
                    else {
                        const page = await deps.comments.read(input.url, { page: 1, sort: 0, pageSize: 20 });
                        baseline = page.items.reduce((max, item) => Math.max(max, item.rpid), 0);
                    }
                    const result = deps.watches.add({ bvid: info.bvid, root, lastSeenRpid: baseline, max: deps.replyWatchMax, ...(input.note === undefined ? {} : { note: input.note }) });
                    return (result.created ? '已登记监听：' : '这个目标已经在监听里：') + result.watch.id
                        + '\n目标：' + info.title + '\n' + (root > 0 ? '回复某条评论 rpid=' + String(root) : '整个视频的新评论')
                        + '\n基线 rpid=' + String(baseline);
                }
                catch (error) {
                    return '登记监听失败：' + (error instanceof Error ? error.message : String(error));
                }
            }
            return '不认识的 action：' + action + '（用 add / remove / list）';
        },
    }));
    ctx.tools.register(defineTool({
        name: 'bili_reply_check',
        description: '检查所有回复监听，返回自上次以来新增的回复/评论（并推进游标）。只在你被问到时才需要调用。',
        parameters: {
            id: { type: 'string', description: '只检查这一条监听（可选）' },
        },
        output: textOutput(),
        isConcurrencySafe: () => false,
        execute: async (args) => {
            const input = args;
            try {
                const results = await checkReplyWatches({
                    watches: deps.watches,
                    comments: deps.comments,
                    log: deps.log,
                    ...(input.id === undefined ? {} : { only: input.id.trim() }),
                });
                if (results.length === 0)
                    return '没有需要检查的监听。';
                const lines = [];
                for (const result of results) {
                    if (result.error !== undefined) {
                        lines.push('· ' + result.watch.id + ' 检查失败' + (result.removed === true ? '（已自动清理）' : '：' + result.error));
                        continue;
                    }
                    if (result.items.length === 0) {
                        lines.push('· ' + result.watch.id + '（' + result.watch.bvid + '）没有新回复');
                        continue;
                    }
                    lines.push('· ' + result.watch.id + '（' + result.watch.bvid + '）新增 ' + String(result.items.length) + ' 条：');
                    for (const item of result.items.slice(0, 10)) {
                        lines.push('   · ' + (item.author.name || '匿名') + '：' + item.message.replace(/\n+/g, ' ').slice(0, 120) + '（rpid=' + String(item.rpid) + '）');
                    }
                }
                return lines.join('\n');
            }
            catch (error) {
                return '检查失败：' + (error instanceof Error ? error.message : String(error));
            }
        },
    }));
}
