/**
 * 并行分段下载（B 站 CDN / amagi 的 mp4 都支持 Range）。
 *
 * 背景：单连接下载 10MB 实测 ~17s，拖垮 napcat 的 20s 预算；
 * 分段并发（参考 karin-plugin-kkk #373）可以压到几秒。
 * 任何分段失败都回退到单连接整体下载，保证正确性。
 */
import { open } from 'node:fs/promises'

export interface ParallelDownloadOptions {
  /** 并发段数（默认 4） */
  concurrency?: number
  /** 每段超时（毫秒，默认 15000） */
  timeoutMs?: number
  /** 小于这个体积就单连接下载（默认 4MB） */
  minParallelBytes?: number
  /** 整体截止时间（ms 时间戳）；超过就不再发起新请求 */
  deadlineAt?: number
}

function parseTotal(contentRange: string | null): number {
  if (contentRange === null) return 0
  const hit = /\/(\d+)\s*$/.exec(contentRange)
  return hit?.[1] === undefined ? 0 : Number(hit[1])
}

function remainingMs(deadlineAt: number | undefined): number {
  return deadlineAt === undefined ? Number.POSITIVE_INFINITY : deadlineAt - Date.now()
}

async function fetchBuffer(url: string, headers: Record<string, string>, range: string | undefined, timeoutMs: number): Promise<Buffer> {
  const response = await fetch(url, {
    headers: range === undefined ? headers : { ...headers, Range: range },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok && response.status !== 206) throw new Error('HTTP ' + String(response.status))
  return Buffer.from(await response.arrayBuffer())
}

/** 单连接下载（回退路径） */
async function downloadSingle(
  url: string,
  headers: Record<string, string>,
  filePath: string,
  timeoutMs: number,
): Promise<number> {
  const buffer = await fetchBuffer(url, headers, undefined, timeoutMs)
  const { writeFile } = await import('node:fs/promises')
  await writeFile(filePath, buffer)
  return buffer.byteLength
}

/** 分段并行下载；失败自动回退单连接 */
export async function downloadParallel(
  url: string,
  headers: Record<string, string>,
  filePath: string,
  options: ParallelDownloadOptions = {},
): Promise<number> {
  const concurrency = Math.max(1, Math.min(8, options.concurrency ?? 4))
  const timeoutMs = options.timeoutMs ?? 15_000
  const minParallel = options.minParallelBytes ?? 4 * 1024 * 1024

  // 先探测总大小（Range 0-0）
  let total = 0
  try {
    const probe = await fetch(url, {
      headers: { ...headers, Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(Math.min(timeoutMs, Math.max(1000, remainingMs(options.deadlineAt)))),
    })
    total = parseTotal(probe.headers.get('content-range'))
    try { await probe.body?.cancel() } catch { /* 忽略 */ }
  } catch {
    total = 0
  }

  if (total <= 0 || total < minParallel) {
    return await downloadSingle(url, headers, filePath, timeoutMs)
  }

  const chunkSize = Math.max(1024 * 1024, Math.ceil(total / concurrency))
  const ranges: Array<{ start: number; end: number }> = []
  for (let start = 0; start < total; start += chunkSize) {
    ranges.push({ start, end: Math.min(total - 1, start + chunkSize - 1) })
  }

  const handle = await open(filePath, 'w')
  try {
    await handle.truncate(total)
    await Promise.all(ranges.map(async ({ start, end }) => {
      const budget = Math.min(timeoutMs, remainingMs(options.deadlineAt))
      if (budget <= 0) throw new Error('并行下载超出时间预算')
      const buffer = await fetchBuffer(url, headers, 'bytes=' + String(start) + '-' + String(end), budget)
      const expected = end - start + 1
      if (buffer.byteLength !== expected) throw new Error('分段长度不符：' + String(buffer.byteLength) + '/' + String(expected))
      await handle.write(buffer, 0, buffer.byteLength, start)
    }))
    return total
  } catch (error) {
    try { await handle.close() } catch { /* 忽略 */ }
    // 分段失败：回退单连接
    return await downloadSingle(url, headers, filePath, timeoutMs)
  } finally {
    try { await handle.close() } catch { /* 忽略 */ }
  }
}
