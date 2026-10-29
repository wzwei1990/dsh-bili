/**
 * B 站只读客户端（v0.1：解析链接 + 视频信息 + 字幕）。
 *
 * 接口全部是公开接口，不需要登录也能拿到大部分视频的元信息；
 * 字幕是否可见取决于视频是否上传 CC 字幕 / 是否登录，拿不到就如实返回空。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { followRedirect, getJson, HttpError, type HttpOptions } from './http.js'
import { signQuery } from './wbi.js'

export interface VideoInfo {
  bvid: string
  aid: number
  cid: number
  title: string
  up: string
  durationSec: number
  cover: string
  desc: string
  pageUrl: string
  publishedAt: number
  stats: { view: number; danmaku: number; like: number; coin: number; favorite: number }
  pages: Array<{ cid: number; page: number; part: string; durationSec: number }>
}

export interface SubtitleTrack {
  lang: string
  label: string
  url: string
  ai: boolean
}

export interface SubtitleResult {
  bvid: string
  lang: string
  label: string
  text: string
  cueCount: number
  truncated: boolean
}

export interface CardInfo {
  bvid: string
  title: string
  up: string
  durationSec: number
  cover: string
  pageUrl: string
  desc: string
}

export interface BiliClientOptions {
  cookie?: string
  timeoutMs?: number
  cacheTtlMs?: number
  log?: (level: 'debug' | 'info' | 'warn', message: string) => void
  /** 缓存目录（默认 <home>/.dsh/dsh-bili/cache） */
  cacheDir?: string
}

const API = 'https://api.bilibili.com'

/** 从任意文本里抠出 BV 号 / av 号 / b23 短链。 */
export function extractTarget(input: string): { kind: 'bvid' | 'aid' | 'short' | 'none'; value: string } {
  const text = (input ?? '').trim()
  if (text === '') return { kind: 'none', value: '' }
  const bv = /\b(BV[0-9A-Za-z]{10})\b/.exec(text)
  if (bv !== null) return { kind: 'bvid', value: bv[1] ?? '' }
  const av = /\bav(\d{1,12})\b/i.exec(text)
  if (av !== null) return { kind: 'aid', value: av[1] ?? '' }
  const short = /(b23\.tv|bili2233\.cn)\/([0-9A-Za-z]+)/.exec(text)
  if (short !== null) return { kind: 'short', value: 'https://' + (short[1] ?? '') + '/' + (short[2] ?? '') }
  return { kind: 'none', value: '' }
}

/** 把字幕 cue 列表合并成段落文本（每段约 30 秒或 80 字，便于模型阅读）。 */
export function mergeCues(cues: ReadonlyArray<{ from: number; content: string }>): string {
  const lines: string[] = []
  let buffer: string[] = []
  let start = cues[0]?.from ?? 0
  let lastEnd = start
  const flush = (): void => {
    if (buffer.length === 0) return
    const minutes = Math.floor(start / 60)
    const seconds = Math.floor(start % 60)
    const stamp = String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0')
    lines.push('[' + stamp + '] ' + buffer.join(''))
    buffer = []
  }
  for (const cue of cues) {
    // 先判断边界再入 buffer：跨过 30 秒或攒够 80 字就另起一段，
    // 否则边界那句会被算进上一段（旧实现的 bug）。
    if (buffer.length > 0) {
      const span = cue.from - start
      const length = buffer.join('').length
      if (span >= 30 || length >= 80) {
        flush()
        start = cue.from
      }
    }
    if (buffer.length === 0) start = cue.from
    buffer.push(cue.content.trim())
    lastEnd = cue.from
  }
  flush()
  void lastEnd
  return lines.join('\n')
}

export class BiliClient {
  private cookie: string
  private buvidReady = false
  private readonly timeoutMs: number
  private readonly cacheTtlMs: number
  private readonly cacheDir: string
  private readonly log: (level: 'debug' | 'info' | 'warn', message: string) => void
  private readonly memory = new Map<string, { at: number; value: unknown }>()
  private wbiKeys: { imgKey: string; subKey: string; at: number } | undefined

  constructor(options: BiliClientOptions = {}) {
    this.cookie = options.cookie ?? ''
    this.timeoutMs = options.timeoutMs ?? 15000
    this.cacheTtlMs = options.cacheTtlMs ?? 24 * 60 * 60_000
    this.cacheDir = options.cacheDir ?? join(homedir(), '.dsh', 'dsh-bili', 'cache')
    this.log = options.log ?? (() => undefined)
  }

  private httpOptions(): HttpOptions {
    return { cookie: this.cookie, timeoutMs: this.timeoutMs }
  }

