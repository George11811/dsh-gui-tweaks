/**
 * Smoke test for the merged bundle. Plain node, no harness and no browser:
 *
 *   host half   import lib/index.js, call apply() against a stub context and check
 *               that each feature switch adds/removes exactly its own routes,
 *               service wrappers and filtering.
 *   client half execute lib/client.js with a stub window.__ModuleLoader__, call the
 *               captured factory with a stub React, then apply() and check that the
 *               bundle page form is always registered and that the three browser
 *               features mount, unmount and follow the config store.
 *
 * Feature bodies are unchanged from the standalone bundles, so this test targets the
 * merge itself: the switches, the mounting, and the wiring between the halves.
 *
 * Usage: node tools/smoke.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let failures = 0

/**
 * Run one named check.
 * @param label - what is being asserted.
 * @param body - the assertions.
 */
async function check(label, body) {
	try {
		await body()
		console.log(`  ok   ${label}`)
	} catch (error) {
		failures += 1
		console.log(`  FAIL ${label}\n       ${error.message}`)
	}
}

// ------------------------------------------------------------------ host half
/** Build a stub host context and run the merged host half against it. */
async function runHost(config) {
	const routes = []
	const effects = []
	const server = {
		register(route) {
			routes.push(route)
			return () => {}
		},
	}
	const originalRegister = server.register
	const services = {
		fileReferences: { list: async () => [{ path: 'Assets/a.meta' }, { path: 'Assets/a.cs' }] },
		workspaceFiles: { list: async () => ({ entries: [{ name: 'a.meta' }, { name: 'Assets' }] }) },
	}
	const ctx = {
		webServer: server,
		on: () => () => {},
		effect(callback, label) {
			effects.push(label)
			return callback() ?? (() => {})
		},
		inject: (names, callback) => callback({ get: (name) => services[name] }),
		get: () => undefined,
	}
	const { apply } = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
	apply(ctx, config)
	return { routes, server, originalRegister, services, effects }
}

console.log('host half (lib/index.js)')

const hostDefault = await runHost(undefined)
await check('默认配置装载三个宿主功能：四条路由', () => {
	assert.deepEqual(
		hostDefault.routes.map((route) => route.path).sort(),
		[
			'/api/browser-bookmarks/add',
			'/api/browser-bookmarks/list',
			'/api/browser-bookmarks/remove',
			'/api/session-admin/delete',
		],
	)
})
await check('默认配置装上 file-filter 的 webServer.register 包装', () => {
	assert.notEqual(hostDefault.server.register, hostDefault.originalRegister)
	assert.ok(hostDefault.effects.some((label) => String(label).includes('dsh-file-filter')))
})
await check('默认配置过滤 @ 补全候选里的 .meta', async () => {
	assert.deepEqual(
		(await hostDefault.services.fileReferences.list()).map((item) => item.path),
		['Assets/a.cs'],
	)
})
await check('默认配置过滤右侧栏文件树里的 .meta', async () => {
	assert.deepEqual(
		(await hostDefault.services.workspaceFiles.list()).entries.map((entry) => entry.name),
		['Assets'],
	)
})

const hostNoFileFilter = await runHost({ fileFilter: false })
await check('fileFilter=false 时不装包装、不过滤', async () => {
	assert.equal(hostNoFileFilter.server.register, hostNoFileFilter.originalRegister)
	assert.equal((await hostNoFileFilter.services.fileReferences.list()).length, 2)
	assert.equal(hostNoFileFilter.routes.length, 4)
})

const hostBookmarksOff = await runHost({ bookmarks: false })
await check('bookmarks=false 时只剩 session-delete 的路由', () => {
	assert.deepEqual(hostBookmarksOff.routes.map((route) => route.path), ['/api/session-admin/delete'])
})

const hostAllOff = await runHost({ fileFilter: false, bookmarks: false, sessionDelete: false })
await check('三个宿主开关全关时没有任何路由', () => {
	assert.deepEqual(hostAllOff.routes, [])
	assert.equal(hostAllOff.server.register, hostAllOff.originalRegister)
})

