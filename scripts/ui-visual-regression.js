const fs = require("node:fs");
const path = require("node:path");

function imageStats(image) {
  const {width, height} = image.getSize();
  const bitmap = image.toBitmap();
  const colors = new Set();
  const stepX = Math.max(1, Math.floor(width / 80));
  const stepY = Math.max(1, Math.floor(height / 60));
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const offset = (y * width + x) * 4;
      colors.add(`${bitmap[offset + 2]},${bitmap[offset + 1]},${bitmap[offset]}`);
    }
  }
  return {width, height, sampled_colors:colors.size, nonblank:colors.size >= 8};
}

async function waitForViewport(window, width) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await window.webContents.executeJavaScript(`Math.abs(window.innerWidth-${Number(width)})<=24`)) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}

async function capture(window, name) {
  await new Promise(resolve => setTimeout(resolve, 80));
  const layout = await window.webContents.executeJavaScript(`(() => ({
    width:innerWidth,
    height:innerHeight,
    bodyWidth:document.body.scrollWidth,
    overflow:document.body.scrollWidth>innerWidth+1,
    textOverflow:[...document.querySelectorAll('button,.tab,.toolbar')].some(node=>node.scrollWidth>node.clientWidth+2 && getComputedStyle(node).overflow==='visible')
  }))()`);
  const image = await window.webContents.capturePage();
  const stats = {...imageStats(image), ...layout};
  if (!stats.nonblank) throw new Error(`视觉回归 ${name} 截图为空白或颜色异常`);
  if (stats.overflow) throw new Error(`视觉回归 ${name} 出现页面横向溢出`);
  const directory = process.env.TUNNELDESK_UI_VISUAL_DIR;
  if (directory) {
    fs.mkdirSync(directory, {recursive:true});
    fs.writeFileSync(path.join(directory, `${name}.png`), image.toPNG());
  }
  return stats;
}

