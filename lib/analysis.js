/**
 * B 站视频分析（与抖音 A 档对齐，2026-11-26）。
 *
 * 产出平台中立的素材，不绑定任何下游：
 *   - 元信息（标题/UP/时长/播放/简介）
 *   - 16k 单声道音频（交给 tts_transcribe 做 ASR，解决"没 CC 字幕"）
 *   - 9 帧分镜图（复用 StoryboardService）
 *
 * B 站不需要下载整片：音频直接用 playurl 的 DASH 音频流，分镜也走直连流。
 */
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveStoryboardDeps, runBinary } from './deps.js';
function defaultRoot() {
    const home = process.env.DSH_HOME;
    const base = home !== undefined && home !== '' ? home : join(homedir(), '.dsh');
    return join(base, 'dsh-bili', 'analysis');
}
function ffmpegHeaders(headers) {
    const lines = Object.entries(headers).map(([name, value]) => name + ': ' + value);
    return lines.join('\r\n') + '\r\n';
}
/** 抽 playurl 的音频流为 16k 单声道 wav（B 站 CDN 需要 Referer/UA 头） */
async function extractBiliAudio(ffmpeg, audioUrl, headers, output) {
    await runBinary(ffmpeg, ['-y', '-headers', ffmpegHeaders(headers), '-i', audioUrl, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', output], 180_000);
}
/**
 * 分析一个 B 站视频：元信息 + 音频 + 分镜。
 * @param input 链接 / BV / av / 包含链接的一段话
 */
export async function analyzeBili(input, client, options = {}) {
    const log = options.log ?? (() => undefined);
    const stream = await client.streamUrl(input);
    const info = stream.info;
    const root = options.rootDir ?? defaultRoot();
    const dir = join(root, info.bvid);
    await mkdir(dir, { recursive: true });
    let audioPath;
    if (stream.audioUrl !== undefined && stream.audioUrl !== '') {
        try {
            const deps = await resolveStoryboardDeps({ ffmpegPath: options.ffmpegPath ?? '' });
            if (deps.ffmpeg === undefined)
                throw new Error('没有找到 ffmpeg');
            const wav = join(dir, 'audio.wav');
            log('info', 'B 站分析：抽音频 ' + info.bvid);
            await extractBiliAudio(deps.ffmpeg.path, stream.audioUrl, stream.headers, wav);
            audioPath = wav;
        }
        catch (error) {
            log('warn', 'B 站分析：抽音频失败（仍可看分镜）: ' + (error instanceof Error ? error.message : String(error)));
        }
    }
    else {
        log('warn', 'B 站分析：这条视频没有独立音频流（可能是老旧 durl 格式）');
    }
    let storyboard;
    if (options.storyboard !== undefined) {
        try {
            storyboard = await options.storyboard.build(input);
        }
        catch (error) {
            log('warn', 'B 站分析：分镜生成失败: ' + (error instanceof Error ? error.message : String(error)));
        }
    }
    return {
        platform: 'bili',
        info,
        ...(audioPath === undefined ? {} : { audioPath }),
        ...(storyboard === undefined ? {} : { storyboard }),
    };
}
