/**
 * 订阅存储与轮询（2026-11-05）。
 *
 * 设计要点（与用户确认）：
 *   - **解耦**：dsh-bili 只负责"发现新内容并写进 outbox"，谁想推谁自己来取；
 *     没有 napcat 也照样工作（模型可用 bili_pending 工具读到）。
 *   - **落盘**：订阅表与 outbox 都是文件（~/.dsh/dsh-bili/），重启不丢、可手工检查。
 *   - **不依赖事件总线**：消费方拉取，避免"没人监听就丢消息"。
 *   - **风控优先**：串行轮询、间隔可配、失败退避、命中 412 时由 http 层冷却。
 */
import { mkdir, readFile, rename, writeFile, appendFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type { SearchClient, UpDynamic, UpVideo } from './search.js'

export type SubscriptionType = 'video' | 'dynamic'

export interface Subscription {
  id: string
  mid: number
  name: string
  types: SubscriptionType[]
  /** 推送目标（例如 group:660610917）；空数组表示只进 outbox，不主动推送 */
  groups: string[]
  lastSeenPubdate: number
  recentIds: string[]
  failures: number
  /** 下次检查时间（ms） */
  nextCheckAt: number
  enabled: boolean
  createdAt: number
}

export interface OutboxItem {
  id: string
  kind: SubscriptionType
  mid: number
  upName: string
  title: string
  url: string
  pubdate: number
  addedAt: number
  /** 该条要推给哪些目标（继承订阅的 groups；空数组=只进 outbox） */
  groups: string[]
  /** 已投递到的消费方（比如 napcat:group:660610917） */
  deliveredTo: string[]
  /** 摘要（动态正文/视频时长等） */
  extra?: string
}

export interface SubscriptionStoreOptions {
  /** 数据目录，缺省 ~/.dsh/dsh-bili */
  dir?: string
  log?: (level: 'debug' | 'info' | 'warn', message: string) => void
}

function dataDir(): string {
  const dshHome = process.env.DSH_HOME
  const base = dshHome !== undefined && dshHome !== '' ? dshHome : join(homedir(), '.dsh')
  return join(base, 'dsh-bili')
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export class SubscriptionStore {
  private readonly options: SubscriptionStoreOptions
  private readonly subsFile: string
  private readonly outboxFile: string
  private loaded = false
  private subs: Subscription[] = []
  private outbox: OutboxItem[] = []

  constructor(options: SubscriptionStoreOptions = {}) {
    this.options = options
    const dir = options.dir ?? dataDir()
    this.subsFile = join(dir, 'subscriptions.json')
    this.outboxFile = join(dir, 'outbox.jsonl')
  }

  private log(level: 'debug' | 'info' | 'warn', message: string): void {
    this.options.log?.(level, message)
  }

  /** 读盘（幂等） */
  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = await readFile(this.subsFile, 'utf8')
      const parsed = JSON.parse(raw) as { subscriptions?: Subscription[] }
      this.subs = Array.isArray(parsed.subscriptions) ? parsed.subscriptions.filter(item => item !== null && typeof item === 'object') : []
    } catch {
      this.subs = []
    }
    try {
      const raw = await readFile(this.outboxFile, 'utf8')
      this.outbox = raw
        .split('\n')
        .filter(line => line.trim() !== '')
        .map(line => {
          try {
            return JSON.parse(line) as OutboxItem
          } catch {
            return undefined
          }
        })
        .filter((item): item is OutboxItem => item !== undefined)
    } catch {
      this.outbox = []
    }
    this.log('debug', '订阅表已加载：' + this.subs.length + ' 个订阅，' + this.outbox.length + ' 条待推送')
  }

  private async save(): Promise<void> {
    const dir = dirname(this.subsFile)
    await mkdir(dir, { recursive: true })
    const tmp = this.subsFile + '.tmp'
    await writeFile(tmp, JSON.stringify({ subscriptions: this.subs }, null, 2), 'utf8')
    await rename(tmp, this.subsFile)
  }

  list(): Subscription[] {
    return this.subs.map(item => ({ ...item, groups: [...item.groups], types: [...item.types], recentIds: [...item.recentIds] }))
  }

  find(id: string): Subscription | undefined {
    return this.subs.find(item => item.id === id)
  }

  findByMid(mid: number): Subscription | undefined {
    return this.subs.find(item => item.mid === mid)
  }

  maxOf(limit: number): boolean {
    return this.subs.length >= limit
  }

  /** 新增或更新（同 mid 视为同一个 UP，合并类型与群） */
  async upsert(input: {
    mid: number
    name: string
    types?: SubscriptionType[]
    groups?: string[]
    lastSeenPubdate?: number
    now?: number
  }): Promise<{ subscription: Subscription; created: boolean }> {
    const now = input.now ?? Date.now()
    const existing = this.findByMid(input.mid)
    if (existing !== undefined) {
      for (const type of input.types ?? []) if (!existing.types.includes(type)) existing.types.push(type)
      for (const group of input.groups ?? []) if (!existing.groups.includes(group)) existing.groups.push(group)
      if (input.lastSeenPubdate !== undefined) existing.lastSeenPubdate = Math.max(existing.lastSeenPubdate, input.lastSeenPubdate)
      existing.enabled = true
      existing.failures = 0
      existing.nextCheckAt = now
      await this.save()
      return { subscription: { ...existing }, created: false }
    }
    const subscription: Subscription = {
      id: 'up:' + String(input.mid),
      mid: input.mid,
      name: input.name,
      types: input.types !== undefined && input.types.length > 0 ? [...new Set(input.types)] : ['video'],
      groups: [...new Set(input.groups ?? [])],
      lastSeenPubdate: input.lastSeenPubdate ?? 0,
      recentIds: [],
      failures: 0,
      nextCheckAt: now,
      enabled: true,
      createdAt: now,
    }
    this.subs.push(subscription)
    await this.save()
    return { subscription: { ...subscription }, created: true }
  }

  async remove(identifier: { mid?: number; id?: string; group?: string }): Promise<number> {
    const before = this.subs.length
    this.subs = this.subs.filter(item => {
      if (identifier.id !== undefined && item.id === identifier.id) return false
      if (identifier.mid !== undefined && item.mid === identifier.mid) return false
      return true
    })
    let removed = before - this.subs.length
    // 只移除某个群的订阅关系：订阅本身保留
    if (removed === 0 && identifier.group !== undefined && /^\d+$/.test(identifier.id ?? '')) {
      const target = this.findByMid(Number(identifier.id))
      if (target !== undefined) {
        target.groups = target.groups.filter(group => group !== identifier.group)
        removed = 1
        await this.save()
        return removed
      }
    }
    if (removed > 0) await this.save()
    return removed
  }

  async update(subscription: Subscription): Promise<void> {
    const index = this.subs.findIndex(item => item.id === subscription.id)
    if (index < 0) return
    this.subs[index] = subscription
    await this.save()
  }

  /** 待检查的订阅（按 nextCheckAt 升序） */
  due(now = Date.now(), limit = 1): Subscription[] {
    return this.subs
      .filter(item => item.enabled && item.nextCheckAt <= now)
      .sort((a, b) => a.nextCheckAt - b.nextCheckAt)
      .slice(0, limit)
  }

  /**
   * 待推送。
   * @param consumer 已投递给谁（如 napcat:group:660610917），已投递的跳过
   * @param limit 最多返回多少条
   * @param target 只取"目标里包含这个 target"的条目（如 group:660610917）
   */
  pending(consumer?: string, limit = 50, target?: string): OutboxItem[] {
    let items = consumer === undefined
      ? this.outbox
      : this.outbox.filter(item => !item.deliveredTo.includes(consumer))
    if (target !== undefined) {
      items = items.filter(item => item.groups.includes(target))
    }
    return items.slice(-limit)
  }

  /** 标记已投递（不清除，保留历史；超过上限时裁剪） */
  async ack(ids: readonly string[], consumer: string, keep = 200): Promise<void> {
    const set = new Set(ids)
    let changed = false
    for (const item of this.outbox) {
      if (!set.has(item.id)) continue
      if (!item.deliveredTo.includes(consumer)) {
        item.deliveredTo.push(consumer)
        changed = true
      }
    }
    if (this.outbox.length > keep) {
      this.outbox = this.outbox.slice(this.outbox.length - keep)
      changed = true
    }
    if (changed) {
      const dir = dirname(this.outboxFile)
      await mkdir(dir, { recursive: true })
      const body = this.outbox.map(item => JSON.stringify(item)).join('\n') + (this.outbox.length > 0 ? '\n' : '')
      await writeFile(this.outboxFile, body, 'utf8')
    }
  }

  /** 追加一批新内容到 outbox（同一 id 不重复） */
  async push(items: readonly Omit<OutboxItem, 'deliveredTo' | 'addedAt'>[]): Promise<number> {
    if (items.length === 0) return 0
    const dir = dirname(this.outboxFile)
    await mkdir(dir, { recursive: true })
    const known = new Set(this.outbox.map(item => item.id))
    const fresh: OutboxItem[] = []
    for (const item of items) {
      if (known.has(item.id)) {
        // 同一条内容、但目标群变了：把新群补进已有条目
        const existing = this.outbox.find(entry => entry.id === item.id)
        if (existing !== undefined) {
          for (const group of item.groups) if (!existing.groups.includes(group)) existing.groups.push(group)
        }
        continue
      }
      known.add(item.id)
      fresh.push({ ...item, deliveredTo: [], addedAt: Date.now() })
    }
    if (fresh.length === 0) return 0
    this.outbox.push(...fresh)
    const lines = fresh.map(item => JSON.stringify(item)).join('\n') + '\n'
    await appendFile(this.outboxFile, lines, 'utf8')
    return fresh.length
  }
}

