/**
 * 配置面：全部 volatile（改设置不重载插件），与 dsh-napcat 的做法一致。
 */
import z from '@deepseek-ai/schemastery';
// 不加 Z<ConfigShape> 注解：.volatile() 会把字段推断成 Volatile<T>，强注解反而报错（与 dsh-napcat 一致的做法）
export const Config = z.object({
    sessdata: z.string().role('secret').default('')
        .description('B 站 SESSDATA（可选；从浏览器 cookie 里取，公开视频不填也能解析，但部分字幕需要登录）').volatile(),
    timeoutMs: z.natural().min(3000).max(120000).default(15000)
        .description('单次请求超时（毫秒）').volatile(),
    subtitleMaxChars: z.natural().default(6000)
        .description('字幕正文最多返回多少字符（超出截断）').volatile(),
    cacheTtlMinutes: z.natural().default(1440)
        .description('视频信息与字幕缓存有效期（分钟，0=不缓存）').volatile(),
    logLevel: z.union([z.const('debug'), z.const('info'), z.const('warn')]).default('info')
        .description('日志级别').volatile(),
});
export const DEFAULTS = {
    sessdata: '',
    timeoutMs: 15000,
    subtitleMaxChars: 6000,
    cacheTtlMinutes: 1440,
    logLevel: 'info',
};
/** volatile 字段可能没有默认值，统一内置默认补一遍。 */
export function resolveConfig(input) {
    const merged = { ...DEFAULTS };
    const source = input ?? {};
    for (const key of Object.keys(DEFAULTS)) {
        const value = source[key];
        if (value === undefined || value === null)
            continue;
        if (key === 'logLevel') {
            if (value === 'debug' || value === 'info' || value === 'warn')
                merged.logLevel = value;
            continue;
        }
        if (key === 'sessdata') {
            merged.sessdata = String(value);
            continue;
        }
        const numeric = Number(value);
        if (Number.isFinite(numeric))
            merged[key] = Math.max(0, Math.floor(numeric));
    }
    return merged;
}