// ---------------------------------------------------------------- client half
/** React stand-in: features only touch these at factory time and never render here. */
const ReactStub = {
	createElement: (type, props, ...children) => ({ type, props, children }),
	memo: (component) => component,
	forwardRef: (component) => component,
	createContext: (value) => ({ Provider: 'Provider', Consumer: 'Consumer', value }),
	useState: () => [undefined, () => {}],
	useEffect: () => {},
	useMemo: (factory) => factory(),
	useRef: () => ({ current: null }),
	useCallback: (callback) => callback,
	useSyncExternalStore: () => undefined,
	Fragment: 'Fragment',
}

/** Minimal DOM stand-ins: no feature renders here, but factory- and mount-time code touches these. */
function makeStyle() {
	const values = new Map()
	return {
		setProperty: (name, value) => values.set(name, value),
		removeProperty: (name) => values.delete(name),
		getPropertyValue: (name) => values.get(name) ?? '',
	}
}

function makeElement(tag) {
	return {
		tagName: String(tag ?? 'div').toUpperCase(),
		style: makeStyle(),
		dataset: {},
		attributes: {},
		children: [],
		parentElement: null,
		classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
		setAttribute(name, value) { this.attributes[name] = String(value) },
		getAttribute(name) { return name in this.attributes ? this.attributes[name] : null },
		removeAttribute(name) { delete this.attributes[name] },
		hasAttribute(name) { return name in this.attributes },
		appendChild(child) { this.children.push(child); child.parentElement = this; return child },
		insertBefore(child) { this.children.unshift(child); child.parentElement = this; return child },
		removeChild(child) { this.children = this.children.filter((item) => item !== child); return child },
		remove: () => {},
		contains: () => false,
		matches: () => false,
		closest: () => null,
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => true,
		querySelector: () => null,
		querySelectorAll: () => [],
		getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 400, height: 600, x: 0, y: 0 }),
	}
}

globalThis.document = {
	head: makeElement('head'),
	body: makeElement('body'),
	documentElement: makeElement('html'),
	createElement: (tag) => makeElement(tag),
	createTextNode: (text) => ({ textContent: text }),
	querySelector: () => null,
	querySelectorAll: () => [],
	getElementById: () => null,
	addEventListener: () => {},
	removeEventListener: () => {},
	dispatchEvent: () => true,
}
globalThis.MutationObserver = class {
	observe() {}
	disconnect() {}
}
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
}
globalThis.getComputedStyle = () => makeStyle()
globalThis.requestAnimationFrame = () => 0

const registrations = []
globalThis.window = {
	__ModuleLoader__: { load: (registration) => registrations.push(registration) },
	localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
	addEventListener: () => {},
	removeEventListener: () => {},
	matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
	getComputedStyle: () => makeStyle(),
	requestAnimationFrame: () => 0,
	cancelAnimationFrame: () => {},
	innerWidth: 1440,
	innerHeight: 900,
}

