import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Terma',
  description: '跨平台远程连接工作台文档',
  lang: 'zh-CN',
  lastUpdated: true,
  cleanUrls: false,
  srcExclude: ['README.md'],
  head: [
    ['meta', { name: 'theme-color', content: '#0f766e' }],
    ['link', { rel: 'icon', href: '/terma-icon.png' }],
  ],
  themeConfig: {
    logo: '/terma-icon.png',
    siteTitle: 'Terma 文档',
    nav: [
      { text: '指南', link: '/guide/introduction.html' },
      { text: '功能', link: '/guide/features.html' },
      { text: '下载', link: '/guide/download.html' },
      { text: '部署', link: '/guide/deployment.html' },
      { text: 'GitHub', link: 'https://github.com/zmide/Terma' },
      { text: '问题反馈', link: 'https://github.com/zmide/Terma/issues' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: '开始使用',
          items: [
            { text: '产品简介', link: '/guide/introduction.html' },
            { text: '安装与运行', link: '/guide/installation.html' },
            { text: '版本下载', link: '/guide/download.html' },
            { text: '连接与安全', link: '/guide/security.html' },
          ],
        },
        {
          text: '核心功能',
          items: [
            { text: '全部功能总览', link: '/guide/features.html' },
            { text: '终端工作区', link: '/guide/terminal.html' },
            { text: '连接管理', link: '/guide/connections.html' },
            { text: 'SFTP 文件管理', link: '/guide/sftp.html' },
            { text: '远程桌面与 X11', link: '/guide/remote-desktop.html' },
            { text: '转发与批量运维', link: '/guide/forwarding.html' },
            { text: '终端 AI', link: '/guide/terminal-ai.html' },
          ],
        },
        {
          text: '运维与发布',
          items: [
            { text: 'Web 模式部署', link: '/guide/deployment.html' },
            { text: '构建与打包', link: '/guide/build.html' },
            { text: '数据、更新与迁移', link: '/guide/data-updates.html' },
            { text: '平台与兼容性', link: '/guide/platforms.html' },
            { text: '常见问题', link: '/guide/faq.html' },
          ],
        },
      ],
    },
    outline: { level: [2, 3], label: '本页目录' },
    darkModeSwitchLabel: '主题',
    darkModeSwitchTitle: '切换到暗色主题',
    lightModeSwitchTitle: '切换到亮色主题',
    sidebarMenuLabel: '显示导航',
    returnToTopLabel: '返回顶部',
    lastUpdatedText: '最后更新',
    docFooter: { prev: '上一页', next: '下一页' },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索', buttonAriaLabel: '搜索文档' },
          modal: {
            displayDetails: '显示详细结果',
            resetButtonTitle: '清除搜索',
            backButtonTitle: '关闭搜索',
            noResultsText: '没有找到包含',
            footer: {
              selectText: '选择',
              selectKeyAriaLabel: '回车',
              navigateText: '导航',
              navigateUpKeyAriaLabel: '向上箭头',
              navigateDownKeyAriaLabel: '向下箭头',
              closeText: '关闭',
              closeKeyAriaLabel: 'Esc',
            },
          },
        },
      },
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/zmide/Terma' }],
    footer: {
      message: 'Terma 使用 GPL-3.0-only 许可证发布。',
      copyright: 'Copyright © 2026 zmide',
    },
  },
})
