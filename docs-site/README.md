# Terma 文档站

这是 Terma 的 VitePress 文档站源码，默认中文，发布目录为 `.vitepress/dist/`。

```bash
npm install
npm run dev
npm run build
npm run preview
```

将 `.vitepress/dist/` 的内容部署到任意静态 Web 根目录即可。当前生产站点由宝塔 Nginx 托管在 `terma.zmide.com`；更新时先完成本地构建，再使用临时目录替换站点目录并保留旧目录备份。

站点只依赖 VitePress，不安装 Terma 后端或桌面端依赖。源码在本机维护；服务器只接收本次构建的静态产物，不上传 `node_modules`、开发脚本或测试证据。旧站点备份放在 Web 根目录之外，不逐次叠加进线上目录。为已缓存的页面保留上一版静态资源，并在站点之外记录当前构建清单，避免兼容资源无限累积。

界面截图复用仓库根目录的 `node scripts/readme-screenshots-harness.js`，从当前已编译前端生成中英文图片；本机终端面板使用现有原生终端验收场景截图。发布前检查截图中的连接、文件和命令均不包含私人信息，将中文图片同步到 `public/screenshots/`，并更新页面的截图版本参数以避免 CDN 长缓存。
