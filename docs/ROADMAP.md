# dsh-bili 长期规划：从"看视频"到"开直播"

> 记录于 2026-11-05。这份文档是**方向与边界**，不是实现细节；每个阶段落地时再补各自的设计。

## 已完成（基线，2026-11）

| 能力 | 状态 |
|---|---|
| 链接解析 / 视频信息 / 字幕（SESSDATA 可选） | ✅ |
| 弹幕概况（高光时段 / 梗） | ✅ |
| 画面分镜（9 格 + 波形；B站直连流 / yt-dlp / 本地文件） | ✅ |
| 搜索 / UP 查询（名字→mid 带粉丝消歧） | ✅ |
| 订阅（provider 架构：bili，可扩展抖音） | ✅ 在 dsh-napcat 侧 |
| 风控（412/-352/-799）冷却与退避 | ✅ |
| cookie 自愈（宿主截断时读 profile 原始 YAML） | ✅ |

## 总路线

```
P1 评论与投稿管理（写操作）
      ↓ 复用同一套 cookie / csrf / 风控设施
P2 直播：读弹幕 → TTS 语音（"会说话"）
      ↓ 同一套 TTS 管线
P3 桌宠（Live2D）+ 口型同步（"有身体"）
      ↓ 同一套语音 + 画面输出
P4 游戏控制插件（"能自己玩"，作为直播内容）
```

四阶段共用三条管线：**账号/风控**、**TTS 语音**、**画面输出**。

---

## P1 评论与投稿管理

### 目标
- 读视频评论、发评论/回复
- 查看自己的投稿列表与数据（播放/点赞/评论数）
- 修改稿件信息（标题/简介/标签/封面），必要时设为仅自己可见

### 接口（B站 Web API，需 SESSDATA + bili_jct(CSRF) + wbi 签名）

| 能力 | 接口 | 备注 |
|---|---|---|
| 读评论 | `/x/v2/reply/wbi/main`（oid=aid, type=1, mode=3, pn） | 需 wbi |
| 发评论 | `/x/v2/reply/add`（oid/type/message/csrf） | 写操作，风控最敏感 |
| 删除评论 | `/x/v2/reply/del`（rpid/csrf） | 仅自己的 |
| 我的投稿 | `/x/member/web/archive/list` 或 `/x/space/wbi/arc/search` | 前者需登录 |
| 稿件数据 | `/x/web-interface/archive/stat?bvid=` | 公开 |
| 修改稿件 | `/x/vu/web/edit` + `/x/vu/web/submit`（表单 + csrf） | 高风险，易被风控 |

### 设计要点
- **新增 cookie 字段**：`bili_jct`（CSRF token）必须从同一份 cookie 里取；当前 cookie 里已经有它（`bili_jct=...`），解析时顺便取出。
- **写操作门禁**：默认关闭；只允许管理员；每次操作前在聊天里二次确认（"要发这条评论吗？"），确认后才提交。
- **审计**：写操作写 `~/.dsh/dsh-bili/audit.jsonl`（时间 / 动作 / 目标 / 结果 / 错误码）。
- **风控**：写操作 412 概率远高于读；失败不重试超过 2 次，进入 30 分钟冷却。
- **失败语义**：B站在评论/投稿接口常用 `code=-101`（未登录）、`-111`（csrf 校验失败）、`-352`（风控）、`12002`（评论被吞）；这些要翻译成人话。

### 风险
- 账号被限权（评论功能禁用）风险真实存在 → 默认关闭、限频（如每小时 ≤5 条）、可一键停用。
- 修改稿件涉及表单上传（封面图）；先只做标题/简介/标签这类纯文本字段。

---

## P2 直播：读弹幕 + 语音输出

### 2.1 读直播弹幕

B站直播弹幕走 WebSocket，不是 HTTP：

```
1. GET /xlive/web-room/v1/index/getDanmuInfo?id=<room_id>  → token + 弹幕服务器地址
2. wss://<host>/sub  握手包（op=7，内容 {uid, roomid, protover:3, key:token}）
3. 之后 op=5 心跳（30s），op=3 心跳回复，op=5 弹幕消息（brotli 压缩 JSON）
4. 弹幕 JSON: cmd='DANMU_MSG'，info[1]=文本，info[2][1]=用户名
```

要点：
- **brotli 解压**（`protover=3`）；Node 自带 `zlib.brotliDecompressSync`
- 断线重连 + 心跳超时（服务端 60s 无心跳断开）
- 只看弹幕时不需要 cookie；要发弹幕/礼物信息则需要
- 房间号 → 真实房间号：短号需 `/room/v1/Room/room_init?id=`

