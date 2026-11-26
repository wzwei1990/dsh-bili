/**
 * 配置面：全部 volatile（改设置不重载插件），与 dsh-napcat 的做法一致。
 */
import z from '@deepseek-ai/schemastery'

export interface ConfigShape {
  /** B 站登录 Cookie 里的 SESSDATA（可选：字幕/更高频接口需要，公开视频信息不需要） */
  sessdata: string
  /** cookie 文件路径（留空=~/.dsh/dsh-bili/cookie.txt）；文件存在时优先于 sessdata */
  cookieFile: string
  /** 允许写操作（评论/点赞/投币/弹幕）；默认关闭 */
  allowWrite: boolean
  /** 每小时最多几次写操作 */
  writePerHour: number
  /** 命中风控后的冷却分钟数 */
  writeCooldownMinutes: number
  /** 评论读取缓存（分钟，0=不缓存） */
  commentCacheMinutes: number
  /** 回复监听最多登记几条 */
  replyWatchMax: number
  /** 发完评论自动盯它（有人回复就能被 bili_reply_check 抓到） */
  autoWatchOwnComments: boolean
  /** 监听保留多少天（0=永不过期） */
  replyWatchDays: number
  /** 单次 HTTP 超时（毫秒） */
  timeoutMs: number
  /** 字幕正文最多返回多少字符（太长会撑爆上下文，超出截断并在文本里标注） */
  /** 搜索/UP 结果缓存（分钟） */
  searchCacheMinutes: number
  /** 订阅轮询总开关 */
  /** 轮询间隔（分钟，最小 5） */
  /** 订阅数量上限 */
  /** 默认订阅类型（逗号分隔：video,dynamic） */
  subtitleMaxChars: number
  /** 是否抽帧做分镜图（默认开；超长视频会跳过） */
  storyboard: boolean
  /** 分镜帧数（4/9/16） */
  storyboardFrames: number
  /** 超过这个时长就不抽帧（分钟，0=不限） */
  maxStoryboardMinutes: number
  /** ffmpeg 路径（空=自动探测） */
  ffmpegPath: string
  /** yt-dlp 路径（空=自动探测；只用于非 B 站链接） */
  ytdlpPath: string
  /** 视频信息/字幕缓存有效期（分钟，0=不缓存） */
  cacheTtlMinutes: number
  /** 抖音下载分辨率上限（默认 720） */
  douyinMaxHeight: number
  /** 抖音视频最大时长（分钟，超过拒绝） */
  douyinMaxMinutes: number
  /** amagi 服务地址（抖音解析；空=只用 yt-dlp） */
  amagiBaseUrl: string
  /** 抖音 cookies.txt（yt-dlp 路径用，可选） */
  douyinCookiesFile: string
  /** 日志级别 */
  logLevel: 'debug' | 'info' | 'warn'
}

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
  douyinCookiesFile: z.string().default('')
    .description('抖音 cookies.txt 路径（仅 yt-dlp 路径需要；amagi 不需要）').volatile(),
  logLevel: z.union([z.const('debug'), z.const('info'), z.const('warn')]).default('info')
    .description('日志级别').volatile(),
})

export const DEFAULTS: ConfigShape = {
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
  douyinCookiesFile: '',
  logLevel: 'info',
}

/** volatile 字段在运行时是 `{ get(): T }` 的稳定引用（cosmokit 的 Volatile）。 */
interface VolatileRef<T> {
  get(): T
}

/** 取活值：volatile 引用调 get()，普通值原样返回。 */
export function readVolatile<T>(value: unknown): T | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'object' && typeof (value as VolatileRef<T>).get === 'function') {
    return (value as VolatileRef<T>).get()
  }
  return value as T
}

const STRING_KEYS = new Set<keyof ConfigShape>([
  'sessdata', 'cookieFile', 'ffmpegPath', 'ytdlpPath', 'amagiBaseUrl', 'douyinCookiesFile',
])
const BOOLEAN_KEYS = new Set<keyof ConfigShape>(['allowWrite', 'autoWatchOwnComments', 'storyboard'])

/**
 * 配置代理：每次读字段都从 volatile 引用取当前值。
 * 这样设置页保存后**不用重启插件**，amagiBaseUrl / 抖音参数等立即生效。
 */
export function resolveConfig(input: Partial<ConfigShape> | undefined): ConfigShape {
  const source = (input ?? {}) as Record<string, unknown>
  const base: ConfigShape = { ...DEFAULTS }
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string' || !(prop in DEFAULTS)) return Reflect.get(target, prop, receiver)
      const key = prop as keyof ConfigShape
      const value = readVolatile<unknown>(source[prop])
      if (value === undefined || value === null) return target[key]
      if (key === 'logLevel') {
        return value === 'debug' || value === 'info' || value === 'warn' ? value : target.logLevel
      }
      if (key === 'sessdata' || STRING_KEYS.has(key)) return String(value)
      if (BOOLEAN_KEYS.has(key)) return Boolean(value)
      const numeric = Number(value)
      return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : target[key]
    },
  }) as ConfigShape
}
