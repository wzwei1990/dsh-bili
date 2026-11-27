/**
 * amagi 两个平台 cookie 的文件化存储（2026-11-27）。
 *
 * 与 B 站 cookie.txt 一致：
 *   - 完整值写到 ~/.dsh/dsh-bili/amagi-douyin.txt / amagi-bilibili.txt
 *   - 读取时**文件优先**（支持手动改文件）
 *   - 监听 profile YAML 与文件 mtime：设置页保存 / 手动改文件后立即生效
 *
 * 为什么需要：设置页的长 cookie 会被 YAML 折成几十行，宿主传给插件时只剩第一行。
 * profile 是完整真相源；文件是缓存与手动入口。
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { extractScalarFromYaml } from './profilecookie.js'

/** 显式配置优先；为空时用复用值（如插件自己的 B 站 cookie） */
export function preferConfigured(configured: string, fallback: string): string {
  const value = configured.trim()
  return value !== '' ? value : fallback.trim()
}

/** 文件 > profile 完整值 > 宿主传值（按“像完整 cookie”的程度挑） */
export function chooseCookie(fileValue: string, profileValue: string, passedValue: string): string {
  if (fileValue.trim() !== '') return fileValue.trim()
  if (profileValue.trim() !== '') return profileValue.trim()
  return passedValue.trim()
}

export interface AmagiCookieResolverOptions {
  /** 配置键（amagiDouyinCookies / amagiBilibiliCookies） */
  key: string
  /** 落盘文件绝对路径 */
  file: string
  /** 宿主当前传进来的值（可能是被截断的第一行） */
  passed: () => string
  log?: (level: 'debug' | 'info' | 'warn', message: string) => void
}

function profileYamlFiles(): string[] {
  const homeEnv = process.env.DSH_HOME
  // DSH_HOME 一旦设置就只看它（测试/多实例隔离）；没设才回落到 ~/.dsh
  const bases = homeEnv !== undefined && homeEnv !== ''
    ? [homeEnv]
    : [join(homedir(), '.dsh')]
  const files: string[] = []
  for (const home of [...new Set(bases)]) {
    const profilesDir = join(home, 'profiles')
    if (!existsSync(profilesDir)) continue
    try {
      for (const name of readdirSync(profilesDir)) {
        const file = join(profilesDir, name, 'cordis.patch.yml')
        if (existsSync(file)) files.push(file)
      }
    } catch {
      // 忽略
    }
  }
  return files
}

function mtimeOf(file: string): number {
  try {
    return statSync(file).mtimeMs
  } catch {
    return 0
  }
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/**
 * 创建一个活值解析器：每次调用都检查文件/profile 是否变化。
 * 返回空字符串表示没有配置。
 */
export function createAmagiCookieResolver(options: AmagiCookieResolverOptions): () => string {
  const log = options.log ?? (() => undefined)
  let value = ''
  let lastFileMtime = -1
  let lastProfileMtime = -1
  let initialized = false

  const load = (): void => {
    // 1) 文件（优先）
    if (existsSync(options.file)) {
      const mtime = mtimeOf(options.file)
      if (mtime !== lastFileMtime) {
        lastFileMtime = mtime
        const fromFile = readText(options.file).trim()
        if (fromFile !== '') {
          value = fromFile
          log('debug', 'amagi cookie 使用文件: ' + options.file)
        }
      }
    }

    // 2) profile YAML（设置页保存后会变 mtime）
    let profileMtime = 0
    for (const file of profileYamlFiles()) profileMtime = Math.max(profileMtime, mtimeOf(file))
    if (profileMtime !== lastProfileMtime) {
      lastProfileMtime = profileMtime
      let fromProfile = ''
      for (const file of profileYamlFiles()) {
        const parsed = extractScalarFromYaml(readText(file), options.key)
        if (parsed.length > fromProfile.length) fromProfile = parsed
      }
      if (fromProfile !== '') {
        // 3) 宿主传值兜底（通常是被截断的第一行）
        const passed = options.passed().trim()
        const best = chooseCookie('', fromProfile, passed)
        if (best !== value) {
          value = best
          try {
            writeFileSync(options.file, best + '\n', 'utf8')
            lastFileMtime = mtimeOf(options.file)
          } catch (error) {
            log('warn', '写 amagi cookie 文件失败: ' + (error instanceof Error ? error.message : String(error)))
          }
          log('info', 'amagi cookie 已从 profile 同步到 ' + options.file + '（长度 ' + String(best.length) + '）')
        }
      }
    }

    // 4) 首次：文件/profile 都没有，用宿主传值
    if (!initialized) {
      initialized = true
      if (value === '') value = options.passed().trim()
    }

    // 5) 保证文件存在且与内存值一致（保存后不用等第一次使用）
    if (value !== '') {
      const onDisk = existsSync(options.file) ? readText(options.file).trim() : ''
      if (onDisk !== value) {
        try {
          writeFileSync(options.file, value + '\n', 'utf8')
          lastFileMtime = mtimeOf(options.file)
          log('info', 'amagi cookie 已写入 ' + options.file + '（长度 ' + String(value.length) + '）')
        } catch (error) {
          log('warn', '写 amagi cookie 文件失败: ' + (error instanceof Error ? error.message : String(error)))
        }
      }
    }
  }

  return (): string => {
    load()
    return value
  }
}
