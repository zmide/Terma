# 平台与兼容性

![Terma Linux 桌面管理](/screenshots/desktop-linux-management.png)

## 桌面端

| 平台 | 桌面端 | Web 模式 | 发布产物 |
| --- | --- | --- | --- |
| Windows 10/11 | 支持 | 支持 | 安装版、便携版 |
| macOS | 支持 | 支持 | DMG、ZIP |
| Linux | 支持 | 支持 | AppImage、DEB、RPM |
| Termux / 无图形 Linux | 不建议 | 支持 | 源码运行 |

## 图形组件

- Windows 桌面包内置并管理 X Server 和 TigerVNC Viewer。
- macOS 使用 XQuartz；Linux 使用当前图形桌面和 Xephyr。
- macOS X11/XDMCP 需要 XQuartz；Linux X11 需要 `DISPLAY`、`xauth` 和 Xephyr。
- RDP 使用系统原生客户端；VNC 自动模式使用 TigerVNC 并回退系统客户端，内置 noVNC 可按连接手动选择。

## 无图形环境

服务器或 Termux 建议运行 Web-only 模式，只需要 Node.js、npm、Git 和 OpenSSH。桌面专用能力会隐藏或降级，不影响 SSH、终端、SFTP 和转发等核心功能。
