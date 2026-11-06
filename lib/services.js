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
                const { info, url, audioUrl, headers } = await this.options.client.streamUrl(trimmed);
                this.assertDuration(info.durationSec);
                const workDir = await mkdtemp(join(outDir, 'work-'));
                const result = await buildStoryboard({
                    streamUrl: url,
                    ...(audioUrl === undefined ? {} : { audioUrl }),
                    headers,
                    frames: this.options.frames,
                    deps,
                    workDir,
                });
                const imagePath = await this.persist(result.imagePath, outDir, 'bili-' + info.bvid);
                return {
                    imagePath,
                    title: info.title,
                    durationSec: info.durationSec,
                    width: result.width,
                    height: result.height,
                    timeline: result.timeline,
                    withWaveform: result.withWaveform,
                    source: 'bili',
                };
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
    async persist(sourcePath, outDir, prefix) {
        const { copyFile, mkdir } = await import('node:fs/promises');
        await mkdir(outDir, { recursive: true });
        const target = join(outDir, prefix + '-' + Date.now() + '.png');
        await copyFile(sourcePath, target);
        return target;
    }
}