export interface PollerOptions {
  store: SubscriptionStore
  search: SearchClient
  intervalMinutes: number
  /** 单个订阅失败后的退避（分钟），按失败次数递增 */
  backoffMinutes?: number[]
  log?: (level: 'debug' | 'info' | 'warn', message: string) => void
}

export interface PollResult {
  subscription: Subscription
  videos: UpVideo[]
  dynamics: UpDynamic[]
  added: number
  error?: string
}

/** 检查一个订阅：拉投稿/动态 → 与 lastSeen 比较 → 写 outbox */
export async function pollSubscription(subscription: Subscription, options: PollerOptions): Promise<PollResult> {
  const now = Date.now()
  const bumped: Subscription = { ...subscription, groups: [...subscription.groups], types: [...subscription.types], recentIds: [...subscription.recentIds] }
  const videos: UpVideo[] = []
  const dynamics: UpDynamic[] = []
  const fresh: Array<Omit<OutboxItem, 'deliveredTo' | 'addedAt'>> = []
  try {
    if (bumped.types.includes('video')) {
      const list = await options.search.upVideos(bumped.mid, 1, 10)
      videos.push(...list)
      for (const video of list) {
        if (video.pubdate <= bumped.lastSeenPubdate) continue
        if (bumped.recentIds.includes(video.bvid)) continue
        fresh.push({
          id: 'video:' + video.bvid,
          kind: 'video',
          mid: bumped.mid,
          upName: bumped.name,
          title: video.title,
          url: video.url,
          pubdate: video.pubdate,
          groups: [...bumped.groups],
          ...(video.durationSec > 0 ? { extra: Math.round(video.durationSec / 60) + ' 分钟' } : {}),
        })
      }
      if (list.length > 0) {
        const newest = list[0]
        if (newest !== undefined && newest.pubdate > bumped.lastSeenPubdate) bumped.lastSeenPubdate = newest.pubdate
      }
    }
    if (bumped.types.includes('dynamic')) {
      const list = await options.search.upDynamics(bumped.mid, 10)
      dynamics.push(...list)
      for (const dynamic of list) {
        if (dynamic.pubdate <= bumped.lastSeenPubdate) continue
        if (bumped.recentIds.includes(dynamic.id)) continue
        fresh.push({
          id: 'dynamic:' + dynamic.id,
          kind: 'dynamic',
          mid: bumped.mid,
          upName: bumped.name,
          title: dynamic.text === '' ? (dynamic.imageCount > 0 ? '发了一张图' : '发了一条动态') : dynamic.text.slice(0, 80),
          url: dynamic.url,
          pubdate: dynamic.pubdate,
          groups: [...bumped.groups],
          ...(dynamic.imageCount > 0 ? { extra: dynamic.imageCount + ' 张图' } : {}),
        })
      }
      if (list.length > 0) {
        const newest = list[0]
        if (newest !== undefined && newest.pubdate > bumped.lastSeenPubdate) bumped.lastSeenPubdate = newest.pubdate
      }
    }
    const added = await options.store.push(fresh)
    // 记住最近 40 个 id，防重复
    const ids = fresh.map(item => item.id.replace(/^(video|dynamic):/, ''))
    bumped.recentIds = [...ids, ...bumped.recentIds].slice(0, 40)
    bumped.failures = 0
    bumped.nextCheckAt = now + options.intervalMinutes * 60_000
    await options.store.update(bumped)
    if (added > 0) options.log?.('info', '订阅更新 ' + bumped.name + '：' + added + ' 条新内容')
    return { subscription: bumped, videos, dynamics, added }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const backoff = options.backoffMinutes ?? [5, 15, 60]
    const failures = bumped.failures + 1
    const wait = backoff[Math.min(backoff.length - 1, failures - 1)] ?? 60
    bumped.failures = failures
    bumped.nextCheckAt = now + wait * 60_000
    await options.store.update(bumped)
    options.log?.('warn', '订阅检查失败 ' + bumped.name + '（' + failures + ' 次，' + wait + ' 分钟后重试）: ' + message)
    return { subscription: bumped, videos, dynamics, added: 0, error: message }
  }
}
