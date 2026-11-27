/**
 * B 站视频分析（与抖音 A 档对齐，2026-11-26）。
 *
 * 产出平台中立的素材，不绑定任何下游：
 *   - 元信息（标题/UP/时长/播放/简介）
 *   - 16k 单声道音频（交给 tts_transcribe 做 ASR，解决"没 CC 字幕"）
 *   - 9 帧分镜图（复用 StoryboardService）
 *
 * B 站不需要下载整片：音频直接用 playurl 的 DASH 音频流，分镜也走直连流。
 */
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { BiliClient, VideoInfo } from './bili.js'
import { resolveStoryboardDeps, runBinary } from './deps.js'
import { fetchBiliPlayUrls } from './amagi.js'
import { rankBiliCandidates } from './cdn.js'
import type { StoryboardService, StoryboardOutcome } from './services.js'

export interface BiliAnalysis {
  platform: 'bili'
  info: VideoInfo
  audioPath?: string
  storyboard?: StoryboardOutcome
  /** 分镜失败原因（给工具输出用，避免静默） */
  storyboardError?: string
}

export interface BiliAnalysisOptions {
  /** 音频/中间产物根目录（默认 ~/.dsh/dsh-bili/analysis） */
  rootDir?: string
  ffmpegPath?: string
  /** amagi 服务地址（B 站 CDN 被风控时的兜底流） */
  amagiBaseUrl?: string
  /** amagi 用的 B 站 cookie（随请求下发） */
  amagiBilibiliCookies?: string
  /** 分镜服务（不传就不生成分镜图） */
  storyboard?: StoryboardService
  log?: (level: 'debug' | 'info' | 'warn', message: string) => void
}

function defaultRoot(): string {
  const home = process.env.DSH_HOME
  const base = home !== undefined && home !== '' ? home : join(homedir(), '.dsh')
  return join(base, 'dsh-bili', 'analysis')
}

function ffmpegHeaders(headers: Record<string, string>): string {
  const lines = Object.entries(headers).map(([name, value]) => name + ': ' + value)
  // B 站 CDN 对不带 Range 的 GET 会 403/567（实测 2026-11-26）
  lines.push('Range: bytes=0-')
  return lines.join('\r\n') + '\r\n'
}

