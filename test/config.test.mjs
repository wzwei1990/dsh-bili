import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveConfig } from '../lib/config.js'

test('volatile 配置：每次读取都取当前引用值（改设置不用重启）', () => {
  let base = 'http://127.0.0.1:4567'
  let height = 720
  const config = resolveConfig({ amagiBaseUrl: { get: () => base }, douyinMaxHeight: { get: () => height } })
  assert.equal(config.amagiBaseUrl, 'http://127.0.0.1:4567')
  assert.equal(config.douyinMaxHeight, 720)
  base = 'http://amagi:4567'
  height = 1080
  assert.equal(config.amagiBaseUrl, 'http://amagi:4567')
  assert.equal(config.douyinMaxHeight, 1080)
})

test('volatile 配置：未设置时回退默认值，布尔/数字正确转换', () => {
  const config = resolveConfig({ storyboard: { get: () => false }, timeoutMs: { get: () => '30000' } })
  assert.equal(config.storyboard, false)
  assert.equal(config.timeoutMs, 30000)
  assert.equal(config.amagiBaseUrl, '')
  assert.equal(config.douyinMaxHeight, 720)
})
