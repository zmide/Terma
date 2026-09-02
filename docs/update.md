# Terma Release Notes / 更新记录

## Next release draft / 下一版草稿

[English](#english) · [简体中文](#简体中文)

<a id="english"></a>
### English

> The next release will focus on real-world recoverable sessions, cross-platform desktop acceptance, and broader terminal AI interoperability.

#### Planned

- Complete real network and reload acceptance for recoverable sessions on Linux, macOS, Windows fallback, and browser mode.
- Expand terminal AI interoperability tests with additional OpenAI-compatible gateways while keeping command execution and MCP approval boundaries unchanged.
- Complete real TigerVNC/noVNC/system-client clipboard acceptance for text, Chinese and image transfer on all three desktop platforms.
- Replace the documentation split preview with a same-window terminal + SFTP screenshot when a clean current-version capture is available.

<a id="简体中文"></a>
### 简体中文

> 下一版本将继续完成可恢复会话的真实验收、跨平台远程桌面验收和更广泛的终端 AI 互操作测试。

#### 计划

- 完成 Linux、macOS、Windows 降级和浏览器模式下的真实断网、重载与会话恢复验收。
- 使用更多 OpenAI 兼容网关扩展终端 AI 互操作测试，同时保持命令执行和 MCP 确认边界不变。
- 完成 TigerVNC、noVNC、系统客户端在三种桌面平台上的文本、中文和图片剪贴板验收。
- 如果能获得干净的当前版本实拍图，把文档首页分屏预览替换为同一窗口的终端 + SFTP 截图。

## v1.6.1

[English](#english) · [简体中文](#简体中文)

<a id="english"></a>
### English

> This maintenance release makes VNC client selection predictable and explains the limits of shared-desktop clipboard and display resizing.

#### Important fixes

- Automatic VNC mode now falls back from the bundled TigerVNC Viewer directly to the system VNC client; Terma no longer silently switches to built-in noVNC. Built-in noVNC remains an explicit choice in Connection settings.
- TigerVNC launches now request remote desktop resizing for fit-to-window and follow-window modes, while original-pixel mode keeps the server's native size.
- Shared `x11vnc` and `wayvnc` desktops now show a clear clipboard warning, and mixed `\\uXXXX` / `\\UXXXXXXXX` text from compatible servers is decoded without changing intentional double-escaped source text.

#### Other improvements

- VNC diagnostics, connection settings, and the documentation now explain when TigerVNC may show scrollbars and when built-in noVNC is the better fit-to-window option.
- Added an X11 forwarding guide to the terminal documentation, including platform requirements and the security boundary between X11 and full remote desktop sessions.

#### Changes in this release

- No pull requests were merged after v1.6.0; this release contains direct maintainer fixes and documentation updates.

**Full Changelog**: [v1.6.0...v1.6.1](https://github.com/zmide/Terma/compare/v1.6.0...v1.6.1)

<a id="简体中文"></a>
### 简体中文

> 本维护版让 VNC 客户端选择更可预测，并明确说明共享桌面剪贴板和显示尺寸调整的限制。

#### 重要修复

- VNC 自动模式现在从内置 TigerVNC Viewer 直接回退到系统 VNC 客户端；Terma 不再静默切换到内置 noVNC。内置 noVNC 仍可在连接设置中手动选择。
- TigerVNC 在“适应窗口”和“跟随窗口”模式下会请求远端调整桌面尺寸；“原始像素”模式保持服务器原始尺寸。
- 共享 `x11vnc` 和 `wayvnc` 桌面现在会显示明确的剪贴板提示；兼容服务端返回的混合 `\\uXXXX` / `\\UXXXXXXXX` 文本会被正确解码，同时保留有意写入的双反斜杠源码文本。

#### 其他优化

- VNC 探测、连接设置和文档现在会说明 TigerVNC 何时可能出现滚动条，以及何时应改用内置 noVNC 适应窗口。
- 终端文档新增 X11 转发指南，说明平台依赖，以及 X11 与完整远程桌面之间的安全边界。

#### 本次变更

- v1.6.0 之后没有合并新的 Pull Request；本版包含维护者直接完成的修复和文档更新。

**完整变更**：[v1.6.0...v1.6.1](https://github.com/zmide/Terma/compare/v1.6.0...v1.6.1)

## v1.6.0

[English](#english) · [简体中文](#简体中文)

<a id="english"></a>
### English

> This release adds a bundled TigerVNC desktop client, safer VNC credential handling, richer terminal AI controls, and a new documentation site with direct feature navigation.

#### Important additions

- Added the VitePress documentation site with feature guides, real interface screenshots, a platform-aware download table, GitHub direct downloads, and a built-in GitHub acceleration route.
- Added a dedicated feature overview; the homepage now exposes clickable cards for each second-level guide instead of repeating long feature descriptions.
- The documentation homepage now uses a larger terminal + SFTP split-workspace preview, and the SFTP guide documents search, online editing, conflict diff/backup, encoding, and SVG preview.
- Added visible GitHub Issues feedback links to both the homepage and the documentation top navigation.
- The desktop About panel now includes a direct Terma website button alongside the GitHub source and license links.
- Desktop builds now bundle the official TigerVNC Viewer and use it as the automatic VNC client, with embedded noVNC and the system client as ordered fallbacks. Connection settings also expose all three choices.
- The bundled runtime is pinned per platform, verified by size and SHA-256 before packaging, and checked again inside the final application resources.
- Saved VNC passwords now reach TigerVNC through a short-lived protected password file instead of a command-line argument; the VNC management view also offers remote service-password changes and explains TigerVNC text-only clipboard limits.
- When a VNC password is wrong or has changed on the server, the management view now offers “Use another password this time”. The password is used only for that launch by default.
- TigerVNC password files now use the protocol's standard bit-reversed DES key, so saved passwords authenticate correctly with the bundled Viewer. Supported managed services can also clear the password and enable passwordless mode with a trusted-network warning.
- Changing a saved VNC password now closes existing embedded sessions and detached noVNC windows before the next connection.
- Terminal AI reasoning settings now include Minimal, Very high (`xhigh`), and Maximum (`max`) when the selected model supports them; deep thinking no longer downgrades an explicit higher setting.

#### Other improvements

- “Save and open” now forces the selected remote desktop client to launch after detection instead of stopping on the probe page.
- The homepage feature cards are whole-card links with no default link underline, and the feedback entry is available both in the hero and the top navigation.

<a id="简体中文"></a>
### 简体中文

> 本版新增内置 TigerVNC 远程桌面客户端、更安全的 VNC 凭据处理、更完整的终端 AI 控制，以及支持直接跳转功能的文档站。

#### 重要新增

- 新增 VitePress 文档站，覆盖完整功能指南、真实界面截图、按平台筛选的下载表格、GitHub 直连和内置 GitHub 加速线路。
- 新增独立的“功能总览”页面；首页改为每项对应一张可跳转的功能卡片，不再重复展开长篇功能介绍。
- 文档首页改用更大的终端 + SFTP 分屏工作区预览图；SFTP 指南补充搜索、在线编辑、冲突差异/备份、编码和 SVG 预览说明。
- 首页和文档站顶部导航均新增跳转 GitHub Issues 的“问题反馈”入口。
- 桌面端“关于”页面新增 Terma 官网按钮，与 GitHub 源码和许可证入口并列。
- 桌面版现在随包提供官方 TigerVNC Viewer；VNC 自动模式按内置 TigerVNC、内置 noVNC、系统客户端顺序回退，连接设置也可以分别选择三种方式。
- 内置运行时按平台固定版本，打包前校验字节数和 SHA-256，最终安装包内还会再次校验清单和可执行文件。
- 已保存的 VNC 密码现在通过短时、受限权限的密码文件交给 TigerVNC，不再放进命令行；VNC 管理界面新增远端服务密码修改入口，并明确说明 TigerVNC 主要支持文本剪贴板。
- VNC 密码错误或服务端密码已变化时，管理界面提供“本次使用其他密码”，默认只用于这次启动。
- TigerVNC 密码文件现使用协议要求的逐字节位反转 DES 密钥，保存的密码可以正确通过内置 Viewer 认证；支持的受管服务还可以清除密码并启用无密码模式，同时显示可信网络警告。
- 修改已保存的 VNC 密码后，Terma 会先关闭已有的内置会话和独立 noVNC 窗口，再进行下一次认证。
- 终端 AI 推理强度新增“最低”、“极高”（`xhigh`）和“最大”（`max`）选项（前提是所选模型支持）；深度思考不会再把明确选择的更高档位降回“高”。

#### 其他优化

- “保存并打开”会在探测通过后强制启动所选远程桌面客户端，不再只停留在探测页。
- 首页功能卡片改为整块可跳转且不带默认下划线；Hero 区和顶部导航均可进入问题反馈。

## v1.5.9

[English](#english) · [简体中文](#简体中文)

<a id="english"></a>
### English

> This release makes terminal AI safer and more predictable, adds read-only Chat and parameterized Workflows, and updates the desktop dependency stack.

#### Important fixes

- Agent output now tolerates escaped Markdown fences, ordered-list markers, numeric HTML entities, and malformed two-backtick fences without changing shell backslashes inside code.
- Complete multi-line scripts stay together, and `printf` formats beginning with `-` are rejected before sending with a safe alternative.
- Agent execution waits for a fresh stable prompt and an empty output queue; interim output, stale prompts, and long-running commands no longer trigger premature follow-up turns.
- Resumed tasks remember attempted commands, skip exact duplicates, and ask the model for one final summary using the first real result instead of executing the same command twice.
- Interactive confirmations, passwords, Chinese prompts, and no-newline prompts now put the task into an explicit waiting state; failed risky tasks stop the remaining queue and only verified checkpoints can be rolled back.
- Chat replies no longer ask users to paste or send terminal output again; the panel explains that users can ask again after Terma reads the latest context.
- The packaged startup splash keeps `Terma` as its native window and taskbar title; progress text stays inside the splash.

#### Important additions

- AI settings now keep the active provider and Save/Test actions visible and support up to 12 independent OpenAI-compatible providers with separate keys.
- Agent tasks now have live plans, step states, elapsed time, action details, metadata-only checkpoints, execution-before/after review, resume, and concise result summaries; the plan stays docked above the composer and can be collapsed.
- Command snippets now support typed, required, sensitive, versioned, multi-step parameters and preview-only runs; each selected terminal or SSH host gets its own resolved preview and incomplete inputs keep execution disabled.
- Terminal AI now includes a read-only Chat mode that automatically sends the latest terminal context, shows copy-only command blocks, and refuses command execution.
- MCP tools now expose read/external/write risk labels, server-side JSON Schema validation, unknown-tool rejection, and one bounded transport retry; Agent context also includes the Terma client platform and available terminal targets.
- Long commands show their size and an interrupt action, and AI shell blocks can be saved as reusable command snippets after host-specific data is removed.

#### Other improvements

- Terminal, session-management, log, settings, and bilingual UI flows now stay consistent across desktop and narrow layouts.

#### Changes in this release

- `deps: bump electron from 43.4.1 to 44.0.0` (#19, @dependabot[bot])
- `deps: bump lucide from 1.33.0 to 1.35.0` (#20, @dependabot[bot])
- `deps: bump @types/node from 26.2.0 to 26.4.0` (#21, @dependabot[bot])
- `deps: bump x11 from 3.9.1 to 4.1.0` (#22, @dependabot[bot])
- `deps: bump node-gyp from 12.4.0 to 13.0.2` (#23, @dependabot[bot])

**Full Changelog**: [v1.5.8...v1.5.9](https://github.com/zmide/Terma/compare/v1.5.8...v1.5.9)

<a id="简体中文"></a>
### 简体中文

> 本版让终端 AI 更安全、更可预测，新增只读聊天和参数化 Workflow，并更新桌面依赖。

#### 重要修复

- Agent 输出兼容服务商误加的 Markdown 围栏、有序列表、数字 HTML 实体和双反引号围栏，代码中的 shell 反斜杠保持不变。
- 完整多行脚本不会再被拆成多条命令；格式字符串以 `-` 开头的 `printf` 会在发送前拦截并给出安全写法。
- Agent 现在等待新的稳定提示符和输出队列排空；暂时空输出、旧提示符和长时间命令不会再触发提前判断。
- 继续任务会记住已执行命令，重复命令只使用第一次真实结果做最终总结，不会重复执行。
- 中文确认、密码、选项和不换行提示会进入明确的等待状态；风险任务失败会停止后续队列，只有已验证检查点才提供回滚。
- 聊天回复不再要求用户复制或发送终端输出，而是提示直接再次提问并自动读取最新内容。
- 正式版启动页的原生窗口和任务栏标题统一显示 `Terma`，进度文字只保留在启动页内部。

#### 重要新增

- AI 设置把当前供应商和保存/测试操作固定在可见区域，并支持最多 12 个独立的 OpenAI 兼容供应商和独立密钥。
- Agent 新增任务计划、实时步骤、耗时、执行前后审阅、元数据检查点、继续任务和最终结果摘要；计划固定在输入框上方并可折叠。
- 命令片段支持文本、路径、端口、开关和下拉参数，以及必填/敏感标记、版本、多步骤和仅预览运行；每个终端或 SSH 主机单独预览最终命令。
- 终端 AI 新增只读“聊天”模式，自动带入最新终端内容，只保留命令复制按钮并拒绝执行命令。
- MCP 工具新增只读/外部访问/可能修改风险标记、JSON Schema 参数校验、未知工具拒绝和一次有限重试；Agent 上下文增加 Terma 平台和可用终端目标。
- 长命令显示长度和中止操作；保存为 Workflow 前会移除主机相关信息，并保留需要补充参数的提示。

#### 其他优化

- 继续整理终端、会话管理、日志、设置和双语界面，让新工作流在桌面和窄屏布局下保持一致。

#### 本次变更

- `deps: bump electron from 43.4.1 to 44.0.0`（#19，@dependabot[bot]）
- `deps: bump lucide from 1.33.0 to 1.35.0`（#20，@dependabot[bot]）
- `deps: bump @types/node from 26.2.0 to 26.4.0`（#21，@dependabot[bot]）
- `deps: bump x11 from 3.9.1 to 4.1.0`（#22，@dependabot[bot]）
- `deps: bump node-gyp from 12.4.0 to 13.0.2`（#23，@dependabot[bot]）

**完整变更**：[v1.5.8...v1.5.9](https://github.com/zmide/Terma/compare/v1.5.8...v1.5.9)

## v1.5.8

<!-- terma-release-revision: 1 -->

[English](#english) · [简体中文](#简体中文)

<a id="english"></a>
### English

> This release adds optional terminal AI, lightweight reconnects for regular SSH terminals, and recoverable SSH sessions, while improving transcript rendering and SFTP deletion reliability.

#### Important fixes

- Improved terminal and log transcript rendering for cursor movement, alternate screens, overwritten lines, and multiline output.
- Fixed SFTP deletion for remote names containing backslashes or non-UTF-8 bytes; deletion now verifies that the target existed and was removed.
- Fixed same-version update confirmations that showed the `{{version}}` placeholder.

#### Important additions

- Added an optional terminal AI panel for OpenAI-compatible services. It supports streaming multi-turn answers, terminal and log context, model, reasoning, and deep-thinking settings, local session history, permission-controlled command execution, and a responsive layout that can be resized or minimized.
- Added built-in and user Skills plus configurable MCP servers for terminal AI. MCP supports stdio, HTTP/SSE, and Streamable HTTP; calls remain approval-gated and sensitive context is redacted locally.
- Added lightweight reconnects for regular SSH Shell tabs. After a window reload, brief network interruption, or WebSocket disconnect, Terma keeps the PTY for a bounded grace period, reconnects automatically, and replays a bounded amount of missed output; explicit disconnects and closed tabs still end the regular Shell.
- Added recoverable SSH terminal tabs backed by tmux or GNU screen. Terma can restore the remote shell, running processes, current screen, and bounded scrollback after reconnects or app restarts, manage sessions whose tabs were closed, and detect, install, or uninstall the session components. Clear shell status, compact session controls, and scrollback controls are included. Root accounts do not need an extra temporary-admin prompt.

#### Other improvements

- Refined terminal, session-management, SFTP, log, settings, and bilingual UI flows to keep the new workflows responsive and consistent across desktop and narrow layouts.

#### Changes in this release

- No pull requests were merged after v1.5.7; all user-visible changes in this release were committed directly by the project maintainer.

**Full Changelog**: [v1.5.7...v1.5.8](https://github.com/zmide/Terma/compare/v1.5.7...v1.5.8)

<a id="简体中文"></a>
### 简体中文

> 本版新增可选的终端 AI、普通 SSH 终端的轻量重连和可恢复 SSH 会话，同时改进终端转录渲染和 SFTP 删除可靠性。

#### 重要修复

- 改进终端和日志转录内容的渲染，正确处理光标移动、备用屏幕、覆盖行和多行输出。
- 修复删除包含反斜杠或非 UTF-8 字节的远端名称失败的问题；删除前后都会确认目标确实存在并已移除。
- 修复同版本更新确认弹窗显示 `{{version}}` 占位符的问题。

#### 重要新增

- 新增可选的终端 AI 面板，支持 OpenAI 兼容服务、流式多轮回复、终端和日志上下文、模型、推理强度、深度思考、本地会话历史和按权限控制的命令执行，并支持响应式排版、调整大小和最小化。
- 新增内置和用户 Skills，并支持配置 MCP 服务器。MCP 支持 stdio、HTTP/SSE 和 Streamable HTTP；工具调用继续受确认控制，敏感上下文会在本地脱敏。
- 新增普通 SSH Shell 的轻量连接保活。窗口重载、短暂断网或 WebSocket 断开后，Terma 会在有限宽限期内保留 PTY、自动重连，并按上限补发断线期间的输出；显式断开和关闭标签仍会结束普通 Shell。
- 新增基于 tmux 或 GNU screen 的可恢复 SSH 终端标签。重连或重新打开 Terma 后，可以恢复远端 Shell、运行中的进程、当前画面和有界滚动历史，也可以管理已关闭标签对应的会话，并探测、安装或卸载会话组件；同时提供清晰的 Shell 状态、紧凑的会话控件和滚动历史控件。root 用户不再需要额外的临时管理员授权。

#### 其他优化

- 优化终端、会话管理、SFTP、日志、设置和双语界面流程，让新增功能在桌面和窄屏布局下保持响应和一致。

#### 本次变更

- v1.5.7 之后没有合并新的 Pull Request；本版所有用户可见变化均由项目维护者直接提交。

**完整变更**：[v1.5.7...v1.5.8](https://github.com/zmide/Terma/compare/v1.5.7...v1.5.8)

## v1.5.7

<!-- terma-release-revision: 2 -->

[English](#english) · [简体中文](#简体中文)

<a id="english"></a>
### English

> This release makes RealVNC connections clearer and more reliable, while letting desktop users save one system VNC client for all remote desktop profiles.

#### Important fixes

- Fixed built-in VNC diagnostics that could mistake an unavailable SSH management probe for an unreachable VNC port. Terma now keeps network, authentication, and RFB handshake failures separate and shows the server's reason, including `Too many security failures`.
- Added a safe fallback for RealVNC authentication that noVNC cannot handle. In automatic mode Terma opens the configured system VNC Viewer; after a server lockout it stops without retrying or launching another client.
- Fixed system VNC viewer detection for custom or unknown executable names. Terma now sends TigerVNC-only switches only to positively identified TigerVNC; RealVNC and other viewers receive the portable `HOST::PORT` target instead of rejecting unsupported options.

#### Important additions

- Added a global system VNC client setting under General settings. The first selection is saved and reused for every remote desktop profile, with a clear first-use notice and a settings entry for changing it later.
- Added a working connection-settings button to detached VNC windows. Desktop windows bring the main Terma window forward and open the selected profile; browser popups retain their opener fallback.

#### Changes in this release

- Improved VNC connection diagnostics, RealVNC client selection, and desktop settings persistence.

**Full Changelog**: [v1.5.6...v1.5.7](https://github.com/zmide/Terma/compare/v1.5.6...v1.5.7)

<a id="简体中文"></a>
### 简体中文

> 本版让 RealVNC 连接提示更清楚、回退更可靠，并允许桌面端为所有远程桌面配置保存一个系统 VNC 客户端。

#### 重要修复

- 修复内置 VNC 把不可用的 SSH 管理探测误判成 VNC 端口不可访问的问题。现在会区分网络、认证和 RFB 握手失败，并显示服务端原因，包括 `Too many security failures`。
- 增加对 noVNC 不支持的 RealVNC 认证方式的安全回退。自动模式会打开已配置的系统 VNC Viewer；服务端触发失败锁定后，Terma 会停止，不再继续重试或启动另一个客户端。
- 修复自定义或无法确认类型的系统 VNC 客户端识别。只有明确识别为 TigerVNC 才传递 TigerVNC 专用参数；RealVNC 和其他客户端只接收通用 `HOST::PORT` 目标，避免因不支持的选项启动失败。

#### 重要新增

- 通用设置新增全局系统 VNC 客户端管理。首次选择会保存并供所有远程桌面配置复用，同时明确提示首次选择行为；以后可以在设置中更换。
- 独立 VNC 窗口新增可用的连接设置按钮。桌面窗口会唤回 Terma 主窗口并打开对应配置，浏览器弹窗保留原有回退入口。

#### 本次变更

- 改进 VNC 连接诊断、RealVNC 客户端选择和桌面设置持久化。

**完整变更**：[v1.5.6...v1.5.7](https://github.com/zmide/Terma/compare/v1.5.6...v1.5.7)

## v1.5.6

<!-- terma-release-revision: 1 -->

[English](#english) · [简体中文](#简体中文)

<a id="english"></a>
### English

> This patch fixes Chinese filenames being corrupted in Windows archive tools when SFTP servers use a non-UTF-8 locale.

#### Important fixes

- Fixed SFTP archive downloads and remote compression on servers whose login locale is GB18030 or another non-UTF-8 locale. Archive filenames now preserve the original Chinese names and include an explicit UTF-8 marker for compatible Windows tools.

#### Changes in this release

- Improved SFTP archive compatibility with Windows archive tools.

**Full Changelog**: [v1.5.5...v1.5.6](https://github.com/zmide/Terma/compare/v1.5.5...v1.5.6)

<a id="简体中文"></a>
### 简体中文

> 本次补丁修复 SFTP 服务器使用非 UTF-8 locale 时，Windows 压缩工具中的中文文件名乱码问题。

#### 重要修复

- 修复 GB18030 或其他非 UTF-8 locale 的服务器进行 SFTP 打包下载和远端压缩时文件名乱码的问题。现在归档会保留原始中文文件名，并写入兼容 Windows 压缩工具的 UTF-8 标记。

#### 本次变更

- 提升 SFTP 归档与 Windows 压缩工具的兼容性。

**完整变更**：[v1.5.5...v1.5.6](https://github.com/zmide/Terma/compare/v1.5.5...v1.5.6)

## v1.5.5

<!-- terma-release-revision: 1 -->

[English](#english) · [简体中文](#简体中文)

<a id="english"></a>
### English

> This patch keeps the SFTP ACE editor search field active while you type.

#### Important fixes

- Fixed the SFTP ACE editor search box losing focus after the first typed character. Search navigation now updates the match without taking focus away from the search field.

#### Changes in this release

- No other user-visible changes are included in this patch.

**Full Changelog**: [v1.5.4...v1.5.5](https://github.com/zmide/Terma/compare/v1.5.4...v1.5.5)

<a id="简体中文"></a>
### 简体中文

> 本次补丁修复 SFTP ACE 编辑器搜索输入时焦点被移走的问题。

#### 重要修复

- 修复 SFTP ACE 编辑器搜索框输入第一个字符后失去焦点的问题。搜索导航现在只更新命中位置，不会把焦点从搜索框移走。

#### 本次变更

- 本补丁不包含其他用户可见变化。

**完整变更**：[v1.5.4...v1.5.5](https://github.com/zmide/Terma/compare/v1.5.4...v1.5.5)

## v1.5.4

<!-- terma-release-revision: 1 -->

[English](#english) · [简体中文](#简体中文)

<a id="english"></a>
### English

> This release expands the command and log workspaces, adds local SSH key management, and improves responsive settings and search workflows.

#### Important additions

- Renamed the Ctrl+K launcher to the Command window. It opens from cached workspace state, keeps remote resources out of the default list, and shows them after searching; command snippets are also search-only.
- Added log content search, matching previews, a dedicated detail search with match counts and previous/next navigation, result-to-line navigation, and chunked loading for large files.
- Added log maintenance statistics, per-group and per-log size previews, historical cleanup previews, and external-editor opening on desktop builds.
- Added Settings > Security > User key management for generating, importing, inspecting, deleting, and deploying Terma-managed SSH keys. Optional management of the user's `~/.ssh` directory remains disabled by default.
- Added Ed25519, RSA, and ECDSA algorithm and supported key-length selection to the SSH key wizard.

#### Improvements

- Log detail search opens with Ctrl+F in the active workspace, keeps the log body below the search bar, and uses narrow-safe pagination. Opening a result preserves the query and target line, while opening a log starts at the newest content.
- Log defaults now use a 10 MB per-file limit, unlimited retention and total size (`0`), and unlimited rotation retention. The maintenance view reports current usage and file count and estimates space released before cleanup.
- SSH host trust supports host, fingerprint, and algorithm search with five records per page; general and security settings use a waterfall layout.
- The key list now uses a compact responsive table with key and encryption icons, clear scope and protection status, and a narrow-operation-area layout that avoids clipped or misaligned columns.
- Key properties now show the SSH fingerprint, allow comment editing, and allow setting, changing, or removing the private-key passphrase without storing it in Terma settings.
- Delete confirmations show only the key filename with normalized separators instead of exposing a long Windows path.
- Reworked the generated-key result dialog and synchronized English and Simplified Chinese resources.

**Full Changelog**: [v1.5.3...v1.5.4](https://github.com/zmide/Terma/compare/v1.5.3...v1.5.4)

<a id="简体中文"></a>
### 简体中文

> 本版本扩展命令窗口和日志工作区，新增本机 SSH 密钥管理，并完善响应式设置和搜索流程。

#### 重要新增

- Ctrl+K 入口改为“命令窗口”：使用缓存的工作区状态打开，默认隐藏远程资源，搜索后才显示；命令片段也仅在搜索时出现。
- 日志支持正文搜索、命中预览、独立详情搜索、命中计数、上一处/下一处导航、结果定位到具体行，以及适合大文件的分段读取。
- 日志维护新增当前占用、文件数量、分组和单日志大小预览、历史清理空间预估；桌面版日志详情支持用外部编辑器打开。
- 设置 → 安全 → 用户密钥管理支持生成、导入、查看属性、公钥、删除和部署 Terma 密钥；用户 `~/.ssh` 管理仍默认关闭。
- SSH 密钥向导支持选择 Ed25519、RSA、ECDSA 及对应的合法密钥长度。

#### 改进

- 日志详情搜索在当前工作区按 Ctrl+F 打开，正文位于搜索栏下方，窄操作区分页不会被裁切；从搜索结果打开日志会保留搜索词并定位命中行，打开日志默认滚动到最新内容。
- 日志默认单文件上限为 10MB，保留天数和总大小均为 `0`（不限），轮转文件不再限制；维护界面显示当前占用和文件数，并可在清理前预估释放空间。
- SSH 主机信任支持按主机、指纹和算法搜索，默认每页 5 条；通用设置和安全设置采用瀑布排版。
- 密钥列表改为紧凑的响应式表格，名称前显示密钥/加密图标，明确显示目录和保护状态；窄操作区会自动改为分层布局，避免列被挤压或错位。
- 属性窗口新增 SSH 指纹，支持修改备注，以及设置、修改或移除私钥口令；口令不会保存到 Terma 设置。
- 删除确认只显示密钥文件名并统一路径分隔符，不再展示过长的 Windows 本机路径。
- 重新整理生成结果弹窗，并同步中英文资源。

**完整变更**：[v1.5.3...v1.5.4](https://github.com/zmide/Terma/compare/v1.5.3...v1.5.4)

## v1.5.3

<!-- terma-release-revision: 1 -->

[English](#english) · [简体中文](#简体中文)

<a id="english"></a>
### English

> This patch fixes the remote desktop action in Quick Open. Clicking the desktop icon now opens the selected RDP, VNC, or XDMCP profile just like pressing Enter or double-clicking the result.

#### Important fixes

- Fixed the remote desktop button in Quick Open doing nothing. The button now dispatches its own open action instead of being ignored by the result-row click guard.

#### Changes in this release

- No pull requests were merged after v1.5.2; this user-visible fix was committed directly by the project maintainer.

**Full Changelog**: [v1.5.2...v1.5.3](https://github.com/zmide/Terma/compare/v1.5.2...v1.5.3)

<a id="简体中文"></a>
### 简体中文

> 本次修复了“快速打开”中的远程桌面操作。现在点击远程桌面图标会像按 Enter 或双击结果一样，打开选中的 RDP、VNC 或 XDMCP 连接。

#### 重要修复

- 修复“快速打开”中的远程桌面按钮点击后没有反应的问题。按钮现在使用独立的打开动作，不会再被结果行的点击保护逻辑忽略。

#### 本次变更

- v1.5.2 之后没有合并新的 Pull Request；本次用户可见修复由项目维护者直接提交。

**完整变更**：[v1.5.2...v1.5.3](https://github.com/zmide/Terma/compare/v1.5.2...v1.5.3)

## v1.5.2

<!-- terma-release-revision: 2 -->

[English](#english) · [简体中文](#简体中文)

<a id="english"></a>
### English

> This release adds a central forwarding workspace with responsive card layouts, makes forwarding rules searchable and controllable from both Quick Open surfaces, adds pagination for large forwarding lists, and gives local forwarding links and SFTP text files more flexible formatting options.

#### Important fixes

- Editing a running forwarding rule no longer reports Terma's own listener as a port conflict. Terma now stops the old listener, applies the change, and restarts it automatically; if the new configuration cannot start, the previous configuration is restored and restarted.

#### Important additions

- Local forwarding links can now include an optional custom URL path and keep that path in templates, duplicated connections, snapshots, and restored data.
- Both Quick Open surfaces can now search SSH connections and forwarding rules by server, group, tag, mode, status, service, note, listener/target address, port, or URL path. Forwarding results show the full access address only while running and can be started or stopped in place.
- The activity-bar forwarding entry is now a Forwarding List. The left pane keeps a compact view of running, reconnecting, and failed rules, while the workspace manages every server's rules with search, filters, add, edit, delete, start, stop, copy, and open actions.
- The Forwarding List can stay ungrouped or group rules by SSH connection. Group and server headers remain visible while scrolling, servers can create rules directly, and groups and servers can be reordered by dragging.
- Shell scripts still default to Unix LF, but the SFTP editor now allows CRLF or CR when explicitly needed and shows a compatibility warning before saving a non-LF script.
- The global and per-SSH forwarding lists now paginate large rule sets. Page size and the last visited page are remembered locally, and filtering returns to the first page.

#### Other improvements

- The global and per-server forwarding pages now use responsive card grids instead of stretching every rule across a wide window. Filters, action buttons, status summaries, and the left forwarding toolbar use consistent sizing and collapse cleanly on narrow screens.
- Connection cards no longer show the ambiguous Running/Stopped forwarding badge. Health icons appear only after an actual health check.
- Quick Open limits and batches large result updates, while SFTP editor statistics and full-text searches are coalesced during continuous typing to reduce interface stalls.

#### Changes in this release

- No pull requests were merged after v1.5.1; the user-visible changes in this release were committed directly by the project maintainer.

**Full Changelog**: [v1.5.1...v1.5.2](https://github.com/zmide/Terma/compare/v1.5.1...v1.5.2)

<a id="简体中文"></a>
### 简体中文

> 本次更新新增采用自适应卡片布局的全局转发工作区，让两套“快速打开”都能搜索并控制转发，支持大型转发列表分页，同时为本地转发链接和 SFTP 文本文件提供更灵活的格式设置。

#### 重要修复

- 编辑正在运行的转发时，不再把 Terma 自己的监听误报为端口冲突。Terma 会自动停止旧监听、应用修改并重新启动；新配置无法启动时，会恢复并重新启动原配置。

#### 重要新增

- 本地转发链接现在可以填写可选的自定义 URL 路径，并在模板、复制连接、配置快照和恢复数据中保留。
- 两套“快速打开”现在都可以搜索 SSH 连接和转发规则，支持服务器、分组、标签、模式、状态、服务、备注、监听/目标地址、端口和 URL 路径。转发结果只有在运行时才显示完整访问地址，并可直接启动或停止。
- 活动栏的转发入口改为“转发列表”。左侧只保留运行中、重连中和失败规则的紧凑状态列表；工作区可集中搜索、筛选，并对所有服务器的转发执行新增、编辑、删除、启动、停止、复制和打开。
- “转发列表”支持不分组或按 SSH 连接分组。滚动时会冻结分组和服务器标题，可直接从服务器标题新增转发，并可拖动调整分组和服务器顺序。
- Shell 脚本仍默认使用 Unix LF，但 SFTP 编辑器现在允许在明确需要时选择 CRLF 或 CR；保存非 LF 脚本前会显示兼容性提醒。
- 全局和单 SSH 转发列表现在支持分页；每页数量和上次所在页会在本机记住，筛选后自动回到第一页。

#### 其他优化

- 全局和单服务器转发页改为自适应卡片网格，不再让每条规则横跨整个宽屏。筛选器、操作按钮、状态统计和左侧转发工具区统一尺寸，窄屏会自动整齐收为单列。
- 连接卡不再显示容易误解的“运行中/已停止”转发标识；只有实际执行健康检查后才显示健康状态图标。
- “快速打开”会限制并合并大型结果集的刷新；SFTP 编辑器在连续输入时也会合并统计和全文搜索，减少界面卡顿。

#### 本次变更

- v1.5.1 之后没有合并新的 Pull Request；本次用户可见变化均由项目维护者直接提交。

**完整变更**：[v1.5.1...v1.5.2](https://github.com/zmide/Terma/compare/v1.5.1...v1.5.2)

## v1.5.1

[English](#english) · [简体中文](#简体中文)

<a id="english"></a>
### English

> This maintenance release keeps Terma responsive during heavy terminal output, SFTP directory work, and update checks. It also prevents stale terminal settings and restart-time forwarding state from confusing the UI.

#### Important fixes

- Fixed large SFTP directory reads, sync scans, and rapid directory opens making the rest of Terma unresponsive. Work is now split into smaller batches, concurrent opens are bounded, and unchanged task data is not rebuilt unnecessarily.
- Fixed switching SFTP tabs, copying tabs, changing split panes, and checking for updates blocking other controls. Existing views are reused and disk/cache work runs asynchronously.
- Reduced the pause between an SSH login banner and the shell prompt. Small terminal output is rendered in bounded batches, log maintenance avoids repeated synchronous filesystem work, and the initial directory probe no longer scans the whole home directory.
- Fixed terminals becoming difficult to control while a remote command continuously prints progress. PTY and SSH sources now honor output backpressure without dropping data, and `Ctrl+C` without a text selection sends an immediate interrupt.
- Fixed a terminal that was already at the bottom jumping upward after a split-pane resize. The original viewport anchor is retained through delayed layout passes.
- Fixed the terminal toolbar showing the previous encoding after quick or repeated changes. Preference writes are serialized per connection, delayed font saves cannot overwrite encoding, and all open tabs receive the latest value.
- Fixed restored built-in forwards incorrectly reporting Terma itself as the port owner after a restart. Stop and start operations now wait for listener release before rebinding.

#### Important additions

- Added a bounded terminal scrollback setting from 1,000 to 100,000 lines, with a default of 30,000. Heavy output uses smaller display batches, while hidden or scrolled-away terminals render less often to keep the desktop responsive.

#### Changes in this release

- No merged pull requests were included after v1.5.0; all user-visible changes in this release were committed directly by the project maintainer.

**Full Changelog**: [v1.5.0...v1.5.1](https://github.com/zmide/Terma/compare/v1.5.0...v1.5.1)

<a id="简体中文"></a>
### 简体中文

> 本次维护更新让 Terma 在大量终端输出、SFTP 目录操作和检查更新时保持可操作，同时避免终端设置过期和重启后转发状态误报。

#### 重要修复

- 修复大型 SFTP 目录读取、同步扫描和快速打开目录会拖住整个 Terma 的问题。现在会拆成更小的批次执行，限制连续打开的并发数，也不会无意义地重建没有变化的任务数据。
- 修复切换 SFTP 标签、复制标签、调整分屏和检查更新时其他控件无法操作的问题。已有界面会复用，磁盘和缓存操作改为异步执行。
- 降低 SSH 登录横幅到 shell 提示符之间的停顿。终端小块输出会按有界批次绘制，日志维护不再反复同步访问文件系统，首次目录探测也不再扫描整个主目录。
- 修复远端命令持续输出进度时终端变得难以控制的问题。PTY 和 SSH 输出现在会遵守背压且不丢数据；没有选中文本时按 `Ctrl+C` 会立即发送中断。
- 修复已经位于底部的终端在分屏调整后跳到上方的问题。现在会在延迟布局处理期间保留原来的视口锚点。
- 修复快速或连续切换编码后终端工具栏仍显示上一个编码的问题。现在按连接串行保存，延迟字体保存不会覆盖编码，所有已打开标签都会收到最新值。
- 修复程序重启后内置转发误报 Terma 自己占用端口的问题。停止和启动转发前会等待监听器真正释放，再重新绑定端口。

#### 重要新增

- 新增终端回滚上限设置，可使用 1,000 到 100,000 行，默认 30,000 行。大量输出会使用更小的分批显示节奏，隐藏或正在查看历史的终端也会降低重绘频率，让桌面保持流畅。

#### 本次变更

- v1.5.0 之后没有合并新的 Pull Request；本次用户可见变化均由项目维护者直接提交。

**完整变更**：[v1.5.0...v1.5.1](https://github.com/zmide/Terma/compare/v1.5.0...v1.5.1)

## v1.5.0

[English](#english) · [简体中文](#简体中文)

<a id="english"></a>
### English

> This release adds a fuller SFTP editing and preview workflow, richer archive and download actions, and fixes the SFTP/workspace stalls that made rapid file work unreliable.

#### Important fixes

- Fixed rapid SFTP tab switching and repeated SFTP opens leaving later tabs stuck on the loading view. Each tab now keeps its own directory request and detached view, completed background reads repaint when restored, and healthy shared SSH sessions are not torn down by an isolated child-channel error.
- Fixed SFTP directory reads getting stuck after switching to another tab and minimizing Terma. Background requests now finish for their own tab and repaint when that tab is shown again.
- Fixed workspace and split-pane updates doing too much work synchronously. Tab switching, toolbar placement, connection refreshes, copying, and closing now preserve the active layout while releasing unrelated resources in the background.
- Fixed completion notifications for downloads, extraction, and other background tasks arriving several seconds late, and fixed completed transfer cards remaining in the running state. Foreground notifications now settle promptly and matching task cards leave the running view when the server reports a final state.
- Fixed page notifications disappearing while they were being read. Hovering a notification or focusing one of its controls now pauses automatic dismissal and resumes the remaining time afterward.
- Fixed the activity bar drawing its selection line before the matching workspace button was ready. The selected background and indicator now appear together after the current workspace render completes; switching to Batch Commands, Import/Export, or Settings also reuses the rendered view before background data refreshes.
- Fixed SFTP columns painting text into adjacent columns after a divider was dragged very narrow. Narrow columns now hide overflow cleanly and keep their content aligned.

#### Important additions

- Added a responsive floating SFTP editor that can keep several files open, minimize them into a shelf, restore them by filename, reuse the existing window for the same remote file, show the server and full remote path, search within the file, remember fullscreen state, and keep edits available after a disconnect or failed save.
- Added image and SVG preview controls for zoom in/out, fit to window, Ctrl+wheel zooming, panning, SVG attribute/text search, previous/next matches, and an exact result marker with surrounding context. The SVG viewer preserves valid source `viewBox` canvases, sanitized embedded styles, connection lines, and visible symbol overflow while keeping zoom inside a stable preview window.
- Added direct page-number jumping to SFTP directory pagination.
- Added configurable SFTP file double-click behavior: use the built-in editor or, on the desktop app, use the external editor.
- Added archive operation options for filename encoding, extraction destination, overwrite behavior, extraction into a same-named folder, custom archive names, and archive download settings.
- Added download-completion actions to open the saved file, open its containing folder, or move the saved file to the system trash.

#### Changes in this release

- [修复 SFTP 与工作区卡顿并完善编辑和传输体验](https://github.com/zmide/Terma/pull/15) (#15, @junxiaoruoya)
- Follow-up SFTP loading, task-state, editor layout, and SVG preview refinements were committed directly by the project maintainer.

#### New contributors

- @junxiaoruoya made their first contribution in [#15](https://github.com/zmide/Terma/pull/15).

**Full Changelog**: [v1.4.9...v1.5.0](https://github.com/zmide/Terma/compare/v1.4.9...v1.5.0)

<a id="简体中文"></a>
### 简体中文

> 本次更新新增更完整的 SFTP 编辑与预览流程、更多压缩和下载操作，并修复快速文件操作时 SFTP 和工作区容易卡住的问题。

#### 重要修复

- 修复快速切换 SFTP 标签或连续打开多个 SFTP 时，后面的标签可能一直停在加载界面的问题。现在每个标签保留自己的目录请求和分离视图，后台完成后会在恢复标签时重绘，健康的共享 SSH 会话也不会因单个子通道错误被拆掉。
- 修复切换到其他标签并最小化 Terma 后，原 SFTP 标签目录读取一直停住的问题。后台请求现在会继续完成并写入对应标签，返回该标签时会重新绘制内容。
- 修复工作区和分屏更新同步执行过多操作导致界面卡顿的问题。标签切换、工具栏归位、连接刷新、复制和关闭现在会保留当前布局，并把无关资源释放放到后台。
- 修复下载、解压等后台任务完成提示延迟，以及传输完成后任务卡仍停留在进行中的问题。前台提示现在会及时收敛，匹配的任务卡在服务端进入终态后会立即离开进行中列表。
- 修复正在阅读的页面通知仍会自动消失的问题。鼠标悬停通知或聚焦通知内控件时，现在会暂停自动关闭，交互结束后继续剩余时间。
- 修复活动栏先单独绘制选中竖线、工作区按钮随后才出现的问题。现在会在当前工作区完成同一轮渲染后一次显示完整的选中背景和指示线；切换到“批量命令”“导入导出”或“设置”时也会先复用已渲染界面，再后台刷新数据。
- 修复 SFTP 列分隔线拖得很窄后文字绘制到相邻列的问题。窄列现在会干净隐藏溢出内容，并保持对齐。

#### 重要新增

- 新增自适应浮动式 SFTP 编辑器：支持同时打开多个文件、最小化到暂存栏、按文件名恢复；同一远端文件会复用已有窗口；还可显示服务器和完整远端路径、搜索文件内容、记忆全屏状态，并在断线或保存失败后保留编辑内容。
- 新增图片和 SVG 预览操作：放大、缩小、适应窗口、Ctrl+滚轮缩放、拖动查看、SVG 属性/文本搜索、上一个/下一个匹配，以及带周边上下文的精确结果标记。SVG 查看器会保留有效的源文件 `viewBox`、清理后的内嵌样式、连接线和控件溢出显示，缩放只作用于稳定预览窗口内部。
- 新增 SFTP 目录分页页码直接跳转。
- 新增 SFTP 文件双击行为设置：使用内部编辑器，或在桌面版中使用外部编辑器。
- 新增压缩和解压选项：文件名编码、解压目标目录、覆盖策略、解压到同名文件夹、自定义压缩包名称和打包下载设置。
- 新增下载完成后的操作：打开已保存文件、打开所在目录，或将已保存文件移入系统回收站。

#### 本次变更

- [修复 SFTP 与工作区卡顿并完善编辑和传输体验](https://github.com/zmide/Terma/pull/15)（#15，@junxiaoruoya）
- 后续的 SFTP 加载、任务状态、编辑器布局和 SVG 预览完善由项目维护者直接提交。

#### 新贡献者

- @junxiaoruoya 在 [#15](https://github.com/zmide/Terma/pull/15) 中完成首次贡献。

**完整变更**：[v1.4.9...v1.5.0](https://github.com/zmide/Terma/compare/v1.4.9...v1.5.0)
## v1.4.9

[English](#english) · [简体中文](#简体中文)

<a id="english"></a>
### English

> This update makes built-in VNC connections more reliable, reduces image-sync delay, and puts the main background refresh controls in one place. Existing settings are migrated automatically with safe defaults.

#### Important fixes

- Fixed the built-in VNC viewer becoming unavailable after repeated opens or reconnects even though the TCP port was reachable. Terma no longer performs standalone unauthenticated VNC probes that TigerVNC can count toward a temporary host blacklist; managed Linux profiles use SSH diagnostics, and the real viewer performs the authentication check.
- Fixed the built-in VNC viewer treating a server that closed immediately after its RFB banner as a successful connection and then retrying it again. Handshake retries now cover only network/startup errors, while an immediate post-banner close is reported as a failed handshake and waits for an explicit reconnect.
- Fixed the Windows X11/XDMCP image bridge competing with normal Windows clipboard use after a screenshot. The bridge still caches screenshots and resumes image paste when an X11 window is focused, but it no longer claims the X11 clipboard while no X11 window is active.
- Fixed the built-in VNC viewer pausing at regular intervals even when clipboard and image synchronization were disabled. Periodic connection, Task Center, and X Server refreshes no longer rebuild unrelated interface areas while noVNC is rendering, and standalone VNC windows no longer start those background services.
- Fixed terminal tabs starting another SSH connection whenever they were activated while host-key preflight was still pending or had just failed. Each tab now performs one automatic connection attempt; switching tabs restores the existing session, while reconnect remains an explicit action.

#### Other changes

- Fixed split-workspace tab closing so a non-focused pane rerenders when its active tab is replaced.
- Fixed the blue activity marker remaining on a terminal tab after that tab was selected. The tab marker and its workspace-group marker now clear together immediately, without waiting for a full tab-strip redraw. Command completion no longer changes this marker to green or sends a completion toast/desktop notification.
- Fixed SFTP editor size gating for GBK, GB18030, Big5, Shift_JIS, EUC-KR, and Latin-1. UTF-8 and UTF-8 BOM remain exact in-browser checks; other encodings are validated by the server using their actual bytes.
- Serialized rapid remote-desktop quick-open preference changes so double-clicking cannot persist a stale value.
- Reserved Web VNC popups synchronously from the user gesture, navigated them only after probing succeeds, shared one pending popup across repeated opens, and closed it only after every probe fails.
- Fixed Electron window titles repeating the host and protocol when a connection name matches its address. Custom connection names and multiple SFTP tab numbers remain visible.
- System VNC connections now check PATH, common installation folders, saved choices, and operating-system VNC associations first. If no client is found, Terma asks you to choose a VNC Viewer application and remembers the validated path for later connections.
- VNC image synchronization now checks immediately when Terma regains focus, with a five-second local fallback and a three-second remote check. General settings now collect the user-facing VNC image, SFTP status, and global data refresh intervals in one place. On Windows, unchanged clipboard images are skipped before PNG conversion, and remote images are downloaded only after their fingerprint changes.
- VNC clipboard helper operations now reuse one short-lived-idle SSH connection per saved SSH profile instead of reconnecting for every text or image check, reducing synchronization delay and connection overhead.
- Connection data, SFTP session status, desktop notifications, tray status, and X Server indicators now use change-aware or adaptive background checks. Idle views do less work, while active transfers and focus recovery still refresh promptly.
- Windows X11/XDMCP image clipboard bridging now checks the native clipboard revision before reading or converting image data. An unchanged screenshot no longer gets decoded to PNG and BMP every half second, while selection-owner recovery still works when VcXsrv temporarily takes the clipboard.
- Background SFTP status checks now report dropped sessions without starting another SSH connection every polling cycle. The next real SFTP operation or an explicit reconnect restores the session. External-editor watches also avoid overlapping requests and slow from 1.2 seconds to 3 seconds during VNC rendering or 8 seconds while Terma is hidden.
- VNC connection settings now include a performance preset. “Smooth first” uses quality 6 to reduce bandwidth and decode pressure; custom quality values remain available, and the preset does not change clipboard sync or remote resolution.

#### Changes in this release

- User-visible work in this release was committed directly by the project maintainer and is not associated with a merged PR or Issue.

**Full Changelog**: [v1.4.8...v1.4.9](https://github.com/zmide/Terma/compare/v1.4.8...v1.4.9)

<a id="简体中文"></a>
### 简体中文

> 本次更新提升内置 VNC 连接可靠性、缩短图片同步等待，并把主要后台刷新间隔集中到一个设置区域。旧配置会自动迁移并使用安全默认值。

#### 重要修复

- 修复内置 VNC 反复打开或重连后，端口仍可访问但服务端却暂时拒绝连接的问题。Terma 不再单独发起会被 TigerVNC 计入临时主机黑名单的未认证 VNC 探测；有关联 SSH 的 Linux 配置改用 SSH 服务诊断，真正的认证交给 VNC 客户端完成。
- 修复内置 VNC 把服务端发出 RFB 标识后立即关闭误判为成功、随后又自动重复连接的问题。现在只对网络或服务启动竞态做握手重试，RFB 标识后的立即关闭会明确判定为握手失败，并等待用户手动重连。
- 修复 Windows X11/XDMCP 图片桥接在截图后可能干扰本机其他软件粘贴的问题。桥接仍会缓存截图，并在 X11 窗口获得焦点后恢复图片粘贴；没有活动 X11 窗口时不再主动占用 X11 剪贴板。
- 修复内置 VNC 即使关闭剪贴板和图片同步，画面仍可能每隔几秒卡顿一下的问题。noVNC 渲染期间，连接列表、任务中心和 X Server 的周期刷新不再重建无关界面；VNC 独立窗口也不再启动这些后台服务。
- 修复终端在主机密钥预检仍在进行或刚失败时，切换回标签会再次发起 SSH 连接的问题。每个标签现在只自动尝试连接一次；切换标签只恢复原会话，重连仍由用户明确操作。

#### 其他变化

- 修复分屏工作区关闭标签后非焦点窗格不刷新内容的问题。
- 修复终端标签已经选中后，右侧蓝色活动提示点仍然残留的问题；标签提示与对应工作区组提示现在会立即一起清除，不再等待整个标签栏重绘。命令执行完成后也不再把提示点变成绿色，且不再发送命令完成的页面或桌面通知。
- 修复 SFTP 编辑器对 GBK、GB18030、Big5、Shift_JIS、EUC-KR 和 Latin-1 按 UTF-8 错误禁用保存的问题；UTF-8 与 UTF-8 BOM 仍在前端精确检查，其他编码交由服务端按实际字节数校验。
- 修复快速连续点击远程桌面快捷打开设置时可能按旧值并发保存的问题。
- 修复 Web VNC 异步探测后新窗口被浏览器拦截的问题：用户点击时同步预留窗口，连续打开会共享同一个待处理窗口，探测成功后再导航，只有全部探测失败时才关闭。
- 修复连接名与主机地址相同时，Electron 窗口标题重复显示主机和协议的问题；自定义连接名与多个 SFTP 标签编号仍会保留。
- 系统 VNC 连接现在会先检查 PATH、常见安装目录、已保存选择和操作系统 VNC 关联；仍未找到客户端时，Terma 会让用户选择 VNC Viewer 程序，并记住校验通过的路径供后续连接使用。
- VNC 图片同步现在会在 Terma 恢复焦点时立即检查，本机图片使用 5 秒兜底轮询，远端图片默认每 3 秒检查一次。“通用设置”现在集中管理 VNC 图片、SFTP 状态和全局数据等用户可调的刷新间隔。Windows 上未变化的剪贴板图片会在 PNG 转换前跳过，远端图片也只在指纹变化后下载。
- VNC 剪贴板辅助操作现在会按已保存的 SSH 连接复用一条空闲后自动关闭的 SSH 连接，不再为每次文本或图片检查重复建立 SSH，降低同步延迟和连接开销。
- 连接数据、SFTP 会话状态、桌面通知、托盘状态和 X Server 指示现在使用按变化或按活跃度调节的后台检查。空闲界面减少工作量，活动传输和窗口恢复仍会及时刷新。
- Windows X11/XDMCP 图片剪贴板桥接现在会先检查系统剪贴板版本；截图没有变化时，不再每 500 毫秒重复读取并转换 PNG、BMP，同时保留 VcXsrv 暂时占用剪贴板后的所有权恢复能力。
- SFTP 后台状态检查发现会话断开时只更新状态，不再每个轮询周期重新建立 SSH；下一次真实 SFTP 操作或用户手动重连时再恢复。外部编辑会话也不会产生重叠请求，并在 VNC 渲染期间从 1.2 秒降为 3 秒、Terma 隐藏时降为 8 秒检查一次。
- VNC 连接设置新增性能预设。“流畅优先”会把画质设为 6，减少带宽和解码压力；仍可切换到自定义画质，预设不会改变剪贴板同步或远端分辨率。

#### 本次变更

- 本版用户可感知内容由项目维护者直接提交，未关联已合并 PR 或 Issue。

**完整变更**：[v1.4.8...v1.4.9](https://github.com/zmide/Terma/compare/v1.4.8...v1.4.9)

## v1.4.8

[English](#english) · [简体中文](#简体中文)

<a id="english"></a>
### English

> This update expands VNC into a focused standalone workflow, keeps terminal live displays current in the background, and makes Windows X11/XDMCP image paste and WPS window controls reliable.

#### Important fixes

- Fixed live terminal counters and progress displays appearing frozen after Terma was minimized, hidden to the tray, or switched to another workspace tab. Sessions now keep processing output in the background and repaint immediately when shown again.
- Fixed local clipboard images appearing as `�PNG` in remote applications when image data was mistaken for text. Terma now keeps text and image clipboard formats separate throughout synchronization.
- Fixed the hidden VNC full-screen toolbar sometimes failing to appear when the pointer reached the top edge. A 1px top-edge target now reveals it without blocking nearby controls, and VNC dialogs, menus, and notifications remain visible during content full screen.
- Fixed detached VNC windows and system-client launch failures falling back to generic or English Electron errors. Terma now validates the VNC profile before opening the window, rechecks the installed local client before launch, and shows the failure in the current interface language.
- Fixed WPS windows launched through Windows X11 forwarding whose minimize and drag actions did nothing and whose maximize click could close the window. Minimize, maximize/restore, and dragging now work without changing the normal X11 multi-window layout.
- Fixed local screenshots failing to paste into WPS and other Windows X11/XDMCP applications, or being replaced by an empty text entry. Terma now provides only valid image formats and keeps the verified image available while the target application completes the paste.

#### Important additions

- VNC detection and connected-viewer toolbars can open the desktop in a separate Terma window that contains only the VNC toolbar and remote screen. Each VNC connection now keeps only one active viewer: switching from built-in VNC returns the main tab to detection and management, while opening built-in VNC closes the matching separate window. Reopening the separate view focuses its existing window instead of creating duplicates. The native window keeps its title bar and taskbar-aware maximize behavior, while VNC content full screen remains a separate mode.
- VNC content full screen now keeps the toolbar visible by default and changes the control to an exit action. The preference under General settings can always show it, always hide it with `Esc` exit, or reveal it when the pointer reaches the top edge; in edge mode, the toolbar remains visible for half a second after the pointer leaves.
- Built-in VNC sessions now synchronize PNG clipboard images in both directions automatically by default. The option can be disabled per VNC connection and runs only while Terma is in the foreground and the linked SSH helper supports `xclip` or `wl-clipboard`.
- SSH and other connection editors now provide Save only, Save and close, and Save and open actions. Connection-backed workspace tabs also offer Edit connection in their context menu, while temporary connections remain excluded.

#### Changes in this release

- User-visible work in this release was committed directly by the project maintainer and is not associated with a merged PR or Issue.

**Full Changelog**: [v1.4.7...v1.4.8](https://github.com/zmide/Terma/compare/v1.4.7...v1.4.8)

<a id="简体中文"></a>
### 简体中文

> 本次更新把 VNC 扩展为更专注的独立窗口工作流，保证终端实时画面在后台继续更新，并完善 Windows X11/XDMCP 的图片粘贴和 WPS 窗口控制。

#### 重要修复

- 修复 Terma 最小化、隐藏到托盘或切换到其他工作区标签后，带实时计时和进度的终端程序可能停留在旧画面的问题。会话现在会在后台继续处理输出，重新显示时立即刷新。
- 修复图片数据被误当作文本同步，导致本机剪贴板图片粘贴到远端应用后显示为 `�PNG` 的问题。Terma 现在会在整个同步过程中严格区分文本和图片格式。
- 修复 VNC 内部全屏选择顶部边界显示后，鼠标移到顶部仍可能无法显示快捷栏的问题。现在使用仅 1px 的顶部热区可靠触发，不再挡住附近控件，全屏期间的弹窗、菜单和通知也会正常显示在画面上方。
- 修复 VNC 独立窗口和系统客户端启动失败时退化为通用请求错误或 Electron 英文错误的问题。现在会在打开窗口前校验 VNC 配置、启动前重新探测本机客户端，并按当前界面语言显示原因。
- 修复 Windows X11 转发下 WPS 的最小化、拖动无效，以及点击最大化可能直接关闭窗口的问题。现在最小化、最大化/还原和拖动都能正常使用，同时保持原有 X11 多窗口布局。
- 修复本机截图无法粘贴到 WPS 和其他 Windows X11/XDMCP 应用，或被替换成空文本的问题。Terma 现在只提供有效图片格式，并在目标应用完成粘贴前保留已校验的图片。

#### 重要新增

- VNC 探测界面和已连接工具栏都可把桌面打开到独立 Terma 窗口，仅显示 VNC 工具栏与远程画面。每条 VNC 连接现在只保留一个活动查看器：从内置 VNC 切到独立窗口时，主标签会关闭内置会话并返回探测与管理；重新打开内置 VNC 时会关闭对应独立窗口；重复打开独立窗口只会聚焦现有窗口，不再产生多个副本。原生窗口保留标题栏，并使用不会覆盖 Windows 任务栏的最大化；VNC 内容全屏继续作为独立模式。
- VNC 内容全屏默认保留快捷栏，并把全屏按钮切换为退出操作；通用设置可选择始终显示、始终隐藏并按 `Esc` 退出，或鼠标移到顶部边界时显示；顶部边界模式下，鼠标移出后会继续保留 500 毫秒再收起。
- 内置 VNC 默认自动双向同步 PNG 剪贴板图片；可在每个 VNC 连接中单独关闭，仅在 Terma 位于前台且关联 SSH 辅助支持 `xclip` 或 `wl-clipboard` 时运行。
- SSH 和其他连接编辑页新增“仅保存”“保存并关闭”和“保存并打开”；由连接创建的工作区标签右键菜单也可直接“编辑连接”，临时连接不会显示该入口。

#### 本次变更

- 本版用户可感知内容由项目维护者直接提交，未关联已合并 PR 或 Issue。

**完整变更**：[v1.4.7...v1.4.8](https://github.com/zmide/Terma/compare/v1.4.7...v1.4.8)

## v1.4.7

<!-- terma-release-revision: 2 -->

[English](#english) · [简体中文](#简体中文)

<a id="english"></a>
### English

> This is a refreshed v1.4.7 build. If you installed an earlier v1.4.7 build, open Terma's update page and choose Download again. It also adds resumable SFTP transfers, terminal and VNC image clipboard workflows, safer remote desktop management, and broader Chinese and English coverage across the core interface.

#### Important fixes

- Fixed Windows startup becoming unresponsive when interrupted ACL hardening left SQLite WAL or shared-memory files without usable permissions. Terma now establishes private explicit access before removing inherited entries, and backend-load failures display an error instead of leaving a hidden stalled process.
- Fixed RDP, VNC, and XDMCP deep SSH inspection and setup guides failing when an old remote profile still referenced a deleted SSH connection. Terma now repairs the reference only when exactly one SSH connection for the same host exists; missing or ambiguous matches remain unchanged for the user to resolve.
- Fixed forwarding-template action buttons being squeezed into a narrow column, breaking “Apply in batch” across individual letters and overlapping adjacent rows.

#### Important additions

- SFTP uploads, downloads, archive downloads, and cross-SFTP transfers now use checkpoints for pause, resume, and supported recovery after restarting Terma. Changed source files, damaged checkpoints, or destination conflicts stop with an explicit message instead of overwriting newer data with stale state.
- In a desktop remote Linux terminal, pressing `Ctrl+V` with a local clipboard image now writes it to the remote graphical clipboard and triggers paste when X11 and the required clipboard helper are available. If that path is unavailable, Terma safely uploads the image to a remote temporary directory and pastes its path.
- The first launch now suggests Simplified Chinese only for mainland China locales and English elsewhere, without a network geolocation request. New and existing users confirm the language once, each language option explains itself in its own language, and the interface can still be switched at any time afterward.
- X Server Management can detect, install, and remove Linux image-clipboard support through `xclip`, using online, remote-cache, local-download offline, or manual setup. On APT hosts, Terma can download the full dependency set locally and upload it through SFTP, with progress shown in Task Center.
- The built-in VNC viewer can send local PNG images to the remote graphical clipboard through the associated SSH connection and receive remote PNG clipboard content on the local device. Missing remote components produce a clear explanation and a direct path to X Server Management.

#### Other improvements

- A resumable transfer displays Pause directly on its floating progress card and replaces it with Resume in place. Non-resumable stages such as remote archive creation and final commit do not display misleading controls.
- Browser downloads and native desktop drag-out can continue reading existing byte ranges after an interruption, transferring only missing segments instead of restarting a large download.
- In-app update notes now render bilingual sections, headings, links, anchors, code blocks, and HTML safely instead of showing Markdown source.
- The update page now warns when the current version has been republished and offers a fresh download; this is useful when a same-version build replaces an earlier package.
- The bilingual-interface audit now covers terminal and SFTP shortcuts, context and secondary menus, named workspaces, forwarding, Quick Open, Linux desktop management, migration, storage, updates, remote desktop setup, X Server, VNC, Ace-based editing, text comparison, tray menus, native directory pickers, notifications, task cards, hidden rendered DOM, and state changes.
- Running, Reconnecting, and Failed labels are now consistently displayed below their numbers in forwarding summaries and the Running view.
- The GitHub README now defaults to English with a synchronized Simplified Chinese mirror. Release notes use English first, Simplified Chinese second, quick language links, and in-app language-aware display.

#### Changes in this release

- User-visible work in this release was committed directly by the project maintainer and is not associated with a merged PR or Issue.

**Full Changelog**: [v1.4.6...v1.4.7](https://github.com/zmide/Terma/compare/v1.4.6...v1.4.7)

<a id="简体中文"></a>
### 简体中文

> 这是重新发布的 v1.4.7 构建。如果你安装过早期 v1.4.7，请打开 Terma 的更新页面并点击“重新下载”。本版同时新增 SFTP 检查点续传、终端与 VNC 图片剪贴板、更安全的远程桌面管理，并扩大核心界面的中英文覆盖范围。

#### 重要修复

- 修复 Windows 数据权限收紧中断后，SQLite WAL 或共享内存文件可能失去可用权限、导致启动看似没有反应的问题。现在会先建立当前用户、SYSTEM 和管理员的私有显式权限，再移除继承；后端加载失败也会显示错误，不再留下隐藏的停滞进程。
- 修复旧远程配置仍引用已删除 SSH 连接时，RDP、VNC、XDMCP 的 SSH 深度探测和安装说明请求失败的问题。现在只会在同一主机恰好存在一个 SSH 候选时自动修复引用；没有候选或候选不唯一时仍交由用户确认，不会猜测绑定。
- 修复转发模板操作按钮被挤入过窄列，导致“批量应用”逐字换行并与相邻行重叠的问题。

#### 重要新增

- SFTP 普通上传下载、压缩包下载和跨 SFTP 传输新增检查点续传；支持暂停后继续，并能在程序重启后恢复可续传任务。源文件已经变化、检查点损坏或目标冲突时会停止并明确提示，不会用旧状态覆盖新内容。
- 在桌面版的远程 Linux 终端中按 `Ctrl+V` 粘贴本机剪贴板图片时，X11 和远端剪贴板工具可用会优先写入远端图形剪贴板并直接触发粘贴；条件不满足或转发失败时，会自动安全上传到远端临时目录并粘贴图片路径。
- 首次启动会在不联网定位的前提下，仅对中国大陆语言环境预选简体中文，其他地区预选英文。新用户和存量用户都会确认一次，每个语言选项始终使用自己的语言进行说明，以后仍可随时切换。
- X Server 管理新增 Linux 图片剪贴板组件管理，可检测、安装或卸载 `xclip`，并提供在线、远端缓存、本机下载后离线和手动配置方式；APT 主机可由本机下载完整依赖后通过 SFTP 上传安装，安装和卸载进度统一进入任务中心。
- 内置 VNC 新增图片剪贴板收发，可通过关联 SSH 把本机 PNG 发送到远端桌面，或把远端图形剪贴板中的 PNG 写回本机剪贴板；远端缺少所需组件时会明确提示并引导到 X Server 管理。

#### 其他优化

- 悬浮任务进度卡在单个可续传任务的文件传输阶段直接提供暂停按钮，暂停后原位显示继续；远端打包、最终提交等不可暂停阶段不会显示误导操作。
- 浏览器下载和原生拖出支持按范围继续读取已有内容，网络中断后只补传缺失分段，减少大文件重新下载。
- 程序内更新日志现在会正确渲染双语分段、标题、链接、锚点、代码块并安全过滤 HTML，不再直接显示 Markdown 源文。
- 更新页面现在会提醒当前版本被重新发布，并提供重新下载入口，适合同版本构建替换早期安装包的情况。
- 双语界面审查扩展到终端与 SFTP 快捷按钮、右键菜单和二级菜单、命名工作区、转发列表、快速打开、Linux 桌面管理、迁移、存储、更新、远程桌面安装说明、X Server、VNC、Ace 编辑器、文本比对、托盘菜单、系统目录选择框、通知、任务卡、隐藏但已渲染的 DOM 和状态变化。
- 转发摘要和“正在转发”页面中的 Running、Reconnecting、Failed 现在统一显示在数字下方。
- GitHub README 现在默认显示英文，并提供内容同步的简体中文镜像；Release Notes 使用英文在前、简体中文在后、页内快速跳转和程序内按当前语言显示。

#### 本次变更

- 本版用户可感知内容由项目维护者直接提交，未关联已合并 PR 或 Issue。

**完整变更**：[v1.4.6...v1.4.7](https://github.com/zmide/Terma/compare/v1.4.6...v1.4.7)

## v1.4.6

> 本版完善批量命令、桌面后台通知与 SFTP 任务边界。切换标签、最小化应用和处理本地文件上传时，运行状态与文件行为更加稳定。

### 重要修复

- 修复批量命令在确认、主机身份校验、标签切换和分屏复制期间可能重复启动或串用结果的问题；执行中的输出与完成状态会跟随各自标签恢复，修改执行条件后旧结果不再重新出现。
- 修复桌面版最小化、隐藏到托盘或切到后台后，SFTP 等长任务完成提醒要等到重新打开窗口才出现的问题；现在由桌面端及时发送系统通知，恢复窗口后也不会重复补弹。
- 优化本地文件标签上传任务的文件管理，传输完成、取消或清理任务后会继续保留原文件。
- 修复打包下载等不支持断点续传的任务可能错误显示暂停或继续入口的问题；任务中心现在只为实际支持续传的传输提供对应状态。

### 其他优化

- 批量命令模板编辑改为宽窗口，命令输入保留脚本行结构；操作区的模板列表只显示有限行的可读预览，长 URL 不再把列表撑乱。
- 修复批量执行标签切换回来后，尚未执行的命令、超时设置和目标勾选被重置的问题；草稿只在当前运行期间保留，关闭标签后自动清理。
- 批量命令现在按完整脚本保留换行、缩进、续行和 here-doc 等结构，远端非零退出码、停止、超时和连接中断会显示对应结果。
- 每次启动程序时会自动重新检查一次更新，原有的设置页检查和手动检查方式保持不变。

### 本次变更

- 本版用户可感知内容由项目维护者直接提交，未关联已合并 PR 或 Issue。

**完整变更**：[v1.4.5...v1.4.6](https://github.com/zmide/Terma/compare/v1.4.5...v1.4.6)

## v1.4.5

> 本轮改善安装版启动体验、SFTP 目录错误提示、终端后台输出标记和通知管理。启动空白、无权限目录和隐藏终端的新输出会得到更明确的处理，页面提示与悬浮任务卡也可以按需要分别控制。

### 重要修复

- 修复正式安装的桌面版启动时，进度窗口内容尚未渲染便提前显示、短暂出现白色空窗的问题；现在会在启动页首帧准备完成后再显示。
- 修复普通账号访问 `/root` 等无权限远程目录时，SFTP 可能把账号主目录的一条文件信息误显示为当前路径，或在读取文件夹大小时因远端系统语言编码显示乱码的问题；现在会保留原目录和连接状态，并统一明确提示没有目录访问权限。
- 修复隐藏的终端标签收到 `tail` 等持续命令的新输出时，二进制输出没有完整进入活动状态跟踪、蓝点提示偶尔不可靠的问题；现在实际收到新字节后会稳定标记，当前仍在任一分屏中可见的终端不会显示未读蓝点。

### 重要新增

- 通知设置新增信息、成功、错误和任务进度提示的独立开关与显示时长；悬浮任务进度卡也移入同一区域单独控制，关闭这些页面提示不会影响任务中心中的状态和记录。
- 任务中心的失败页新增“一键清空失败”，可一次删除当前失败任务记录；进行中、暂停和历史记录不会被连带删除。

### 本次变更

- 本版用户可感知内容由项目维护者直接提交，未关联已合并 PR 或 Issue。

**完整变更**：[v1.4.4...v1.4.5](https://github.com/zmide/Terma/compare/v1.4.4...v1.4.5)

## v1.4.4

> 本次重点改善终端命令记录、SFTP 大文件与超大目录处理，并完善分屏工作区的本地文件操作。文件选择、拖动、分页、列宽调整和跨窗格发送现在有更一致的反馈，同时新增轻量分段编辑、传输并发与外部编辑保存策略。

### 重要修复

- 修复终端使用 `Tab` 补全、方向键调回历史命令或在命令中间继续编辑后，“最近命令”可能只记录部分内容或记录旧内容的问题。
- 修复同时在外部编辑器中修改多个远程文件时，保存提示可能互相覆盖或遗漏的问题；多个待处理文件现在会依次提示。
- 修复本地文件标签从文件行或名称区域无法拖到 SFTP、已连接终端的问题；多选拖动会显示与 SFTP 一致的文件预览和数量提示。
- 修复分屏时切换另一侧标签会重新读取本地文件目录、回到列表顶部，以及长列表修改每页数量后跳离当前阅读位置的问题。
- 修复包含大量项目的 SFTP 目录因逐项读取大小、时间和权限而加载失败的问题；现在会自动使用远端分页和批量元数据读取，保留完整文件信息。
- 修复窄分屏下本地文件表头无法拖动列宽，以及 SFTP 分隔线拖动时持续漂移的问题；拖动名称与大小之间的分隔线时，其后的时间、权限和操作边界保持原位，权限与操作之间的分隔线也与其他列保持一致。
- 修复本地文件多选操作栏出现纵向滚动条、关闭按钮右侧区域无法点击，以及拖动其他文件后旧文件仍保留选中背景的问题；本地文件和 SFTP 的复选框、当前行背景与拖动目标现在始终同步。
- 修复部分 Linux 服务器返回带小数的文件修改时间时，Windows 桌面版单击 SFTP 文件可能提示 `mtimeMs must be a non-negative integer` 的问题。

### 重要新增

- SFTP 新增轻量文本编辑器，可按 256 KB 分段浏览和编辑大文件；可选择始终使用、按文件大小自动启用或继续使用完整编辑器，并可调整自动切换阈值。
- SFTP 新增上传和下载并发上限，可分别设置为 1 至 8。普通下载、打包下载、拖到本地文件标签和桌面拖出会共享下载额度，超出上限的任务会在任务中心排队。
- SFTP 外部编辑新增保存规则，可继续逐次确认，也可在外部编辑器保存后自动覆盖远端；自动覆盖时可选择先备份远端源文件。
- 本地文件和 SFTP 支持单击文件名勾选当前项目，通过 `Ctrl/Cmd`、`Shift` 或复选框扩展选择，并支持 `Ctrl/Cmd+A` 全选当前页；只有选择两项及以上时才显示批量操作。
- 本地文件表头新增按名称、大小、修改时间排序和拖动分隔线调整列宽；右键菜单可将本地文件或 SFTP 项目发送到分屏另一侧的终端、SFTP 或本地文件标签。

### 其他优化

- 打开较大的 SFTP 文件时会显示可取消的读取和解析进度；编辑器就绪后再结束提示，减少长时间等待时的不确定感。
- SFTP 下载历史可直接打开已下载文件或所在文件夹，并提供更明确的文件、目录和删除操作图标。
- SFTP 全局设置按常规、编辑器和传输分组，下载位置、编辑方式、外部保存规则和并发额度更容易查找。
- 复制终端标签时继续使用当前同名标签的编号顺序，关闭全部同名标签后再从初始编号开始。
- 正式安装的桌面版启动时会先显示简洁的启动进度窗口，主界面就绪后自动关闭；后台启动到托盘时不显示。
- 窄分屏下文件表头会保留名称与折叠字段说明，大小、时间和权限合并显示在文件名下方，操作区自动收紧为更多操作按钮。
- 本地文件未勾选时可直接拖动，拖动开始会自动成为单项选择；已勾选多项时继续携带整组选项。
- 本地文件、SFTP、操作区和其他可滚动区域统一使用更浅的横向与纵向滚动条，亮色和暗色主题下保持一致。

### 本次变更

- 本版由项目维护者直接提交，未关联已合并 PR 或 Issue。

**完整变更**：[v1.4.3...v1.4.4](https://github.com/zmide/Terma/compare/v1.4.3...v1.4.4)

## v1.4.3

> 本次新增终端快速命令栏和 `sz` / `rz` 文件传输，增强 SFTP 搜索、编辑与列表操作，并修复 Linux 多图形会话的桌面认证信息传递风险、粘贴命令记录和拖入终端上传不完整的问题。

### 重要修复

- 修复 Linux 多图形会话启动独立窗口时，桌面认证信息会短暂出现在子进程环境中的风险。现在只通过进程间通信交付，收到有效认证信息前不会打开窗口，交付失败或超时会直接退出。
- 修复从剪贴板粘贴到终端后，已执行命令没有进入“最近命令”的问题。单行和多行内容只记录实际执行的命令，密码提示期间粘贴的内容不会保存。
- 修复把本机文件拖入终端上传时，部分文件只写入开头一小段并提示内容不完整的问题；上传后的远端大小校验继续保留。
- 修复下载仍在持续写入的 SFTP 文件时被判定为失败的问题；现在会保存本次实际读取的内容，并提示文件在传输期间发生过变化。
- 修复 SFTP 搜索频繁重新读取大目录、翻页或重新进入目录等待时间过长，以及连接中断时显示难以理解的空退出码问题。
- 修复外部编辑远程文件时，本机一有变化就自动回传的问题；现在只在内容确实改变时询问，保存前会再次检查远端变化。
- 修复切回已经打开的 SFTP 标签时重复加载目录和搜索、搜索状态不明显，以及长列表滚动后看不到同步状态的问题。
- 修复 SFTP 项目拖到终端标签时目标预览和落点状态不稳定的问题；有效目标会保持激活，无效落点会返回原标签。
- 修复更新下载进度刷新时，最近版本更新内容反复跳回第一行的问题。

### 重要新增

- SSH 终端新增快速命令栏，可显示或隐藏、调整高度和顺序。命令支持直接执行或仅插入终端，右键可编辑、移除或删除，双击空白处可直接新建。
- SSH 终端新增 ZMODEM 文件传输。远端执行 `sz 文件` 可下载到当前电脑，执行 `rz` 可上传一个或多个本机文件；同名文件可选择覆盖、自动重命名或取消，并显示进度和实际文件名。
- SFTP 搜索新增“搜索子目录”，支持 `Ctrl+F` 打开、`Esc` 关闭，并在结果过多时提示已截断。
- SFTP 文本冲突和外部编辑变化新增左右对比视图，可先比较再选择备份覆盖、另存为或暂不保存；程序内编辑器可比较最近 10 个备份版本。
- SFTP 文件列表支持调整名称、大小、修改时间和权限列的顺序与宽度，布局会在本机保存。
- 新建 SSH 页面新增“保存并连接”，保存成功后会直接打开新连接终端。

### 其他优化

- 关闭仍在连接或连接中的终端、SFTP、远程终端或内置 VNC 标签时会先确认；RDP 和 XDMCP 不再显示无法可靠判断的红色连接状态，也不会触发误导性的连接提示。
- “最近版本更新内容”从最近 2 个正式版本扩展为最近 10 个，并保持当前阅读位置。
- 工作区标题栏和标签栏的拖动边界更容易区分，顶部工具栏在最小高度时不再遮挡按钮。
- SFTP 表头、数据行和操作区使用统一网格对齐，后台同步提示固定在文件列表可视区域。
- “关于”页新增随附组件、版本和许可证清单，完整说明继续随程序提供在 `THIRD_PARTY_NOTICES.md`。

### 本次变更

- 感谢 [@anupamme](https://github.com/anupamme) 通过 [#9](https://github.com/zmide/Terma/pull/9) 报告 Linux 显示客户端的认证信息传递风险；本版由项目维护者重新实现修复，未合并该 PR 的现有补丁。
- 其他内容由项目维护者直接提交，未关联已合并 PR 或 Issue。

**完整变更**：[v1.4.2...v1.4.3](https://github.com/zmide/Terma/compare/v1.4.2...v1.4.3)

## v1.4.2

> 本次修复部分服务器通过 SFTP 打开文件时出现 `0: Event not found.` 并失败的问题。

### 重要修复

- 修复远端账号使用 `csh`、`tcsh` 等登录 Shell 时，SFTP 打开 `.bat`、脚本、配置文件或其他文本文件可能失败的问题。目录读取、文件打开、流式传输和后台任务现在使用一致的兼容方式；文件只会按内容读取，不会因为扩展名被执行。

- 修复远端缺少必要命令时，部分操作可能返回空结果却显示成功的问题；现在会明确提示缺少的组件并停止操作。读取远程文件时也不再加载额外的登录配置，避免服务器欢迎信息或脚本输出混入文件内容。

## v1.4.1

> 本次新增未保存目标的快速 SSH 连接和统一凭据修复，并继续改善终端、SFTP、远程桌面与设置页面的常用操作。

### 重要修复

- 修复 IPv6 远程地址在 RDP、VNC、XDMCP 探测和其他远程连接中被错误拼成 `地址:端口` 的问题。现在输入 `[IPv6]` 或裸 IPv6 都能识别，保存后会统一规范化，显示和启动客户端时保留正确的方括号格式；XDMCP Query/Indirect 探测会按实际地址选择 IPv4 或 IPv6，局域网广播仍保持 IPv4。

- 修复同一个较大远程文件第一次可以打开、数秒内再次打开却在末尾传输中断的问题；Terma 会等待复用 SSH 会话中的输出完全排空后再结束响应，避免最后一段内容仍在缓冲区时提前关闭。
- 修复终端断开后重连会清空屏幕内容的问题；重连现在保留原输出，并追加醒目的重连分隔提示。
- 修复打开仍在持续写入的远程日志时，偶尔出现笼统 network error 的问题。Terma 会按打开瞬间的文件大小读取稳定快照，避免文件增长超过响应声明长度；浏览器传输意外中断时还会自动重试一次，并在再次失败时说明文件可能正在改写或网络连接不稳定。
- 修复 RDP、VNC 和 XDMCP 连接没有关联 SSH 时被误判为不可用的问题。Windows RDP、独立 VNC 和 XDMCP 现在可按自身协议直接启动；SSH 只用于 Linux 服务安装、启停和深度诊断，认证失败时可就地修复，未关联时也可直接新建并绑定管理连接。
- 修复 RDP 端口已经可达时仍被 Linux 桌面检查拦截，以及点击“打开 RDP 客户端”会再次把页面重置为服务探测的问题。RDP 启动现在只重新确认保存目标的 TCP 端口；XDMCP 在 SSH 探测不可用时会发送标准 UDP Query，并区分服务接受、拒绝和无响应，仍保留直接尝试入口。
- 修复远端 X11 组件安装完成后安装弹窗仍显示缺少 `xauth` 的旧提示。任务完成后会直接刷新并显示已识别组件，不需要关闭窗口再重新打开。

### 重要新增

- RDP 连接新增可选用户名和密码框，两项都可以留空。密码继续加密保存；新增“我了解风险，允许 Terma 把已保存密码交给 RDP 客户端”选项，默认关闭。勾选后 Windows 远程桌面使用当前 Windows 用户的临时凭据存储，FreeRDP 使用标准输入；密码不会进入命令行、临时 RDP 文件、URI 或日志。macOS Windows App 没有官方密码预填充接口，Terma 会优先改用已安装的 FreeRDP，否则明确提示用户。

- 桌面端更改数据路径模式或自定义路径时，会询问“迁移并重启”“仅切换并重启”或“取消”。选择迁移后会在后端停止、数据库关闭后复制并校验现有数据和 Terma 管理的密钥，再切换路径并重启；原目录保留用于回退，目标已有 data 或 .ssh 时不会覆盖。
- 新增统一凭据修复：终端、SFTP、单台健康检查、X11 与远程服务管理在 SSH 认证失败时会直接打开对应连接的凭据窗口，FTP 目录和操作使用独立账号密码窗口。新凭据会先测试再保存；批量检查只标出故障连接，不会连续弹出多个窗口。
- “快速打开服务器”和全局“快速打开”都支持直接输入 `用户名@主机:端口` 并按回车连接。未保存的目标会询问密码或私钥认证，省略用户名时会要求补充，省略端口时使用 22；临时连接可继续打开终端、SFTP 和受控 X11 图形终端，也可选择把目标填入新建 SSH 表单。
- 未保存的快速连接不会写入连接列表或工作区恢复；凭据可在当前浏览器会话的终端、SFTP 和 X11 间临时复用，关闭最后一个相关标签后自动失效。
- 临时连接的 X Server 管理器始终绑定当前终端，可查看 `sshd`、X11 转发和 `xauth/XQuartz` 状态，并提供远端组件的在线、离线、手动安装和卸载入口。

### 其他优化

- SFTP 工具栏的“打开终端”入口移到最前面，与终端工具栏最前方的 SFTP 入口保持对称，切换时更容易找到。
- 快速打开服务器弹窗加宽并降低最大高度，名称、IP/主机、端口、用户名与表头保持对齐；窗口较窄需要横向滚动时，右侧操作按钮固定可见。
- 数据存储设置的保存按钮与路径模式控件保持同一行和相同高度；空间不足时自动换到下一行并占满可用宽度。
- 桌面端收起左侧操作区后，可直接点击左上角的 Terma 图标重新展开，不需要先寻找其他入口。
- 终端顶部工具按钮在工作区较窄时支持横向滚动，并保留可见的细滚动条；也可使用鼠标滚轮及 Home、End、左右方向键浏览被遮挡的操作。
- 终端 X11 菜单中的受限、可信和关闭模式不再点击后立即结束操作；每项都会继续选择“当前终端生效”“新建终端”或“下次生效”。三种选择都会保存连接默认值：当前终端会保留屏幕内容并自动重连，新建终端不影响原标签，下次生效只保存并等待以后连接。
- 全局终端设置新增默认字体和默认字号。新连接和未单独调整显示的连接会跟随全局值，连接中单独设置过的字体、桌面字号或移动端字号继续优先使用自己的设置。
- X Server 管理器点击后立即显示加载状态并阻止重复操作；Linux 桌面探测、远程服务诊断和认证失败卡统一使用固定图标、正文与操作区布局，窄屏时操作自动换行且会明确标出正在探测的目标。
- 普通 SSH 连接的 X Server 管理页面可直接卸载远端 X11 组件，操作完成后会在原窗口重新探测并刷新状态。
- 设置操作区新增独立“缓存管理”入口并放在“关于”上方，可分别查看和清理 SFTP 下载、SFTP 上传、SFTP 拖出、更新安装包、组件安装残留和本机组件安装包；正在使用的任务和安装包会明确保留。

## v1.4.0

> 本次重点改善 SSH 连接、批量健康检查和大文件 SFTP 打开时的界面响应，并新增全局服务器快速入口。经常同时管理多台服务器、查看高输出终端或在程序内打开远程文件的用户建议升级。

### 重要修复

- 修复 SSH 连接或远端持续输出大量内容时，终端可能阻塞页面滚动和点击的问题；输出会按小批次渲染，并等待上一批解析完成后再继续。
- 修复“检查全部连接”执行期间页面卡顿且缺少状态反馈的问题；现在最多并行检查 4 台服务器，并在右上角持续显示总进度、正常数、异常数和刚完成的服务器。
- 修复 SFTP 打开较大文件时页面长时间无法操作的问题；文件改为流式读取和后台解析，右上角显示独立进度，可暂停、继续或取消，不会进入任务中心。

### 重要新增

- 工作区标题旁新增服务器快速入口，以单行列表显示名称、IP/主机、端口和用户名，可搜索、编辑或分别打开终端与 SFTP；双击服务器默认打开终端。

### 其他优化

- SFTP 程序内打开文件的默认上限从 5 MB 调整为 50 MB，超限和读取进度统一按 KB、MB、GB 显示，不再只显示原始字节数；已有旧版默认值会自动迁移，用户主动设置的新值保持不变。
- 终端与连接列表中的文件入口改用更明确的 SFTP 图标；终端编码按钮始终同时显示当前编码和图标。

## v1.3.5

> 本次优化本机浏览器与 Terma 桌面端之间的图形集成提示和授权流程。浏览器默认仍不能直接调用本机程序；可按需申请短时授权，也可在仅监听本机且不使用反向代理时主动开启本机直连自动授权。

### 重要新增

- 本机浏览器连接到正在运行的 Terma 桌面后端时，可向桌面端申请图形集成授权，用于 X Server 和系统 RDP、VNC、XDMCP 客户端；可选择 5、10、30、60 分钟、自定义 1 至 480 分钟，或仅限本次浏览器会话且最长 12 小时。授权需在桌面原生确认框中同意，同一时刻只处理一个浏览器申请，其他会话不能共享确认结果；授权可随时撤销，撤销、到期或退出登录会同时关闭由该授权打开的 X11 终端。
- 安全设置新增“本机直连浏览器自动使用桌面集成”开关，默认关闭。只有 Terma 本次实际仅监听回环地址、当前浏览器直接访问本机、已通过当前 Web 访问策略，并且未启用可信反向代理时才会生效；只开放 X Server 和系统远程客户端，不开放本地文件、更新或迁移能力。启用反向代理或改为局域网/通配监听后会自动失效，并在设置页说明原因。

### 其他修复

- 修正选择“仅非本机访问时校验密码”后，`127.0.0.1` 和 `localhost` 仍被要求登录的问题；认证策略改为三个互斥选项并移除含义重复的局域网密码复选框。真正的本机直连免登录，局域网、反代域名、代理转发头和外部 Host 继续要求认证。
- 修正直接访问 `/login` 会无视当前认证策略、始终显示登录页的问题；本机免登录、关闭 Web 认证或已有有效会话时会自动返回主界面，只有当前请求确实需要认证且尚未登录时才显示登录页。
- 修正同一桌面后端上的普通浏览器被误提示为“独立 Web/测试后端”的问题；现在会明确区分“浏览器尚未获得桌面集成授权”和真正的独立 Web 后端，并在 X Server 已运行时显示准确状态。
- 修正启用默认 X11 的 SSH 连接在浏览器授权被撤销后只显示“WebSocket 连接失败”的问题；普通终端会在握手前说明原因并自动降级为普通 SSH，明确从 X11 入口启动时则打开可选择授权时长的 X Server 窗口。X Server 已运行但当前浏览器未授权时，顶部状态图标改为橙色警告，不再显示为绿色就绪。
- 修正 XDMCP 工作区中的授权申请区域偏向页面左侧的问题；授权提示、时长选项和操作按钮现在与远端服务状态卡保持同一宽度，并适配窄屏换行。

## v1.3.4

> 本次重点修复 v1.3.3 中的 Web 认证、SSH 参数、配置加密、本机进程和凭据文件保护问题，并改善健康检查与离线安装稳定性。使用 Web/反向代理、旧版配置加密、外部目录私钥或 OpenSSH 调优参数的用户建议升级后按安全提示检查一次配置。

### 重要安全修复

- 修复设置 Web 密码或访问 Token 后，本机普通浏览器仍可能免登录，以及可信反向代理转发到回环地址时可能绕过认证的问题；同时加强 Host、Origin、协议和代理来源校验，阻止 DNS Rebinding 与伪造代理头绕过。Electron 桌面端改用每次启动随机生成的独立凭据。
- 修复端口占用处理接口可提交任意 PID 的问题；关闭程序前会重新确认 PID、端口、监听地址和当前占用者仍然一致，拒绝负数、进程组和已经变化的诊断结果。
- 修复 SSH 用户名和附加参数可能改变真实连接目标、调用本机辅助程序、转发宿主机凭据或读写本机文件的问题；系统 OpenSSH 改用结构化目标参数，附加参数只允许算法、压缩和超时等连接调优项。
- 修复私钥权限修复、连接保存和运行时读取可接受任意本地路径的问题；现在只接受 Terma 密钥目录或用户 `~/.ssh` 顶层的真实普通私钥，并拒绝目录、外部路径、软硬链接、公钥和配置文件。
- 配置加密升级到 v3：密码校验值与实际加密密钥完全分离；旧版 `tdenc:v1:`、`termaenc:v1:` 和 `termaenc:v2:` 会在输入原主密码后使用全新盐和密钥轮换。轮换完成后应重新生成备份并清理旧 v1 备份；旧副本曾泄露时还应轮换其中保存的实际凭据。
- 修复配置加密锁定时仍可导出完整迁移包，以及普通数据库恢复、旧快照、旧隧道或品牌迁移可能把明文或无法验证的密文重新写入已加密数据库的问题；敏感恢复和编辑操作现在必须先解锁，切换中断后也会保持安全状态并要求继续修复。
- Windows 数据目录、数据库、安全配置、快照、主机信任、临时恢复文件和 Terma 管理的 SSH 私钥会主动收紧 ACL；无法确认权限安全时停止启动、上传或密钥生成，并明确区分不支持 ACL 与权限不足。
- 临时管理员授权严格绑定连接、主机和操作范围；未登录的认证状态接口不再返回内部安全策略。全局登录保护可按部署环境配置或关闭，避免攻击者利用全局锁定持续影响合法登录。
- 更新加速线路的重定向只允许受信 HTTPS 地址；停止脚本改用当前实例随机生成的临时令牌请求退出，避免仅凭可猜测进程信息控制其他实例。

### 其他修复

- 修复运行中本地转发的健康检查会实际连接转发端口、从而触发一次远端请求的问题；现在只核对本地监听状态。单台和全部健康检查会显示连接名称、用户、主机、端口和具体失败原因。
- 修复 Debian/Ubuntu 本机离线安装中，远端已缓存全部依赖但下载清单为空时被误判为软件源缺包的问题；Terma 会直接使用远端缓存继续安装。
- 修复 Linux 和 macOS 将 IPv6 通配监听误识别为 IPv4，导致通过 `::1` 诊断时找不到实际占用进程的问题。

### 其他优化

- 收紧登录页和主工作区的内容安全策略，禁止执行新注入的内联脚本；终端、Ace 编辑器和 noVNC 继续通过受控资源与运行时安全标记正常加载。
- SSH 附加参数支持按行填写并直接标出具体行、选项、原因和处理建议；终端配置、跳板、保活、X11 和 OpenSSH 调优项统一收进默认折叠的“高级选项”，发现问题时自动展开。
- 安全设置新增精确 Host/反代域名配置、SSH 主机信任分页和全局登录保护选项，并补充 Nginx 与 Caddy 配置示例。
- 升级前已保存到外部目录或 `.ssh` 子目录的私钥连接会在列表和编辑页明确标记，并引导重新导入安全目录；Terma 不会自动移动或删除原文件。

## v1.3.3

> 本次更新重点修复 Linux 和 macOS 源码版启动、移动端工作区返回与文件上传、Linux 标签恢复和 macOS VNC 状态识别，并清理依赖安全风险。使用源码版、移动端文件上传或 macOS 远程桌面的用户建议升级。

### 重要修复

- 修复 Linux 和 macOS 源码版在 Node.js 版本过低、Electron 下载失败或后台进程提前退出时长时间没有界面和 URL 的问题；启动前会明确检查 Node.js 22+，自动识别常见本地工具链，Linux root 桌面会使用兼容的沙箱参数，失败时立即显示真实日志。启动与停止脚本现在按实际数据目录读写运行状态，也不会误停同机的其他 Terma 安装。
- 修复 Linux 桌面端首次启动时默认设置没有落盘，导致以后每次重启都被误判为首次运行并自动新增设置标签的问题；默认设置现在只写入一次，之后正常恢复原有标签。
- 修复移动端进入 Telnet、串口或其他工作区后可能没有返回入口的问题；返回按钮现在由工作区外壳统一提供，终端类页面会为它保留独立顶部空间，不再遮挡标题、连接状态或输出内容。移动端重启会保留原有标签，但先显示连接列表，不再自动进入上次打开的 Telnet 等页面。
- 修复移动端选择文件上传后，页面高度可能停留在文件选择器打开时的临时尺寸并出现大片空白的问题；返回页面后会分阶段恢复完整视口高度，清除浏览器误加在工作区外层的滚动偏移，同时保留内部内容的阅读位置。
- 修复 macOS 已开启远程管理或屏幕共享、VNC 端口实际可连接时，Terma 仍提示服务未开启的问题；探测现在会同时检查系统服务与实际监听端口。

### 其他优化

- 连接列表的健康检测图标移到运行状态旁，避免被终端、SFTP、转发等快捷操作遮挡。
- 更新存在已知安全问题的间接依赖，官方 npm 安全审计结果已清零。

## v1.3.2

> 本次更新修正终端调整字号后的历史滚动位置和程序重启后的工作区恢复，并完善连接列表、远程桌面互跳和工作区操作入口。阅读长输出、切换不同连接或继续上次工作时会更连贯。

### 重要修复

- 修复终端在历史内容中间放大或缩小字号后，画面跳到其他位置、滚动条显示已到底但下方仍有内容的问题；连续缩放会平滑合并处理，并同时校正当前内容行与滚动条位置，普通滚轮可以立即从当前位置继续滚动。
- 修复打开终端光标复制后只显示孤立取消按钮、没有操作提示的问题；提示现在直接显示在终端画面中，并会在选定起点后说明下一步操作，按 Esc 或提示条右侧按钮均可取消。
- 修复程序重启后设置页可能自动打开并覆盖原有标签的问题；启动恢复完成前不会再用临时页面改写已保存布局，原有标签和活动标签会正常恢复。
- 修复任务中心调整后的窗口尺寸在重启后恢复默认的问题；桌面端会记住宽高，双击重置后重新使用默认尺寸。

### 重要新增

- SSH 列表可双击名称直接打开终端，并在终端入口后增加 SFTP 快捷入口；其他连接列表可双击名称打开对应的远程桌面探测或管理界面。
- 远程桌面工作区新增远程桌面切换入口，只显示当前服务器关联的其他 RDP、VNC 或 XDMCP 连接；没有其他桌面时入口保留但不可点击。

### 其他优化

- 工作区窗口标题会显示当前资源地址和界面类型，便于在多个窗口间区分终端、SFTP 与远程桌面。
- 新打开的标签会插入当前活动标签之后，不再统一追加到标签栏末尾；分屏工作区会在当前窗格内保持相同顺序。
- 桌面终端工具栏改为紧凑纯图标布局，统一 X11 与编码图标，补充转发列表入口，并将“终端启动配置”简化为“终端配置”；移动端继续保留必要文字。
- 最近命令增加执行序号，并明确序号 1 表示最近一次执行。
- 工作区右上角的 X Server 服务入口改用无显示器外框的轨道 X 标识，并保持与相邻工具图标一致的视觉尺寸；展开操作区时继续显示 Terma 品牌文字，最窄布局下“添加 SSH”也会完整显示。

## v1.3.1

> 终端 Ctrl+滚轮现在直接调整字号，普通滚轮继续浏览终端历史。

### 重要修复

- 修正终端按住 Ctrl 滚动鼠标滚轮的行为：向上滚动放大字号，向下滚动缩小字号，不再先浏览历史内容。

### 其他优化

- 普通鼠标滚轮继续浏览终端历史，查看输出时不会受到字号快捷操作影响。

## v1.3.0

> 本次版本完成 Terma 品牌升级，并集中增强旧版数据迁移、Linux 远程桌面和日常操作稳定性。已有用户升级后可以保留并合并原有连接、工作区和密钥配置，建议升级前仍保留一份现有备份。

### 重要修复

- 修复 SSH 握手超时或握手前断开时重复弹出英文错误的问题；现在只显示一次中文失败提示，连接清理阶段的后续错误不会再冒泡到桌面主进程。

### 重要新增

- 产品由 TunnelDesk 更名为 Terma；桌面包、安装产物、项目主页和发布工作流统一使用新名称。
- 桌面版新增旧版数据迁移：会先识别程序实际使用的数据位置并创建完整备份，再合并连接、分组、转发、其他连接、工作区和密钥配置；遇到同名内容时会保留可识别副本，旧数据继续保留供回滚，避免升级后出现数据仍在磁盘却显示空列表。
- “导入导出”新增旧版数据迁移入口，迁移完成后会自动核对数据和密钥文件是否完整；项目目录、自定义数据目录或新旧目录同时已有内容时，会先交由用户确认，不会直接覆盖。
- VNC 新增桌面来源管理，可在物理桌面、XRDP 会话和 TigerVNC 独立虚拟桌面之间选择，并支持探测、安装、启停、卸载和来源失效后的重新应用。
- RDP、VNC 和 XDMCP 新增图形渲染诊断：可识别 XRDP 的 DRM/软件 OpenGL 回退、VNC 共享已有桌面或独立虚拟显示，以及 XDMCP 的远程 X11 限制；发现 Java GUI、JavaFX 或 OpenGL 白屏风险时会给出可直接复制的兼容启动命令。
- 远端管理操作新增临时管理员授权，可选择仅本次、10 分钟、30 分钟或本次程序运行期间复用；密码输入框可以随时显示或隐藏内容，授权信息不会保存到连接配置和任务日志。

### 其他优化

- 应用内更新、缓存和安装包识别统一切换到 Terma 仓库与产物名称，避免继续显示或复用旧项目的更新结果。
- Windows、Linux 和 macOS 使用新的 Terma 图标；macOS 图标进一步缩小主体并扩大透明安全区，在 Dock 和 Launchpad 中与相邻应用保持协调的视觉尺寸。
- 任务中心会保留失败标记和当前展开状态，可调整面板尺寸，并阻止重复提交仍在执行的操作；任务日志刷新时继续停留在最新内容。
- 内置 VNC 返回管理页后，可以重新进入当前桌面或直接关闭远端桌面，不需要重新创建连接。
- 终端按住 Ctrl 滚动鼠标滚轮可直接调整字号：向上滚动放大，向下滚动缩小；普通滚轮继续用于浏览终端历史。

## v1.2.1

> 本次版本集中改进远程桌面显示、转发异常处理和标签切换体验，并修复 macOS VNC、终端拖入及更新说明显示问题。建议 v1.2.0 用户升级。

### 重要修复

- 修复仅剩启动失败、重连中或待恢复转发时，“停止全部转发”错误提示没有运行项的问题；现在会刷新实际状态，并清理异常状态、残留进程和恢复标记，桌面托盘行为同步一致。
- 修复 macOS 系统屏幕共享在内置 VNC 中同时显示远端鼠标和本地光标的问题，自动模式会按远端平台选择合适的光标策略。
- 修复 macOS zsh 使用 `%` 提示符并经 Tab 补全切换目录后，拖入文件仍可能上传到主目录的问题。
- 修复由 SSH 生成的 RDP 连接不应用所选显示方式和尺寸的问题；现在仍不会复用 SSH 用户名，但会正确应用显示设置。

### 重要新增

- 远程桌面显示设置进一步完善：RDP 新增自动跟随窗口和常用至 8K 的固定分辨率预设；VNC 新增适应窗口、原始像素和服务器支持时跟随窗口；XDMCP 在 Linux 和 macOS 新增可调整窗口，并提供常用至 8K 的分辨率预设。
- VNC 新增自动、显示本地光标和隐藏本地光标三种鼠标模式，可在连接设置和工作区工具栏中切换。

### 其他优化

- 首页会分别显示运行中、重连中和启动失败数量；“正在转发”页会显示失败时间、具体原因，并可直接打开失败当天的系统日志。
- VNC 原有的 0-9 画质设置改为更直观的滑块，并说明画质、分辨率与带宽之间的关系。
- 关闭当前标签后，会返回同一工作区、同一分屏中上一个实际使用的标签，不再固定跳到相邻标签或标签栏末尾。
- “关于”页不再重复显示版本号，行内代码和代码块会使用跟随主题的背景，避免浅色主题下出现黑块。
- macOS 应用图标增加系统风格留白，在 Dock 和 Launchpad 中的视觉尺寸更加协调。

## v1.2.0

> 本次是一次大型功能更新，新增远程桌面、多协议连接、本地文件管理和工作区效率工具，并集中改善跨平台图形连接、文件传输与 SSH 安全体验。升级前建议先在“导入导出”中保存一份 TunnelDesk 配置备份。

### 重要修复

- SFTP 继续兼容使用“csh/tcsh”等登录 Shell 的服务器，远端文本和图片不再因 Shell 历史展开而打不开；Windows 原生拖出会同时等待文件读取与资源管理器确认，避免内容已经复制完成却长期停在 99%。
- 终端编码可在当前会话中直接切换 UTF-8、GBK、GB18030 等收发转码，不再重连终端或改写服务器的语言环境；C Shell 等非 POSIX 默认 Shell 的启动配置探测也会交给“/bin/sh”执行。
- macOS 终端的长中文行和滚动条布局不再遮挡末尾内容；从 Finder 或“open”命令启动桌面包时，即使窗口显示事件缺失，也会在页面加载完成后恢复主窗口。
- 日志查看默认定位到最新内容，加载更早记录时保持阅读位置，并跟随明暗主题；同一连接的终端标签全部关闭后，再次打开会从第一个编号开始。
- 通用弹窗会限制在当前可视高度内，正文在弹窗内部滚动，标题、关闭按钮和底部操作保持可见；点击弹窗外部不再误关闭。

### 重要新增

- 新增“其他连接”活动入口，集中管理 RDP、VNC、XDMCP、FTP/FTPS、Telnet 和串口；同一 IP 或主机地址的协议连接会归到同一服务器下，优先显示关联 SSH 名称，并可从 SSH 更多菜单直接打开已有连接。
- RDP、VNC 和 XDMCP 默认先进入探测与管理工作区，不会未经确认直接启动；可单独开启“快捷打开”，仅在客户端、远端服务和桌面条件均可用时自动连接。
- 新增内置 VNC 查看器，也可改用系统客户端。连接支持全屏并保持远端光标可见、保存密码、密码错误后重新输入、明确选择无密码服务，以及双向剪贴板；关联 SSH 后可使用 UTF-8 辅助通道同步 Linux 和 macOS 中文剪贴板。
- Windows 桌面包新增内置 X Server，Linux 和 macOS 可使用系统图形组件；X11、XDMCP、RDP 和 VNC 会探测本机客户端、远端服务、端口、桌面会话与防火墙，并给出可执行的处理入口。
- 新增 Linux 桌面管理，可识别已安装桌面与各协议实际使用的桌面，支持常见 Linux 发行版上的 XFCE、GNOME、KDE Plasma、MATE、Cinnamon 和 LXQt 安装、卸载及状态复查。
- 远端组件统一提供在线安装、本机准备后离线安装、使用远端缓存和手动说明；支持安装的组件同时提供卸载，支持开启的服务同时提供关闭。长任务统一进入任务中心，显示阶段、进度、最新日志和失败原因。
- 新增一次性远端管理员授权，可临时输入管理员账号密码或选择密钥、SSH Agent；授权仅用于当前管理操作，完成后立即失效，不写入连接配置和任务日志。
- 终端和 SFTP 可新建多个“本地文件”标签，并在当前窗格或上下左右分屏打开；本地文件支持搜索、面包屑、分页、新建、编辑、重命名、删除、权限和批量操作，可直接与 SFTP、终端互相拖动并沿用同名处理与任务中心。
- 标签可组合为多个独立工作区，支持选择、排序、重命名、解散和递归分屏；命名工作区可完整保存并从快速面板搜索恢复。
- 新增全局快速面板、命令片段、安全终端广播、后台命令提醒、标签输出状态、最近关闭标签恢复、收藏和固定标签。
- 新增 SSH 主机信任管理，首次连接可选择仅本次信任或永久信任，主机密钥变化时会显示新旧指纹；SSH 连接同时支持加密私钥口令、SSH Agent、超时、保活和单级跳板机。
- 新增 Ed25519 密钥向导，可生成带可选口令的密钥、导出公钥并在确认后追加部署到服务器。
- 桌面端 SFTP 可用系统程序、VS Code 或自定义编辑器修改远端文件并自动回传；新增本地与远端目录比较和上传、下载、双向同步。

### 其他优化

- 终端、命令和端口转发默认优先使用内置 SSH，遇到仅系统 OpenSSH 支持的参数、私钥或配置时自动回退；SFTP 与其他入口共用主机信任记录。
- 工作区标题栏的任务中心扩展到远端组件、桌面管理和目录同步；任务日志刷新时保持展开，停留底部时自动跟随，手动上翻后保留阅读位置。
- 连接、转发、批量命令、日志、设置和导入导出统一使用紧凑操作栏；工作区标签使用图标区分终端、SFTP 和远程桌面，RDP、VNC、XDMCP 以显示器内的 R、V、X 主题徽标区分，并用跟随主题的强调状态标出当前标签。
- SFTP 列表使用独立滚动区和固定底部分页栏，下方仍有文件时显示滚动提示；普通单击只定位项目，只有复选框、Ctrl/Cmd 或 Shift 才进入批量选择。
- 所有弹出菜单、右键菜单和二级菜单统一按图标列与文字列左对齐；桌面端二级菜单在一级菜单旁展开，移动端提供返回上一级。
- 远程探测工作区、安装说明和新建连接表单统一按钮尺寸、对齐、滚动和窄屏换行规则，操作区收窄时不再截断主按钮或状态文字。
- 多条页面通知会按出现顺序向下排列，各自独立关闭和计时；通知结束后其余提示平滑上移，并自动避让任务中心的悬浮进度卡。
- “关于”页的“最近版本更新内容”支持安全 Markdown 显示，可正确呈现标题、列表、引用、粗体、代码块和链接。

## v1.1.8

> 本次版本没有新增功能，只优化现有操作体验。当前版本使用正常可以不升级；如果希望使用更顺手的 SSH 复制、终端重连和日志显示，可以选择升级。

### 其他优化

- SSH 连接菜单新增复制，可完整复制登录、终端、SFTP 和转发配置，并按“（copy1）”“（copy2）”自动递增命名。
- 终端断开后可按 Enter 直接重新连接；调整字号、查看最近命令、重连和启停转发后会自动恢复终端输入焦点。
- 同一终端标签重连时继续写入原日志，不再重复生成日志文件；日志列表会完整显示日期和时间。

## v1.1.7

### 重要修复

- 修复 Windows 双击 `start.bat` 启动后，程序可能只出现在任务栏、没有自动切到前台的问题。

### 重要新增

- 测试 SSH 后可自动识别服务器的默认 Shell，以及 Bash、Zsh、PowerShell、Python、Node、tmux 等可用环境；也可以自定义程序路径、启动参数和工作目录。
- 终端内调整启动方式时默认只临时使用；需要作为今后的默认值时，可勾选同时保存到 SSH 连接。
- 选择启动方式后，可在本终端、新标签或上、下、左、右新分屏中打开。使用新标签或分屏时，原终端会继续运行，不会被重新连接。
- 本机文件或文件夹可以直接拖入终端当前目录，也可把 SFTP 远端项目拖到终端或同主机、跨主机的另一个 SFTP 标签；遇到同名项目可选择覆盖、按 `(1)`、`(2)` 自动改名或取消。
- 全局终端设置新增跟随主题、黑色、白色和自定义背景颜色，并会自动调整文字颜色，保证内容清晰可见。

### 其他优化

- SSH 连接的排序值相同时改为按名称升序排列，更容易找到连接。
- 左侧每个操作区都可以单独固定；取消固定后，点击工作区会自动收起，首次使用时会显示一次引导。
- 桌面工作区的标题栏、标签栏和左侧活动栏都可拖动调整并自动记住；终端四周留白、分屏间隔和滚动条同步收窄，可显示更多内容。
- 全局终端设置按外观、鼠标与链接、选择与粘贴分类显示，并适配窄窗口，不再出现文字或按钮被截断。
- 桌面窗口顶部不再显示重复的“开始”菜单栏，任务栏托盘图标的右键快捷菜单继续保留。
- 终端工具栏的“启动”入口在空间充足时保持图标和文字完整显示；复制标签使用独立的副本编号，之后新建的普通终端仍按正常顺序编号。
- 终端启动配置窗口会随可用屏幕高度自动收缩，标题和底部操作始终可见，中间配置内容可独立滚动，小窗口下不会再截断操作按钮。
- SFTP 编辑器只在标准 `.json` 文件中显示 JSON 格式化；普通文本和 `.json5` 不会误用标准 JSON 格式化。
- SFTP 上传、下载、复制等任务统一移到工作区标题栏的全局任务中心；按钮底部会持续显示总进度，各分屏不再重复占用空间。标题栏下方默认显示一张悬浮进度卡，可关闭当前任务提示或永久静默，并可从 SFTP 全局设置重新开启。

## v1.1.6

### 重要修复

- 修复手动升级到最新版后，“关于”页仍显示上次下载失败的问题。
- 修复程序重启后，已经中断的 SFTP 任务仍停留在“运行中”的问题。
- 修复 SFTP 符号链接大小判断错误，以及文件保存后无法继续预览差异的问题。
- 修复命令、凭据等重要弹窗误点外部区域就关闭，导致已填写内容丢失的问题。

### 重要新增

- 桌面应用支持把本机文件或文件夹拖入 SFTP 上传，也可把远端项目拖到系统文件管理器；桌面应用和 Web 桌面浏览器都支持拖到另一台 SFTP 标签进行跨主机复制。Linux 原生拖放不可用时会提示并切换兼容方式。
- 桌面工作区支持像 Xshell 一样拖动标签分屏，可在任一区块继续上下左右拆分、拖回合并，并调整各区块比例。
- 标签右键可直接复制；同一连接可打开多个独立终端或 SFTP 标签，每个 SFTP 标签分别保留目录和浏览记录。操作按钮的位置可按终端、SFTP 和是否分屏分别设置。
- 程序内更新会在下载前比较 GitHub 直连和多条加速线路，优先选择较快线路，失败时自动换线，下载完成后继续校验文件。
- SFTP 上传、下载、复制和删除等任务统一显示悬浮进度，点击可打开任务列表；上传与下载可暂停、继续或停止。
- SFTP 多选可分别下载或打包下载；桌面端自动保存到系统下载目录或自选目录，浏览器和手机保存到当前设备。手动断开后继续操作会自动重连。
- SFTP 路径栏新增前进、后退、上一级、可点击或手动输入的面包屑和按需搜索；全局设置可管理打开上限、回收站和下载目录，文本编辑器新增语法高亮、自动换行、JSON 格式化和图片预览。
- 终端新增全局设置，可管理链接识别、选择复制、鼠标操作和多行粘贴；手机端新增光标复制和会话复制，桌面与手机字号分别保存。
- 通用设置新增缓存清理和恢复上次未关闭的标签，重启后可继续使用原来的工作区。

## v1.1.5

### 重要修复

- 修复手机工作区点击输入框、软键盘弹出时突然返回操作区的问题；SFTP 搜索、批量执行、添加 SSH 和其他页面现在都会留在当前工作区，同时避免输入框被浏览器自动放大。
- 修复窄屏桌面端终端按钮显示不全、窗口轻微缩放时按钮左右跳动的问题；空间不足时连接状态和操作按钮会分成两行并始终靠左，再窄时会隐藏普通按钮文字，但编码、字体和全部图标入口仍然可见。
- 修复手机终端顶部连接状态区域被错误拉高、留下大片空白的问题；返回、连接状态和延迟现在会按内容紧凑显示。
- 优化手机端终端字体设置，菜单不再占满屏幕，超出内容可滚动且关闭入口固定可见。
- 修复工作区标签过早省略常用短标题、短标签与关闭按钮之间空白过多的问题；标签宽度会跟随内容自动收紧，同样空间可以显示更多标签，“主机名 · 终端 #N”等常见标题仍会优先完整显示，超长标题可悬停查看完整标签名和连接地址。
- 修复没有收藏常用目录时，SFTP 顶部操作区可能被拉成大块空白的问题；无论窗口宽度和显示缩放如何变化，操作栏都会按内容紧凑排列，窄屏也不会再把空收藏说明挤成竖排。
- 修复手动收起 SSH 连接分组后，几秒钟又被后台刷新自动展开的问题；折叠状态会持续保留，只有再次点击分组或主动打开其中的连接时才会展开。
- 欢迎页原来的“转发成功 / 失败”只代表本次启动时的恢复结果，运行期间不会变化；现改为当前“运行中 / 异常”数量，手动启停或后台状态变化后会自动更新。

### 重要新增

- 工作区标签支持按下后直接拖动排序，不需要等待较长的长按时间；松手后自动保存顺序，拖到标签栏两侧时会自动滚动。标签栏不再显示挤占空间的原生滚动条，内容较多时可用左右箭头或鼠标滚轮浏览。

## v1.1.4

### 重要修复

- 缩短终端逐字输入和命令回显的等待时间，网络状况正常时操作会更跟手。
- 修复非 UTF-8 终端日志可能出现乱码，以及已用退格删除的旧字符仍残留在日志中的问题；日志内容现在更接近终端实际显示。
- 修复桌面端切换暗色主题后，窗口顶部区域仍可能保持亮色的问题。
- 修复终端工具栏在较窄工作区内容易拥挤或难以访问全部操作的问题；空间不足时会压缩文字并保留图标按钮。
- 修复滚动 SSH 连接列表时，悬浮分组标题上方会露出底层连接内容的问题。

### 重要新增

- 终端状态栏新增实时交互延迟，显示从输入发送到远端首次返回内容的时间，并可在通用设置中关闭；关闭后不会进行延迟采样。
- SFTP 文件夹大小支持按需读取，点击目录的大小区域即可递归计算实际文件总字节数；读取失败时会明确提示，不会显示不完整结果。
- 桌面端左侧操作区支持收起并记住状态，再次点击当前活动栏入口即可展开或收起，为终端和 SFTP 留出更大的工作区。

### 其他优化

- SFTP 会暂存最近访问的目录、滚动位置和选中状态，返回目录时先立即恢复内容，再在后台静默确认变化；长期不用和超出上限的缓存会自动清理。
- SSH 连接分组标题会在资源列表滚动时保持在顶部，长列表中更容易确认当前分组。
- 终端状态文字被省略时可悬停查看完整连接地址和状态；桌面工作区、标签栏、终端工具栏和连接操作按钮调整为更紧凑稳定的布局。

## v1.1.3

### 重要修复

- Windows 安装版升级完成并启动新版本后，会自动删除之前下载的安装包，避免安装文件继续占用磁盘空间；便携版文件仍会保留，方便手动替换。
- 升级动态代理的底层组件，解决旧组件长期不维护带来的安全隐患，并保持 IPv4、域名和 IPv6 访问正常。
- 加强网页端登录保护：连续输错密码会暂时锁定，过期登录会自动清理；通过反向代理访问时也能设置可信地址和浏览器安全策略。
- 恢复数据库时只需上传一次备份，大型备份占用的内存更少；损坏的备份会在覆盖当前数据前被拦截。
- 查看和搜索大型日志时不再一次加载整个文件，减少页面卡顿；日志过大或保存过久时会自动整理。

### 重要新增

- 安全设置新增会话管理，可调整登录有效期、最多保留多少个登录会话，以及多久清理一次过期会话。
- 日志设置新增保留天数、单个日志大小、总容量和备份数量，也可以立即清理旧日志。
- 终端字体新增行距和粗细选择，并可一键恢复默认；每个连接会记住自己的字体设置。
- 更新页面现在会按当前系统、处理器和安装类型自动选择正确的下载文件，并显示下载进度和更新内容。安装版可以直接打开安装包，便携版会引导先关闭旧版本再手动替换；两种版本都支持打开下载目录和重新下载，同时保留“查看 Release”入口。
- 更新页面会按新到旧显示最近两个正式版本的更新内容。也可以忽略当前版本的提示弹窗和红点，不影响在关于页面手动升级；以后出现更高版本时会自动恢复提醒。

## v1.1.2

### 重要修复

- 修复远端目录包含 GBK、GB18030 等非 UTF-8 文件名时，执行 `ls` 会让浏览器因无效 WebSocket 文本帧断开终端的问题；SSH 原始输出改用二进制帧传输，乱码不再导致会话关闭。
- 修复桌面端和移动端长按拖动分组约两秒后被后台连接列表轮询重绘打断的问题；拖动期间暂停列表渲染，真正松手或取消后再补刷新。
- 修复移动端拖动分组时 `pointercancel` 被误判为松手并提前提示“顺序已保存”的问题；现在仅真正松手才保存，手势取消会恢复原顺序，并移除会被浏览器拦截的振动调用。
- 修复密码 SSH 测试在不可达、握手前断开或超时时可能把 `ssh2` 错误扩散到 Electron 主进程并影响后续测试的问题。
- SFTP 文件命令统一交给远端 POSIX `sh` 执行，不再因账户使用 csh/tcsh 而出现 `Ambiguous output redirect`。

### 重要新增

- SFTP 新增独立的文件名编码切换并按连接持久化，支持 UTF-8、GB18030/GBK、Big5、Shift_JIS、EUC-KR 和 ISO-8859-1；非 UTF-8 路径会还原为远端原始字节后再执行文件操作。
- SFTP 文本编辑器支持编码识别、手动切换和按连接保存默认值；覆盖 UTF-8、UTF-8 BOM、GB18030/GBK、Big5、Shift_JIS、EUC-KR、ISO-8859-1，无法用目标编码表示的字符会阻止保存。
- 终端和 SFTP 新增同连接双向跳转；SFTP 支持跨主机流式复制文件或目录，数据不经过浏览器和本机临时文件，跨主机移动仍保持禁用。
- 终端新增独立的编码和字体快捷菜单，选择后自动保存、立即应用并重新聚焦；编码切换不会中断 SSH，Ctrl + 鼠标滚轮可即时调整并保存字号。
- SSH 连接分组新增持久化排序：桌面和移动端均可长按拖动，支持边缘自动滚动，并提供上移/下移作为触屏、键盘和无障碍回退。
- SSH 连接列表支持右键分组或通过分组“更多”菜单重命名，触屏和键盘操作同样可达，操作前自动创建配置快照。
- 数据库恢复前统一显示连接凭据确认窗口；纯密码、纯私钥和混合数据库均可重新绑定私钥、保留或清除备份密码，并设置新 SSH 密码。
- SSH 连接新增持久化排序值，现有和新建连接默认 1；同组内数值越小越靠前，相同值按添加时间和 ID 稳定排列，导入和旧备份会自动补齐。
- 新增 SSH 连接表单增加“保存并清空”，方便连续添加多台服务器。

### 其他优化

- 下载普通数据库备份前明确选择是否包含 SSH 密码，默认推荐不包含；加密迁移包下载前同步提示其包含加密凭据和解锁元数据。
- `start.bat` 与 `start.sh` 会记录依赖清单指纹，`package.json`、`package-lock.json` 变化或安装不完整时自动执行 `npm install --include=dev`。
- 终端与批量命令改用共享的严格 WebSocket 帧解析器，限制帧、消息和缓冲区大小，拒绝非法客户端帧并完整校验协议边界。
- 优化高频 I/O 和连接列表：消除连接及转发的 N+1 查询，SFTP 任务状态防抖并原子持久化，终端、批量命令及系统日志改用有界缓冲异步追加。

## v1.1.1

### 优化

- 根据 v1.1.0 发布后的真实设备反馈继续优化移动端布局、SFTP 任务管理和远端文件操作体验。
- 导入导出操作区重新划分为“SSH config 导入导出”“数据库导入导出”和“配置快照”，避免连接配置与整库迁移混在同一入口。
- 数据库恢复和 SSH config 导入新增连接级私钥绑定：显示原密钥名称，可从当前密钥目录或用户 `~/.ssh` 选择，也可上传任意文件名私钥；支持勾选连接、测试连通性和分批暂存。
- 桌面数据路径、开机启动、托盘行为和启动通知并入“设置 > 启动与运行”；应用菜单移除设置入口，托盘菜单移除设置与数据库备份重复入口。
- 修复 `start.bat` / `start.sh` 选择桌面端后丢失 `--host`、`--port` 等启动参数的问题，桌面内置 Web 服务现在会使用命令行显式传入的监听配置。
- SSH 连接列表新增批量管理模式：支持单选、按搜索结果全选、批量删除，以及统一修改分组、SSH 端口、密码或私钥；端口或凭据变更会先停止相关转发，所有批量操作前自动创建配置快照。
- 转发规则列表完善全选与半选状态同步，并在批量删除按钮中显示已选数量。
- “关于 TunnelDesk”只显示项目作者名称，不再展示发布维护者邮箱。
- SSH config 导入和数据库恢复不再自动采用同名私钥；引用私钥的连接可显式选择、测试并暂存绑定，也可保持未绑定继续处理。数据库恢复会清除未绑定连接的旧机器私钥路径，原文件名只用于提示和“选择原同名”辅助操作。
- 设置活动栏重组为通用设置、安全设置、通知设置、启动与运行和关于：数据存储、桌面端行为与 SFTP 回收站归入通用设置，Web 认证、密码、Token 与配置加密归入安全设置，移除空置的高级设置入口。
- Web/Termux 数据路径支持在通用设置中浏览服务器绝对目录、迁移数据并自动重启；Windows 可切换所有可访问盘符，macOS/Linux 可从根目录浏览。远程管理仅在 Web 密码认证生效并已登录时开放，关闭局域网密码后自动限制为本机操作。
- 修复 Windows 私钥路径在绑定窗口和批量凭据设置中被重复转义的问题；下拉框现在保留真实反斜杠路径，可正常测试、暂存和应用私钥。
- SSH config 导入和数据库恢复允许部分或全部连接不绑定私钥：未绑定连接可直接保存，数据库恢复会清除失效的旧路径，之后可在连接设置中补充。
- 修复数据库恢复替换文件后未重新打开全局句柄而出现 `database is not open` 的问题；恢复成功后后端立即重开数据库，前端自动刷新连接、模板和安全状态，失败时自动回滚原数据库与安全配置。
- 修复在已开启配置加密的环境恢复未加密迁移包时可能残留旧加密状态的问题；迁移包现在会完整同步启用或关闭状态，普通 `.db` 恢复仍保留当前安全设置。

## v1.1.0

### 优化

- SFTP 文件列表新增“权限 / 所有者”信息列，修正宽屏表头错位与窄屏留白；空间不足时优先保留大小和修改时间，用户组继续保留在悬停详情和权限编辑中。
- SFTP 同目录刷新改为保留现有内容的后台同步：新建、重命名、删除、权限修改及手动刷新不再先清空列表，刷新后恢复勾选项、当前条目和工作区滚动位置；读取失败时保留旧列表并提示错误。
- 上传、复制、移动、压缩和解压后台任务完成后自动静默同步当前连接的目录，不再要求用户从任务列表手动刷新；同步期间只显示轻量状态，不阻断继续查看文件。
- SFTP 任务抽屉缩小字号、间距和按钮，只展示进行中、暂停与失败任务；已完成和已取消任务统一移入“历史记录”，清空历史不会删除失败记录。
- 高级设置新增默认关闭的 SFTP 回收站开关；启用后删除会移动到远端用户主目录下 TunnelDesk 专用回收站，可查看、恢复、永久删除和清空，恢复时不会覆盖原路径上的同名项目。
- 数据库恢复缺失私钥时不再只显示错误通知，改为弹窗去重列出缺失文件并引导上传，补齐后继续恢复。
- 移动端底部导航改为七个等宽纯图标入口，不再显示可能被窄屏截断的文字；完整名称继续通过 `title` 和 `aria-label` 提供。

## v1.0.9

### 修复与优化

- “设置 > 启动与运行”新增 Web 监听配置：可多选本机、全部 IPv4 网卡和具体网卡 IP，设置手动端口并检查占用；保存作为下次启动配置，不会中断当前服务。
- Web 服务支持多地址原子监听和端口自动回退：任一地址冲突时整组改试后续端口，最多 20 次；实际端口写回 `runtime-settings.json`，`web.json` 记录请求值、实际值、回退次数和 LAN 地址。
- 启动与运行页新增可点击的本机/LAN 实际访问地址，区分已保存配置和当前实际监听结果；显式局域网 IP 与全网卡监听均遵循 Web 密码策略。
- 重复启动脚本会保留已有实例的状态文件：桌面版唤起已有窗口，无界面服务明确提示正在运行。Git Bash/MSYS 通过 PowerShell 正确识别 Windows 进程。
- 优化 SFTP 文件列表：远程路径只保留一条 sticky 面包屑，根目录显示为中文“根目录”，不再同时显示原始路径或出现 `//Users/...`。
- SFTP 多选后在面包屑下方显示批量复制、移动、按需解压和删除操作；文件行压缩为约 42px 的单行布局，常用按钮会按工作区实际宽度逐级收进“更多”，原有右键菜单继续可用。
- SFTP 新增单个文件、单个目录和同目录多选压缩：一次生成一个 `.tar.gz` 后台任务，临时归档完成后再移动到目标名称，避免半成品和意外覆盖。
- SFTP 新增单项/多项权限设置：三位八进制输入与所有者、用户组、公共读写执行复选框双向同步，目录可递归应用；所有者/用户组修改不自动使用 sudo，符号链接和根目录递归会被拒绝。
- 修复 macOS 修改 SFTP 权限时报 `chmod: --: No such file or directory`：远端命令兼容 Linux 与 macOS/BSD，并对以 `-` 开头的相对路径安全处理；权限弹窗会立即显示执行中状态，等待远端真实完成，失败时保留弹窗和错误信息。
- SFTP 面包屑下方新增跟随滚动的目录操作栏，常驻收藏、新建目录、新建文件和上传；只有当前连接存在复制/移动队列时才显示粘贴与取消，新建空文件不会覆盖已有目标。
- 设置和导入导出活动栏使用各自独立、固定纵向单列的操作区：设置提供五个设置项目，导入导出提供导入配置（含导入结果）、导出与备份和配置快照三个入口；点击项目后工作区只显示选中的子页面，不再滚动长页面、混入其他活动栏操作或在设置工作区重复显示分类菜单。移动端先显示操作区，选择项目后再进入对应工作区。
- 导入结果并入导入配置页，活动栏图标统一按控件中心线对齐，避免入口之间出现上下偏移。
- 发现新版本时，在设置活动栏与关于入口显示红点；打开关于后只在本次程序会话隐藏，下次启动若仍有新版本会再次显示。
- 统一 GitHub Release 和 Actions 产物命名：Windows、Linux、macOS 与源码包均明确写出系统、CPU 架构和安装类型；macOS 同时区分 x64/arm64，Windows 区分安装版/便携版，源码包标记 `noarch`，上传前会自动校验名称。
- 修复程序升级后短时间复用旧更新缓存，导致“关于”页仍显示旧当前版本的问题；GitHub Release 数据继续缓存，本机版本改为始终按当前程序重新计算。
- 修复桌面端执行本地关闭后 Electron 进程未退出、健康监控继续访问已关闭数据库的问题；关闭流程会等待后台监控停止后再释放数据库和单实例锁。

## v1.0.8

### 修复与优化

- 修复桌面安装包把数据库和密钥写进应用目录的问题：Windows 安装版、macOS 与 Linux 桌面包统一使用系统用户数据目录，Windows 绿色便携版使用便携 exe 所在目录，源码开发继续使用项目目录；旧版应用目录数据会在后端启动前安全迁移且保留原文件，避免覆盖安装或替换 `.app` 后再次丢失配置。
- 修复桌面终端错误显示移动端“返回”按钮的问题；按钮样式不再被全局 Lucide 图标按钮规则覆盖，移动端返回资源列表的交互保持不变。
- SFTP 大目录增加服务端分页、搜索、排序和短时目录快照缓存，翻页不再重复建立 SSH 连接并全量传回/渲染所有条目；刷新可强制更新快照，写操作会使对应缓存失效。
- 修复 SFTP 在 `/` 根目录拼接子路径、从一级绝对路径返回上级目录时错误变成相对路径的问题。
- 新增 GitHub Releases 自动更新检查：启动后后台检查最新正式版本并缓存结果，发现新版本时只通知一次；设置页“关于”可查看当前/最新版本、手动强制检查并打开 Release 页面，不会自动下载安装。

## v1.0.7

### 修复与优化

- 项目正式采用 GNU General Public License v3.0，根目录与桌面安装包均携带完整 `LICENSE`，npm 项目元数据声明 `GPL-3.0-only`；设置页新增“关于 TunnelDesk”，可直接查看当前版本、GitHub 源码和随程序提供的许可正文。
- 修复 Windows 开启“静默到托盘”后手动启动也直接进入后台的问题；现改为仅开机自动启动时静默，双击程序、快捷方式、`start.bat` 以及设置保存后的重启都会打开主界面。
- 修复 macOS 桌面包 PTY 启动失败导致方向键和 Delete 异常的问题；打包和运行时双重校正 `spawn-helper` 权限，本地 PTY 仍失败时继续尝试内置 SSH 远程 PTY，最后才回退普通终端。
- 优化 macOS 托盘图标尺寸，按状态栏常用尺寸显示，避免原始应用图标在菜单栏中过大。
- 修复 macOS DMG、ZIP 和 Dock 显示 Electron 默认图标的问题；应用包改用 TunnelDesk ICNS，并在发布前校验 `CFBundleIconFile` 与实际图标资源。
- 修复 Windows 私钥权限检查把路径中的 `Users` 误判为宽松 ACL，并避免显示 `icacls` 本地编码乱码；用户 `~/.ssh` 密钥仍可直接使用，上传的新密钥继续保存到项目 `.ssh`。
- 新增 SSH 密码登录支持，终端、SFTP、批量命令和转发共用同一认证配置；密码不会通过连接列表 API 回传，编辑时留空表示保持原密码。
- SSH 连接表单根据私钥或密码登录方式完整隐藏无关认证控件，保存时不再混入另一种登录方式的字段。
- Windows 双击 `start.bat` 启动桌面端后不再保留显示 npm/Electron 输出的 CMD 窗口，相关输出改写入日志文件。
- 修复程序启动或新浏览器首次访问时重新弹出历史通知的问题，历史记录保留但不会被当作新通知回放。
- 修复 macOS SFTP 进入非空目录却显示为空的问题；目录枚举改用跨 Linux、Termux 与 macOS 的 `find`/`stat` 兼容实现。
- 优化 SFTP 文件浏览：双击文件夹直接进入，路径面包屑、搜索和上级/刷新操作跟随工作区滚动；所有普通文件均提供“以文本打开”，不再按扩展名隐藏入口，同时保留 512 KB、严格 UTF-8 和二进制保护。

## v1.0.6

### 优化

- Windows 客户端和 Web 终端新增项目内右键菜单，支持复制选中、复制全部输出、粘贴、全选、清屏、滚到底部、字体缩放和重新连接。
- 统一桌面、Web 和移动端文字按钮的图标尺寸与垂直基线，字体缩放按钮改用更清晰的加减图标。

## v1.0.5

### 新增与优化

- 前端 SFTP 功能已从主 `app.js` 拆分为独立的 `public/app-sftp.js`，降低主脚本体积；保持现有原生静态页面、SSH 后端及 Termux/Web/桌面端兼容方式。
- Web 前端已进一步按工作区、设置、正在转发、批量命令、日志、连接、终端、转发和导入导出等职责完成拆分，主 `app.js` 仅保留共享状态、刷新和启动入口。
- 工作区标签新增右键菜单，支持关闭当前、其他、右侧或全部标签，并在关闭会话标签时清理终端或批量命令连接。
- 移动端终端新增底部命令输入栏，快捷键默认收起并以两行横向区域展示；软键盘和屏幕尺寸变化后保留终端滚动位置。
- 连接、转发、SFTP、日志、批量命令和设置等页面统一加载、空数据与错误状态展示。
- 设置页重新整理为基础设置、通知设置、高级设置、启动与运行四个区域。
- SFTP 补齐脚本、配置、代码、日志、压缩包、图片、数据和文档图标，并完善按服务器收藏常用目录与路径面包屑导航。
- SFTP 空任务区压缩为单行状态；上传/下载任务增加实时/平均速度、百分比、失败原因、暂停、继续、失败重试和取消。
- SFTP 在线编辑限制为 512 KB 文本文件，增加大小/行数统计、Tab 缩进、`Ctrl+S`、未保存关闭提醒，并拒绝二进制文件。
- 桌面端终端快捷键调整为稳定分组布局，修复方向键和 Ctrl 按钮挤压重叠。

- 启动完成后汇总 Web 地址、LAN 地址、自动转发结果和日志入口；重复打开桌面端会拉起已有窗口并显示运行提示。
- 导入、数据库恢复和批量应用转发模板前自动生成配置快照，导入导出页可管理最近 20 个版本并回滚。
- 批量命令结果支持导出 `.txt` 或 `.json`，包含服务器、命令、开始/结束时间、耗时、退出码和输出。
- 连接健康检查增加 30 秒缓存，连接或转发发生配置、启停变化时立即失效，手动检查始终强制刷新。
- 首次运行内置 MySQL、Redis、Memcached、Web、SSH 和 SOCKS5 常用模板。
- Web UI 完成第一轮视觉系统收口，统一按钮、输入框、选择框、复选框、文件选择、工具栏、列表、分页、弹窗、焦点态和亮暗主题；移动端控件增加触控高度并避免横向溢出。
- 文件上传入口改为统一中文文件选择控件；修复刷新后恢复设置标签时工作区内容为空。
- 活动栏、移动底栏和高频操作接入离线 Lucide 图标，连接与转发低频操作收进更多菜单；正在转发增加运行和异常汇总。
- SFTP 文件类型改用图标与扩展名小标，任务列表改为折叠抽屉；设置增加分类导航，导入导出重新分区，批量命令显示目标数量。
- 移动端自定义弹窗改为底部操作面板，长表单保存区保持可触达；新增 `npm run ui:smoke` 检查桌面/移动页面运行时错误和溢出。
- 修复图标自动刷新监听全部 DOM 变化造成的页面卡死，并通过资源版本标识和禁止缓存避免浏览器继续加载旧脚本。
- 动态图标改为直接输出 SVG，消除首次进入页面时延迟出现和自动刷新时闪烁；移动端更多菜单支持点击遮罩或关闭按钮收起，桌面端滚动时自动收起。

## v1.0.4

### 优化

- SFTP 文件/文件夹操作按钮改为在条目下方内联展开：点击条目选中后即在该行下方显示下载、预览、复制、移动、重命名、解压、压缩、删除等操作；桌面端鼠标悬停也会显示，不再需要回到顶部操作区，移动端单手操作更顺手。
- SFTP 下载改为流式传输：后端通过 SSH `cat` 直接把远程文件以流的方式回写到 HTTP 响应，不再先把整个文件读进内存，也去掉了原 60 秒超时，避免大文件下载到一半超时失败或没有反应；前端在没有总长度时会显示已下载字节数。
- SFTP 下载改为后台任务并纳入任务列表显示进度：先 ssh 下载到本机 `data/downloads/` 临时文件，完成后可在任务列表点「保存」触发浏览器保存；支持暂停、继续、取消和删除单条任务，暂停/失败后可断点续传（用 `tail -c +N` 跳过已下载字节继续写入临时文件）。
- SFTP 上传任务支持暂停、继续、取消和删除单条任务：暂停后保留本机临时文件和已传偏移，继续时用 `cat >> remote` 追加并从本地偏移处继续读取；任务列表为本机写入进度展示百分比。
- SFTP 任务列表统一显示进度条、已传/总大小、状态徽标（执行中/已暂停/完成/失败/已取消）和对应操作按钮。
- 后台自动刷新增强焦点和滚动保护：刷新连接列表、正在转发和设置页时会保留当前输入值、选区和滚动位置，减少输入中被打断或列表跳动。
- 本地转发入口会按监听地址和当前 Web 访问来源生成：监听 `0.0.0.0` 时局域网访问会显示 LAN 地址；监听 `127.0.0.1` 时会提示仅本机可访问，避免复制出实际打不开的局域网地址。
- Web 服务启动会写入 `data/web.json`，包含实际端口、本机地址和 LAN 地址；`start.bat`、`start.sh` 优先读取该文件输出地址，端口自动递增后仍能显示正确地址。
- 新增 `npm run regression`，自动执行构建、前端语法检查、关键静态文件检查、原生弹窗残留检查和核心 Web API 探活。
- 前端基础 API 层拆为 `public/app-api.js`，保留无框架静态 Web 形态，为后续继续拆分 `app.js` 降低风险。
- 设置页新增运行诊断，可查看当前 Web 地址、LAN 地址、日志目录、Web 日志路径和 PTY optional 依赖状态。
- SFTP 文件管理器库评估结论：当前继续保持轻量原生实现，不引入重型库；后续如接库，优先只接前端交互层，不改变 SSH 后端和 Termux 运行方式。

## v1.0.3

### 优化

- 新增通知事件中心，转发启动失败、自动重连失败、恢复成功、批量命令完成和 SFTP 后台任务完成/失败会进入统一通知队列；自动重连失败按异常状态和冷却时间合并提醒，避免长期运行时反复刷屏。
- Web 端支持浏览器桌面通知授权；未授权、移动端或不支持 Notification API 时自动退回页面 toast。
- 通知支持在设置中切换正常提醒、静音或关闭；不新增低磁盘、SSH 不可达、关键端口不可达等监控型告警。
- SFTP 复制、移动和解压后台任务状态会持久化到 `data/sftp-jobs.json`，重启后仍能查看最近任务记录。
- SFTP 上传改为流式后台任务：浏览器先把文件上传到本机临时文件，后端再通过 SSH 流式写入远端文件，任务列表显示远端写入进度。
- SFTP 下载增加浏览器内进度提示，完成后自动保存文件。
- SFTP 页面常驻显示任务列表，空任务时也会提示上传、复制、移动、解压会在这里显示后台进度。
- SFTP 任务列表支持清空已完成、失败或已取消的历史任务，运行中的上传、复制、移动、解压任务不会被清理。
- SFTP 文件列表取消行尾常驻操作按钮，改为点击条目后显示下载、复制、移动、重命名、删除、解压或压缩操作区；右键菜单和移动端更多操作同步可用。
- SFTP 支持文件夹后台压缩为 `.tar.gz`，并进入 SFTP 任务列表。
- SFTP 文件列表增加文件类型图标；文本编辑支持保存前备份远程文件和差异预览。
- 日志查看在搜索状态下新增命中上下文，先显示前几处命中附近内容，再保留完整日志。
- 日志清理增加 90 天前快捷入口和自定义保留天数入口。
- 普通终端新增最近命令记录，可从终端工具栏快速再次发送。
- 最近命令过滤方向键等控制序列，并在 Tab 补全后尽量记录终端当前提示行中的最终命令；最近命令列表改为可滚动展示。
- 连接列表新增服务器仪表盘入口，可通过 SSH 查看系统信息、发行版、运行时间、内存、磁盘和监听端口摘要。
- 导入导出页的恢复入口明确支持 `.tdbackup.json` 加密迁移包，并补充说明迁移包包含完整数据库和配置加密元数据，但不包含 SSH 私钥、Web 密码或访问 Token。
- 未启用配置加密时隐藏“下载加密迁移包”入口；启用配置加密时会自动加密现有明文字段，关闭配置加密时会先用主密码解密已加密字段，关闭后可继续使用普通 `.db` 备份。
- 安全设置页保存认证策略、密码和 Token 时减少整页重绘，避免后台刷新或保存操作影响正在编辑的输入框、选区和滚动位置。
- 正在转发、连接列表和日志列表重绘后会保留搜索框焦点、光标位置和列表滚动位置，降低后台自动刷新对操作区的影响。
- `start.bat` 和 `start.sh` 在读取到 Web 地址后会对 `/api/connections` 做轻量探活，启动输出更容易判断 Web API 是否可用。
- `start.bat` 和 `start.sh` 会输出当前启动模式和 Web 日志位置，便于定位桌面端回退到 Web-only 的原因。
- 新增 `docs/checklist.md`，记录发布前 Web UI 回归检查项。

## v1.0.2

### 优化

- Web 服务默认继续监听 `127.0.0.1`；现在可在“设置 > 启动与运行”保存多个监听地址和端口，需要临时局域网访问时仍可传入 `--host 0.0.0.0`。
- 新增安全设置活动栏，可设置 Web 密码、访问 Token、局域网访问保护策略和配置加密。
- README 开头补充项目定位和部署建议：TunnelDesk 主要用于 SSH 隧道转发管理，不建议直接公网部署。
- 新增 `TUNNELDESK_LAN=1` 局域网模式，临时使用 `0.0.0.0` 并输出所有检测到的局域网 IPv4 访问地址；端口由保存配置或显式覆盖决定。
- 后端对 API、WebSocket 和静态页面增加认证入口；对写操作增加同源 Origin 检查，并添加基础安全响应头和请求体大小限制。
- 转发模板改为数据库级保存，支持跨浏览器和桌面端/Web 端共享，并可批量应用到当前连接、当前分组或全部连接。
- SFTP 复制、移动和解压支持后台任务，可查看执行状态、失败信息并取消运行中的任务。
- 配置加密降级为高级可选项；启用后新保存的私钥路径和 SSH 参数会加密保存，旧数据保持兼容。
- 导入导出页面新增加密迁移包，便于跨机器恢复已启用配置加密的数据。
- 新增 `TUNNELDESK_RESET_WEB_ACCESS=1`，用于忘记 Web 密码时重置 Web 登录密码和访问 Token。
- 安全设置页补充 Token 用途和配置加密对 SSH 连接解锁状态的影响说明。
- 访问 Token 改为系统随机生成，只显示一次；重新生成后旧 Token 失效。
- SFTP 文件管理界面增加面包屑路径、当前目录搜索、排序表头、选择计数和更精细的文件列表样式。
- SFTP 移动端布局优化，工具栏、文件行和多选框更适合窄屏操作。
- 移动端底栏按钮改为短标签显示，避免“正在转发”“批量命令”“导入导出”等入口在窄屏下换行。
- 移动端终端工具栏和快捷键栏优化：快捷键固定两行横向滚动，按钮点击不再主动唤起软键盘，并在软键盘高度变化时重新适配终端区域。
- 移动端终端方向键改为接近电脑键盘的布局，`Ctrl一次` / `Ctrl锁` 会同时作用于快捷键按钮和手机键盘输入的单个字母。
- 移动端终端快捷键栏会保留横向滚动位置，软键盘收起后会多次重新 fit/refresh 终端，减少底部空白和显示不全。
- 移动端终端进一步加强软键盘收起后的恢复：监听 visualViewport 滚动、输入失焦和方向变化，并让终端盒子明确占满剩余高度。
- 移动端终端增加容器 `ResizeObserver`，在终端区域真实高度变化后强制重新 fit，并取消可能导致底部空白的自动滚到底部兜底。
- 移动端终端快捷键栏默认收起，快捷键栏高度增加以完整显示两排按钮；键盘收起后终端高度变大时会滚回底部，避免提示符停在顶部、下方大片空白。
- 移动端终端改为专用全屏工作区：隐藏普通工作区头部、标签栏和底部导航，只保留终端自己的返回/操作栏，并增加触摸拖动滚动历史输出。
- SFTP 增加常用路径收藏，并支持文本文件在线预览和保存。
- 正在转发视图增加搜索过滤和单条转发重试入口。
- 正在转发列表支持分组展开/收起，并保存用户的折叠状态。
- 项目内确认弹窗替换残留的浏览器原生确认框，覆盖日志删除、批量命令、连接删除、转发端口占用处理、SFTP 删除和数据库恢复等操作。
- 正在转发视图的单条重试接入端口占用处理流程，可像诊断一样选择关闭占用程序或改用推荐端口。
- 转发列表移除单条“诊断”按钮，启动和重试时仍会自动进行端口诊断和占用处理。

## v1.0.1

### 新增

- 连接列表支持搜索，可按连接名称、分组、主机、用户、端口和转发信息过滤。
- 新增健康检查，可对单个连接或全部连接检测 SSH 可用性和本地转发端口状态。
- 新增本地端口占用诊断，启动转发前可识别占用端口的进程名称、PID 和路径。
- 新增端口占用处理入口，可在用户二次确认后尝试关闭占用程序。
- 新增私钥权限检查和一键修复，便于处理 Windows OpenSSH 私钥权限过宽问题。
- 新增上次转发状态恢复，TunnelDesk 启动后会尝试恢复上次正在运行的转发。
- 新增转发自动重连，已记录为需要恢复的转发会定时检查并尝试重新启动。
- 新增转发规则级启停，每条转发规则独立使用 `ssh` 进程运行。
- 转发列表和正在转发视图新增服务入口，可设置服务名称、类型、备注，并复制或打开本地转发地址。
- 日志列表支持搜索、打开当天系统日志，并支持清理 7 天前或 30 天前的日志。
- Windows 和 Linux/Termux 启动脚本会在首次 clone 后自动安装必要依赖。
- 移动端终端新增快捷键栏，支持 Esc、Tab、方向键、常用符号和 Ctrl 组合键。
- 工作区非终端标签支持持久化，刷新后可恢复转发列表、编辑页、导入导出、日志和批量命令标签。
- 桌面端托盘菜单新增正在转发状态统计，并支持启动后静默到托盘。
- 新增批量命令活动栏入口和移动端底栏入口。
- 新增批量命令模板管理，可对预设命令模板进行新增、编辑、删除和选择使用。
- 新增批量命令实时执行窗口，可选择多个 SSH 连接执行同一命令并分服务器展示实时输出。
- 新增批量执行日志，单独保存到日志列表中的“批量执行日志”分组。
- 新增转发规则编辑，运行中的规则保存后可选择立即重启。
- 新增端口自动推荐，端口冲突时可改用推荐端口继续启动。
- 新增单条转发自动重连，异常退出时只重启对应规则。
- 新增转发模板，可保存并套用常用转发规则。
- 新增 SFTP 文件管理基础版，支持目录浏览、上传、下载、新建目录、重命名和删除。
- 新增服务器标签，支持展示和搜索。

### 优化

- 连接列表在大量 SSH 连接场景下使用虚拟滚动渲染，减少展开分组时的前端卡顿。
- 终端快捷键栏打开后，工作区外层不再滚动，滚动焦点保留在终端会话内部。
- SSH 和转发失败时返回更明确的中文诊断，包括私钥权限、认证失败、端口占用、连接超时、主机解析失败等常见原因。
- 正在转发视图增加单条操作按钮，便于快速停止指定转发规则。
- 健康检查提示会显示具体异常转发、端口不可达和端口占用进程。
- 启用转发、停止转发、健康检查和端口诊断增加过渡状态，避免操作期间界面没有反馈。
- 桌面端小窗口下转发列表自动切换为卡片布局，避免状态、服务入口和操作按钮挤压错位。
- 转发启动失败会写入系统日志。
- 正在转发视图支持按服务器、服务类型和运行状态分组。
- 转发卡片显示运行时长、重连次数、PID 和最近错误。
- 本地转发访问入口支持自定义 `http` / `https` 协议，并支持复制 curl。
- 转发表单操作按钮按场景显示，减少默认状态下的干扰按钮。
- 端口推荐会避开已配置端口和系统占用端口。
- 添加或编辑转发时遇到端口冲突，会提示已配置服务器或占用进程，并提供继续保存、推荐端口保存和取消。
- 转发模板补充管理界面。
- SFTP 文件管理补充多选、复制、移动、粘贴、批量删除和解压缩操作。
- 导入导出活动栏调整到日志上方。
- 项目内弹窗替代原生 `prompt`，避免 Codex 浏览器和桌面客户端看不到输入弹窗。
- 修复移动端 SFTP 多选框位置异常。
- 转发模板支持载入到表单后编辑并保存回原模板。
- Release workflow 改为从 `docs/update.md` 提取当前 tag 的发布说明。
- 转发列表改为更适合桌面和移动端的规则卡片布局，移动端减少表格挤压和横向溢出。
- 日志查看支持按当前搜索词高亮命中内容。
- 批量启动转发时失败提示更容易定位具体连接。
- 启动脚本显式安装开发依赖，并使用 Windows npm 的 Electron 命令入口判断桌面端启动条件。
- 启动脚本会在进入桌面端前检查 Electron 二进制是否存在，缺失时先下载；默认源失败后尝试 Electron 镜像，仍失败则回退 Web 模式，避免首次运行直接失败。
- 启动脚本会自动尝试安装 PTY optional 依赖；Termux 下会设置 `npm_config_android_ndk_path=$PREFIX` 辅助 `node-pty` 本机编译，失败时不阻断启动，终端自动回退到普通 SSH 子进程模式。
- 批量导入测试连接和全部连接健康检查改为异步并发执行，避免 SSH 检测期间卡住 Web 服务。
- 删除 Windows PowerShell 脚本文件，Windows 启动和停止统一使用 bat 脚本。

### 注意事项

- 本地端口占用关闭功能会要求用户确认，不会自动关闭占用程序。
- 远程转发端口位于服务器侧，本机只能展示 SSH 返回的远程转发失败原因，无法直接识别服务器上的占用进程。
- 自动恢复和自动重连只针对已经成功启动并记录到恢复状态的连接。
- README 面向已发布功能；未发布内容优先记录在本文件和 `docs/Notes.md`。
- 设置 `TUNNELDESK_WEB_ONLY=1` 时仍会强制后台 Web 模式，不会启动 Electron 桌面端。