/** 抽 playurl 的音频流为 16k 单声道 wav（B 站 CDN 需要 Referer/UA 头） */
async function extractBiliAudio(
  ffmpeg: string,
  audioUrl: string,
  headers: Record<string, string>,
  output: string,
): Promise<void> {
  await runBinary(
    ffmpeg,
    ['-y', '-headers', ffmpegHeaders(headers), '-i', audioUrl, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', output],
    180_000,
  )
}

/**
 * 分析一个 B 站视频：元信息 + 音频 + 分镜。
 * @param input 链接 / BV / av / 包含链接的一段话
 */
export async function analyzeBili(
  input: string,
  client: BiliClient,
  options: BiliAnalysisOptions = {},
): Promise<BiliAnalysis> {
  const log = options.log ?? (() => undefined)
  const stream = await client.streamUrl(input)
  const info = stream.info
  const root = options.rootDir ?? defaultRoot()
  const dir = join(root, info.bvid)
  await mkdir(dir, { recursive: true })

  let audioPath: string | undefined
  const audioCandidates = rankBiliCandidates(stream.audioCandidates.length > 0
    ? stream.audioCandidates
    : (stream.audioUrl === undefined ? [] : [stream.audioUrl]))
  if (audioCandidates.length > 0) {
    const deps = await resolveStoryboardDeps({ ffmpegPath: options.ffmpegPath ?? '' })
    if (deps.ffmpeg === undefined) {
      log('warn', 'B 站分析：没有找到 ffmpeg，跳过音频')
    } else {
      const wav = join(dir, 'audio.wav')
      for (const candidate of audioCandidates.slice(0, 4)) {
        try {
          log('info', 'B 站分析：抽音频 ' + info.bvid)
          await extractBiliAudio(deps.ffmpeg.path, candidate, stream.headers, wav)
          audioPath = wav
          break
        } catch (error) {
          log('debug', 'B 站分析：音频候选失败，换下一个: ' + new URL(candidate).host)
        }
      }
      if (audioPath === undefined) log('warn', 'B 站分析：抽音频失败（仍可看分镜）')
    }
  } else {
    log('warn', 'B 站分析：这条视频没有独立音频流（可能是老旧 durl 格式）')
  }

  let storyboard: StoryboardOutcome | undefined
  let storyboardError: string | undefined
  if (options.storyboard !== undefined) {
    // B 站 CDN 镜像会偶发 403（同一视频换一次流就能过）：失败时重新 playurl 再试
    for (let attempt = 0; attempt < 3 && storyboard === undefined; attempt += 1) {
      try {
        const current = attempt === 0 ? stream : await client.streamUrl(input)
        storyboard = await options.storyboard.buildFromBiliStream({
          info: current.info,
          url: current.url,
          ...(current.audioUrl === undefined ? {} : { audioUrl: current.audioUrl }),
          candidates: current.candidates,
          audioCandidates: current.audioCandidates,
          headers: current.headers,
        })
      } catch (error) {
        storyboardError = error instanceof Error ? error.message : String(error)
        log('warn', 'B 站分析：分镜生成失败（第 ' + String(attempt + 1) + ' 次）: ' + storyboardError.slice(0, 120))
      }
    }
    if (storyboard !== undefined) storyboardError = undefined
  }

  // amagi 兜底：B 站 CDN 会对 DASH 流限流，amagi 的 durl mp4 通常还能取
  let amagiUrls: string[] | undefined
  if (options.amagiBaseUrl !== undefined && options.amagiBaseUrl !== '' && (storyboard === undefined || audioPath === undefined)) {
    try {
      const play = await fetchBiliPlayUrls({ avid: info.aid, cid: info.cid }, {
        baseUrl: options.amagiBaseUrl,
        ...(options.amagiBilibiliCookies === undefined ? {} : { cookie: options.amagiBilibiliCookies }),
      })
      amagiUrls = play.urls
      log('info', 'B 站分析：走 amagi 兜底（' + String(play.urls.length) + ' 段）')
    } catch (error) {
      log('warn', 'B 站分析：amagi 兜底失败: ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  if (amagiUrls !== undefined && audioPath === undefined) {
    try {
      const deps = await resolveStoryboardDeps({ ffmpegPath: options.ffmpegPath ?? '' })
      if (deps.ffmpeg !== undefined) {
        const wav = join(dir, 'audio.wav')
        await extractBiliAudio(deps.ffmpeg.path, amagiUrls[0]!, stream.headers, wav)
        audioPath = wav
      }
    } catch (error) {
      log('warn', 'B 站分析：amagi 音频兜底失败: ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  if (amagiUrls !== undefined && storyboard === undefined && options.storyboard !== undefined) {
    try {
      // amagi 给的是完整 mp4：先下载到本地再抽帧（直接对 URL seek 会被 CDN 拒绝）
      const local = join(dir, 'video.mp4')
      const response = await fetch(amagiUrls[0]!, {
        headers: stream.headers,
        signal: AbortSignal.timeout(180_000),
      })
      if (!response.ok) throw new Error('下载 amagi 视频失败：HTTP ' + String(response.status))
      const { writeFile } = await import('node:fs/promises')
      await writeFile(local, Buffer.from(await response.arrayBuffer()))
      storyboard = await options.storyboard.buildFromLocalFile(local)
      storyboardError = undefined
    } catch (error) {
      storyboardError = error instanceof Error ? error.message : String(error)
      log('warn', 'B 站分析：amagi 分镜兜底失败: ' + storyboardError.slice(0, 120))
    }
  }

  return {
    platform: 'bili',
    info,
    ...(audioPath === undefined ? {} : { audioPath }),
    ...(storyboard === undefined ? {} : { storyboard }),
    ...(storyboardError === undefined ? {} : { storyboardError }),
  }
}
