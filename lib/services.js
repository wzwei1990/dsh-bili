/**
 * 分镜服务：把"一个视频"变成"一张图 + 时间轴"。
 *
 * 输入三种来源：
 *   ① B 站链接 → 走官方 playurl 直连流（不需要下载器，省时省盘）
 *   ② 其它网站链接 → 有 yt-dlp 就下载后抽帧；没有就明确报"不支持"
 *   ③ 本地文件（群友上传的视频）→ 直接抽帧
 *
 * 产物落在 ~/.dsh/dsh-bili/storyboards/ 下（持久），方便通道发图/模型引用。
 */
import { mkdir, mkdtemp } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveStoryboardDeps } from './deps.js';
import { buildStoryboard, findStoryboardFont } from './storyboard.js';
import { pickBiliCandidates, probeBiliCandidates, rankBiliCandidates } from './cdn.js';
import { fetchBiliPlayUrls } from './amagi.js';
import { downloadParallel } from './download.js';
import { downloadWithYtDlp, isGenericVideoUrl, resolveYtDlp, cleanupDownload } from './ytdlp.js';
export class StoryboardService {
    options;
    cachedDeps;
    cachedYtDlp;
    ytdlpProbed = false;
    constructor(options) {
        this.options = options;
    }
    outputRoot() {
        if (this.options.outputRoot !== undefined && this.options.outputRoot !== '')
            return this.options.outputRoot;
        const dshHome = process.env.DSH_HOME;
        const base = dshHome !== undefined && dshHome !== '' ? dshHome : join(homedir(), '.dsh');
        return join(base, 'dsh-bili', 'storyboards');
    }
    async depsStatus() {
        const deps = await this.ensureDeps();
        const ytdlp = await this.ensureYtDlp();
        return {
            ffmpeg: deps.ffmpeg?.path,
            ffprobe: deps.ffprobe?.path,
            ytdlp: ytdlp === '' ? undefined : ytdlp,
            font: findStoryboardFont(),
        };
    }
    async ensureDeps() {
        if (this.cachedDeps !== undefined)
            return this.cachedDeps;
        this.cachedDeps = await resolveStoryboardDeps({ ffmpegPath: this.options.ffmpegPath });
        return this.cachedDeps;
    }
    async ensureYtDlp() {
        if (this.ytdlpProbed)
            return this.cachedYtDlp ?? '';
        this.ytdlpProbed = true;
        const found = await resolveYtDlp(this.options.ytdlpPath);
        this.cachedYtDlp = found?.path ?? '';
        return this.cachedYtDlp;
    }
    /**
     * 生成分镜。失败抛错，由调用方决定是否降级。
     * @param input B 站链接 / 通用链接 / 本地路径
     */
    async build(input) {
        if (!this.options.enabled)
            throw new Error('分镜未启用（配置 storyboard=false）');
        const deps = await this.ensureDeps();
        if (deps.ffmpeg === undefined)
            throw new Error('没有找到 ffmpeg：请安装它，或在设置里填 ffmpegPath');
        const trimmed = input.trim();
        const outDir = this.outputRoot();
        await mkdir(outDir, { recursive: true });
        // ① 本地文件（BV/av 号不算：那是 B 站视频 id，走下面的官方流）
        const isBiliId = /^(BV[0-9A-Za-z]{10}|av\d{1,12})$/i.test(trimmed);
        if (!/^https?:\/\//i.test(trimmed) && !isBiliId) {
            return this.buildFromFile(trimmed, deps);
        }
        // ② B 站（链接或 BV/av 号）：官方直连流（快，不落盘整段）
        if (isBiliId || !isGenericVideoUrl(trimmed)) {
            try {
                const stream = await this.options.client.streamUrl(trimmed);
                // 配了 amagi 就优先走它（约 22s 稳定成功）；失败/未配置再试直连 DASH
                if (this.options.amagiBaseUrl !== undefined && this.options.amagiBaseUrl !== '') {
                    const fallback = await this.tryAmagiFallback(stream.info, stream.headers, Date.now() + 60_000);
                    if (fallback !== undefined)
                        return fallback;
                }
                const probe = await probeBiliCandidates(stream.candidates.length > 0 ? stream.candidates : [stream.url], stream.headers, { probeLimit: 2, timeoutMs: 2000 });
                return await this.buildFromBiliStream({
                    ...stream,
                    candidates: probe.ordered,
                    maxCandidates: 2,
                    perAttemptTimeoutMs: 12_000,
                    deadlineAt: Date.now() + 25_000,
                });
            }
            catch (error) {
                // B 站链接**不再**退回 yt-dlp：机房 IP 上它必被 412 拦，实测一次要卡 141 秒，
                // 而这条延迟会直接拖死群里的回复。失败就快速报错，让上层只用弹幕/字幕。
                if (/bilibili\.com|b23\.tv/i.test(trimmed) || isBiliId) {
                    throw new Error('B 站直连抽帧失败（' + (error instanceof Error ? error.message : String(error)) + '）：跳过 yt-dlp（机房 IP 会被 412 拦）');
                }
                this.options.log('warn', 'B 站直连抽帧失败，尝试 yt-dlp: ' + (error instanceof Error ? error.message : String(error)));
                // 落到下面的 yt-dlp 路径
            }
        }
        // ③ 其它链接（或 B 站直连失败）：需要 yt-dlp
        const ytdlp = await this.ensureYtDlp();
        if (ytdlp === '')
            throw new Error('这个链接需要 yt-dlp（未安装）。B 站链接不需要它');
        const tmp = await mkdtemp(join(outDir, 'dl-'));
        try {
            const downloadTarget = isBiliId ? 'https://www.bilibili.com/video/' + trimmed : trimmed;
            const downloaded = await downloadWithYtDlp(downloadTarget, {
                bin: ytdlp,
                dir: tmp,
                maxDurationSec: this.options.maxMinutes > 0 ? this.options.maxMinutes * 60 : undefined,
            });
            const outcome = await this.buildFromFile(downloaded.filePath, deps, outDir);
            return { ...outcome, source: 'ytdlp' };
        }
        finally {
            await cleanupDownload(tmp);
        }
    }
    /** 对本地视频文件生成分镜（amagi 兜底下载后使用） */
    async buildFromLocalFile(filePath) {
        const deps = await this.ensureDeps();
        if (deps.ffmpeg === undefined)
            throw new Error('没有找到 ffmpeg：请安装它，或在设置里填 ffmpegPath');
        return this.buildFromFile(filePath, deps);
    }
    /**
     * 快速分镜（给 napcat 主动发言用）：B 站只试 1 个候选、单次 12 秒；
     * 失败就返回错误，不做多镜像重试，避免把群聊回复拖到 20 秒以上。
     */
    async buildQuick(input) {
        if (!this.options.enabled)
            throw new Error('分镜未启用（配置 storyboard=false）');
        const started = Date.now();
        const trimmed = input.trim();
        const isBiliId = /^(BV[0-9A-Za-z]{10}|av\d{1,12})$/i.test(trimmed);
        if (!/^https?:\/\//i.test(trimmed) && !isBiliId)
            return this.buildFromLocalFile(trimmed);
        if (isBiliId || !isGenericVideoUrl(trimmed)) {
            const stream = await this.options.client.streamUrl(trimmed);
            const first = stream.candidates[0] ?? stream.url;
            try {
                return await this.buildFromBiliStream({
                    info: stream.info,
                    url: first,
                    candidates: [first],
                    ...(stream.audioUrl === undefined ? {} : { audioUrl: stream.audioUrl }),
                    headers: stream.headers,
                    maxCandidates: 2,
                    perAttemptTimeoutMs: 8_000,
                    deadlineAt: started + 10_000,
                });
            }
            catch (directError) {
                // 并行下载把 amagi 兜底压到 ~10s；给它 18s 总预算，仍要留出 napcat 的余量
                if (this.options.amagiBaseUrl !== undefined && this.options.amagiBaseUrl !== '' && Date.now() - started < 12_000) {
                    const fallback = await this.tryAmagiFallback(stream.info, stream.headers, started + 18_000);
                    if (fallback !== undefined)
                        return fallback;
                }
                throw directError;
            }
        }
        return this.buildFromLocalFile(await (async () => {
            const downloaded = await import('./ytdlp.js').then(async (module) => {
                const bin = await this.ensureYtDlp();
                if (bin === '')
                    throw new Error('这个链接需要 yt-dlp（未安装）');
                const { mkdtemp } = await import('node:fs/promises');
                const { join } = await import('node:path');
                const { tmpdir } = await import('node:os');
                return await module.downloadWithYtDlp(trimmed, { bin, dir: await mkdtemp(join(tmpdir(), 'bili-quick-')) });
            });
            return downloaded.filePath;
        })());
    }
    async buildFromFile(filePath, deps, outDir) {
        const out = outDir ?? this.outputRoot();
        await mkdir(out, { recursive: true });
        const workDir = await mkdtemp(join(out, 'work-'));
        const result = await buildStoryboard({
            streamUrl: filePath,
            audioUrl: filePath,
            frames: this.options.frames,
            deps,
            workDir,
        });
        this.assertDuration(result.durationSec);
        const imagePath = await this.persist(result.imagePath, out, 'file');
        return {
            imagePath,
            title: filePath.split(/[\\/]/).pop() ?? filePath,
            durationSec: result.durationSec,
            width: result.width,
            height: result.height,
            timeline: result.timeline,
            withWaveform: result.withWaveform,
            source: 'file',
        };
    }
    /** 把底层错误翻译成用户能行动的提示 */
    explain(error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('412') || message.includes('风控')) {
            return new Error(message + ' —— 机房/云服务器 IP 容易被风控，配置 SESSDATA（登录态）后基本可以绕过');
        }
        if (message.includes('403')) {
            return new Error(message + ' —— 视频流地址被 CDN 拒绝，常见于未登录或签名过期；配置 SESSDATA 可提高成功率');
        }
        return error instanceof Error ? error : new Error(message);
    }
    assertDuration(durationSec) {
        const limit = this.options.maxMinutes * 60;
        if (limit > 0 && durationSec > limit) {
            throw new Error('视频太长（' + Math.round(durationSec / 60) + ' 分钟 > 上限 ' + this.options.maxMinutes + ' 分钟），跳过抽帧');
        }
    }
    /** 把临时目录里的成品图挪到稳定目录（work dir 会被随机命名） */
    /**
     * 用**已经取到的** B 站直连流生成分镜。
     * analyzeBili 先 streamUrl 抽音频，再调这里复用同一个流；否则二次 playurl 会拿到 403 的地址。
     */
    async buildFromBiliStream(input) {
        if (!this.options.enabled)
            throw new Error('分镜未启用（配置 storyboard=false）');
        const deps = await this.ensureDeps();
        if (deps.ffmpeg === undefined)
            throw new Error('没有找到 ffmpeg：请安装它，或在设置里填 ffmpegPath');
        this.assertDuration(input.info.durationSec);
        const outDir = this.outputRoot();
        await mkdir(outDir, { recursive: true });
        // B 站 CDN 部分镜像会被风控（403/567），DASH 的 baseUrl/backupUrl 逐个试
        const rawCandidates = input.candidates !== undefined && input.candidates.length > 0 ? input.candidates : [input.url];
        const maxCandidates = Math.max(1, input.maxCandidates ?? 6);
        // 参考 kkk #373：官方 CDN 优先 + 32KB 探测；快速路径（1 条）只排序不探测，省时间
        const candidates = (maxCandidates === 1
            ? rankBiliCandidates(rawCandidates).slice(0, 1)
            : (await pickBiliCandidates(rawCandidates, input.headers, { probeLimit: Math.min(3, maxCandidates), timeoutMs: 2500 })).slice(0, maxCandidates));
        const audioCandidates = input.audioCandidates !== undefined && input.audioCandidates.length > 0
            ? input.audioCandidates.slice(0, 4)
            : (input.audioUrl === undefined ? [] : [input.audioUrl]);
        let lastError;
        for (const streamUrl of candidates) {
            try {
                const workDir = await mkdtemp(join(outDir, 'work-'));
                const result = await buildStoryboard({
                    streamUrl,
                    ...(audioCandidates[0] === undefined ? {} : { audioUrl: audioCandidates[0] }),
                    headers: input.headers,
                    frames: this.options.frames,
                    deps,
                    workDir,
                    ...(input.perAttemptTimeoutMs === undefined ? {} : { timeoutMs: input.perAttemptTimeoutMs }),
                    ...(input.deadlineAt === undefined ? {} : { deadlineAt: input.deadlineAt }),
                });
                const imagePath = await this.persist(result.imagePath, outDir, 'bili-' + input.info.bvid);
                return {
                    imagePath,
                    title: input.info.title,
                    durationSec: input.info.durationSec,
                    width: result.width,
                    height: result.height,
                    timeline: result.timeline,
                    withWaveform: result.withWaveform,
                    source: 'bili',
                };
            }
            catch (error) {
                lastError = error;
                this.options.log('debug', 'B 站分镜：候选流失败，换下一个 (' + new URL(streamUrl).host + ')');
            }
        }
        throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
    /** amagi 兜底：取 durl mp4 → 分段并行下载到本地 → 本地抽帧（不依赖 CDN 的 seek） */
    async tryAmagiFallback(info, headers, deadlineAt) {
        const baseUrl = this.options.amagiBaseUrl ?? '';
        if (baseUrl === '')
            return undefined;
        try {
            const cookie = this.options.amagiBilibiliCookies?.() ?? '';
            const play = await fetchBiliPlayUrls({ avid: info.aid, cid: info.cid }, {
                baseUrl,
                ...(cookie === '' ? {} : { cookie }),
            });
            const url = play.urls[0];
            if (url === undefined)
                return undefined;
            const { mkdtemp } = await import('node:fs/promises');
            const workDir = await mkdtemp(join(this.outputRoot(), 'amagi-'));
            const local = join(workDir, 'video.mp4');
            const budget = Math.max(5000, (deadlineAt ?? Date.now() + 60_000) - Date.now());
            await downloadParallel(url, headers, local, { deadlineAt: deadlineAt ?? Date.now() + 60_000, timeoutMs: Math.min(15_000, budget) });
            const outcome = await this.buildFromLocalFile(local);
            // 兜底产物是本地文件，标题/来源沿用视频信息，避免显示成 video.mp4
            return { ...outcome, title: info.title, source: 'bili' };
        }
        catch (error) {
            this.options.log('debug', 'B 站分镜 amagi 兜底失败: ' + (error instanceof Error ? error.message : String(error)));
            return undefined;
        }
    }
    async persist(sourcePath, outDir, prefix) {
        const { copyFile, mkdir } = await import('node:fs/promises');
        await mkdir(outDir, { recursive: true });
        const target = join(outDir, prefix + '-' + Date.now() + '.png');
        await copyFile(sourcePath, target);
        return target;
    }
}
