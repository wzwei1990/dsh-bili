/**
 * dsh-bili —— 让 DeepSeek Harness 真正"看懂" B 站视频。
 *
 * v0.1 目标（P0）：群里谁丢来一个 B 站链接，能把「标题 / UP 主 / 时长 / 简介 / 字幕正文」
 * 交给模型，让模型自己总结、回答、吐槽。
 *
 * 设计原则（与 dsh-meme 一致：单向、只读、可降级）：
 * - 本插件不依赖任何 IM 插件；通道（dsh-napcat 等）按需消费。
 * - 网络失败、无字幕、接口风控都返回结构化错误，不抛异常炸宿主。
 * - 不写任何第三方仓库的代码，只参考其接口形态。
 */
import type { Context } from '@deepseek-ai/cordis'

import { BiliClient } from './bili.js'
import { Config, resolveConfig, type ConfigShape } from './config.js'
import { registerTools } from './tools.js'

export { Config }

export const name = 'dsh-bili'

/** 只依赖工具注册表：本插件不碰会话/渠道，符合"能力插件"定位。 */
export const inject = ['tools']

const LEVEL_RANK = { debug: 0, info: 1, warn: 2 } as const
type Level = keyof typeof LEVEL_RANK

export function apply(ctx: Context, rawConfig: ConfigShape): void {
  const config = resolveConfig(rawConfig)
  const threshold = LEVEL_RANK[config.logLevel] ?? 1
  const log = (level: Level, message: string): void => {
    if ((LEVEL_RANK[level] ?? 1) < threshold) return
    const line = '[dsh-bili] ' + message
    if (level === 'warn') console.warn(line)
    else console.log(line)
  }

  const client = new BiliClient({
    cookie: config.sessdata.trim() === '' ? '' : 'SESSDATA=' + config.sessdata.trim(),
    timeoutMs: config.timeoutMs,
    cacheTtlMs: Math.max(0, config.cacheTtlMinutes) * 60_000,
    log,
  })

  registerTools(ctx, client, {
    subtitleMaxChars: config.subtitleMaxChars,
    log,
  })

  // 给通道留一个可选的服务入口：ctx.get('dshBili') 存在时，napcat 之类的插件可以直接调，
  // 不必绕一圈让模型自己拼工具参数。老宿主没有 provide 就静默跳过。
  try {
    const host = ctx as unknown as { provide?: (name: string, value: unknown) => void }
    host.provide?.('dshBili', {
      resolve: (input: string) => client.resolve(input),
      subtitle: (input: string, options?: { maxChars?: number }) => client.readSubtitle(input, options),
      card: (input: string) => client.card(input),
    })
  } catch {
    log('debug', '宿主不支持 provide(dshBili)，跳过服务注册（工具仍可用）')
  }

  log('info', 'dsh-bili 已加载（B 站链接解析 / 字幕读取' + (config.sessdata.trim() === '' ? '，未登录' : '，已配置 SESSDATA') + '）')
}
