# Terma 文档站

这是 Terma 的 VitePress 文档站源码，默认中文，发布目录为 `.vitepress/dist/`。

```bash
npm install
npm run dev
npm run build
npm run preview
```

将 `.vitepress/dist/` 的内容部署到任意静态 Web 根目录即可。当前生产站点由宝塔 Nginx 托管在 `terma.zmide.com`；更新时先完成本地构建，再使用临时目录替换站点目录并保留旧目录备份。