### 2.2 语音输出（TTS）

本机有 ComfyUI + TTS-Audio-Suite，走**能力注册表**（`audio.tts`）生成 wav，不接外部云 TTS。

```
文本 → audio.tts（本地） → wav
        ├→ 发 QQ 语音（napcat: record 段，silk/amr 转码）
        ├→ 直播间播放（浏览器/OBS 捕获，见下）
        └→ 桌宠口型驱动（P3）
```

### 2.3 "直播发语音"的现实路径

B站**没有**给第三方"推音频到直播间"的开放接口。可行做法：

| 方案 | 说明 | 评价 |
|---|---|---|
| **A. 本地播放 + 虚拟声卡** | TTS 播放到 VB-Cable 等虚拟声卡，OBS 采集该声卡作为"麦克风" | 最常用、可控 |
| **B. 浏览器页面播放 + OBS 采集标签页** | 起一个本地页面循环播放 TTS，OBS 采集标签页音频 | 零驱动安装，延迟略高 |
| **C. 直接调 B站推流 SDK** | 需要自己实现 RTMP 推流并混音 | 工作量大，且官方 SDK 不公开音频通道 |

**建议**：先做 A/B（OBS 侧配置由用户完成），插件只负责"生成并播放 TTS"，不碰推流协议。

---

## P3 桌宠 + 口型（复用 dsh-pet-whale 与 dsh-live2dwaifu 的思路）

### 参考实现

| 项目 | 做法 | 可复用 |
|---|---|---|
| `wzwei1990/dsh-pet-whale` | 纯 DOM 渲染、零依赖；按 agent 状态切动画（idle/think/working/celebrate/error/feed）；支持多宠物 | 状态机、位置/拖拽、设置项、多实例管理 |
| `FujiwaraReisen/dsh-live2dwaifu` | 右下角 Live2D（Cubism core），眨眼/呼吸/说话嘴动；模型由用户放文件夹 | 模型加载、口型参数驱动、资源目录约定 |

### 设计

```
dsh-live2d（新插件，或 pet-whale 的 v2）
 ├ 渲染层：Live2D Cubism Web SDK（模型文件用户自备，插件不内置）
 ├ 状态层：订阅 agent 事件（working/idle/error）→ 表情/动作
 ├ 语音层：订阅 TTS 音频事件 → 播放 + 驱动口型
 └ 位置层：右下角浮层（可拖拽、可隐藏、透明度可调）
```

### 口型同步两种做法

| 做法 | 原理 | 优缺点 |
|---|---|---|
| **A. 实时振幅**（推荐先做） | Web Audio `AnalyserNode` 取 RMS 包络 → `ParamMouthOpenY = f(rms)` | 零预处理、任意音频都能用；精度一般 |
| **B. 预分析音素** | TTS 时同时拿到音素/时长（TTS-Audio-Suite 可能提供），按音素映射口型 | 更准，但依赖 TTS 输出音素信息 |

先做 A，够"说话时嘴动"；要更自然再上 B。

### 与 P2 的耦合

- TTS 音频统一成"事件"（比如 `dshTts/audio`，带 `{ url, durationMs, text }`）
- 桌宠、QQ 语音、直播音源都是这个事件的**消费者**，互不依赖

---

## P4 游戏控制插件（直播内容）

### 目标
让 agent 能启动/操作一个游戏，并把画面作为直播内容。

### 技术路线

| 环节 | 方案 | 备注 |
|---|---|---|
| 启动游戏 | 进程启动（配置可执行路径 + 参数） | 简单 |
| 输入模拟 | Windows：`SendInput`（原生）或 `robotjs`/`nut-js` | 需要前台焦点 |
| 看画面 | 定期截图 → 视觉模型（或 modlens / 本地 OCR） | 截图频率要控（1s 级） |
| 读状态 | 优先游戏自身的日志/内存插件（如支持） | 反作弊风险最低 |
| 直播 | OBS 采集游戏窗口 + 桌宠浮层 + TTS 声源 | 与 P3 共用 |

### 边界（必须写死）
- **只支持单机/离线游戏**（联网竞技类有反作弊，不做）
- **输入模拟默认关闭**，需要用户显式开启并在设置页确认
- 不做内存读写/注入（反作弊 + 法律风险）
- 每次操作记录审计日志

---

## 共用基础设施（四阶段都要）

