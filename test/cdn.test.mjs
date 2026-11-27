import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankBiliCandidates } from '../lib/cdn.js'

test('B 站 CDN 候选：官方优先、PCDN 最后、去重保序', () => {
  const pcdn = 'https://upos-hz-mirrorakam.akamaized.net/x'
  const official = 'https://upos-sz-mirrorcos.bilivideo.com/x'
  const edge = 'https://b-test.edge.mountaintoys.cn:4483/x'
  const smt = 'https://video.h2.smtcdns.net:4483/x'
  const ranked = rankBiliCandidates([pcdn, edge, official, smt, official, ' '])
  assert.equal(ranked[0], official, '官方 CDN 应排第一')
  assert.equal(ranked.length, 4, '去重 + 空值过滤，实际 ' + ranked.length)
  assert.equal(ranked[ranked.length - 1], smt, 'PCDN 排最后（同分保序）')
  assert.ok(ranked.indexOf(pcdn) < ranked.indexOf(edge), '已知 PCDN 比未知线路更差')
})
