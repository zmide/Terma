# 构建与打包

## 本地构建

```bash
npm install
npm run build
npm run check
```

源码桌面启动会按需构建原生 SFTP 拖拽组件。组件下载或编译失败不会阻止启动，拖出文件使用可用的暂存下载后备方式；可以执行 `npm run native:build:required` 查看并重试完整构建。

Windows/macOS 构建复用 Electron 头文件缓存，默认原站准备失败后尝试 npmmirror，仍保留 TLS 和文件校验，不受全局 npm 的 Node.js `disturl` 影响。需要自定义下载地址时设置 `TERMA_ELECTRON_HEADERS_URL`；本地 node-gyp `nodedir` 配置仍有效。

## 桌面端打包

桌面包包含各平台的原生拖放模块；Windows 还会准备 X Server 和 TigerVNC 运行时。常用命令：

```bash
npm run dist
```

构建结果位于 `release/`。Windows 会生成安装版和便携版，Linux 会生成 AppImage、DEB、RPM，macOS 会生成 DMG 和 ZIP。

发布前应在目标平台验证启动、SSH、终端、SFTP、远程桌面和更新检查，并保留对应的第三方许可证文件。
