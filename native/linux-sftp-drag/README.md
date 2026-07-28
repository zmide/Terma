# TunnelDesk Linux SFTP 拖出桥

这个辅助程序把一次 SFTP 拖出的票据挂载成短期、只读的 FUSE3 文件系统。Electron 得到真实的本地路径后即可调用 `webContents.startDrag({ files })`；Nautilus、Dolphin、Thunar 等目标程序在用户松手后读取文件时，辅助程序才通过本机 TunnelDesk HTTP 接口读取远端内容。

它不提前下载文件正文，因此多文件和目录可以保持一次拖动。X11 与 Wayland 都复用 Electron 的系统拖放通道，FUSE 层不依赖桌面环境私有的拖放协议。

该桥只供 Linux 桌面端启动。普通 Web 页面没有系统拖放文件提供者，仍只处理不同 SFTP 标签之间的跨主机复制，不能调用本程序或向用户宣称可以拖到系统文件管理器。

## 票据协议

票据地址必须是本机回环 HTTP/HTTPS 地址。辅助程序请求：

```text
GET    /api/sftp/native-drag/:token
GET    /api/sftp/native-drag/:token/content/:index
DELETE /api/sftp/native-drag/:token
```

清单格式见 [schema/manifest-v1.schema.json](schema/manifest-v1.schema.json)。当前服务端响应的核心字段是：

```json
{
  "token": "opaque-token",
  "expires_at": 1785144000000,
  "entries": [
    {
      "index": 0,
      "name": "example.txt",
      "relative_path": "example.txt",
      "type": "file",
      "size": 123,
      "modified_at": 1785143000000,
      "mode": 33188,
      "top_level": true
    }
  ]
}
```

文件读取必须支持单段 `Range: bytes=start-end`，成功返回 `206` 和对应字节。辅助程序会定期重新读取清单，为服务端票据续期；退出时尽力发送 `DELETE`。

## 构建

Debian / Ubuntu：

```bash
sudo apt-get install build-essential cmake pkg-config \
  libfuse3-dev libcurl4-openssl-dev nlohmann-json3-dev
cmake -S native/linux-sftp-drag -B build/linux-sftp-drag \
  -DCMAKE_BUILD_TYPE=Release
cmake --build build/linux-sftp-drag --parallel
ctest --test-dir build/linux-sftp-drag --output-on-failure
```

Fedora：

```bash
sudo dnf install gcc-c++ cmake pkgconf-pkg-config \
  fuse3-devel libcurl-devel nlohmann-json-devel
cmake -S native/linux-sftp-drag -B build/linux-sftp-drag \
  -DCMAKE_BUILD_TYPE=Release
cmake --build build/linux-sftp-drag --parallel
```

产物是 `tunneldesk-linux-sftp-dragfs`。正式打包时应把它作为 Electron 的非 ASAR 资源安装，并保留可执行权限。

## 启动方式

推荐通过额外匿名管道传票据 URL，避免令牌出现在进程命令行中：

```text
tunneldesk-linux-sftp-dragfs --ticket-url-fd 3
```

父进程向文件描述符 3 写入一行 URL 后关闭写端。程序成功挂载后在标准输出写一行 JSON：

```json
{
  "event": "ready",
  "mount_point": "/run/user/1000/tunneldesk/sftp-drag/drag-1234-abcd",
  "paths": [
    "/run/user/1000/tunneldesk/sftp-drag/drag-1234-abcd/example.txt"
  ],
  "lease_seconds": 300
}
```

标准输入保留给父进程发送一行一个的控制命令：

```json
{"command":"renew","seconds":300}
{"command":"release"}
{"command":"cancel"}
{"command":"shutdown"}
```

- `renew`：延长空闲租约。
- `release`：表示 Electron 的拖动已经结束；完整读取会进入短暂收尾，未完整读取则在空闲宽限期后回收。
- `cancel`：把本次拖出标记为用户取消。进行中和后续的文件读取会返回系统的
  `ECANCELED`，辅助程序等待已经打开的句柄释放后再卸载；超过清理宽限期时才强制
  收尾，避免目标程序收到“传输端点未连接”或普通磁盘读取错误。
