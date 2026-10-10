/**
 * 按 gitignore 风格的排除表过滤文件候选：@ 补全 + 右侧栏「文件」窗口。
 *
 * Unity 工程里每个资源都带一个同名 .meta 文件，@ 候选里近一半是它们，右侧栏的
 * 文件树里也是每个资源一行多余的噪音。DSH 自己没有任何文件级过滤
 * （dsh-file-reference-local 只有目录级排除表，dsh-api-workspace-files 直接转发
 * ctx.fs.listDir），所以这里就地包装两个 list()：
 *
 *   ctx.fileReferences.list(agent, query, signal) -> FileReferenceCandidate[]
 *     @ 补全的唯一数据源（dsh-file-reference-local 提供）；候选的 path 本身就是
 *     工作区相对路径。
 *
 *   ctx.workspaceFiles.list(scope, path, signal) -> WorkspaceDirectoryListing
 *     右侧栏官方「文件」窗口的唯一数据源（dsh-api-workspace-files 提供，只被
 *     dsh-client-ui-sidebar-files 的文件树使用；agent 的文件工具走 ctx.fs / glob，
 *     不受影响）。scope 与 path 把每个条目名拼回工作区相对路径，所以锚定根的目录
 *     规则同样有效；没有例外规则时，命中的目录会连子树一起剪掉。
 *
 * 包装只替换实例上的一个方法，disposer 里恢复原方法，所以停用或更新这个插件不会
 * 留下副作用。排除表由合并包 Config 的 `exclude` 暴露（默认 ['*.meta']，gitignore
 * 语义，见 ignore-rules.js）；它同时喂给下面三层包装，改配置经
 * `loader/volatile-update` 立即生效，不用重启。
 */
import { createExcluder } from '../ignore-rules.js'

/**
 * 默认排除：Unity 资源元数据。
 *
 * 必须写成 `*.meta`：排除表是 gitignore 语义，无斜杠的模式匹配的是**名字**，所以
 * `.meta` 只会命中一个恰好叫 `.meta` 的文件，`a.meta` 不在此列 —— 合并前的默认值
 * 就是这个空转的 `.meta`（真正生效的是 profile patch 里那份 `*.meta`）。合并包按
 * 文档意图把它修成后缀写法。
 *
 * 注：fileReferences / workspaceFiles 不进合并包的 inject —— 它们各自是可选面
 * （缺了仍该正常挂载，只是少过滤一处），所以由 installFileFilter 里的
 * ctx.inject(...) 分别等待。
 */
export const DEFAULT_EXCLUDE = ['*.meta']

/** 该值是否是 DSH 的 volatile 引用（读取需要 .get()）。 */
function isVolatile(value) {
	return value !== null && typeof value === 'object' && typeof value.get === 'function'
}

/**
 * 读一个配置字段的当前值：volatile 引用取值，普通值原样返回。
 * @param value - 解析后的配置值。
 * @returns 可用的普通值。
 */
function readConfigValue(value) {
	return isVolatile(value) ? value.get() : value
}

/**
 * 汇总配置里的排除表。
 * @param patterns - `exclude` 字段（可能是 volatile 引用）。
 * @returns 排除表数组。
 */
function resolveExclude(patterns) {
	const read = readConfigValue(patterns)
	return Array.isArray(read) ? read : DEFAULT_EXCLUDE
}

/**
 * 包装实例上的一个方法；同一个实例不会被包装两次。
 *
 * 标记挂在包装函数自己身上（不是实例上），所以在别的插件之后包装、或本插件的
 * 回调重跑时，都不会把包装层层套起来。
 * @param target - 承载方法的服务实例。
 * @param key - 方法名（`list`）。
 * @param make - 用原方法换回包装方法的工厂。
 * @returns 恢复原方法的 disposer，或 undefined（目标上没有这个方法）。
 */
function wrapMethod(target, key, make) {
	const original = target[key]
	if (typeof original !== 'function') return undefined
	if (original[MARKED] === true) return undefined
	const wrapped = make(original)
	wrapped[MARKED] = true
	target[key] = wrapped
	return () => {
		if (target[key] === wrapped) target[key] = original
	}
}

/** 包装函数的标记：识别「已经被包装过」的方法。 */
const MARKED = Symbol('dsh-file-filter.wrapped')

