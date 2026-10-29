/**
 * 模型侧工具：bili_read（一次拿全「视频信息 + 字幕」）、bili_subtitle、bili_card。
 *
 * 设计：工具只负责"取到内容"，总结交给模型 —— 这样模型能按群聊语气自由发挥。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { BiliClient, VideoInfo } from './bili.js'

export interface ToolDeps {
  subtitleMaxChars: number
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
}
