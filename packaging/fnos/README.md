# 飞牛 fnOS 安装包

Terma 通过飞牛 Native FPK 运行后台 Web 服务，依赖应用中心的 `nodejs_v22`，并使用专用 `terma` 用户。当前最低系统版本为 fnOS 1.2.0800。

## 构建

原生依赖需要在与目标架构相同的 Linux x64 或 ARM64 构建机上准备，使用 Node.js 22、npm、Python 3 和 C/C++ 编译工具。构建环境建议为 Debian 12，避免原生模块依赖比 fnOS 更新的 glibc。Windows 的 `node_modules` 不能用于 Linux 包。最终封装使用官方 `fnpack`；目前官方 Linux ARM 工具下载地址返回 404，因此 ARM 包采用下述跨机器分步构建。

```sh
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
npm run build
npm run check:strict
npm run fnos:check
npm run dist:fnos -- --arch x64
# 在 ARM64 Linux 构建机上准备原生依赖：
npm run dist:fnos -- --stage-only --arch arm64
# 将中间归档复制到同一提交的 x64 Linux 检出后：
npm run dist:fnos -- --pack-staging /path/to/Terma-<version>-fnos-arm64.staging.tar.gz --arch arm64
```

设置 `FNPACK` 可以指定官方打包工具的绝对路径。产物与对应的 SHA-256 文件位于 `release/fnos/`。构建过程会在独立暂存目录安装生产依赖，重新应用 SSH2 文件名兼容补丁，并检查 PTY 可用性。默认清理暂存目录，排障时可以传入 `--keep-workspace`。

## GitHub Actions

`.github/workflows/fnos.yml` 是可复用工作流，同时提供 `workflow_dispatch` 手动入口。原生准备阶段使用 `ubuntu-24.04`、`ubuntu-24.04-arm` 与 `node:22.23.1-bookworm`，执行编译、严格类型检查和飞牛回归。封装阶段在 x64 上验证官方 fnpack 的固定 SHA-256，接收原生归档并保留执行权限和内部依赖链接，不重新安装另一架构的依赖。

最终附件为 `Terma-<version>-fnos-x64.fpk`、`Terma-<version>-fnos-arm64.fpk` 及对应 `.sha256`；中间归档只用于当前工作流传递，不进入 Release。Release 主流程在回归通过后调用该工作流，等待全部架构完成，并核对附件名称、包体校验和及完整集合后统一发布。手动构建不创建 GitHub Release。

## 安装与使用

在飞牛应用中心手动上传 `.fpk`，选择安装位置，并两次输入至少 12 个字符的 Web 登录密码。也可以使用 `appcenter-cli install-fpk <文件> --volume <存储空间编号> --env <私有向导配置文件>`；密码字段为 `wizard_web_password` 和 `wizard_web_password_confirm`，使用后应删除，不能提交到仓库。

现有实例升级请通过应用中心上传新版 FPK。命令行安装对已安装应用和数据的处理可能随 fnOS 版本不同；使用前应检查目标设备的命令帮助，并在测试设备确认 `install-fpk` 与开发安装命令 `install-local` 的行为。不要仅凭命令返回成功判断升级完成，必须核对实际安装版本和文件摘要；生产升级前将完整备份导出到应用目录之外。

保留数据后重新安装时，使用本次安装向导填写的 Web 密码，已有连接、密钥和网络设置继续保留。正常升级保留当前密码，不使用安装向导重置密码。

通过飞牛桌面图标打开独立浏览器标签页，或访问 `http://NAS地址:8088`。应用不会创建额外的登录用户名。所有浏览器访问均需要 Web 密码或访问 Token；飞牛桌面图标的管理员可见性不能替代应用认证。

应用中心管理启动、停止和状态。8088 被占用时启动失败，不自动改用其他端口。Web 设置不能改变应用的监听地址、端口或数据根目录；监听地址通过飞牛应用设置调整。

## 应用设置与外网访问

进入“飞牛应用中心 → Terma → 应用设置”中的 Terma 配置页。密码字段留空保留原密码；填写并确认新密码可以重置 Web 登录。运行中的服务保存后短暂重启，原 Web 会话失效。启动失败时恢复保存前的配置。

