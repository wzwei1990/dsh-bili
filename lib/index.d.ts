/**
 * dsh-bili —— B 站只读能力层。
 *
 * 职责边界（2026-11-05 调整，与用户确认的 A 方案）：
 *   ✅ 链接解析 / 视频信息 / 字幕 / 弹幕 / 分镜 / 搜索 / UP 查询
 *   ❌ 订阅与推送 —— 属于"有收件人的渠道插件"（例如 dsh-napcat），本插件只提供数据
 *
 * 设计原则：
 * - 不依赖任何 IM 插件；渠道按需消费 `dshBili` 服务。
 * - 网络失败、无字幕、接口风控都返回结构化错误，不抛异常炸宿主。
 */
import type { Context } from '@deepseek-ai/cordis';
import { Config, type ConfigShape } from './config.js';
export { Config };
export declare const name = "dsh-bili";
/** 只依赖工具注册表：本插件不碰会话/渠道，通道按需消费服务。 */
export declare const inject: string[];
export declare function apply(ctx: Context, rawConfig: ConfigShape): void;
