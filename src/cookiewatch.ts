/**
 * 设置页保存后"立即"把 cookie 同步进 cookie.txt（2026-11-13）。
 *
 * 背景：原来只在插件初始化（apply）时同步一次。用户在设置页改 SESSDATA 后，
 * 宿主只写 profile 的 cordis.patch.yml，并不会重跑 apply —— 于是 cookie.txt
 * 还是旧值，bili_doctor 报"未登录"，用户以为保存失败。
 *
 * 做法：低频轮询 profile 配置文件（默认 5s），只在 mtime/size 变化时才解析，
 * 发现值变了就写进 cookie 文件。开销只有一次 stat，不读文件内容。
 */
import { statSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { readCookieFromProfiles, MIN_REAL_COOKIE_LENGTH } from './profilecookie.js'

export interface WatchOptions {
  /** cookie 落地文件（~/.dsh/dsh-bili/cookie.txt） */
  cookieFile: string
  /** 轮询间隔，默认 5000ms */
  intervalMs?: number
  log: (level: 'info' | 'warn', message: string) => void
  /**
   * 文件写入成功后回调新 cookie。
   * 只写文件不够：运行中的 BiliClient / SearchClient / CommentClient 都各持一份 cookie，
   * 不热更新的话设置页改完仍然用旧值（实测 doctor 仍报"未登录"），必须重启才生效。
   */
  onCookie?: (cookie: string) => void
}

interface Stamp {
  file: string
  mtimeMs: number
  size: number
}

/** profile 配置文件的 mtime+size 指纹（找不到就返回空表） */
function stampOf(profileFiles: readonly string[]): Stamp[] {
  const out: Stamp[] = []
  for (const file of profileFiles) {
    try {
      const st = statSync(file)
      out.push({ file, mtimeMs: st.mtimeMs, size: st.size })
    } catch {
      // 文件不存在（profile 没这个插件）就跳过
    }
  }
  return out
}

function sameStamps(a: readonly Stamp[], b: readonly Stamp[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!
    const y = b[i]!
    if (x.file !== y.file || x.mtimeMs !== y.mtimeMs || x.size !== y.size) return false
  }
  return true
}

/**
 * 启动监听，返回停止函数（挂到 ctx.effect 的 disposer）。
 * 首次调用只记录指纹，不会重复写文件；之后只有真正变化才同步。
 */
export function watchProfileCookie(options: WatchOptions): () => void {
  const { cookieFile, log } = options
  const intervalMs = Math.max(1000, options.intervalMs ?? 5000)
  let stamps: Stamp[] = []
  let lastWritten = ''

  const currentFiles = (): string[] => {
    const probe = readCookieFromProfiles()
    return probe === undefined ? [] : [probe.file]
  }

  // 初始指纹：包含所有可能存在的 profile 文件
  const known = [
    ...currentFiles(),
    ...['web', 'desktop'].map(p =>
      `${process.env.HOME ?? ''}/.dsh/profiles/${p}/cordis.patch.yml`.replace(/^\/?/, ''),
    ),
  ].filter(f => f !== '')
  stamps = stampOf(known)

  const timer = setInterval(() => {
    try {
      // 目录里可能新增 profile 文件，所以每轮重新枚举一次（stat 成本极低）
      const files = Array.from(new Set([...known, ...currentFiles()]))
      const next = stampOf(files)
      if (sameStamps(stamps, next)) return
      stamps = next
      const probe = readCookieFromProfiles()
      if (probe === undefined) return
      const cookie = probe.cookie.trim()
      if (cookie.length < MIN_REAL_COOKIE_LENGTH || cookie === lastWritten) return
      try {
        mkdirSync(dirname(cookieFile), { recursive: true })
        writeFileSync(cookieFile, cookie + '\n', 'utf8')
        lastWritten = cookie
        log('info', '设置页 cookie 已变化 → 已同步到 ' + cookieFile + '（长度 ' + String(cookie.length) + '）')
        // 关键：同时刷新运行中的客户端，否则设置页改完仍用旧 cookie，必须重启才生效
        try {
          options.onCookie?.(cookie)
          log('info', '已将新 cookie 热更新到运行中的客户端（无需重启）')
        } catch (error) {
          log('warn', '热更新客户端 cookie 失败: ' + (error instanceof Error ? error.message : String(error)))
        }
      } catch (error) {
        log('warn', '同步 cookie 文件失败: ' + (error instanceof Error ? error.message : String(error)))
      }
    } catch {
      // 轮询失败不该影响插件主干
    }
  }, intervalMs)
  // Node 里 unref 让定时器不阻止进程退出
  ;(timer as unknown as { unref?: () => void }).unref?.()

  return () => clearInterval(timer)
}
