# 远程桌面与 X11

![Terma 远程桌面工作区](/screenshots/desktop-remote.png)

Terma 将远程图形能力分成远程桌面协议和 SSH 图形转发两类，按平台选择合适的客户端。

## VNC

VNC 默认优先使用随包提供的 TigerVNC Viewer，其次使用内置 noVNC，最后回退到系统客户端。三种方式都可以单独选择；工作区支持重连、全屏和双向文本剪贴板同步。

## RDP、X11 与 XDMCP

- RDP 使用系统原生客户端。
- Windows 桌面包内置并管理 X Server；macOS 使用 XQuartz；Linux 复用当前图形桌面并使用 Xephyr。
- XDMCP 支持直接查询、间接查询和局域网广播，但协议本身不加密，只应在可信局域网使用。
- 远端桌面安装、卸载和修复操作会显示任务进度，管理员凭据只用于当前操作，不会保存。

## 使用建议

远程桌面通常比纯 SSH 暴露更大的攻击面。优先通过私有网络、跳板机或 VPN 访问，不要直接把 VNC、XDMCP 端口暴露到公网。
