const TERMA_I18N_LANGUAGES = Object.freeze(["zh-CN", "en-US"]);
const TERMA_I18N_NAMESPACES = Object.freeze([
  "common",
  "navigation",
  "settings",
  "connections",
  "terminal",
  "sftp",
  "tasks",
  "remote",
  "errors",
  "login"
]);

let termaI18nLanguage = "zh-CN";
let termaI18nInitialized = false;
const termaI18nRenderers = new Set();
const termaI18nTextState = new WeakMap();
const termaI18nAttributeState = new WeakMap();
const termaI18nPhraseKeys = new Map();
const termaI18nPhraseTemplates = [];
const termaI18nRawPhrases = new Map();
const TERMA_I18N_RAW_PHRASE_LIMIT = 512;
const TERMA_I18N_RAW_PHRASE_TTL_MS = 30 * 1000;
const TERMA_I18N_ATTRIBUTES = Object.freeze(["title", "aria-label", "placeholder"]);
const TERMA_I18N_FALLBACK_REPLACEMENTS = Object.freeze([
  ["未启用配置加密：通常下载普通 .db 数据库备份即可。启用配置加密后才会显示加密迁移包下载入口。", "Configuration encryption is disabled. A standard .db database backup is normally sufficient; the encrypted migration package download appears only after encryption is enabled."],
  ["已选择所有 IPv4 网卡；其他地址已折叠，取消勾选后可按网卡选择。", "All IPv4 adapters are selected. Other addresses are collapsed; clear the selection to choose individual adapters."],
  ["剪贴板：手动 · 点击设置 SSH 剪贴板辅助", "Clipboard: manual - click to configure the SSH clipboard helper"],
  ["鼠标模式：自动（当前显示本地光标）", "Mouse mode: automatic (showing the local cursor)"],
  ["通过 SSH 读取远端系统剪贴板", "Read the remote system clipboard through SSH"],
  ["当前服务器没有其他远程桌面", "No other remote desktops are available on this server"],
  ["自动识别 HTTPS（推荐）", "Detect HTTPS automatically (recommended)"],
  ["仅非本机访问时校验密码", "Require a password only for non-local access"],
  ["所有浏览器访问都校验密码", "Require a password for all browser access"],
  ["关闭 Web 认证（高风险）", "Disable web authentication (high risk)"],
  ["用户数据路径（推荐）", "User data path (recommended)"],
  ["删除全部历史任务记录", "Delete all task history"],
  ["开启剪贴板自动同步", "Enable automatic clipboard sync"],
  ["设置 SSH 剪贴板辅助", "Configure SSH clipboard helper"],
  ["发送本机剪贴板", "Send local clipboard"],
  ["返回探测与管理", "Return to inspection and management"],
  ["项目所在文件夹", "Project folder"],
  ["自定义数据根目录", "Custom data root directory"],
  ["调整私钥绑定", "Adjust private-key bindings"],
  ["正在检查旧版数据", "Checking legacy data"],
  ["手动输入命令", "Enter a command manually"],
  ["各自标签内", "Inside each tab"],
  ["工作区标题栏", "Workspace title bar"],
  ["始终使用 Secure", "Always use Secure"],
  ["从不使用 Secure", "Never use Secure"],
  ["静音，只记录已读", "Mute and mark as read only"],
  ["向左滚动标签", "Scroll tabs left"],
  ["向右滚动标签", "Scroll tabs right"],
  ["关联工作区", "Linked workspace"],
  ["改用系统客户端", "Use the system client"],
  ["自定义路径", "Custom path"],
  ["正常提醒", "Normal notifications"],
  ["关闭提醒", "Disable notifications"],
  ["删除任务", "Delete task"],
  ["停止任务", "Stop task"],
  ["工作区组", "Workspace group"],
  ["SSH 辅助", "SSH helper"],
  ["全屏", "Full screen"],
  ["自动启动只会启动已经存在的本机 X Server。Windows 源码启动会准备 Terma 内置运行时；Linux 和 macOS 的系统组件需要在此单独确认安装。", "Automatic startup only starts an existing local X Server. Windows source builds prepare the Terma bundled runtime; Linux and macOS system components must be installed separately here."],
  ["请先使用 Web 密码或访问 Token 登录，再申请临时授权。", "Sign in with the web password or an access token before requesting temporary authorization."],
  ["如果远端和运行 Terma 的本机都无法联网，请在另一台与远端发行版、版本及 CPU 架构匹配的联网机器下载 xclip 及全部依赖，再通过本地文件/SFTP 上传后按发行版的离线安装方式执行。", "If neither the remote host nor the local Terma device has network access, download xclip and all dependencies on an online machine with the same distribution, version, and CPU architecture, then upload them through Local Files or SFTP and follow the distribution's offline installation procedure."],
  ["后台探测会使用保存的 SSH 账号建立独立连接，不会继承其他终端中的 sudo -i。通过终端操作时可正常输入 sudo 密码。", "Background inspection creates a separate connection with the saved SSH account and does not inherit sudo -i from other terminals. Terminal operations can still prompt for the sudo password."],
  ["如果远端和运行 Terma 的本机都无法联网，请在另一台与远端发行版、版本及 CPU 架构匹配的联网机器下载所需组件和全部依赖，再通过本地文件/SFTP 上传后按发行版的离线安装方式执行。", "If neither the remote host nor the local Terma device has network access, download the required components and all dependencies on an online machine with the same distribution, version, and CPU architecture, then upload them through Local Files or SFTP and follow the distribution's offline installation procedure."],
  ["图片通过 SSH X11 转发直接写入远端图形剪贴板；VNC 连接的图片剪贴板仍需在 VNC 会话中配置对应的 xclip 或 wl-clipboard。", "Images are written directly to the remote graphical clipboard through SSH X11 forwarding. VNC image clipboard support still requires xclip or wl-clipboard in the VNC session."],
  ["的普通终端尚未默认请求 X11，可临时打开或保存为默认。", " does not request X11 by default yet; you can open a temporary X11 terminal or save it as the default."],
  ["本机 DISPLAY 已就绪；", "Local DISPLAY is ready; "],
  ["确认本机 X Server 已启动", "Confirm that the local X Server is running"],
  ["安装 xauth / X11 组件", "Install xauth / X11 components"],
  ["Terma 当前会话", "Current Terma session"],
  ["XAuthLocation：", "XAuthLocation: "],
  ["DISPLAY 偏移：", "DISPLAY offset: "],
  ["安装方式", "Installation method"],
  ["长按拖动", "Press and hold to drag "],
  ["分组排序", "to reorder the group"],
  ["快捷打开", "Quick open"],
  ["快速打开", "Quick open"],
  ["平台：", "Platform: "],
  ["sshd：", "sshd: "],
  ["未设置", "Not set"],
  ["已检测", "Detected"],
  ["清理", "Clear "],
  ["例如：whoami 或 uname -a", "For example: whoami or uname -a"],
  ["访问保护、通知、运行信息与开源许可", "access protection, notifications, runtime information, and open-source licenses"],
  ["拖动调整标签栏高度，双击恢复默认", "Drag to adjust tab bar height; double-click to restore the default"],
  ["批量执行 - 选择多个 SSH 执行命令", "Batch execution - Select multiple SSH hosts and run commands"],
  ["设置 - 访问保护、通知、运行信息与开源许可", "Settings - Access protection, notifications, runtime information, and open-source licenses"],
  ["导入导出 - SSH config 与数据库迁移", "Import and export - SSH config and database migration"],
  ["快捷打开：关闭，只进入探测界面", "Quick open: disabled; open the inspection view only"],
  ["快捷打开：已关闭，只进入探测界面", "Quick open: disabled; open the inspection view only"],
  ["搜索其他连接、协议、主机、分组", "Search other connections, protocols, hosts, or groups"],
  ["搜索连接、主机、用户、分组", "Search connections, hosts, users, or groups"],
  ["新主密码至少 12 位", "New master password must be at least 12 characters"],
  ["打开 SFTP 文件管理", "Open SFTP file manager"],
  ["长按拖动分组排序", "Press and hold to reorder groups"],
  ["双击打开终端", "Double-click to open terminal"],
  ["静默悬浮进度卡", "Mute floating progress card"],
  ["关闭当前悬浮进度", "Close current floating progress"],
  ["任务中心：", "Task Center: "],
  ["项进行中", " running"],
  ["快速打开（Ctrl+K）", "Quick open (Ctrl+K)"],
  ["快捷打开远程桌面", "Quick open remote desktop"],
  ["X Server 未启动", "X Server is not running"],
  ["切换为暗色", "Switch to dark theme"],
  ["切换为亮色", "Switch to light theme"],
  ["调整标签栏高度", "Adjust tab bar height"],
  ["任务进度", "Task progress"],
  ["至少 8 位", "At least 8 characters"],
  ["显示密码", "Show password"],
  ["隐藏密码", "Hide password"],
  ["按任务默认", "Use task default"],
  ["清理 SFTP 下载", "Clear SFTP downloads"],
  ["清理 SFTP 上传", "Clear SFTP uploads"],
  ["清理 SFTP 拖出", "Clear SFTP drag-out cache"],
  ["清理更新安装包", "Clear update installers"],
  ["清理组件安装残留", "Clear component installation leftovers"],
  ["清理本地组件安装包", "Clear local component installers"],
  ["本机组件安装包", "Local component installers"],
  ["SFTP 拖出", "SFTP drag-out cache"],
  ["项目主页", "project homepage"],
  ["批量管理", "Bulk management"],
  ["连接列表操作", "Connection list actions"],
  ["分组操作", "Group actions"],
  ["健康状态：未检测", "Health status: not checked"],
  ["条转发", " forwarding rules"],
  ["快捷操作", "quick actions"],
  ["管理转发", "Manage forwarding"],
  ["停止转发", "Stop forwarding"],
  ["收藏连接", "Favorite connection"],
  ["更多操作", "More actions"],
  ["其他连接操作", "Other connection actions"],
  ["搜索转发、服务器、端口", "Search forwarding rules, servers, or ports"],
  ["复制地址", "Copy address"],
  ["刷新模板", "Refresh templates"],
  ["搜索日志", "Search logs"],
  ["清理日志", "Clear logs"],
  ["删除批量日志", "Delete batch logs"],
  ["例如：", "For example: "],
  ["例如 ", "For example, "],
  ["X11 图片剪贴板辅助", "X11 image clipboard helper"],
  ["X11 图片剪贴板", "X11 image clipboard"],
  ["图片剪贴板需要 SSH 辅助和 xclip/wl-clipboard", "Image clipboard requires SSH helper and xclip/wl-clipboard"],
  ["远端已安装 xclip，可用于 X11 图片剪贴板。", "xclip is installed remotely and ready for X11 image clipboard."],
  ["远端尚未安装 xclip；安装后，X11 转发终端可接收本机剪贴板图片。", "xclip is not installed remotely; after installation, X11-forwarded terminals can receive local clipboard images."],
  ["当前远端不是 Linux，Terma 不会安装 xclip。", "The remote host is not Linux, so Terma will not install xclip."],
  ["远端尚未安装 xclip；安装后可从 X11 转发终端粘贴图片", "xclip is not installed remotely; install it to paste images through X11-forwarded terminals"],
  ["发送本机剪贴板图片", "Send local clipboard image"],
  ["读取远端剪贴板图片", "Read remote clipboard image"],
  ["图片已同步到远端", "Image synced to remote"],
  ["已读取远端图片", "Remote image read"],
  ["图片剪贴板同步失败", "Image clipboard sync failed"],
  ["读取远端图片失败", "Failed to read remote image"],
  ["本机剪贴板中没有 PNG 图片", "No PNG image in the local clipboard"],
  ["本机剪贴板图片已同步到远端 VNC 桌面", "The local clipboard image was synced to the remote VNC desktop"],
  ["远端 VNC 剪贴板图片已写入本机剪贴板", "The remote VNC clipboard image was written to the local clipboard"],
  ["X11 图片剪贴板探测失败", "X11 image clipboard detection failed"],
  ["X11 图片剪贴板任务正在执行，请等待完成", "The X11 image clipboard task is already running"],
  ["xclip 已安装", "xclip installed"],
  ["xclip 已卸载", "xclip removed"],
  ["卸载 xclip", "Remove xclip"],
  ["安装 xclip", "Install xclip"],
  ["远端 xclip 状态", "remote xclip status"],
  ["远端 xclip", "remote xclip"],
  ["SSH 剪贴板辅助已启用", "SSH clipboard helper enabled"],
  ["SSH 剪贴板辅助不可用", "SSH clipboard helper unavailable"],
  ["Linux Unicode 剪贴板辅助安装说明", "Linux Unicode clipboard helper installation"],
  ["Linux 远端没有可用的 Unicode 系统剪贴板辅助工具", "No Unicode system clipboard helper is available on the Linux host"],
  ["本机下载后离线安装", "Download locally and install offline"],
  ["手动安装/配置说明", "Manual installation/configuration"],
  ["远程组件任务", "Remote component task"],
  ["远端 SSH X11 组件与转发", "Remote SSH X11 components and forwarding"],
  ["Linux 桌面管理", "Linux desktop management"],
  ["安装 Linux 图形组件", "Install Linux graphics components"],
  ["安装远端 XQuartz", "Install remote XQuartz"],
  ["本机 X Server", "Local X Server"],
  ["X Server 管理", "X Server management"],
  ["X Server 状态读取失败", "Failed to read X Server status"],
  ["SSH X11 配置探测失败", "Failed to inspect SSH X11 configuration"],
  ["X11 转发任务正在执行，请等待完成", "The X11 forwarding task is already running"],
  ["临时打开 X11 终端", "Open a temporary X11 terminal"],
  ["普通终端默认启用", "Enable X11 by default for terminals"],
  ["关闭普通终端默认 X11", "Disable default X11 for terminals"],
  ["已开启，xauth 配置可用", "Enabled, xauth is configured"],
  ["已开启，但远端未安装 XQuartz", "Enabled, but XQuartz is not installed remotely"],
  ["已开启，但未检测到 xauth", "Enabled, but xauth was not found"],
  ["可信 X11", "Trusted X11"],
  ["受限 X11", "Untrusted X11"],
  ["关闭 X11", "X11 disabled"],
  ["剪贴板辅助工具", "clipboard helper"],
  ["剪贴板辅助工具安装失败", "Clipboard helper installation failed"],
  ["剪贴板辅助工具卸载失败", "Clipboard helper removal failed"],
  ["卸载辅助工具", "Remove helper"],
  ["Unicode 剪贴板辅助工具", "Unicode clipboard helper"],
  ["VNC 共享当前桌面", "Share the current desktop over VNC"],
  ["VNC 虚拟会话", "Virtual VNC session"],
  ["VNC 服务管理", "VNC service management"],
  ["VNC 剪贴板辅助不可用", "VNC clipboard helper unavailable"],
  ["VNC 连接没有可用的 SSH 剪贴板辅助连接", "The VNC connection has no usable SSH clipboard helper connection"],
  ["SSH 剪贴板辅助", "SSH clipboard helper"],
  ["剪贴板：自动同步（SSH）", "Clipboard: automatic sync (SSH)"],
  ["剪贴板：自动同步", "Clipboard: automatic sync"],
  ["剪贴板：手动", "Clipboard: manual"],
  ["剪贴板权限受限", "Clipboard permission restricted"],
  ["已同步到远端", "Synced to remote"],
  ["已从远端同步", "Synced from remote"],
  ["正在识别远端系统和剪贴板辅助工具", "Detecting the remote system and clipboard helper"],
  ["重新检测", "Detect again"],
  ["保存并检测", "Save and detect"],
  ["自动匹配同主机", "Match the same host automatically"],
  ["同主机", "Same host"],
  ["没有自动找到同主机 SSH", "No SSH connection was found automatically for this host"],
  ["连接本身不依赖 SSH", "The connection itself does not require SSH"],
  ["暂不支持", "Not supported yet"],
  ["未检测到可用的 Linux 图形桌面", "No usable Linux graphical desktop was detected"],
  ["前往 Linux 桌面管理", "Open Linux desktop management"],
  ["安装桌面后重新打开此连接", "Reopen this connection after installing a desktop"],
  ["远端管理凭据", "remote management credentials"],
  ["修复 SSH 管理凭据", "Repair SSH management credentials"],
  ["新建 SSH 管理连接", "Create an SSH management connection"],
  ["未关联 SSH 管理连接", "No SSH management connection"],
  ["在线安装", "Online installation"],
  ["使用远端缓存", "Use the remote package cache"],
  ["远端管理", "Remote management"],
  ["开启 SSH X11 转发", "Enable SSH X11 forwarding"],
  ["关闭 SSH X11 转发", "Disable SSH X11 forwarding"],
  ["开启 X11 转发", "Enable X11 forwarding"],
  ["关闭 X11 转发", "Disable X11 forwarding"],
  ["临时授权后", "After temporary authorization"],
  ["在终端手动", "Manually in terminal: "],
  ["配置命令已放入当前临时终端", "The configuration command was placed in the temporary terminal"],
  ["远端软件源", "remote package source"],
  ["系统包管理器", "system package manager"],
  ["包管理器", "package manager"],
  ["未识别包管理器", "Package manager not detected"],
  ["未识别显示管理器", "Display manager not detected"],
  ["未识别系统", "System not detected"],
  ["当前系统没有可用方案", "No option is available for the current system"],
  ["当前不可用", "Currently unavailable"],
  ["可自动安装", "Can be installed automatically"],
  ["已安装，可用于图形会话", "Installed and available for graphical sessions"],
  ["安装中", "Installing"],
  ["卸载中", "Removing"],
  ["探测中", "Detecting"],
  ["正在探测", "Detecting"],
  ["正在读取", "Reading"],
  ["正在加载", "Loading"],
  ["正在连接", "Connecting"],
  ["连接中", "Connecting"],
  ["连接错误", "Connection error"],
  ["连接测试通过", "Connection test passed"],
  ["连接测试失败", "Connection test failed"],
  ["端口探测失败", "Port probe failed"],
  ["端口不可达", "Port unreachable"],
  ["端口可达", "Port reachable"],
  ["启动中", "Starting"],
  ["正在启动", "Starting"],
  ["正在运行", "Running"],
  ["服务运行中", "Service running"],
  ["服务未运行", "Service not running"],
  ["停止中", "Stopping"],
  ["关闭中", "Closing"],
  ["重启中", "Restarting"],
  ["已完成", "Completed"],
  ["完成", "Complete"],
  ["执行中", "Running"],
  ["排队中", "Queued"],
  ["准备中", "Preparing"],
  ["已暂停", "Paused"],
  ["暂停中", "Pausing"],
  ["失败", "Failed"],
  ["已取消", "Cancelled"],
  ["取消", "Cancel"],
  ["重试", "Retry"],
  ["刷新", "Refresh"],
  ["关闭", "Close"],
  ["保存", "Save"],
  ["编辑", "Edit"],
  ["删除", "Delete"],
  ["卸载", "Remove"],
  ["安装", "Install"],
  ["启动", "Start"],
  ["停止", "Stop"],
  ["重启", "Restart"],
  ["确定", "OK"],
  ["确认", "Confirm"],
  ["执行", "Run"],
  ["发送", "Send"],
  ["复制", "Copy"],
  ["导出", "Export"],
  ["导入", "Import"],
  ["打开", "Open"],
  ["查看", "View"],
  ["下载", "Download"],
  ["上传", "Upload"],
  ["暂停", "Pause"],
  ["继续", "Resume"],
  ["全选", "Select all"],
  ["选择", "Select"],
  ["权限", "Permissions"],
  ["目录", "Directory"],
  ["文件", "File"],
  ["路径", "Path"],
  ["远端", "Remote"],
  ["远程", "Remote"],
  ["本机", "Local"],
  ["本地", "Local"],
  ["连接", "Connection"],
  ["服务器", "Server"],
  ["系统", "System"],
  ["设置", "Settings"],
  ["日志", "Logs"],
  ["任务中心", "Task Center"],
  ["后台任务", "Background task"],
  ["工作区", "Workspace"],
  ["标签", "Tab"],
  ["终端", "Terminal"],
  ["桌面", "Desktop"],
  ["图形桌面", "Graphical desktop"],
  ["图形会话", "Graphical session"],
  ["默认分组", "Default group"],
  ["当前分组", "Current group"],
  ["当前连接", "Current connection"],
  ["请选择", "Select"],
  ["请先", "Please first "],
  ["暂无", "No "],
  ["没有", "No "],
  ["未检测到", "Not detected"],
  ["未知", "Unknown"],
  ["已启用", "Enabled"],
  ["未启用", "Disabled"],
  ["已关闭", "Disabled"],
  ["可信", "Trusted"],
  ["受限", "Untrusted"],
  ["高风险", "High risk"],
  ["只读", "Read-only"],
  ["自动", "Automatic"],
  ["手动", "Manual"],
  ["在线", "Online"],
  ["离线", "Offline"],
  ["项目", "Project"],
  ["系统桌面", "System desktop"],
  ["本机桌面会话", "Local desktop session"],
  ["当前图形会话", "Current graphical session"],
  ["当前远程会话", "Current remote session"],
  ["X11 已就绪", "X11 ready"],
  ["等待桌面授权", "Waiting for desktop authorization"],
  ["桌面集成不可用", "Desktop integration unavailable"],
  ["独立 Web/测试后端", "Standalone Web/test backend"],
  ["本机直连自动授权", "Automatic local authorization"],
  ["状态受限", "Status restricted"],
  ["未安装", "Not installed"],
  ["未知显示", "Display unknown"],
  ["显示器", "Display"],
  ["运行方式", "Run mode"],
  ["管理范围", "Management scope"],
  ["下次启动", "Next startup"],
  ["自动启动", "Start automatically"],
  ["保持关闭", "Keep disabled"],
  ["当前后端", "Current backend"],
  ["桌面设备", "Desktop device"],
  ["无法探测 X Server", "Unable to detect X Server"],
  ["授权范围", "Authorization scope"],
  ["浏览器权限", "Browser permission"],
  ["当前浏览器尚未授权", "This browser is not authorized"],
  ["本机 DISPLAY 已就绪", "Local DISPLAY is ready"],
  ["远端主机", "Remote host"],
  ["当前主机", "Current host"],
  ["安装结束后", "After installation"],
  ["重新探测", "Detect again"],
  ["参考命令", "Reference commands"],
  ["复制参考命令", "Copy reference commands"],
  ["命令已复制", "Command copied"],
  ["复制命令失败", "Failed to copy command"],
  ["重试转发", "Retry forwarding"],
  ["启动服务", "Start service"],
  ["停止服务", "Stop service"],
  ["卸载服务", "Remove service"],
  ["打开远程桌面", "Open remote desktop"],
  ["打开图形桌面", "Open graphical desktop"],
  ["打开关联终端", "Open linked terminal"],
  ["打开关联 SFTP", "Open linked SFTP"],
  ["刷新其他连接", "Refresh other connections"],
  ["连接设置", "Connection settings"],
  ["系统客户端", "System client"],
  ["内置桌面", "Built-in desktop"],
  ["内置终端", "Built-in terminal"],
  ["内置文件", "Built-in file"],
  ["无法进入全屏", "Unable to enter full screen"],
  ["确认关闭", "Confirm close"],
  ["确认操作", "Confirm action"],
  ["是否继续", "Continue?"],
  ["正在保存", "Saving"],
  ["保存中", "Saving"],
  ["保存失败", "Save failed"],
  ["读取失败", "Read failed"],
  ["加载失败", "Load failed"],
  ["检查失败", "Check failed"],
  ["配置失败", "Configuration failed"],
  ["安装失败", "Installation failed"],
  ["卸载失败", "Removal failed"],
  ["启动失败", "Start failed"],
  ["停止失败", "Stop failed"],
  ["重启失败", "Restart failed"],
  ["状态读取失败", "Failed to read status"],
  ["任务失败", "Task failed"],
  ["任务进行中", "Task in progress"],
  ["任务中心与日志", "Task Center and logs"],
  ["没有匹配结果", "No matching results"],
  ["目录为空", "Directory is empty"],
  ["连接不存在", "Connection does not exist"],
  ["请先选择连接", "Select a connection first"],
  ["请先选择 SSH 管理连接", "Select an SSH management connection first"],
  ["请先选择私钥", "Select a private key first"],
  ["请选择私钥", "Select a private key"],
  ["SSH 连接不存在", "SSH connection does not exist"],
  ["SSH 连接错误", "SSH connection error"],
  ["请先登录", "Sign in first"],
  ["当前尚未连接", "Not connected"],
  ["终端尚未连接", "Terminal is not connected"],
  ["断开连接", "Disconnect"],
  ["重新连接终端", "Reconnect terminal"],
  ["关闭当前标签", "Close current tab"],
  ["关闭其他标签", "Close other tabs"],
  ["关闭右侧标签", "Close tabs to the right"],
  ["关闭所有标签", "Close all tabs"],
  ["调整分屏比例", "Adjust split ratio"],
  ["开始使用", "Get started"],
  ["新建标签", "New tab"],
  ["新建终端", "New terminal"],
  ["新建远程连接", "New remote connection"],
  ["编辑远程连接", "Edit remote connection"],
  ["保存远程连接", "Save remote connection"],
  ["新增远程连接", "Add remote connection"],
  ["删除远程连接", "Delete remote connection"],
  ["新建图形登录", "New graphical login"],
  ["快速连接", "Quick connection"],
  ["快速终端", "Quick terminal"],
  ["批量执行", "Batch execution"],
  ["命令片段", "Command snippet"],
  ["管理命令片段", "Manage command snippets"],
  ["发送到对端", "Send to the other side"],
  ["目录同步", "Directory sync"],
  ["目录比较", "Directory comparison"],
  ["外部编辑会话", "External editor sessions"],
  ["图片预览", "Image preview"],
  ["预览图片", "Preview image"],
  ["打开文件", "Open file"],
  ["打开终端", "Open terminal"],
  ["新建目录", "New directory"],
  ["目录名称", "Directory name"],
  ["文件夹名称", "Folder name"],
  ["文件夹已创建", "Folder created"],
  ["权限已更新", "Permissions updated"],
  ["设置权限", "Set permissions"],
  ["删除远程项目", "Delete remote items"],
  ["覆盖同名项目", "Overwrite conflicting items"],
  ["发现同名项目", "Conflicting items found"],
  ["自动改名", "Rename automatically"],
  ["目标目录", "Target directory"],
  ["远程路径", "Remote path"],
  ["文件已创建", "File created"],
  ["文件已上传", "File uploaded"],
  ["粘贴失败", "Paste failed"],
  ["粘贴内容为空", "Pasted content is empty"],
  ["剪贴板为空", "Clipboard is empty"],
  ["永久静默", "Mute permanently"],
  ["开启命令通知", "Enable command notifications"],
  ["静音命令通知", "Mute command notifications"],
  ["通知设置", "Notification settings"],
  ["安全设置", "Security settings"],
  ["通用设置", "General settings"],
  ["工作区设置", "Workspace settings"],
  ["运行信息", "Runtime information"],
  ["导入导出", "Import and export"],
  ["访问保护", "Access protection"],
  ["开源许可", "Open-source license"],
  ["数据库检查失败", "Database check failed"],
  ["恢复数据库", "Restore database"],
  ["配置快照", "Configuration snapshot"],
  ["备份并合并", "Back up and merge"],
  ["迁移旧版数据", "Migrate legacy data"],
  ["迁移中", "Migrating"],
  ["临时管理员授权", "Temporary administrator authorization"],
  ["只在本次操作中使用", "Used only for this operation"],
  ["密码", "Password"],
  ["私钥", "Private key"],
  ["私钥口令", "Private-key passphrase"],
  ["管理员 SSH 账号", "Administrator SSH account"],
  ["SSH 认证方式", "SSH authentication method"],
  ["验证中", "Verifying"],
  ["授权并继续", "Authorize and continue"],
  ["身份认证", "Authentication"],
  ["取消固定标签", "Unpin tab"],
  ["固定标签", "Pin tab"],
  ["复制标签", "Duplicate tab"],
  ["切换标签", "Switch tab"],
  ["向左移动", "Move left"],
  ["向右移动", "Move right"],
  ["向左分屏新建", "New split to the left"],
  ["向右分屏新建", "New split to the right"],
  ["向上分屏新建", "New split above"],
  ["向下分屏新建", "New split below"],
  ["调整活动栏宽度", "Adjust activity bar width"],
  ["主题", "Theme"],
  ["刷新数据", "Refresh data"],
  ["收起操作按钮", "Collapse action buttons"],
  ["展开操作按钮", "Expand action buttons"]
].sort((left, right) => right[0].length - left[0].length));
const TERMA_I18N_SKIP_SELECTOR = [
  "script", "style", "code", "pre",
  ".xterm", ".terminal-box", ".log-content", ".log-line", ".ace_editor",
  ".sftp-name-cell", ".local-files-name-cell", ".connection-name",
  ".vnc-screen", ".vnc-viewport", ".vnc-rfb",
  "[data-i18n-skip]"
].join(",");
let termaI18nObserver = null;
let termaI18nApplyQueued = false;
const termaI18nPendingRoots = new Set();

