/**
 * Cookie 滚动刷新（2026-11-26）。
 *
 * 背景：B 站会通过 `Set-Cookie` 滚动刷新 SESSDATA / bili_jct 等值。网页一直在用新值，
 * 而我们从浏览器复制的那一份会先失效 —— 用户看到的是"网页没失效，插件说失效"。
 *
 * 做法：每次接口响应都读 `Set-Cookie`，只合并白名单里的登录相关字段，回写内存 + 文件，
 * 这样插件自己会跟上 B 站的滚动，不需要用户反复复制。
 */

/** 需要跟随刷新的字段（其余 cookie 不碰，避免把别人的会话混进来） */
export const REFRESHABLE_COOKIE_KEYS = [
  'SESSDATA',
  'bili_jct',
  'DedeUserID',
  'DedeUserID__ckMd5',
  'buvid3',
  'buvid4',
  'b_nut',
  'b_lsid',
  '_uuid',
  'bili_ticket',
  'bili_ticket_expires',
  'sid',
] as const

const ALLOWED = new Set<string>(REFRESHABLE_COOKIE_KEYS)

export interface MergeResult {
  cookie: string
  changed: boolean
}

function parsePairs(cookie: string): Map<string, string> {
  const pairs = new Map<string, string>()
  for (const raw of cookie.split(';')) {
    const pair = raw.trim()
    if (pair === '') continue
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    pairs.set(pair.slice(0, eq).trim(), pair.slice(eq + 1))
  }
  return pairs
}

function serialize(pairs: Map<string, string>): string {
  return [...pairs.entries()].map(([name, value]) => name + '=' + value).join('; ')
}

/**
 * 把 Set-Cookie 头合并进现有 cookie。
 * @param current 现有 cookie（形如 `SESSDATA=x; bili_jct=y`）
 * @param setCookies 响应里的 Set-Cookie 原始行（可能带 Path/Expires 等属性）
 */
export function mergeSetCookie(current: string, setCookies: readonly string[]): MergeResult {
  if (setCookies.length === 0) return { cookie: current, changed: false }
  const pairs = parsePairs(current)
  let changed = false
  for (const line of setCookies) {
    // 只取第一段 name=value，后面是 Path/Expires/Secure 等属性
    const first = line.split(';')[0]?.trim() ?? ''
    const eq = first.indexOf('=')
    if (eq <= 0) continue
    const name = first.slice(0, eq).trim()
    const value = first.slice(eq + 1)
    if (!ALLOWED.has(name)) continue
    if (value === '' || value === 'deleted') continue
    if (pairs.get(name) === value) continue
    pairs.set(name, value)
    changed = true
  }
  return { cookie: changed ? serialize(pairs) : current, changed }
}
