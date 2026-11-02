/**
 * dsh-bili —— 让 DeepSeek Harness 真正"看懂" B 站视频。
 *
 * v0.1 目标（P0）：群里谁丢来一个 B 站链接，能把「标题 / UP 主 / 时长 / 简介 / 字幕正文」
 * 交给模型，让模型自己总结、回答、吐槽。
 *
 * 设计原则（与 dsh-meme 一致：单向、只读、可降级）：
 * - 本插件不依赖任何 IM 插件；通道（dsh-napcat 等）按需消费。
 * - 网络失败、无字幕、接口风控都返回结构化错误，不抛异常炸宿主。
 * - 不写任何第三方仓库的代码，只参考其接口形态。
 */
import type { Context } from '@deepseek-ai/cordis';
import { Config, type ConfigShape } from './config.js';
export { Config };
export declare const name = "dsh-bili";
/** 只依赖工具注册表：本插件不碰会话/渠道，符合"能力插件"定位。 */
export declare const inject: string[];
export declare function apply(ctx: Context, rawConfig: ConfigShape): void;
