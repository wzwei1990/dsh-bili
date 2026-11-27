/**
 * 配置面：全部 volatile（改设置不重载插件），与 dsh-napcat 的做法一致。
 */
import z from '@deepseek-ai/schemastery';
// 不加 Z<ConfigShape> 注解：.volatile() 会把字段推断成 Volatile<T>，强注解反而报错（与 dsh-napcat 一致的做法）
export const Config = z.object({
    sessdata: z.string().role('secret').default('')
        .description('B 站 SESSDATA（可选；从浏览器 cookie 里取，公开视频不填也能解析，但部分字幕需要登录）').volatile(),
    cookieFile: z.string().default('')
        .description('cookie 文件路径（留空=~/.dsh/dsh-bili/cookie.txt，存在则优先）').volatile(),
    allowWrite: z.boolean().default(false)
        .description('允许写操作（发评论/点赞/投币/发弹幕）；默认关闭，开启后会真实操作你的账号').volatile(),
    writePerHour: z.natural().min(1).max(60).default(5)
        .description('每小时最多写几次（风控保护）').volatile(),
    writeCooldownMinutes: z.natural().min(1).max(240).default(30)
        .description('命中风控后冷却多少分钟').volatile(),
    commentCacheMinutes: z.natural().max(120).default(3)
        .description('评论读取缓存分钟（0=不缓存）').volatile(),
    replyWatchMax: z.natural().min(1).max(100).default(20)
        .description('回复监听最多登记几条').volatile(),
    autoWatchOwnComments: z.boolean().default(true)
        .description('发完评论自动登记监听，有人回复时 bili_reply_check 能抓到').volatile(),
    replyWatchDays: z.natural().max(365).default(7)
        .description('监听保留天数（0=永不过期）；过期自动清理').volatile(),
    timeoutMs: z.natural().min(3000).max(120000).default(15000)
        .description('单次请求超时（毫秒）').volatile(),
    storyboard: z.boolean().default(true)
        .description('抽帧做分镜图（画面兜底）').volatile(),
    storyboardFrames: z.natural().default(9)
        .description('分镜帧数（4/9/16）').volatile(),
    maxStoryboardMinutes: z.natural().default(30)
        .description('超过这个时长不抽帧（分钟，0=不限）').volatile(),
    ffmpegPath: z.string().default('')
        .description('ffmpeg 路径（留空=自动探测 PATH/常见位置）').volatile(),
    ytdlpPath: z.string().default('')
        .description('yt-dlp 路径（留空=自动探测；只用于非 B 站链接）').volatile(),
    searchCacheMinutes: z.natural().default(5)
        .description('搜索/UP 结果缓存（分钟）').volatile(),
    subtitleMaxChars: z.natural().default(6000)
        .description('字幕正文最多返回多少字符（超出截断）').volatile(),
    cacheTtlMinutes: z.natural().default(1440)
        .description('视频信息与字幕缓存有效期（分钟，0=不缓存）').volatile(),
    douyinMaxHeight: z.natural().default(720)
        .description('抖音下载分辨率上限（默认 720p）').volatile(),
    douyinMaxMinutes: z.natural().default(10)
        .description('抖音视频最大时长（分钟，超过拒绝下载）').volatile(),
    amagiBaseUrl: z.string().default('')
        .description('amagi 服务地址（如 http://amagi:4567）：抖音解析优先走它；B 站 CDN 风控时作为兜底').volatile(),
    amagiDouyinCookies: z.string().role('secret').default('')
        .description('amagi 抖音 cookie（可选；随请求下发，不需要在服务器 .env 里配）').volatile(),
    amagiBilibiliCookies: z.string().role('secret').default('')
        .description('amagi B 站 cookie（可选；留空=复用 dsh-bili 自己的 B 站 cookie，随请求下发）').volatile(),
    douyinCookiesFile: z.string().default('')
        .description('抖音 cookies.txt 路径（仅 yt-dlp 路径需要；amagi 不需要）').volatile(),
    logLevel: z.union([z.const('debug'), z.const('info'), z.const('warn')]).default('info')
        .description('日志级别').volatile(),
});
export const DEFAULTS = {
    sessdata: '',
    cookieFile: '',
    allowWrite: false,
    writePerHour: 5,
    writeCooldownMinutes: 30,
    commentCacheMinutes: 3,
    replyWatchMax: 20,
    autoWatchOwnComments: true,
    replyWatchDays: 7,
    timeoutMs: 15000,
    storyboard: true,
    storyboardFrames: 9,
    maxStoryboardMinutes: 30,
    ffmpegPath: '',
    ytdlpPath: '',
    searchCacheMinutes: 5,
    subtitleMaxChars: 6000,
    cacheTtlMinutes: 1440,
    douyinMaxHeight: 720,
    douyinMaxMinutes: 10,
    amagiBaseUrl: '',
    amagiDouyinCookies: '',
    amagiBilibiliCookies: '',
    douyinCookiesFile: '',
    logLevel: 'info',
};
/** 取活值：volatile 引用调 get()，普通值原样返回。 */
export function readVolatile(value) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value === 'object' && typeof value.get === 'function') {
        return value.get();
    }
    return value;
}
const STRING_KEYS = new Set([
    'sessdata', 'cookieFile', 'ffmpegPath', 'ytdlpPath', 'amagiBaseUrl',
    'amagiDouyinCookies', 'amagiBilibiliCookies', 'douyinCookiesFile',
]);
const BOOLEAN_KEYS = new Set(['allowWrite', 'autoWatchOwnComments', 'storyboard']);
/**
 * 配置代理：每次读字段都从 volatile 引用取当前值。
 * 这样设置页保存后**不用重启插件**，amagiBaseUrl / 抖音参数等立即生效。
 */
export function resolveConfig(input, overrides = {}) {
    const source = (input ?? {});
    const base = { ...DEFAULTS };
    return new Proxy(base, {
        get(target, prop, receiver) {
            if (typeof prop !== 'string' || !(prop in DEFAULTS))
                return Reflect.get(target, prop, receiver);
            const key = prop;
            const override = overrides[key];
            if (typeof override === 'function') {
                const live = override();
                if (live !== '')
                    return live;
            }
            else if (typeof override === 'string' && override !== '') {
                return override;
            }
            const value = readVolatile(source[prop]);
            if (value === undefined || value === null)
                return target[key];
            if (key === 'logLevel') {
                return value === 'debug' || value === 'info' || value === 'warn' ? value : target.logLevel;
            }
            if (key === 'sessdata' || STRING_KEYS.has(key))
                return String(value);
            if (BOOLEAN_KEYS.has(key))
                return Boolean(value);
            const numeric = Number(value);
            return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : target[key];
        },
    });
}
