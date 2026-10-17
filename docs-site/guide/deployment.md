# Web 模式部署

## 飞牛 fnOS

在应用中心手动上传 Terma `.fpk`，选择存储空间并两次输入至少 12 个字符的 Web 密码。安装后从飞牛桌面图标打开独立标签页，或访问 `http://NAS地址:8088`。这里使用独立的 Terma 密码，无需用户名。最低系统版本为 fnOS 1.2.0800，依赖官方 `nodejs_v22`。

保留数据后重新安装，登录密码使用本次安装时填写的值；已有连接和网络设置保留。正常升级继续使用原密码。

服务以专用应用用户运行；所有浏览器访问均需登录。端口由应用包固定，8088 被占用时会明确失败。此包不接入飞牛单点登录或统一网关。

进入“应用中心 → Terma → 应用设置”可重置 Web 密码、指定本机监听 IPv4 地址、允许的访问域名和可信反向代理 IP。字段留空保留当前值；保存后运行中的应用会短暂重启，启动失败则恢复原设置。监听地址不是客户端来源网段，来源网段限制应在防火墙配置。

使用外部域名时，在 Allowed Hosts 中填写准确主机名，不包含 `https://`、路径或通配符。通过 HTTPS 反向代理访问时，只信任实际代理来源 IP 并正确转发协议。被拒绝的访问会显示中英文说明页；若返回飞牛 FN Connect 自身的无权限提示，则需要先在飞牛远程访问中授予该服务访问权限。

应用数据和 SSH 密钥分别位于 `${TRIM_PKGVAR}/data` 与 `${TRIM_PKGVAR}/ssh`，升级前备份到 `${TRIM_PKGVAR}/backups`。通过新版 FPK 升级，保留原密码与配置；回滚需要匹配的旧安装包和升级前数据。卸载前另行导出备份。

升级应通过应用中心上传新版 FPK；不要使用会先卸载的 `appcenter-cli install-local` 替代升级。飞牛卸载或重装可能清理整个应用私有目录，包括其中的 `backups`，因此卸载前必须将完整备份导出到应用目录之外。

在 Terma 的“设置 → 关于”可检查新版本、查看最近版本更新日志，并通过直连或加速线路下载匹配 NAS 架构的 FPK；各线路可手动测速。下载后进入飞牛应用中心选择“手动安装”完成升级；Terma 不会自动安装更新或运行普通 Linux 桌面安装包。检查失败时仍可查看已缓存的更新日志。

飞牛包已支持浏览器“本地文件”标签，可与 SFTP 分屏互传，并选择两种文件来源：

- **当前电脑**：访问浏览器授权的电脑文件夹。支持目录写入的 HTTPS 或 localhost 浏览器可以管理文件并接收远端文件；普通 HTTP 地址提供只读选择和上传，下载由浏览器保存。
- **Terma 所在设备**：管理应用中心授权的 NAS 目录，支持新建、文本编辑、重命名、删除、上传/下载及 SFTP 互传。

详细操作与授权范围见[浏览器本地文件标签](/guide/sftp.html#分屏与任务)。原生拖出到系统文件管理器、调用本机图形客户端与定时 SFTP 同步仍属于桌面专用能力，飞牛包暂不提供；内置 noVNC 可在浏览器中使用。ARM64 安装包已提供，仍需对应设备验收。

## 通用 Web 部署

Terma 可以在 Linux 服务器上以 Web-only 模式运行，再由宝塔、Nginx 或 Caddy 提供 HTTPS 和域名访问。

## 推荐拓扑

```text
浏览器 -> HTTPS 反向代理 -> 127.0.0.1:8088 Terma
```

Terma 只监听本机回环地址，反向代理负责证书、域名和 WebSocket 转发。不要把 8088 直接暴露到公网。

## Nginx 示例

```nginx
location / {
    proxy_pass http://127.0.0.1:8088;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

在 Terma“设置 > 安全”中把代理地址和站点 Host 加入允许列表，并设置 Web 密码或访问 Token。宝塔站点也应开启 WebSocket 支持。

## 启动与检查

```bash
TERMA_WEB_ONLY=1 TERMA_NO_BROWSER=1 ./start.sh --host 127.0.0.1 --port 8088
curl -I http://127.0.0.1:8088/
```

建议使用 systemd、Supervisor 或宝塔进程守护管理 Terma，并将运行数据目录放在权限受限的位置。
