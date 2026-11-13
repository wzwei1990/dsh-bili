export interface WatchOptions {
    /** cookie 落地文件（~/.dsh/dsh-bili/cookie.txt） */
    cookieFile: string;
    /** 轮询间隔，默认 5000ms */
    intervalMs?: number;
    log: (level: 'info' | 'warn', message: string) => void;
}
/**
 * 启动监听，返回停止函数（挂到 ctx.effect 的 disposer）。
 * 首次调用只记录指纹，不会重复写文件；之后只有真正变化才同步。
 */
export declare function watchProfileCookie(options: WatchOptions): () => void;
