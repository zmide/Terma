# 版本下载

下载页会从 GitHub Releases 读取最新正式版本，并按操作系统、架构和安装类型筛选资源。默认选择 GitHub 加速线路，也可以随时切换为 GitHub 直连。

<script setup>
import DownloadPanel from '../components/DownloadPanel.vue'
</script>

<DownloadPanel />

## 文件说明

- **Windows 安装版**：通过安装向导安装，可选择安装目录。
- **Windows 便携版**：无需安装，直接运行；运行数据仍会保存到 Terma 的数据目录。
- **macOS DMG**：将 Terma 拖到“应用程序”目录。Intel 选择 `x64`，Apple Silicon 选择 `arm64`。
- **macOS ZIP**：解压后直接运行 `Terma.app`。
- **Linux AppImage / DEB / RPM**：按发行版选择；AppImage 需要先执行 `chmod +x`。
- **SHA256SUMS**：发布文件的校验和，不是安装包。

GitHub 加速由第三方代理提供，线路可能随网络环境变化；加速链接或直连链接都指向同一份 GitHub Release 资源。遇到下载异常时，先切换通道，再核对 SHA256。