| 设施 | 现状 | 需要补的 |
|---|---|---|
| cookie（SESSDATA + bili_jct） | 自愈读取 profile 原始 YAML | 解析并单独暴露 `biliJct` 供写操作 |
| 风控 | 412/-352/-799 冷却 | 写操作单独冷却（30 分钟）+ 失败不重试 |
| 缓存 | 搜索 5 分钟 / 详情 24 小时 | 评论列表分页缓存 |
| 审计 | 无 | `audit.jsonl` |
| TTS | 无 | 走 ComfyUI `audio.tts` 能力 |
| 事件总线 | 订阅用 outbox 文件拉取 | TTS 音频事件、直播弹幕事件 |

## 里程碑建议

| 里程碑 | 内容 | 依赖 | 预估 |
|---|---|---|---|
| M1 | 评论读取 + 我的投稿列表（只读） | 现有 cookie | 1~2 天 |
| M2 | 发评论（管理员 + 二次确认 + 审计） | M1 | 1 天 |
| M3 | 直播弹幕读取（WS + brotli + 心跳） | 无 | 2~3 天 |
| M4 | TTS 接入（ComfyUI audio.tts）+ QQ 语音发送 | 本地 TTS 可用 | 2 天 |
| M5 | 桌宠 Live2D + 口型（实时振幅） | M4 | 3~5 天 |
| M6 | 游戏控制（启动/输入/截图，单机） | 无 | 3~5 天 |
| M7 | 串成直播场景（OBS 配置 + 脚本） | M3/M4/M5/M6 | 2 天 |

## 未决问题（落地前要定）

1. **写操作的授权主体**：只允许管理员账号？还是每个群可以绑定不同账号？
2. **TTS 声音**：用哪个音色（本机 TTS-Audio-Suite 的音色库）？是否需要"每个角色一个声线"？
3. **直播插件归属**：直播能力放 dsh-bili（B站专用）还是新开 `dsh-live`（平台无关）？建议**新插件**，dsh-bili 只提供 B站数据源。
4. **桌宠归属**：改造 dsh-pet-whale 还是新开 `dsh-live2d`？建议**新插件**，pet-whale 保持"纯 DOM 轻量桌宠"。
5. **游戏清单**：先挑 1~2 个具体游戏验证（建议有日志/单机/窗口化）。

---

## 实测记录（2026-11-05，设计阶段取证）

### 直播接口在当前网络下被风控

```
room_init?id=1            → code=0（可用）
getDanmuInfo?id=5440      → code=-352（风控，即使带 SESSDATA）
second/getList            → code=-352
getInfoByRoom             → 未及测试（前一步就被拦）
```

结论：**直播接口比视频接口更严**，机房 IP + Node 请求很容易 -352。

### 两条可选实现路线

| 路线 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **A. 直连 WebSocket** | `getDanmuInfo` 拿 token → wss 订阅 | 轻、可后台跑、无浏览器依赖 | 依赖登录态与非机房 IP；本机当前被 -352 |
| **B. 浏览器页面 hook** | 用 `dsh_browser_*` 打开直播间，注入 JS 在页面上下文里 patch `WebSocket`，拦截 `DANMU_MSG` 后回传给插件 | 规避风控、复用已登录浏览器 | 需要浏览器在前台/常驻；资源占用高 |

建议：**先做 A**（判定条件：能拿到 token），**B 作为兜底/云端方案**。
若两条都不通，退化为"读页面 DOM 的弹幕列表"（延迟大、易漏，只作演示）。

### 对 P2 计划的影响

- 直播弹幕模块需要**失败可降级**：拿不到 token → 明确告知"当前网络被风控，请用浏览器通道"
- 语音输出不受影响（本地 TTS + OBS 采集），与风控无关

---

## 开源参考盘点（2026-11-05 核查，决定"从哪个开始做"）