  /** 解链接 → 统一成 bvid（b23 短链会先跟随跳转）。 */
  async normalize(input: string): Promise<{ bvid?: string; aid?: number }> {
    let target = extractTarget(input)
    if (target.kind === 'short') {
      const finalUrl = await followRedirect(target.value, this.httpOptions())
      target = extractTarget(finalUrl)
      this.log('debug', '短链跳转到: ' + finalUrl)
    }
    if (target.kind === 'bvid') return { bvid: target.value }
    if (target.kind === 'aid') return { aid: Number(target.value) }
    throw new HttpError('没找到 B 站视频标识（支持 BV 号、av 号、b23.tv 短链、含链接的文本）')
  }

  /** 视频元信息（缓存按 bvid）。 */
  async resolve(input: string): Promise<VideoInfo> {
    const id = await this.normalize(input)
    const key = 'view:' + (id.bvid ?? 'aid' + String(id.aid ?? 0))
    const cached = this.cacheGet<VideoInfo>(key)
    if (cached !== undefined) return cached
    const query = id.bvid !== undefined ? 'bvid=' + id.bvid : 'aid=' + String(id.aid)
    const json = await getJson<BiliResponse<ViewData>>(API + '/x/web-interface/view?' + query, this.httpOptions())
    assertOk(json)
    const data = json.data
    const info: VideoInfo = {
      bvid: data.bvid,
      aid: data.aid,
      cid: data.cid,
      title: data.title,
      up: data.owner?.name ?? '未知UP',
      durationSec: data.duration,
      cover: data.pic,
      desc: data.desc ?? '',
      pageUrl: 'https://www.bilibili.com/video/' + data.bvid,
      publishedAt: data.pubdate ?? 0,
      stats: {
        view: data.stat?.view ?? 0,
        danmaku: data.stat?.danmaku ?? 0,
        like: data.stat?.like ?? 0,
        coin: data.stat?.coin ?? 0,
        favorite: data.stat?.favorite ?? 0,
      },
      pages: (data.pages ?? []).map(page => ({
        cid: page.cid,
        page: page.page,
        part: page.part,
        durationSec: page.duration,
      })),
    }
    this.cacheSet(key, info)
    return info
  }

  /** 卡片信息（发给群里的"分享"用）。 */
  async card(input: string): Promise<CardInfo> {
    const info = await this.resolve(input)
    return {
      bvid: info.bvid,
      title: info.title,
      up: info.up,
      durationSec: info.durationSec,
      cover: info.cover,
      pageUrl: info.pageUrl,
      desc: info.desc.slice(0, 120),
    }
  }

  /** 字幕轨列表（可能为空：UP 没传字幕 / 需要登录）。 */
  async subtitleTracks(input: string, cid?: number): Promise<{ info: VideoInfo; tracks: SubtitleTrack[] }> {
    const info = await this.resolve(input)
    const targetCid = cid ?? info.cid
    const keys = await this.ensureWbiKeys()
    const url = keys === undefined
      ? API + '/x/player/v2?bvid=' + encodeURIComponent(info.bvid) + '&cid=' + String(targetCid)
      : API + '/x/player/wbi/v2?' + signQuery({ bvid: info.bvid, cid: targetCid }, keys.imgKey, keys.subKey)
    const json = await getJson<BiliResponse<PlayerData>>(url, this.httpOptions())
    assertOk(json)
    const list = json.data?.subtitle?.subtitles ?? []
    const tracks = list.map(item => ({
      lang: item.lan,
      label: item.lan_doc ?? item.lan,
      url: item.subtitle_url.startsWith('//') ? 'https:' + item.subtitle_url : item.subtitle_url,
      ai: item.ai_type !== undefined && item.ai_type > 0,
    }))
    return { info, tracks }
  }

  /** 字幕正文：优先中文（含 AI 字幕），没有就返回空并说明。 */
  async readSubtitle(input: string, options: { maxChars?: number; cid?: number } = {}): Promise<SubtitleResult> {
    const { info, tracks } = await this.subtitleTracks(input, options.cid)
    const maxChars = Math.max(200, options.maxChars ?? 6000)
    if (tracks.length === 0) {
      return { bvid: info.bvid, lang: '', label: '', text: '', cueCount: 0, truncated: false }
    }
    const picked =
      tracks.find(track => track.lang.toLowerCase() === 'zh-cn')
      ?? tracks.find(track => track.lang.toLowerCase().startsWith('zh'))
      ?? tracks[0]
    if (picked === undefined) {
      return { bvid: info.bvid, lang: '', label: '', text: '', cueCount: 0, truncated: false }
    }
    const cacheKey = 'sub:' + info.bvid + ':' + picked.lang
    const cached = this.cacheGet<SubtitleResult>(cacheKey)
    if (cached !== undefined) return trimTo(cached, maxChars)
    const json = await getJson<{ body?: Array<{ from: number; to?: number; content: string }> }>(picked.url, this.httpOptions())
    const cues = (json.body ?? []).map(cue => ({ from: cue.from, content: cue.content }))
    const result: SubtitleResult = {
      bvid: info.bvid,
      lang: picked.lang,
      label: picked.label,
      text: mergeCues(cues),
      cueCount: cues.length,
      truncated: false,
    }
    this.cacheSet(cacheKey, result)
    return trimTo(result, maxChars)
  }

