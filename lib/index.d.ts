import type { Context } from '@deepseek-ai/cordis';
import { Config, type ConfigShape } from './config.js';
export { Config };
export declare const name = "dsh-bili";
/** 只依赖工具注册表：本插件不碰会话/渠道，通道按需消费服务。 */
export declare const inject: string[];
export declare function apply(ctx: Context, rawConfig: ConfigShape): void;
