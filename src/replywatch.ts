/**
 * 评论回复监听（2026-11-05）。
 *
 * 用途：盯住某条评论（或某个视频的新评论），有人回复就报告出来。
 *
 * 设计取舍：**不做后台常驻轮询**，改成"登记监听 + 按需检查"——
 *   登记：watch add <url> <rpid>
 *   检查：watch check（遍历所有监听，拉新回复，返回增量并推进游标）
 * 这样不会在没有渠道投递的情况下偷偷打 B 站接口，也不会被宿主生命周期影响。
 * 需要定时的话，由调用方（napcat 的定时任务 / 会话）周期性调 check 即可。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface ReplyWatch {
  /** 监听 id（稳定，用于取消） */
  id: string
  /** 视频（BV 号）：每次检查都要用它重新解析 aid */
  bvid: string
  /** 根评论 rpid（0 = 监听整个视频的新评论） */
  root: number
  /** 已见到的最大 rpid（用于判断增量） */
  lastSeenRpid: number
  /** 备注（谁让盯的、为什么） */
  note: string
  createdAt: number
  lastCheckAt: number
  /** 到期时间戳（0 = 永不过期） */
  expiresAt: number
  /** 连续检查失败次数（评论被删等），达到阈值自动清理 */
  failures: number
}

export interface ReplyWatchStoreOptions {
  file: string
  /** 登记后保留多少天（0 = 永不过期） */
  keepDays?: number
  /** 连续失败几次自动清理 */
  maxFailures?: number
  log?: (level: 'debug' | 'info' | 'warn', message: string) => void
}

const DAY_MS = 86_400_000

export class ReplyWatchStore {
  private readonly options: ReplyWatchStoreOptions
  private items: ReplyWatch[] = []
  private loaded = false

  constructor(options: ReplyWatchStoreOptions) {
    this.options = options
  }

  private load(): void {
    if (this.loaded) return
    this.loaded = true
    if (!existsSync(this.options.file)) return
    try {
      const parsed = JSON.parse(readFileSync(this.options.file, 'utf8')) as unknown
      if (Array.isArray(parsed)) {
        this.items = parsed.filter(item => typeof item === 'object' && item !== null) as ReplyWatch[]
      }
    } catch (error) {
      this.options.log?.('warn', '读监听表失败（忽略）: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.options.file), { recursive: true })
      writeFileSync(this.options.file, JSON.stringify(this.items, null, 2), 'utf8')
    } catch (error) {
      this.options.log?.('warn', '写监听表失败: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  list(): ReplyWatch[] {
    this.load()
    return [...this.items]
  }

  find(id: string): ReplyWatch | undefined {
    this.load()
    return this.items.find(item => item.id === id)
  }

  /** 同一个 (bvid, root) 已存在时直接返回旧的，不重复登记 */
  add(input: { bvid: string; root: number; lastSeenRpid?: number; note?: string; max: number }): { watch: ReplyWatch; created: boolean } {
    this.load()
    this.prune()
    const existing = this.items.find(item => item.bvid === input.bvid && item.root === input.root)
    if (existing !== undefined) return { watch: existing, created: false }
    if (this.items.length >= input.max) throw new Error('监听数量已达上限（' + String(input.max) + '），先取消一些')
    const watch: ReplyWatch = {
      id: 'w' + String(Date.now()).slice(-8) + String(this.items.length),
      bvid: input.bvid,
      root: input.root,
      lastSeenRpid: input.lastSeenRpid ?? 0,
      note: input.note ?? '',
      createdAt: Date.now(),
      lastCheckAt: 0,
      expiresAt: (this.options.keepDays ?? 0) > 0 ? Date.now() + (this.options.keepDays ?? 0) * DAY_MS : 0,
      failures: 0,
    }
    this.items.push(watch)
    this.save()
    return { watch, created: true }
  }

  remove(id: string): boolean {
    this.load()
    const index = this.items.findIndex(item => item.id === id)
    if (index < 0) return false
    this.items.splice(index, 1)
    this.save()
    return true
  }

  touch(id: string, lastSeenRpid: number): void {
    this.load()
    const watch = this.items.find(item => item.id === id)
    if (watch === undefined) return
    watch.lastSeenRpid = Math.max(watch.lastSeenRpid, lastSeenRpid)
    watch.lastCheckAt = Date.now()
    watch.failures = 0
    this.save()
  }

  /** 记一次检查失败；连续失败到阈值就自动清掉（评论被删/视频删档） */
  markFailure(id: string): { removed: boolean; failures: number } {
    this.load()
    const watch = this.items.find(item => item.id === id)
    if (watch === undefined) return { removed: false, failures: 0 }
    watch.failures = (watch.failures ?? 0) + 1
    watch.lastCheckAt = Date.now()
    const limit = this.options.maxFailures ?? 3
    if (watch.failures >= limit) {
      this.items = this.items.filter(item => item.id !== id)
      this.save()
      return { removed: true, failures: watch.failures }
    }
    this.save()
    return { removed: false, failures: watch.failures }
  }

  /** 清理过期监听；返回被清掉的 id */
  prune(now = Date.now()): string[] {
    this.load()
    const removed = this.items.filter(item => item.expiresAt > 0 && item.expiresAt <= now).map(item => item.id)
    if (removed.length === 0) return []
    this.items = this.items.filter(item => !(item.expiresAt > 0 && item.expiresAt <= now))
    this.save()
    this.options.log?.('info', '已清理过期监听 ' + String(removed.length) + ' 条')
    return removed
  }
}
