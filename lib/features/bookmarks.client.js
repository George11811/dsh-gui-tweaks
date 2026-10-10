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
