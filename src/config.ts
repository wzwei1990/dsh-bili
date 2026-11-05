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
  logLevel: 'info',
}

/** volatile 字段可能没有默认值，统一内置默认补一遍。 */
export function resolveConfig(input: Partial<ConfigShape> | undefined): ConfigShape {
  const merged: ConfigShape = { ...DEFAULTS }
  const source = input ?? {}
  for (const key of Object.keys(DEFAULTS) as Array<keyof ConfigShape>) {
    const value = (source as Record<string, unknown>)[key as string]
    if (value === undefined || value === null) continue
    if (key === 'logLevel') {
      if (value === 'debug' || value === 'info' || value === 'warn') merged.logLevel = value
      continue
    }
    if (key === 'sessdata') {
      merged.sessdata = String(value)
      continue
    }
    const numeric = Number(value)
    if (Number.isFinite(numeric)) merged[key] = Math.max(0, Math.floor(numeric)) as never
  }
  return merged
}