| 计划项 | 参考项目 | 是否已覆盖 | 可复用的是什么 |
|---|---|---|---|
| P1 读评论 | `c1overzz/dsh-bili-scroll` / `holoiallo` fork | ✅ 已覆盖 | 评论拉取与筛选（fork 里有「评论区评分」，按热评 @ 率/时长打分），可直接照形态实现 |
| P1 发评论 | `dsh-bili-scroll` | ✅ 已覆盖（带门禁） | 关键设计：**只注册"发评论/回复评论"两个写工具**，上传视频/发动态/私信/抓全站「根本不注册」；自动评论有每轮上限（默认 1，最多 20） |
| P1 我的投稿/稿件数据 | `karin-plugin-kkk` | ⚠️ 部分（偏推送） | 作品信息聚合与卡片渲染形态；投稿管理（改标题/简介）**未见**，需自研 |
| P1 多平台（抖音等） | `karin-plugin-kkk` | ✅ 覆盖 | 多平台适配层形态，可借鉴给 dsh-napcat 的 provider 抽象 |
| P2 直播弹幕 | 以上**均无** | ❌ 无覆盖 | kkk 只有"开播/直播状态推送"（需进一步核实），**没人读弹幕**；需自研（见上节两条路线） |
| P2 TTS 语音 | 以上**均无** | ❌ 无覆盖 | live2dwaifu 有"哔哔电音"式的出声，不是真 TTS；真语音要接本机 ComfyUI `audio.tts` |
| P3 桌宠（状态/多宠物） | `wzwei1990/dsh-pet-whale` | ✅ 覆盖 | 纯 DOM + 零依赖、按 agent 状态切动画（idle/think/working/celebrate/error）、多宠物切换与持久化、思考流滚动 |
| P3 Live2D + 口型 | `FujiwaraReisen/dsh-live2dwaifu` | ✅ 覆盖 | Cubism core 加载、眨眼/呼吸、说话时口型、模型由用户自备、位置/大小持久化 |
| P3 外部推送口 | `FujiwaraReisen/dsh-live2dwaifu` | ✅ 覆盖 | `POST /dsh-live2d/api/push {text,image,mood}` 让她说一句——**这正是 P2 与 P3 的接缝**，我们照这个形态做"TTS 事件 → 桌宠说" |
| P4 游戏控制 | 以上**均无** | ❌ 无覆盖 | 需自研（SendInput + 截图） |

### 结论：从"最成熟"入手 = P3 + P2 的语音段

理由：
1. `dsh-live2dwaifu` 已经把「Live2D 加载 + 口型 + 推送接口 + 位置持久化」做完，我们只需把"电音出声"换成真 TTS，接缝最小。
2. `dsh-pet-whale` 已经把「状态机 + 多宠物 + 设置项」做完，可作为轻量兜底（无 Live2D 环境的用户）。
3. TTS 走本机 ComfyUI `audio.tts`，不依赖任何外部服务，也不受 B站风控影响。
4. 这两块做完，P2 的"语音输出"和 P3 的"身体"就同时具备，之后 P2 的弹幕（受风控）与 P4 的游戏（受反作弊）再各自推进。

### 实施顺序（修订）

```
M4  TTS 管线（ComfyUI audio.tts）+ 事件（dshTts/audio）       ← 先做
M5  桌宠：Live2D 渲染 + 口型（消费 dshTts/audio）             ← 紧跟
M1  评论读取（参考 dsh-bili-scroll 的拉取/筛选形态）
M2  发评论（照抄它的"只注册写评论 + 每轮上限"门禁）
M3  直播弹幕（自研，先直连 WS，失败降级浏览器 hook）
M6  游戏控制（自研）
M7  串直播场景
```

### 复用纪律

- **只借鉴设计，不 vendor 代码**：这些项目是独立插件，直接依赖会带来版本耦合
- 借用的是：接口形态（如 `/api/push`）、门禁策略（只注册写评论）、渲染思路（DOM/Cubism）
- 若要照抄具体实现，需先确认其许可证（pet-whale: MIT；live2dwaifu: MIT 需核实）

---

## 生态二轮盘点（2026-11-05，扫 awesome-dsh-plugin 8885 条 + GitHub 搜索）

结论先说：**我们的四个阶段里有三个阶段已经被社区做出来了**，重复造轮子不如直接用/接。

