/**
 * 从 profile 的原始 cordis.patch.yml 里直接把 cookie 读出来（2026-11-05）。
 *
 * 背景：宿主把插件配置传过来时，多行 plain scalar（我们的 sessdata 是 14 行 cookie）
 * 会被截断（线上实测只拿到 15 / 24 个字符），导致登录永远失败。
 * 配置文件本身是完整的，所以这里绕过宿主，自己解析一遍：
 *   - 找到 `- id: dsh-bili` 块
 *   - 取 `sessdata:` 后面的值（含后续缩进续行，YAML plain scalar 的折叠写法）
 *   - 拼成一行
 *
 * 只在"宿主给的值看起来不完整"时使用，正常情况不生效。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** cookie 至少要这么长才算"像真的"（整段通常几百字符，只填 SESSDATA 值也有 200+） */
export const MIN_REAL_COOKIE_LENGTH = 100

export interface ProfileCookieResult {
  cookie: string
  /** 来源文件路径 */
  file: string
}

/** 从一段 YAML 文本里抽出 dsh-bili 的 sessdata（支持多行 plain scalar） */
/**
 * 从 YAML 里抽 dsh-bili 块下的某个标量（支持 plain scalar 折叠续行、块标量、引号）。
 * 宿主会把多行 plain scalar 传成截断值，所以直接读文件自愈。
 */
export function extractScalarFromYaml(text: string, key: string, pluginId = 'dsh-bili'): string {
  const lines = text.split(/\r?\n/)
  let blockStart = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (new RegExp('^\\s*-\\s*id:\\s*' + pluginId + '\\s*$').test(lines[i] ?? '')) {
      blockStart = i
      break
    }
  }
  if (blockStart < 0) return ''
  const keyPattern = new RegExp('^\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*(.*)$')
  let keyLine = -1
  let first = ''
  for (let i = blockStart + 1; i < Math.min(lines.length, blockStart + 600); i += 1) {
    const line = lines[i] ?? ''
    if (/^\s*-\s*id:/.test(line)) break
    const hit = keyPattern.exec(line)
    if (hit !== null) {
      keyLine = i
      first = hit[1] ?? ''
      break
    }
  }
  if (keyLine < 0) return ''
  const value = first.trim()
  // 块标量：| 或 >
  if (/^[|>][+-]?$/.test(value)) {
    const parts: string[] = []
    for (let i = keyLine + 1; i < Math.min(lines.length, keyLine + 400); i += 1) {
      const line = lines[i] ?? ''
      if (line.trim() === '') { parts.push(''); continue }
      if (!/^\s+/.test(line)) break
      parts.push(line.trim())
    }
    return parts.join(value.startsWith('>') ? ' ' : '\n').trim()
  }
  // 引号单行/多行：先剥引号
  const quoted = /^(["'])([\s\S]*)\1$/.exec(value)
  if (quoted !== null) {
    const body = quoted[2] ?? ''
    if (/[\r\n]/.test(body)) return body.replace(/\s*\r?\n\s*/g, ' ').trim()
    return body.trim()
  }
  const parts = [value]
  for (let i = keyLine + 1; i < Math.min(lines.length, keyLine + 400); i += 1) {
    const line = lines[i] ?? ''
    if (line.trim() === '') break
    if (/^\s*-\s*id:/.test(line)) break
    // 新 key（与块内缩进同级或更浅）就停；续行一般缩进更深
    if (/^\s*[\w-]+:\s/.test(line)) break
    parts.push(line.trim())
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/** 兼容旧调用：只抽 sessdata */
export function extractSessdataFromYaml(text: string, pluginId = 'dsh-bili'): string {
  return extractScalarFromYaml(text, 'sessdata', pluginId)
}

/** 在 DSH_HOME 下的所有 profile 里找 dsh-bili 的 sessdata */
export function readCookieFromProfiles(): ProfileCookieResult | undefined {
  const homeEnv = process.env.DSH_HOME
  const bases = [
    homeEnv !== undefined && homeEnv !== '' ? homeEnv : '',
    join(homedir(), '.dsh'),
  ].filter(base => base !== '')
  for (const home of [...new Set(bases)]) {
    const profilesDir = join(home, 'profiles')
    if (!existsSync(profilesDir)) continue
    let names: string[] = []
    try {
      names = readdirSync(profilesDir)
    } catch {
      continue
    }
    for (const name of names) {
      const file = join(profilesDir, name, 'cordis.patch.yml')
      if (!existsSync(file)) continue
      try {
        const cookie = extractSessdataFromYaml(readFileSync(file, 'utf8'))
        if (cookie.length >= MIN_REAL_COOKIE_LENGTH) return { cookie, file }
      } catch {
        // 读不了就换下一个
      }
    }
  }
  return undefined
}

/** 在 DSH_HOME 下的所有 profile 里找 dsh-bili 的某个标量（多行配置自愈用） */
export function readScalarFromProfiles(key: string, pluginId = 'dsh-bili'): string {
  const homeEnv = process.env.DSH_HOME
  const bases = [
    homeEnv !== undefined && homeEnv !== '' ? homeEnv : '',
    join(homedir(), '.dsh'),
  ].filter(base => base !== '')
  for (const home of [...new Set(bases)]) {
    const profilesDir = join(home, 'profiles')
    if (!existsSync(profilesDir)) continue
    let names: string[] = []
    try {
      names = readdirSync(profilesDir)
    } catch {
      continue
    }
    for (const name of names) {
      const file = join(profilesDir, name, 'cordis.patch.yml')
      if (!existsSync(file)) continue
      try {
        const text = readFileSync(file, 'utf8')
        const value = extractScalarFromYaml(text, key, pluginId)
        if (value !== '') return value
      } catch {
        // 忽略单个文件的读取失败
      }
    }
  }
  return ''
}
