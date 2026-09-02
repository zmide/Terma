<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

type ReleaseAsset = { name: string; size?: number; digest?: string }
type ReleaseInfo = { tag_name: string; name?: string; published_at?: string; assets?: ReleaseAsset[] }

const repository = 'zmide/Terma'
const fallbackTag = 'v1.6.1'
const channel = ref<'accelerated' | 'direct'>('accelerated')
const platform = ref<'windows' | 'macos' | 'linux'>('windows')
const architecture = ref<'x64' | 'arm64'>('x64')
const release = ref<ReleaseInfo>({ tag_name: fallbackTag, assets: [] })
const loading = ref(true)
const error = ref('')

const platformOptions = [
  { value: 'windows', label: 'Windows' },
  { value: 'macos', label: 'macOS' },
  { value: 'linux', label: 'Linux' },
] as const

const definitions = computed(() => {
  if (platform.value === 'windows') {
    return [
      { key: 'installer', label: '安装版', extension: 'exe', filename: `Terma-${version.value}-windows-x64-installer.exe` },
      { key: 'portable', label: '便携版', extension: 'exe', filename: `Terma-${version.value}-windows-x64-portable.exe` },
    ]
  }
  if (platform.value === 'macos') {
    const suffix = architecture.value === 'arm64' ? 'arm64' : 'x64'
    return [
      { key: 'dmg', label: '安装镜像', extension: 'dmg', filename: `Terma-${version.value}-macos-${suffix}.dmg` },
      { key: 'zip', label: '免安装压缩包', extension: 'zip', filename: `Terma-${version.value}-macos-${suffix}.zip` },
    ]
  }
  return [
    { key: 'appimage', label: 'AppImage', extension: 'AppImage', filename: `Terma-${version.value}-linux-x86_64.AppImage` },
    { key: 'deb', label: 'DEB', extension: 'deb', filename: `Terma-${version.value}-linux-amd64.deb` },
    { key: 'rpm', label: 'RPM', extension: 'rpm', filename: `Terma-${version.value}-linux-x86_64.rpm` },
  ]
})

const version = computed(() => String(release.value.tag_name || fallbackTag).replace(/^v/i, ''))
const releaseTag = computed(() => String(release.value.tag_name || fallbackTag).replace(/[^\w.-]/g, ''))
const releasePage = computed(() => `https://github.com/${repository}/releases/tag/${releaseTag.value}`)
const channelLabel = computed(() => channel.value === 'accelerated' ? 'GitHub 加速' : 'GitHub 直连')
const checksumName = computed(() => 'SHA256SUMS')

function assetByName(name: string) {
  return (release.value.assets || []).find(asset => asset?.name === name)
}

function directUrl(name: string) {
  return `https://github.com/${repository}/releases/download/${releaseTag.value}/${encodeURIComponent(name)}`
}

function assetUrl(name: string) {
  const direct = directUrl(name)
  return channel.value === 'accelerated' ? `https://ghfast.top/${direct}` : direct
}

function formatSize(size?: number) {
  const bytes = Number(size || 0)
  if (!bytes) return 'GitHub 发布时显示'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${Math.max(1, Math.round(bytes / 1024))} KiB`
}

function setPlatform(value: typeof platform.value) {
  platform.value = value
  if (value !== 'macos') architecture.value = 'x64'
}

function onPlatformChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'windows' || value === 'macos' || value === 'linux') setPlatform(value)
}

onMounted(async () => {
  const userAgent = navigator.userAgent.toLowerCase()
  if (userAgent.includes('mac')) {
    platform.value = 'macos'
    architecture.value = userAgent.includes('arm') ? 'arm64' : 'x64'
  } else if (userAgent.includes('linux')) {
    platform.value = 'linux'
  }
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json() as ReleaseInfo
    if (!/^v?\d+\.\d+\.\d+/.test(String(data.tag_name || ''))) throw new Error('invalid release')
    release.value = data
  } catch {
    error.value = 'GitHub 最新版本暂时读取失败，已保留当前版本的下载链接；也可以打开 Release 页面查看所有版本。'
  } finally {
    loading.value = false
  }
})
</script>

<template>
<div class="terma-download-panel">
  <div class="terma-download-toolbar">
    <label>
      <span>下载通道</span>
      <select v-model="channel">
        <option value="accelerated">GitHub 加速</option>
        <option value="direct">GitHub 直连</option>
      </select>
    </label>
    <label>
      <span>操作系统</span>
      <select :value="platform" @change="onPlatformChange">
        <option v-for="item in platformOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
      </select>
    </label>
    <label v-if="platform === 'macos'">
      <span>架构</span>
      <select v-model="architecture">
        <option value="x64">Intel x64</option>
        <option value="arm64">Apple Silicon arm64</option>
      </select>
    </label>
  </div>

  <div class="terma-download-release">
    <div>
      <span class="terma-download-kicker">当前版本</span>
      <strong>{{ releaseTag }}</strong>
      <small v-if="release.published_at">发布于 {{ new Date(release.published_at).toLocaleDateString('zh-CN') }}</small>
    </div>
    <a :href="releasePage" target="_blank" rel="noopener">查看 GitHub Release</a>
  </div>

  <div v-if="loading" class="terma-download-state">正在读取 GitHub 最新 Release…</div>
  <div v-if="error" class="terma-download-note">{{ error }}</div>

  <div class="terma-download-table" role="table" :aria-label="platform + ' 下载列表'">
    <div class="terma-download-row terma-download-head" role="row">
      <span>类型</span><span>文件</span><span>大小</span><span>操作</span>
    </div>
    <div v-for="item in definitions" :key="item.key" class="terma-download-row" role="row">
      <strong>{{ item.label }}</strong>
      <code>{{ item.filename }}</code>
      <span>{{ formatSize(assetByName(item.filename)?.size) }}</span>
      <a :href="assetUrl(item.filename)" target="_blank" rel="noopener" class="terma-download-action">下载</a>
    </div>
    <div class="terma-download-row" role="row">
      <strong>校验文件</strong>
      <code>{{ checksumName }}</code>
      <span>{{ formatSize(assetByName(checksumName)?.size) }}</span>
      <a :href="assetUrl(checksumName)" target="_blank" rel="noopener" class="terma-download-action">下载</a>
    </div>
  </div>

  <div class="terma-download-footer">
    <span>当前通道：{{ channelLabel }}。加速线路不可用时可切换到直连。</span>
    <span>下载后建议使用 <code>SHA256SUMS</code> 校验文件完整性。</span>
  </div>
</div>
</template>
