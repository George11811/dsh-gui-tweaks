		/**
		 * 包页面上的配置表单（plugins.bundle.config，key = 包名）—— 由 build-client 拼进
		 * 客户端条目，和合并前 file-filter 的配置区是同一个座位。
		 *
		 * 四个开关 + 一张排除表。开关点一下就写（一条 op），排除表按「保存」写（也是一条
		 * op，与合并前的表单一致）。写入都走设置服务的配置表单：
		 *
		 *   { op: 'set', path: ['bookmarks'], value }      单个功能开关
		 *   { op: 'set', path: ['exclude'], value: [...] } 排除表
		 *
		 * 宿主侧三个布尔字段没有标 volatile，所以写下去会让 Loader 重挂这一行；客户端这边
		 * 由 client.shell.js 的 watchConfig 订阅同一条 store，立刻挂/卸对应功能，不用刷新。
		 */

		/**
		 * 设置命名空间候选：settings 命名空间就是本行的 Loader 条目 id，而「顶层 patch
		 * 行」与「组合包行」在文档里措辞不同，所以按顺序探测，取第一个 Host 正在服务的。
		 */
		const NAMESPACE_CANDIDATES = [ROW_ID, PACKAGE, `include:${ROW_ID}`]

		/** schema 默认值，与宿主侧 Config 保持一致，用于表单占位。 */
		const DEFAULT_EXCLUDE = ['*.meta']

		/** 表单文案（自用件，直接写中文）。 */
		const TEXT = {
			togglesLabel: '功能开关',
			togglesHint: '拨动立即生效：宿主侧会重挂这一行，浏览器侧就地挂载 / 卸载；关掉的功能不会留下任何界面。',
			fieldLabel: '要隐藏的文件 / 目录（gitignore 风格）',
			fieldHint: '相对会话工作区根。无斜杠 = 任意层级（.meta、*.tmp、Library/）；有斜杠 = 从根锚定（/Assets/Temp/）；以 / 结尾只匹配目录；! 开头是例外。留空 = 不隐藏任何东西。',
			placeholder: '.meta\n/Assets/Temp/\n**/obj/',
			save: '保存',
			saving: '保存中…',
			saved: '已保存',
			failed: '保存失败',
			loading: '正在读取当前配置…',
			unavailable: '当前部署不提供该配置的读写。',
			readOnly: '当前文档只读，无法保存。',
			empty: '当前：不隐藏任何东西',
			rules: (positive, negated) => (negated === 0
				? `当前：${positive} 条规则`
				: `当前：${positive} 条规则 + ${negated} 条例外`),
		}

		const S = {
			root: {
				display: 'flex', flexDirection: 'column', gap: 12,
				maxWidth: 560, fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5,
				color: 'var(--dsw-alias-label-primary)',
			},
			groupLabel: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
			toggles: { display: 'flex', flexDirection: 'column', gap: 8 },
			toggle: { display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' },
			checkbox: { flex: 'none', marginTop: 2, width: 14, height: 14 },
			toggleText: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
			toggleLabel: { fontSize: 13, color: 'var(--dsw-alias-label-primary)' },
			toggleHint: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
			label: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
			input: {
				width: '100%', boxSizing: 'border-box', minHeight: 32, padding: '6px 8px',
				borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1)',
				background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
				font: 'inherit', fontSize: 12, resize: 'vertical',
			},
			/** 保存按钮与规则统计各占一行：再长的文本也挤不掉按钮。 */
			actions: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 },
			note: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', flex: '1 1 auto' },
			button: {
				flex: 'none', height: 28, padding: '0 12px', borderRadius: 6,
				border: '1px solid var(--dsw-alias-border-l2)',
				background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
				font: 'inherit', fontSize: 12, cursor: 'pointer',
			},
			buttonOff: { opacity: 0.5, cursor: 'default' },
			ok: { fontSize: 12, color: 'var(--dsw-alias-state-success-primary)' },
			bad: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' },
		}

		/** 一个开关的当前值：读不到按「开」，与宿主侧 featureOn 同一套语义。 */
		function switchOn(value) {
			return typeof value === 'boolean' ? value : true
		}

		/** 取一行配置里的排除表（缺省时用 schema 的默认值）。 */
		function rulesOf(value) {
			const listing = value !== null && typeof value === 'object' && Array.isArray(value.exclude)
				? value.exclude
				: DEFAULT_EXCLUDE
			return listing.filter((item) => typeof item === 'string')
		}

		/** 逐行归一化：去空白、丢掉空行与 `#` 注释（gitignore 的写法）。 */
		function normalizeLines(text) {
			return String(text)
				.split(/\r?\n/u)
				.map((line) => line.trim())
				.filter((line) => line !== '' && !line.startsWith('#'))
		}

		/** 排除表读成表格里的文本（一行一条）。 */
		function formatRules(list) {
			return list.join('\n')
		}

		/** 两个排除表是否表示同一份配置（逐项比较，忽略空行与注释）。 */
		function sameRules(list, text) {
			const parsed = normalizeLines(text)
			return parsed.length === list.length && parsed.every((item, index) => item === list[index])
		}

		/** 预览用：正例条数与例外（`!`）条数。 */
		function countRules(text) {
			const lines = normalizeLines(text)
			const negated = lines.filter((line) => line.startsWith('!')).length
			return { positive: lines.length - negated, negated }
		}

		/** 一个空的外部 store：没有任何可用表单时的兜底，快照恒为 undefined。 */
		const NO_STORE = { subscribe: () => () => {}, getSnapshot: () => undefined }

		/**
		 * 用设置镜像探测本行的命名空间（镜像没到位时返回 undefined，下一次再试）。
		 * @param configForms - 设置服务（页面注入的 ctx.configForms）。
		 * @returns 命名空间，或 undefined。
		 */
		function resolveNamespace(configForms) {
			let namespaces
			try {
				namespaces = configForms?.describe?.().getSnapshot?.().view?.namespaces
			} catch {
				/* 镜像读不到就当作还没到位 */
			}
			if (!Array.isArray(namespaces)) return undefined
			const names = namespaces.map((entry) => entry?.ns).filter((ns) => typeof ns === 'string')
			for (const candidate of NAMESPACE_CANDIDATES) {
				if (names.includes(candidate)) return candidate
			}
			return names.find((ns) => ns.includes(ROW_ID))
		}

		/**
		 * 取本行的配置表单 store。
		 * @param ctx - 条目上下文。
		 * @returns store（subscribe / getSnapshot / mutate），或 undefined。
		 */
		function resolveConfigForm(ctx) {
			const namespace = resolveNamespace(ctx.configForms)
			if (namespace === undefined) return undefined
			const form = ctx.configForms?.get?.(namespace)
			return form === undefined || form === null ? undefined : form
		}

		/**
		 * 配置表单：四个开关 + 一张排除表 + 一行结果提示。
		 *
		 * 开关点一下写一条 op；排除表按「保存」才写。表单不可用时只显示一句说明。
		 */
		function GuiTweaksForm(props) {
			const form = props?.form
			// 外层 store 每次渲染都跟着当前的 form，换命名空间后订阅也跟着换。
			const store = React.useMemo(() => (typeof form?.subscribe === 'function' && typeof form?.getSnapshot === 'function'
				? { subscribe: form.subscribe.bind(form), getSnapshot: () => form.getSnapshot() }
				: NO_STORE), [form])
			const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

			const current = state?.value
			const currentText = formatRules(rulesOf(current))
			const [draft, setDraft] = React.useState(currentText)
			const [outcome, setOutcome] = React.useState(null)
			const [busy, setBusy] = React.useState(null)
			// Host 值变化（首次载入、保存被接受、别处改动）后，把草稿重新对到 Host 值上。
			React.useEffect(() => { setDraft(currentText) }, [currentText])

			const ready = state?.status === 'ready'
			const writable = state?.writable === true
			const dirty = !sameRules(rulesOf(current), draft)
			const canSave = ready && writable && dirty && busy === null

			/** 写一条配置 op：开关与排除表共用。 */
			const write = (ops, key) => {
				if (!ready || !writable || busy !== null || typeof form?.mutate !== 'function') return
				setBusy(key)
				setOutcome(null)
				Promise.resolve(form.mutate(ops, state?.revision))
					.then((accepted) => { setOutcome(accepted === false ? 'failed' : 'saved') })
					.catch(() => { setOutcome('failed') })
					.finally(() => { setBusy(null) })
			}

			if (state === undefined || state?.status === 'loading') {
				return React.createElement('p', { style: S.note }, TEXT.loading)
			}
			if (state?.status === 'unavailable') {
				return React.createElement('p', { style: S.note }, TEXT.unavailable)
			}

			const counted = countRules(draft)
			return React.createElement('div', { style: S.root, 'data-dsh-gui-tweaks-form': true },
				React.createElement('p', { style: S.groupLabel }, TEXT.togglesLabel),
				React.createElement('div', { style: S.toggles },
					FEATURES.map((feature) => React.createElement('label', {
						key: feature.key,
						style: { ...S.toggle, cursor: writable ? 'pointer' : 'default' },
					},
					React.createElement('input', {
						type: 'checkbox',
						style: S.checkbox,
						checked: switchOn(current?.[feature.key]),
						disabled: !writable || busy !== null,
						onChange: (event) => write(
							[{ op: 'set', path: [feature.key], value: event.target.checked }],
							feature.key,
						),
					}),
					React.createElement('span', { style: S.toggleText },
						React.createElement('span', { style: S.toggleLabel }, feature.label),
						React.createElement('span', { style: S.toggleHint }, feature.hint),
					),
					)),
				),
				React.createElement('p', { style: S.note }, TEXT.togglesHint),
				React.createElement('label', { style: S.label, htmlFor: 'dsh-gui-tweaks-exclude' }, TEXT.fieldLabel),
				React.createElement('textarea', {
					id: 'dsh-gui-tweaks-exclude',
					style: S.input,
					rows: 5,
					spellCheck: false,
					value: draft,
					placeholder: TEXT.placeholder,
					disabled: busy === 'exclude',
					onChange: (event) => { setOutcome(null); setDraft(event.target.value) },
					onKeyDown: (event) => {
						if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
							event.preventDefault()
							if (canSave) write([{ op: 'set', path: ['exclude'], value: normalizeLines(draft) }], 'exclude')
						}
					},
				}),
				React.createElement('p', { style: S.note }, TEXT.fieldHint),
				// 保存按钮单独一行：预览文本再长也不会把它挤出可视区。
				React.createElement('div', { style: S.actions },
					React.createElement('button', {
						type: 'button',
						style: canSave ? S.button : { ...S.button, ...S.buttonOff },
						disabled: !canSave,
						onClick: () => write([{ op: 'set', path: ['exclude'], value: normalizeLines(draft) }], 'exclude'),
					}, busy === 'exclude' ? TEXT.saving : TEXT.save),
					React.createElement('span', { style: S.note }, counted.positive === 0 && counted.negated === 0
						? TEXT.empty
						: TEXT.rules(counted.positive, counted.negated)),
				),
				writable ? null : React.createElement('p', { style: S.note }, TEXT.readOnly),
				outcome === 'saved' ? React.createElement('p', { style: S.ok }, TEXT.saved) : null,
				outcome === 'failed' ? React.createElement('p', { style: S.bad }, TEXT.failed) : null,
			)
		}

		/** 在包页面上注册配置区：渲染在描述与「包含的组件」列表之间。 */
		function installConfigForm(ctx) {
			const render = () => React.createElement(GuiTweaksForm, { form: resolveConfigForm(ctx) })
			ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
				name: 'plugins.bundle.config',
				key: PACKAGE,
			}, render))
		}
