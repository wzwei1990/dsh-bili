import assert from 'node:assert/strict'
import test from 'node:test'

const { extractTarget, mergeCues, trimTo } = await import('../lib/bili.js')
const { mixinKey, signQuery, md5Hex } = await import('../lib/wbi.js')
const { digestOf } = await import('../lib/tools.js')

test('链接解析：BV / av / b23 短链 / 含链接文本', () => {
  assert.deepEqual(extractTarget('BV15cs96zEvi'), { kind: 'bvid', value: 'BV15cs96zEvi' })
  assert.deepEqual(
    extractTarget('【质感绝了】 https://www.bilibili.com/video/BV15cs96zEvi/?share_source=copy_web&vd_source=abc'),
    { kind: 'bvid', value: 'BV15cs96zEvi' },
  )
  assert.deepEqual(extractTarget('av170001'), { kind: 'aid', value: '170001' })
  assert.deepEqual(extractTarget('https://b23.tv/abcd123'), { kind: 'short', value: 'https://b23.tv/abcd123' })
  assert.equal(extractTarget('今天天气不错').kind, 'none')
})

test('WBI：mixinKey 取 32 位、签名带 wts/w_rid 且参数有序', () => {
  const img = 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png'
  const sub = 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png'
  const key = mixinKey(img, sub)
  assert.equal(key.length, 32)
  const query = signQuery({ bvid: 'BV15cs96zEvi', cid: 43131012024 }, img, sub, 1700000000)
  assert.match(query, /^bvid=BV15cs96zEvi&cid=43131012024&wts=1700000000&w_rid=[0-9a-f]{32}$/)
  assert.equal(md5Hex('abc'), '900150983cd24fb0d6963f7d28e17f72')
})

test('字幕合并：按 30 秒 / 80 字分段并带 [mm:ss] 时间戳', () => {
  const cues = [
    { from: 0, content: '第一句。' },
    { from: 5, content: '第二句。' },
    { from: 40, content: '第三句。' },
  ]
  const text = mergeCues(cues)
  const lines = text.split('\n')
  assert.equal(lines.length, 2)
  assert.match(lines[0] ?? '', /^\[00:00\] 第一句。第二句。$/)
  assert.match(lines[1] ?? '', /^\[00:40\] 第三句。$/)
})

test('字幕截断：超出上限时标注', () => {
  const result = { bvid: 'BV1', lang: 'zh-CN', label: '中文', text: 'a'.repeat(500), cueCount: 1, truncated: false }
  const trimmed = trimTo(result, 100)
  assert.equal(trimmed.truncated, true)
  assert.ok(trimmed.text.startsWith('a'.repeat(100)))
  assert.ok(trimmed.text.includes('已截断'))
  assert.equal(trimTo(result, 1000).truncated, false)
})

test('摘要文本：有字幕/无字幕两种形态', () => {
  const info = {
    bvid: 'BV15cs96zEvi',
    aid: 1,
    cid: 2,
    title: '剑来真人版预告',
    up: '乌鸦预告片',
    durationSec: 197,
    cover: 'https://example.com/cover.jpg',
    desc: '一段简介',
    pageUrl: 'https://www.bilibili.com/video/BV15cs96zEvi',
    publishedAt: 0,
    stats: { view: 180931, danmaku: 120, like: 900, coin: 30, favorite: 20 },
    pages: [],
  }
  const withSub = digestOf(info, '[00:00] 大家好', false)
  assert.ok(withSub.includes('【B站视频】剑来真人版预告'))
  assert.ok(withSub.includes('UP主：乌鸦预告片'))
  assert.ok(withSub.includes('3:17'))
  assert.ok(withSub.includes('【字幕正文】'))
  const withoutSub = digestOf(info, '', false)
  assert.ok(withoutSub.includes('没有可用字幕'))
})
test('弹幕解析：XML → 时间/文本，坏数据跳过', async () => {
  const { parseDanmakuXml } = await import('../lib/danmaku.js')
  const xml = '<i><d p="12.5,1,25,16777215,1,0,abc,123">哈哈哈</d><d p="bad,1">x</d><d p="30,1">前方高能</d></i>'
  const items = parseDanmakuXml(xml)
  assert.equal(items.length, 2)
  assert.equal(items[0].at, 12.5)
  assert.equal(items[0].text, '哈哈哈')
  assert.equal(items[1].at, 30)
})

test('弹幕统计：高光时段按密度排序 + 样本去噪声', async () => {
  const { summarizeDanmaku, clockOf } = await import('../lib/danmaku.js')
  const items = []
  for (let i = 0; i < 30; i += 1) items.push({ at: i * 0.5, text: '名场面' + String(i % 3), mode: 1 }) // 0-15s 密集
  for (let i = 0; i < 5; i += 1) items.push({ at: 120 + i, text: '哈哈', mode: 1 })                     // 噪声
  const summary = summarizeDanmaku(items, 200, { bucketSec: 30, peakCount: 2 })
  assert.equal(summary.total, 35)
  assert.equal(summary.peaks[0].startSec, 0)
  assert.ok(summary.peaks[0].samples.length > 0)
  assert.ok(!summary.samples.includes('哈哈'), '纯笑声不该进样本')
  assert.equal(clockOf(95), '01:35')
})

test('弹幕文本：带高光时段与来源', async () => {
  const { summarizeDanmaku, danmakuText } = await import('../lib/danmaku.js')
  const items = [{ at: 5, text: '这段太强了', mode: 1 }, { at: 8, text: '这段太强了', mode: 1 }]
  const text = danmakuText(summarizeDanmaku(items, 60), 60, 'https://www.bilibili.com/video/BV1xx')
  assert.ok(text.includes('弹幕概况'))
  assert.ok(text.includes('这段太强了'))
  assert.ok(text.includes('来源：https://www.bilibili.com/video/BV1xx'))
})