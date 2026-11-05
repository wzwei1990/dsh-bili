/**
 * dsh-bili 设置页（浏览器半边，手写客户端模块，免构建）。
 *
 * 形态与 dsh-napcat / dsh-game 一致：
 *   window.__ModuleLoader__.load({ id, factory }) + factory 内 module/exports 样板
 *
 * ⚠️ 整段包在 IIFE 里：客户端模块以普通脚本注入，共享全局作用域，
 * 顶层写 const 会和别的插件撞名，导致整个 web boot 挂掉。
 */
;(() => {
  const moduleLoader = typeof window === 'undefined' ? undefined : window.__ModuleLoader__
  if (moduleLoader === undefined || moduleLoader === null) return

  moduleLoader.load({
    id: 'dsh-bili',
    factory: (require) => {
      var module = { exports: {} }
      var exports = module.exports

      const react = require('react')
      const NS = 'dsh-bili'

      const FIELDS = [
        { section: '账号' },
        {
          key: 'sessdata',
          label: 'SESSDATA（B 站登录 cookie，字幕需要；留空=未登录）',
          kind: 'textarea',
          hint: '浏览器登录 bilibili.com → F12 → Application → Cookies → SESSDATA，复制 Value。约半年过期。',
        },
        { key: 'timeoutMs', label: '请求超时（毫秒）', kind: 'number', hint: '默认 15000' },

        { section: '字幕与缓存' },
        { key: 'subtitleMaxChars', label: '字幕最多返回多少字', kind: 'number', hint: '默认 6000' },
        { key: 'cacheTtlMinutes', label: '页面/字幕缓存（分钟）', kind: 'number', hint: '默认 1440' },

        { section: '搜索' },
        { key: 'searchCacheMinutes', label: '搜索/UP 结果缓存（分钟）', kind: 'number', hint: '默认 5，减少接口压力' },

        { section: '写操作（评论 / 互动）' },
        {
          key: 'allowWrite',
          label: '允许写操作（发评论 / 点赞 / 投币 / 发弹幕）',
          kind: 'boolean',
          hint: '默认关闭。打开后会真实作用于你的 B 站账号，每次写都记审计（~/.dsh/dsh-bili/audit.jsonl）。',
        },
        { key: 'writePerHour', label: '每小时最多写几次', kind: 'number', hint: '默认 5，风控保护' },
        { key: 'writeCooldownMinutes', label: '命中风控后冷却（分钟）', kind: 'number', hint: '默认 30' },
        { key: 'commentCacheMinutes', label: '评论读取缓存（分钟，0=不缓存）', kind: 'number', hint: '默认 3，减少评论接口压力' },
        { key: 'replyWatchMax', label: '回复监听最多几条', kind: 'number', hint: '默认 20' },
        { key: 'autoWatchOwnComments', label: '发完评论自动盯它（有人回复能被检查出来）', kind: 'boolean', hint: '默认开启' },
        { key: 'replyWatchDays', label: '监听保留天数（0=永久；过期自动清理）', kind: 'number', hint: '默认 7 天；连续 3 次检查失败（评论被删）也会自动清理' },

        { section: '登录态文件' },
        {
          key: 'cookieFile',
          label: 'cookie 文件路径（留空=~/.dsh/dsh-bili/cookie.txt，存在则优先）',
          kind: 'text',
          hint: '配置里的多行 cookie 可能被宿主截断；文件方式更稳，插件也会自动把可用值同步到这个文件。',
        },

        { section: '画面分镜' },
        {
          key: 'storyboard',
          label: '抽帧做分镜图（9 帧拼一张，附时间轴与响度条）',
          kind: 'boolean',
          hint: '需要 ffmpeg；非 B 站链接还需要 yt-dlp。关掉则只给字幕/弹幕。',
        },
        { key: 'storyboardFrames', label: '分镜帧数（4 / 9 / 16）', kind: 'number', hint: '默认 9' },
        { key: 'maxStoryboardMinutes', label: '超过多少分钟就不抽帧（0=不限）', kind: 'number', hint: '默认 30，防止拉长片' },
        { key: 'ffmpegPath', label: 'ffmpeg 路径（留空=自动探测）', kind: 'text', placeholder: '如 C:\\ffmpeg\\bin\\ffmpeg.exe 或 /usr/bin/ffmpeg' },
        { key: 'ytdlpPath', label: 'yt-dlp 路径（留空=自动探测）', kind: 'text', placeholder: '如 C:\\tools\\yt-dlp.exe 或 /usr/local/bin/yt-dlp' },

        { section: '日志' },
        {
          key: 'logLevel',
          label: '日志级别',
          kind: 'select',
          options: [['info', 'info：只记关键事件'], ['debug', 'debug：每次请求都打'], ['warn', 'warn：只记问题']],
        },
      ]

      const style = {
        wrap: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '4px 2px', maxWidth: '720px' },
        hint: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #666)', margin: 0 },
        row: { display: 'flex', flexDirection: 'column', gap: '4px' },
        label: { fontSize: '13px', fontWeight: 600 },
        sub: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #666)', margin: 0 },
        input: {
          font: 'inherit', fontSize: '13px', padding: '7px 9px', borderRadius: '6px',
          border: '1px solid var(--dsw-alias-border-l2, #d0d0d0)',
          background: 'var(--dsw-alias-bg-l1, #fff)', color: 'inherit', width: '100%', boxSizing: 'border-box',
        },
        checkRow: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' },
        bar: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '6px' },
        btn: {
          font: 'inherit', fontSize: '13px', padding: '7px 14px', borderRadius: '6px', cursor: 'pointer',
          border: '1px solid var(--dsw-alias-border-l2, #d0d0d0)', background: 'transparent', color: 'inherit',
        },
        primary: {
          font: 'inherit', fontSize: '13px', padding: '7px 14px', borderRadius: '6px', cursor: 'pointer',
          border: '1px solid transparent', background: 'var(--dsw-alias-state-business-primary, #1677ff)', color: '#fff',
        },
        error: { color: 'var(--dsw-alias-state-error-primary, #d4380d)', fontSize: '12px', margin: 0, whiteSpace: 'pre-wrap' },
        ok: { color: 'var(--dsw-alias-state-success-primary, #389e0d)', fontSize: '12px', margin: 0 },
      }

      function unwrap(result) {
        if (result !== null && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'ok')) {
          if (result.ok !== true) {
            const code = result.error && result.error.code
            const message = result.error && result.error.message
            throw new Error((code ? code + ': ' : '') + (message || 'remote call failed'))
          }
          return result.value
        }
        return result
      }

      function remoteOf(ctx) {
        try {
          const viaNamespace = ctx.remote && ctx.remote.settings
          if (viaNamespace && typeof viaNamespace.describe === 'function') return { settings: viaNamespace }
          const viaService = typeof ctx.get === 'function' ? ctx.get('remote.settings') : undefined
          if (viaService && typeof viaService.describe === 'function') return { settings: viaService }
          return null
        } catch (error) {
          return null
        }
      }

      function renderField(field, value, onChange) {
        const id = NS + '-' + field.key
        if (field.kind === 'boolean') {
          return react.createElement('div', { style: style.checkRow, key: field.key },
            react.createElement('input', {
              id, type: 'checkbox', checked: Boolean(value),
              onChange: (event) => onChange(field.key, event.target.checked),
            }),
            react.createElement('label', { htmlFor: id }, field.label))
        }
        let control
        if (field.kind === 'select') {
          control = react.createElement('select', {
            id, style: style.input, value: value == null ? '' : String(value),
            onChange: (event) => onChange(field.key, event.target.value),
          }, field.options.map((pair) => react.createElement('option', { key: pair[0], value: pair[0] }, pair[1])))
        } else if (field.kind === 'number') {
          control = react.createElement('input', {
            id, type: 'number', style: style.input, value: value == null ? '' : String(value),
            onChange: (event) => onChange(field.key, event.target.value === '' ? undefined : Number(event.target.value)),
          })
        } else if (field.kind === 'textarea') {
          control = react.createElement('textarea', {
            id, style: Object.assign({}, style.input, { minHeight: '96px', resize: 'vertical', fontFamily: 'monospace' }),
            rows: 4,
            placeholder: field.placeholder, value: value == null ? '' : String(value),
            onChange: (event) => onChange(field.key, event.target.value),
          })
        } else {
          control = react.createElement('input', {
            id, type: field.kind === 'password' ? 'password' : 'text', style: style.input,
            placeholder: field.placeholder, value: value == null ? '' : String(value),
            onChange: (event) => onChange(field.key, event.target.value),
          })
        }
        return react.createElement('div', { style: style.row, key: field.key },
          react.createElement('label', { style: style.label, htmlFor: id }, field.label),
          field.hint === undefined ? null : react.createElement('p', { style: style.sub }, field.hint),
          control)
      }

      function BiliSettingsPage(props) {
        const ctx = props.ctx
        const [state, setState] = react.useState({ phase: 'loading' })
        const [draft, setDraft] = react.useState({})
        const [revision, setRevision] = react.useState(undefined)
        const [message, setMessage] = react.useState(undefined)

        const load = react.useCallback(async () => {
          const remote = remoteOf(ctx)
          if (remote === null) {
            setState({ phase: 'unsupported' })
            return
          }
          setState({ phase: 'loading' })
          try {
            const described = unwrap(await remote.settings.describe())
            const list = described && Array.isArray(described.namespaces) ? described.namespaces : []
            if (!Array.isArray(described && described.namespaces)) {
              throw new Error('describe 返回的形状不对：' + JSON.stringify(described).slice(0, 200))
            }
            const row = list.find((item) => item && item.ns === NS)
            if (row === undefined) {
              setState({ phase: 'missing' })
              return
            }
            setDraft(Object.assign({}, row.value || {}))
            setRevision(row.revision)
            setState({ phase: 'ready' })
          } catch (error) {
            setState({ phase: 'error', error: String(error && error.message ? error.message : error) })
          }
        }, [ctx])

        react.useEffect(() => { void load() }, [load])

        const save = async () => {
          const remote = remoteOf(ctx)
          if (remote === null) return
          setMessage(undefined)
          try {
            const described = unwrap(await remote.settings.describe())
            const list = described && Array.isArray(described.namespaces) ? described.namespaces : []
            const row = list.find((item) => item && item.ns === NS)
            const next = {}
            for (const field of FIELDS) {
              if (!Object.prototype.hasOwnProperty.call(draft, field.key)) continue
              const value = draft[field.key]
              if (value === undefined) continue
              if (field.kind === 'number') { next[field.key] = Number(value); continue }
              if (field.kind === 'boolean') { next[field.key] = Boolean(value); continue }
              next[field.key] = value
            }
            await unwrap(await remote.settings.update(NS, next, row ? row.revision : revision))
            setMessage({ ok: true, text: '已保存（写入 profile 的 cordis.patch.yml，插件会热重载）' })
            await load()
          } catch (error) {
            setMessage({ ok: false, text: '保存失败：' + String(error && error.message ? error.message : error) })
          }
        }

        if (state.phase === 'loading') return react.createElement('p', { style: style.hint }, '读取配置中…')

        if (state.phase === 'unsupported') {
          return react.createElement('div', { style: style.wrap },
            react.createElement('p', { style: style.hint }, '当前宿主没有暴露 settings Remote 域，无法在本页读写配置。可以手动在 profile 的 cordis.patch.yml 追加：'),
            react.createElement('pre', { style: style.hint },
              '- id: ' + NS + '\n  name: ' + NS + '\n  config:\n    sessdata: <你的 SESSDATA>\n    storyboard: true\n    storyboardFrames: 9'))
        }

        if (state.phase === 'missing') {
          return react.createElement('div', { style: style.wrap },
            react.createElement('p', { style: style.hint }, '宿主里没找到 dsh-bili 的配置条目。确认插件已安装并启用，再点重试。'),
            react.createElement('button', { style: style.btn, onClick: () => void load() }, '重试'))
        }

        if (state.phase === 'error') {
          return react.createElement('div', { style: style.wrap },
            react.createElement('p', { style: style.error }, '读取配置失败：' + state.error),
            react.createElement('button', { style: style.btn, onClick: () => void load() }, '重试'))
        }

        return react.createElement('div', { style: style.wrap },
          react.createElement('p', { style: style.hint },
            '依赖：B 站链接只需要 ffmpeg（抽帧）；其它网站链接还需要 yt-dlp。装好后路径留空会自动探测。' +
            (revision === undefined ? '' : ' 当前 revision：' + revision)),
          FIELDS.map((field) => {
            if (field.section !== undefined) {
              return react.createElement('div', {
                key: 'section:' + field.section,
                style: { marginTop: '18px', paddingTop: '10px', borderTop: '1px solid var(--dsw-alias-border-l1, #e5e5e5)' },
              },
                react.createElement('div', {
                  style: { fontWeight: 600, fontSize: '13px', color: 'var(--dsw-alias-label-secondary, #555)' },
                }, field.section))
            }
            return renderField(field, draft[field.key], (key, value) => {
              setDraft((previous) => {
                const nextDraft = Object.assign({}, previous)
                nextDraft[key] = value
                return nextDraft
              })
            })
          }),
          react.createElement('div', { style: style.bar },
            react.createElement('button', { style: style.primary, onClick: () => void save() }, '保存'),
            react.createElement('button', { style: style.btn, onClick: () => void load() }, '重新读取'),
            message === undefined ? null
              : react.createElement('p', { style: message.ok ? style.ok : style.error }, message.text)))
      }

      const inject = ['slots', 'remote', 'remote.settings']

      function apply(ctx) {
        const Page = (props) => react.createElement(BiliSettingsPage, Object.assign({}, props, { ctx: ctx }))
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'bili',
          order: 63,
          label: () => 'B站',
        }, Page))
      }

      exports.apply = apply
      exports.inject = inject
      return module.exports
    },
  })
})()
