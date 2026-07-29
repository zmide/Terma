# TunnelDesk

TunnelDesk 是一个面向桌面端和自托管 Web 的 SSH 工作台，用于集中管理 SSH 连接、终端、SFTP、端口转发和批量命令。

[下载最新版本](https://github.com/zmide/tunneldesk/releases/latest) · [查看版本记录](https://github.com/zmide/tunneldesk/releases) · [GPL-3.0 许可](LICENSE)

<p align="center">
  <img src=".github/assets/screenshots/desktop-overview.png" alt="TunnelDesk 主页总览" width="100%">
</p>

## 界面预览

<table>
  <tr>
    <td width="50%"><strong>终端</strong><br><img src=".github/assets/screenshots/desktop-terminal.png" alt="TunnelDesk 终端"></td>
    <td width="50%"><strong>SFTP</strong><br><img src=".github/assets/screenshots/desktop-sftp.png" alt="TunnelDesk SFTP"></td>
  </tr>
  <tr>
    <td colspan="2"><strong>端口转发</strong><br><img src=".github/assets/screenshots/desktop-forwarding.png" alt="TunnelDesk 端口转发"></td>
  </tr>
</table>

## 项目特点

- 一套数据同时服务 Electron 桌面端、浏览器和移动端 Web，不需要维护两份连接配置。
- SSH 连接、终端、SFTP、隧道转发和批量运维集中在同一个多标签工作区。
- 支持 Windows、macOS 和 Linux 桌面包，也可在 Linux 服务器或 Termux 中以 Web 模式运行。
- 支持私钥和密码登录、配置加密、数据库备份恢复、SSH config 导入导出。
- 默认仅监听本机地址，局域网访问可启用密码、会话管理和可信代理策略。

## 核心功能

### SSH 与工作区

- SSH 连接分组、搜索、标签、排序、批量修改和健康检查。
- 支持私钥或密码认证，可读取用户 `~/.ssh` 和运行数据目录中的密钥。
- 工作区多标签、拖动排序、会话恢复和桌面端递归分屏，可反复上下左右拆分并调整比例。
- 服务器基础信息、运行状态和监听端口检查。

### 终端

- 多会话 Web 终端，优先使用本地 PTY，不可用时自动回退到 SSH 远程 PTY。
- UTF-8、GB18030/GBK、Big5、Shift_JIS、EUC-KR、ISO-8859-1 编码切换。
- 字体、字号、行距和字重可按连接保存，支持 `Ctrl + 鼠标滚轮` 调整字号。
- 最近命令、快捷键栏、右键操作、终端日志和交互延迟显示。
- 移动端提供 Esc、Tab、方向键、Ctrl 组合键和命令输入栏。

### SFTP

- 文件和目录浏览、搜索、排序、分页、收藏、上传、下载和在线文本编辑。
- 新建、重命名、删除、回收站、权限与所有者修改、压缩和解压。
- 后台传输任务支持进度、速度、暂停、继续、重试和历史记录。
- 文件名编码和文本内容编码独立设置，兼容常见中日韩传统编码。
- 支持同主机复制移动，以及在两台 SSH 主机之间直接流式复制。
- 终端与 SFTP 可按当前连接互相跳转。

### 转发与批量运维

- 本地转发 `-L`、远程转发 `-R` 和 SOCKS5 动态代理 `-D`。
- 每条转发规则独立启停，可使用模板、自动重连和启动恢复。
- 正在转发页面集中展示服务地址、运行状态和异常信息。
- 批量命令可选择多台主机执行，支持命令模板和 TXT/JSON 结果导出。

### 数据与更新

- SQLite 保存连接、转发、设置和任务状态。
- 数据库备份恢复、配置快照和加密迁移包。
- 数据库恢复时可重新绑定私钥或补充密码，不要求旧机器路径保持一致。
- 桌面端可检查 GitHub Releases，并按系统、架构和安装类型选择更新文件；下载前会自动比较直连和可用加速线路，优先使用较快线路并在失败时换线，安装包仍会校验 SHA-256。

## 架构

```text
Electron 桌面端 ─┐
浏览器 / 手机 ───┼─> Web UI（public/）
                 │        │ HTTP / WebSocket
                 └─> Node.js 服务（src/ -> dist/）
                          ├─ SSH / PTY / 端口转发
                          ├─ SFTP / 后台任务
                          ├─ SQLite / 日志 / 备份
                          └─ 更新与运行设置
```

桌面端只是同一套 Web UI 和 Node.js 服务的 Electron 容器，因此桌面端与 Web 模式使用相同的数据结构和功能实现。

| 目录 | 说明 |
| --- | --- |
| `src/` | TypeScript 后端、SSH、终端、SFTP、认证和数据服务 |
| `public/` | 原生 HTML、CSS 和 JavaScript 前端 |
| `desktop/` | Electron 主进程、预加载脚本和桌面图标 |
| `scripts/` | 启停、测试、依赖检查、打包和发布辅助脚本 |
| `data/` | 源码运行时的本地数据库、设置、日志和密钥目录 |
| `.github/workflows/` | Release 跨平台构建流程 |

## 平台支持

| 平台 | 桌面端 | Web 模式 | 发布产物 |
| --- | --- | --- | --- |
| Windows 10/11 | 支持 | 支持 | 安装版、便携版 |
| macOS | 支持 | 支持 | DMG 安装镜像、ZIP 免安装运行包 |
| Linux | 支持 | 支持 | AppImage、DEB、RPM |
| Termux / 无图形 Linux | 不建议 | 支持 | 源码运行 |

## 运行要求

- Node.js 22 或更高版本
- npm
- Git（从仓库获取源码时）
- OpenSSH 客户端，命令行可执行 `ssh`

从源码运行前获取项目：

```sh
git clone https://github.com/zmide/tunneldesk.git
cd tunneldesk
```

启动脚本会检查 `package.json` 和 `package-lock.json`。依赖缺失或清单发生变化时会自动执行安装，然后编译并启动程序。

## 从源码运行

### Windows

```bat
start.bat
stop.bat
```

### Linux / macOS

```sh
chmod +x start.sh stop.sh
./start.sh
./stop.sh
```

有图形环境时启动脚本会优先打开桌面端；Electron 不可用或明确启用 Web-only 时会运行后台 Web 服务。默认访问地址为：

```text
http://127.0.0.1:8088
```

### Termux / 无图形服务器

Termux 首次准备环境：

```sh
pkg update
pkg upgrade
pkg install git nodejs openssh
```

启动 Web 模式：

```sh
chmod +x start.sh stop.sh
TUNNELDESK_WEB_ONLY=1 ./start.sh
./stop.sh
```

Termux 和无图形 Linux 不打包桌面程序；`start.sh` 会自动检查依赖、编译源码并启动 Web 服务。

### 局域网访问

推荐在“设置 > 启动与运行”中选择监听地址并设置 Web 密码。也可以临时使用：

```sh
TUNNELDESK_LAN=1 ./start.sh
# 或
TUNNELDESK_WEB_ONLY=1 ./start.sh --host 0.0.0.0 --port 8088
```

常用环境变量：

| 变量 | 作用 |
| --- | --- |
| `TUNNELDESK_WEB_ONLY=1` | 只启动 Web 服务 |
| `TUNNELDESK_LAN=1` | 临时监听全部 IPv4 网卡 |
| `TUNNEL_WEB_HOST` | 指定监听地址 |
| `TUNNEL_WEB_PORT` | 指定监听端口，默认 `8088` |

## 开发与验证

```sh
npm install --include=dev
npm run build
npm run native:build:if-needed
npm run desktop:run
```

常用检查：

```sh
npm run check:strict
npm run regression
npm run ui:smoke
```

## 桌面端编译与打包

桌面包包含各平台的 SFTP 原生拖放模块，因此必须在对应系统构建。先准备工具链：

- Windows：Visual Studio 2022 C++ Build Tools（“使用 C++ 的桌面开发”）。
- Linux（Debian / Ubuntu）：`build-essential cmake fuse3 libcurl4-openssl-dev libfuse3-dev nlohmann-json3-dev pkg-config rpm`。
- macOS：Xcode Command Line Tools，可执行 `xcode-select --install` 安装。

在当前平台安装依赖并生成安装包：

```sh
npm ci
npm run dist
```

指定平台和产物：

```sh
# Windows x64：安装版与便携版
npm run dist -- --win nsis portable --x64 --publish never

# Linux x64：AppImage、DEB、RPM
npm run dist -- --linux AppImage deb rpm --x64 --publish never

# macOS：Intel 与 Apple Silicon
npm run dist -- --mac dmg zip --x64 --arm64 --publish never
```

构建结果位于 `release/`。各平台运行方式：

- Windows 安装版：运行 `*-installer.exe` 并按向导安装；便携版直接运行 `*-portable.exe`。
- Linux：AppImage 执行 `chmod +x release/*.AppImage` 后即可运行；DEB、RPM 使用系统包管理器安装。
- macOS DMG：打开与机器架构对应的 `.dmg`，将 TunnelDesk 拖入“应用程序”后启动。
- macOS ZIP：解压后可直接运行 `TunnelDesk.app`，无需安装；它只表示应用免安装，运行数据仍保存在系统用户数据目录。Intel 选择 `x64`，Apple Silicon 选择 `arm64`。

推送 `v*` 标签时，Release 工作流会在 Windows、Linux 和 macOS 上分别构建并验证产物。

## 数据与安全

- 源码运行和 Windows 便携版默认使用项目内 `data/`；安装版默认使用系统用户数据目录，可在设置中迁移到其他位置。
- SSH 密码、私钥路径、访问 Token 和数据库备份属于敏感数据，请保护运行数据目录并按需启用配置加密。
- 服务默认只监听 `127.0.0.1`。局域网访问应设置 Web 密码；远程访问建议通过 Tailscale、ZeroTier、WireGuard 等私有网络。
- 不建议将 TunnelDesk 直接暴露到公网。它可以操作终端、SFTP、隧道、密钥和备份，风险高于普通只读管理页面。
- 不要提交 `data/`、`.ssh/`、日志或数据库备份。

## 许可

TunnelDesk 使用 [GNU General Public License v3.0](LICENSE) 发布。
