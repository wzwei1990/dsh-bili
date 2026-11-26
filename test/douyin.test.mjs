import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractDouyinUrl, isDouyinUrl, pickAwemeId } from '../lib/douyin.js'

test('抖音链接识别：只认 douyin.com / iesdouyin.com 及其子域', () => {
  assert.equal(isDouyinUrl('https://www.douyin.com/video/7300000000000000000'), true)
  assert.equal(isDouyinUrl('https://v.douyin.com/abc123/'), true)
  assert.equal(isDouyinUrl('https://www.iesdouyin.com/share/video/123'), true)
  assert.equal(isDouyinUrl('https://douyin.com.evil.com/video/1'), false, '后缀伪装要拒绝')
  assert.equal(isDouyinUrl('https://evil.com/douyin.com/video/1'), false)
  assert.equal(isDouyinUrl('not a url'), false)
})

test('从一段话里抠链接：带中文标点/口令也能取到', () => {
  const text = '看看这个 https://v.douyin.com/iAbCdEf/ 复制此链接，打开抖音搜索'
  assert.equal(extractDouyinUrl(text), 'https://v.douyin.com/iAbCdEf/')
  assert.equal(extractDouyinUrl('没有链接'), undefined)
  assert.equal(extractDouyinUrl('https://www.bilibili.com/video/BV1xx'), undefined)
})

test('作品 id：video / note / modal_id 三种形态', () => {
  assert.equal(pickAwemeId('https://www.douyin.com/video/7300000000000000000'), '7300000000000000000')
  assert.equal(pickAwemeId('https://www.douyin.com/note/7311111111111111111'), '7311111111111111111')
  assert.equal(pickAwemeId('https://www.douyin.com/user/x?modal_id=7322222222222222222'), '7322222222222222222')
  assert.equal(pickAwemeId('https://v.douyin.com/abc/'), undefined)
})

import { parseAmagiWork, amagiDouyinUrl, douyinIdOf } from '../lib/amagi.js'

test('amagi 响应解析：标题/作者/时长/直链/点赞', () => {
  const meta = parseAmagiWork({
    success: true,
    data: { aweme_detail: {
      aweme_id: '7710868482187698107',
      desc: '如果杰森这样来接露西娅...\n#GTA6发售 #游戏资讯',
      author: { nickname: '镜三一' },
      video: { duration: 14953, play_addr: { url_list: ['https://v26-webf.douyinvod.com/x.mp4'] }, cover: { url_list: ['https://p3.douyinpic.com/c.jpg'] } },
      statistics: { digg_count: 234, comment_count: 8 },
    } },
  }, '')
  assert.ok(meta)
  assert.equal(meta.title, '如果杰森这样来接露西娅...')
  assert.equal(meta.uploader, '镜三一')
  assert.equal(Math.round(meta.durationSec), 15)
  assert.equal(meta.playUrl, 'https://v26-webf.douyinvod.com/x.mp4')
  assert.equal(meta.likes, 234)
  assert.equal(meta.webpageUrl, 'https://www.douyin.com/video/7710868482187698107')
})

test('amagi 响应失败时返回 undefined', () => {
  assert.equal(parseAmagiWork({ success: false, message: '抖音数据获取失败' }, ''), undefined)
  assert.equal(parseAmagiWork({ success: true, data: {} }, ''), undefined)
})

test('amagi 地址与作品 id 提取', () => {
  assert.equal(amagiDouyinUrl('http://amagi:4567/', '123456'), 'http://amagi:4567/api/douyin/fetch_one_work?aweme_id=123456')
  assert.equal(douyinIdOf('https://www.douyin.com/video/7710868482187698107'), '7710868482187698107')
  assert.equal(douyinIdOf('看看 https://v.douyin.com/BEKMN41TOjg/'), undefined)
})
