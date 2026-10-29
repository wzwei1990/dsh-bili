/**
 * 极简 HTTP 层：只做 B 站接口需要的三件事 —— 带 UA/Referer/cookie、超时、错误归类。
 * 不引第三方依赖，Node 22 自带 fetch 足够。
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const REFERER = 'https://www.bilibili.com/'

export interface HttpOptions {
  /** 形如 `SESSDATA=xxx`，留空表示未登录 */
  cookie?: string
  timeoutMs?: number
  headers?: Record<string, string>
}

/** 网络/接口错误：带状态码与 B 站业务码，方便上层给模型一句人话。 */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: number,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

function headersOf(options: HttpOptions): Record<string, string> {
  const out: Record<string, string> = {
    'User-Agent': UA,
    Referer: REFERER,
    Accept: 'application/json, text/plain, */*',
    ...(options.headers ?? {}),
  }
  const cookie = (options.cookie ?? '').trim()
  if (cookie !== '') out.Cookie = cookie
  return out
}

/** 取 JSON；网络失败/超时/非 2xx 统一抛 HttpError。 */
export async function getJson<T>(url: string, options: HttpOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 15000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { headers: headersOf(options), signal: controller.signal })
    if (!response.ok) throw new HttpError('HTTP ' + String(response.status), response.status)
    return await response.json() as T
  } catch (error) {
    if (error instanceof HttpError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new HttpError(controller.signal.aborted ? '请求超时（' + String(timeoutMs) + 'ms）' : message)
  } finally {
    clearTimeout(timer)
  }
}

/** 跟随短链（b23.tv）拿到最终地址；失败时返回原地址，由上层再判断。 */
export async function followRedirect(url: string, options: HttpOptions = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 15000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      headers: headersOf(options),
      redirect: 'follow',
      signal: controller.signal,
    })
    return response.url === '' ? url : response.url
  } catch {
    return url
  } finally {
    clearTimeout(timer)
  }
}

export { REFERER, UA }
