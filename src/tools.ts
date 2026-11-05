/**
 * 模型侧工具：bili_read（一次拿全「视频信息 + 字幕」）、bili_subtitle、bili_card。
 *
 * 设计：工具只负责"取到内容"，总结交给模型 —— 这样模型能按群聊语气自由发挥。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { BiliClient, VideoInfo } from './bili.js'
import { danmakuText } from './danmaku.js'
import type { StoryboardService } from './services.js'
import type { SearchClient } from './search.js'

export interface ToolDeps {
  subtitleMaxChars: number
  storyboard: StoryboardService
  search: SearchClient
  log: (level: 'debug' | 'info' | 'warn', message: string) => void
}

/** 文本输出工具的统一 shape（与 dsh-napcat 一致）。 */
function textOutput() {
  return {
    schema: { type: 'string' as const },
    render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
  }
}

function durationText(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s)
}

function statText(info: VideoInfo): string {
  const fmt = (value: number): string => value >= 10000 ? (value / 10000).toFixed(1) + '万' : String(value)
  return '播放 ' + fmt(info.stats.view) + ' · 弹幕 ' + fmt(info.stats.danmaku) + ' · 点赞 ' + fmt(info.stats.like)
}

/** 把视频信息 + 字幕拼成给模型读的文本。 */
export function digestOf(info: VideoInfo, subtitle: string, truncated: boolean): string {
  const lines: string[] = []
  lines.push('【B站视频】' + info.title)
  lines.push('UP主：' + info.up + '　时长：' + durationText(info.durationSec) + '　' + statText(info))
  lines.push('链接：' + info.pageUrl)
  if (info.desc.trim() !== '') lines.push('简介：' + info.desc.trim().slice(0, 300))
  if (subtitle.trim() === '') {
    lines.push('')
    lines.push('（这个视频没有可用字幕：UP 没上传 CC，或需要登录才能看。只能依据标题/简介来判断；想要画面级理解得靠 ASR，暂未支持。）')
  } else {
    lines.push('')
    lines.push('【字幕正文' + (truncated ? '（已截断）' : '') + '】')
    lines.push(subtitle)
  }
  return lines.join('\n')
}

