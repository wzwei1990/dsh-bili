# dsh-bili

给 DeepSeek Harness 装上「看懂 B 站」的能力：群里谁丢来一个 B 站链接，模型能读到**标题、UP 主、时长、播放量、简介、字幕正文**，然后自己总结、回答、吐槽。

> 定位：**能力插件**（像 dsh-meme 一样各做各的），不依赖任何 IM 插件。
> dsh-napcat 之类的通道按需消费：`ctx.get('dshBili')` 存在就调，不存在就降级。

## 现在能做什么（v0.1）

| 工具 | 作用 |
|---|---|
| `bili_read` | 一次拿全：视频信息 + 字幕正文（供模型总结） |
| `bili_subtitle` | 只取字幕正文（带 `[mm:ss]` 段落） |
| `bili_card` | 分享卡片信息：标题 / UP / 时长 / 封面 / 链接 |

支持输入：`BV 号`、`av 号`、`b23.tv` 短链、以及**任何包含链接的一段话**（群里直接粘贴的分享文案也能解析）。

实测（未登录，公开视频）：

```
【B站视频】剑！来！质感绝了！吴磊真人版《剑来》全新预告，全明星阵容亮相
UP主：乌鸦预告片　时长：3:17　播放 18.1万 · 弹幕 120 · 点赞 900
链接：https://www.bilibili.com/video/BV15cs96zEvi
简介：…
（这个视频没有可用字幕：UP 没上传 CC，或需要登录才能看。…）
```

## 安装

```bash
dsh plugin --profile web add github:wzwei1990/dsh-bili
# 重启 DSH 后生效
```

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `sessdata` | 空 | B 站 cookie 里的 `SESSDATA`。**不填也能解析公开视频**，但很多**字幕/AI 字幕需要登录才可见**，想稳定读字幕就填。会跟随 B 站的 `Set-Cookie` 自动刷新并回写 cookie 文件（网页有效而插件失效时，多半是浏览器已滚动到新值） |
| `timeoutMs` | `15000` | 单次请求超时 |
| `subtitleMaxChars` | `6000` | 字幕最多返回多少字符（超出截断并标注） |
| `cacheTtlMinutes` | `1440` | 视频信息/字幕缓存有效期（0=不缓存） |
| `logLevel` | `info` | 日志级别 |

缓存落在 `~/.dsh/dsh-bili/cache/`（JSON，按 bvid 命名）。

## 已知边界

| 情况 | 行为 |
|---|---|
| 视频没有 CC 字幕 | 只返回标题/简介，并明确告诉模型"没字幕"——**不要瞎猜画面** |
| 未登录 | 字幕经常拿不到（B 站限制）；元信息不受影响 |
| 番剧 `ep/ss` 链接 | 暂不支持（后续走 PGC 接口） |
| 多分 P | 返回 `pages` 列表，默认取第 1 P 的字幕 |
| 网络/风控失败 | 抛结构化错误，通道侧降级成"打不开这个链接" |

## 路线图

- [x] **P0** 链接解析 + 视频信息 + 字幕读取 + 三个工具
- [x] **P0.5** 弹幕概况（免登录）：总条数 / 高光时段 / 被反复刷的梗 → `bili_danmaku`
- [x] **P1** 画面分镜：9 帧拼一张（时间戳 + 音频响度条）；B 站走官方流，其它链接走 yt-dlp
- [ ] **P2** 搜索/首页/UP 主列表 + Web 浏览面板
- [ ] **P3** 直播弹幕读取（WebSocket + brotli 解包）
- [ ] **P4** 直播回弹幕（默认关闭 + 限速 + 管理员）

## 对外契约（给通道用）

```ts
// 若宿主支持 provide，本插件会注册服务 dshBili
const bili = ctx.get('dshBili')   // 可能 undefined
await bili.resolve('https://b23.tv/xxxx')          // VideoInfo
await bili.subtitle('BV15cs96zEvi', { maxChars: 4000 })  // SubtitleResult
await bili.card('BV15cs96zEvi')                    // CardInfo（分享用）
```

**通道不负责解析，只负责"呈现"**：卡片怎么排版、图片怎么发、文件怎么传，都由通道自己决定。

## 参考实现（只借鉴接口，不复制代码）

- [ikenxuan/kkkkkk-10086](https://github.com/ikenxuan/kkkkkk-10086)（云崽版视频解析插件，新版为 [karin-plugin-kkk](https://github.com/ikenxuan/karin-plugin-kkk)）
- [lll-77777777/dsh-bili-scroll](https://github.com/lll-77777777/dsh-bili-scroll)（字幕判断 + 日报 + 评论互动）
- [CZX2244/dsh-bilibili](https://github.com/CZX2244/dsh-bilibili)（下载 + 抽帧 + ASR + 视觉总结）
- [Bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect)（接口文档）

## License

MIT

## 抖音解析（A 档，2026-11-26）

| 工具 | 作用 |
|---|---|
| `douyin_parse` | 解析抖音分享链接：yt-dlp 下载 + ffprobe 元数据 + 抽 16k 音频 + 9 帧分镜 |

- 不依赖抖音签名服务；部分内容需要 cookies（yt-dlp 侧处理，失败会提示）
- 产物落在 `~/.dsh/dsh-bili/douyin/<作品id>/`：视频、`audio.wav`（平台中立，不生成任何下游专用格式）
- 音频可交给 `tts_transcribe` 转台词，分镜图用 `read_image` 看画面；下游怎么用由调用方决定
- B 站 CDN 风控时的兜底：amagi 的 `/api/bilibili/fetch_video_playurl` 返回完整 mp4，下载后本地抽帧（实测 1464×954）
- amagi 的两个平台 cookie 与 B 站一致落文件：`~/.dsh/dsh-bili/amagi-douyin.txt` / `amagi-bilibili.txt`
  - 读取**文件优先**；设置页保存的长值会从 profile YAML 自愈读取并写入文件
  - 文件或 profile 变化后会重新读取（设置页保存 / 手动改文件都即时生效）

## B 站分析 / 抖音解析（2026-11-26）

| 工具 | 作用 |
|---|---|
| `bili_analyze` | B 站视频：官方流取元信息 + 抽 16k 音频 + 9 帧分镜（不下载整片） |
| `douyin_parse` | 抖音：元数据 + 视频 + 16k 音频 + 9 帧分镜；优先走 amagi 服务 |

抖音解析推荐配 **amagi 服务**（本地签名、无头可用，Docker 里也能跑）：

```yaml
# 插件设置
amagiBaseUrl: http://amagi:4567
```

容器见部署目录的 `amagi/`（Dockerfile + server.mjs）。没配 amagi 时退回 yt-dlp，
但 yt-dlp 的抖音提取器目前缺详情接口签名，通常只能报错——不是 cookie 问题。

产物落在 `~/.dsh/dsh-bili/douyin/<作品id>/`：`src.mp4`、`audio.wav`；
B 站音频在 `~/.dsh/dsh-bili/analysis/<bvid>/audio.wav`。均为平台中立文件，不生成下游专用格式。
