/** cookie 至少要这么长才算"像真的"（整段通常几百字符，只填 SESSDATA 值也有 200+） */
export declare const MIN_REAL_COOKIE_LENGTH = 100;
export interface ProfileCookieResult {
    cookie: string;
    /** 来源文件路径 */
    file: string;
}
/** 从一段 YAML 文本里抽出 dsh-bili 的 sessdata（支持多行 plain scalar） */
/**
 * 从 YAML 里抽 dsh-bili 块下的某个标量（支持 plain scalar 折叠续行、块标量、引号）。
 * 宿主会把多行 plain scalar 传成截断值，所以直接读文件自愈。
 */
export declare function extractScalarFromYaml(text: string, key: string, pluginId?: string): string;
/** 兼容旧调用：只抽 sessdata */
export declare function extractSessdataFromYaml(text: string, pluginId?: string): string;
/** 在 DSH_HOME 下的所有 profile 里找 dsh-bili 的 sessdata */
export declare function readCookieFromProfiles(): ProfileCookieResult | undefined;
/** 在 DSH_HOME 下的所有 profile 里找 dsh-bili 的某个标量（多行配置自愈用） */
export declare function readScalarFromProfiles(key: string, pluginId?: string): string;