function normalizeTermaLanguage(value) {
  return TERMA_I18N_LANGUAGES.includes(String(value || "")) ? String(value) : "zh-CN";
}

function rememberTermaRawUiPhrase(value) {
  const source = String(value ?? "");
  const phrases = [source, ...source.split(/\r?\n/)].map(item => item.trim()).filter(Boolean);
  const now = Date.now();
  for (const [phrase, expiresAt] of termaI18nRawPhrases) {
    if (expiresAt <= now) termaI18nRawPhrases.delete(phrase);
  }
  for (const phrase of phrases) {
    if (termaI18nRawPhrases.has(phrase)) termaI18nRawPhrases.delete(phrase);
    termaI18nRawPhrases.set(phrase, now + TERMA_I18N_RAW_PHRASE_TTL_MS);
  }
  while (termaI18nRawPhrases.size > TERMA_I18N_RAW_PHRASE_LIMIT) {
    termaI18nRawPhrases.delete(termaI18nRawPhrases.keys().next().value);
  }
  return source;
}

function isTermaRawUiPhrase(value) {
  const phrase = String(value ?? "").trim();
  const expiresAt = termaI18nRawPhrases.get(phrase);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    termaI18nRawPhrases.delete(phrase);
    return false;
  }
  return true;
}

async function fetchTermaI18nResource(language, namespace) {
  const response = await fetch(`/locales/${encodeURIComponent(language)}/${encodeURIComponent(namespace)}.json`, {cache:"no-store"});
  if (!response.ok) {
    throw new Error(`I18N_RESOURCE_LOAD_FAILED: ${language}/${namespace}`);
  }
  return response.json();
}