export function registerTools(ctx: Context, client: BiliClient, deps: ToolDeps): void {
  const { storyboard, search } = deps
  ctx.tools.register(defineTool({
    name: 'bili_read',
    description: '读取一个 B 站视频：返回标题、UP主、时长、播放量、简介和字幕正文（供你总结/回答）。支持 BV 号、av 号、b23.tv 短链，或任何包含链接的文本。',
    parameters: {
      url: { type: 'string', required: true, description: 'B 站链接 / BV 号 / av 号，或含链接的一段话' },
      max_chars: { type: 'number', description: '字幕最多返回多少字符（默认按配置 6000）' },
    },
    output: textOutput(),
    isConcurrencySafe: () => true,
    execute: async args => {
      const input = args as { url: string; max_chars?: number }
      const maxChars = Number.isFinite(Number(input.max_chars)) ? Number(input.max_chars) : deps.subtitleMaxChars
      const info = await client.resolve(input.url)
      try {
        const subtitle = await client.readSubtitle(input.url, { maxChars })
        return digestOf(info, subtitle.text, subtitle.truncated)
      } catch (error) {
        deps.log('warn', '读字幕失败（只返回视频信息）: ' + (error instanceof Error ? error.message : String(error)))
        return digestOf(info, '', false)
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'bili_subtitle',
    description: '只取 B 站视频的字幕正文（带 [mm:ss] 时间戳段落）。视频没字幕时返回一句说明。',
    parameters: {
      url: { type: 'string', required: true, description: 'B 站链接 / BV 号 / av 号' },
      max_chars: { type: 'number', description: '最多返回多少字符' },
    },
    output: textOutput(),
    isConcurrencySafe: () => true,
    execute: async args => {
      const input = args as { url: string; max_chars?: number }
      const maxChars = Number.isFinite(Number(input.max_chars)) ? Number(input.max_chars) : deps.subtitleMaxChars
      const subtitle = await client.readSubtitle(input.url, { maxChars })
      if (subtitle.text.trim() === '') return '这个视频没有可用字幕（UP 未上传 CC，或需要登录）。'
      return subtitle.text
    },
  }))

  ctx.tools.register(defineTool({
    name: 'bili_danmaku',
    description: '读一个 B 站视频的弹幕概况：总条数、最密集的时段（高光/名场面）、被反复刷的弹幕。免登录可用，适合"这视频哪里最精彩/观众怎么评价"。',
    parameters: {
      url: { type: 'string', required: true, description: 'B 站链接 / BV 号 / av 号' },
      page: { type: 'number', description: '分P 的 cid（可选，默认第 1 P）' },
    },
    output: textOutput(),
    isConcurrencySafe: () => true,
    execute: async args => {
      const input = args as { url: string; page?: number }
      try {
        const { info, summary } = await client.danmaku(input.url, Number.isFinite(Number(input.page)) ? { cid: Number(input.page) } : {})
        return '【' + info.title + '】 ' + info.up + ' · ' + durationText(info.durationSec) + '\n'
          + danmakuText(summary, info.durationSec, info.pageUrl)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        deps.log('warn', '读弹幕失败: ' + message)
        return '读弹幕失败：' + message
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'bili_storyboard',
    description: '给一个 B 站视频（或其它网站链接 / 本地视频文件）抽 9 帧拼成一张分镜图，附时间轴与音频响度条。用于"看一下画面里是什么"。需要 ffmpeg；非 B 站链接还需要 yt-dlp。',
    parameters: {
      url: { type: 'string', required: true, description: 'B 站链接 / 任意视频链接 / 本地视频文件路径' },
    },
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async args => {
      const input = args as { url: string }
      try {
        const result = await storyboard.build(input.url)
        const lines = [
          '【分镜】' + result.title,
          '来源：' + result.source + ' · 时长 ' + durationText(result.durationSec) + ' · 波形' + (result.withWaveform ? '有' : '无'),
          '时间轴：' + result.timeline.map((t: { index: number; label: string }) => '#' + String(t.index) + ' ' + t.label).join('  '),
          '图片：' + result.imagePath,
        ]
        return lines.join('\n')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        deps.log('warn', '分镜失败: ' + message)
        const hint = message.includes('412') || message.includes('风控')
          ? '\n提示：B站对机房/云服务器 IP 风控较严，配置 SESSDATA（登录态）后基本可绕过。'
          : message.includes('yt-dlp')
            ? '\n提示：非 B 站链接需要 yt-dlp；检查是否已安装并在 PATH 里。'
            : ''
        return '分镜失败：' + message + hint
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'bili_doctor',
    description: '自检：B 站登录状态（SESSDATA 是否有效）+ ffmpeg/yt-dlp 是否可用。字幕读不到、分镜生成失败时先跑这个。',
    parameters: {},
    output: textOutput(),
    isConcurrencySafe: () => true,
    execute: async () => {
      const lines: string[] = []
      try {
        const login = await client.loginState()
        if (!login.configured) {
          lines.push('B站登录：未配置 SESSDATA（视频信息/弹幕仍可用；字幕大概率拿不到）')
        } else if (login.isLogin !== true && client.cookieShape !== undefined) {
          lines.push('B站登录：❌ SESSDATA 无效或已过期（' + (login.message ?? '未知原因') + '）')
          lines.push('  cookie 形态：' + client.cookieShape)
        } else if (login.isLogin) {
          lines.push('B站登录：✅ 有效（' + (login.uname ?? '?') + '，uid ' + String(login.mid ?? '?') + '，Lv' + String(login.level ?? '?' ) + '）')
        } else {
          lines.push('B站登录：❌ SESSDATA 无效或已过期（' + (login.message ?? '未知原因') + '）')
          lines.push('  处理：浏览器登录 bilibili.com → F12 → Application → Cookies → 复制 SESSDATA 的值（只要值，不要整段 cookie）')
        }
      } catch (error) {
        lines.push('B站登录：检查失败 — ' + (error instanceof Error ? error.message : String(error)))
      }
      try {
        const deps = await storyboard.depsStatus()
        lines.push('ffmpeg：' + (deps.ffmpeg ?? '未找到（分镜不可用）'))
        lines.push('ffprobe：' + (deps.ffprobe ?? '未找到'))
        lines.push('yt-dlp：' + (deps.ytdlp ?? '未找到（非 B 站链接不可用；B 站不需要它）'))
        lines.push('分镜字体：' + (deps.font ?? '没有可用字体（分镜不带时间戳文字）'))
      } catch (error) {
        lines.push('依赖检查失败 — ' + (error instanceof Error ? error.message : String(error)))
      }
      return lines.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'bili_card',
    description: '取一个 B 站视频的分享卡片信息（标题/UP主/时长/封面/链接），用于在聊天里分享。',
    parameters: {
      url: { type: 'string', required: true, description: 'B 站链接 / BV 号 / av 号' },
    },
    output: textOutput(),
    isConcurrencySafe: () => true,
    execute: async args => {
      const input = args as { url: string }
      const card = await client.card(input.url)
      return [
        '标题：' + card.title,
        'UP主：' + card.up,
        '时长：' + durationText(card.durationSec),
        '链接：' + card.pageUrl,
        '封面：' + card.cover,
      ].join('\n')
    },
  }))
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
    execute: async args => {
      const input = args as { query: string; page?: number; order?: string; duration?: number }
      try {
        const order = ['totalrank', 'click', 'pubdate', 'dm', 'stow'].includes(String(input.order)) ? input.order as 'totalrank' | 'click' | 'pubdate' | 'dm' | 'stow' : undefined
        const duration = [0, 1, 2, 3, 4].includes(Number(input.duration)) ? Number(input.duration) as 0 | 1 | 2 | 3 | 4 : undefined
        const result = await search.search(input.query, {
          ...(Number.isFinite(Number(input.page)) ? { page: Number(input.page) } : {}),
          ...(order === undefined ? {} : { order }),
          ...(duration === undefined ? {} : { duration }),
        })
        if (result.hits.length === 0) return '没有搜到结果：' + input.query
        const lines = ['搜索「' + input.query + '」共 ' + result.total + ' 条，第 ' + result.page + ' 页：']
        for (const hit of result.hits.slice(0, 10)) {
          lines.push('· ' + hit.title + '（' + hit.up + ' · ' + durationText(hit.durationSec) + ' · ' + String(hit.play) + ' 播放）')
          lines.push('  ' + hit.url)
        }
        return lines.join('\n')
      } catch (error) {
        return '搜索失败：' + (error instanceof Error ? error.message : String(error))
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'bili_up',
    description: '查一个 UP 主：名字或 mid 都能用，返回粉丝数、简介和最近 5 个投稿。',
    parameters: {
      target: { type: 'string', required: true, description: 'UP 名字或 mid' },
    },
    output: textOutput(),
    isConcurrencySafe: () => true,
    execute: async args => {
      const input = args as { target: string }
      try {
        const info = await search.resolveUp(input.target)
        const videos = await search.upVideos(info.mid, 1, 5).catch(() => [])
        const lines = ['【' + info.name + '】mid=' + String(info.mid) + ' · 粉丝 ' + String(info.fans)]
        if (info.sign !== undefined && info.sign !== '') lines.push('简介：' + info.sign)
        lines.push('主页：https://space.bilibili.com/' + String(info.mid))
        if (videos.length > 0) {
          lines.push('最近投稿：')
          for (const video of videos) {
            lines.push('· ' + video.title + '（' + new Date(video.pubdate * 1000).toLocaleDateString('zh-CN') + '）' + video.url)
          }
        }
        return lines.join('\n')
      } catch (error) {
        return '查 UP 失败：' + (error instanceof Error ? error.message : String(error))
      }
    },
  }))

}