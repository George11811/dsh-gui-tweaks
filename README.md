# dsh-gui-tweaks

一个组合包，装着四件 Web GUI 增强功能。合并前它们是四个独立包
（`dsh-file-filter` / `dsh-browser-bookmarks` / `dsh-session-delete` /
`dsh-sidebar-swap`），现在共用一行 Loader 条目和一份客户端 bundle。

| 功能 | Config 字段 | 默认 | 宿主半边 | 浏览器半边 |
|---|---|---|---|---|
| 文件过滤：@ 补全 + 右侧栏「文件」树按 gitignore 规则隐藏文件 | `fileFilter` | 开 | 包 `fileReferences.list` / `workspaceFiles.list`，另拦 `/sidebar/api/fs.tree` | 无（界面就是包页面的配置表单） |
| 右侧栏「书签」标签页 | `bookmarks` | 开 | `/api/browser-bookmarks/*` + `browser-bookmarks.json` | 标签页类型 + 会话头按钮 |
| 会话行 / 已归档会话行的删除按钮 | `sessionDelete` | 开 | `/api/session-admin/delete` | CSS-module 后缀 + fiber 定位插按钮 |
| 左右两栏整体对调 | `sidebarSwap` | 开 | 无 | 改 AppFrame 三列网格 + 「设置 → 通用」开关 |
| 排除表（`fileFilter` 用） | `exclude` | `['*.meta']` | 判定器 | 同一张表单 |

## 为什么只有一个开关，四个功能还是能分别关

一个包只能有一个客户端入口：client-modules 里 entry id == 包名、一个包一份
bundle，两行同名 Loader 行会直接判错（`package X resolves from multiple active
Loader sources`）。所以合并的代价就是**组合包只有一行、插件管理器里只有一个总开关**。

包内的四个 `Config` 布尔字段把这份粒度补回来了：

- 宿主半边（`lib/index.js`）按字段装载 —— `fileFilter` / `bookmarks` /
  `sessionDelete` 关掉就不挂对应路由与包装器。这三个字段**故意不标 volatile**，
  所以拨开关会让 Loader 重挂这一行、宿主侧随之增删。
- 浏览器半边（`lib/client.js`）订阅同一条配置 store，就地用 `ctx.plugin(...)`
  挂 / 卸三个浏览器功能（`fileFilter` 没有浏览器半边）。关掉 `sidebarSwap` 时
  「设置 → 通用」那一行会一起消失。
- 包页面上的配置表单**永远挂载**：否则开关关掉之后再没有地方打开它。

`exclude` 仍标 volatile（同合并前的 file-filter）：改规则只换判定器，不重挂。

## 改代码

浏览器半边是拼出来的：

```
src/client.shell.js                    客户端条目壳（配置表单常驻 + 按开关挂载）
lib/features/bookmarks.client.js       三个浏览器功能，各自是一个 IIFE 常量
lib/features/session-delete.client.js
lib/features/sidebar-swap.client.js
lib/features/config-form.client.js     包页面配置表单 + 设置命名空间探测
        ↓ node tools/build-client.mjs
lib/client.js                          产物，随包提交，不要直接编辑
```

宿主半边直接改 `lib/index.js` 与 `lib/features/*.js`，没有构建步骤。

```
node tools/build-client.mjs           # 重新拼 lib/client.js
node tools/build-client.mjs --check   # 只检查产物是否过期
node tools/smoke.mjs                  # 冒烟测试：宿主路由/过滤 + 客户端挂载/开关
```

`tools/smoke.mjs` 用桩 context 跑两半：宿主侧按开关核对四条路由、两个包装器与
`.meta` 过滤；客户端侧用桩 React/DOM 执行 `lib/client.js`，核对配置表单注册、
三个浏览器功能的挂载 / 卸载，以及拨开关后的即时响应。改完功能跑一遍再安装。

## 迁移自哪个包

| 原来 | 现在 |
|---|---|
| `plugins/file-filter`（`dsh-file-filter`） | `lib/features/file-filter.js` + `lib/ignore-rules.js`，Config 的 `exclude` / `fileFilter` |
| `plugins/browser-bookmarks` | `lib/features/bookmarks.js` + `bookmarks.client.js`，`browser-bookmarks.json` 文件名不变 |
| `plugins/session-delete` | `lib/features/session-delete.js` + `session-delete.client.js` |
| `plugins/sidebar-swap` | `lib/features/sidebar-swap.client.js`（本来就没有宿主逻辑） |

顺手修掉一处旧默认值：`DEFAULT_EXCLUDE` 从 `['.meta']` 改成 `['*.meta']`。排除表是
gitignore 语义，无斜杠模式匹配的是**名字**，`.meta` 只命中恰好叫 `.meta` 的文件，
`a.meta` 不在此列 —— 旧默认值其实一直空转，真正生效的是 profile patch 里那份
`*.meta`。合并包按文档意图改成了后缀写法。

## 安装

包放进 `plugins/gui-tweaks/`，在 profile 的 `package.json` 里加依赖
`"dsh-gui-tweaks": "link:./plugins/gui-tweaks"`，`node_modules` 里出现同名链接，然后：

```
plugin_manager { action: "install_bundle", target: "dsh-gui-tweaks" }
```

行 id 是 `gui-tweaks`；profile patch 里对这个 id 的 config 覆盖（排除表等）照常生效。
