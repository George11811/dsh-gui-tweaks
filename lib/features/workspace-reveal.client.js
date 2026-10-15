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
