import { defineTool } from '@deepseek-ai/dsh-tools';
import { danmakuText } from './danmaku.js';
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
    const { storyboard } = deps;
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
}
