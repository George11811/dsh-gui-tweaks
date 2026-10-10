/**
 * Host half of the Browser Bookmarks bundle.
 *
 * One JSON file in the DSH home holds the list, and three exact routes under
 * /api/browser-bookmarks read and change it:
 *
 *   POST /list   {}              -> { items }
 *   POST /add    { url, title? } -> { items, item } | { error: <code> }
 *   POST /remove { id }          -> { items }       | { error: 'missing' }
 *
 * The file sits beside the other DSH state files (refs-shelf.state.json,
 * settings.yaml, ...), so the backup/sync bundle carries bookmarks to the other
 * computer with everything else. Deleting it resets the list.
 *
 * Address policy mirrors the shipped right-Sidebar Browser: HTTP(S) only, a
 * bare host becomes HTTPS, credentials are refused, and the address must parse.
 * The one rule this half cannot apply is the "not the DSH application itself"
 * check, which needs the page origin and therefore lives in the client half.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const BASE = '/api/browser-bookmarks'
const STATE_PATH = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'browser-bookmarks.json')
const STATE_VERSION = 1
const MAX_URL = 2048
const MAX_TITLE = 120
const MAX_ITEMS = 500
/** A leading scheme, as the URL parser sees one; anything else is offered https://. */
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/** One stored bookmark: a stable id, the normalized address, and its display name. */
const isEntry = (value) => value !== null && typeof value === 'object'
	&& typeof value.id === 'string' && value.id !== ''
	&& typeof value.url === 'string' && value.url !== ''
	&& typeof value.title === 'string'

/**
 * Read the stored list, dropping anything that does not match the entry shape.
 * An absent, unreadable or malformed file starts from an empty list rather than
 * failing plugin activation.
 * @returns the stored items in their saved order.
 */
const readState = () => {
	try {
		const parsed = JSON.parse(readFileSync(STATE_PATH, 'utf8'))
		if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.items)) {
			return parsed.items.filter(isEntry).map((item) => ({
				id: item.id,
				url: item.url,
				title: item.title,
			}))
		}
	} catch {
		/* absent or unreadable: start from an empty list */
	}
	return []
}

/**
 * Write the list through a temporary file and a rename, so a crash mid-write
 * leaves the previous list intact.
 * @param items - the complete list to persist.
 */
const saveState = (items) => {
	mkdirSync(dirname(STATE_PATH), { recursive: true })
	const tmp = STATE_PATH + '.tmp'
	writeFileSync(tmp, JSON.stringify({ version: STATE_VERSION, items }, null, '\t'), 'utf8')
	renameSync(tmp, STATE_PATH)
}

/**
 * Normalize one address under the Browser's policy.
 * @param input - the raw address the user typed or pasted.
 * @returns `{ url }` with the normalized absolute address, or `{ error }` with a code the client localizes.
 */
const normalizeUrl = (input) => {
	const text = typeof input === 'string' ? input.trim() : ''
	if (text === '') return { error: 'empty' }
	if (text.length > MAX_URL) return { error: 'too-long' }
	let parsed
	try {
		parsed = new URL(HAS_SCHEME.test(text) ? text : 'https://' + text)
	} catch {
		return { error: 'invalid' }
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { error: 'protocol' }
	if (parsed.username !== '' || parsed.password !== '') return { error: 'credentials' }
	if (parsed.hostname === '') return { error: 'invalid' }
	return { url: parsed.href }
}

/**
 * Fall back to the host name (plus path) when the user gave no display name.
 * @param url - an already normalized address.
 * @returns the derived display name, bounded to the title limit.
 */
const deriveTitle = (url) => {
	try {
		const parsed = new URL(url)
		const path = parsed.pathname === '/' ? '' : parsed.pathname
		return (parsed.hostname + path).slice(0, MAX_TITLE)
	} catch {
		return url.slice(0, MAX_TITLE)
	}
}

/** Read one JSON request body; `{}` for an empty body and `null` for malformed JSON. */
const readJson = async (req) => {
	const chunks = []
	for await (const chunk of req) chunks.push(chunk)
	const raw = Buffer.concat(chunks).toString('utf8')
	if (raw.trim() === '') return {}
	try {
		return JSON.parse(raw)
	} catch {
		return null
	}
}

/** Answer with JSON and no caching, since every route here is a live read of the file. */
const sendJson = (res, status, payload) => {
	res.statusCode = status
	res.setHeader('content-type', 'application/json; charset=utf-8')
	res.setHeader('cache-control', 'no-store')
	res.end(JSON.stringify(payload))
}

// ---------------------------------------------------------------- plugin body
export function installBookmarks(ctx) {
	let items = readState()

	const persist = () => {
		try {
			saveState(items)
		} catch (error) {
			console.error('browser-bookmarks: could not persist the list: '
				+ String(error && error.message ? error.message : error))
		}
	}

	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: BASE + '/list',
		handler: async (req, res) => {
			try {
				await readJson(req)
				sendJson(res, 200, { items })
			} catch (error) {
				sendJson(res, 500, { error: 'host' })
			}
		},
	}))

	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: BASE + '/add',
		handler: async (req, res) => {
			try {
				const args = await readJson(req)
				if (args === null) return sendJson(res, 400, { error: 'invalid-body' })
				const normalized = normalizeUrl(args.url)
				if (normalized.error !== undefined) return sendJson(res, 400, { error: normalized.error })
				const existing = items.find((item) => item.url === normalized.url)
				if (existing !== undefined) return sendJson(res, 400, { error: 'duplicate' })
				if (items.length >= MAX_ITEMS) return sendJson(res, 400, { error: 'full' })
				const given = typeof args.title === 'string' ? args.title.trim().slice(0, MAX_TITLE) : ''
				const item = {
					id: randomUUID(),
					url: normalized.url,
					title: given === '' ? deriveTitle(normalized.url) : given,
				}
				items = items.concat([item])
				persist()
				sendJson(res, 200, { items, item })
			} catch (error) {
				console.error('browser-bookmarks: add failed: ' + String(error && error.message ? error.message : error))
				sendJson(res, 500, { error: 'host' })
			}
		},
	}))

	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: BASE + '/remove',
		handler: async (req, res) => {
			try {
				const args = await readJson(req)
				if (args === null) return sendJson(res, 400, { error: 'invalid-body' })
				const id = typeof args.id === 'string' ? args.id : ''
				const next = items.filter((item) => item.id !== id)
				if (next.length === items.length) return sendJson(res, 400, { error: 'missing' })
				items = next
				persist()
				sendJson(res, 200, { items })
			} catch (error) {
				console.error('browser-bookmarks: remove failed: ' + String(error && error.message ? error.message : error))
				sendJson(res, 500, { error: 'host' })
			}
		},
	}))
}