// eslint-disable-next-line no-new-func -- the bundle is a classic script
new Function(readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8'))()
assert.equal(registrations.length, 1, 'client.js must register exactly one module factory')

const client = registrations[0].factory((specifier) => {
	if (specifier === 'react') return ReactStub
	throw new Error(`unexpected require("${specifier}")`)
})

console.log('client half (lib/client.js)')

await check('客户端条目导出 apply 与合并后的 inject 并集', () => {
	assert.equal(registrations[0].id, 'dsh-gui-tweaks')
	assert.equal(typeof client.apply, 'function')
	assert.deepEqual(client.inject, ['slots', 'configForms', 'timer', 'locale', 'sessions'])
})

/** Build a stub client context bound to one live config store. */
function makeClientHarness(initialValue) {
	const value = { ...initialValue }
	const listeners = new Set()
	const mounts = []
	const disposes = []
	const slots = []
	const labels = []
	const form = {
		subscribe(callback) {
			listeners.add(callback)
			return () => listeners.delete(callback)
		},
		getSnapshot: () => ({ status: 'ready', writable: true, revision: 1, value }),
		mutate(ops) {
			for (const op of ops) if (op.op === 'set') value[op.path[0]] = op.value
			for (const callback of [...listeners]) callback()
			return true
		},
	}
	const configForms = {
		describe: () => ({ getSnapshot: () => ({ view: { namespaces: [{ ns: 'gui-tweaks' }] } }) }),
		get: (ns) => (ns === 'gui-tweaks' ? form : undefined),
	}
	const makeCtx = () => ({
		configForms,
		effect: (callback, label) => {
			labels.push(label)
			return callback() ?? (() => {})
		},
		slots: {
			inject: (name, callback) => {
				callback()
				return () => {}
			},
			register: (descriptor) => {
				slots.push(descriptor)
				return () => {}
			},
		},
		locale: { register: () => () => {}, bind: () => (key) => key },
		get: () => undefined,
		on: () => () => {},
		plugin: (plugin) => {
			mounts.push(plugin.name)
			const child = makeCtx()
			plugin.apply(child)
			return { dispose: () => disposes.push(plugin.name) }
		},
	})
	const ctx = makeCtx()
	client.apply(ctx)
	return { value, form, mounts, disposes, slots, labels }
}

const allOn = makeClientHarness({ fileFilter: true, bookmarks: true, sessionDelete: true, sidebarSwap: true })
await check('四个开关都开：包页面配置表单注册在组合包名下', () => {
	assert.ok(allOn.slots.some((slot) => slot.name === 'plugins.bundle.config' && slot.key === 'dsh-gui-tweaks'))
})
await check('四个开关都开：sidebar-swap 挂上了「设置 → 通用」那一行', () => {
	assert.ok(allOn.slots.some((slot) => slot.name === 'settings.general.item' && slot.id === 'sidebar-swap'))
})
await check('四个开关都开：三个浏览器功能各挂一个子 fiber', () => {
	assert.deepEqual(allOn.mounts.sort(), ['dsh-gui-tweaks/bookmarks', 'dsh-gui-tweaks/sessionDelete', 'dsh-gui-tweaks/sidebarSwap'])
	assert.ok(allOn.labels.some((label) => String(label).includes('config watch')))
})

await check('拨掉书签：只卸书签，不动另外两个', () => {
	allOn.form.mutate([{ op: 'set', path: ['bookmarks'], value: false }])
	assert.deepEqual(allOn.disposes, ['dsh-gui-tweaks/bookmarks'])
	assert.equal(allOn.mounts.length, 3)
})

await check('把剩下的也关掉：全部卸掉且不重复挂载', () => {
	allOn.form.mutate([{ op: 'set', path: ['sessionDelete'], value: false }])
	allOn.form.mutate([{ op: 'set', path: ['sidebarSwap'], value: false }])
	assert.deepEqual(allOn.disposes.sort(), ['dsh-gui-tweaks/bookmarks', 'dsh-gui-tweaks/sessionDelete', 'dsh-gui-tweaks/sidebarSwap'])
	assert.equal(allOn.mounts.length, 3)
})

await check('再打开一个：只补挂它自己', () => {
	allOn.form.mutate([{ op: 'set', path: ['bookmarks'], value: true }])
	assert.equal(allOn.mounts.length, 4)
	assert.equal(allOn.mounts[3], 'dsh-gui-tweaks/bookmarks')
})

const allOff = makeClientHarness({ fileFilter: false, bookmarks: false, sessionDelete: false, sidebarSwap: false })
await check('四个开关都关：表单仍在，一个浏览器功能都不挂', () => {
	assert.deepEqual(allOff.mounts, [])
	assert.deepEqual(allOff.slots, [{ name: 'plugins.bundle.config', key: 'dsh-gui-tweaks' }])
})

// ---------------------------------------------------------------------- report
if (failures > 0) {
	console.error(`\nsmoke: ${failures} check(s) failed`)
	process.exit(1)
}
console.log('\nsmoke: all checks passed')
