/**
 * 合并包的宿主半边：一个组合包装四个 GUI 增强功能。
 *
 *   fileFilter    按 gitignore 规则过滤 @ 补全与右侧栏「文件」树（默认 *.meta）
 *   bookmarks     右侧栏「书签」标签页（列表落盘 DSH 主目录的 browser-bookmarks.json）
 *   sessionDelete 会话行 / 「设置 → 已归档会话」行的删除按钮
 *   sidebarSwap   左右两栏整体对调（没有宿主半边，字段只为了让客户端读到开关）
 *
 * 三个宿主开关**故意不标 volatile**：在插件页拨开关会让 Loader 重挂这一行，宿主侧
 * 的路由与包装器随之增删。`exclude` 仍标 volatile（同合并前的 file-filter）：改规则
 * 只换判定器，不重挂这一行。客户端半边（src/client.shell.js → lib/client.js）用同一份
 * 配置里的布尔字段决定挂不挂浏览器的三个功能。
 */
import z from '@deepseek-ai/schemastery'
import { DEFAULT_EXCLUDE, installFileFilter } from './features/file-filter.js'
import { installBookmarks } from './features/bookmarks.js'
import { installSessionDelete } from './features/session-delete.js'

/** 三个宿主功能都要 HTTP 载体：前两个挂路由，file-filter 还要拦一条路由。 */
export const inject = ['webServer']

export const Config = z.object({
	exclude: z
		.array(z.string())
		.default(DEFAULT_EXCLUDE)
		.description('要隐藏的文件/目录（gitignore 风格，相对会话工作区根）；空表 = 不过滤。')
		.volatile(),
	fileFilter: z
		.boolean()
		.default(true)
		.description('按上面的排除表过滤 @ 补全与右侧栏「文件」树。'),
	bookmarks: z
		.boolean()
		.default(true)
		.description('右侧栏「书签」标签页（列表存在 DSH 主目录的 browser-bookmarks.json）。'),
	sessionDelete: z
		.boolean()
		.default(true)
		.description('会话行与「设置 → 已归档会话」行的删除按钮。'),
	sidebarSwap: z
		.boolean()
		.default(true)
		.description('左右两栏对调（界面在「设置 → 通用」里，开关状态记在本机浏览器）。'),
	workspaceReveal: z
		.boolean()
		.default(true)
		.description('工作区行「...」菜单里的「在文件管理器中打开」：宿主在桌面文件管理器里定位该目录。'),
})

/**
 * 读一个配置字段的当前值：volatile 引用取值，普通值原样返回。
 * @param value - 解析后的配置值。
 * @returns 可用的普通值。
 */
const readValue = (value) => (value !== null && typeof value === 'object' && typeof value.get === 'function'
	? value.get()
	: value)

/**
 * 开关字段的取值：缺省或还不是布尔（配置尚未解析）时按「开」，与合并前默认装载一致。
 * @param value - 配置里的开关字段。
 * @returns 是否装载该功能。
 */
const featureOn = (value) => {
	const read = readValue(value)
	return typeof read === 'boolean' ? read : true
}

/**
 * 插件入口：按开关装载三个宿主功能。
 * @param ctx - 插件上下文，已注入 webServer。
 * @param config - Loader 校验后的行配置。
 */
export function apply(ctx, config) {
	if (featureOn(config?.fileFilter)) installFileFilter(ctx, config)
	if (featureOn(config?.bookmarks)) installBookmarks(ctx)
	if (featureOn(config?.sessionDelete)) installSessionDelete(ctx)
}
