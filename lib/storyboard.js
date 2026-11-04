/**
 * 最小「画面兜底」：抽 9 帧拼成一张分镜图（+ 音频响度波形），给模型"看一眼"。
 *
 * 设计取舍（照 dsh-video-storyboard 的结论，但不搬它那套重工程）：
 *   - **打包而不是逐帧**：9 张格子拼成 1 张图，token 成本是一张图；
 *   - **不依赖图像库/字体**：拼图用 ffmpeg 的 tile/vstack，文字标注可选（找不到字体就跳过）；
 *   - **不下载完整视频**：直接用 B 站 playurl 的流地址，ffmpeg 按时间点 seek 抽帧（快）；
 *   - **只在没字幕时兜底**：有字幕就不抽帧（省钱）。
 *
 * 跨平台：所有命令走 argv 数组（Windows 引号安全），临时目录用 os.tmpdir()，结束清理。
 */
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBinary } from './deps.js';
export function clockOf(seconds) {
    const total = Math.max(0, Math.round(seconds));
    return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}
/** 均匀取点：跳过片头 5% 与片尾 5%，每段取中点（不是分段首帧，首帧常是转场黑帧）。 */
export function pickTimestamps(durationSec, frames) {
    const count = Math.max(4, Math.min(16, Math.round(frames)));
    const start = durationSec * 0.05;
    const end = durationSec * 0.95;
    const span = Math.max(1, end - start);
    const out = [];
    for (let i = 0; i < count; i += 1) {
        out.push(Number((start + (span * (i + 0.5)) / count).toFixed(2)));
    }
    return out;
}
/** 猜一个可用字体（有就用，没有就跳过标注）：Windows 中文/西文，Linux 常见路径。 */
export function findStoryboardFont() {
    return guessFont();
}
export function guessFont() {
    const candidates = process.platform === 'win32'
        ? ['C:\\Windows\\Fonts\\msyh.ttc', 'C:\\Windows\\Fonts\\simhei.ttf', 'C:\\Windows\\Fonts\\arial.ttf']
        : ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'];
    return candidates.find(path => existsSync(path));
}
function headerArgs(headers) {
    if (headers === undefined)
        return [];
    const lines = Object.entries(headers).map(([key, value]) => key + ': ' + value);
    // ffmpeg 要求每个头以 CRLF 结尾
    return ['-headers', lines.join('\r\n') + '\r\n'];
}
async function probeWidth(ffprobe, file, timeoutMs) {
    const out = await runBinary(ffprobe, [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        file,
    ], timeoutMs);
    const value = Number.parseInt(out.trim().split('\n')[0] ?? '', 10);
    return Number.isFinite(value) && value > 0 ? value : 0;
}
async function probeDuration(ffprobe, input, extra, timeoutMs) {
    const out = await runBinary(ffprobe, [
        ...extra,
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        input,
    ], timeoutMs);
    const value = Number.parseFloat(out.trim());
    return Number.isFinite(value) && value > 0 ? value : 0;
}
/** 网格：9 → 3x3，16 → 4x4，4 → 2x2 */
function gridOf(frames) {
    const cols = frames <= 4 ? 2 : frames <= 9 ? 3 : 4;
    return { cols, rows: Math.ceil(frames / cols) };
}
export async function buildStoryboard(options) {
    const ffmpeg = options.deps.ffmpeg?.path;
    const ffprobe = options.deps.ffprobe?.path;
    if (ffmpeg === undefined)
        throw new Error('没有找到 ffmpeg（请安装或配置 ffmpegPath）');
    if (ffprobe === undefined)
        throw new Error('没有找到 ffprobe（ffmpeg 通常一起安装）');
    const frames = Math.max(4, Math.min(16, Math.round(options.frames ?? 9)));
    const cellWidth = Math.max(240, Math.min(960, Math.round(options.cellWidth ?? 480)));
    const timeoutMs = options.timeoutMs ?? 180_000;
    const workDir = options.workDir ?? await mkdtemp(join(tmpdir(), 'dsh-bili-story-'));
    // workDir 由调用方给时可能不存在：先建出来（Windows 上 ffmpeg 不会自己创建目录）
    await mkdir(workDir, { recursive: true });
    const extra = headerArgs(options.headers);
    let durationSec = 0;
    try {
        durationSec = await probeDuration(ffprobe, options.streamUrl, extra, Math.min(timeoutMs, 30_000));
    }
    catch (error) {
        throw new Error('读不到视频时长：' + (error instanceof Error ? error.message : String(error)));
    }
    if (durationSec <= 0)
        throw new Error('视频时长为 0，无法抽帧');
    const stamps = pickTimestamps(durationSec, frames);
    const cellHeight = Math.round((cellWidth * 9) / 16);
    const digiFont = options.fontFile ?? guessFont();
    // 1) 逐帧抽（-ss 在 -i 前，快速 seek）
    for (const [index, at] of stamps.entries()) {
        const label = clockOf(at);
        const text = digiFont === undefined ? [] : [
            '-vf',
            'scale=' + String(cellWidth) + ':' + String(cellHeight) + ':force_original_aspect_ratio=decrease,'
                + 'pad=' + String(cellWidth) + ':' + String(cellHeight) + ':(ow-iw)/2:(oh-ih)/2:color=black,'
                + 'drawtext=fontfile=' + digiFont.replace(/\\/g, '/') + ':text=' + label.replace(/:/g, '\\\\:')
                + ':x=8:y=8:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.55',
        ];
        const scale = digiFont === undefined
            ? ['-vf', 'scale=' + String(cellWidth) + ':' + String(cellHeight) + ':force_original_aspect_ratio=decrease,'
                    + 'pad=' + String(cellWidth) + ':' + String(cellHeight) + ':(ow-iw)/2:(oh-ih)/2:color=black']
            : text;
        await runBinary(ffmpeg, [
            '-y', ...extra,
            '-ss', String(at),
            '-i', options.streamUrl,
            '-frames:v', '1',
            ...scale,
            join(workDir, 'frame-' + String(index).padStart(2, '0') + '.png'),
        ], Math.min(timeoutMs, 60_000));
    }
    // 2) 拼网格
    const { cols, rows } = gridOf(frames);
    const gridPath = join(workDir, 'grid.png');
    await runBinary(ffmpeg, [
        '-y',
        '-framerate', '1',
        '-i', join(workDir, 'frame-%02d.png'),
        '-frames:v', '1',
        '-vf', 'tile=' + String(cols) + 'x' + String(rows) + ':padding=4:margin=4:color=black',
        gridPath,
    ], timeoutMs);
    // 3) 音频响度波形（没有音轨就跳过）
    const wavePath = join(workDir, 'wave.png');
    let withWaveform = false;
    const audioSource = options.audioUrl ?? options.streamUrl;
    try {
        await runBinary(ffmpeg, [
            '-y', ...extra,
            '-i', audioSource,
            '-filter_complex', 'showwavespic=s=' + String(cols * (cellWidth + 8)) + 'x120:colors=white',
            '-frames:v', '1',
            wavePath,
        ], Math.min(timeoutMs, 90_000));
        withWaveform = true;
    }
    catch {
        withWaveform = false;
    }
    // 4) 波形拼到网格下面
    const imagePath = join(workDir, 'storyboard.png');
    if (withWaveform) {
        // 网格宽度受 tile 的 padding/margin 影响，和波形宽度不一定相同；
        // 以 grid 实际宽度为准把波形缩放过去，否则 vstack 会报 "width does not match"。
        const gridWidth = await probeWidth(ffprobe, gridPath, 30_000).catch(() => 0);
        const waveFit = gridWidth > 0
            ? '[0:v]format=rgb24[a];[1:v]scale=' + String(gridWidth) + ':-2,format=rgb24[b];[a][b]vstack=inputs=2'
            : '[0:v]format=rgb24[a];[1:v]format=rgb24[b];[a][b]vstack=inputs=2';
        await runBinary(ffmpeg, [
            '-y',
            '-i', gridPath,
            '-i', wavePath,
            '-filter_complex', waveFit,
            imagePath,
        ], timeoutMs);
    }
    else {
        await runBinary(ffmpeg, ['-y', '-i', gridPath, imagePath], timeoutMs);
    }
    const info = await stat(imagePath);
    if (info.size === 0)
        throw new Error('分镜图为空，抽帧可能失败');
    return {
        imagePath,
        timeline: stamps.map((at, index) => ({ index: index + 1, atSec: at, label: clockOf(at) })),
        durationSec,
        width: cols * (cellWidth + 8),
        height: rows * (cellHeight + 8) + (withWaveform ? 120 : 0),
        withWaveform,
        numbered: digiFont !== undefined,
    };
}
/** 清理临时目录（尽力而为） */
export async function cleanupStoryboard(dir) {
    try {
        const entries = await readdir(dir);
        if (entries.length === 0)
            return;
        await rm(dir, { recursive: true, force: true });
    }
    catch {
        // 忽略
    }
}
