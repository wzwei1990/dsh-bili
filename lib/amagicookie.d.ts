/** 文件 > profile 完整值 > 宿主传值（按“像完整 cookie”的程度挑） */
export declare function chooseCookie(fileValue: string, profileValue: string, passedValue: string): string;
export interface AmagiCookieResolverOptions {
    /** 配置键（amagiDouyinCookies / amagiBilibiliCookies） */
    key: string;
    /** 落盘文件绝对路径 */
    file: string;
    /** 宿主当前传进来的值（可能是被截断的第一行） */
    passed: () => string;
    log?: (level: 'debug' | 'info' | 'warn', message: string) => void;
}
/**
 * 创建一个活值解析器：每次调用都检查文件/profile 是否变化。
 * 返回空字符串表示没有配置。
 */
export declare function createAmagiCookieResolver(options: AmagiCookieResolverOptions): () => string;
