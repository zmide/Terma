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

构建结果位于 `release/`。Windows 会生成安装版和便携版，Linux 会生成 AppImage、DEB、RPM，macOS 会生成 DMG；正式发布时由专用 macOS 签名机完成代码签名和公证。

发布前应在目标平台验证启动、SSH、终端、SFTP、远程桌面和更新检查，并保留对应的第三方许可证文件。

## 飞牛 fnOS

在 Debian 12、Node.js 22 和对应架构的 Linux 构建机上，安装官方 `fnpack` 后执行：

```sh
npm run build
npm run fnos:check
npm run dist:fnos -- --arch x64
```

产物位于 `release/fnos/`，附带 SHA-256 文件。`Build fnOS packages` 同时支持手动运行和被 `Build Releases` 调用。正式 Release 会等待 x64、ARM64 的 FPK 与校验文件全部通过检查，再统一上传并发布；手动构建只生成 Actions 附件。

流程使用 `node:22.23.1-bookworm` 容器，分别在 x64 和 ARM64 运行器上安装、验证原生依赖。由于官方 Linux ARM 版 fnpack 下载地址目前不可用，ARM 构建先生成中间归档，再由 x64 运行器使用校验过 SHA-256 的官方 fnpack 封装。ARM 原生模块不会在 x64 上重新安装。

本地跨机器构建时，在 ARM64 Linux 上执行 `npm run dist:fnos -- --stage-only --arch arm64`，将生成的 `.staging.tar.gz` 复制到同一提交的 x64 Linux 检出，再执行 `npm run dist:fnos -- --pack-staging <归档路径> --arch arm64`。中间归档不作为 Release 附件发布。

安装、升级和数据保留说明见 [飞牛部署](/guide/deployment.html#飞牛-fnos)。
