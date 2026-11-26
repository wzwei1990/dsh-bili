/**
 * amagi 服务客户端（抖音解析）。
 *
 * amagi 是独立容器/服务（本地签名，无头可用）；这里只做 HTTP 调用，
 * 不 import 它的代码（GPL 隔离），也不把 cookie 写进仓库。
 */
import { pickAwemeId, extractDouyinUrl, isDouyinUrl } from './douyin.js'

export interface DouyinWorkMeta {
  id: string
  title: string
  uploader: string
  durationSec: number
  width?: number
  height?: number
  cover?: string
  playUrl?: string
  likes?: number
  comments?: number
  description: string
  webpageUrl: string
}

export interface AmagiOptions {
  /** 例如 http://amagi:4567 或 http://127.0.0.1:4567 */
  baseUrl: string
  timeoutMs?: number
}

interface AmagiResponse {
  success?: boolean
  message?: string
  data?: {
    aweme_detail?: {
      aweme_id?: string
      desc?: string
      create_time?: number
      author?: { nickname?: string }
      video?: {
        duration?: number
        width?: number
        height?: number
        ratio?: string
        play_addr?: { url_list?: string[] }
        cover?: { url_list?: string[] }
      }
      statistics?: { digg_count?: number; comment_count?: number; share_count?: number }
    }
  }
}

/** 从 amagi 响应里抽统一的元数据（纯函数，可单测） */
export function parseAmagiWork(json: AmagiResponse, fallbackUrl: string): DouyinWorkMeta | undefined {
  if (json.success !== true) return undefined
  const detail = json.data?.aweme_detail
  if (detail === undefined) return undefined
  const id = String(detail.aweme_id ?? '')
  if (id === '') return undefined
  const durationMs = Number(detail.video?.duration ?? 0)
  // 抖音的 play_addr 返回多条 CDN 镜像；第一条通常可用，且免 cookie
  const playUrl = (detail.video?.play_addr?.url_list ?? []).find(url => typeof url === 'string' && url !== '')
  const cover = (detail.video?.cover?.url_list ?? []).find(url => typeof url === 'string' && url !== '')
  return {
    id,
    title: String(detail.desc ?? '').split('\n')[0]?.trim() ?? '',
    uploader: String(detail.author?.nickname ?? ''),
    durationSec: durationMs > 0 ? durationMs / 1000 : 0,
    ...(detail.video?.width === undefined ? {} : { width: Number(detail.video.width) }),
    ...(detail.video?.height === undefined ? {} : { height: Number(detail.video.height) }),
    ...(cover === undefined ? {} : { cover }),
    ...(playUrl === undefined ? {} : { playUrl }),
    ...(detail.statistics?.digg_count === undefined ? {} : { likes: detail.statistics.digg_count }),
    ...(detail.statistics?.comment_count === undefined ? {} : { comments: detail.statistics.comment_count }),
    description: String(detail.desc ?? ''),
    webpageUrl: 'https://www.douyin.com/video/' + id,
  }
}

export function amagiDouyinUrl(baseUrl: string, awemeId: string): string {
  const root = baseUrl.trim().replace(/\/+$/, '')
  return root + '/api/douyin/fetch_one_work?aweme_id=' + encodeURIComponent(awemeId)
}

/** 从任意抖音链接/分享文案里取作品 id */
export function douyinIdOf(input: string): string | undefined {
  const url = extractDouyinUrl(input) ?? (isDouyinUrl(input) ? input.trim() : undefined)
  if (url === undefined) return undefined
  return pickAwemeId(url)
}

/** 调 amagi 拿作品详情（标题/作者/时长/直链） */
export async function fetchDouyinWork(input: string, options: AmagiOptions): Promise<DouyinWorkMeta> {
  const base = options.baseUrl.trim()
  if (base === '') throw new Error('未配置 amagiBaseUrl（抖音解析服务地址）')
  const awemeId = douyinIdOf(input)
  if (awemeId === undefined) {
    // 短链里没有 id：先跟随跳转拿最终地址
    const url = extractDouyinUrl(input)
    if (url === undefined) throw new Error('没找到抖音链接或作品 id')
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36' },
    })
    const id = pickAwemeId(response.url)
    if (id === undefined) throw new Error('这个抖音链接里没有作品 id（可能是直播/用户主页）')
    return fetchDouyinWork('https://www.douyin.com/video/' + id, options)
  }
  const json = await fetch(amagiDouyinUrl(base, awemeId), {
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  }).then(async response => {
    if (!response.ok) throw new Error('amagi HTTP ' + String(response.status))
    return await response.json() as AmagiResponse
  })
  const meta = parseAmagiWork(json, '')
  if (meta === undefined) throw new Error('amagi 解析失败：' + (json.message ?? '响应里没有作品详情'))
  return meta
}

/** 把 amagi 返回的直链下载到本地（免 cookie，带抖音 Referer） */
export async function downloadDouyinPlayUrl(url: string, filePath: string): Promise<void> {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(120_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
      Referer: 'https://www.douyin.com/',
    },
  })
  if (!response.ok) throw new Error('下载抖音直链失败：HTTP ' + String(response.status))
  const { writeFile } = await import('node:fs/promises')
  await writeFile(filePath, Buffer.from(await response.arrayBuffer()))
}

export interface BiliPlayUrls {
  urls: string[]
  /** 视频总时长（ms） */
  durationMs?: number
}

/**
 * 通过 amagi 取 B 站播放地址（durl mp4，通常比 DASH m4s 更抗 CDN 风控）。
 * 调用方需要提供 avid + cid（BiliClient.resolve() 里有）。
 */
export async function fetchBiliPlayUrls(
  input: { avid: number; cid: number; qn?: number },
  options: AmagiOptions,
): Promise<BiliPlayUrls> {
  const base = options.baseUrl.trim()
  if (base === '') throw new Error('未配置 amagiBaseUrl')
  const query = 'avid=' + String(input.avid) + '&cid=' + String(input.cid) + '&qn=' + String(input.qn ?? 64)
  const response = await fetch(base.replace(/\/+$/, '') + '/api/bilibili/fetch_video_playurl?' + query, {
    signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
  })
  if (!response.ok) throw new Error('amagi HTTP ' + String(response.status))
  const json = await response.json() as {
    success?: boolean
    message?: string
    data?: { data?: { durl?: Array<{ url?: string }>; timelength?: number } }
  }
  if (json.success !== true) throw new Error('amagi 取 B 站播放地址失败：' + (json.message ?? '未知错误'))
  const durl = json.data?.data?.durl ?? []
  const urls = durl.map(item => String(item.url ?? '')).filter(url => url !== '')
  if (urls.length === 0) throw new Error('amagi 没有返回可用的 B 站播放地址')
  const timelength = json.data?.data?.timelength
  return { urls, ...(timelength === undefined ? {} : { durationMs: timelength }) }
}