/** 唯一一条要在 HTTP 层补过滤的已注册路由（dsh-better-sidebar 的文件树）。 */
const SIDEBAR_API_PREFIX = '/sidebar/api'
const SIDEBAR_TREE_PATH = `${SIDEBAR_API_PREFIX}/fs.tree`
const MAX_JSON_HANDOFF = 4 * 1024 * 1024

/**
 * 拦截 dsh-better-sidebar 的 `fs.tree` 路由。
 *
 * 该插件接管了右侧栏 files 页时，它的文件树走自己的 /sidebar/api/fs.tree 路由，
 * 不经过 ctx.workspaceFiles。它的路由处理器是 `(req, res) => void`，直接写裸 res，
 * 所以这里给它换一个 res：拦住 res.end，把 JSON 载荷里命中的行剔掉再交回真实 res。
 * 那条路由只带条目名、不带路径，所以只应用不依赖路径的规则。
 *
 * 路由是别人的，所以只动这一个路径；判定用前缀 + 去掉查询串的路径，比字符串前缀
 * 更严，不会误伤同前缀的邻居方法。
 * @param res - 路由拿到的响应对象。
 * @param excluder - 活引用（配置改了会换），判定时读它的当前值。
 * @returns 包装后的响应对象（不可包装时返回原对象）。
 */
function filteredResponse(res, excluder) {
	if (res === null || typeof res !== 'object' || typeof res.end !== 'function') return res
	if (res[FILTERED] === true) return res
	const originalEnd = res.end
	let handedOff = false

	// 载荷先收在真实 res 以外：拿到最后一截才决定丢弃，中途一步都不发给客户端。
	const proxy = Object.create(res)
	proxy.end = function end(chunk, encoding, callback) {
		let encodingArg = encoding
		let callbackArg = callback
		if (typeof encodingArg === 'function') {
			callbackArg = encodingArg
			encodingArg = undefined
		}
		const finish = () => {
			if (typeof callbackArg === 'function') callbackArg()
			return this
		}
		if (handedOff) return finish()
		const text = typeof chunk === 'string'
			? chunk
			: chunk === undefined || chunk === null
				? ''
				: Buffer.isBuffer(chunk)
					? chunk.toString('utf8')
					: String(chunk)
		const parsed = parseTreePayload(text, excluder)
		handedOff = true
		if (parsed === undefined) {
			originalEnd.call(res, chunk, encodingArg, callbackArg)
		} else {
			res.setHeader('content-length', Buffer.byteLength(parsed, 'utf8'))
			originalEnd.call(res, parsed, 'utf8', callbackArg)
		}
		return this
	}
	Object.defineProperty(proxy, FILTERED, { value: true })
	return proxy
}

/** 包装过的响应对象标记：同一响应不重复包装。 */
const FILTERED = Symbol('dsh-file-filter.response')

/**
 * 按排除表剔掉一段「OK 信封」JSON 里的目录行。
 * @param text - 路由写出的响应正文。
 * @param excluder - 活引用（配置改了会换）。
 * @returns 改写后的正文，或在无法安全改写时返回 undefined（照原样透传）。
 */
function parseTreePayload(text, excluder) {
	if (text === '' || text.length > MAX_JSON_HANDOFF) return undefined
	try {
		const envelope = JSON.parse(text)
		if (envelope === null || typeof envelope !== 'object') return undefined
		const body = envelope.ok === true ? envelope.value : undefined
		if (body === null || typeof body !== 'object' || !Array.isArray(body.entries)) return undefined
		const current = excluder.current
		const kept = body.entries.filter((entry) => {
			if (entry === null || typeof entry !== 'object') return true
			return !current.excludedName(entry.name) && !current.excluded(String(entry.name))
		})
		if (kept.length === body.entries.length) return undefined
		body.entries = kept
		return JSON.stringify(envelope)
	} catch {
		return undefined
	}
}

/**
 * 装上一个包装器：把注册在 `path` 上的路由处理器的响应过滤一遍。
 *
 * webServer 没有中间件座位（路由注册表要求 (kind, path) 唯一，重复注册直接抛），
 * 所以唯一不碰别人代码的插入点就是 register 本身：先看这次注册是不是目标路由，
 * 是就把 handler 换成一个「同一处理器 + 过滤 res」的等价物。
 * @param ctx - 插件上下文，已注入 webServer。
 * @param excluder - 活引用（配置改了会换）。
 * @returns 恢复 register 的 disposer。
 */
