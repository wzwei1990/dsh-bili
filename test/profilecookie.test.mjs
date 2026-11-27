import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractScalarFromYaml, extractSessdataFromYaml } from '../lib/profilecookie.js'
import { resolveConfig } from '../lib/config.js'

const yaml = `plugins:
  - id: dsh-bili
    name: dsh-bili
    config:
      amagiBaseUrl: http://127.0.0.1:4567
      amagiDouyinCookies: __ac_nonce=06b0; ttwid=1%7Cabc
        %7C1795744367%7Cf377; s_v_web_id=verify_x
        ; douyin.com; uid_tt=abc
      storyboard: true
  - id: other
    config:
      amagiDouyinCookies: should-not-read
`

test('多行 plain scalar 折叠：完整读出 cookie（含孤立段）', () => {
  const value = extractScalarFromYaml(yaml, 'amagiDouyinCookies')
  assert.ok(value.startsWith('__ac_nonce=06b0;'))
  assert.ok(value.includes('ttwid=1%7Cabc'))
  assert.ok(value.includes('uid_tt=abc'))
  assert.ok(value.includes('douyin.com'))
  assert.ok(value.length > 50, '实际 ' + value.length)
})

test('块标量（|）也能读', () => {
  const block = `- id: dsh-bili\n  config:\n    amagiBilibiliCookies: |\n      SESSDATA=abc; bili_jct=def;\n      buvid3=ghi\n`
  assert.equal(extractScalarFromYaml(block, 'amagiBilibiliCookies'), 'SESSDATA=abc; bili_jct=def;\nbuvid3=ghi')
})

test('sessdata 旧接口保持兼容', () => {
  const sample = '- id: dsh-bili\n  config:\n    sessdata: SESSDATA=abc; bili_jct=def\n'
  assert.equal(extractSessdataFromYaml(sample), 'SESSDATA=abc; bili_jct=def')
})

test('配置 overrides 优先于宿主传来的截断值', () => {
  const cfg = resolveConfig({ amagiDouyinCookies: { get: () => '__ac_nonce=short' } }, { amagiDouyinCookies: 'full-cookie-value' })
  assert.equal(cfg.amagiDouyinCookies, 'full-cookie-value')
})
