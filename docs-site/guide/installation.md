# 安装与运行

## 使用发布包

从 [GitHub Releases](https://github.com/zmide/Terma/releases) 下载对应平台的安装包：

- Windows：安装版或便携版。
- macOS：DMG 或 ZIP；Intel 选择 `x64`，Apple Silicon 选择 `arm64`。
- Linux：AppImage、DEB 或 RPM。

首次启动后，在“设置 > 安全”中配置 Web 密码或访问 Token（自托管 Web 模式尤其重要）。

## 从源码运行

需要 Node.js 22 或更高版本、Git 和 OpenSSH 客户端：

```bash
git clone https://github.com/zmide/Terma.git
cd Terma
npm install
npm run build
```

桌面端开发运行：

```bash
npm run desktop:run
```

## Web-only 模式

在无图形环境或服务器上运行：

```bash
TERMA_WEB_ONLY=1 ./start.sh --host 127.0.0.1 --port 8088
```

通过反向代理对外提供服务时，建议让 Terma 只监听 `127.0.0.1`，由 Nginx、Caddy 或宝塔站点代理，并在 Terma 中配置可信代理 IP 和精确 Host。详见[Web 模式部署](/guide/deployment.html)。

## 常用环境变量

| 变量 | 作用 |
| --- | --- |
| `TERMA_WEB_ONLY=1` | 只启动 Web 服务 |
| `TERMA_NO_BROWSER=1` | 不自动打开浏览器 |
| `TERMA_DATA_DIR` | 覆盖运行数据目录 |
| `TERMA_SSH_DIR` | 覆盖 SSH 密钥目录 |
| `TERMA_RESET_WEB_ACCESS=1` | 重置 Web 密码和访问 Token |
| `TUNNEL_WEB_HOST` / `TUNNEL_WEB_PORT` | 覆盖监听地址或端口，默认端口为 8088 |
