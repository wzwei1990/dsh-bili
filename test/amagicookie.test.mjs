import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chooseCookie, createAmagiCookieResolver } from '../lib/amagicookie.js'

test('cookie 优先级：文件 > profile > 宿主传值', () => {
  assert.equal(chooseCookie('file', 'profile', 'passed'), 'file')
  assert.equal(chooseCookie('', 'profile', 'passed'), 'profile')
  assert.equal(chooseCookie('', '', 'passed'), 'passed')
})

test('resolver：从 profile 读完整值并落文件；手动改文件后优先', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amagi-cookie-'))
  const oldHome = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = root
    await mkdir(join(root, 'profiles', 'web'), { recursive: true })
    const full = 'ttwid=fake; ' + 'k=v; '.repeat(40) + 'uid_tt=abc'
    await writeFile(join(root, 'profiles', 'web', 'cordis.patch.yml'),
      '- id: dsh-bili\n  config:\n    amagiDouyinCookies: ' + full.slice(0, 30) + '\n      ' + full.slice(30) + '\n', 'utf8')

    const file = join(root, 'amagi-douyin.txt')
    const resolve = createAmagiCookieResolver({ key: 'amagiDouyinCookies', file, passed: () => 'short' })
    const first = resolve()
    assert.ok(first.length > 100, '实际长度 ' + first.length)
    assert.ok(first.includes('ttwid=fake'))
    assert.equal((await readFile(file, 'utf8')).trim(), first, '完整值应写入文件')

    await writeFile(file, 'manual-cookie-value\n', 'utf8')
    const future = new Date(Date.now() + 5000)
    await utimes(file, future, future)
    assert.equal(resolve(), 'manual-cookie-value')
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldHome
    await rm(root, { recursive: true, force: true })
  }
})

import { preferConfigured } from '../lib/amagicookie.js'

test('amagi B 站 cookie：显式配置优先，留空复用插件自己的', () => {
  assert.equal(preferConfigured('SESSDATA=explicit', 'SESSDATA=own'), 'SESSDATA=explicit')
  assert.equal(preferConfigured('', 'SESSDATA=own'), 'SESSDATA=own')
  assert.equal(preferConfigured('  ', ' SESSDATA=own '), 'SESSDATA=own')
})
