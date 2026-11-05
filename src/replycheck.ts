/**
 * 回复监听的"检查"逻辑（2026-11-05）。
 *
 * 抽出成独立函数，让两个消费者共用同一份游标：
 *   - 模型侧工具 bili_reply_check（按需查）
 *   - 渠道侧（napcat）定时查 → 只发管理员私聊
 * 共享游标的意义：谁查过就不会重复报给另一边。
 */
import type { CommentClient, CommentItem } from './comments.js'
import type { ReplyWatch, ReplyWatchStore } from './replywatch.js'

export interface ReplyCheckResult {
  watch: ReplyWatch
  /** 自上次以来的新增（最多 20 条） */
  items: CommentItem[]
  /** 失败信息（评论被删 / 风控 / 网络） */
  error?: string
  /** 这次失败是否触发了自动清理 */
  removed?: boolean
}

export interface ReplyCheckOptions {
  watches: ReplyWatchStore
  comments: CommentClient
  log?: (level: 'debug' | 'info' | 'warn', message: string) => void
  /** 只看这一条监听 */
  only?: string
}

/** 检查所有（或指定）监听，推进游标，返回增量 */
export async function checkReplyWatches(options: ReplyCheckOptions): Promise<ReplyCheckResult[]> {
  const all = options.watches.list()
  const targets = options.only === undefined || options.only === ''
    ? all
    : all.filter(item => item.id === options.only)
  const results: ReplyCheckResult[] = []
  for (const watch of targets) {
    try {
      const items: CommentItem[] = []
      let newest = watch.lastSeenRpid
      if (watch.root > 0) {
        const page = await options.comments.readReplies(watch.bvid, watch.root, 1, { fromEnd: true })
        for (const item of page.items) {
          if (item.rpid <= watch.lastSeenRpid) continue
          newest = Math.max(newest, item.rpid)
          items.push(item)
        }
      } else {
        const page = await options.comments.read(watch.bvid, { page: 1, sort: 0, pageSize: 20 })
        for (const item of page.items) {
          if (item.rpid <= watch.lastSeenRpid) continue
          newest = Math.max(newest, item.rpid)
          items.push(item)
        }
      }
      options.watches.touch(watch.id, newest)
      // 按时间正序（旧→新）更像聊天记录
      items.sort((a, b) => a.ctime - b.ctime)
      results.push({ watch, items })
    } catch (error) {
      const outcome = options.watches.markFailure(watch.id)
      options.log?.('warn', '回复监听检查失败 ' + watch.id + '：' + (error instanceof Error ? error.message : String(error)))
      results.push({
        watch,
        items: [],
        error: error instanceof Error ? error.message : String(error),
        ...(outcome.removed ? { removed: true } : {}),
      })
    }
  }
  return results
}

/** 把增量格式化成一段人可读的文本（私聊通知用） */
export function formatReplyCheck(results: ReplyCheckResult[], options: { max?: number; title?: string } = {}): string {
  const max = options.max ?? 5
  const lines: string[] = []
  let total = 0
  for (const result of results) {
    if (result.items.length === 0) continue
    total += result.items.length
    const head = options.title !== undefined && options.title !== ''
      ? options.title
      : '你监听的评论有新回复'
    lines.push('【' + head + '】' + result.watch.bvid + (result.watch.root > 0 ? '  rpid=' + String(result.watch.root) : ''))
    for (const item of result.items.slice(0, max)) {
      lines.push('· ' + (item.author.name || '匿名') + '：' + item.message.replace(/\n+/g, ' ').slice(0, 120))
    }
    if (result.items.length > max) lines.push('… 还有 ' + String(result.items.length - max) + ' 条')
  }
  if (lines.length === 0) return ''
  return lines.join('\n') + '\n（https://www.bilibili.com/video/' + (results.find(result => result.items.length > 0)?.watch.bvid ?? '') + '）'
}
