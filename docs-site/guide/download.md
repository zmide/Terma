# 版本下载

下载页会从 GitHub Releases 读取最新正式版本，并按操作系统、架构和安装类型筛选资源。默认选择 GitHub 加速线路，也可以随时切换为 GitHub 直连。

<script setup>
import DownloadPanel from '../components/DownloadPanel.vue'
</script>

<DownloadPanel />

## 文件说明

从 v1.7.10 起，飞牛 FPK 纳入 [GitHub Actions 发布构建流程](/guide/build.html#飞牛-fnos)，GitHub Release 附件提供 x64、ARM64 包及对应 `.sha256`，并计入 `SHA256SUMS`。安装方式见[飞牛部署](/guide/deployment.html#飞牛-fnos)。

- **Windows 安装版**：通过安装向导安装，可选择安装目录。
- **Windows 便携版**：无需安装，直接运行；运行数据仍会保存到 Terma 的数据目录。
- **macOS DMG**：发布包已完成代码签名和公证；将 Terma 拖到“应用程序”目录。Intel 选择 `x64`，Apple Silicon 选择 `arm64`。
- **Linux AppImage / DEB / RPM**：按发行版选择；AppImage 需要先执行 `chmod +x`。
- **飞牛 fnOS FPK**：按 NAS 处理器选择 x64 或 ARM64，在应用中心手动安装。首次安装设置独立 Web 密码，正常升级保留原密码与数据。
- **SHA256SUMS**：发布文件的校验和，不是安装包。

GitHub 加速由第三方代理提供，线路可能随网络环境变化；加速链接或直连链接都指向同一份 GitHub Release 资源。遇到下载异常时，先切换通道，再核对 SHA256。
