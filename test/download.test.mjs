import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadParallel } from '../lib/download.js'

function sha(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function serverFor(payload) {
  const server = http.createServer((req, res) => {
    const range = req.headers.range
    if (typeof range === 'string' && /^bytes=\d+-\d+$/.test(range)) {
      const [start, end] = range.replace('bytes=', '').split('-').map(Number)
      const chunk = payload.subarray(start, end + 1)
      res.writeHead(206, {
        'Content-Range': 'bytes ' + String(start) + '-' + String(end) + '/' + String(payload.length),
        'Content-Length': String(chunk.length),
      })
      res.end(chunk)
      return
    }
    res.writeHead(200, { 'Content-Length': String(payload.length) })
    res.end(payload)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  return { server, url: 'http://127.0.0.1:' + String(port) + '/video.mp4' }
}

test('并行分段下载：内容与源一致（Range 生效）', async () => {
  const payload = Buffer.alloc(5 * 1024 * 1024 + 123)
  for (let i = 0; i < payload.length; i += 1) payload[i] = i % 251
  const { server, url } = await serverFor(payload)
  const dir = await mkdtemp(join(tmpdir(), 'dl-'))
  try {
    const file = join(dir, 'out.mp4')
    const bytes = await downloadParallel(url, {}, file, { concurrency: 4 })
    const written = await readFile(file)
    assert.equal(bytes, payload.length)
    assert.equal(written.length, payload.length)
    assert.equal(sha(written), sha(payload))
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('小文件走单连接也能下对', async () => {
  const payload = Buffer.from('hello-bilibili-storyboard')
  const { server, url } = await serverFor(payload)
  const dir = await mkdtemp(join(tmpdir(), 'dl-'))
  try {
    const file = join(dir, 'small.bin')
    const bytes = await downloadParallel(url, {}, file)
    assert.equal(bytes, payload.length)
    assert.equal((await readFile(file)).toString(), payload.toString())
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})
