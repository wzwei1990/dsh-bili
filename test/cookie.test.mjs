import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeSetCookie, REFRESHABLE_COOKIE_KEYS } from '../lib/cookie.js'

test('Set-Cookie：只合并白名单字段，保留其余 cookie', () => {
  const current = 'SESSDATA=old; bili_jct=oldjct; CURRENT_FNVAL=4048'
  const { cookie, changed } = mergeSetCookie(current, [
    'SESSDATA=new; Path=/; Domain=.bilibili.com; HttpOnly',
    'bili_jct=newjct; Path=/',
    'evil_field=should-not-merge; Path=/',
  ])
  assert.equal(changed, true)
  assert.ok(cookie.includes('SESSDATA=new'))
  assert.ok(cookie.includes('bili_jct=newjct'))
  assert.ok(cookie.includes('CURRENT_FNVAL=4048'), '白名单外的旧 cookie 要保留')
  assert.ok(!cookie.includes('evil_field'), '白名单外的新字段不合并')
})

test('Set-Cookie：值没变时不标记 changed', () => {
  const current = 'SESSDATA=same; bili_jct=samejct'
  const { changed } = mergeSetCookie(current, ['SESSDATA=same; Path=/', 'bili_jct=samejct'])
  assert.equal(changed, false)
})

test('Set-Cookie：空值/删除标记不覆盖', () => {
  const current = 'SESSDATA=keep; bili_jct=keepjct'
  const { cookie, changed } = mergeSetCookie(current, ['SESSDATA=; Max-Age=0', 'bili_jct=deleted'])
  assert.equal(changed, false)
  assert.ok(cookie.includes('SESSDATA=keep'))
})

test('白名单包含登录相关字段', () => {
  for (const key of ['SESSDATA', 'bili_jct', 'DedeUserID', 'buvid3']) {
    assert.ok(REFRESHABLE_COOKIE_KEYS.includes(key), key + ' 应在白名单里')
  }
})

import { normalizeMediaUrl } from '../lib/search.js'

test('媒体 URL：协议相对地址补 https，http 升级 https', () => {
  assert.equal(normalizeMediaUrl('//i0.hdslb.com/a.jpg'), 'https://i0.hdslb.com/a.jpg')
  assert.equal(normalizeMediaUrl('http://i0.hdslb.com/a.jpg'), 'https://i0.hdslb.com/a.jpg')
  assert.equal(normalizeMediaUrl('https://i0.hdslb.com/a.jpg'), 'https://i0.hdslb.com/a.jpg')
  assert.equal(normalizeMediaUrl('  '), '')
})