  /** WBI 密钥对（缓存 2 小时；nav 接口未登录也返回密钥）。 */
  /**
   * 拿 WBI 密钥。未登录时 nav 会返回 -101，所以先补一个游客 cookie（buvid3）再试；
   * 仍然拿不到就返回 undefined —— 上层退回不需要签名的老接口 `/x/player/v2`。
   */
  private async ensureWbiKeys(): Promise<{ imgKey: string; subKey: string } | undefined> {
    const now = Date.now()
    if (this.wbiKeys !== undefined && now - this.wbiKeys.at < 2 * 60 * 60_000) {
      return { imgKey: this.wbiKeys.imgKey, subKey: this.wbiKeys.subKey }
    }
    if (!(await this.ensureVisitorCookie())) return undefined
    try {
      const json = await getJson<BiliResponse<NavData>>(API + '/x/web-interface/nav', this.httpOptions())
      if (json.code !== 0) return undefined
      const imgKey = json.data?.wbi_img?.img_url ?? ''
      const subKey = json.data?.wbi_img?.sub_url ?? ''
      if (imgKey === '' || subKey === '') return undefined
      this.wbiKeys = { imgKey, subKey, at: now }
      return { imgKey, subKey }
    } catch (error) {
      this.log('debug', 'WBI 密钥获取失败（退回老接口）: ' + (error instanceof Error ? error.message : String(error)))
      return undefined
    }
  }

  /** 没有 cookie 时补一个游客 buvid3，否则 nav 接口必然 -101。 */
  private async ensureVisitorCookie(): Promise<boolean> {
    if (this.buvidReady) return true
    if (this.cookie.includes('buvid3=')) {
      this.buvidReady = true
      return true
    }
    try {
      const json = await getJson<BiliResponse<{ b_3?: string; b_4?: string }>>(API + '/x/frontend/finger/spi', this.httpOptions())
      const b3 = json.data?.b_3 ?? ''
      const b4 = json.data?.b_4 ?? ''
      if (b3 === '') return false
      this.cookie = (this.cookie === '' ? '' : this.cookie + '; ') + 'buvid3=' + b3 + (b4 === '' ? '' : '; buvid4=' + b4)
      this.buvidReady = true
      this.log('debug', '已补游客 cookie（buvid3）')
      return true
    } catch {
      return false
    }
  }

  private cacheGet<T>(key: string): T | undefined {
    if (this.cacheTtlMs <= 0) return undefined
    const memory = this.memory.get(key)
    if (memory !== undefined && Date.now() - memory.at < this.cacheTtlMs) return memory.value as T
    try {
      const file = join(this.cacheDir, key.replace(/[^A-Za-z0-9_.-]/g, '_') + '.json')
      if (!existsSync(file)) return undefined
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { at: number; value: unknown }
      if (Date.now() - raw.at >= this.cacheTtlMs) return undefined
      this.memory.set(key, raw)
      return raw.value as T
    } catch {
      return undefined
    }
  }

  private cacheSet(key: string, value: unknown): void {
    if (this.cacheTtlMs <= 0) return
    const entry = { at: Date.now(), value }
    this.memory.set(key, entry)
    try {
      mkdirSync(this.cacheDir, { recursive: true })
      writeFileSync(join(this.cacheDir, key.replace(/[^A-Za-z0-9_.-]/g, '_') + '.json'), JSON.stringify(entry), 'utf8')
    } catch (error) {
      this.log('debug', '写缓存失败: ' + (error instanceof Error ? error.message : String(error)))
    }
  }
}

/** 截断超长字幕（保留头部，标注截断）。 */
export function trimTo(result: SubtitleResult, maxChars: number): SubtitleResult {
  if (result.text.length <= maxChars) return result
  return { ...result, text: result.text.slice(0, maxChars) + '\n…（字幕过长，已截断）', truncated: true }
}

interface BiliResponse<T> {
  code: number
  message: string
  data: T
}

interface ViewData {
  bvid: string
  aid: number
  cid: number
  title: string
  desc?: string
  duration: number
  pic: string
  pubdate?: number
  owner?: { name?: string }
  stat?: { view?: number; danmaku?: number; like?: number; coin?: number; favorite?: number }
  pages?: Array<{ cid: number; page: number; part: string; duration: number }>
}

interface NavData {
  wbi_img?: { img_url?: string; sub_url?: string }
}

interface PlayerData {
  subtitle?: { subtitles?: Array<{ lan: string; lan_doc?: string; subtitle_url: string; ai_type?: number }> }
}

function assertOk<T>(json: BiliResponse<T>): void {
  if (json.code !== 0) throw new HttpError('B 站接口返回 ' + String(json.code) + ': ' + (json.message || '未知错误'), undefined, json.code)
}
