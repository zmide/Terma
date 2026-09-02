# 构建与打包

## 本地构建

```bash
npm install
npm run build
npm run check
```

## 桌面端打包

桌面包包含各平台的原生拖放模块；Windows 还会准备 X Server 和 TigerVNC 运行时。常用命令：

```bash
npm run dist
```

构建结果位于 `release/`。Windows 会生成安装版和便携版，Linux 会生成 AppImage、DEB、RPM，macOS 会生成 DMG 和 ZIP。

发布前应在目标平台验证启动、SSH、终端、SFTP、远程桌面和更新检查，并保留对应的第三方许可证文件。
