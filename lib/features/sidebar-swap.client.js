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
