export interface WatchOptions {
    /** cookie 落地文件（~/.dsh/dsh-bili/cookie.txt） */
    cookieFile: string;
    /** 轮询间隔，默认 5000ms */
    intervalMs?: number;
    log: (level: 'info' | 'warn', message: string) => void;
    /**
     * 文件写入成功后回调新 cookie。
     * 只写文件不够：运行中的 BiliClient / SearchClient / CommentClient 都各持一份 cookie，
     * 不热更新的话设置页改完仍然用旧值（实测 doctor 仍报"未登录"），必须重启才生效。
     */
    onCookie?: (cookie: string) => void;
}
/**
 * 启动监听，返回停止函数（挂到 ctx.effect 的 disposer）。
 * 首次调用只记录指纹，不会重复写文件；之后只有真正变化才同步。
 */
export declare function watchProfileCookie(options: WatchOptions): () => void;
