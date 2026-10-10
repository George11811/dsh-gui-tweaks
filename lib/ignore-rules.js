/**
 * gitignore 风格排除规则的解析与匹配（自洽、无正则）。
 *
 * 语义摘要（规则相对会话工作区根）：
 *   *.meta            无斜杠 = 任意层级的段模式
 *   /Assets/Temp/     前导斜杠 = 锚定根；尾斜杠 = 目录，命中该目录及其子树
 *   Assets/S*         含斜杠 = 锚定根；* 不跨 /，** 跨整段
 *   !keep.txt         例外，后面的规则覆盖前面的
 */

/** 归一化路径：反斜杠转正斜杠、去掉首尾斜杠。 */
export function normalizePath(value) {
	return String(value).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * 单个段的手写 glob（`*` 任意字符序列、`?` 一个字符）。
 *
 * 三条快路径先走，只有真正复杂的段才落到逐字符回溯：文件树一层可以有上千条，
 * 规则十几条，这一层的常数在滚动/刷新时直接变成手感。
 * @param pattern - 模式段（不含 `/`）。
 * @param text - 待匹配的路径段。
 * @returns 是否整段匹配。
 */
function matchSegment(pattern, text) {
	if (pattern === text) return true
	// 纯字面量段：上面那句相等判断就是全部答案，不再进回溯
	if (!pattern.includes('*') && !pattern.includes('?')) return false
	// `*.ext`：只比后缀
	if (pattern.startsWith('*') && !pattern.includes('?') && !pattern.slice(1).includes('*')) {
		const tail = pattern.slice(1)
		return text.length >= tail.length && text.endsWith(tail)
	}
	// 其余（`a*b*c`、含 `?`）：逐字符回溯，带记忆化，最坏 O(模式×文本)。
	const memo = new Map()
	const walk = (patternIndex, textIndex) => {
		const key = `${patternIndex}:${textIndex}`
		const cached = memo.get(key)
		if (cached !== undefined) return cached
		let verdict
		if (patternIndex === pattern.length) {
			verdict = textIndex === text.length
		} else if (pattern[patternIndex] === '*') {
			verdict = walk(patternIndex + 1, textIndex)
			for (let cursor = textIndex; !verdict && cursor < text.length; cursor += 1) {
				verdict = walk(patternIndex + 1, cursor + 1)
			}
		} else if (textIndex < text.length && (pattern[patternIndex] === '?' || pattern[patternIndex] === text[textIndex])) {
			verdict = walk(patternIndex + 1, textIndex + 1)
		} else {
			verdict = false
		}
		memo.set(key, verdict)
		return verdict
	}
	return walk(0, 0)
}

/**
 * 模式从 (pi, ti) 起是否匹配路径剩余的段。
 *
 * `**` 吃掉 ti 之后的任意多段（含 0 段）；每个 `**` 的 skip 上界由"剩余模式至少还
 * 要多少段"收紧，所以深度 = `**` 个数、每个 `**` 只扫一遍剩余路径。
 * @param segments - 模式段（`{ anyDepth: true }` 表示 `**`）。
 * @param pi - 模式起始下标。
 * @param parts - 路径段。
 * @param ti - 路径起始下标。
 * @param end - 只看 parts 的 [0, end)；目录规则的祖先回溯靠它避免切片分配。
 * @returns 是否匹配到窗口末尾。
 */
function matchFrom(segments, pi, parts, ti, end = parts.length) {
	if (pi === segments.length) return ti === end
	const head = segments[pi]
	if (head.anyDepth) {
		if (pi === segments.length - 1) return true
		const minTail = minSegments(segments, pi + 1)
		const maxSkip = end - ti - minTail
		for (let skip = 0; skip <= maxSkip; skip += 1) {
			if (matchFrom(segments, pi + 1, parts, ti + skip, end)) return true
		}
		return false
	}
	if (ti >= end) return false
	if (!matchSegment(head.pattern, parts[ti])) return false
	return matchFrom(segments, pi + 1, parts, ti + 1, end)
}

/**
 * 模式从 start 起至少需要多少段（`**` 记 0）。
 * @param segments - 模式段。
 * @param start - 起始下标。
 * @returns 最少段数。
 */
function minSegments(segments, start) {
	let count = 0
	for (let index = start; index < segments.length; index += 1) {
		if (!segments[index].anyDepth) count += 1
	}
	return count
}

/**
 * 解析排除表。
 * @param patterns - 配置里的字符串数组。
 * @returns 规则列表（书写顺序）。
 */
export function parseExcludeRules(patterns) {
	const rules = []
	for (const raw of Array.isArray(patterns) ? patterns : []) {
		if (typeof raw !== 'string') continue
		const trimmed = raw.trim()
		if (trimmed === '' || trimmed.startsWith('#')) continue
		const negated = trimmed.startsWith('!')
		const body = negated ? trimmed.slice(1).trim() : trimmed
		if (body === '') continue
		const directory = body.endsWith('/')
		const withoutTrailing = directory ? body.slice(0, -1) : body
		const leadingSlash = withoutTrailing.startsWith('/')
		const core = leadingSlash ? withoutTrailing.slice(1) : withoutTrailing
		if (core === '') continue
		const names = core.split('/').filter((name) => name !== '')
		if (names.length === 0) continue
		const anchored = leadingSlash || names.length > 1
		const compile = (name) => (name === '**' ? { anyDepth: true } : { anyDepth: false, pattern: name })
		// 折叠连续的 `**`：`a/**/b` 与 `a/**/**/b` 语义相同，折叠后 `**` 的位置互不相邻，
		// 匹配时的递归分支也随之收敛。
		const collapsed = names.filter((name, index) => name !== '**' || names[index - 1] !== '**')
		// 无斜杠模式 = 任意层：前面补一个 `**`；已折叠则不必再补。
		const segments = (anchored || collapsed[0] === '**' ? collapsed : ['**', ...collapsed]).map(compile)
		const literalName = !anchored && !/[*?[\]]/.test(core)
		// 尾随 `**`（或尾斜杠）都表示"该目录及其子树"：匹配到该目录即可，子树由祖先回溯覆盖。
		const covers = directory || segments[segments.length - 1].anyDepth
		rules.push({
			negated,
			directory: covers,
			literalName,
			anchored,
			segments,
		})
	}
	return rules
}

/**
 * 一条规则是否命中某条路径。
 *
 * 覆盖子树的规则（尾斜杠或尾随 `**`）：路径自身或其任一祖先目录命中即算，所以
 * `Temp/` 命中 `Temp`、`a/Temp`、`Temp/x/y.txt`；锚定的 `/Assets/Temp/` 不会命中
 * 别处的同名目录。其余规则要求命中路径的最后一层。
 * @param rule - 解析后的规则。
 * @param parts - 路径段。
 * @returns 是否命中。
 */
function ruleHits(rule, parts) {
	if (matchFrom(rule.segments, 0, parts, 0)) return true
	if (!rule.directory) return false
	// 祖先回溯：只收紧窗口末端，不做数组切片。
	for (let end = parts.length - 1; end >= 1; end -= 1) {
		if (matchFrom(rule.segments, 0, parts, 0, end)) return true
	}
	return false
}

/** 建一个排除判定器。 */
export function createExcluder(patterns) {
	const rules = parseExcludeRules(patterns)
	return {
		rules,
		hasNegation: rules.some((rule) => rule.negated),
		excluded(relativePath) {
			if (rules.length === 0) return false
			const path = normalizePath(relativePath)
			if (path === '') return false
			const parts = path.split('/')
			let verdict = false
			for (const rule of rules) {
				if (!ruleHits(rule, parts)) continue
				verdict = !rule.negated
			}
			return verdict
		},
		excludedName(name) {
			if (rules.length === 0 || typeof name !== 'string' || name === '') return false
			let verdict = false
			for (const rule of rules) {
				if (!rule.literalName || rule.anchored) continue
				const leaf = rule.segments[rule.segments.length - 1]
				if (leaf === undefined || leaf.anyDepth) continue
				if (matchSegment(leaf.pattern, name)) verdict = !rule.negated
			}
			return verdict
		},
	}
}

/** 排除表的一句中文描述。 */
export function describeExclude(patterns) {
	const rules = parseExcludeRules(patterns)
	if (rules.length === 0) return '不过滤（所有文件都会显示）'
	const positive = rules.filter((rule) => !rule.negated).length
	const negated = rules.length - positive
	return negated === 0
		? `过滤 ${positive} 条规则`
		: `过滤 ${positive} 条规则 + ${negated} 条例外`
}
