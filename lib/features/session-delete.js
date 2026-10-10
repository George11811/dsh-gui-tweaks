/**
 * Host half of the session-delete plugin: one route that deletes a stored
 * conversation.
 *
 *   POST /api/session-admin/delete { sessionId } -> { ok, removed: string[] }
 *
 * Deleting a Session removes its durable log directory under
 * <DSH_HOME>/sessions/<project>/<sessionId>, drops its projection-cache row,
 * and removes it from the registry-global archive set. The Session catalog is
 * rebuilt from persistence on every list call, so the next Client refresh
 * stops reporting the Session.
 *
 * Guards: a Session whose Agent is currently running is refused, so the route
 * can never pull the log out from under an in-flight turn.
 */
import { existsSync, readdirSync, rmSync, unlinkSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { homedir } from 'node:os'

const BASE = '/api/session-admin'
const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const SESSION_ID = /^session-[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/

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

const sendJson = (res, status, payload) => {
	res.statusCode = status
	res.setHeader('content-type', 'application/json; charset=utf-8')
	res.setHeader('cache-control', 'no-store')
	res.end(JSON.stringify(payload))
}

/** Every project directory under the Session storage root, when it exists. */
const projectDirs = (root) => {
	try {
		return readdirSync(root, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => join(root, entry.name))
	} catch {
		return []
	}
}

/** Remove one Session's durable artifacts. Returns the paths that were removed. */
const removeSessionStorage = (sessionId) => {
	const removed = []
	for (const project of projectDirs(join(HOME, 'sessions'))) {
		const dir = join(project, sessionId)
		if (!existsSync(dir)) continue
		rmSync(dir, { recursive: true, force: true })
		removed.push(dir)
	}
	const cachePath = join(HOME, 'storages', 'session_projcache', 'sessions', sessionId + '.json')
	if (existsSync(cachePath)) {
		unlinkSync(cachePath)
		removed.push(cachePath)
	}
	return removed
}

/** Whether a live Agent is running for this Session. */
const isRunning = (ctx, sessionId) => {
	const agents = ctx.get('agents')
	if (agents === undefined || typeof agents.get !== 'function') return false
	const agent = agents.get(sessionId)
	return agent !== undefined && agent !== null && agent.status === 'running'
}

/** Drop the Session from the durable archive set; no-op when it is not archived. */
const forgetArchive = async (ctx, sessionId) => {
	const controller = ctx.get('workspaceController')
	if (controller !== undefined && typeof controller.unarchiveSession === 'function') {
		await controller.unarchiveSession({ sessionId })
		return
	}
	const registry = ctx.get('workspaceRegistry')
	if (registry !== undefined && typeof registry.unarchiveSession === 'function') {
		await registry.unarchiveSession(sessionId)
	}
}

export function installSessionDelete(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: BASE + '/delete',
		handler: async (req, res) => {
			try {
				const args = await readJson(req)
				if (args === null) return sendJson(res, 400, { error: 'bad-request', message: 'invalid JSON body' })
				const sessionId = String(args.sessionId || '')
				if (!SESSION_ID.test(sessionId)) {
					return sendJson(res, 400, { error: 'bad-request', message: 'invalid session id' })
				}
				if (isRunning(ctx, sessionId)) {
					return sendJson(res, 409, { error: 'session-running', message: 'the session is running' })
				}
				const removed = removeSessionStorage(sessionId)
				if (removed.length === 0) {
					return sendJson(res, 404, { error: 'not-found', message: 'no stored log for this session' })
				}
				try {
					await forgetArchive(ctx, sessionId)
				} catch {
					/* the archive set is a projection; a failure here must not undo the delete */
				}
				sendJson(res, 200, { ok: true, removed: removed.map((path) => normalize(path)) })
			} catch (error) {
				sendJson(res, 500, { error: 'internal', message: error && error.message ? String(error.message) : String(error) })
			}
		},
	}))
}