| 计划项 | 现有插件（★ = star） | 覆盖度 | 我们该做什么 |
|---|---|---|---|
| **P2 直播（弹幕+语音+推流）** | `luckui/dsh-livestream` ★53、`y3519712124-ui/dsh-livestreamingcompanion` ★9 | ✅ **整套** | **直接用**。它已实现：B站开播接口、OBS WebSocket 自动化（建场景/推流）、弹幕与礼物实时收取（B站官方 WS + WBI 签名；抖音走浏览器桥）、豆包 TTS（逐字字幕 + `[shocked]` 这类表情标记）、点播视频、私信 |
| **P2 TTS** | `Yuuyuko-uu/dsh-tts-bridge` ★230、`1624318455/dsh-plugin-tts` ★54（Edge TTS + RVC 自训音色）、`abbccdd/dsh-localtts` ★12、`GooDAnDReaDY/dsh-tts` ★6、`theskywilldawn/dsh-littlestar-anything-voice` | ✅ 成熟 | 本地音色需求已在 `dsh-livestreamingcompanion` 里用 **GPT-SoVITS** 解决；我们不必自研 TTS |
| **P3 桌宠 + 口型** | `FujiwaraReisen/dsh-live2dwaifu`、`ankesu/dsh-live2d-pet` ★6、`whitefirer/dsh-niulai-pet` ★17（口型同步）、`wzwei1990/dsh-pet-whale` ★3、`clown139880/dsh-live2d-avatar`、`Hyfwdnmd666/dsh-ai-ball`、`yu-wenchao/dsh-tool-lipsync` ★3 | ✅ 成熟 | 选一个装（Live2D 要模型自备）；我们只把 **TTS 音频事件**接进去 |
| **P4 游戏控制** | `momasiku/dsh-pilot` ★161（Windows 桌面自动化：眼睛+手，CAD/WPS/浏览器/微信都能操作）、`gychen-NJU/dsh-game-daily` ★38（原神/崩坏3/星铁日常代理，排班+计划任务）、`dsh-livestreamingcompanion` 的 `packages/dsh-game`（Minecraft/狼人杀/心跳文学部） | ✅ 成熟 | **直接复用**：pilot 提供键鼠/截图，game-daily 提供"排班+执行+汇报"形态 |
| **P1 读评论** | `Sacredbluedragon/dsh-bili-watch` ★12（元数据/评论/弹幕/AI字幕/ASR/抽帧OCR）、`CZX2244/dsh-bilibili`、`dsh-bili-scroll` | ✅ | 可直接装；我们已有弹幕概况/字幕，按需补评论 |
| **P1 发评论/互动** | `acttk/dsh-bili-interactor` ★3（点赞/投币/**发弹幕**/评论/回评论/回复监听，带可视化面板）、`dsh-bili-scroll`（发评论+门禁） | ✅ | 参考其门禁：只注册少量写工具、每轮上限、回复监听 |
| **P1 投稿管理（改标题/简介/封面/数据看板）** | **没有找到** | ❌ **空白** | **这是 dsh-bili 唯一值得自研的写能力** |
| 跨插件事件总线 | `Chinesezjc/dsh-interconnect` ★38（跨实例消息/事件投递） | ✅ | P2→P3 的"TTS 事件"可用它，或沿用我们的 outbox 文件模式 |
| B站数据层（搜索/UP/订阅） | `nisew2/dsh-whale-dive`（WBI 签名 + 限速 pacer，B站+抖音） | ⚠️ 类似 | 我们已有等价实现（含风控冷却 + cookie 自愈），保持不动 |

### 决策（2026-11-05，用户定）

1. **投稿管理先不做**，放到最后
2. **所有能力都自己写一遍**，社区插件只作为参考实现（不直接装、不 vendor 代码）
3. 顺序：从"参考形态最成熟、依赖最少"的开始

### 自研路线（每项都标注参考实现）