- **监听地址**：本机网卡 IPv4 地址，例如 `0.0.0.0`（全部 IPv4 网卡）、`127.0.0.1`（仅本机）或 NAS 的某个网卡 IP。多个地址以逗号分隔。这里不接受 `192.168.31.0/24` 这样的客户端来源网段；来源限制由 NAS 或路由器防火墙管理。
- **允许的访问域名或 IP**：外部网址的主机名，例如 `terma.example.com`，可以指定端口；不填写协议、路径或通配符。未允许的主机名显示可切换中英文的说明页，API 保持结构化 421 错误。
- **可信反向代理 IP**：只填写实际转发请求的代理来源 IP。只有来自这些地址的请求才会信任转发协议和客户端来源头。不要把任意访客 IP 或整个网段设为可信代理。
- **校验 HTTPS/HTTP 来源协议**：默认开启。外网 HTTPS 转发到后端 HTTP 被拦截时，可选择关闭，无需填写可信代理 IP；域名、端口和密码检查继续生效，也不会信任任意转发头或授予桌面能力。Terma“设置 → 安全”提供同一个开关，仅用于你控制的转发入口。
- 网络字段留空、协议选项选择“保持现有设置”时保留当前值。使用“恢复默认网络设置”可恢复监听全部 IPv4 网卡，清空允许域名和可信代理，并开启协议校验，再应用本次明确选择和填写的值。
- 登录页在协议不一致时显示中英文原因和设置入口，密码尚未校验。通过局域网等可用地址登录后更改，或直接在应用中心修改；关闭校验后 HTTPS 登录的自动 Cookie 仍使用 Secure。

图文介绍通过 manifest 的 HTML 描述内嵌随包图片，离线可用。`store-listing.json` 准备了“开发工具”分类和截图上架资料；当前公开的 Native FPK manifest 规范没有分类字段，手动安装列表的分类由飞牛商店目录标签决定。

## 数据、升级与回滚

- 程序位于 `${TRIM_APPDEST}/server`，升级时替换。
- 数据库、设置和日志位于 `${TRIM_PKGVAR}/data`；Terma 管理的 SSH 密钥位于 `${TRIM_PKGVAR}/ssh`。私有目录权限为 0700，敏感文件为 0600，不暴露为共享文件夹。
- 升级前停止应用，检查 SQLite 完整性并将数据、密钥备份到 `${TRIM_PKGVAR}/backups`；升级保留原 Web 密码。
- “设置 → 关于”支持检查版本、查看最近更新日志，并提供与 NAS 架构匹配的 GitHub Release FPK 直连和五条加速下载链接，支持手动测速；检查失败保留已有日志。下载后在应用中心手动安装同一应用标识的新版 FPK 完成升级，不自动安装，也不下载或启动桌面 Linux 安装包。
- 回滚前停止应用，保留当前数据副本，再同时恢复旧 FPK 和与其匹配的升级前数据、密钥快照。不要让旧程序直接读取已发生不兼容迁移的新数据库。
- 卸载脚本本身不主动删除数据，但飞牛的卸载或重装流程可能清理整个私有目录，包括目录内的 `backups`。卸载前必须将完整备份导出到应用目录之外；升级钩子的内部快照不能替代独立备份。

## 功能范围

SSH、终端、SFTP、浏览器 VNC 和转发等使用现有 Web 能力。浏览器本地文件标签可选择当前电脑或 NAS 授权目录；电脑端取决于浏览器授权与安全上下文，NAS 端使用专用应用账号和飞牛授权路径。安装包声明 `terma/files` 共享目录，并开放应用中心的额外目录授权。Electron 原生拖出、原生图形客户端、串口设备访问及定时 SFTP 同步不包含在此包中。数据属于一个应用实例，不提供 NAS 多用户之间的独立凭据隔离。

局域网可直接访问。自行使用 HTTPS 反向代理时，配置准确的 Allowed Hosts，并保留浏览器的 Host 和 Origin。HTTPS 转发到 HTTP 且协议校验保持开启时，填写实际可信代理 IP 并正确转发原始协议；也可关闭来源协议校验，无需填写可信代理 IP。此包尚未接入飞牛统一网关的 Unix Socket 与业务权限。

官方文档：<https://developer.fnnas.com/docs/examples/native>、<https://developer.fnnas.com/docs/cli/fnpack>。