async function loadTermaI18nResources() {
  const resources = {};
  await Promise.all(TERMA_I18N_LANGUAGES.map(async language => {
    resources[language] = {};
    await Promise.all(TERMA_I18N_NAMESPACES.map(async namespace => {
      resources[language][namespace] = await fetchTermaI18nResource(language, namespace);
    }));
  }));
  return resources;
}

function currentTermaI18nResources() {
  const resources = {};
  for (const language of TERMA_I18N_LANGUAGES) {
    resources[language] = {};
    for (const namespace of TERMA_I18N_NAMESPACES) {
      const bundle = window.i18next?.getResourceBundle?.(language, namespace);
      if (bundle) resources[language][namespace] = bundle;
    }
  }
  return resources;
}

async function ensureTermaI18nResourceBundles(languages=TERMA_I18N_LANGUAGES, namespaces=TERMA_I18N_NAMESPACES) {
  if (!window.i18next) throw new Error("I18NEXT_RUNTIME_MISSING");
  const requestedLanguages = [...new Set(languages.map(normalizeTermaLanguage))];
  const requestedNamespaces = [...new Set(namespaces.filter(namespace => TERMA_I18N_NAMESPACES.includes(namespace)))];
  const missing = [];
  for (const language of requestedLanguages) {
    for (const namespace of requestedNamespaces) {
      if (!window.i18next.hasResourceBundle(language, namespace)) missing.push({language, namespace});
    }
  }
  if (!missing.length) return false;
  await Promise.all(missing.map(async ({language, namespace}) => {
    const resource = await fetchTermaI18nResource(language, namespace);
    window.i18next.addResourceBundle(language, namespace, resource, true, true);
  }));
  rebuildTermaI18nPhraseIndex(currentTermaI18nResources());
  return true;
}

