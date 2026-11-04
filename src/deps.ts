/**
 * 外部依赖探测：ffmpeg / ffprobe。
 *
 * 跨平台要点（Windows 本机 + Linux Docker）：
 *   - 不依赖 shell：一律 spawn(argv 数组)，避免 Windows 引号/空格问题；
 *   - 探测顺序：显式配置 → 环境变量 → PATH → 常见安装位置；
 *   - Docker 镜像里 ffmpeg 在 /usr/bin/ffmpeg；Windows 可能在 PATH 或 D:\miniconda3\Library\bin。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

export interface BinaryResult {
  path: string
  version?: string
  source: 'config' | 'env' | 'path' | 'known-location'
}

/** Windows 上常见的安装位置（进程 PATH 可能早于这些工具安装，必须自己找一遍） */
function windowsKnown(): string[] {
  const local = process.env.LOCALAPPDATA ?? ''
  const roaming = process.env.APPDATA ?? ''
  const user = process.env.USERPROFILE ?? ''
  const list = [
    'C:\\ffmpeg\\bin',
    'C:\\Program Files\\ffmpeg\\bin',
    'D:\\miniconda3\\Library\\bin',
    'D:\\miniconda3\\Scripts',
    'C:\\ProgramData\\miniconda3\\Scripts',
    'C:\\ProgramData\\chocolatey\\bin',
    'C:\\Program Files\\Scoop\\shims',
    'C:\\tools',
  ]
  if (local !== '') {
    list.push(join(local, 'Microsoft', 'WinGet', 'Links'))
    list.push(join(local, 'Programs', 'Python', 'Scripts'))
  }
  if (roaming !== '') list.push(join(roaming, 'Python', 'Scripts'))
  if (user !== '') list.push(join(user, 'scoop', 'shims'))
  return list
}

const WINDOWS_KNOWN = windowsKnown()
const LINUX_KNOWN = ['/usr/bin', '/usr/local/bin', '/opt/ffmpeg/bin']

function knownDirs(): string[] {
  return process.platform === 'win32' ? WINDOWS_KNOWN : LINUX_KNOWN
}

function exeName(base: string): string {
  return process.platform === 'win32' ? base + '.exe' : base
}

/** 跑一次 `<bin> -version`，拿到就说明可用。 */
export function probeBinary(bin: string, args: string[] = ['-version']): Promise<string | undefined> {
  return new Promise(resolve => {
    let settled = false
    const finish = (value: string | undefined): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try {
      const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      child.stdout?.on('data', chunk => { out += String(chunk) })
      child.stderr?.on('data', chunk => { out += String(chunk) })
      child.on('error', () => finish(undefined))
      child.on('close', code => {
        if (code !== 0) return finish(undefined)
        finish(out.split('\n')[0]?.trim() || 'ok')
      })
      setTimeout(() => {
        try { child.kill() } catch { /* 忽略 */ }
        finish(undefined)
      }, 5000)
    } catch {
      finish(undefined)
    }
  })
}

/**
 * 解析一个外部可执行文件的位置。
 * @param name 基础名（如 ffmpeg）
 * @param configured 配置里写死的路径（可为空）
 * @param envVar 环境变量名（如 FFMPEG_PATH）
 */
export async function resolveBinary(name: string, configured = '', envVar = '', probeArgs: string[] = ['-version']): Promise<BinaryResult | undefined> {
  const candidates: Array<{ path: string; source: BinaryResult['source'] }> = []
  const file = exeName(name)
  if (configured.trim() !== '') candidates.push({ path: configured.trim(), source: 'config' })
  const fromEnv = envVar !== '' ? (process.env[envVar] ?? '').trim() : ''
  if (fromEnv !== '') candidates.push({ path: fromEnv, source: 'env' })
  candidates.push({ path: name, source: 'path' })
  for (const dir of knownDirs()) candidates.push({ path: join(dir, file), source: 'known-location' })

  for (const candidate of candidates) {
    if (candidate.source !== 'path' && !existsSync(candidate.path)) continue
    const version = await probeBinary(candidate.path, probeArgs)
    if (version !== undefined) return { path: candidate.path, version, source: candidate.source }
  }
  return undefined
}

export interface StoryboardDeps {
  ffmpeg?: BinaryResult
  ffprobe?: BinaryResult
}

export async function resolveStoryboardDeps(options: { ffmpegPath?: string } = {}): Promise<StoryboardDeps> {
  const ffmpeg = await resolveBinary('ffmpeg', options.ffmpegPath ?? '', 'FFMPEG_PATH')
  const ffprobe = await resolveBinary('ffprobe', '', 'FFPROBE_PATH')
  return { ffmpeg, ffprobe }
}

/** 跑一条 ffmpeg/ffprobe 命令，返回 stdout（失败抛错带 stderr 尾巴）。 */
export function runBinary(bin: string, args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* 忽略 */ }
      reject(new Error('命令超时（' + String(timeoutMs) + 'ms）: ' + bin))
    }, timeoutMs)
    child.stdout?.on('data', chunk => { out += String(chunk) })
    child.stderr?.on('data', chunk => { err += String(chunk) })
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) return resolve(out)
      reject(new Error(bin + ' 退出码 ' + String(code) + '：' + err.trim().split('\n').slice(-3).join(' | ')))
    })
  })
}
