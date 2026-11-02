/**
 * 极简 HTTP 层：只做 B 站接口需要的三件事 —— 带 UA/Referer/cookie、超时、错误归类。
 * 不引第三方依赖，Node 22 自带 fetch 足够。
 */
declare const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
declare const REFERER = "https://www.bilibili.com/";
export interface HttpOptions {
    /** 形如 `SESSDATA=xxx`，留空表示未登录 */
    cookie?: string;
    timeoutMs?: number;
    headers?: Record<string, string>;
}
/** 网络/接口错误：带状态码与 B 站业务码，方便上层给模型一句人话。 */
export declare class HttpError extends Error {
    readonly status?: number | undefined;
    readonly code?: number | undefined;
    constructor(message: string, status?: number | undefined, code?: number | undefined);
}
/** 取 JSON；网络失败/超时/非 2xx 统一抛 HttpError。 */
export declare function getJson<T>(url: string, options?: HttpOptions): Promise<T>;
/** 跟随短链（b23.tv）拿到最终地址；失败时返回原地址，由上层再判断。 */
export declare function followRedirect(url: string, options?: HttpOptions): Promise<string>;
export { REFERER, UA };