function flattenTermaI18nValues(value, prefix="", result=[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) flattenTermaI18nValues(child, next, result);
    else if (typeof child === "string") result.push([next, child]);
  }
  return result;
}

function rebuildTermaI18nPhraseIndex(resources) {
  termaI18nPhraseKeys.clear();
  termaI18nPhraseTemplates.length = 0;
  for (const namespace of TERMA_I18N_NAMESPACES) {
    const chinese = new Map(flattenTermaI18nValues(resources?.["zh-CN"]?.[namespace] || {}));
    const english = new Map(flattenTermaI18nValues(resources?.["en-US"]?.[namespace] || {}));
    for (const [path, value] of chinese) {
      const key = `${namespace}:${path}`;
      if (value.trim() && !termaI18nPhraseKeys.has(value.trim())) termaI18nPhraseKeys.set(value.trim(), key);
      const englishValue = english.get(path);
      if (englishValue?.trim() && !termaI18nPhraseKeys.has(englishValue.trim())) termaI18nPhraseKeys.set(englishValue.trim(), key);
      for (const template of [value, englishValue]) {
        const compiled = compileTermaI18nPhraseTemplate(template, key);
        if (compiled) termaI18nPhraseTemplates.push(compiled);
      }
    }
  }
  termaI18nPhraseTemplates.sort((left, right) => (
    right.literalLength - left.literalLength
    || right.expression.source.length - left.expression.source.length
  ));
}

