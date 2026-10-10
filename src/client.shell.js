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

/*__FEATURES__*/

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
		// slots / configForms 是座位与配置表单；其余是三个浏览器功能各自声明的依赖。
		exports.inject = ['slots', 'configForms', 'timer', 'locale', 'sessions']
		return module.exports
	},
})