function wrapWebServer(ctx, excluder) {
	const server = ctx.webServer
	// 极端情况下（服务未挂载 / 已被别的实现替换）宁可不装，也不让本插件激活失败。
	if (server === null || typeof server !== 'object') return undefined
	const originalRegister = server.register
	if (typeof originalRegister !== 'function' || originalRegister[MARKED] === true) return undefined

	const wrappedRegister = function register(route) {
		if (route !== null && typeof route === 'object' && typeof route.handler === 'function') {
			const kind = typeof route.kind === 'string' ? route.kind.replace(/\/+$/, '') : ''
			const path = typeof route.path === 'string' ? route.path.replace(/\/+$/, '') : ''
			if (kind === 'prefix' && path === SIDEBAR_API_PREFIX) {
				const handler = route.handler
				return originalRegister.call(this, {
					...route,
					handler: (req, res) => {
						const url = typeof req.url === 'string' ? req.url : ''
						const cut = url.search(/[?#]/)
						const pathname = cut === -1 ? url : url.slice(0, cut)
						return handler(req, pathname === SIDEBAR_TREE_PATH ? filteredResponse(res, excluder) : res)
					},
				})
			}
		}
		return originalRegister.call(this, route)
	}
	wrappedRegister[MARKED] = true
	server.register = wrappedRegister

	return () => {
		if (server.register === wrappedRegister) server.register = originalRegister
	}
}

/**
 * 插件入口：包住 @ 补全与右侧栏文件树的两个 list()，并挂上路由兜底。
 * @param ctx - 插件上下文。
 * @param config - Loader 校验后的行配置（缺省时按 schema 默认值）。
 */
export function installFileFilter(ctx, config) {
	// 判定器跟着 volatile 配置走：包装只建一次，值改了只换 current，
	// 所以插件管理器里保存排除表不会重挂这一行，也不需要重启。
	const excluder = { current: createExcluder(resolveExclude(config?.exclude)) }
	ctx.on('loader/volatile-update', () => {
		excluder.current = createExcluder(resolveExclude(config?.exclude))
	})

	// webServer 是本插件的硬依赖，wrapWebServer 直接读 ctx.webServer，不必等；
	// 也正因为它在 apply 的 ctx 上而不是 inject 出来的子 ctx 上，才拿得到服务。
	const restoreServer = wrapWebServer(ctx, excluder)

	// 依赖出现/消失时 cordis 会重跑这段，上一次的 disposer 先跑，再建新的，
	// 所以「服务晚挂载 → 包装晚一点生效」不需要单独的重试逻辑。
	ctx.inject(['fileReferences', 'workspaceFiles'], (serviceCtx) => {
		const restore = []

		const fileReferences = serviceCtx.get('fileReferences')
		const restoreReferences = fileReferences === undefined
			? undefined
			: wrapMethod(fileReferences, 'list', (original) => async function list(agent, query, signal) {
				const candidates = await original.call(this, agent, query, signal)
				if (!Array.isArray(candidates)) return candidates
				const current = excluder.current
				// 候选的 path 已是工作区相对路径。
				return candidates.filter((candidate) => !current.excluded(candidate?.path ?? ''))
			})
		if (restoreReferences !== undefined) restore.push(restoreReferences)

		const workspaceFiles = serviceCtx.get('workspaceFiles')
		const restoreWorkspace = workspaceFiles === undefined
			? undefined
			: wrapMethod(workspaceFiles, 'list', (original) => async function list(scope, path, signal) {
				const listing = await original.call(this, scope, path, signal)
				if (listing === null || typeof listing !== 'object' || !Array.isArray(listing.entries)) return listing
				const current = excluder.current
				const base = typeof path === 'string' ? path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : ''
				const entries = listing.entries.filter((entry) => {
					if (entry === null || typeof entry !== 'object') return true
					// scope/path 是工作区相对路径，拼上条目名就得到判定规则所需的相对路径。
					const relative = base === '' ? String(entry.name) : `${base}/${entry.name}`
					return !current.excluded(relative)
				})
				if (entries.length === listing.entries.length) return listing
				return { ...listing, entries }
			})
		if (restoreWorkspace !== undefined) restore.push(restoreWorkspace)

		return () => {
			for (const undo of restore.reverse()) undo()
		}
	})

	// 只在真的换过 register 时才登记 effect：effect 的回调必须交出一个 disposer，
	// 交 undefined 会被 cordis 判成无效 effect 而抛错。
	if (restoreServer !== undefined) {
		ctx.effect(() => restoreServer, 'dsh-file-filter: restore webServer.register')
	}
}
