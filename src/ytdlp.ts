/**
 * yt-dlp 桥：只有"非 B 站链接"才需要它（B 站走官方 playurl，不需要下载器）。
 *
 * 探测顺序：配置 → 环境变量 YTDLP_PATH → PATH → 常见路径。
 * 下载策略：只要单文件 mp4（-f bv*+ba/b），限制分辨率（默认 720p 以内）与时长，
 * 避免为了看一眼视频而拉一个 4K 原盘。
 */
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { runBinary, type BinaryResult } from './deps.js'

export interface YtDlpOptions {
  /** yt-dlp 可执行文件路径（空 = 自动探测） */
  bin?: string
  /** 最高分辨率（默认 720） */
  maxHeight?: number
  /** 最大时长秒数（超过直接拒绝，防止拉长片） */
  maxDurationSec?: number
  /** 下载目录 */
  dir: string
  /** 超时（毫秒） */
  timeoutMs?: number
}

export interface YtDlpResult {
  filePath: string
  title?: string
  durationSec?: number
}

/**
 * 探测 yt-dlp。找不到独立可执行文件时，再试 `python -m yt_dlp`（conda/pip 装的常见情况）。
 * 返回的 path 可能是 "python"，调用方用 ytdlpArgs() 拼参数即可。
 */
export async function resolveYtDlp(configured = ''): Promise<BinaryResult | undefined> {
  // 延迟 import，避免循环依赖
  const { resolveBinary, probeBinary } = await import('./deps.js')
  // yt-dlp 只认 --version（不是 ffmpeg 的 -version）
  const direct = await resolveBinary('yt-dlp', configured, 'YTDLP_PATH', ['--version'])
  if (direct !== undefined) return direct
  // python -m yt_dlp 兜底（Windows 的 conda / pip 安装经常不给 PATH 加 yt-dlp.exe）
  const python = await resolveBinary('python', '', 'PYTHON_PATH', ['--version'])
  if (python !== undefined) {
    const version = await probeBinary(python.path, ['-m', 'yt_dlp', '--version'])
    if (version !== undefined) return { path: python.path, version, source: python.source }
  }
  const py = await resolveBinary('py', '', 'PYTHON_PATH', ['--version'])
  if (py !== undefined) {
    const version = await probeBinary(py.path, ['-m', 'yt_dlp', '--version'])
    if (version !== undefined) return { path: py.path, version, source: py.source }
  }
  return undefined
}

/** yt-dlp 的调用参数：独立可执行文件直接跑；python 兜底要加 `-m yt_dlp` */
export function ytdlpArgs(bin: string, args: string[]): string[] {
  return /python(\.exe)?$/i.test(bin) || /(^|[\\\\/])py(\.exe)?$/i.test(bin) ? ['-m', 'yt_dlp', ...args] : args
}

/** 是否为"通用链接"（http/https，非 B 站） */
export function isGenericVideoUrl(input: string): boolean {
  if (!/^https?:\/\//i.test(input.trim())) return false
  return !/(?:^https?:\/\/)?(?:www\.|m\.)?(?:bilibili\.com|b23\.tv)/i.test(input)
}

/**
 * 下载一个通用链接为单文件视频。
 * 失败时抛错（上层降级成"打不开"）。
 */
export async function downloadWithYtDlp(url: string, options: YtDlpOptions): Promise<YtDlpResult> {
  const bin = options.bin ?? (await resolveYtDlp())?.path
  if (bin === undefined || bin === '') throw new Error('没有找到 yt-dlp（非 B 站链接需要它）')
  await mkdir(options.dir, { recursive: true })
  const maxHeight = Math.max(144, Math.min(2160, options.maxHeight ?? 720))
  const timeoutMs = options.timeoutMs ?? 180_000
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--no-progress',
    '-f', 'bv*[height<=' + String(maxHeight) + ']+ba/b[height<=' + String(maxHeight) + ']/b',
    '--merge-output-format', 'mp4',
    '-o', join(options.dir, 'src.%(ext)s'),
    url,
  ]
  if (options.maxDurationSec !== undefined && options.maxDurationSec > 0) {
    args.splice(0, 0, '--match-filter', 'duration<=' + String(Math.round(options.maxDurationSec)))
  }
  await runBinary(bin, ytdlpArgs(bin, args), timeoutMs)
  const files = (await readdir(options.dir)).filter(name => /^src\./.test(name))
  const file = files[0]
  if (file === undefined) throw new Error('yt-dlp 没有产出文件')
  return { filePath: join(options.dir, file) }
}

/** 清理下载目录 */
export async function cleanupDownload(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true })
  } catch {
    // 忽略
  }
}