function compileTermaI18nPhraseTemplate(value, key) {
  const source = String(value || "").trim();
  const tokenPattern = /{{-?\s*([a-z0-9_.-]+)\s*}}/gi;
  const names = [];
  let expression = "";
  let offset = 0;
  for (const match of source.matchAll(tokenPattern)) {
    expression += source.slice(offset, match.index).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expression += "(.+?)";
    names.push(match[1]);
    offset = Number(match.index) + match[0].length;
  }
  if (!names.length) return null;
  expression += source.slice(offset).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const literalLength = source.replace(/{{-?\s*[a-z0-9_.-]+\s*}}/gi, "").length;
  if (literalLength < 2) return null;
  return {key, names, literalLength, expression:new RegExp(`^${expression}$`)};
}

function translateTermaFallbackPhrase(value) {
  const source = String(value || "");
  let output = source;
  if (!/[\u3400-\u9fff]/.test(output)) return output;
  for (const [needle, target] of TERMA_I18N_FALLBACK_REPLACEMENTS) output = output.split(needle).join(target);
  return /[\u3400-\u9fff]/.test(output) ? source : output;
}

function termaI18nSkipped(element) {
  return Boolean(element?.closest?.(TERMA_I18N_SKIP_SELECTOR));
}

function translatedTermaPhrase(value, depth=0) {
  const source = String(value || "").trim();
  if (isTermaRawUiPhrase(source)) return "";
  const key = termaI18nPhraseKeys.get(source);
  if (key) return tr(key, {defaultValue:source});
  for (const template of termaI18nPhraseTemplates) {
    const match = source.match(template.expression);
    if (!match) continue;
    const options = {defaultValue:source};
    template.names.forEach((name, index) => {
      const captured = match[index + 1];
      options[name] = depth < 2 ? translatedTermaPhrase(captured, depth + 1) || captured : captured;
    });
    return tr(template.key, options);
  }
  const fallback = termaI18nLanguage === "en-US" ? translateTermaFallbackPhrase(source) : source;
  return fallback !== source ? fallback : "";
}

