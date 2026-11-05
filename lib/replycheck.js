/** 检查所有（或指定）监听，推进游标，返回增量 */
export async function checkReplyWatches(options) {
    const all = options.watches.list();
    const targets = options.only === undefined || options.only === ''
        ? all
        : all.filter(item => item.id === options.only);
    const results = [];
    for (const watch of targets) {
        try {
            const items = [];
            let newest = watch.lastSeenRpid;
            if (watch.root > 0) {
                const page = await options.comments.readReplies(watch.bvid, watch.root, 1, { fromEnd: true });
                for (const item of page.items) {
                    if (item.rpid <= watch.lastSeenRpid)
                        continue;
                    newest = Math.max(newest, item.rpid);
                    items.push(item);
                }
            }
            else {
                const page = await options.comments.read(watch.bvid, { page: 1, sort: 0, pageSize: 20 });
                for (const item of page.items) {
                    if (item.rpid <= watch.lastSeenRpid)
                        continue;
                    newest = Math.max(newest, item.rpid);
                    items.push(item);
                }
            }
            options.watches.touch(watch.id, newest);
            // 按时间正序（旧→新）更像聊天记录
            items.sort((a, b) => a.ctime - b.ctime);
            results.push({ watch, items });
        }
        catch (error) {
            const outcome = options.watches.markFailure(watch.id);
            options.log?.('warn', '回复监听检查失败 ' + watch.id + '：' + (error instanceof Error ? error.message : String(error)));
            results.push({
                watch,
                items: [],
                error: error instanceof Error ? error.message : String(error),
                ...(outcome.removed ? { removed: true } : {}),
            });
        }
    }
    return results;
}
/** 把增量格式化成一段人可读的文本（私聊通知用） */
export function formatReplyCheck(results, options = {}) {
    const max = options.max ?? 5;
    const lines = [];
    let total = 0;
    for (const result of results) {
        if (result.items.length === 0)
            continue;
        total += result.items.length;
        const head = options.title !== undefined && options.title !== ''
            ? options.title
            : '你监听的评论有新回复';
        lines.push('【' + head + '】' + result.watch.bvid + (result.watch.root > 0 ? '  rpid=' + String(result.watch.root) : ''));
        for (const item of result.items.slice(0, max)) {
            lines.push('· ' + (item.author.name || '匿名') + '：' + item.message.replace(/\n+/g, ' ').slice(0, 120));
        }
        if (result.items.length > max)
            lines.push('… 还有 ' + String(result.items.length - max) + ' 条');
    }
    if (lines.length === 0)
        return '';
    return lines.join('\n') + '\n（https://www.bilibili.com/video/' + (results.find(result => result.items.length > 0)?.watch.bvid ?? '') + '）';
}