async function runVisualRegression(window) {
  const previous = window.getContentSize();
  const states = {};
  window.setContentSize(1180, 760);
  await waitForViewport(window, 1180);
  await window.webContents.executeJavaScript("applyTheme('light')");
  states.light = await capture(window, "light-desktop");
  await window.webContents.executeJavaScript("applyTheme('dark')");
  states.dark = await capture(window, "dark-desktop");
  const localFilesFixture = await window.webContents.executeJavaScript(`(async () => {
    try {
    window.__visualRegressionOriginalApi = api;
    window.__visualRegressionHadDesktopBridge = Object.prototype.hasOwnProperty.call(window, 'tunnelDeskDesktop');
    window.__visualRegressionDesktopBridge = window.tunnelDeskDesktop;
    window.tunnelDeskDesktop = {capabilities:{platform:'win32'}};
    api = async path => {
      if (String(path).startsWith('/api/local-files')) {
        return {
          kind:'computer',
          path:'',
          display_path:'此电脑',
          parent:'',
          parent_kind:'none',
          entries:[
            {name:'系统 (C:)',path:'C:/',type:'drive',size:536870912000,free:214748364800,mtime:null},
            {name:'软件 (D:)',path:'D:/',type:'drive',size:1073741824000,free:429496729600,mtime:null},
            {name:'资料 (E:)',path:'E:/',type:'drive',size:2147483648000,free:858993459200,mtime:null}
          ],
          page:1,
          page_size:100,
          total:3,
          total_pages:1
        };
      }
      return window.__visualRegressionOriginalApi(path);
    };
    const localKey = await openLocalFiles(LOCAL_FILES_COMPUTER_PATH, true, 'visual-local-files');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const root = document.querySelector('[data-local-files-tab-key="visual-local-files"]');
    const view = root?.closest('#view-local-files');
    const list = root?.querySelector('.local-files-list');
    const top = root?.querySelector('.local-files-top');
    const pager = root?.querySelector('.sftp-pager-dock');
    const breadcrumb = root?.querySelector('.local-files-breadcrumb');
    const listRect = list?.getBoundingClientRect();
    const pagerRect = pager?.getBoundingClientRect();
    const toolbarHost = document.createElement('div');
    toolbarHost.innerHTML = localFilesToolbarButtonHtml(localKey);
    const toolbarButton = toolbarHost.querySelector('button');
    const originalViewStyle = view?.getAttribute('style') || '';
    if (view) view.style.cssText += ';width:500px;max-width:500px;flex:0 0 500px';
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const narrowToolbar = root?.querySelector('.local-files-toolbar-actions');
    const narrowPager = root?.querySelector('.sftp-pager');
    const narrowToolbarGrid = getComputedStyle(narrowToolbar).display === 'grid';
    const narrowPagerRows = getComputedStyle(narrowPager).gridTemplateColumns.split(' ').length === 2;
    if (view) view.setAttribute('style', originalViewStyle);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      localKey,
      found:Boolean(root && view && list && top && pager && breadcrumb),
      iconOnly:Boolean(toolbarButton && !toolbarButton.textContent.trim() && toolbarButton.querySelector('svg') && toolbarButton.title === '新建本地文件标签'),
      stickyTop:getComputedStyle(top).position === 'sticky',
      breadcrumbComputer:breadcrumb?.textContent.replace(/\\s+/g,' ').trim() === '此电脑',
      driveRows:root?.querySelectorAll('.local-files-row.is-drive').length === 3,
      searchClear:Boolean(root?.querySelector('.local-files-search button[aria-label="清除搜索"]')),
      pagerDocked:Boolean(listRect && pagerRect && pagerRect.bottom <= listRect.bottom + 1 && pagerRect.bottom >= listRect.bottom - 100),
      noOverflow:document.body.scrollWidth <= window.innerWidth + 1,
      narrowToolbarGrid,
      narrowPagerRows
    };
    } catch (error) {
      return {error:String(error?.stack || error)};
    }
  })()`);
  if (localFilesFixture.error || Object.entries(localFilesFixture).some(([key, value]) => key !== 'localKey' && value !== true)) {
    throw new Error(`本地文件视觉回归失败：${JSON.stringify(localFilesFixture)}`);
  }
  states.localFiles = {...await capture(window, "local-files"), ...localFilesFixture};
  const workspaceGroupFixture = await window.webContents.executeJavaScript(`(() => {
    try {
    const localKey = 'visual-local-files';
    const other = workspaceAllTabs().find(tab => tab.key !== localKey && tab.kind);
    if (!other) return {found:false, selected:false, confirmEnabled:false};
    beginWorkspaceGroupSelection(localKey);
    toggleWorkspaceTabSelection(other.key);
    const bar = document.querySelector('.workspace-group-bar');
    const confirm = bar?.querySelector('.workspace-group-actions button.primary');
    return {
      found:Boolean(bar && !bar.hidden && bar.querySelector('.workspace-group-selection')),
      selected:document.querySelectorAll('.tab.multi-selected').length === 2,
      confirmEnabled:Boolean(confirm && !confirm.disabled)
    };
    } catch (error) {
      return {error:String(error?.stack || error)};
    }
  })()`);
  if (workspaceGroupFixture.error || Object.values(workspaceGroupFixture).some(value => value !== true)) {
    throw new Error(`工作区组合视觉回归失败：${JSON.stringify(workspaceGroupFixture)}`);
  }
  states.workspaceGroupSelection = {...await capture(window, "workspace-group-selection"), ...workspaceGroupFixture};
  await window.webContents.executeJavaScript(`(() => {
    cancelWorkspaceGroupSelection();
    closeTabsByKey(['visual-local-files'], 'visual-local-files');
    api = window.__visualRegressionOriginalApi;
    if (window.__visualRegressionHadDesktopBridge) window.tunnelDeskDesktop = window.__visualRegressionDesktopBridge;
    else delete window.tunnelDeskDesktop;
    delete window.__visualRegressionOriginalApi;
    delete window.__visualRegressionHadDesktopBridge;
    delete window.__visualRegressionDesktopBridge;
  })()`);
  await window.webContents.executeJavaScript(`(() => {
    const fixture=document.createElement('div');
    fixture.id='visualRegressionSplit';
    fixture.style.cssText='position:fixed;inset:0;z-index:2147483000;background:var(--bg);padding:18px;display:grid;grid-template-columns:1fr 6px 1fr;gap:0';
    fixture.innerHTML='<section style="min-width:0;background:var(--panel);border:1px solid var(--line);padding:14px"><strong>终端分屏</strong><pre style="white-space:pre-wrap">root@server:~# uptime\\ncommand completed</pre></section><i style="background:var(--line)"></i><section style="min-width:0;background:var(--panel);border:1px solid var(--line);padding:14px"><strong>SFTP 分屏</strong><div style="margin-top:14px;border-top:1px solid var(--line);padding:10px">config.yml</div><div style="border-top:1px solid var(--line);padding:10px">release</div></section>';
    document.body.appendChild(fixture);
  })()`);
  states.split = await capture(window, "recursive-split");
  await window.webContents.executeJavaScript("document.getElementById('visualRegressionSplit')?.remove();applyTheme('light')");
  window.setContentSize(720, 720);
  await waitForViewport(window, 720);
  states.narrow = await capture(window, "narrow-window");
  window.setContentSize(390, 844);
  await waitForViewport(window, 390);
  states.mobile = await capture(window, "mobile");
  window.setContentSize(previous[0], previous[1]);
  await waitForViewport(window, previous[0]);
  return states;
}

module.exports = { runVisualRegression };