function applyTermaTextNode(node) {
  if (!node?.parentElement || termaI18nSkipped(node.parentElement)) return;
  const current = String(node.nodeValue || "");
  const previous = termaI18nTextState.get(node);
  const source = previous && current === previous.output ? previous.source : current;
  const trimmed = source.trim();
  if (!trimmed) return;
  const translated = translatedTermaPhrase(trimmed);
  if (!translated) {
    termaI18nTextState.delete(node);
    return;
  }
  const leading = source.slice(0, source.indexOf(trimmed));
  const trailing = source.slice(source.indexOf(trimmed) + trimmed.length);
  const output = `${leading}${translated}${trailing}`;
  termaI18nTextState.set(node, {source, output});
  if (current !== output) node.nodeValue = output;
}

function applyTermaElementAttributes(element) {
  if (!element?.getAttribute || termaI18nSkipped(element)) return;
  const states = termaI18nAttributeState.get(element) || new Map();
  for (const attribute of TERMA_I18N_ATTRIBUTES) {
    if (!element.hasAttribute(attribute)) continue;
    const current = String(element.getAttribute(attribute) || "");
    const previous = states.get(attribute);
    const source = previous && current === previous.output ? previous.source : current;
    const translated = translatedTermaPhrase(source);
    if (!translated) {
      states.delete(attribute);
      continue;
    }
    states.set(attribute, {source, output:translated});
    if (current !== translated) element.setAttribute(attribute, translated);
  }
  if (states.size) termaI18nAttributeState.set(element, states);
  else termaI18nAttributeState.delete(element);
}

