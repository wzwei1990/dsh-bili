/**
 * B 站 WBI 签名（2023 起 `x/player/wbi/v2` 等接口要求）。
 *
 * 算法（公开）：从 `x/web-interface/nav` 拿 `wbi_img.img_url` 与 `sub_url` 的文件名，
 * 拼接后按固定混淆表取 32 位 mixinKey，再把参数按 key 排序 + urlencode 追加 `w_rid`、`wts`。
 */

/** 固定混淆表（64 个下标，官方前端同款）。 */
const MIXIN_KEY_ENC_TAB: readonly number[] = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

/** 从 img_url / sub_url 里取文件名主干（去扩展名）。 */
function keyOf(url: string): string {
  const file = url.split('/').pop() ?? ''
  const dot = file.lastIndexOf('.')
  return dot > 0 ? file.slice(0, dot) : file
}

/** 拼出 32 位 mixinKey。 */
export function mixinKey(imgUrl: string, subUrl: string): string {
  const raw = keyOf(imgUrl) + keyOf(subUrl)
  let out = ''
  for (const index of MIXIN_KEY_ENC_TAB) {
    const char = raw[index]
    if (char !== undefined) out += char
  }
  return out.slice(0, 32)
}

/**
 * 对参数签名。
 * @param params 业务参数（值会 String() 化）
 * @param imgKey 密钥对里的 img key
 * @param subKey 密钥对里的 sub key
 * @param now 当前秒级时间戳（测试可注入）
 * @returns 追加了 wts / w_rid 的查询串
 */
export function signQuery(
  params: Record<string, string | number>,
  imgKey: string,
  subKey: string,
  now = Math.floor(Date.now() / 1000),
): string {
  const mixin = mixinKey(imgKey, subKey)
  const wts = String(now)
  const sorted = Object.keys(params)
    .sort()
    .map(key => [key, String(params[key])] as const)
  // B 站要求值先过滤 !'()* 再 encode
  const query = sorted
    .map(([key, value]) => {
      const clean = value.replace(/[!'()*]/g, '')
      return encodeURIComponent(key) + '=' + encodeURIComponent(clean)
    })
    .join('&') + '&wts=' + wts
  const wRid = md5Hex(query + mixin)
  return query + '&w_rid=' + wRid
}

/** 纯 JS md5（Node 自带 crypto 更省事，这里直接用 crypto）。 */
import { createHash } from 'node:crypto'

export function md5Hex(text: string): string {
  return createHash('md5').update(text, 'utf8').digest('hex')
}
