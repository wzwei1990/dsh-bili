import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SubscriptionStore, pollSubscription } from '../lib/subscriptions.js'

test('同一轮里视频比动态新，动态不能被 lastSeen 挤掉（回归）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-poll-'))
  try {
    const store = new SubscriptionStore({ dir })
    await store.load()
    const { subscription } = await store.upsert({
      provider: 'bili', key: '1', name: 'UP', types: ['video', 'dynamic'],
      groups: ['group:1'], lastSeenPubdate: 100,
    })
    const search = {
      upVideos: async () => ([
        { bvid: 'BV1', title: '视频A', pubdate: 300, durationSec: 180, play: 120000, url: 'https://b23.tv/BV1', cover: 'https://i0.hdslb.com/a.jpg' },
      ]),
      upDynamics: async () => ([
        { id: 'd1', type: 'DYNAMIC_TYPE_DRAW', text: '动态B', pubdate: 200, url: 'https://t.bilibili.com/d1', imageCount: 2, images: ['https://i0.hdslb.com/1.jpg', 'https://i0.hdslb.com/2.jpg'] },
      ]),
    }
    const result = await pollSubscription(subscription, { store, search, intervalMinutes: 10 })
    assert.equal(result.error, undefined)
    const items = store.pending('napcat:group:1', 10, 'group:1')
    assert.equal(items.length, 2, '视频和动态都应进队列，实际 ' + items.length)
    const video = items.find(item => item.kind === 'video')
    const dynamic = items.find(item => item.kind === 'dynamic')
    assert.ok(video.coverUrl.includes('a.jpg'))
    assert.deepEqual(dynamic.images, ['https://i0.hdslb.com/1.jpg', 'https://i0.hdslb.com/2.jpg'])
    assert.ok(video.extra.includes('12万'), '播放量应格式化，实际 ' + video.extra)
    assert.equal(result.subscription.lastSeenPubdate, 300, 'lastSeen 取两类最大时间')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