function applyTermaAutomaticTranslations(root=document) {
  const scope = root?.nodeType ? root : document;
  if (scope.nodeType === Node.TEXT_NODE) applyTermaTextNode(scope);
  else {
    if (scope.nodeType === Node.ELEMENT_NODE) applyTermaElementAttributes(scope);
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (walker.currentNode.nodeType === Node.TEXT_NODE) applyTermaTextNode(walker.currentNode);
      else applyTermaElementAttributes(walker.currentNode);
    }
  }
}

function queueTermaAutomaticTranslations(root=document) {
  const candidate = root?.nodeType === Node.TEXT_NODE ? root.parentElement : root;
  if (candidate !== document && (!candidate?.isConnected || termaI18nSkipped(candidate))) return;
  if (candidate === document) termaI18nPendingRoots.clear();
  if (!termaI18nPendingRoots.has(document)) termaI18nPendingRoots.add(candidate || document);
  if (termaI18nApplyQueued) return;
  termaI18nApplyQueued = true;
  queueMicrotask(() => {
    termaI18nApplyQueued = false;
    const roots = [...termaI18nPendingRoots];
    termaI18nPendingRoots.clear();
    if (!termaI18nInitialized) return;
    if (roots.includes(document) || roots.length > 128) applyTermaAutomaticTranslations(document);
    else roots.forEach(item => applyTermaAutomaticTranslations(item));
  });
}

function observeTermaTranslations() {
  if (termaI18nObserver || !document.body) return;
  termaI18nObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") queueTermaAutomaticTranslations(mutation.target);
      else if (mutation.type === "attributes") queueTermaAutomaticTranslations(mutation.target);
      else for (const node of mutation.addedNodes) queueTermaAutomaticTranslations(node);
    }
  });
  termaI18nObserver.observe(document.body, {
    subtree:true,
    childList:true,
    characterData:true,
    attributes:true,
    attributeFilter:[...TERMA_I18N_ATTRIBUTES]
  });
}

