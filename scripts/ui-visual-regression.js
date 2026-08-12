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
  const directory = process.env.TERMA_UI_VISUAL_DIR || process.env.TUNNELDESK_UI_VISUAL_DIR;
  if (directory) {
    fs.mkdirSync(directory, {recursive:true});
    fs.writeFileSync(path.join(directory, `${name}.png`), image.toPNG());
  }
  return stats;
}

async function rememberVisualTheme(window) {
  await window.webContents.executeJavaScript(`(() => {
    window.__termaVisualRegressionTheme = {
      theme:document.documentElement.dataset.theme || preferredTheme(),
      storedTheme:localStorage.getItem('theme'),
      appearance:normalizeTermaAppearanceSettings(termaAppearanceSettings),
      storedAppearance:localStorage.getItem('termaAppearanceV1')
    };
  })()`);
}

async function applyLuminousVisualTheme(window, theme) {
  const result = await window.webContents.executeJavaScript(`(async () => {
    applyTheme(${JSON.stringify(theme)});
    applyTermaAppearanceSettings(TERMA_APPEARANCE_PRESETS.luminous);
    showPrimary('connections');
    syncTermaLiquidNavigation();
    const started = performance.now();
    let tracks = [];
    let lensReady = [];
    do {
      await new Promise(resolve => requestAnimationFrame(resolve));
      tracks = [...document.querySelectorAll('.activity-top,.side-nav,.mobile-tabs')]
        .filter(track => {
          const style = getComputedStyle(track);
          const rect = track.getBoundingClientRect();
          return style.display !== 'none'
            && style.visibility !== 'hidden'
            && rect.width > 0
            && rect.height > 0
            && track.querySelector('button.active:not([hidden])');
        });
      tracks.forEach(scheduleTermaLiquidTrack);
      lensReady = tracks.map(track => {
        const lenses = track.querySelectorAll(':scope > .terma-liquid-lens');
        const rect = lenses[0]?.getBoundingClientRect();
        return lenses.length === 1 && Boolean(rect && rect.width > 0 && rect.height > 0);
      });
    } while ((tracks.length === 0 || !lensReady.every(Boolean)) && performance.now() - started < 800);
    const rootStyle = getComputedStyle(document.documentElement);
    return {
      theme:document.documentElement.dataset.theme,
      appearancePreset:document.documentElement.dataset.appearancePreset,
      frostedEnabled:!document.documentElement.classList.contains('terma-frosted-disabled'),
      liquidEnabled:document.documentElement.classList.contains('terma-liquid-enabled'),
      frostedBlur:rootStyle.getPropertyValue('--terma-frosted-backdrop-blur').trim(),
      visibleTracks:tracks.length,
      sharedLensesReady:tracks.length > 0 && lensReady.every(Boolean)
    };
  })()`);
  if (result.theme !== theme || result.appearancePreset !== "luminous" || !result.frostedEnabled || !result.liquidEnabled || !result.sharedLensesReady) {
    throw new Error(`流光玻璃视觉状态未就绪：${JSON.stringify(result)}`);
  }
  return result;
}

async function openVisualModal(window) {
  return window.webContents.executeJavaScript(`(async () => {
    const modal = document.getElementById('modal');
    if (!modal?.hidden || modal?.innerHTML.trim()) return {ready:false, reason:'modal-not-clean'};
    openGroupModal(() => {});
    modal.dataset.visualRegressionModal = '1';
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const card = modal.querySelector(':scope > .modal-card');
    const nodes = [modal, card, ...(card ? card.querySelectorAll('*') : [])].filter(Boolean);
    const blurNodes = nodes.filter(node => {
      const style = getComputedStyle(node);
      const filter = String(style.backdropFilter || '') + ' ' + String(style.getPropertyValue('-webkit-backdrop-filter') || '');
      return filter.includes('blur(') && !filter.includes('blur(0px)');
    });
    const rect = card?.getBoundingClientRect();
    return {
      ready:Boolean(card && !modal.hidden),
      productionModal:Boolean(card?.querySelector('#modalGroupName') && card?.querySelector('[data-action="connection-group-save"]')),
      singleGlassSurface:blurNodes.length === 1 && blurNodes[0] === card,
      overlayDoesNotBlur:!blurNodes.includes(modal),
      cardWithinViewport:Boolean(rect && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1),
      blurNodeCount:blurNodes.length
    };
  })()`);
}