- `shutdown`：用于程序退出或读取失败，清理语义比普通 `release` 更强。

默认空闲租约为 300 秒。每次目录访问、打开或读取都会续期。FUSE 只向 HTTP 接口请求文件管理器实际读取的字节范围，并记录真正交付的区间；所有项目完整交付后保留约 5 秒收尾时间，再确定性关闭挂载。拖动已经松开但目标停止读取时，即使文件管理器还保留记账句柄，也会在空闲宽限期后退出，避免任务长期停在 99%。

收到 `cancel` 后会先输出 `cancelled`，句柄释放或宽限期结束时输出 `closing`，
完成卸载并释放服务端票据后输出 `closed`。用户取消不会输出 `read-error`；
真正的网络、远端读取和本地服务错误仍按原有错误路径处理。

## 能力探测

```bash
tunneldesk-linux-sftp-dragfs --probe
```

探测会检查 `/dev/fuse`、`fusermount3`、运行时目录，以及当前 X11/Wayland 会话变量，并输出 JSON。探测通过只代表系统具备运行条件，不等于已经完成实际桌面文件管理器拖放验收。

## 运行环境与降级

正式安装包会携带 TunnelDesk 的拖出辅助程序，但 FUSE 内核设备和 `fusermount3` 属于 Linux 系统运行环境，不能由 AppImage 内置或在应用启动时擅自修改。

- Debian / Ubuntu 缺少运行包时安装 `fuse3`。
- Fedora / RHEL 系缺少运行包时安装 `fuse3` 和 `fuse3-libs`。
- `/dev/fuse` 不存在时需启用系统 FUSE 设备；容器或沙箱中还需显式传入 `/dev/fuse`。
- `/dev/fuse` 存在但当前用户不可访问时，应按发行版规则修复设备权限并重新登录，不要把设备长期改成不受限制的权限。

探测失败时，桌面端自动切换到 staged 兼容拖出：跨主机 SFTP 拖动仍直接复制，保存到本机则先准备内容，再拖动一次。用户首次尝试拖出时会看到具体原因、处理建议和当前兼容行为，不会静默失败。

## 安全和生命周期

- 默认只接受 `127.0.0.1`、`::1` 或 `localhost` 票据地址。
- 挂载点创建为当前用户私有目录，文件系统强制只读。
- FUSE 使用 `auto_unmount`，辅助进程异常结束时也由 `fusermount3` 回收挂载。
- 清单拒绝绝对路径、`.`、`..`、NUL、重复路径和类型冲突。
- 每个文件只保留一个固定大小的读取块缓存，最后一个打开句柄关闭后释放。
- HTTP 错误不会把票据 URL 或令牌写入日志。
- 控制管道关闭、父进程异常退出、读取失败和取消都会进入有时间上限的清理；必要时由父进程执行 `SIGTERM` / `SIGKILL` 兜底。
- X11 下已用 KDE Dolphin 验证单文件拖出、系统桌面拖出、取消、跨主机 SFTP 复制，以及辅助进程和 FUSE 挂载回收。

具备 `/dev/fuse` 和 FUSE3 的构建机执行 `ctest` 时，还会运行慢速读取中途取消
集成检查；缺少 FUSE 运行环境时该项会明确跳过，不影响清单和编译检查。

## 验收边界

源码和协议可以在任意平台静态检查，但真实能力必须在 Linux 图形环境验证：

1. X11：至少覆盖 Nautilus、Dolphin 或 Thunar 中一个目标文件管理器。
2. Wayland：至少覆盖当前发行版默认文件管理器。
3. 单文件、多文件、嵌套目录、空文件、大文件与中途取消。
4. Electron 或渲染进程异常退出后，任务不会错误变成 100%，辅助进程和挂载会在上限内清理。
5. 租约结束后挂载点、辅助进程和服务端票据均被回收。

Windows 环境无法编译或挂载 FUSE3；在该环境中只能进行清单验证和源码审查，不能标记为 Linux 真机已验证。
