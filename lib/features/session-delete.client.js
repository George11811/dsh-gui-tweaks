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