async function closeVisualModal(window) {
  await window.webContents.executeJavaScript(`(() => {
    const modal = document.getElementById('modal');
    if (modal?.dataset.visualRegressionModal === '1') {
      delete modal.dataset.visualRegressionModal;
      closeModal();
    }
  })()`);
}

async function captureVisualModal(window, name) {
  const modalState = await openVisualModal(window);
  let stats;
  try {
    stats = await capture(window, name);
  } finally {
    await closeVisualModal(window);
  }
  if (!modalState.ready || !modalState.productionModal || !modalState.singleGlassSurface || !modalState.overlayDoesNotBlur || !modalState.cardWithinViewport) {
    throw new Error(`弹窗单层玻璃视觉回归失败：${JSON.stringify(modalState)}`);
  }
  return {...stats, ...modalState};
}

async function restoreVisualRegressionState(window, previous) {
  try {
    await window.webContents.executeJavaScript(`(() => {
      const modal = document.getElementById('modal');
      if (modal?.dataset.visualRegressionModal === '1') {
        delete modal.dataset.visualRegressionModal;
        try { closeModal(); } catch {}
      }
      try {
        if (typeof cancelWorkspaceGroupSelection === 'function') cancelWorkspaceGroupSelection();
      } catch {}
      document.getElementById('visualRegressionSplit')?.remove();
      if (window.__visualRegressionOriginalApi) {
        try { closeTabsByKey(['visual-local-files'], 'visual-local-files'); } catch {}
        api = window.__visualRegressionOriginalApi;
        if (window.__visualRegressionHadDesktopBridge) window.termaDesktop = window.__visualRegressionDesktopBridge;
        else delete window.termaDesktop;
        delete window.__visualRegressionOriginalApi;
        delete window.__visualRegressionHadDesktopBridge;
        delete window.__visualRegressionDesktopBridge;
      }
      const saved = window.__termaVisualRegressionTheme;
      if (saved) {
        try { applyTheme(saved.theme); } catch {}
        try { applyTermaAppearanceSettings(saved.appearance); } catch {}
        if (saved.storedTheme === null) localStorage.removeItem('theme');
        else localStorage.setItem('theme', saved.storedTheme);
        if (saved.storedAppearance === null) localStorage.removeItem('termaAppearanceV1');
        else localStorage.setItem('termaAppearanceV1', saved.storedAppearance);
        delete window.__termaVisualRegressionTheme;
      }
    })()`);
  } finally {
    window.setContentSize(previous[0], previous[1]);
    await waitForViewport(window, previous[0]);
  }
}

async function runVisualRegression(window) {
  const previous = window.getContentSize();
  const states = {};
  await rememberVisualTheme(window);
  try {
  window.setContentSize(1180, 760);
  await waitForViewport(window, 1180);
  const lightTheme = await applyLuminousVisualTheme(window, "light");
  states.light = {...await capture(window, "light-desktop"), ...lightTheme};
  states.lightModal = await captureVisualModal(window, "light-desktop-modal");
  const darkTheme = await applyLuminousVisualTheme(window, "dark");
  states.dark = {...await capture(window, "dark-desktop"), ...darkTheme};
  states.darkModal = await captureVisualModal(window, "dark-desktop-modal");
  const localFilesFixture = await window.webContents.executeJavaScript(`(async () => {
    try {
    window.__visualRegressionOriginalApi = api;
    window.__visualRegressionHadDesktopBridge = Object.prototype.hasOwnProperty.call(window, 'termaDesktop');
    window.__visualRegressionDesktopBridge = window.termaDesktop;
    window.termaDesktop = {capabilities:{platform:'win32'}};
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
    if (window.__visualRegressionHadDesktopBridge) window.termaDesktop = window.__visualRegressionDesktopBridge;
    else delete window.termaDesktop;
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
  await window.webContents.executeJavaScript("document.getElementById('visualRegressionSplit')?.remove()");
  await applyLuminousVisualTheme(window, "light");
  window.setContentSize(720, 720);
  await waitForViewport(window, 720);
  const narrowTheme = await applyLuminousVisualTheme(window, "light");
  states.narrow = {...await capture(window, "narrow-window"), ...narrowTheme};
  window.setContentSize(390, 844);
  await waitForViewport(window, 390);
  const mobileTheme = await applyLuminousVisualTheme(window, "light");
  states.mobile = {...await capture(window, "mobile"), ...mobileTheme};
  states.mobileModal = await captureVisualModal(window, "mobile-modal");
  return states;
  } finally {
    await restoreVisualRegressionState(window, previous);
  }
}

module.exports = { runVisualRegression };