function tr(key, options={}) {
  const name = String(key || "");
  if (!/^(?:[a-z0-9_-]+:)?[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/i.test(name)) return String(options.defaultValue || name);
  if (!termaI18nInitialized || !window.i18next) return String(options.defaultValue || name);
  return window.i18next.t(name, options);
}

function applyTermaTranslations(root=document) {
  const scope = root?.querySelectorAll ? root : document;
  for (const element of scope.querySelectorAll("[data-i18n]")) {
    const key = element.getAttribute("data-i18n");
    if (key) element.textContent = tr(key, {defaultValue:element.textContent || key});
  }
  for (const element of scope.querySelectorAll("[data-i18n-title]")) {
    const key = element.getAttribute("data-i18n-title");
    if (key) element.setAttribute("title", tr(key, {defaultValue:element.getAttribute("title") || key}));
  }
  for (const element of scope.querySelectorAll("[data-i18n-placeholder]")) {
    const key = element.getAttribute("data-i18n-placeholder");
    if (key) element.setAttribute("placeholder", tr(key, {defaultValue:element.getAttribute("placeholder") || key}));
  }
  for (const element of scope.querySelectorAll("[data-i18n-aria-label]")) {
    const key = element.getAttribute("data-i18n-aria-label");
    if (key) element.setAttribute("aria-label", tr(key, {defaultValue:element.getAttribute("aria-label") || key}));
  }
  applyTermaAutomaticTranslations(root);
}

function registerTermaI18nRenderer(renderer) {
  if (typeof renderer !== "function") return () => {};
  termaI18nRenderers.add(renderer);
  return () => termaI18nRenderers.delete(renderer);
}

registerTermaI18nRenderer(() => {
  if (typeof renderConnections === "function") renderConnections();
  if (typeof renderExplorerTools === "function") renderExplorerTools();
  if (typeof renderRunningForwards === "function") renderRunningForwards();
  if (typeof renderForwards === "function" && typeof activeView !== "undefined" && activeView === "forwards") renderForwards();
  if (typeof tabs !== "undefined" && Array.isArray(tabs)) {
    for (const tab of tabs) {
      if (tab.key === "welcome" || tab.kind === "welcome") {
        tab.title = tr("common:workspace.welcome_title", {defaultValue:"开始使用"});
        tab.subtitle = tr("common:workspace.welcome_subtitle", {defaultValue:"选择左侧项目后开始操作"});
        continue;
      }
      if (tab.kind === "import") {
        tab.title = tr("navigation:auto.import_export", {defaultValue:"导入导出"});
        tab.subtitle = tr("settings:auto.import_migration", {defaultValue:"迁移 SSH config、数据库备份和连接配置快照。"});
        continue;
      }
      if (tab.kind === "settings") {
        tab.title = tr("settings:title", {defaultValue:"设置"});
        tab.subtitle = tr("settings:subtitle", {defaultValue:"访问保护、通知、运行信息与开源许可"});
        continue;
      }
      if (tab.kind !== "forwards") continue;
      const connection = typeof connections !== "undefined" ? connections.find(item => Number(item.id) === Number(tab.id)) : null;
      if (!connection) continue;
      tab.title = tr("connections:forwards.workspace_tab", {name:connection.name, defaultValue:`${connection.name} · 转发列表`});
      tab.subtitle = tr("connections:forwards.short_count", {count:(connection.forwards || []).length, defaultValue:`${(connection.forwards || []).length} 条转发`});
    }
    if (typeof renderTabs === "function") renderTabs();
    const activeTab = typeof activeTabKey !== "undefined" ? tabs.find(tab => tab.key === activeTabKey) : null;
    const workspaceSubtitle = document.getElementById("workspaceSubtitle");
    const welcomeActive = typeof activeView !== "undefined" && activeView === "welcome";
    if ((welcomeActive || activeTab?.key === "welcome" || activeTab?.kind === "welcome") && workspaceSubtitle) {
      workspaceSubtitle.textContent = tr("common:workspace.welcome_subtitle", {defaultValue:"选择左侧项目后开始操作"});
    }
  }
  if (typeof terminalSessions !== "undefined" && terminalSessions instanceof Map) {
    for (const [key, session] of terminalSessions) {
      if (typeof updateTerminalStartupButton === "function") updateTerminalStartupButton(key, session.connection);
      if (typeof updateTerminalX11ScopeButton === "function") updateTerminalX11ScopeButton(key, session.connection?.x11_mode || "off");
    }
  }
});

function syncTermaLanguageControls(language=termaI18nLanguage) {
  const target = normalizeTermaLanguage(language) === "zh-CN" ? "en-US" : "zh-CN";
  const targetLabel = tr(`common:languages.${target}`, {defaultValue:target === "zh-CN" ? "简体中文" : "English"});
  const label = tr("common:language.switch_to", {target:targetLabel, defaultValue:`切换到 ${targetLabel}`});
  for (const button of document.querySelectorAll(".language-toggle")) {
    button.dataset.language = normalizeTermaLanguage(language);
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", target === "zh-CN" ? "true" : "false");
  }
}

async function setTermaLanguage(value, options={}) {
  const language = normalizeTermaLanguage(value);
  await window.termaI18nReady;
  if (window.i18next.language !== language) await window.i18next.changeLanguage(language);
  termaI18nLanguage = language;
  document.documentElement.lang = language;
  window.termaDesktop?.setInterfaceLanguage?.(language);
  applyTermaTranslations(document);
  syncTermaLanguageControls(language);
  if (options.render !== false) {
    for (const renderer of [...termaI18nRenderers]) {
      try { renderer(language); } catch (error) { console.error(error); }
    }
    // Renderers can replace translated DOM with freshly generated default-language markup.
    // Apply once more synchronously so language switches never leave mixed-language controls.
    applyTermaTranslations(document);
  }
  if (options.emit !== false) window.dispatchEvent(new CustomEvent("terma:language-changed", {detail:{language}}));
  return language;
}

window.termaI18nReady = (async () => {
  if (!window.i18next) throw new Error("I18NEXT_RUNTIME_MISSING");
  const resources = await loadTermaI18nResources();
  rebuildTermaI18nPhraseIndex(resources);
  await window.i18next.init({
    lng:"zh-CN",
    fallbackLng:"zh-CN",
    supportedLngs:[...TERMA_I18N_LANGUAGES],
    ns:[...TERMA_I18N_NAMESPACES],
    defaultNS:"common",
    resources,
    interpolation:{escapeValue:false},
    returnEmptyString:false
  });
  termaI18nInitialized = true;
  document.documentElement.lang = termaI18nLanguage;
  applyTermaTranslations(document);
  syncTermaLanguageControls(termaI18nLanguage);
  observeTermaTranslations();
  return window.i18next;
})().catch(error => {
  console.error("Terma i18n initialization failed", error);
  return null;
});
