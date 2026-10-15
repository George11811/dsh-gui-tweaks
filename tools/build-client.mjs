/**
 * Assemble lib/client.js from the client shell plus the feature sources.
 *
 * The shell carries one FEATURES marker line (a line comment); each feature source
 * is a self-contained block written at its final nesting (one tab inside the client
 * factory body). Nothing is transformed here: change a feature source, run this
 * script, commit the artifact.
 *
 * Usage: node tools/build-client.mjs [--check]
 *   --check  compare the built bundle with the one on disk instead of writing it
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHELL = join(ROOT, 'src', 'client.shell.js')
const TARGET = join(ROOT, 'lib', 'client.js')
const MARKER = '/*__FEATURES__*/'
/** Concatenation order; each entry is a file under lib/features/. */
const PARTS = [
	'bookmarks.client.js',
	'session-delete.client.js',
	'sidebar-swap.client.js',
	'workspace-reveal.client.js',
	'config-form.client.js',
]

const shell = readFileSync(SHELL, 'utf8')
if (shell.split(MARKER).length !== 2) {
	throw new Error(`build-client: ${SHELL} must contain exactly one ${MARKER} line`)
}

const parts = PARTS.map((name) => {
	const text = readFileSync(join(ROOT, 'lib', 'features', name), 'utf8')
	if (text.trim() === '') throw new Error(`build-client: lib/features/${name} is empty`)
	return text.replace(/\s+$/u, '')
})

// A replacer FUNCTION, not a replacement string: the sources contain `$'`-like
// sequences (e.g. `'__reactFiber$'`), which a string replacement would expand
// as `$'` / `$&` patterns and silently eat the surrounding code.
const built = shell.replace(MARKER, () => parts.join('\n\n'))

// Syntax gate: compiling the bundle catches a broken splice without running it.
try {
	// eslint-disable-next-line no-new-func -- compile-only syntax check
	new Function(built)
} catch (error) {
	throw new Error(`build-client: the assembled bundle does not parse: ${error.message}`)
}

const check = process.argv.includes('--check')
if (check) {
	const onDisk = readFileSync(TARGET, 'utf8')
	if (onDisk !== built) {
		console.error('build-client: lib/client.js is stale — run `node tools/build-client.mjs`')
		process.exit(1)
	}
	console.log('build-client: lib/client.js is up to date')
} else {
	writeFileSync(TARGET, built, 'utf8')
	const lines = built.split('\n').length
	console.log(`build-client: wrote lib/client.js (${lines} lines, ${PARTS.length} feature sources)`)
}