| 阶段 | 自研内容 | 参考实现（只借鉴形态） | 独立成 | 依赖 | 风险 |
|---|---|---|---|---|---|
| **S1 TTS 管线** | 文本 → 本机 ComfyUI `audio.tts` → wav → 事件 `dshTts/audio` → 消费者（QQ 语音 / 浏览器播放 / 口型） | `dsh-tts-bridge` ★230（会话自动朗读的接法）、`dsh-plugin-tts` ★54（Edge TTS + RVC 音色的切换）、`livestreamingcompanion`（GPT-SoVITS 本地音色） | `dsh-tts-local`（新） | ComfyUI 可用 | 低（无风控） |
| **S2 桌宠 + 口型** | 右下角浮层渲染 + 状态机 + 消费 `dshTts/audio` 驱动口型 | `dsh-live2dwaifu`（Cubism + 口型 + `/api/push`）、`ankesu/dsh-live2d-pet`（状态驱动表情）、`dsh-niulai-pet` ★17（口型同步的轻量做法）、`pet-whale`（纯 DOM 状态机） | `dsh-pet`（新，先 DOM 版，后 Live2D） | S1 事件 | 低 |
| **S3 直播弹幕（读）** | 直播间 WS 客户端：token → wss /sub → op=5 心跳/弹幕 → brotli 解压 → 归一化成事件 | `livestreamingcompanion`（B站官方 WS + WBI 签名；抖音走浏览器桥页面内截取）、`wanjiqi-meme`（弹幕语料用法） | `dsh-live`（新） | 登录态 / 非机房 IP | 中（本次实测 -352） |
| **S4 直播舞台 + 推流** | 舞台页（弹幕流/角色/字幕）+ 调 B站开播接口 + OBS WebSocket 自动化（建场景/开播/收尾） | `dsh-livestream` ★53（整套形态：开播/下播/谢幕/点播/私信） | `dsh-live` | S1 + S3 + OBS | 中（开播接口风控） |
| **S5 语音输出到直播** | TTS 播放 → 虚拟声卡 / OBS 采集标签页；字幕与表情标记（`[shocked]` 这类） | `dsh-livestream`（逐字字幕 + 表情切帧） | `dsh-live` | S1 + S4 | 低 |
| **S6 游戏控制** | 启动进程 + 键鼠模拟（SendInput）+ 定时截图 + 简单状态读取 | `dsh-pilot` ★161（Windows 桌面自动化：眼睛+手）、`dsh-game-daily` ★38（排班/计划任务/汇报）、`livestreamingcompanion/game`（Minecraft 摄像机视角接舞台） | `dsh-agent-game`（新） | 无 | 中（反作弊，限单机） |
| **S7 评论/互动** | 评论读写 + 点赞/投币/发弹幕 + 回复监听 | `dsh-bili-interactor` ★3（互动面板 + 回复监听）、`dsh-bili-scroll`（只注册写评论 + 每轮上限的门禁） | 并入 `dsh-bili` | 现有 cookie | 中（写操作风控） |
| **S8 投稿管理** | 稿件列表/数据/改标题简介（封面上传最后） | 无现成参考（生态空白） | 并入 `dsh-bili` | 现有 cookie + bili_jct | 高（表单 + 风控） |

> **S8 附带一条**：发布/管理视频后，**自动为自己视频登记"新评论"监听**（`root=0`），不必手动 add。
> 目前的区别与现状（2026-11-05 确认）：
> - 自己发的**评论**被人回复 → 发评论时已自动登记（`root=<rpid>`）✅
> - 自己发的**视频**有新评论 → 现在只能手动 `bili_reply_watch add url=<视频>`（`root=0`），S8 时改成自动

### 插件边界（自研版）

```
dsh-bili        数据层 + B站写操作（评论/互动/投稿管理，S7/S8）
dsh-tts-local   语音合成（S1）：ComfyUI audio.tts → wav + 事件
dsh-pet         桌宠（S2）：DOM/Live2D + 口型，订阅 dshTts/audio
dsh-live        直播（S3~S5）：弹幕 WS + 舞台 + OBS 自动化
dsh-agent-game  游戏控制（S6）：输入模拟 + 截图
```

跨插件契约（先定，避免后期返工）：

| 事件/服务 | 方向 | 载荷 |
|---|---|---|
| `dshTts.speak(text, {voice})` | 生产者（bili/live/napcat）→ S1 | 文本 |
| `dshTts/audio` 事件 | S1 → 消费者（pet / live / napcat） | `{url, durationMs, text, visemes?}` |
| `dshDanmaku/message` 事件 | dsh-live → 消费者（舞台/会话注入） | `{roomId, user, text, kind: 'danmaku'|'gift'|'sc'|'enter'}` |
| `dshGame.input` / `dshGame.screenshot` | 会话工具 ↔ dsh-agent-game | 键鼠指令 / PNG 路径 |

### 建议动手顺序

```
S1 TTS      （1~2 天，无风控、是后面所有语音的底座）
S2 桌宠      （3~5 天，DOM 版先跑通口型，再上 Live2D）
S3 弹幕读取  （2~3 天，先直连 WS，不行再上浏览器桥）
S4 舞台推流  （3~5 天）
S5 语音入流  （1 天）
S6 游戏      （3~5 天）
S7 评论互动  （2 天）
S8 投稿管理  （最后，风险最高）
```

## 未决问题（落地前要定）

1. TTS 音色：用 ComfyUI TTS-Audio-Suite 里哪个音色？是否需要"每个角色一个声线"？
2. 桌宠先做 DOM 版（快）还是直接上 Live2D（要模型文件）？
3. 直播用哪个平台先验证：B站（风控严）还是抖音（要浏览器桥）？
4. 游戏先挑哪个：Minecraft（有现成摄像机视角思路）还是单机单窗口游戏？
