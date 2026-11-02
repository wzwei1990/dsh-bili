/**
 * B 站 WBI 签名（2023 起 `x/player/wbi/v2` 等接口要求）。
 *
 * 算法（公开）：从 `x/web-interface/nav` 拿 `wbi_img.img_url` 与 `sub_url` 的文件名，
 * 拼接后按固定混淆表取 32 位 mixinKey，再把参数按 key 排序 + urlencode 追加 `w_rid`、`wts`。
 */
/** 拼出 32 位 mixinKey。 */
export declare function mixinKey(imgUrl: string, subUrl: string): string;
/**
 * 对参数签名。
 * @param params 业务参数（值会 String() 化）
 * @param imgKey 密钥对里的 img key
 * @param subKey 密钥对里的 sub key
 * @param now 当前秒级时间戳（测试可注入）
 * @returns 追加了 wts / w_rid 的查询串
 */
export declare function signQuery(params: Record<string, string | number>, imgKey: string, subKey: string, now?: number): string;
export declare function md5Hex(text: string): string;
