import { BiliClient } from './bili.js';
import { Config, resolveConfig } from './config.js';
import { registerTools } from './tools.js';
import { StoryboardService } from './services.js';
export { Config };
export const name = 'dsh-bili';
/** 只依赖工具注册表：本插件不碰会话/渠道，符合"能力插件"定位。 */
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
        cookie: config.sessdata.trim() === '' ? '' : 'SESSDATA=' + config.sessdata.trim(),
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
    registerTools(ctx, client, {
        subtitleMaxChars: config.subtitleMaxChars,
        storyboard,
        log,
    });
    // 给通道留一个可选的服务入口：ctx.get('dshBili') 存在时，napcat 之类的插件可以直接调，
    // 不必绕一圈让模型自己拼工具参数。老宿主没有 provide 就静默跳过。
    try {
        const host = ctx;
        host.provide?.('dshBili', {
            resolve: (input) => client.resolve(input),
            subtitle: (input, options) => client.readSubtitle(input, options),
            card: (input) => client.card(input),
            /** 弹幕概况（免登录）：高光时段 + 被反复刷的弹幕，供通道注入"看过"的上下文 */
            danmaku: (input, options) => client.danmaku(input, options),
            /** 分镜：B 站链接 / 其它链接（yt-dlp）/ 本地文件都行 */
            storyboard: (input) => storyboard.build(input),
            depsStatus: () => storyboard.depsStatus(),
        });
    }
    catch {
        log('debug', '宿主不支持 provide(dshBili)，跳过服务注册（工具仍可用）');
    }
    log('info', 'dsh-bili 已加载（B 站链接解析 / 字幕读取' + (config.sessdata.trim() === '' ? '，未登录' : '，已配置 SESSDATA') + '）');
}
