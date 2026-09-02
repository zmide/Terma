# Web 模式部署

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
