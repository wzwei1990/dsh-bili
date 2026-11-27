/**
 * B 站 CDN 候选排序与探测（参考 karin-plugin-kkk #373，2026-11-19）。
 *
 * 背景：DASH 返回的 baseUrl 经常落在 PCDN 线路上（不稳定/易 403），
 * backup_url 里通常有官方 CDN。先排序、再用 32KB Range 探测，能显著减少
 * ffmpeg 直接上去 403/超时的情况。
 */

/** kkk 同款 PCDN 域名清单：这些线路优先级最低 */
const PCDN_HOST_RE =
  /(?:^|\.)(?:(?:mcdn|pcdn)\.bilivideo\.(?:cn|com)|szbdyd\.com|mountaintoys\.cn|h2\.smtcdns\.net|qrstuvwxyzab\.com|zhenidc\.cn)$/i

/** 官方 CDN：优先 */
const OFFICIAL_CDN_HOST_RE = /(?:^|\.)bilivideo\.(?:cn|com)$/i

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function score(url: string): number {
  const host = hostOf(url)
  if (OFFICIAL_CDN_HOST_RE.test(host)) return 0
  if (PCDN_HOST_RE.test(host)) return 2
  return 1
}

/** 去重 + 官方 CDN 优先、PCDN 最后（稳定排序，同分保持原顺序） */
export function rankBiliCandidates(urls: readonly string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const url of urls) {
    const value = url.trim()
    if (value === '' || seen.has(value)) continue
    seen.add(value)
    unique.push(value)
  }
  return unique
    .map((url, index) => ({ url, index, score: score(url) }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(item => item.url)
}

/** 32KB Range 探测（3 秒）；返回 true 表示这条线路当前可用 */
export async function probeBiliCandidate(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 3000,
): Promise<boolean> {
  try {
    const response = await fetch(url, {
      headers: { ...headers, Range: 'bytes=0-32767' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    // 206/200 都算可用；部分 CDN 对 HEAD 不支持，所以用范围 GET
    const ok = response.ok || response.status === 206
    try { await response.body?.cancel() } catch { /* 忽略 */ }
    return ok
  } catch {
    return false
  }
}

/**
 * 排序 + 探测，并告诉调用方是否有可用线路（false 时可直接走 amagi 兜底）。
 */
export async function probeBiliCandidates(
  urls: readonly string[],
  headers: Record<string, string>,
  options: { probeLimit?: number; timeoutMs?: number } = {},
): Promise<{ ordered: string[]; working: boolean }> {
  const ranked = rankBiliCandidates(urls)
  const limit = Math.max(1, options.probeLimit ?? 3)
  const timeoutMs = options.timeoutMs ?? 3000
  const working: string[] = []
  for (const url of ranked.slice(0, limit)) {
    if (await probeBiliCandidate(url, headers, timeoutMs)) working.push(url)
  }
  if (working.length === 0) return { ordered: ranked, working: false }
  return {
    ordered: [...working, ...ranked.filter(url => !working.includes(url))],
    working: true,
  }
}

/**
 * 排序后探测前 N 条，命中的提前；全部探测失败就按排序原样返回（交给上层再试）。
 */
export async function pickBiliCandidates(
  urls: readonly string[],
  headers: Record<string, string>,
  options: { probeLimit?: number; timeoutMs?: number } = {},
): Promise<string[]> {
  const ranked = rankBiliCandidates(urls)
  const limit = Math.max(1, options.probeLimit ?? 3)
  const probeTargets = ranked.slice(0, limit)
  const rest = ranked.slice(limit)
  const working: string[] = []
  for (const url of probeTargets) {
    if (await probeBiliCandidate(url, headers, options.timeoutMs ?? 3000)) working.push(url)
  }
  if (working.length === 0) return ranked
  // 可用的按原顺序排前面，未探测/失败的排后面
  return [...working, ...ranked.filter(url => !working.includes(url))]
}
