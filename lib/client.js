/**
 * 合并包的客户端半边壳：由 tools/build-client.mjs 把 lib/features/*.client.js 拼进下面
 * 的 FEATURES 标记处（标记本身就是一行注释），生成 lib/client.js。
 *
 * 想改功能就改特性源文件，然后跑 `node tools/build-client.mjs`；不要直接编辑产物。
 *
 * 为什么必须合成一个条目：一个包只能有一个客户端入口（entry id == 包名，且同名两行
 * 会被 client-modules 直接判错），所以四个功能在这里汇成一个 cordis 条目：
 *
 *   - 包页面上的配置表单**永远**挂载 —— 开关关掉之后，总得还有地方打开。
 *   - 三个浏览器功能按配置里的同名开关，用 ctx.plugin(...) 挂成子 fiber；关掉就是
 *     fiber.dispose()，它注册的 DOM、slot、locale 文案随 fiber 一起回收。
 *   - 设置镜像还没到位时全部放行，行为与合并前一致。
 */
window.__ModuleLoader__.load({
	id: 'dsh-gui-tweaks',
	factory: (require) => {
		const module = { exports: {} }
		const exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

		const React = require('react')

		/** 包名（模块 id，也是 plugins.bundle.config 的 key）与 patch 里的行 id。 */
		const PACKAGE = 'dsh-gui-tweaks'
		const ROW_ID = 'gui-tweaks'

		/**
		 * Client half of the Browser Bookmarks bundle.
		 *
		 * A `bookmarks` tab type for the right Sidebar: one list of saved HTTP(S)
		 * addresses, add and remove controls, and a row click that opens the address as
		 * a new tab of the shipped Browser type. The list itself lives in the host half
		 * (`/api/browser-bookmarks/*`), so it survives reloads, plugin restarts, and a
		 * backup/restore to the other computer; this half keeps only the render state.
		 *
		 * Why a tab type rather than a bar inside the Browser body: the Browser's body
		 * is a keyed registration of `sidebar.right.pane.tab` with no nested slot, so
		 * nothing can draw inside it without replacing it. A sibling tab type is the
		 * documented extension path, and it can sit in the second pane beside the
		 * Browser, or open the page on top of itself.
		 *
		 * This is a non-dynamic client package: there is no `styles` builtin and no
		 * restricted global set, so styles are inline (theme tokens still resolve) and
		 * the host is reached over plain fetch.
		 */

		/** Feature body, adopted verbatim from the standalone client bundle. */
		const installBookmarks = (() => {
			const TAB_ID = 'dsh-browser-bookmarks'
			const TAB_KIND = 'bookmarks'
			const BROWSER_KIND = 'browser'
			const NS = 'browserBookmarks'
			const BASE = '/api/browser-bookmarks'
			const MAX_URL = 2048
			const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

			const S = {
				root: {
					height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column',
					background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-secondary)',
					fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5,
				},
				head: {
					flex: 'none', display: 'flex', flexDirection: 'column', gap: 6,
					padding: '8px 10px', borderBottom: '1px solid var(--dsw-alias-border-l1)',
				},
				headRow: { display: 'flex', gap: 6, alignItems: 'center' },
				input: {
					minWidth: 0, height: 28, padding: '0 8px', borderRadius: 6,
					border: '1px solid var(--dsw-alias-border-l1)',
					background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
					font: 'inherit', fontSize: 12,
				},
				urlInput: { flex: '1 1 auto' },
				nameInput: { height: 26, fontSize: 12 },
				add: {
					flex: 'none', height: 28, padding: '0 12px', borderRadius: 6,
					border: '1px solid var(--dsw-alias-border-l2)',
					background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
					font: 'inherit', fontSize: 12, cursor: 'pointer',
				},
				addOff: { opacity: 0.5, cursor: 'default' },
				err: {
					flex: 'none', padding: '6px 10px', fontSize: 12,
					color: 'var(--dsw-alias-state-error-primary)',
					borderBottom: '1px solid var(--dsw-alias-border-l1)',
				},
				list: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '4px 0' },
				empty: { padding: '16px 12px', fontSize: 12, opacity: 0.7 },
				row: {
					display: 'flex', alignItems: 'stretch', gap: 4, margin: '0 4px',
					padding: '0 4px 0 6px', borderRadius: 6,
				},
				rowHover: { background: 'var(--dsw-alias-bg-layer-1)' },
				rowMain: {
					flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column',
					alignItems: 'flex-start', gap: 1, padding: '6px 2px',
					border: 0, background: 'transparent', color: 'inherit',
					font: 'inherit', textAlign: 'left', cursor: 'pointer',
				},
				rowName: {
					maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis',
					whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-primary)',
				},
				rowUrl: {
					maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis',
					whiteSpace: 'nowrap', fontSize: 11, opacity: 0.62,
				},
				del: {
					flex: 'none', alignSelf: 'center', display: 'flex', alignItems: 'center',
					justifyContent: 'center', width: 26, height: 26, padding: 0,
					border: 0, borderRadius: 6, background: 'transparent',
					color: 'var(--dsw-alias-label-secondary)', opacity: 0.7, cursor: 'pointer',
				},
				foot: {
					flex: 'none', padding: '5px 10px', borderTop: '1px solid var(--dsw-alias-border-l1)',
					fontSize: 11, opacity: 0.55, whiteSpace: 'nowrap',
					overflow: 'hidden', textOverflow: 'ellipsis',
				},
				footWarn: { color: 'var(--dsw-alias-state-warn-primary)', opacity: 0.85 },
				launch: {
					display: 'flex', alignItems: 'center', justifyContent: 'center',
					width: 26, height: 26, padding: 0, border: 0, borderRadius: 6,
					background: 'transparent', color: 'inherit', opacity: 0.75, cursor: 'pointer',
				},
			}

			// ----------------------------------------------------------------- copy
			const zh = {
				'type.label': '书签',
				'guide.title': '书签',
				'guide.description': '打开常用网页',
				'url.placeholder': '粘贴网址，例如 example.com',
				'title.placeholder': '名称（可选，默认取域名）',
				add: '添加',
				remove: '删除',
				open: '在浏览器标签页里打开',
				empty: '还没有书签。把常用网址填在上面，按「添加」即可收藏。',
				busy: '读取中…',
				'count.unit': '个书签',
				'hint.with-browser': '点一行就在浏览器标签页里打开它。',
				'hint.no-browser': '右侧栏的「浏览器」标签页没有启用，暂时打不开地址。',
				'error.empty': '请先输入网址。',
				'error.invalid': '这个网址无法识别。',
				'error.protocol': '只支持 HTTP 和 HTTPS 网址。',
				'error.credentials': '网址里不能带用户名或密码。',
				'error.too-long': '这个网址太长了。',
				'error.duplicate': '这个网址已经在书签里了。',
				'error.full': '书签数量已达上限。',
				'error.app-origin': '不能把 DSH 应用自身加为书签。',
				'error.missing': '这条书签已经不存在了。',
				'error.browser-missing': '没有可用的浏览器标签页，无法打开这个地址。',
				'error.open-failed': '打开这个地址失败',
				'error.host': '书签服务没有响应',
				'error.invalid-body': '请求格式不对',
			}
			const en = {
				'type.label': 'Bookmarks',
				'guide.title': 'Bookmarks',
				'guide.description': 'Open saved pages',
				'url.placeholder': 'Paste an address, e.g. example.com',
				'title.placeholder': 'Name (optional; the host by default)',
				add: 'Add',
				remove: 'Remove',
				open: 'Open in a Browser tab',
				empty: 'No bookmarks yet. Paste a common address above and press Add.',
				busy: 'Loading…',
				'count.unit': 'bookmarks',
				'hint.with-browser': 'Click a row to open it in a Browser tab.',
				'hint.no-browser': 'The right Sidebar Browser tab is not enabled, so addresses cannot be opened.',
				'error.empty': 'Enter an address first.',
				'error.invalid': 'That address could not be read.',
				'error.protocol': 'Only HTTP and HTTPS addresses are supported.',
				'error.credentials': 'An address cannot carry a username or password.',
				'error.too-long': 'That address is too long.',
				'error.duplicate': 'That address is already saved.',
				'error.full': 'The bookmark list is full.',
				'error.app-origin': 'The DSH application itself cannot be bookmarked.',
				'error.missing': 'That bookmark no longer exists.',
				'error.browser-missing': 'No Browser tab is available to open that address.',
				'error.open-failed': 'Opening that address failed',
				'error.host': 'The bookmark service did not answer',
				'error.invalid-body': 'The request was malformed',
			}

			// The definition thunks are read on every use, so binding here is enough
			// for them; components take the slot-injected live `t` instead.
			let boundT = (key) => key

			// ---------------------------------------------------------------- store
			// Module scope, not component state: the tab system unmounts an inactive
			// body, and the list must survive that.
			const st = { items: [], loaded: false, busy: false, error: null }
			let listeners = []

			const notify = () => {
				for (const fn of listeners.slice()) fn()
			}
			const set = (patch) => {
				Object.assign(st, patch)
				notify()
			}
			const message = (error) => {
				if (error === null || error === undefined) return 'unknown error'
				if (typeof error === 'string') return error
				return error.message ? String(error.message) : String(error)
			}

			const post = async (route, body) => {
				const response = await fetch(BASE + route, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body === undefined ? {} : body),
				})
				const payload = await response.json().catch(() => null)
				if (payload === null || typeof payload !== 'object') throw new Error('HTTP ' + String(response.status))
				return payload
			}

			const refresh = async () => {
				if (!st.loaded) set({ busy: true })
				try {
					const payload = await post('/list', {})
					set({
						items: Array.isArray(payload.items) ? payload.items : [],
						loaded: true, busy: false, error: null,
					})
				} catch (error) {
					set({ loaded: true, busy: false, error: { text: message(error) } })
				}
			}

			/**
			 * Check an address in the browser, mirroring the host's policy so the
			 * obvious mistakes never leave the page. The host checks again.
			 * @param raw - the input field's text.
			 * @returns `{ url }` or `{ code }`.
			 */
			const precheck = (raw) => {
				const text = typeof raw === 'string' ? raw.trim() : ''
				if (text === '') return { code: 'empty' }
				if (text.length > MAX_URL) return { code: 'too-long' }
				let parsed
				try {
					parsed = new URL(HAS_SCHEME.test(text) ? text : 'https://' + text)
				} catch {
					return { code: 'invalid' }
				}
				if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { code: 'protocol' }
				if (parsed.username !== '' || parsed.password !== '') return { code: 'credentials' }
				if (parsed.hostname === '') return { code: 'invalid' }
				// The shipped Browser refuses its own application origin; match it here
				// so the failure arrives as a message instead of a dead tab.
				if (parsed.origin === window.location.origin) return { code: 'app-origin' }
				return { url: parsed.href }
			}

			const add = async (rawUrl, rawTitle) => {
				const checked = precheck(rawUrl)
				if (checked.code !== undefined) {
					set({ error: { code: checked.code } })
					return false
				}
				set({ busy: true, error: null })
				try {
					const payload = await post('/add', {
						url: checked.url,
						title: typeof rawTitle === 'string' ? rawTitle.trim() : '',
					})
					if (payload.error !== undefined) {
						set({ busy: false, error: { code: String(payload.error) } })
						return false
					}
					set({
						items: Array.isArray(payload.items) ? payload.items : [],
						loaded: true, busy: false, error: null,
					})
					return true
				} catch (error) {
					set({ busy: false, error: { text: message(error) } })
					return false
				}
			}

			const remove = async (id) => {
				set({ busy: true, error: null })
				try {
					const payload = await post('/remove', { id })
					if (payload.error !== undefined) {
						set({ busy: false, error: { code: String(payload.error) } })
						return
					}
					set({
						items: Array.isArray(payload.items) ? payload.items : [],
						loaded: true, busy: false, error: null,
					})
				} catch (error) {
					set({ busy: false, error: { text: message(error) } })
				}
			}

			// -------------------------------------------------------------- actions
			let ctxRef = null

			/** Whether the shipped Browser type is registered, i.e. whether openTab would accept the kind. */
			const browserRegistered = () => {
				try {
					const tabs = ctxRef === null ? undefined : ctxRef.get('sidebarRightTabs')
					return tabs !== undefined && typeof tabs.get === 'function' && tabs.get(BROWSER_KIND) !== undefined
				} catch {
					return false
				}
			}

			/** Open this bookmarks tab in the mounted Session's right Sidebar. */
			const openPanel = () => {
				const rightbar = ctxRef === null ? undefined : ctxRef.get('sidebarRight')
				if (rightbar === undefined) return
				try {
					rightbar.openTab(TAB_KIND, { revealIfOpened: true })
				} catch (error) {
					console.error('browser-bookmarks: could not open the tab: ' + message(error))
				}
			}

			// ---------------------------------------------------------------- glyphs
			const Glyph = (props) => {
				const size = props && typeof props.size === 'number' ? props.size : 16
				const opacity = props && props.active ? 1 : 0.82
				return React.createElement('svg', {
					width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
					'aria-hidden': 'true', style: { opacity, display: 'block' },
				},
					React.createElement('path', {
						d: 'M4.6 2.4h6.8a.9.9 0 0 1 .9.9v10.1L8 10.4l-4.3 3V3.3a.9.9 0 0 1 .9-.9z',
						stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round',
					}),
				)
			}

			const CrossGlyph = () => React.createElement('svg', {
				width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none',
				'aria-hidden': 'true', style: { display: 'block' },
			}, React.createElement('path', {
				d: 'M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6',
				stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round',
			}))

			/** Sidebar-foot-style launch button in the conversation header's utility row. */
			const Launch = (props) => {
				const t = typeof props.t === 'function' ? props.t : boundT
				const label = t('type.label')
				return React.createElement('button', {
					type: 'button', style: S.launch, title: label, 'aria-label': label,
					onClick: (event) => { event.preventDefault(); openPanel() },
				}, Glyph({ size: 15 }))
			}

			// ----------------------------------------------------------------- views
			const Row = (props) => {
				const item = props.item
				const t = props.t
				const hover = React.useState(false)
				const name = item.title !== '' ? item.title : item.url
				return React.createElement('div', {
					style: hover[0] ? Object.assign({}, S.row, S.rowHover) : S.row,
					onMouseEnter: () => hover[1](true),
					onMouseLeave: () => hover[1](false),
				},
					React.createElement('button', {
						type: 'button', style: S.rowMain,
						title: t('open') + ' — ' + item.url,
						onClick: () => props.onOpen(item.url),
					},
						React.createElement('span', { style: S.rowName }, name),
						React.createElement('span', { style: S.rowUrl }, item.url),
					),
					React.createElement('button', {
						type: 'button', style: S.del,
						title: t('remove'), 'aria-label': t('remove') + ': ' + name,
						onClick: () => props.onRemove(item.id),
					}, CrossGlyph()),
				)
			}

			const Body = (props) => {
				const t = typeof props.t === 'function' ? props.t : boundT
				const info = props.useTabInfo()
				const urlState = React.useState('')
				const nameState = React.useState('')
				const force = React.useState(0)[1]

				React.useEffect(() => {
					const fn = () => force((value) => value + 1)
					listeners.push(fn)
					return () => { listeners = listeners.filter((entry) => entry !== fn) }
				}, [])
				React.useEffect(() => { refresh() }, [])

				const submit = (event) => {
					event.preventDefault()
					add(urlState[0], nameState[0]).then((ok) => {
						if (!ok) return
						urlState[1]('')
						nameState[1]('')
					})
				}

				const open = (target) => {
					const actions = info !== null && info !== undefined && info.tab !== undefined
						? info.tab.actions
						: undefined
					if (actions === undefined || !browserRegistered()) {
						set({ error: { code: 'browser-missing' } })
						return
					}
					try {
						actions.openTab(BROWSER_KIND, { params: { url: target }, revealIfOpened: false })
						set({ error: null })
					} catch (error) {
						set({ error: { code: 'open-failed', detail: message(error) } })
					}
				}

				const error = st.error
				let errorText = ''
				if (error !== null) {
					const head = error.code !== undefined ? t('error.' + error.code) : String(error.text !== undefined ? error.text : '')
					errorText = error.detail !== undefined && error.detail !== '' ? head + ' — ' + error.detail : head
				}

				const hasBrowser = browserRegistered()
				const rows = st.items.map((item) => React.createElement(Row, {
					key: item.id, item, t, onOpen: open, onRemove: remove,
				}))

				let foot = hasBrowser ? t('hint.with-browser') : t('hint.no-browser')
				if (st.busy) foot = t('busy')
				else if (st.loaded && st.items.length > 0) foot = String(st.items.length) + ' ' + t('count.unit') + ' · ' + foot

				return React.createElement('div', { style: S.root },
					React.createElement('form', { style: S.head, onSubmit: submit },
						React.createElement('div', { style: S.headRow },
							React.createElement('input', {
								type: 'text', style: Object.assign({}, S.input, S.urlInput),
								value: urlState[0], placeholder: t('url.placeholder'),
								'aria-label': t('url.placeholder'), spellCheck: false,
								onChange: (event) => urlState[1](event.target.value),
							}),
							React.createElement('button', {
								type: 'submit',
								style: st.busy ? Object.assign({}, S.add, S.addOff) : S.add,
								disabled: st.busy === true,
							}, t('add')),
						),
						React.createElement('input', {
							type: 'text', style: Object.assign({}, S.input, S.nameInput),
							value: nameState[0], placeholder: t('title.placeholder'),
							'aria-label': t('title.placeholder'),
							onChange: (event) => nameState[1](event.target.value),
						}),
					),
					errorText === '' ? null : React.createElement('div', { style: S.err }, errorText),
					st.items.length === 0
						? React.createElement('div', { style: Object.assign({}, S.list, S.empty) },
							st.busy ? t('busy') : t('empty'))
						: React.createElement('div', { style: S.list }, rows),
					React.createElement('div', {
						style: hasBrowser ? S.foot : Object.assign({}, S.foot, S.footWarn),
					}, foot),
				)
			}

			const Title = (props) => {
				const t = typeof props.t === 'function' ? props.t : boundT
				return React.createElement('span', null, t('type.label'))
			}

			// ------------------------------------------------------------------ wire
			function apply(ctx) {
				ctxRef = ctx
				boundT = ctx.locale.bind(NS)

				ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'browser-bookmarks: copy')

				const slots = ctx.get('slots')
				if (slots === undefined) return

				// sidebarRightTabs mounts independently of this package, so the type
				// registration retries briefly instead of assuming it already exists.
				const registerType = () => {
					const tabs = ctx.get('sidebarRightTabs')
					if (tabs === undefined) return false
					try {
						const dispose = tabs.register({
							id: TAB_ID,
							kind: TAB_KIND,
							priority: 'extension',
							title: () => boundT('type.label'),
							guide: [{
								id: 'open',
								order: 45,
								title: () => boundT('guide.title'),
								description: () => boundT('guide.description'),
								icon: Glyph,
							}],
						})
						ctx.effect(() => dispose)
					} catch (error) {
						console.error('browser-bookmarks: could not register the tab type: ' + message(error))
					}
					return true
				}

				ctx.effect(() => {
					if (registerType()) return () => {}
					let attempts = 0
					const stop = ctx.interval(() => {
						attempts += 1
						if (registerType() || attempts >= 20) stop()
					}, 500)
					return stop
				})

				ctx.effect(() => slots.inject('sidebar.right.pane.tab', () => slots.register(
					{ name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS },
					Body,
				)))

				ctx.effect(() => slots.inject('sidebar.right.pane.tab.title', () => slots.register(
					{ name: 'sidebar.right.pane.tab.title', key: TAB_ID, locale: NS },
					Title,
				)))

				ctx.effect(() => slots.inject('conversation.session.header.utilities', () => slots.register(
					{
						name: 'conversation.session.header.utilities',
						id: TAB_ID,
						order: 45,
						label: () => boundT('type.label'),
						locale: NS,
					},
					Launch,
				)))
			}
			return apply
		})()

		/**
		 * Client half of the session-delete plugin.
		 *
		 * Adds a trash button to every conversation row in the left Workspace panel
		 * and to every row of Settings -> Archived sessions, then asks the Host half to
		 * delete the stored log.
		 *
		 * Both surfaces are package-internal components that publish no row-action
		 * slot, so the buttons are plain DOM nodes: the row element is located by its
		 * CSS-module suffix, its Session identity is read from the React fiber (the
		 * row's "node" prop, a sessionId prop, or the row's React key), and the button
		 * is inserted into the row's own hover-revealed actions container on the left
		 * panel or beside the row's Unarchive action in Settings, so it inherits the
		 * native layout and reveal behavior. Every injected node is removed again when
		 * the plugin unloads.
		 */

		/** Feature body, adopted verbatim from the standalone client bundle. */
		const installSessionDelete = (() => {
			var BASE = '/api/session-admin'
			var MARK = 'data-dsh-session-delete'
			var STYLE_ID = 'dsh-session-delete-css'
			var NS = 'dsh-session-delete'

			var zh = {
				button: '删除会话',
				confirmTitle: '删除会话',
				confirmText: '确定要删除会话“{title}”吗？聊天记录会从磁盘删除，且无法恢复。',
				cancel: '取消',
				confirm: '删除',
				deleting: '删除中…',
				failed: '删除失败：{message}',
				running: '该会话正在运行，请先停止后再删除。',
				notFound: '没有找到该会话的存储记录，可能已被删除。',
			}
			var en = {
				button: 'Delete conversation',
				confirmTitle: 'Delete conversation',
				confirmText: 'Delete conversation “{title}”? Its transcript is removed from disk and cannot be recovered.',
				cancel: 'Cancel',
				confirm: 'Delete',
				deleting: 'Deleting…',
				failed: 'Delete failed: {message}',
				running: 'This conversation is running. Stop it before deleting.',
				notFound: 'No stored log was found for this conversation; it may already be gone.',
			}
			/** Browser-derived fallback used until the app's own locale service answers. */
			var browserZh = String(document.documentElement.lang || navigator.language || '').toLowerCase().indexOf('zh') === 0
			/** The active UI language, preferring the composed locale service over the document. */
			function uiZh() {
				try {
					if (ctxRef !== null && typeof ctxRef.get === 'function') {
						var locale = ctxRef.get('locale')
						if (locale != null && typeof locale.getLocale === 'function') {
							var active = String(locale.getLocale().active || '').toLowerCase()
							if (active !== '') return active.indexOf('zh') === 0
						}
					}
				} catch (error) {
					/* fall through to the browser-derived guess */
				}
				return browserZh
			}
			var t = browserZh ? zh : en
			/** Re-resolve copy, so a late locale answer or a language switch is honored. */
			function refreshTexts() {
				t = uiZh() ? zh : en
			}

			var CSS = [
				'.dsh-sd-icon{width:16px;height:16px;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex:none;font:inherit}',
				'.dsh-sd-icon:hover{color:var(--dsw-alias-state-error-primary)}',
				'.dsh-sd-archived{margin-right:8px}',
				'.dsh-sd-backdrop{position:fixed;inset:0;z-index:2147000000;display:flex;align-items:center;justify-content:center;background:rgba(15,17,20,.34);padding:24px}',
				'.dsh-sd-dialog{width:min(380px,100%);box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 12px 32px rgba(0,0,0,.18);padding:18px 20px 16px;font-size:13px;line-height:20px}',
				'.dsh-sd-dialog h2{margin:0 0 8px;font-size:15px;font-weight:600;line-height:22px}',
				'.dsh-sd-dialog p{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;word-break:break-word}',
				'.dsh-sd-error{display:none;margin-top:10px;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;word-break:break-word}',
				'.dsh-sd-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}',
				'.dsh-sd-btn{height:28px;padding:0 12px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}',
				'.dsh-sd-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
				'.dsh-sd-btn-danger{border-color:transparent;background:var(--dsw-alias-state-error-primary);color:#fff}',
				'.dsh-sd-btn[disabled]{opacity:.6;cursor:default}',
			].join('')

			var ctxRef = null
			var observer = null
			var timer = null
			var dialog = null

			function installStyle() {
				if (document.querySelector('style[' + MARK + ']') !== null) return
				var style = document.createElement('style')
				style.setAttribute(MARK, 'style')
				style.id = STYLE_ID
				style.textContent = CSS
				document.head.appendChild(style)
			}

			function reactKey(el) {
				var keys = Object.keys(el)
				for (var i = 0; i < keys.length; i++) {
					if (keys[i].indexOf('__reactFiber$') === 0 || keys[i].indexOf('__reactInternalInstance$') === 0) return keys[i]
				}
				return null
			}

			/** The Session identity carried by an element's React fiber ancestry. */
			function sessionOf(el) {
				var key = reactKey(el)
				if (key === null) return null
				var fiber = el[key]
				var depth = 0
				while (fiber != null && depth < 80) {
					var props = fiber.memoizedProps
					if (props != null && typeof props === 'object') {
						var node = props.node
						if (node != null && typeof node.id === 'string' && node.id.indexOf('session-') === 0) {
							return { id: node.id, title: typeof node.title === 'string' ? node.title : '' }
						}
						if (typeof props.sessionId === 'string' && props.sessionId.indexOf('session-') === 0) {
							return { id: props.sessionId, title: '' }
						}
					}
					if (typeof fiber.key === 'string' && fiber.key.indexOf('session-') === 0) {
						return { id: fiber.key, title: '' }
					}
					fiber = fiber.return
					depth += 1
				}
				return null
			}

			function titleOf(row) {
				var title = row.querySelector('[class*="_title"]')
				if (title !== null) return (title.textContent || '').trim()
				return (row.textContent || '').trim().slice(0, 80)
			}

			function icon() {
				return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
					'<path d="M2.75 4.25h10.5M6.4 4.25v-.9c0-.5.3-.85.8-.85h1.6c.5 0 .8.35.8.85v.9M4.3 4.25l.55 8.6c.03.48.43.85.91.85h4.48c.48 0 .88-.37.91-.85l.55-8.6" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>' +
					'<path d="M6.6 6.9v4M9.4 6.9v4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>' +
					'</svg>'
			}

			function buttonLabel(info) {
				return t.button + '“' + (info.title === '' ? info.id : info.title) + '”'
			}

			function bindDelete(button, info) {
				button.addEventListener('click', function (event) {
					event.preventDefault()
					event.stopPropagation()
					confirmDelete(info)
				})
			}

			function makeIconButton(info) {
				var button = document.createElement('button')
				button.type = 'button'
				button.setAttribute(MARK, info.id)
				button.className = 'dsh-sd-icon'
				button.setAttribute('aria-label', buttonLabel(info))
				button.setAttribute('title', buttonLabel(info))
				button.innerHTML = icon()
				bindDelete(button, info)
				return button
			}

			function makeArchivedButton(info) {
				var button = document.createElement('button')
				button.type = 'button'
				button.setAttribute(MARK, info.id)
				button.className = 'dsh-sd-btn dsh-sd-archived'
				button.setAttribute('aria-label', buttonLabel(info))
				button.setAttribute('title', buttonLabel(info))
				button.textContent = t.confirm
				bindDelete(button, info)
				return button
			}

			/** One conversation row in the left Workspace panel. */
			function sweepSidebar() {
				var rows = document.querySelectorAll('[class*="_sessionRow"]')
				for (var i = 0; i < rows.length; i++) {
					var row = rows[i]
					var actions = row.querySelector('[class*="_rowActions"]')
					if (actions === null) continue
					if (actions.querySelector('[' + MARK + ']') !== null) continue
					var info = sessionOf(row)
					if (info === null) continue
					if (info.title === '') info.title = titleOf(row)
					actions.insertBefore(makeIconButton(info), actions.firstChild)
				}
			}

			/** The Session id a list row is itself keyed by, independent of its copy. */
			function rowSessionId(row) {
				var key = reactKey(row)
				if (key === null) return null
				var fiber = row[key]
				if (fiber != null && typeof fiber.key === 'string' && fiber.key.indexOf('session-') === 0) return fiber.key
				return null
			}

			/**
			 * One archived-conversation row in Settings: an <li> whose own React key is
			 * a Session id and which carries exactly one row action (Unarchive). Kept
			 * structural rather than label-matched so it survives any UI language.
			 */
			function sweepArchived() {
				var rows = document.querySelectorAll('li')
				for (var i = 0; i < rows.length; i++) {
					var row = rows[i]
					if (row.querySelector('[' + MARK + ']') !== null) continue
					var sessionId = rowSessionId(row)
					if (sessionId === null) continue
					var action = null
					for (var j = 0; j < row.children.length; j++) {
						var child = row.children[j]
						if (child.tagName === 'BUTTON' && !child.hasAttribute(MARK)) {
							action = child
							break
						}
					}
					if (action === null) continue
					var info = { id: sessionId, title: titleOf(row) }
					row.insertBefore(makeArchivedButton(info), action)
				}
			}

			function refreshSessions() {
				try {
					if (ctxRef === null || typeof ctxRef.get !== 'function') return
					var sessions = ctxRef.get('sessions')
					if (sessions != null && typeof sessions.refresh === 'function') sessions.refresh().catch(function () {})
				} catch (error) {
					console.warn('session-delete: session list refresh failed', error)
				}
			}

			function messageFor(body, fallback) {
				if (body != null && body.error === 'session-running') return t.running
				if (body != null && body.error === 'not-found') return t.notFound
				if (body != null && typeof body.message === 'string' && body.message !== '') return body.message
				return fallback
			}

			function closeDialog() {
				if (dialog === null) return
				var current = dialog
				dialog = null
				current.remove()
			}

			function onKeyDown(event) {
				if (dialog !== null && event.key === 'Escape') {
					event.preventDefault()
					closeDialog()
				}
			}

			function confirmDelete(info) {
				closeDialog()
				var title = info.title === '' ? info.id : info.title
				var backdrop = document.createElement('div')
				backdrop.className = 'dsh-sd-backdrop'
				var panel = document.createElement('div')
				panel.className = 'dsh-sd-dialog'
				panel.setAttribute('role', 'dialog')
				panel.setAttribute('aria-modal', 'true')
				var heading = document.createElement('h2')
				heading.textContent = t.confirmTitle
				var body = document.createElement('p')
				body.textContent = t.confirmText.split('{title}').join(title)
				var error = document.createElement('div')
				error.className = 'dsh-sd-error'
				var actions = document.createElement('div')
				actions.className = 'dsh-sd-actions'
				var cancel = document.createElement('button')
				cancel.type = 'button'
				cancel.className = 'dsh-sd-btn'
				cancel.textContent = t.cancel
				cancel.addEventListener('click', closeDialog)
				var confirm = document.createElement('button')
				confirm.type = 'button'
				confirm.className = 'dsh-sd-btn dsh-sd-btn-danger'
				confirm.textContent = t.confirm
				confirm.addEventListener('click', function () {
					confirm.disabled = true
					cancel.disabled = true
					confirm.textContent = t.deleting
					fetch(BASE + '/delete', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ sessionId: info.id }),
					}).then(function (response) {
						return response.json().catch(function () { return {} }).then(function (payload) {
							return { ok: response.ok, payload: payload }
						})
					}).then(function (result) {
						if (!result.ok) throw new Error(messageFor(result.payload, 'HTTP ' + String(result.payload && result.payload.error)))
						closeDialog()
						refreshSessions()
						sweep()
					}).catch(function (failure) {
						error.textContent = t.failed.split('{message}').join(failure && failure.message ? failure.message : String(failure))
						error.style.display = 'block'
						confirm.disabled = false
						cancel.disabled = false
						confirm.textContent = t.confirm
					})
				})
				actions.appendChild(cancel)
				actions.appendChild(confirm)
				panel.appendChild(heading)
				panel.appendChild(body)
				panel.appendChild(error)
				panel.appendChild(actions)
				backdrop.appendChild(panel)
				backdrop.addEventListener('mousedown', function (event) {
					if (event.target === backdrop) closeDialog()
				})
				document.body.appendChild(backdrop)
				dialog = backdrop
				confirm.focus()
			}

			function sweep() {
				try {
					refreshTexts()
					sweepSidebar()
					sweepArchived()
				} catch (error) {
					console.warn('session-delete: sweep failed', error)
				}
			}

			function schedule() {
				if (timer !== null) return
				timer = setTimeout(function () {
					timer = null
					sweep()
				}, 250)
			}

			function apply(ctx) {
				ctxRef = ctx
				installStyle()
				sweep()
				observer = new MutationObserver(schedule)
				observer.observe(document.body, { childList: true, subtree: true })
				document.addEventListener('keydown', onKeyDown, true)
				ctx.effect(function () {
					return function () {
						if (observer !== null) {
							observer.disconnect()
							observer = null
						}
						document.removeEventListener('keydown', onKeyDown, true)
						if (timer !== null) {
							clearTimeout(timer)
							timer = null
						}
						closeDialog()
						var injected = document.querySelectorAll('button[' + MARK + ']')
						for (var index = 0; index < injected.length; index++) injected[index].remove()
						var style = document.querySelector('style[' + MARK + ']')
						if (style !== null) style.remove()
					}
				}, NS + ': teardown')
			}
			return apply
		})()

		/**
		 * Client half of the sidebar-swap bundle.
		 *
		 * Adds one switch to Settings -> General that swaps the shell's two side
		 * columns: the Workspace/Session list moves to the frame's trailing track and
		 * the right panel (files, terminal, documents) moves to its leading track,
		 * while the Conversation keeps the center. Everything happens on top of the
		 * shipped AppFrame: the plugin marks the frame's three in-flow columns, reverses
		 * the grid's inline axis so each column keeps its own track while that track
		 * lands on the other side of the frame, mirrors the dividers, the right panel's
		 * anchored edge and its slide-out direction, and keeps the frame's own drag
		 * handles on the boundary they resize - mirroring the pointer delta, so a drag
		 * still grows the column the cursor moves toward.
		 *
		 * The preference lives in this browser's localStorage. Every mark, style tag,
		 * observer and listener is removed again when the plugin unloads.
		 */

		/** Feature body, adopted verbatim from the standalone client bundle. */
		const installSidebarSwap = (() => {
			var h = React.createElement

			/** Locale namespace, the browser preference key, and the marks this plugin owns. */
			var NS = 'dsh-sidebar-swap'
			var STORAGE_KEY = 'dsh.sidebar-swap.enabled'
			var ROOT_ATTR = 'data-dsh-sidebar-swap'
			var GEOMETRY_ATTR = 'data-dsh-swap-geometry'
			var FRAME_ATTR = 'data-dsh-swap-frame'
			var COLUMN_ATTR = 'data-dsh-swap-col'
			var STYLE_ATTR = 'data-dsh-sidebar-swap-css'
			var SIDEBAR_LEFT_VAR = '--dsh-swap-handle-sidebar'
			var RIGHTBAR_LEFT_VAR = '--dsh-swap-handle-rightbar'
			/** The shell nodes whose (re)mounting needs another sync pass. */
			var WATCH_SELECTOR = '[' + COLUMN_ATTR + '],[data-rightbar-col],[data-side],[data-sidebar-right-session]'

			var zh = {
				title: '左右侧栏互换',
				description: '会话列表移到右边，文件 / 终端 / 文档面板移到左边；分隔条仍可拖动调宽。开关记在本机浏览器里。',
				switchLabel: '互换左右侧栏',
				on: '已互换',
				off: '默认',
			}
			var en = {
				title: 'Swap side columns',
				description: 'Moves the conversation list to the right and the files, terminal and document panel to the left; the dividers still resize both. Kept in this browser.',
				switchLabel: 'Swap the left and right side columns',
				on: 'Swapped',
				off: 'Default',
			}

			/** Bound namespace lookup, replaced by the composed locale service in apply(). */
			var boundT = null
			/** Browser-derived fallback used until the app's own locale service answers. */
			var browserZh = String((typeof navigator !== 'undefined' && (navigator.language || navigator.userLanguage)) || 'en').toLowerCase().indexOf('zh') === 0

			/** Localized text from the bundled dictionary when no service is bound. */
			function fallbackT(key) {
				var dict = browserZh ? zh : en
				return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key
			}

			/** Localized text for one key of this plugin's namespace. */
			function t(key) {
				return boundT === null ? fallbackT(key) : boundT(key)
			}

			var CSS = `
	/* ---- the preference row: host row pattern, title/description beside the control ---- */
	.dshss_row{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}
	.dshss_rowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}
	.dshss_title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}
	.dshss_desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}
	.dshss_control{align-items:center;gap:8px;display:inline-flex}
	.dshss_switch{border-radius:var(--dsw-radius-md);box-sizing:border-box;height:36px;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:13px;line-height:18px;background:0 0;border:0;align-items:center;gap:8px;padding:0 8px;display:inline-flex}
	.dshss_switch:hover{color:var(--dsw-alias-label-primary)}
	.dshss_switch:focus-visible{outline:1px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
	.dshss_track{background:var(--dsw-alias-border-l2);border-radius:9px;width:30px;height:18px;transition:background-color .12s var(--ds-ease-in-out);flex:none;display:inline-block;position:relative}
	.dshss_track[data-on=true]{background:var(--dsw-alias-state-business-primary)}
	.dshss_thumb{corner-shape:round;background:var(--dsw-alias-bg-layer-1);border-radius:50%;width:12px;height:12px;transition:transform .12s var(--ds-ease-in-out);position:absolute;top:3px;left:3px}
	.dshss_track[data-on=true] .dshss_thumb{transform:translate(12px)}
	.dshss_state{white-space:nowrap}

	/* ---- trade sides: reverse the grid's inline axis ----
	   Each column keeps the track that already carries its own width: the sidebar's
	   exact fixed-width track moves to the frame's trailing edge and the right panel's
	   max-capped track (zero while hidden) moves to its leading edge. Placing the
	   columns into each other's tracks instead would hand the sidebar the panel's
	   width, so the axis, not the items, is what flips. The columns stay LTR, so
	   nothing inside them mirrors. ---- */
	html[data-dsh-sidebar-swap] [data-dsh-swap-frame]{direction:rtl}
	html[data-dsh-sidebar-swap] [data-dsh-swap-frame] > *{direction:ltr}
	/* The same flip straight off the shipped marker, so the very first paint of the
	   frame is already swapped and does not have to wait for this module's marks. */
	html[data-dsh-sidebar-swap] div:has(> [data-rightbar-col]){direction:rtl}
	html[data-dsh-sidebar-swap] div:has(> [data-rightbar-col]) > *{direction:ltr}

	/* ---- dividers follow the columns they separate ---- */
	html[data-dsh-sidebar-swap] [data-dsh-swap-col=sidebar]{border-right:none;border-left:.5px solid var(--dsw-alias-border-l3)}
	html[data-dsh-sidebar-swap][data-platform=darwin] [data-dsh-swap-col=center]{border-left:none;border-right:.5px solid var(--dsw-alias-border-l3)}
	html[data-dsh-sidebar-swap][data-platform=darwin] [data-dsh-swap-frame][data-sidebar-collapsed] [data-dsh-swap-col=center]{border-right:none}
	html[data-dsh-sidebar-swap][data-windows-titlebar] [data-dsh-swap-col=sidebar]{border-left:none}
	html[data-dsh-sidebar-swap][data-windows-titlebar] [data-dsh-swap-col=rightbar]{background:var(--dsw-alias-bg-base);border-radius:var(--dsh-windows-content-radius) 0 0 0;corner-shape:round}
	html[data-dsh-sidebar-swap][data-windows-titlebar] [data-dsh-swap-frame]:not([data-rightbar-collapsed]) [data-dsh-swap-col=center]{border-radius:0}

	/* ---- the right panel anchors to the frame's leading edge and slides out toward it ----
	   Keyed on [data-sidebar-right-panel], which only the panel itself carries: the
	   per-Session wrapper carries data-sidebar-right-session too and is never "open". ---- */
	html[data-dsh-sidebar-swap] [data-sidebar-right-panel]{right:auto;left:0}
	html[data-dsh-sidebar-swap] [data-sidebar-right-panel]:not([data-sidebar-right-open]) [data-dockkit-host=dock],
	html[data-dsh-sidebar-swap] [data-sidebar-right-panel]:not([data-sidebar-right-open]) [data-dockkit-empty],
	html[data-dsh-sidebar-swap] [data-sidebar-right-panel]:not([data-sidebar-right-open]) [data-dockkit-divider]{transform:translateX(calc(-1 * var(--dsh-sidebar-width)))}
	html[data-dsh-sidebar-swap] [data-sidebar-right-toggle] svg{transform:none}

	/* ---- drag handles sit on the boundary they resize, measured after every layout change ---- */
	html[data-dsh-sidebar-swap][data-dsh-swap-geometry] [data-dsh-swap-frame] > [data-side=sidebar]{left:var(--dsh-swap-handle-sidebar,0px) !important}
	html[data-dsh-sidebar-swap][data-dsh-swap-geometry] [data-dsh-swap-frame] > [data-side=rightbar]{left:var(--dsh-swap-handle-rightbar,0px) !important}
	`

			/* ------------------------------------------------------------------ *
			 * Preference: one boolean, persisted in this browser.
			 * ------------------------------------------------------------------ */
			var enabled = false
			var listeners = []

			/** The stored preference; a browser that refuses storage reports the default. */
			function readStored() {
				try {
					return window.localStorage.getItem(STORAGE_KEY) === '1'
				} catch (error) {
					return false
				}
			}

			/** Persist the preference; a browser that refuses storage still gets the toggle for this page. */
			function writeStored(value) {
				try {
					window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
				} catch (error) {
					/* nothing to do: the switch just does not survive a reload here */
				}
			}

			/** @returns an unsubscriber for one row listener. */
			function subscribe(listener) {
				listeners.push(listener)
				return function () {
					var at = listeners.indexOf(listener)
					if (at >= 0) listeners.splice(at, 1)
				}
			}

			/** Notify every mounted row. */
			function publish() {
				for (var index = 0; index < listeners.length; index += 1) {
					try {
						listeners[index]()
					} catch (error) {
						console.error(NS + ': settings row listener failed', error)
					}
				}
			}

			/* ------------------------------------------------------------------ *
			 * Shell controller: marks, geometry and drag mirroring.
			 * ------------------------------------------------------------------ */
			var refs = { frame: null, sidebar: null, center: null, rightbar: null }
			var tagged = []
			var styleTag = null
			var documentObserver = null
			var resizeObserver = null
			var observed = []
			var drag = null
			var probeTimer = null
			var rafId = null
			var timers = []
			var discoveryWarned = false

			/** Insert this plugin's stylesheet once. */
			function installStyles() {
				if (styleTag !== null && styleTag.isConnected === true) return
				styleTag = document.createElement('style')
				styleTag.setAttribute(STYLE_ATTR, '')
				styleTag.textContent = CSS
				document.head.appendChild(styleTag)
			}

			/** Remove this plugin's stylesheet. */
			function removeStyles() {
				if (styleTag !== null) {
					styleTag.remove()
					styleTag = null
				}
			}

			/** Drop every mark this plugin put on the shell, leaving the shipped layout intact. */
			function clearTags() {
				for (var index = 0; index < tagged.length; index += 1) {
					tagged[index].removeAttribute(FRAME_ATTR)
					tagged[index].removeAttribute(COLUMN_ATTR)
				}
				tagged = []
			}

			/**
			 * Find the frame and mark its three in-flow columns. The frame renders the
			 * sidebar column, the center column and the rightbar column in that order;
			 * its overlays, handles and window-chrome seat are absolutely positioned and
			 * therefore never part of the grid flow.
			 * @returns whether the shell was found and marked.
			 */
			function discover() {
				var rightbar = document.querySelector('[data-rightbar-col]')
				if (rightbar === null) {
					refs.frame = null
					clearTags()
					return false
				}
				var frame = rightbar.parentElement
				if (frame === null) {
					refs.frame = null
					clearTags()
					return false
				}
				var flow = []
				for (var index = 0; index < frame.children.length; index += 1) {
					var child = frame.children[index]
					if (window.getComputedStyle(child).position === 'absolute') continue
					flow.push(child)
				}
				if (flow.length !== 3 || flow[2] !== rightbar) {
					if (!discoveryWarned) {
						discoveryWarned = true
						console.error(NS + ': the shell frame no longer has three in-flow columns; leaving the layout alone')
					}
					refs.frame = null
					clearTags()
					return false
				}
				discoveryWarned = false
				refs.frame = frame
				refs.sidebar = flow[0]
				refs.center = flow[1]
				refs.rightbar = flow[2]
				frame.setAttribute(FRAME_ATTR, '')
				flow[0].setAttribute(COLUMN_ATTR, 'sidebar')
				flow[1].setAttribute(COLUMN_ATTR, 'center')
				flow[2].setAttribute(COLUMN_ATTR, 'rightbar')
				tagged = [frame, flow[0], flow[1], flow[2]]
				return true
			}

			/** Whether one mutation record's node is (or contains) something this plugin measures. */
			function isWatched(node) {
				if (node.nodeType !== 1) return false
				if (typeof node.matches === 'function' && node.matches(WATCH_SELECTOR) === true) return true
				return typeof node.querySelector === 'function' && node.querySelector(WATCH_SELECTOR) !== null
			}

			/** Re-sync only when a watched node mounted or unmounted; chat streaming stays free. */
			function onDocumentMutations(records) {
				for (var index = 0; index < records.length; index += 1) {
					var record = records[index]
					if (record.type !== 'childList') continue
					var added = record.addedNodes
					var removed = record.removedNodes
					for (var at = 0; at < added.length; at += 1) {
						if (isWatched(added[at])) {
							schedule()
							return
						}
					}
					for (var out = 0; out < removed.length; out += 1) {
						if (isWatched(removed[out])) {
							schedule()
							return
						}
					}
				}
			}

			/** Observe the nodes whose size changes move a boundary. */
			function observeNodes() {
				var wanted = [refs.frame, refs.sidebar, refs.center, refs.rightbar]
				var panels = refs.rightbar.querySelectorAll('[data-sidebar-right-panel]')
				for (var index = 0; index < panels.length; index += 1) wanted.push(panels[index])
				if (wanted.length === observed.length) {
					var same = true
					for (var at = 0; at < wanted.length; at += 1) {
						if (wanted[at] !== observed[at]) {
							same = false
							break
						}
					}
					if (same) return
				}
				if (resizeObserver !== null) resizeObserver.disconnect()
				resizeObserver = new ResizeObserver(schedule)
				observed = wanted
				for (var each = 0; each < wanted.length; each += 1) resizeObserver.observe(wanted[each])
			}

			/* ------------------------------------------------------------------ *
			 * Drag mirroring.
			 *
			 * The shipped handle computes its width change from
			 * `clientX - pointerdownX`, which grows its column toward the frame's
			 * trailing edge. Once the columns have traded sides the same handle must
			 * grow toward the opposite edge, so the gesture is replayed with the
			 * pointer's X reflected around the position where the drag began.
			 *
			 * The real move and up are swallowed in the WINDOW's capture phase: that
			 * runs before every other listener on the page - including the shell's own
			 * handlers, wherever they are attached and in either phase - so the shell
			 * can never also process the unmirrored event and win the last write. The
			 * real pointerdown is left untouched, so the shell still arms its drag,
			 * takes its pointer capture and fixes its origin exactly as it would
			 * without this plugin.
			 * ------------------------------------------------------------------ */

			/** One replayed pointer event carrying a reflected clientX. */
			function mirroredEvent(type, event, clientX) {
				var clone = new window.PointerEvent(type, {
					bubbles: true,
					cancelable: true,
					composed: true,
					pointerId: event.pointerId,
					pointerType: event.pointerType,
					isPrimary: event.isPrimary,
					clientX: clientX,
					clientY: event.clientY,
					button: event.button,
					buttons: event.buttons,
					ctrlKey: event.ctrlKey,
					shiftKey: event.shiftKey,
					altKey: event.altKey,
					metaKey: event.metaKey,
				})
				clone.__dshSidebarSwapSynthetic = true
				return clone
			}

			/**
			 * The frame's own drag handle under one event's target, when that is what
			 * was grabbed. The frame is resolved from the handle itself - a div whose
			 * direct children include the shipped rightbar column - so a stale cached
			 * frame never disables the mirroring.
			 * @returns the handle element, or null.
			 */
			function grabbedHandle(event) {
				var node = event.target
				if (node === null || typeof node.closest !== 'function') return null
				node = node.closest('[data-side]')
				if (node === null) return null
				var frame = node.parentElement
				if (frame === null || frame.querySelector(':scope > [data-rightbar-col]') === null) return null
				return node
			}

			/** Replay one swallowed event on the handle, with the pointer reflected around the drag's origin. */
			function replayDrag(event, type) {
				var active = drag
				if (active === null) return
				var target = active.element
				if (target.isConnected !== true) {
					target = refs.frame === null || active.side === null
						? null
						: refs.frame.querySelector(':scope > [data-side=' + JSON.stringify(active.side) + ']')
				}
				if (target === null) return
				target.dispatchEvent(mirroredEvent(type, event, 2 * active.origin - event.clientX))
			}

			function onWindowPointerDown(event) {
				if (!enabled || event.__dshSidebarSwapSynthetic === true || event.button !== 0) return
				if (typeof event.pointerId !== 'number') return
				var handle = grabbedHandle(event)
				if (handle === null) return
				if (probeTimer !== null) {
					window.clearTimeout(probeTimer)
					probeTimer = null
				}
				var frame = handle.parentElement
				drag = {
					id: event.pointerId,
					origin: event.clientX,
					side: handle.getAttribute('data-side'),
					element: handle,
					frame: frame,
					template: frame.style.gridTemplateColumns,
					boundary: document.documentElement.style.getPropertyValue(SIDEBAR_LEFT_VAR),
					deaf: false,
					probing: false,
				}
			}

			/**
			 * One-shot safety net: if the shell ignores the replayed events (no column
			 * geometry moved after a deliberate drag), stop swallowing the real ones so
			 * the divider still drags - with the shell's own direction - instead of
			 * freezing, and say so once in the console.
			 */
			function proveShellReacts(active) {
				probeTimer = window.setTimeout(function () {
					probeTimer = null
					if (drag !== active || active.deaf === true) return
					var template = active.frame.isConnected === true ? active.frame.style.gridTemplateColumns : null
					var boundary = document.documentElement.style.getPropertyValue(SIDEBAR_LEFT_VAR)
					if (template !== active.template || boundary !== active.boundary) return
					active.deaf = true
					console.warn(NS + ': the shell ignored the mirrored drag events; using its own drag direction for this gesture')
				}, 160)
			}

			function onWindowPointerMove(event) {
				if (drag === null || event.__dshSidebarSwapSynthetic === true) return
				if (event.pointerId !== drag.id) return
				if (drag.deaf === true) return
				event.stopPropagation()
				event.stopImmediatePropagation()
				var active = drag
				replayDrag(event, 'pointermove')
				if (active.probing === false && Math.abs(event.clientX - active.origin) >= 8) {
					active.probing = true
					proveShellReacts(active)
				}
			}

			function onWindowPointerUp(event) {
				if (drag === null || event.__dshSidebarSwapSynthetic === true) return
				if (event.pointerId !== drag.id) return
				if (drag.deaf === true) {
					drag = null
					return
				}
				event.stopPropagation()
				event.stopImmediatePropagation()
				replayDrag(event, 'pointerup')
				drag = null
			}

			/** A cancelled pointer ends the gesture without a width write. */
			function onWindowPointerCancel(event) {
				if (drag === null || event.pointerId !== drag.id) return
				drag = null
			}

			function addDragListeners() {
				window.addEventListener('pointerdown', onWindowPointerDown, true)
				window.addEventListener('pointermove', onWindowPointerMove, true)
				window.addEventListener('pointerup', onWindowPointerUp, true)
				window.addEventListener('pointercancel', onWindowPointerCancel, true)
			}

			function removeDragListeners() {
				window.removeEventListener('pointerdown', onWindowPointerDown, true)
				window.removeEventListener('pointermove', onWindowPointerMove, true)
				window.removeEventListener('pointerup', onWindowPointerUp, true)
				window.removeEventListener('pointercancel', onWindowPointerCancel, true)
			}

			/** Drop the measured handle geometry, returning the handles to the shell's own positions. */
			function clearGeometry() {
				var root = document.documentElement
				root.removeAttribute(GEOMETRY_ATTR)
				root.style.removeProperty(SIDEBAR_LEFT_VAR)
				root.style.removeProperty(RIGHTBAR_LEFT_VAR)
			}

			/**
			 * Measure where each swapped boundary is and publish it for the handle rules.
			 * The sidebar handle belongs on the sidebar column's leading edge and the right
			 * handle on the panel's trailing edge - the boundary the cursor is meant to
			 * follow once the columns have traded sides.
			 */
			function syncGeometry() {
				var frame = refs.frame
				if (frame === null || frame.isConnected !== true) {
					clearGeometry()
					return
				}
				var frameRect = frame.getBoundingClientRect()
				if (frameRect.width <= 0) {
					clearGeometry()
					return
				}
				var panel = refs.rightbar.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]')
				if (panel === null || panel.offsetParent === null) {
					var panels = refs.rightbar.querySelectorAll('[data-sidebar-right-panel]')
					panel = null
					for (var index = 0; index < panels.length; index += 1) {
						if (panels[index].offsetParent !== null) {
							panel = panels[index]
							break
						}
					}
				}
				var leadingEdge = refs.sidebar.getBoundingClientRect().left
				var trailingEdge = panel === null ? refs.rightbar.getBoundingClientRect().right : panel.getBoundingClientRect().right
				var root = document.documentElement
				root.style.setProperty(SIDEBAR_LEFT_VAR, Math.round(leadingEdge - frameRect.left) + 'px')
				root.style.setProperty(RIGHTBAR_LEFT_VAR, Math.round(trailingEdge - frameRect.left) + 'px')
				root.setAttribute(GEOMETRY_ATTR, '')
			}

			/** One throttled pass: mark the columns, observe them, measure the boundaries. */
			function sync() {
				if (!enabled) return
				if (!discover()) {
					clearGeometry()
					return
				}
				observeNodes()
				syncGeometry()
			}

			/** Coalesce every trigger into one pass per frame. */
			function schedule() {
				if (rafId !== null) return
				rafId = window.requestAnimationFrame(function () {
					rafId = null
					sync()
				})
			}

			/** Re-sync now and again while the shell's column transition settles. */
			function scheduleSettled() {
				schedule()
				timers.push(window.setTimeout(schedule, 60))
				timers.push(window.setTimeout(schedule, 320))
				timers.push(window.setTimeout(schedule, 700))
			}

			/** Turn the shell override on or off for this page. */
			function applyPreference() {
				if (enabled) {
					document.documentElement.setAttribute(ROOT_ATTR, '')
					scheduleSettled()
					return
				}
				document.documentElement.removeAttribute(ROOT_ATTR)
				clearGeometry()
				drag = null
			}

			/** Store the user's choice and apply it to the live shell. */
			function setSwapEnabled(value) {
				var next = value === true
				writeStored(next)
				if (next === enabled) {
					publish()
					return
				}
				enabled = next
				applyPreference()
				publish()
			}

			/** Install the stylesheet, read the stored preference and start watching the shell. */
			function startShell() {
				installStyles()
				enabled = readStored()
				applyPreference()
				documentObserver = new MutationObserver(onDocumentMutations)
				documentObserver.observe(document.documentElement, { childList: true, subtree: true })
				window.addEventListener('resize', schedule)
				addDragListeners()
			}

			/** Remove every mark, style, observer and listener this plugin installed. */
			function teardownShell() {
				for (var index = 0; index < timers.length; index += 1) window.clearTimeout(timers[index])
				timers = []
				if (rafId !== null) {
					window.cancelAnimationFrame(rafId)
					rafId = null
				}
				if (documentObserver !== null) {
					documentObserver.disconnect()
					documentObserver = null
				}
				if (resizeObserver !== null) {
					resizeObserver.disconnect()
					resizeObserver = null
				}
				observed = []
				window.removeEventListener('resize', schedule)
				removeDragListeners()
				drag = null
				if (probeTimer !== null) {
					window.clearTimeout(probeTimer)
					probeTimer = null
				}
				clearGeometry()
				clearTags()
				document.documentElement.removeAttribute(ROOT_ATTR)
				removeStyles()
				refs = { frame: null, sidebar: null, center: null, rightbar: null }
			}

			/* ------------------------------------------------------------------ *
			 * The General settings row.
			 * ------------------------------------------------------------------ */
			/**
			 * The preference row: title, description and one switch.
			 * @param props - composed slot props; the framework's `t` when the locale seat is injected.
			 * @returns the row element tree.
			 */
			function SidebarSwapRow(props) {
				var translate = typeof props.t === 'function' ? props.t : t
				var pair = React.useState(enabled)
				var value = pair[0]
				var setValue = pair[1]
				React.useEffect(function () {
					setValue(enabled)
					return subscribe(function () {
						setValue(enabled)
					})
				}, [])
				return h('div', { className: 'dshss_row' },
					h('div', { className: 'dshss_rowText' },
						h('div', { className: 'dshss_title' }, translate('title')),
						h('div', { className: 'dshss_desc' }, translate('description'))),
					h('div', { className: 'dshss_control' },
						h('button', {
							type: 'button',
							role: 'switch',
							'aria-checked': value ? 'true' : 'false',
							'aria-label': translate('switchLabel'),
							className: 'dshss_switch',
							onClick: function () {
								setSwapEnabled(!value)
							},
						},
							h('span', {
								className: 'dshss_track',
								'data-on': value ? 'true' : 'false',
								'aria-hidden': 'true',
							}, h('span', { className: 'dshss_thumb' })),
							h('span', { className: 'dshss_state' }, value ? translate('on') : translate('off')))))
			}

			/**
			 * Client plugin body: own the shell override and contribute the Settings row
			 * that writes it.
			 * @param ctx - client cordis context.
			 */
			function apply(ctx) {
				var slots = ctx.slots
				boundT = ctx.locale.bind(NS)
				ctx.effect(function () {
					return ctx.locale.register(NS, { zh: zh, en: en })
				}, NS + ': copy')
				startShell()
				ctx.effect(function () {
					return function () {
						teardownShell()
					}
				}, NS + ': shell overrides')
				ctx.effect(function () {
					return slots.inject('settings.general.item', function () {
						return slots.register({
							name: 'settings.general.item',
							id: 'sidebar-swap',
							order: 13,
							label: function () {
								return t('title')
							},
							locale: NS,
						}, SidebarSwapRow)
					})
				}, NS + ': settings row')
			}
			return apply
		})()

		/**
		 * 工作区行「...」菜单里的「在资源管理器中打开」。
		 *
		 * 那个菜单是 ui-workspace 里硬编码的两项（重命名 / 删除工作区），没有可注册的
		 * slot，所以这一行只能补到菜单 DOM 上：克隆同一菜单里的一个菜单项（连主题类名
		 * 与悬停样式一起拿到），换掉文案与图标，插在带 danger 类的那一项（删除工作区）
		 * 之前。
		 *
		 * 工作区目录从 React fiber 上读：菜单项的 fiber 往上，最近的 ProjectRowItem 的
		 * `group` 上带着 `cwd`（绝对路径）。如果最近的是会话行（`node.id`），说明这是
		 * 会话菜单，直接跳过 —— 这一项只出现在工作区菜单里。
		 *
		 * 打开动作不经过本插件的宿主半边：官方 Session Remote 的
		 * `openWorkspacePath({ path, action: 'reveal' })` 会先校验路径，再在桌面的文件
		 * 管理器里定位它（Windows 资源管理器 / macOS 访达 / Linux 的 xdg-open）。
		 */
		const installWorkspaceReveal = (() => {
			/** 本特性插入的每一处 DOM 都挂这个标记，卸载时按它清理。 */
			var MARK = 'data-dsh-gui-tweaks-reveal'
			/** 菜单项的形状（ui-primitives 的 Menu 渲染出的行）。 */
			var MENU_ITEM = 'button[role="menuitem"]'
			/** 兜底文案的命名空间，也是 locale 注册用的 key。 */
			var NS = 'dsh-gui-tweaks/reveal'
			var SVG_NS = 'http://www.w3.org/2000/svg'

			var zh = {
				menu: '在资源管理器中打开',
				failed: '打不开这个目录：宿主上没有可用的桌面，或这个路径已经不可用了。',
			}
			var en = {
				menu: 'Open in file manager',
				failed: 'Could not open this directory: no desktop on the host, or the path is unavailable.',
			}

			/** 还没消失的提示条，卸载时一并清掉。 */
			var toasts = []

			/**
			 * 外链箭头图标：尺寸与颜色都跟着菜单项的图标槽走（currentColor）。
			 * @returns svg 元素。
			 */
			function createIcon() {
				var svg = document.createElementNS(SVG_NS, 'svg')
				svg.setAttribute('viewBox', '0 0 16 16')
				svg.setAttribute('width', '14')
				svg.setAttribute('height', '14')
				svg.setAttribute('fill', 'none')
				svg.setAttribute('stroke', 'currentColor')
				svg.setAttribute('stroke-width', '1.2')
				svg.setAttribute('stroke-linecap', 'round')
				svg.setAttribute('stroke-linejoin', 'round')
				svg.setAttribute('aria-hidden', 'true')
				var box = document.createElementNS(SVG_NS, 'path')
				box.setAttribute('d', 'M6.4 3.4H3.6v9h9V9.6')
				var arrow = document.createElementNS(SVG_NS, 'path')
				arrow.setAttribute('d', 'M9.6 3.4h3v3M12.6 3.4 7.8 8.2')
				svg.appendChild(box)
				svg.appendChild(arrow)
				return svg
			}

			/**
			 * DOM 节点上的 React fiber 键（React 17/18 是 __reactFiber$，更早的是
			 * __reactInternalInstance$）。
			 * @param element - 任意元素。
			 * @returns 键名，或 null。
			 */
			function fiberKeyOf(element) {
				var keys = Object.keys(element)
				for (var index = 0; index < keys.length; index++) {
					var key = keys[index]
					if (key.indexOf('__reactFiber$') === 0 || key.indexOf('__reactInternalInstance$') === 0) return key
				}
				return null
			}

			/**
			 * 沿着 fiber 往上找最近的行 props：工作区行给绝对路径，会话行给 undefined。
			 *
			 * 只认最近的第一个：ProjectRowItem 的 `group.cwd` 是工作区目录，而
			 * SessionNodeItem 的 `node.id` 说明这是会话菜单 —— 会话行在工作区分组之下，
			 * 继续往上走也会撞见工作区的 `group`，所以不能无脑找 cwd。
			 * @param button - 菜单项按钮。
			 * @returns 工作区目录的绝对路径，或 undefined（不是工作区菜单）。
			 */
			function workspacePathOf(button) {
				var key = fiberKeyOf(button)
				if (key === null) return undefined
				var fiber = button[key]
				var depth = 0
				while (fiber !== null && fiber !== undefined && depth < 80) {
					var props = fiber.memoizedProps
					if (props !== null && typeof props === 'object') {
						var group = props.group
						if (group !== null && typeof group === 'object'
							&& typeof group.cwd === 'string' && group.cwd !== '') return group.cwd
						var node = props.node
						if (node !== null && typeof node === 'object' && typeof node.id === 'string') return undefined
					}
					fiber = fiber.return
					depth += 1
				}
				return undefined
			}

			/** 关掉当前菜单：Menu 的 Escape 处理器挂在 document 的捕获阶段。 */
			function closeMenu() {
				try {
					var target = document.activeElement instanceof Element ? document.activeElement : document.body
					target.dispatchEvent(new KeyboardEvent('keydown', {
						key: 'Escape',
						bubbles: true,
						cancelable: true,
					}))
				} catch (error) {
					/* 关不掉也不要紧：菜单的 closeOnPointerLeave 会在指针离开时关它 */
				}
			}

			/**
			 * 弹一条一次性提示（几秒后自己消失）。
			 * @param message - 提示文案。
			 */
			function notify(message) {
				var host = document.createElement('div')
				host.setAttribute(MARK, 'toast')
				host.style.cssText = 'position:fixed;z-index:2000;left:50%;bottom:32px;'
					+ 'transform:translateX(-50%);max-width:360px;padding:8px 12px;border-radius:8px;'
					+ 'font:inherit;font-size:12px;line-height:18px;background:var(--dsw-alias-bg-layer-1);'
					+ 'color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);'
					+ 'box-shadow:var(--dsw-elevation-prominent);'
				host.textContent = message
				document.body.appendChild(host)
				toasts.push(host)
				setTimeout(function () {
					var at = toasts.indexOf(host)
					if (at !== -1) toasts.splice(at, 1)
					host.remove()
				}, 4000)
			}

			/**
			 * 让宿主在桌面文件管理器里定位这个目录。
			 * @param ctx - 条目上下文（读 Session Remote）。
			 * @param path - 工作区目录的绝对路径。
			 * @param t - 文案。
			 */
			function reveal(ctx, path, t) {
				var session = ctx.remote === undefined || ctx.remote === null ? undefined : ctx.remote.session
				if (session === undefined || typeof session.openWorkspacePath !== 'function') {
					notify(t('failed'))
					return
				}
				Promise.resolve(session.openWorkspacePath({ path: path, action: 'reveal' }))
					.then(function (result) {
						if (result !== null && typeof result === 'object' && result.ok === false) notify(t('failed'))
					})
					.catch(function (error) {
						console.warn(NS + ': could not reveal ' + path, error)
						notify(t('failed'))
					})
			}

			/**
			 * 给一个菜单项所在的菜单补上我们那一行；已经补过、或不是工作区菜单就不动。
			 * @param button - 菜单里任意一个菜单项按钮。
			 * @param ctx - 条目上下文。
			 * @param t - 文案。
			 */
			function decorateMenu(button, ctx, t) {
				var wrap = button.parentElement
				var container = wrap === null ? null : wrap.parentElement
				if (container === null) return
				if (container.querySelector('[' + MARK + ']') !== null) return
				var path = workspacePathOf(button)
				if (path === undefined) return

				var clone = wrap.cloneNode(true)
				var separator = clone.querySelector('[role="separator"]')
				if (separator !== null) separator.remove()
				var item = clone.querySelector(MENU_ITEM)
				if (item === null) return

				var icon = item.querySelector('[class*="_itemIcon"]')
				if (icon !== null) {
					while (icon.firstChild !== null) icon.removeChild(icon.firstChild)
					icon.appendChild(createIcon())
				}
				var label = item.querySelector('[class*="_itemLabel"]')
				if (label !== null) label.textContent = t('menu')
				item.removeAttribute('aria-keyshortcuts')
				item.setAttribute(MARK, '')
				// 捕获阶段拦下这一击：React 的委托监听挂在 portal 容器上（document.body），
				// 冒泡阶段才轮到它，所以这里先停住，菜单项自己的 onSelect 不会收到。
				item.addEventListener('click', function (event) {
					event.preventDefault()
					event.stopPropagation()
					closeMenu()
					reveal(ctx, path, t)
				}, true)

				// 插在危险项（删除工作区，带 *_danger 类）之前：破坏性操作留在最后。
				var anchor = null
				for (var index = 0; index < container.children.length; index++) {
					var child = container.children[index]
					var childItem = typeof child.querySelector === 'function' ? child.querySelector(MENU_ITEM) : null
					if (childItem !== null && String(childItem.className).indexOf('_danger') !== -1) {
						anchor = child
						break
					}
				}
				container.insertBefore(clone, anchor)
			}

			/**
			 * 装上：观察新出现的菜单，给工作区菜单补一行。
			 * @param ctx - 条目上下文。
			 */
			function apply(ctx) {
				var bound = null
				try {
					bound = ctx.locale.bind(NS)
				} catch (error) {
					bound = null
				}
				var t = bound === null ? function (key) { return key } : function (key) { return bound(key) }
				ctx.effect(() => ctx.locale.register(NS, { zh, en }), NS + ': copy')

				var scheduled = false
				/** 扫一遍文档里现存的菜单项（只有打开的菜单还在 DOM 里）。 */
				var scan = function () {
					scheduled = false
					var buttons = document.querySelectorAll(MENU_ITEM)
					for (var index = 0; index < buttons.length; index++) decorateMenu(buttons[index], ctx, t)
				}
				var schedule = function () {
					if (scheduled) return
					scheduled = true
					Promise.resolve().then(scan)
				}

				// 只在新增节点里出现菜单项时才扫：侧栏与消息流会持续产生 DOM 变动，
				// 每次变动都全文档查一遍太贵。
				var observer = new MutationObserver(function (records) {
					for (var index = 0; index < records.length; index++) {
						var added = records[index].addedNodes
						for (var nodeIndex = 0; nodeIndex < added.length; nodeIndex++) {
							var node = added[nodeIndex]
							if (node.nodeType !== 1) continue
							if (node.matches(MENU_ITEM) || node.querySelector(MENU_ITEM) !== null) {
								schedule()
								return
							}
						}
					}
				})

				ctx.effect(function () {
					observer.observe(document.body, { childList: true, subtree: true })
					schedule()
					return function () {
						observer.disconnect()
						var injected = document.querySelectorAll('[' + MARK + ']')
						for (var index = 0; index < injected.length; index++) injected[index].remove()
						toasts.length = 0
					}
				}, NS + ': teardown')
			}

			// 测试钩子：tools/smoke.mjs 用假 fiber 链验证「由最近的行 props 决定」这条规则
			// （工作区菜单给路径、会话菜单给 undefined）—— 这是本特性唯一靠推理得来的判断。
			apply.__test = { workspacePathOf: workspacePathOf }
			return apply
		})()

		/**
		 * 包页面上的配置表单（plugins.bundle.config，key = 包名）—— 由 build-client 拼进
		 * 客户端条目，和合并前 file-filter 的配置区是同一个座位。
		 *
		 * 四个开关 + 一张排除表。开关点一下就写（一条 op），排除表按「保存」写（也是一条
		 * op，与合并前的表单一致）。写入都走设置服务的配置表单：
		 *
		 *   { op: 'set', path: ['bookmarks'], value }      单个功能开关
		 *   { op: 'set', path: ['exclude'], value: [...] } 排除表
		 *
		 * 宿主侧三个布尔字段没有标 volatile，所以写下去会让 Loader 重挂这一行；客户端这边
		 * 由 client.shell.js 的 watchConfig 订阅同一条 store，立刻挂/卸对应功能，不用刷新。
		 */

		/**
		 * 设置命名空间候选：settings 命名空间就是本行的 Loader 条目 id，而「顶层 patch
		 * 行」与「组合包行」在文档里措辞不同，所以按顺序探测，取第一个 Host 正在服务的。
		 */
		const NAMESPACE_CANDIDATES = [ROW_ID, PACKAGE, `include:${ROW_ID}`]

		/** schema 默认值，与宿主侧 Config 保持一致，用于表单占位。 */
		const DEFAULT_EXCLUDE = ['*.meta']

		/** 表单文案（自用件，直接写中文）。 */
		const TEXT = {
			togglesLabel: '功能开关',
			togglesHint: '拨动立即生效：宿主侧会重挂这一行，浏览器侧就地挂载 / 卸载；关掉的功能不会留下任何界面。',
			fieldLabel: '要隐藏的文件 / 目录（gitignore 风格）',
			fieldHint: '相对会话工作区根。无斜杠 = 任意层级（.meta、*.tmp、Library/）；有斜杠 = 从根锚定（/Assets/Temp/）；以 / 结尾只匹配目录；! 开头是例外。留空 = 不隐藏任何东西。',
			placeholder: '.meta\n/Assets/Temp/\n**/obj/',
			save: '保存',
			saving: '保存中…',
			saved: '已保存',
			failed: '保存失败',
			loading: '正在读取当前配置…',
			unavailable: '当前部署不提供该配置的读写。',
			readOnly: '当前文档只读，无法保存。',
			empty: '当前：不隐藏任何东西',
			rules: (positive, negated) => (negated === 0
				? `当前：${positive} 条规则`
				: `当前：${positive} 条规则 + ${negated} 条例外`),
		}

		const S = {
			root: {
				display: 'flex', flexDirection: 'column', gap: 12,
				maxWidth: 560, fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5,
				color: 'var(--dsw-alias-label-primary)',
			},
			groupLabel: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
			toggles: { display: 'flex', flexDirection: 'column', gap: 8 },
			toggle: { display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' },
			checkbox: { flex: 'none', marginTop: 2, width: 14, height: 14 },
			toggleText: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
			toggleLabel: { fontSize: 13, color: 'var(--dsw-alias-label-primary)' },
			toggleHint: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
			label: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
			input: {
				width: '100%', boxSizing: 'border-box', minHeight: 32, padding: '6px 8px',
				borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1)',
				background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
				font: 'inherit', fontSize: 12, resize: 'vertical',
			},
			/** 保存按钮与规则统计各占一行：再长的文本也挤不掉按钮。 */
			actions: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 },
			note: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', flex: '1 1 auto' },
			button: {
				flex: 'none', height: 28, padding: '0 12px', borderRadius: 6,
				border: '1px solid var(--dsw-alias-border-l2)',
				background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
				font: 'inherit', fontSize: 12, cursor: 'pointer',
			},
			buttonOff: { opacity: 0.5, cursor: 'default' },
			ok: { fontSize: 12, color: 'var(--dsw-alias-state-success-primary)' },
			bad: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' },
		}

		/** 一个开关的当前值：读不到按「开」，与宿主侧 featureOn 同一套语义。 */
		function switchOn(value) {
			return typeof value === 'boolean' ? value : true
		}

		/** 取一行配置里的排除表（缺省时用 schema 的默认值）。 */
		function rulesOf(value) {
			const listing = value !== null && typeof value === 'object' && Array.isArray(value.exclude)
				? value.exclude
				: DEFAULT_EXCLUDE
			return listing.filter((item) => typeof item === 'string')
		}

		/** 逐行归一化：去空白、丢掉空行与 `#` 注释（gitignore 的写法）。 */
		function normalizeLines(text) {
			return String(text)
				.split(/\r?\n/u)
				.map((line) => line.trim())
				.filter((line) => line !== '' && !line.startsWith('#'))
		}

		/** 排除表读成表格里的文本（一行一条）。 */
		function formatRules(list) {
			return list.join('\n')
		}

		/** 两个排除表是否表示同一份配置（逐项比较，忽略空行与注释）。 */
		function sameRules(list, text) {
			const parsed = normalizeLines(text)
			return parsed.length === list.length && parsed.every((item, index) => item === list[index])
		}

		/** 预览用：正例条数与例外（`!`）条数。 */
		function countRules(text) {
			const lines = normalizeLines(text)
			const negated = lines.filter((line) => line.startsWith('!')).length
			return { positive: lines.length - negated, negated }
		}

		/** 一个空的外部 store：没有任何可用表单时的兜底，快照恒为 undefined。 */
		const NO_STORE = { subscribe: () => () => {}, getSnapshot: () => undefined }

		/**
		 * 用设置镜像探测本行的命名空间（镜像没到位时返回 undefined，下一次再试）。
		 * @param configForms - 设置服务（页面注入的 ctx.configForms）。
		 * @returns 命名空间，或 undefined。
		 */
		function resolveNamespace(configForms) {
			let namespaces
			try {
				namespaces = configForms?.describe?.().getSnapshot?.().view?.namespaces
			} catch {
				/* 镜像读不到就当作还没到位 */
			}
			if (!Array.isArray(namespaces)) return undefined
			const names = namespaces.map((entry) => entry?.ns).filter((ns) => typeof ns === 'string')
			for (const candidate of NAMESPACE_CANDIDATES) {
				if (names.includes(candidate)) return candidate
			}
			return names.find((ns) => ns.includes(ROW_ID))
		}

		/**
		 * 取本行的配置表单 store。
		 * @param ctx - 条目上下文。
		 * @returns store（subscribe / getSnapshot / mutate），或 undefined。
		 */
		function resolveConfigForm(ctx) {
			const namespace = resolveNamespace(ctx.configForms)
			if (namespace === undefined) return undefined
			const form = ctx.configForms?.get?.(namespace)
			return form === undefined || form === null ? undefined : form
		}

		/**
		 * 配置表单：四个开关 + 一张排除表 + 一行结果提示。
		 *
		 * 开关点一下写一条 op；排除表按「保存」才写。表单不可用时只显示一句说明。
		 */
		function GuiTweaksForm(props) {
			const form = props?.form
			// 外层 store 每次渲染都跟着当前的 form，换命名空间后订阅也跟着换。
			const store = React.useMemo(() => (typeof form?.subscribe === 'function' && typeof form?.getSnapshot === 'function'
				? { subscribe: form.subscribe.bind(form), getSnapshot: () => form.getSnapshot() }
				: NO_STORE), [form])
			const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

			const current = state?.value
			const currentText = formatRules(rulesOf(current))
			const [draft, setDraft] = React.useState(currentText)
			const [outcome, setOutcome] = React.useState(null)
			const [busy, setBusy] = React.useState(null)
			// Host 值变化（首次载入、保存被接受、别处改动）后，把草稿重新对到 Host 值上。
			React.useEffect(() => { setDraft(currentText) }, [currentText])

			const ready = state?.status === 'ready'
			const writable = state?.writable === true
			const dirty = !sameRules(rulesOf(current), draft)
			const canSave = ready && writable && dirty && busy === null

			/** 写一条配置 op：开关与排除表共用。 */
			const write = (ops, key) => {
				if (!ready || !writable || busy !== null || typeof form?.mutate !== 'function') return
				setBusy(key)
				setOutcome(null)
				Promise.resolve(form.mutate(ops, state?.revision))
					.then((accepted) => { setOutcome(accepted === false ? 'failed' : 'saved') })
					.catch(() => { setOutcome('failed') })
					.finally(() => { setBusy(null) })
			}

			if (state === undefined || state?.status === 'loading') {
				return React.createElement('p', { style: S.note }, TEXT.loading)
			}
			if (state?.status === 'unavailable') {
				return React.createElement('p', { style: S.note }, TEXT.unavailable)
			}

			const counted = countRules(draft)
			return React.createElement('div', { style: S.root, 'data-dsh-gui-tweaks-form': true },
				React.createElement('p', { style: S.groupLabel }, TEXT.togglesLabel),
				React.createElement('div', { style: S.toggles },
					FEATURES.map((feature) => React.createElement('label', {
						key: feature.key,
						style: { ...S.toggle, cursor: writable ? 'pointer' : 'default' },
					},
					React.createElement('input', {
						type: 'checkbox',
						style: S.checkbox,
						checked: switchOn(current?.[feature.key]),
						disabled: !writable || busy !== null,
						onChange: (event) => write(
							[{ op: 'set', path: [feature.key], value: event.target.checked }],
							feature.key,
						),
					}),
					React.createElement('span', { style: S.toggleText },
						React.createElement('span', { style: S.toggleLabel }, feature.label),
						React.createElement('span', { style: S.toggleHint }, feature.hint),
					),
					)),
				),
				React.createElement('p', { style: S.note }, TEXT.togglesHint),
				React.createElement('label', { style: S.label, htmlFor: 'dsh-gui-tweaks-exclude' }, TEXT.fieldLabel),
				React.createElement('textarea', {
					id: 'dsh-gui-tweaks-exclude',
					style: S.input,
					rows: 5,
					spellCheck: false,
					value: draft,
					placeholder: TEXT.placeholder,
					disabled: busy === 'exclude',
					onChange: (event) => { setOutcome(null); setDraft(event.target.value) },
					onKeyDown: (event) => {
						if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
							event.preventDefault()
							if (canSave) write([{ op: 'set', path: ['exclude'], value: normalizeLines(draft) }], 'exclude')
						}
					},
				}),
				React.createElement('p', { style: S.note }, TEXT.fieldHint),
				// 保存按钮单独一行：预览文本再长也不会把它挤出可视区。
				React.createElement('div', { style: S.actions },
					React.createElement('button', {
						type: 'button',
						style: canSave ? S.button : { ...S.button, ...S.buttonOff },
						disabled: !canSave,
						onClick: () => write([{ op: 'set', path: ['exclude'], value: normalizeLines(draft) }], 'exclude'),
					}, busy === 'exclude' ? TEXT.saving : TEXT.save),
					React.createElement('span', { style: S.note }, counted.positive === 0 && counted.negated === 0
						? TEXT.empty
						: TEXT.rules(counted.positive, counted.negated)),
				),
				writable ? null : React.createElement('p', { style: S.note }, TEXT.readOnly),
				outcome === 'saved' ? React.createElement('p', { style: S.ok }, TEXT.saved) : null,
				outcome === 'failed' ? React.createElement('p', { style: S.bad }, TEXT.failed) : null,
			)
		}

		/** 在包页面上注册配置区：渲染在描述与「包含的组件」列表之间。 */
		function installConfigForm(ctx) {
			const render = () => React.createElement(GuiTweaksForm, { form: resolveConfigForm(ctx) })
			ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
				name: 'plugins.bundle.config',
				key: PACKAGE,
			}, render))
		}

		/**
		 * 客户端功能表：key 与宿主 Config 的字段同名，配置表单和挂载器共用这一张表。
		 * apply 为 null 的是纯宿主功能（fileFilter 的界面就是配置表单本身）。
		 */
		const FEATURES = [
			{
				key: 'fileFilter',
				label: '文件过滤',
				hint: '@ 补全与右侧栏「文件」树按上面的排除表过滤；界面就是这张表单，没有独立的浏览器半边。',
				inject: null,
				apply: null,
			},
			{
				key: 'bookmarks',
				label: '书签页',
				hint: '右侧栏新增「书签」标签页，列表存在 DSH 主目录的 browser-bookmarks.json。',
				inject: ['slots', 'timer', 'locale'],
				apply: installBookmarks,
			},
			{
				key: 'sessionDelete',
				label: '会话删除按钮',
				hint: '会话行与「设置 → 已归档会话」行上各加一个删除按钮。',
				inject: ['sessions'],
				apply: installSessionDelete,
			},
			{
				key: 'sidebarSwap',
				label: '左右栏互换',
				hint: '在「设置 → 通用」加一行开关，把左右两栏整体对调；开关状态记在本机浏览器里。',
				inject: ['slots', 'locale'],
				apply: installSidebarSwap,
			},
			{
				key: 'workspaceReveal',
				label: '在文件管理器里打开工作区',
				hint: '工作区行的「...」菜单里加一项，让宿主在系统文件管理器里定位该工作区目录。',
				inject: ['locale', 'remote', 'remote.session'],
				apply: installWorkspaceReveal,
			},
		]

		/** 已挂载的浏览器功能：key -> 子 fiber。 */
		const mounted = new Map()

		/** 开关取值：缺省或不是布尔（配置未解析）时按「开」。 */
		function featureOn(value) {
			return typeof value === 'boolean' ? value : true
		}

		/**
		 * 装载一个浏览器功能。挂成子 fiber，才能在不重载页面的情况下单独卸掉它。
		 * @param ctx - 条目上下文。
		 * @param feature - FEATURES 里的一项。
		 */
		function mountFeature(ctx, feature) {
			mounted.set(feature.key, ctx.plugin({
				name: PACKAGE + '/' + feature.key,
				inject: feature.inject,
				apply: feature.apply,
			}))
		}

		/**
		 * 卸掉一个浏览器功能：fiber.dispose() 回收它注册的一切。
		 * @param key - 功能 key。
		 */
		function unmountFeature(key) {
			const fiber = mounted.get(key)
			if (fiber === undefined) return
			mounted.delete(key)
			try {
				fiber.dispose()
			} catch (error) {
				console.error(PACKAGE + ': could not unmount ' + key, error)
			}
		}

		/**
		 * 让已挂载的功能与配置对齐。
		 * @param ctx - 条目上下文。
		 * @param value - 本行配置快照；undefined = 镜像不可用，全部放行。
		 */
		function syncFeatures(ctx, value) {
			for (const feature of FEATURES) {
				if (feature.apply === null) continue
				const want = value === undefined ? true : featureOn(value[feature.key])
				const has = mounted.has(feature.key)
				if (want && !has) mountFeature(ctx, feature)
				else if (!want && has) unmountFeature(feature.key)
			}
		}

		/** 等设置镜像到位的节奏（最多 10 秒，之后按默认全部装载）。 */
		const CONFIG_POLL_MS = 250
		const CONFIG_POLL_TRIES = 40

		/**
		 * 订阅本行配置：镜像一到就对齐功能，之后每次改动（包括在包页面上拨开关）再对齐。
		 * @param ctx - 条目上下文。
		 */
		function watchConfig(ctx) {
			let tries = 0
			const attempt = () => {
				let form
				try {
					form = resolveConfigForm(ctx)
				} catch {
					form = undefined
				}
				const snapshot = form?.getSnapshot?.()
				if (snapshot?.status === 'ready') {
					syncFeatures(ctx, snapshot.value)
					ctx.effect(() => form.subscribe(() => {
						const next = form.getSnapshot?.()
						if (next?.status === 'ready') syncFeatures(ctx, next.value)
					}), PACKAGE + ': config watch')
					return
				}
				if (tries++ < CONFIG_POLL_TRIES) {
					setTimeout(attempt, CONFIG_POLL_MS)
					return
				}
				// 部署不提供配置表单（或它一直没就绪）：按默认全部装载，和合并前一样。
				syncFeatures(ctx, undefined)
			}
			attempt()
		}

		/** 条目入口：配置表单常驻，三个浏览器功能按开关挂载。 */
		function apply(ctx) {
			installConfigForm(ctx)
			watchConfig(ctx)
		}

		exports.apply = apply
		// slots / configForms 是座位与配置表单；其余是四个浏览器功能各自声明的依赖。
		exports.inject = ['slots', 'configForms', 'timer', 'locale', 'sessions', 'remote', 'remote.session']
		return module.exports
	},
})
