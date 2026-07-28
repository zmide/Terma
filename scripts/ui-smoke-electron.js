const { app, BrowserWindow, clipboard, session } = require("electron");
const path = require("node:path");

const url = process.env.TUNNELDESK_CHECK_URL || "http://127.0.0.1:8099";
const errors = [];
let smokeWindow = null;
const smokeWatchdog = setTimeout(async () => {
  let stage = "unknown";
  try {
    stage = await smokeWindow?.webContents.executeJavaScript("document.documentElement.dataset.uiSmokeStage || 'unknown'");
  } catch {}
  console.error(`UI 冒烟超过 120 秒仍未完成，停留阶段：${stage}`);
  app.exit(1);
}, 120000);

app.whenReady().then(async () => {
  await session.defaultSession.clearCache();
  const window = new BrowserWindow({ show:false, width:1200, height:800, webPreferences:{ contextIsolation:true } });
  smokeWindow = window;
  window.webContents.on("console-message", details => {
    if (["warning", "error"].includes(details.level)) {
      errors.push(`${details.message}${details.sourceId ? ` (${details.sourceId}:${details.lineNumber || 0})` : ""}`);
    }
  });
  window.webContents.on("did-fail-load", (_event, code, description) => errors.push(`${code}: ${description}`));
  await window.loadURL(url);
  await new Promise(resolve => setTimeout(resolve, 1200));
  console.log("[ui-smoke] page loaded");
  await window.webContents.executeJavaScript(`(() => {
    window.__uiSmokeRealLoadAll = loadAll;
    if (Array.isArray(connections) && connections.length) return;
    connections = [{
      id: 900001,
      name: 'UI Smoke',
      group_name: 'UI Smoke',
      ssh_host: '127.0.0.1',
      ssh_port: 22,
      ssh_user: 'tester',
      tags: '',
      forwards: [{
        id: 900001,
        connection_id: 900001,
        mode: 'local',
        service_name: 'UI Smoke Web',
        service_type: 'web',
        url_scheme: 'http',
        bind_host: '127.0.0.1',
        bind_port: 18099,
        target_host: '127.0.0.1',
        target_port: 80,
        status: 'running',
        reconnect_count: 0
      }]
    }];
    groupOpen.add('UI Smoke');
    renderConnections();
    // Keep the in-memory fixture stable when the isolated test service has no records.
    loadAll = async () => {};
  })()`);
  console.log("[ui-smoke] base layout");
  const result = await window.webContents.executeJavaScript(`(() => {
    const activity = document.querySelector('.activity');
    const activityRect = activity?.getBoundingClientRect();
    const activityItems = [...document.querySelectorAll('.activity-top > button, .activity-bottom > button, .activity-bottom > a')].map(item => {
      const itemRect = item.getBoundingClientRect();
      const iconRect = item.querySelector('svg')?.getBoundingClientRect();
      return {
        id: item.id || 'github',
        itemCenter: itemRect.left + itemRect.width / 2,
        iconCenter: iconRect ? iconRect.left + iconRect.width / 2 : NaN,
        iconDelta: iconRect ? Math.abs((iconRect.left + iconRect.width / 2) - (itemRect.left + itemRect.width / 2)) : Infinity,
        insideColumn: Boolean(activityRect && itemRect.left >= activityRect.left - 0.5 && itemRect.right <= activityRect.right + 0.5)
      };
    });
    const baseline = activityItems[0]?.itemCenter;
    const brandHeight = document.querySelector('.brand')?.getBoundingClientRect().height || 0;
    const topbarHeight = document.querySelector('.topbar')?.getBoundingClientRect().height || 0;
    const tabsHeight = document.querySelector('.tabs')?.getBoundingClientRect().height || 0;
    const workspacePaddingTop = parseFloat(getComputedStyle(document.querySelector('.workspace')).paddingTop) || 0;
    const groupActionButton = document.querySelector('.connection-group-menu-button');
    const groupHeadRow = document.querySelector('.connection-group-head-row');
    const groupHeadStyle = groupHeadRow ? getComputedStyle(groupHeadRow) : null;
    const connectionTree = document.querySelector('#connectionGroups');
    const connectionTreeRect = connectionTree?.getBoundingClientRect();
    const groupHeadRect = groupHeadRow?.getBoundingClientRect();
    const stickyGroupHeaders = Boolean(
      groupHeadStyle
      && groupHeadStyle.position === 'sticky'
      && parseFloat(groupHeadStyle.top) === 0
      && groupHeadStyle.backgroundColor !== 'rgba(0, 0, 0, 0)'
      && groupHeadStyle.boxShadow !== 'none'
    );
    const stickyGroupHeaderSealsTop = Boolean(
      connectionTree
      && connectionTreeRect
      && groupHeadRect
      && parseFloat(getComputedStyle(connectionTree).paddingTop) === 0
      && Math.abs(groupHeadRect.top - connectionTreeRect.top) <= 0.5
    );
    const forwardToggle = document.querySelector('.conn-actions .connection-forward-toggle');
    const forwardToggleRect = forwardToggle?.getBoundingClientRect();
    const forwardToggleSpanRect = forwardToggle?.querySelector('span')?.getBoundingClientRect();
    const originalPaneCollapsed = operationPaneCollapsed;
    const originalPrimaryView = primaryView;
    operationPaneCollapsed = false;
    primaryView = 'connections';
    showPrimary('connections');
    const expandedContentWidth = document.querySelector('#content')?.getBoundingClientRect().width || 0;
    const expandedBrand = getComputedStyle(document.querySelector('.brand-name-full')).display !== 'none'
      && getComputedStyle(document.querySelector('.brand-name-short')).display === 'none'
      && getComputedStyle(document.querySelector('#operationPaneCollapse')).display !== 'none';
    const paneExpanded = getComputedStyle(document.querySelector('#sidebar')).display !== 'none'
      && document.querySelector('#navConnections')?.getAttribute('aria-expanded') === 'true';
    document.querySelector('#operationPaneCollapse')?.click();
    const collapsedContentWidth = document.querySelector('#content')?.getBoundingClientRect().width || 0;
    const collapsedBrand = getComputedStyle(document.querySelector('.brand-name-full')).display === 'none'
      && getComputedStyle(document.querySelector('.brand-name-short')).display !== 'none'
      && document.querySelector('.brand-name-short')?.textContent.trim() === 'TD';
    const paneCollapsed = getComputedStyle(document.querySelector('#sidebar')).display === 'none'
      && document.querySelector('#navConnections')?.getAttribute('aria-expanded') === 'false'
      && document.querySelector('.app')?.classList.contains('operation-pane-collapsed');
    document.querySelector('#navRunning')?.click();
    const differentActivityExpands = primaryView === 'running'
      && getComputedStyle(document.querySelector('#sidebar')).display !== 'none'
      && document.querySelector('#navRunning')?.getAttribute('aria-expanded') === 'true';
    document.querySelector('#navRunning')?.click();
    const activeActivityCollapses = getComputedStyle(document.querySelector('#sidebar')).display === 'none'
      && document.querySelector('#navRunning')?.getAttribute('aria-expanded') === 'false';
    operationPaneCollapsed = originalPaneCollapsed;
    primaryView = originalPrimaryView;
    localStorage.setItem('operationPaneCollapsed', originalPaneCollapsed ? '1' : '0');
    showPrimary(originalPrimaryView);
    document.querySelector('.group-head')?.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:180, clientY:180}));
    const groupMenuLabels = [...document.querySelectorAll('#actionMenu button span')].map(node => node.textContent.trim());
    hideActionMenu();
    return {
      title: document.title,
      icons: document.querySelectorAll('svg.lucide').length,
      pendingIcons: document.querySelectorAll('i[data-lucide]').length,
      connections: document.querySelectorAll('.conn-row').length,
      groups: document.querySelectorAll('.group').length,
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      visibleView: Array.from(document.querySelectorAll('.view')).find(el => !el.hidden)?.id || '',
      groupRenameMenu: groupMenuLabels.includes('重命名分组'),
      groupActionButton: Boolean(groupActionButton && groupActionButton.getAttribute('aria-label')?.includes('分组操作')),
      stickyGroupHeaders,
      stickyGroupHeaderSealsTop,
      operationPaneCollapsible: expandedBrand && collapsedBrand && paneExpanded && paneCollapsed && differentActivityExpands && activeActivityCollapses && collapsedContentWidth >= expandedContentWidth + 250,
      activityUtilities: document.querySelector('.activity-bottom')?.children[0]?.id === 'themeToggle'
        && document.querySelector('.activity-bottom')?.children[1]?.id === 'activityRefresh'
        && document.querySelector('.activity-bottom')?.children[2]?.classList.contains('github-link'),
      compactDesktopHeader: brandHeight <= 42.5 && topbarHeight <= 42.5 && tabsHeight <= 32.5 && workspacePaddingTop <= 12.5,
      forwardToggleFits: Boolean(
        forwardToggle
        && forwardToggle.textContent.trim() === '停止转发'
        && forwardToggleRect
        && forwardToggleSpanRect
        && forwardToggleSpanRect.right <= forwardToggleRect.right - 2
      ),
      activity: {
        count: activityItems.length,
        iconCentered: activityItems.every(item => item.iconDelta <= 0.5),
        centersAligned: activityItems.every(item => Math.abs(item.itemCenter - baseline) <= 0.5),
        insideColumn: activityItems.every(item => item.insideColumn),
        items: activityItems
      }
    };
  })()`);
  console.log("[ui-smoke] refresh state");
  const refreshStateUi = await window.webContents.executeJavaScript(`(async () => {
    const fixture = connections[0];
    const previousApi = api;
    const previousConnections = connections;
    const previousTemplates = forwardTemplates;
    const previousSecurity = securitySettings;
    const previousSelectedId = selectedId;
    const previousPrimaryView = primaryView;
    const previousActiveView = activeView;
    const previousOpenGroups = [...groupOpen];
    const previousStoredGroups = localStorage.getItem('openGroups');
    const previousStartupStatus = startupSummaryStatus;
    const previousWelcomeHtml = document.querySelector('#view-welcome')?.innerHTML || '';
    const previousStatuses = (fixture?.forwards || []).map(forward => forward.status);
    try {
      if (!fixture) return {found:false};
      primaryView = 'connections';
      activeView = 'welcome';
      selectedId = fixture.id;
      groupOpen.add(fixture.group_name);
      saveGroupState();
      renderConnections();
      toggleGroupOpen(fixture.group_name);
      const collapsedBeforeRefresh = !groupOpen.has(fixture.group_name)
        && !document.querySelector('.group[data-group-name="' + encodeURIComponent(fixture.group_name) + '"] .conn-row');
      api = async path => {
        if (path === '/api/connections') return previousConnections;
        if (path === '/api/forward-templates') return previousTemplates;
        if (path === '/api/security') return previousSecurity;
        throw new Error('Unexpected refresh-state request: ' + path);
      };
      await window.__uiSmokeRealLoadAll({silent:true});
      const collapsedAfterRefresh = !groupOpen.has(fixture.group_name)
        && !document.querySelector('.group[data-group-name="' + encodeURIComponent(fixture.group_name) + '"] .conn-row');
      const collapsePersisted = !JSON.parse(localStorage.getItem('openGroups') || '[]').includes(fixture.group_name);

      const welcome = document.querySelector('#view-welcome');
      welcome.innerHTML = '<div id="startupSummary"></div>';
      startupSummaryStatus = {state:'ready',local_url:'http://127.0.0.1:8088',lan_urls:[]};
      fixture.forwards[0].status = 'running';
      renderStartupSummary();
      const runningText = document.querySelector('#startupSummary')?.textContent || '';
      fixture.forwards[0].status = 'failed';
      renderStartupSummary();
      const failedText = document.querySelector('#startupSummary')?.textContent || '';
      selectConnection(fixture.id);
      const explicitSelectionReopens = groupOpen.has(fixture.group_name);
      return {
        found:true,
        collapsedBeforeRefresh,
        collapsedAfterRefresh,
        collapsePersisted,
        explicitSelectionReopens,
        runningCountLive:runningText.includes('运行中 1') && runningText.includes('异常 0'),
        failureCountLive:failedText.includes('运行中 0') && failedText.includes('异常 1') && failedText.includes('部分转发异常'),
        oldStartupLabelsRemoved:!failedText.includes('转发成功') && !failedText.includes('失败 1')
      };
    } finally {
      api = previousApi;
      connections = previousConnections;
      forwardTemplates = previousTemplates;
      securitySettings = previousSecurity;
      selectedId = previousSelectedId;
      primaryView = previousPrimaryView;
      activeView = previousActiveView;
      startupSummaryStatus = previousStartupStatus;
      if (fixture) (fixture.forwards || []).forEach((forward,index) => { forward.status = previousStatuses[index]; });
      groupOpen.clear();
      previousOpenGroups.forEach(group => groupOpen.add(group));
      if (previousStoredGroups === null) localStorage.removeItem('openGroups');
      else localStorage.setItem('openGroups', previousStoredGroups);
      const welcome = document.querySelector('#view-welcome');
      if (welcome) welcome.innerHTML = previousWelcomeHtml;
      renderConnections();
    }
  })()`);
  console.log("[ui-smoke] workspace tab drag");
  const workspaceTabDragUi = await window.webContents.executeJavaScript(`(() => {
    const previousTabs = tabs.map(tab => ({...tab}));
    const previousActiveTabKey = activeTabKey;
    const previousStoredTabs = localStorage.getItem('workspaceTabs');
    try {
      tabs = [
        {key:'drag-a',title:'bt01 · 终端',subtitle:'root@bt01.example:22',viewName:'welcome',closable:true,kind:'fixture'},
        {key:'drag-b',title:'测试 · 终端 #5',subtitle:'root@192.0.2.5:22',viewName:'welcome',closable:true,kind:'fixture'},
        {key:'drag-c',title:'标签 C',subtitle:'',viewName:'welcome',closable:true,kind:'fixture'}
      ];
      activeTabKey = 'drag-b';
      renderTabs();
      const first = document.querySelector('.tab[data-tab-key="drag-a"]');
      const last = document.querySelector('.tab[data-tab-key="drag-c"]');
      const firstRect = first.getBoundingClientRect();
      const lastRect = last.getBoundingClientRect();
      const shortTitleRect = last.querySelector('.tab-title').getBoundingClientRect();
      const shortCloseRect = last.querySelector('.tab-close').getBoundingClientRect();
      const shortTabUsesContentWidth = lastRect.width < 120
        && shortCloseRect.left - shortTitleRect.right >= 4
        && shortCloseRect.left - shortTitleRect.right <= 8;
      first.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:71,pointerType:'mouse',button:0,clientX:firstRect.left+8,clientY:firstRect.top+8}));
      const activatedOnPress = activeTabKey === 'drag-a';
      window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:71,pointerType:'mouse',button:0,clientX:lastRect.right-2,clientY:firstRect.top+8}));
      const draggedTab = document.querySelector('.tab[data-tab-key="drag-a"]');
      const dragGhost = document.querySelector('.workspace-tab-drag-ghost');
      const beganImmediately = Boolean(workspaceTabDrag?.dragging && draggedTab?.classList.contains('tab-dragging') && document.body.classList.contains('workspace-tab-drag-active'));
      const dragGhostVisible = Boolean(dragGhost && dragGhost.textContent.includes('bt01 · 终端') && getComputedStyle(dragGhost).display !== 'none');
      const dropPositionVisible = getComputedStyle(draggedTab).boxShadow.includes('rgb');
      const touchReady = getComputedStyle(draggedTab).touchAction === 'pan-y';
      const commonTitleFits = draggedTab.querySelector('.tab-title').scrollWidth <= draggedTab.querySelector('.tab-title').clientWidth;
      const sessionTitle = document.querySelector('.tab[data-tab-key="drag-b"] .tab-title');
      const numberedSessionTitleFits = sessionTitle.scrollWidth <= sessionTitle.clientWidth;
      const compactTabFont = Math.abs(parseFloat(getComputedStyle(draggedTab).fontSize) - 12) < 0.1;
      const fullTitleTooltip = draggedTab.title === 'bt01 · 终端 - root@bt01.example:22';
      const liveOrder = [...document.querySelectorAll('#tabs .tab')].map(tab => tab.dataset.tabKey);
      window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:71,pointerType:'mouse',button:0,clientX:lastRect.right-2,clientY:firstRect.top+8}));
      const savedOrder = tabs.map(tab => tab.key);
      const persistedOrder = JSON.parse(localStorage.getItem('workspaceTabs') || '{}').tabs?.map(tab => tab.key) || [];
      const activeFollowsDragged = activeTabKey === 'drag-a';
      const dragGhostRemoved = !document.querySelector('.workspace-tab-drag-ghost');
      const clickSuppressed = workspaceTabSuppressClickUntil > Date.now();

      const beforeCancel = tabs.map(tab => tab.key);
      const cancelTab = document.querySelector('.tab[data-tab-key="drag-b"]');
      const cancelTarget = document.querySelector('.tab[data-tab-key="drag-a"]');
      const cancelRect = cancelTab.getBoundingClientRect();
      const cancelTargetRect = cancelTarget.getBoundingClientRect();
      cancelTab.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:72,pointerType:'touch',button:0,clientX:cancelRect.left+8,clientY:cancelRect.top+8}));
      window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:72,pointerType:'touch',button:0,clientX:cancelTargetRect.right-2,clientY:cancelRect.top+8}));
      const cancelStarted = Boolean(workspaceTabDrag?.dragging);
      window.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,cancelable:true,pointerId:72,pointerType:'touch',button:0,clientX:cancelTargetRect.right-2,clientY:cancelRect.top+8}));
      const cancelRestored = JSON.stringify(tabs.map(tab => tab.key)) === JSON.stringify(beforeCancel)
        && JSON.stringify([...document.querySelectorAll('#tabs .tab')].map(tab => tab.dataset.tabKey)) === JSON.stringify(beforeCancel);

      const closeControl = document.querySelector('.tab[data-tab-key="drag-a"] .tab-close');
      closeControl.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:73,pointerType:'mouse',button:0}));
      const closeDoesNotDrag = workspaceTabDrag === null;
      moveWorkspaceTab('drag-a', -1);
      const fallbackMove = JSON.stringify(tabs.map(tab => tab.key)) === JSON.stringify(['drag-b','drag-a','drag-c']);
      const tabShell = document.querySelector('.tabs-shell');
      const tabStrip = document.querySelector('#tabs');
      const leftScroll = document.querySelector('#tabsScrollLeft');
      const rightScroll = document.querySelector('#tabsScrollRight');
      const previousShellWidth = tabShell.style.width;
      tabShell.style.width = '280px';
      tabStrip.scrollLeft = 0;
      updateWorkspaceTabScrollControls();
      const scrollControlsVisible = !leftScroll.hidden && !rightScroll.hidden && leftScroll.disabled && !rightScroll.disabled;
      const nativeScrollbarHidden = getComputedStyle(tabStrip).scrollbarWidth === 'none'
        && tabStrip.offsetHeight === tabStrip.clientHeight;
      tabStrip.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:80}));
      const wheelScrollsTabs = tabStrip.scrollLeft > 0;
      tabShell.style.width = previousShellWidth;
      tabStrip.scrollLeft = 0;
      updateWorkspaceTabScrollControls();
      const scrollControlsHideWhenFit = leftScroll.hidden && rightScroll.hidden
        && getComputedStyle(leftScroll).display === 'none'
        && getComputedStyle(rightScroll).display === 'none';
      return {
        beganImmediately,
        activatedOnPress,
        dragGhostVisible,
        dropPositionVisible,
        dragGhostRemoved,
        touchReady,
        commonTitleFits,
        numberedSessionTitleFits,
        compactTabFont,
        shortTabUsesContentWidth,
        fullTitleTooltip,
        liveOrder,
        savedOrder,
        persistedOrder,
        activeFollowsDragged,
        clickSuppressed,
        cancelStarted,
        cancelRestored,
        closeDoesNotDrag,
        fallbackMove,
        scrollControlsVisible,
        scrollControlsHideWhenFit,
        nativeScrollbarHidden,
        wheelScrollsTabs
      };
    } finally {
      if (workspaceTabDrag) finishWorkspaceTabDrag(null, true);
      tabs = previousTabs;
      activeTabKey = previousActiveTabKey;
      window.restoringTabs = true;
      renderTabs();
      window.restoringTabs = false;
      if (previousStoredTabs === null) localStorage.removeItem('workspaceTabs');
      else localStorage.setItem('workspaceTabs', previousStoredTabs);
    }
  })()`);
  console.log("[ui-smoke] primary pages");
  const pages = await window.webContents.executeJavaScript(`(async () => {
    const rows = [];
    for (const name of ['connections','running','command','logs','settings','import']) {
      showPrimary(name);
      await new Promise(resolve => setTimeout(resolve, 250));
      rows.push({name, width:document.documentElement.clientWidth, scrollWidth:document.documentElement.scrollWidth, visibleView:Array.from(document.querySelectorAll('.view')).find(el => !el.hidden)?.id || ''});
    }
    return rows;
  })()`);
  console.log("[ui-smoke] settings and import navigation");
  const navigationUi = await window.webContents.executeJavaScript(`(async () => {
    const previousPrimary = primaryView;
    const previousActiveView = activeView;
    const previousSettingsSection = activeSettingsSection;
    const previousImportSection = activeImportSection;
    const previousUpdate = updateSettings;
    const previousRuntimeSettings = runtimeSettings;
    const previousRuntimeMessage = runtimeSettingsMessage;
    const previousRuntimeCheck = runtimeSettingsCheck;
    const previousReadVersion = updateNoticeReadVersion;
    const previousStoredVersion = sessionStorage.getItem(UPDATE_NOTICE_SESSION_KEY);
    const previousLatencyVisible = terminalLatencyVisible;
    try {
      primaryView = 'settings';
      activeSettingsSection = 'settings-general';
      terminalLatencyVisible = true;
      updateSettings = {current_version:'1.0.8',latest_version:'1.0.9',update_available:true};
      runtimeSettings = normalizeRuntimeSettingsResponse({
        saved:{listen_hosts:['127.0.0.1','192.0.2.10'],listen_port:18100,sftp_recycle_bin_enabled:true},
        effective:{listen_hosts:['127.0.0.1','192.0.2.10'],listen_port:18100},
        available_hosts:[
          {address:'192.0.2.10',interface:'Ethernet',label:'Ethernet · 192.0.2.10'},
          {address:'192.0.2.11',interface:'Wi-Fi',label:'Wi-Fi · 192.0.2.11'}
        ],
        local_url:'http://127.0.0.1:18100',
        lan_urls:['http://192.0.2.10:18100'],
        restart_required:true
      });
      runtimeSettingsMessage = null;
      runtimeSettingsCheck = null;
      updateNoticeReadVersion = '';
      sessionStorage.removeItem(UPDATE_NOTICE_SESSION_KEY);
      setWorkspace('设置', '通用设置', 'settings', 'settings-ui-smoke', false, true, {kind:'settings'});
      renderSettings();
      renderExplorerTools();
      syncUpdateNoticeDots();
      const tools = document.querySelector('#explorerTools');
      const settingsButtons = [...tools.querySelectorAll(':scope > button[data-explorer-section]')];
      const settingsLabels = settingsButtons.map(button => button.querySelector('span')?.textContent.trim() || '');
      const settingsExpected = ['通用设置','安全设置','通知设置','启动与运行','关于'];
      const settingsRects = settingsButtons.map(button => button.getBoundingClientRect());
      const settingsVertical = settingsRects.every((rect,index) => index === 0 || rect.top >= settingsRects[index-1].bottom - 0.5) && settingsRects.every(rect => Math.abs(rect.left-settingsRects[0].left)<1 && Math.abs(rect.width-settingsRects[0].width)<1);
      const settingsChecks = [];
      for (const button of settingsButtons.filter(item => item.dataset.explorerSection !== 'settings-about')) {
        button.click();
        await Promise.resolve();
        const visible = [...document.querySelectorAll('#view-settings .settings-group')].filter(group => !group.hidden).map(group => group.id);
        const active = [...tools.querySelectorAll(':scope > button.active')].map(item => item.dataset.explorerSection);
        settingsChecks.push({requested:button.dataset.explorerSection, visible, active});
      }
      const updateDotIds = ['navSettingsUpdateDot','mobileSettingsUpdateDot','settingsExplorerUpdateDot'];
      const dotsBeforeRead = updateDotIds.map(id => ({id, found:Boolean(document.getElementById(id)), hidden:document.getElementById(id)?.hidden}));
      updateSettings = {...updateSettings, update_ignored:true};
      syncUpdateNoticeDots();
      const ignoredVersionHidesNotice = !shouldShowUpdateNotice() && updateDotIds.every(id => document.getElementById(id)?.hidden === true);
      updateSettings = {...updateSettings, latest_version:'1.0.10', update_ignored:false};
      syncUpdateNoticeDots();
      const newerAfterIgnoredShowsNotice = shouldShowUpdateNotice() && updateDotIds.every(id => document.getElementById(id)?.hidden === false);
      updateSettings = {...updateSettings, latest_version:'1.0.9', update_ignored:false};
      syncUpdateNoticeDots();
      tools.querySelector('[data-explorer-section="settings-about"]')?.click();
      await Promise.resolve();
      const aboutVisible = [...document.querySelectorAll('#view-settings .settings-group')].filter(group => !group.hidden).map(group => group.id);
      const aboutActive = [...tools.querySelectorAll(':scope > button.active')].map(item => item.dataset.explorerSection);
      const dotsAfterRead = updateDotIds.map(id => ({id, found:Boolean(document.getElementById(id)), hidden:document.getElementById(id)?.hidden}));
      const storedReadVersion = sessionStorage.getItem(UPDATE_NOTICE_SESSION_KEY);
      const sameVersionStaysRead = !shouldShowUpdateNotice();
      tools.querySelector('[data-explorer-section="settings-basic"]')?.click();
      await Promise.resolve();
      const sessionUi = {
        ttl:document.querySelector('#securitySessionTtlMinutes')?.value,
        max:document.querySelector('#securitySessionMaxSessions')?.value,
        cleanup:document.querySelector('#securitySessionCleanupMinutes')?.value,
        active:document.querySelector('#settings-basic')?.textContent.includes('当前活动会话'),
        save:Boolean([...document.querySelectorAll('#settings-basic button')].find(button=>button.textContent.includes('保存会话设置')))
      };
      updateSettings = {...updateSettings, latest_version:'1.0.10'};
      syncUpdateNoticeForCurrentSection();
      const newerVersionShowsAgain = shouldShowUpdateNotice() && updateDotIds.every(id => document.getElementById(id)?.hidden === false);

      tools.querySelector('[data-explorer-section="settings-runtime"]')?.click();
      await Promise.resolve();
      const runtimeGroup = document.querySelector('#settings-runtime');
      const runtimeHosts = [...document.querySelectorAll('[name="runtimeListenHost"]')];
      const wildcard = runtimeHosts.find(input => input.value === '0.0.0.0');
      wildcard.checked = true;
      syncRuntimeHostOptions(wildcard);
      const wildcardCollapsed = runtimeHosts.filter(input => input !== wildcard).every(input => input.closest('.runtime-host-option')?.hidden);
      const runtimeUrlLinks = [...document.querySelectorAll('#runtimeCurrentUrls .runtime-url-row')];
      const runtimeUi = {
        found:Boolean(runtimeGroup && document.querySelector('#runtimeSettingsPanel')),
        selectedHosts:runtimeHosts.filter(input => input.checked).map(input => input.value),
        port:document.querySelector('#runtimeListenPort')?.value || '',
        sftpSettingsAbsent:!document.querySelector('#settings-general #sftpRecycleBinEnabled') && !document.querySelector('#settings-general #sftpMaxOpenFileSizeMb'),
        terminalLatencySettingChecked:Boolean(document.querySelector('#terminalLatencyVisible')?.checked),
        wildcardCollapsed,
        urlLinks:runtimeUrlLinks.map(link => link.href),
        restartNotice:runtimeGroup?.textContent.includes('等待重启') || false
      };

      primaryView = 'import';
      activeImportSection = 'import-source';
      showImport(false);
      renderExplorerTools();
      await Promise.resolve();
      const importButtons = [...tools.querySelectorAll(':scope > button[data-explorer-section]')];
      const importLabels = importButtons.map(button => button.querySelector('span')?.textContent.trim() || '');
      const importExpected = ['SSH config 导入导出','数据库导入导出','配置快照'];
      const importRects = importButtons.map(button => button.getBoundingClientRect());
      const importVertical = importRects.every((rect,index) => index === 0 || rect.top >= importRects[index-1].bottom - 0.5) && importRects.every(rect => Math.abs(rect.left-importRects[0].left)<1 && Math.abs(rect.width-importRects[0].width)<1);
      const importResults = document.querySelector('#import-source #import-results');
      const importResultsMerged = Boolean(importResults && importResults.parentElement?.id === 'import-source');
      const importChecks = [];
      for (const button of importButtons) {
        button.click();
        await Promise.resolve();
        const visible = Object.keys(IMPORT_SECTION_META).filter(id => document.getElementById(id) && !document.getElementById(id).hidden);
        const active = [...tools.querySelectorAll(':scope > button.active')].map(item => item.dataset.explorerSection);
        importChecks.push({requested:button.dataset.explorerSection, visible, active, resultsVisible: Boolean(importResults?.offsetParent)});
      }
      return {
        settingsLabels,
        settingsOnlySections:JSON.stringify(settingsLabels) === JSON.stringify(settingsExpected),
        settingsSectionMode:tools.classList.contains('section-mode'),
        settingsVertical,
        settingsChecks,
        aboutVisible,
        aboutActive,
        duplicateSettingsNav:document.querySelectorAll('.settings-nav').length,
        inlineUpdateDotPresent:Boolean(document.getElementById('settingsInlineUpdateDot')),
        dotsBeforeRead,
        dotsAfterRead,
        storedReadVersion,
        sameVersionStaysRead,
        ignoredVersionHidesNotice,
        newerAfterIgnoredShowsNotice,
        newerVersionShowsAgain,
        sessionUi,
        runtimeUi,
        importLabels,
        importOwnSections:JSON.stringify(importLabels) === JSON.stringify(importExpected),
        importSectionMode:tools.classList.contains('section-mode'),
        importVertical,
        importResultsMerged,
        importChecks,
        treeHidden:Boolean(document.querySelector('#connectionGroups')?.hidden)
      };
    } finally {
      updateSettings = previousUpdate;
      runtimeSettings = previousRuntimeSettings;
      runtimeSettingsMessage = previousRuntimeMessage;
      runtimeSettingsCheck = previousRuntimeCheck;
      updateNoticeReadVersion = previousReadVersion;
      terminalLatencyVisible = previousLatencyVisible;
      activeSettingsSection = previousSettingsSection;
      activeImportSection = previousImportSection;
      if (previousStoredVersion === null) sessionStorage.removeItem(UPDATE_NOTICE_SESSION_KEY);
      else sessionStorage.setItem(UPDATE_NOTICE_SESSION_KEY, previousStoredVersion);
      primaryView = previousPrimary;
      activeView = previousActiveView;
      renderExplorerTools();
      syncUpdateNoticeDots();
    }
  })()`);
  console.log("[ui-smoke] about modal");
  const aboutUi = await window.webContents.executeJavaScript(`(async () => {
    try {
      showPrimary('settings');
      for (let i = 0; i < 40 && (activeView !== 'settings' || !document.querySelector('#settings-about')); i += 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const aboutButton = document.querySelector('#explorerTools [data-explorer-section="settings-about"]');
      aboutButton?.click();
      await Promise.resolve();
      const section = document.querySelector('#settings-about');
      const visibleGroups = [...document.querySelectorAll('#view-settings .settings-group')].filter(group => !group.hidden).map(group => group.id);
      const sourceLink = section?.querySelector('.about-actions a');
      const trigger = document.querySelector('#openLicenseBtn');
      if (!section || !trigger) return {found:false, visibleGroups};
      trigger.click();
      for (let i = 0; i < 20 && document.querySelector('#modal')?.hidden; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      const modal = document.querySelector('#modal');
      const card = modal?.querySelector('.license-modal');
      const text = modal?.querySelector('#licenseText');
      const cardRect = card?.getBoundingClientRect();
      const textStyle = text ? getComputedStyle(text) : null;
      const result = {
        found:true,
        aboutSelected:visibleGroups.length === 1 && visibleGroups[0] === 'settings-about' && aboutButton?.classList.contains('active'),
        duplicateSettingsNav:document.querySelectorAll('.settings-nav').length,
        versionMatches:Boolean(aboutSettings?.version && section.textContent.includes('版本 ' + aboutSettings.version)),
        licenseMetadata:section.textContent.includes('GPL-3.0-only'),
        sourceLink:Boolean(sourceLink && sourceLink.target === '_blank' && sourceLink.relList.contains('noopener') && sourceLink.href === aboutSettings?.repository_url),
        modalOpen:Boolean(modal && !modal.hidden && card),
        accessible:Boolean(card?.getAttribute('role') === 'dialog' && card?.getAttribute('aria-modal') === 'true' && card?.getAttribute('aria-labelledby') === 'licenseModalTitle'),
        fullText:Boolean(text?.textContent.includes('GNU GENERAL PUBLIC LICENSE') && text?.textContent.includes('END OF TERMS AND CONDITIONS') && text.textContent === aboutSettings?.license_text),
        textScrollable:Boolean(text && text.scrollHeight > text.clientHeight && textStyle?.overflowY === 'auto'),
        cardWithinViewport:Boolean(cardRect && cardRect.left >= -0.5 && cardRect.right <= innerWidth + 0.5 && cardRect.top >= -0.5 && cardRect.bottom <= innerHeight + 0.5),
        closeFocused:document.activeElement?.id === 'licenseModalClose'
      };
      modal.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));
      await new Promise(resolve => setTimeout(resolve, 0));
      result.backdropIgnored = Boolean(!modal.hidden && modal.querySelector('.license-modal') && modal.querySelector('#licenseText')?.textContent === aboutSettings?.license_text);
      document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
      await new Promise(resolve => setTimeout(resolve, 25));
      result.closedByEscape = Boolean(modal?.hidden && !modal.querySelector('.license-modal'));
      result.focusReturned = document.activeElement === trigger;
      const followup = chooseModal('后续确认框', '验证共享弹窗状态已经清理。', [{label:'确定', value:'ok'}]);
      result.followupBackdropClean = modal.onclick === null;
      modal.querySelector('button[data-choice]')?.click();
      result.followupResolved = await followup === 'ok';
      const previousUpdate = updateSettings;
      updateSettings = {
        current_version:'1.0.8',
        latest_version:'1.0.9',
        update_available:true,
        release_url:'https://github.com/zmide/tunneldesk/releases/tag/v1.0.9',
        published_at:'2026-07-20T00:00:00Z',
        checked_at:'2026-07-20T00:01:00Z',
        notes:'更新检查测试',
        update_ignored:false,
        release_notes:[
          {version:'1.0.9', published_at:'2026-07-20T00:00:00Z', notes:'更新检查测试：新版本更新内容'},
          {version:'1.0.8', published_at:'2026-07-19T00:00:00Z', notes:'上一版本更新内容'}
        ],
        download_status:{
          state:'idle',
          selected_asset_name:'TunnelDesk-1.0.9-windows-x64-portable.exe',
          selected_asset_size:10485760,
          platform:'win32',
          arch:'x64',
          package_type:'portable',
          progress_percent:0,
          can_open:true
        }
      };
      document.querySelector('#updateCheckArea').innerHTML = updateStatusHtml();
      const updateArea = document.querySelector('#updateCheckArea');
      const updateLink = updateArea.querySelector('a');
      const releaseEntries = [...updateArea.querySelectorAll('.update-release-entry')];
      const updateCardReady = updateArea?.textContent.includes('GitHub Release 更新')
        && updateArea.textContent.includes('TunnelDesk-1.0.9-windows-x64-portable.exe')
        && updateArea.textContent.includes('Windows · x64 · 便携版')
        && updateArea.textContent.includes('更新检查测试')
        && releaseEntries.length === 2
        && releaseEntries[0].textContent.includes('v1.0.9')
        && releaseEntries[0].textContent.includes('新版本更新内容')
        && releaseEntries[1].textContent.includes('v1.0.8')
        && releaseEntries[1].textContent.includes('上一版本更新内容')
        && Boolean(updateArea.querySelector('#updateIgnoreCurrentVersion'))
        && updateArea.textContent.includes('提示弹窗和红点')
        && updateArea.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') === '0'
        && Boolean([...updateArea.querySelectorAll('button')].find(button=>button.textContent.includes('下载并校验')))
        && updateLink?.textContent.includes('查看 Release')
        && updateLink?.href === 'https://github.com/zmide/tunneldesk/releases/tag/v1.0.9';
      updateSettings.download_status = {
        ...updateSettings.download_status,
        state:'downloaded',
        version:'1.0.9',
        asset_name:'TunnelDesk-1.0.9-windows-x64-portable.exe',
        progress_percent:100,
        can_open:true,
        can_open_directory:true
      };
      updateArea.innerHTML = updateStatusHtml();
      const portableButtons = [...updateArea.querySelectorAll('button')].map(button=>button.textContent.trim());
      const portableActionsReady = portableButtons.includes('打开下载目录')
        && portableButtons.includes('重新下载')
        && !portableButtons.includes('打开已校验安装包');
      updateSettings.download_status = {
        ...updateSettings.download_status,
        selected_asset_name:'TunnelDesk-1.0.9-windows-x64-installer.exe',
        asset_name:'TunnelDesk-1.0.9-windows-x64-installer.exe',
        package_type:'installer'
      };
      updateArea.innerHTML = updateStatusHtml();
      const installerButtons = [...updateArea.querySelectorAll('button')].map(button=>button.textContent.trim());
      const installerActionsReady = installerButtons.includes('打开已校验安装包')
        && installerButtons.includes('打开下载目录')
        && installerButtons.includes('重新下载');
      result.updateUi = updateCardReady && portableActionsReady && installerActionsReady;
      updateSettings = previousUpdate;
      return result;
    } catch (error) {
      return {error:error?.stack || error?.message || String(error)};
    }
  })()`);
  console.log("[ui-smoke] menus and actions");
  const desktopMenu = await window.webContents.executeJavaScript(`(() => {
    showPrimary('connections');
    if (!document.querySelector('.conn-row')) document.querySelector('.group-head')?.click();
    document.querySelector('.conn-actions .icon-button')?.click();
    const opened = Boolean(document.querySelector('#actionMenu'));
    document.dispatchEvent(new Event('scroll', {bubbles:true}));
    return {opened, closedOnScroll:!document.querySelector('#actionMenu')};
  })()`);
  const runningActions = await window.webContents.executeJavaScript(`(() => {
    showPrimary('running');
    const open = document.querySelector('.running-actions .open-forward-link');
    const retry = Array.from(document.querySelectorAll('.running-actions button')).find(button => button.textContent.includes('重试'));
    if (!open || !retry) return {found:false};
    const openRect = open.getBoundingClientRect();
    const retryRect = retry.getBoundingClientRect();
    return {found:true,open:{width:openRect.width,height:openRect.height},retry:{width:retryRect.width,height:retryRect.height}};
  })()`);
  const authUi = await window.webContents.executeJavaScript(`(() => {
    newConnection();
    const auth = document.querySelector('#conn_auth_type');
    const keyBox = document.querySelector('#keyAuthBox');
    const passwordBox = document.querySelector('#passwordAuthBox');
    if (!auth || !keyBox || !passwordBox) return {found:false};
    auth.value = 'password';
    toggleAuthFields();
    const passwordMode = {
      keyHidden:keyBox.hidden && getComputedStyle(keyBox).display === 'none',
      keyDisabled:Array.from(keyBox.querySelectorAll('input,select,button')).every(control=>control.disabled),
      passwordVisible:!passwordBox.hidden && getComputedStyle(passwordBox).display !== 'none',
      passwordEnabled:Array.from(passwordBox.querySelectorAll('input,select,button')).every(control=>!control.disabled)
    };
    auth.value = 'key';
    toggleAuthFields();
    const keyMode = {
      keyVisible:!keyBox.hidden && getComputedStyle(keyBox).display !== 'none',
      keyEnabled:Array.from(keyBox.querySelectorAll('input,select,button')).every(control=>!control.disabled),
      passwordHidden:passwordBox.hidden && getComputedStyle(passwordBox).display === 'none',
      passwordDisabled:Array.from(passwordBox.querySelectorAll('input,select,button')).every(control=>control.disabled)
    };
    return {found:true,passwordMode,keyMode};
  })()`);
  const saveAndClearUi = await window.webContents.executeJavaScript(`(async () => {
    const originalApi = api;
    const originalLoadAll = loadAll;
    const originalLoadKeys = loadKeys;
    const originalNotify = notify;
    const saved = [];
    const notices = [];
    api = async (url, options={}) => { if(url==='/api/connections'&&options.method==='POST') saved.push(JSON.parse(options.body)); return {}; };
    loadAll = async () => {};
    loadKeys = async () => {};
    notify = (...args) => notices.push(args);
    newConnection();
    document.querySelector('#conn_name').value='save-clear-test';
    document.querySelector('#conn_user').value='root';
    document.querySelector('#conn_host').value='example.test';
    const button=document.querySelector('#connSaveAndClear');
    const visible=Boolean(button&&!button.hidden&&getComputedStyle(button).display!=='none');
    button?.click();
    await new Promise(resolve=>setTimeout(resolve,25));
    const result={
      visible,
      saved:saved.length===1&&saved[0].name==='save-clear-test'&&saved[0].ssh_host==='example.test'&&saved[0].sort_order===1,
      cleared:document.querySelector('#conn_name')?.value===''&&document.querySelector('#conn_user')?.value===''&&document.querySelector('#conn_host')?.value===''&&document.querySelector('#conn_port')?.value==='22',
      defaultsRestored:document.querySelector('#conn_auth_type')?.value==='key'&&document.querySelector('#conn_sort_order')?.value==='1'&&document.querySelector('#conn_extra')?.value.includes('ServerAliveInterval=60'),
      focused:document.activeElement===document.querySelector('#conn_name'),
      notice:notices.some(args=>String(args[0]).includes('表单已清空')),
      readyAgain:button?.disabled===false&&button?.textContent.trim()==='保存并清空'
    };
    api=originalApi;
    loadAll=originalLoadAll;
    loadKeys=originalLoadKeys;
    notify=originalNotify;
    return result;
  })()`);
  const notificationUi = await window.webContents.executeJavaScript(`(async () => {
    const originalNotify = notify;
    const originalDesktop = showDesktopNotification;
    const replayed = [];
    notify = (...args) => replayed.push({type:'toast',args});
    showDesktopNotification = event => replayed.push({type:'desktop',id:event?.id});
    lastNotificationId = 0;
    notificationCursorInitialized = false;
    notificationCursorPromise = null;
    localStorage.removeItem('lastNotificationId');
    await pollNotifications();
    const result = {replayed:replayed.length,cursor:lastNotificationId,initialized:notificationCursorInitialized,stored:Number(localStorage.getItem('lastNotificationId')||0)};
    notify = originalNotify;
    showDesktopNotification = originalDesktop;
    return result;
  })()`);
  const restoreKeyUi = await window.webContents.executeJavaScript(`(async () => {
    const originalLoadIdentityBindingOptions = loadIdentityBindingOptions;
    const windowsIdentityPath = ['C:','Users','junruo','.ssh','id_rsa_junruo'].join('\\\\');
    loadIdentityBindingOptions = async () => ({
      items:[
        {name:'id_rsa_junruo',path:windowsIdentityPath,source_label:'用户 ~/.ssh'},
        {name:'id_rsa_project',path:'/project/.ssh/id_rsa_project',source_label:'当前密钥目录'}
      ],
      upload_directory:'/project/.ssh'
    });
    const items = Array.from({length:12}, (_, index) => ({
      binding_id:String(index),
      connection_id:index + 1,
      key_name:index < 6 ? 'old-key-a' : 'old-key-b',
      connection_name:'server-'+index,
      ssh_user:'test',
      ssh_host:'127.0.0.1',
      ssh_port:22,
      missing_identity:true
    }));
    const pending = showIdentityBindingModal(items, {subtitle:'UI smoke'});
    await new Promise(resolve => setTimeout(resolve, 0));
    const modal = document.querySelector('#modal');
    const card = modal?.querySelector('.restore-key-modal');
    const rows = [...modal.querySelectorAll('.identity-binding-row')];
    const candidates = [...modal.querySelectorAll('#identityBindingCandidate option')].map(item => item.textContent.trim());
    const candidate = modal.querySelector('#identityBindingCandidate');
    candidate.value = windowsIdentityPath;
    const candidateValuePreserved = candidate.value === windowsIdentityPath;
    modal.querySelector('#identityBindingRows input').checked = true;
    modal.querySelector('#identityBindingStage').click();
    const stagesWindowsPath = modal.querySelector('[data-binding-result="0"]')?.textContent.includes('已暂存：id_rsa_junruo');
    modal.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    const backdropIgnored = Boolean(!modal.hidden && modal.querySelector('.restore-key-modal') && modal.querySelector('[data-binding-result="0"]')?.textContent.includes('已暂存：id_rsa_junruo'));
    const input = modal?.querySelector('#identityBindingUpload');
    const status = modal?.querySelector('#restoreKeyStatus');
    const cardRect = card?.getBoundingClientRect();
    const result = {
      opened:Boolean(card && !modal.hidden),
      rowCount:rows.length,
      originalNames:[...new Set(rows.map(row => row.querySelector('code')?.textContent.trim()))],
      candidates,
      candidateValuePreserved,
      stagesWindowsPath,
      backdropIgnored,
      acceptsAll:input?.getAttribute('accept') === '*/*',
      uploadDirectory:modal.querySelector('#identityBindingDirectory')?.textContent.includes('/project/.ssh'),
      actions:['identityBindingTest','identityBindingStage','identityBindingFinish'].every(id => Boolean(modal.querySelector('#'+id))),
      statusReady:Boolean(status?.textContent),
      cardWithinViewport:Boolean(cardRect && cardRect.left >= -0.5 && cardRect.right <= innerWidth + 0.5 && cardRect.top >= -0.5 && cardRect.bottom <= innerHeight + 0.5)
    };
    modal.querySelector('#identityBindingFinish')?.click();
    const completedBindings = await pending;
    result.continuedWithUnbound = Array.isArray(completedBindings) && completedBindings.length === 1 && completedBindings[0].identity_path === windowsIdentityPath;
    const skipPending = showIdentityBindingModal(items, {subtitle:'UI smoke skip'});
    await new Promise(resolve => setTimeout(resolve, 0));
    document.querySelector('#identityBindingFinish')?.click();
    const skippedBindings = await skipPending;
    result.continuedAllUnbound = Array.isArray(skippedBindings) && skippedBindings.length === 0;
    const previousImportState = importState;
    importState = {tunnels:[{name:'unbound',ssh_user:'root',ssh_host:'config.example',ssh_port:22,sort_order:1,missing_identity:true}],missing_keys:['id_rsa_old']};
    try {
      importReady();
      result.configAllowsUnbound = true;
      renderImport();
      const sortInput = document.querySelector('#importResults .import-connection-head input');
      sortInput.value='4';
      sortInput.dispatchEvent(new Event('change',{bubbles:true}));
      result.configSortEditable=importState.tunnels[0].sort_order===4;
    } catch {
      result.configAllowsUnbound = false;
      result.configSortEditable = false;
    }
    importState = previousImportState;
    result.closed = document.querySelector('#modal').hidden && !document.querySelector('#modal .restore-key-modal');
    loadIdentityBindingOptions = originalLoadIdentityBindingOptions;
    return result;
  })()`);
  const restoreCredentialUi = await window.webContents.executeJavaScript(`(async () => {
    const originalLoadIdentityBindingOptions = loadIdentityBindingOptions;
    loadIdentityBindingOptions = async () => ({items:[{name:'id_key',path:'/fixture/.ssh/id_key',source_label:'当前密钥目录'}],upload_directory:'/fixture/.ssh'});
    const items = [
      {connection_id:1,connection_name:'key-server',ssh_user:'root',ssh_host:'key.example',ssh_port:22,sort_order:5,original_auth_type:'key',key_name:'id_old',has_password:false},
      {connection_id:2,connection_name:'password-saved',ssh_user:'root',ssh_host:'saved.example',ssh_port:22,sort_order:1,original_auth_type:'password',has_password:true,password_encrypted:false},
      {connection_id:3,connection_name:'password-empty',ssh_user:'root',ssh_host:'empty.example',ssh_port:22,sort_order:1,original_auth_type:'password',has_password:false,password_encrypted:false}
    ];
    const pending = showDatabaseCredentialModal(items,{subtitle:'credential smoke',password_replacement_allowed:true});
    await new Promise(resolve => setTimeout(resolve,0));
    const modal = document.querySelector('#modal');
    const originalLabels = [...modal.querySelectorAll('.identity-binding-row code')].map(node=>node.textContent.trim());
    const initialStatuses = [...modal.querySelectorAll('.identity-binding-result')].map(node=>node.textContent.trim());
    const candidate = modal.querySelector('#identityBindingCandidate');
    candidate.value='/fixture/.ssh/id_key';
    modal.querySelector('input[value="1"]').checked=true;
    modal.querySelector('#identityBindingStage').click();
    modal.querySelector('#identitySelectNone').click();
    modal.querySelector('input[value="3"]').checked=true;
    modal.querySelector('#credentialPassword').value='fixture-password';
    modal.querySelector('#credentialPasswordStage').click();
    const stagedStatuses = [...modal.querySelectorAll('.identity-binding-result')].map(node=>node.textContent.trim());
    const sortFields = [...modal.querySelectorAll('[data-restore-sort]')].map(input=>input.value);
    modal.querySelector('[data-restore-sort="1"]').value='7';
    const cardRect = modal.querySelector('.restore-credential-modal')?.getBoundingClientRect();
    modal.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    const backdropIgnored=Boolean(!modal.hidden&&modal.querySelector('.restore-credential-modal')&&modal.querySelector('[data-restore-sort="1"]')?.value==='7');
    modal.querySelector('#identityBindingFinish').click();
    const bindings = await pending;
    loadIdentityBindingOptions = originalLoadIdentityBindingOptions;
    return {
      opened:originalLabels.length===3,
      backdropIgnored,
      originalLabels,
      initialStatuses,
      stagedStatuses,
      preservesSavedPassword:bindings.some(item=>item.connection_id===2&&item.auth_type==='password'&&item.password_action==='preserve'),
      replacesMissingPassword:bindings.some(item=>item.connection_id===3&&item.auth_type==='password'&&item.password_action==='replace'&&item.password==='fixture-password'),
      bindsKey:bindings.some(item=>item.connection_id===1&&item.auth_type==='key'&&item.identity_path==='/fixture/.ssh/id_key'),
      sortFields:JSON.stringify(sortFields)===JSON.stringify(['5','1','1']),
      updatesSort:bindings.some(item=>item.connection_id===1&&item.sort_order===7),
      preservesSort:bindings.some(item=>item.connection_id===2&&item.sort_order===1)&&bindings.some(item=>item.connection_id===3&&item.sort_order===1),
      cardWithinViewport:Boolean(cardRect&&cardRect.left>=-0.5&&cardRect.right<=innerWidth+0.5&&cardRect.top>=-0.5&&cardRect.bottom<=innerHeight+0.5),
      closed:modal.hidden&&!modal.querySelector('.restore-credential-modal')
    };
  })()`);
  const terminalUi = await window.webContents.executeJavaScript(`(async () => {
    const first = connections[0];
    if (!first) return {found:false};
    const key = 'terminal-ui-smoke';
    const secondKey = 'terminal-ui-smoke-second';
    const previousTerminalTabKey = activeTabKey;
    const previousLatencyVisible = terminalLatencyVisible;
    const previousLatencyStored = localStorage.getItem('terminalLatencyVisible');
    const previousTerminalGlobalSettings = terminalGlobalSettings;
    let binaryWrite = false;
    let fakeLinkProvider = null;
    let fakeSelectionHandler = null;
    const fakeTerm = {
      hasSelection:()=>true,
      getSelection:()=> 'selected text',
      selectAll:()=>{}, clear:()=>{}, focus:()=>{}, scrollToBottom:()=>{}, writeln:()=>{}, refresh:()=>{},
      write:data=>{ binaryWrite = data instanceof Uint8Array && data[0]===0xff && data[1]===0xfe; },
      onData:()=>({dispose:()=>{}}), onResize:()=>({dispose:()=>{}}),
      onSelectionChange:handler=>{ fakeSelectionHandler=handler; return {dispose:()=>{}}; },
      registerLinkProvider:provider=>{ fakeLinkProvider=provider; return {dispose:()=>{}}; },
      cols:80, rows:24, options:{fontSize:13}, buffer:{active:{length:0,cursorX:0,cursorY:0}}
    };
    terminalSessions.set(key,{term:fakeTerm,fit:{fit:()=>{}},id:first.id});
    const OriginalWebSocket = window.WebSocket;
    class FakeWebSocket extends EventTarget {
      static OPEN = 1;
      constructor(){ super(); this.readyState=1; this.binaryType='blob'; this.sent=[]; }
      send(data){ this.sent.push(data); }
      close(){}
    }
    window.WebSocket = FakeWebSocket;
    connectTerminal(first,key);
    const fakeSocket = terminalSessions.get(key).socket;
    fakeSocket.dispatchEvent(new MessageEvent('message',{data:new Uint8Array([0xff,0xfe]).buffer}));
    const binaryType = fakeSocket.binaryType;
    window.WebSocket = OriginalWebSocket;
    const connectionAddress=first.ssh_user+'@'+first.ssh_host+':'+first.ssh_port;
    document.querySelector('#view-terminal').innerHTML='<div id="terminalToolbarMount"><div class="terminal-toolbar"><div class="terminal-title-row"><span class="terminal-connection-dot"></span><span id="terminalStatus" class="terminal-status" data-connection-address="'+connectionAddress+'" data-connection-state="连接中"></span><span id="terminalLatency" class="terminal-latency pending"></span></div><div class="actions terminal-actions"><button class="terminal-action-reconnect"></button></div></div></div><div id="terminalMount" class="terminal-box"></div>';
    setWorkspace('终端测试',connectionAddress,'terminal',key,false,true,{kind:'terminal',id:first.id});
    activeTabKey = key;
    updateTerminalConnectionStatus(first, key, '已连接');
    const statusIndicator = document.querySelector('#terminalStatus');
    const statusHoverShowsFull = statusIndicator?.title === connectionAddress+' · 已连接';
    const desktopStatusAvoidsDuplicate = statusIndicator?.textContent === ''
      && document.querySelector('#workspaceSubtitle')?.textContent === connectionAddress;
    const desktopToolbarInHeader = statusIndicator?.closest('#workspaceHeaderTools') !== null
      && document.querySelector('#workspaceHeaderTools')?.hidden === false
      && document.querySelector('#terminalToolbarMount')?.children.length === 0;
    const latencySession = terminalSessions.get(key);
    latencySession.connected = true;
    updateTerminalConnectionToggle(key);
    const connectionToggle = document.querySelector('.terminal-action-reconnect');
    const connectionToggleUsesLinkAction = Boolean(connectionToggle?.querySelector('.lucide-link-2-off') && connectionToggle.title.includes('断开'));
    terminalLatencyVisible = true;
    latencySession.latencyPendingAt = performance.now() - 80;
    finishTerminalLatencySample(latencySession, key);
    const latencyIndicator = document.querySelector('#terminalLatency');
    const latencyMeasured = Number.isFinite(latencySession.latencyMs)
      && latencySession.latencyMs >= 60
      && latencySession.latencyMs <= 250
      && latencyIndicator?.textContent.includes('ms');
    setTerminalLatencyVisible(false);
    const latencyCanDisable = latencyIndicator?.hidden === true && localStorage.getItem('terminalLatencyVisible') === '0';
    setTerminalLatencyVisible(true);
    const latencyCanEnable = latencyIndicator?.hidden === false && localStorage.getItem('terminalLatencyVisible') === '1';
    const mount=document.querySelector('#terminalMount');
    terminalGlobalSettings=normalizeTerminalGlobalSettings(defaultTerminalGlobalSettings);
    showTerminalEncodingMenu(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:160,clientY:100}),key,first.id);
    const encodingLabels=[...document.querySelectorAll('#actionMenu button span')].map(item=>item.textContent.trim());
    const encodingMenuOpened=['UTF-8','GB18030','GBK','Big5','Shift_JIS','EUC-KR','ISO-8859-1'].every(label=>encodingLabels.includes(label));
    hideActionMenu();
    showTerminalFontMenu(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:180,clientY:100}),key,first.id);
    const fontLabels=[...document.querySelectorAll('#actionMenu button span')].map(item=>item.textContent.trim());
    const fontMenuOpened=['系统等宽','Cascadia','JetBrains Mono','Consolas','自定义字体…','紧凑行距 1.0','行距 1.4','常规字重','半粗字重','恢复终端显示默认值'].every(label=>fontLabels.includes(label));
    hideActionMenu();
    bindTerminalGlobalBehavior(terminalSessions.get(key),key,first.id,mount);
    mount.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:120,clientY:120}));
    const labels=Array.from(document.querySelectorAll('#actionMenu button span')).map(el=>el.textContent.trim());
    hideActionMenu();
    await showTerminalGlobalSettings(key);
    const terminalSettingsCard=document.querySelector('#modal .terminal-settings-modal');
    const terminalSettingsRect=terminalSettingsCard?.getBoundingClientRect();
    const terminalSettingsUi={
      open:Boolean(terminalSettingsCard&&!document.querySelector('#modal')?.hidden),
      globalScope:Boolean(terminalSettingsCard?.textContent.includes('应用到全部连接和终端会话')),
      controls:['terminalSettingMiddleMouse','terminalSettingRightMouse','terminalSettingCtrlClick','terminalSettingUrlLinks','terminalSettingWordSeparators','terminalSettingAutoCopy','terminalSettingMultilinePaste'].every(id=>Boolean(document.querySelector('#'+id))),
      withinViewport:Boolean(terminalSettingsRect&&terminalSettingsRect.left>=-0.5&&terminalSettingsRect.right<=innerWidth+0.5&&terminalSettingsRect.top>=-0.5&&terminalSettingsRect.bottom<=innerHeight+0.5),
      requestedDefaults:defaultTerminalGlobalSettings.url_links_enabled===true&&defaultTerminalGlobalSettings.auto_copy_selection===false&&defaultTerminalGlobalSettings.copy_include_trailing_newline===false,
      editablePasteSetting:document.querySelector('#terminalSettingMultilinePaste')?.selectedOptions[0]?.textContent.includes('可编辑命令窗口')
    };
    closeTerminalGlobalSettings(key);
    const secondTerm={options:{},rows:24,refresh:()=>{}};
    terminalSessions.set(secondKey,{term:secondTerm,id:first.id});
    terminalGlobalSettings=normalizeTerminalGlobalSettings({...defaultTerminalGlobalSettings,word_separators:'-_'});
    applyTerminalGlobalSettingsToSessions();
    terminalSettingsUi.appliesToAllOpenSessions=fakeTerm.options.wordSeparator==='-_'&&secondTerm.options.wordSeparator==='-_';
    terminalSettingsUi.copyFormatting=formatTerminalCopiedText('one\\t  \\r\\ntwo  ',{...defaultTerminalGlobalSettings,copy_tabs_to_spaces:true,copy_trim_trailing_spaces:true,copy_include_trailing_newline:false})==='one\\ntwo';
    terminalSettingsUi.singleLinePaste=terminalSingleLinePaste('one\\r\\n two \\n\\nthree')==='one two three';
    fakeTerm.buffer.active.getLine=()=>({translateToString:()=> 'open https://example.test/path.',length:32});
    terminalGlobalSettings=normalizeTerminalGlobalSettings({...defaultTerminalGlobalSettings,url_links_enabled:true,url_prefixes:['https://']});
    let providedLinks;
    fakeLinkProvider?.provideLinks(1,links=>{providedLinks=links;});
    terminalSettingsUi.linkProvider=Boolean(providedLinks?.length===1&&providedLinks[0].text==='https://example.test/path'&&fakeSelectionHandler);
    terminalGlobalSettings=normalizeTerminalGlobalSettings(defaultTerminalGlobalSettings);
    const pastePromise=sendTerminalPasteText(key,'first command\\nsecond command');
    await new Promise(resolve=>setTimeout(resolve,0));
    const pasteModal=document.querySelector('#modal .terminal-paste-modal');
    const pasteModalRect=pasteModal?.getBoundingClientRect();
    const pasteEditor=document.querySelector('#terminalPasteEditor');
    const pasteOriginalValue=pasteEditor.value;
    document.querySelector('#modal')?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    const pasteBackdropIgnored=Boolean(!document.querySelector('#modal')?.hidden&&pasteEditor.isConnected&&pasteEditor.value===pasteOriginalValue);
    pasteEditor.value='edited command\\nsecond command';
    pasteEditor.dispatchEvent(new Event('input',{bubbles:true}));
    const pasteEditable=Boolean(pasteModal&&pasteEditor&&!pasteEditor.readOnly&&document.activeElement===pasteEditor);
    const pasteSummaryUpdated=document.querySelector('#terminalPasteSummary')?.textContent.includes('2 行');
    document.querySelector('#terminalPasteConfirm')?.click();
    const pasteSent=await pastePromise;
    terminalSettingsUi.editablePaste=Boolean(pasteBackdropIgnored&&pasteEditable&&pasteSummaryUpdated&&pasteModalRect&&pasteModalRect.left>=-0.5&&pasteModalRect.right<=innerWidth+0.5&&pasteModalRect.top>=-0.5&&pasteModalRect.bottom<=innerHeight+0.5&&pasteSent&&fakeSocket.sent.at(-1)==='edited command\\nsecond command');
    const toolbarFixture=document.createElement('div');
    toolbarFixture.className='terminal-toolbar';
    toolbarFixture.style.width='100%';
    toolbarFixture.innerHTML='<div class="terminal-title-row"><span class="terminal-connection-dot"></span><span class="terminal-status">tester@example.invalid:22 · 已连接</span><span class="terminal-latency good">延迟 5 ms</span></div><div class="actions terminal-actions"><button class="icon-button">'+icon('folder-open')+'</button><button class="icon-button">'+icon('minus')+'</button><button class="icon-button">'+icon('plus')+'</button><button class="terminal-dropdown-button">'+icon('languages')+'<span>UTF-8</span>'+icon('chevron-down')+'</button><button class="terminal-dropdown-button">'+icon('type')+'<span>字体</span>'+icon('chevron-down')+'</button><button class="icon-button terminal-global-settings-button">'+icon('settings')+'</button><button class="terminal-action-keys">'+icon('keyboard')+'<span>快捷键</span></button><button>'+icon('history')+'<span>最近命令</span></button><button>'+icon('link-2')+'<span>重连</span></button><button>'+icon('play')+'<span>启用转发</span></button></div>';
    const toolbarViewFixture=document.createElement('div');
    toolbarViewFixture.style.width='540px';
    toolbarViewFixture.style.containerType='inline-size';
    toolbarViewFixture.style.containerName='terminal-view';
    toolbarViewFixture.appendChild(toolbarFixture);
    document.body.appendChild(toolbarViewFixture);
    const toolbar=toolbarFixture.querySelector('.terminal-actions');
    const toolbarRect=toolbar.getBoundingClientRect();
    const toolbarButtons=[...toolbar.querySelectorAll('button')];
    const desktopKeysHidden=getComputedStyle(toolbarFixture.querySelector('.terminal-action-keys')).display==='none';
    const visibleToolbarButtons=toolbarButtons.filter(button=>getComputedStyle(button).display!=='none');
    const compactLabelsHidden=toolbarButtons
      .filter(button=>!button.classList.contains('terminal-dropdown-button'))
      .flatMap(button=>[...button.querySelectorAll(':scope > span')])
      .every(span=>getComputedStyle(span).display==='none');
    const compactActionsLeftAligned=Math.abs(toolbarButtons[0].getBoundingClientRect().left-toolbarRect.left)<1;
    const narrowToolbarFits=compactLabelsHidden&&visibleToolbarButtons.every(button=>{
      const rect=button.getBoundingClientRect();
      return rect.left>=toolbarRect.left-0.5&&rect.right<=toolbarRect.right+0.5;
    });
    toolbarViewFixture.style.width='720px';
    const widerToolbar=toolbarFixture.querySelector('.terminal-actions');
    const widerToolbarRect=widerToolbar.getBoundingClientRect();
    const widerActionsLeftAligned=Math.abs(widerToolbar.querySelector('button').getBoundingClientRect().left-widerToolbarRect.left)<1;
    const narrowToolbarLeftAligned=compactActionsLeftAligned&&widerActionsLeftAligned;
    toolbarViewFixture.style.width='540px';
    const responsiveView=document.querySelector('#view-terminal');
    const previousResponsiveStyle=responsiveView.style.cssText;
    responsiveView.style.width='1000px';
    responsiveView.style.flex='0 0 1000px';
    const responsiveToolbar=toolbarFixture.cloneNode(true);
    responsiveToolbar.style.width='100%';
    responsiveView.prepend(responsiveToolbar);
    const responsiveTitleRect=responsiveToolbar.querySelector('.terminal-title-row').getBoundingClientRect();
    const responsiveActions=responsiveToolbar.querySelector('.terminal-actions');
    const responsiveActionsRect=responsiveActions.getBoundingClientRect();
    const responsiveButtons=[...responsiveActions.querySelectorAll('button')].filter(button=>getComputedStyle(button).display!=='none');
    const responsiveToolbarFits=responsiveActionsRect.top>=responsiveTitleRect.bottom-0.5
      && responsiveButtons.every(button=>{
        const rect=button.getBoundingClientRect();
        return rect.left>=responsiveActionsRect.left-0.5&&rect.right<=responsiveActionsRect.right+0.5;
      });
    responsiveToolbar.remove();
    responsiveView.style.cssText=previousResponsiveStyle;
    const backFixture=document.createElement('div');
    backFixture.className='terminal-title-row';
    backFixture.innerHTML='<button class="terminal-mobile-back">'+icon('arrow-left')+'<span>返回</span></button>';
    document.body.appendChild(backFixture);
    const desktopBackHidden=getComputedStyle(backFixture.querySelector('.terminal-mobile-back')).display==='none';
    const metrics=visibleToolbarButtons.map(button=>{const br=button.getBoundingClientRect(),svg=button.querySelector('svg').getBoundingClientRect();return {buttonHeight:br.height,iconWidth:svg.width,iconHeight:svg.height,centerDelta:Math.abs((svg.top+svg.height/2)-(br.top+br.height/2))}});
    toolbarViewFixture.remove();
    backFixture.remove();
    const replacementMount=document.querySelector('#terminalToolbarMount');
    const replacementToolbar=document.createElement('div');
    replacementToolbar.className='terminal-toolbar';
    replacementToolbar.innerHTML='<div class="terminal-title-row"><span id="terminalStatus" class="terminal-status" data-connection-address="replacement:22" data-connection-state="已连接"></span></div><div class="actions terminal-actions"></div>';
    replacementMount.appendChild(replacementToolbar);
    syncTerminalToolbarPlacement();
    const activeToolbarReplacesPrevious=document.querySelector('#workspaceHeaderTools')?.children.length===1
      && document.querySelector('#workspaceHeaderTools')?.firstElementChild===replacementToolbar
      && replacementMount.children.length===0;
    hideActionMenu();
    terminalSessions.delete(secondKey);
    terminalSessions.delete(key);
    terminalGlobalSettings = previousTerminalGlobalSettings;
    activeTabKey = previousTerminalTabKey;
    terminalLatencyVisible = previousLatencyVisible;
    if (previousLatencyStored === null) localStorage.removeItem('terminalLatencyVisible');
    else localStorage.setItem('terminalLatencyVisible', previousLatencyStored);
    return {found:true,labels,metrics,desktopBackHidden,desktopKeysHidden,binaryType,binaryWrite,encodingMenuOpened,fontMenuOpened,statusHoverShowsFull,desktopStatusAvoidsDuplicate,desktopToolbarInHeader,connectionToggleUsesLinkAction,activeToolbarReplacesPrevious,narrowToolbarFits,narrowToolbarLeftAligned,responsiveToolbarFits,latencyMeasured,latencyCanDisable,latencyCanEnable,terminalSettingsUi};
  })()`);
  console.log("[ui-smoke] log settings");
  const logSettingsUi = await window.webContents.executeJavaScript(`(async () => {
    await showLogSettings();
    const modal=document.querySelector('#modal');
    const card=modal?.querySelector('.modal-card');
    const buttons=card?[...card.querySelectorAll('button')]:[];
    const result={
      open:Boolean(modal&&!modal.hidden&&card),
      accessible:card?.getAttribute('role')==='dialog'&&card?.getAttribute('aria-modal')==='true',
      days:document.querySelector('#logSettingDays')?.value,
      fileMb:document.querySelector('#logSettingFileMb')?.value,
      totalMb:document.querySelector('#logSettingTotalMb')?.value,
      rotations:document.querySelector('#logSettingRotations')?.value,
      cleanup:Boolean(buttons.find(button=>button.textContent.includes('立即清理'))),
      save:Boolean(buttons.find(button=>button.textContent.includes('保存')))
    };
    closeModal();
    result.closed=Boolean(modal?.hidden);
    return result;
  })()`);
  console.log("[ui-smoke] SFTP views");
  const sftpUi = await window.webContents.executeJavaScript(`(async () => {
    try {
    const view = document.querySelector('#view-sftp');
    const previousHtml = view.innerHTML;
    const previousHidden = view.hidden;
    const previousState = sftpState;
    const previousOpen = openSftp;
    const previousPreview = previewSftpText;
    const previousClipboardState = sftpClipboard;
    const previousLoadSftpPage = loadSftpPage;
    const previousRefreshSftpJobs = refreshSftpJobs;
    const previousStartSftpJobsTimer = startSftpJobsTimer;
    const previousSelectedId = selectedId;
    const previousActiveView = activeView;
    const previousActiveTabKey = activeTabKey;
    const previousDirectorySizes = [...sftpDirectorySizeCache.entries()];
    const connection = connections[0];
    let directoryActionsUi = {found:false};
    let connectionSessionUi = {found:false};
    let nativeDragUi = {found:false};
    let globalSettingsUi = {found:false};
    let directoryCacheBehavior = {sameResponseUntouched:false,changedResponseRendered:false,boundedAndExpired:false};
    let sftpPageLoads = 0;
    const sftpPageLoadOptions = [];
    try {
      loadSftpPage = async options => { sftpPageLoads += 1; sftpPageLoadOptions.push({...options}); return true; };
      refreshSftpJobs = async () => {};
      startSftpJobsTimer = () => {};
      sftpClipboard = null;
      await openSftp(connection.id, '/Users/junruo/Public', false);
      activeTabKey = 'sftp-' + connection.id;
      setWorkspace('切换测试', 'UI', 'welcome', 'sftp-switch-fixture', false, true);
      await openSftp(connection.id, '/Users/junruo/Public', false);
      let stickyTop = view.querySelector('.sftp-top');
      let toolbar = document.querySelector('#workspaceHeaderTools .sftp-toolbar') || view.querySelector('.sftp-toolbar');
      let navigationRow = view.querySelector('.sftp-navigation-row');
      let breadcrumb = view.querySelector('.sftp-breadcrumb');
      let pathEditor = view.querySelector('#sftpPathEditor');
      let floatingSearch = view.querySelector('#sftpFloatingSearch');
      let dropOverlay = view.querySelector('#sftpDropOverlay');
      let clipboardActions = toolbar?.querySelector('#sftpClipboardActions') || view.querySelector('#sftpClipboardActions') || document.querySelector('#sftpClipboardActions') || document.createElement('span');
      const actionTitles = [...toolbar?.querySelectorAll('button, label') || []].map(node => node.title || node.getAttribute('aria-label') || '').filter(Boolean);
      const emptyClipboardHidden = Boolean(clipboardActions && !clipboardActions.querySelector('button') && !clipboardActions.textContent.trim());
      const reusedWithSilentRefresh = sftpPageLoads === 2
        && sftpPageLoadOptions[1]?.silent === true
        && sftpPageLoadOptions[1]?.renderIfChangedOnly === true
        && sftpPageLoadOptions[1]?.refresh === true;
      showSftpPathEditor();
      const visiblePathControls = [...(view.querySelector('.sftp-path-block')?.children || [])]
        .filter(node => getComputedStyle(node).display !== 'none');
      const pathEditorReplacesBreadcrumb = Boolean(
        breadcrumb?.hidden
        && getComputedStyle(breadcrumb).display === 'none'
        && pathEditor
        && !pathEditor.hidden
        && getComputedStyle(pathEditor).display !== 'none'
        && document.querySelector('#sftpPathEditButton')?.hidden
        && visiblePathControls.length === 1
        && visiblePathControls[0] === pathEditor
      );
      hideSftpPathEditor();
      const preservedListHtml = view.querySelector('#sftpList')?.innerHTML;
      updateSftpConnectionUi(connection.id, 'disconnected', '测试断线');
      const disconnectedButton = (document.querySelector('#workspaceHeaderTools .sftp-toolbar') || view.querySelector('.sftp-toolbar'))?.querySelector('#sftpConnectionToggle');
      const disconnectedBanner = view.querySelector('#sftpConnectionBanner');
      const disconnectedAction = Boolean(disconnectedButton?.querySelector('.lucide-link-2') && !disconnectedButton?.querySelector('.lucide-link-2-off'));
      const bannerVisible = Boolean(disconnectedBanner && !disconnectedBanner.hidden && disconnectedBanner.querySelector('.sftp-connection-detail')?.textContent === '测试断线');
      const preservedWhileDisconnected = view.querySelector('#sftpList')?.innerHTML === preservedListHtml;
      updateSftpConnectionUi(connection.id, 'connected');
      sftpDisconnectedTabs.add('sftp-' + connection.id);
      const disconnectedPageLoads = sftpPageLoads;
      await openSftp(connection.id, '/Users/junruo/Public', false);
      const disconnectedTabSwitchDoesNotReconnect = sftpPageLoads === disconnectedPageLoads;
      await openSftp(connection.id, '/Users/junruo/Public', true);
      const disconnectedFolderOperationReconnects = sftpPageLoads === disconnectedPageLoads + 1;
      const savedConnectApi = api;
      let automaticConnectCalls = 0;
      updateSftpConnectionUi(connection.id, 'disconnected');
      sftpDisconnectedTabs.add('sftp-' + connection.id);
      sftpConnectionRequests.clear();
      api = async (path, options={}) => {
        if (String(path).includes('/sftp/session') && options.method === 'POST') {
          automaticConnectCalls += 1;
          await new Promise(resolve => setTimeout(resolve, 10));
          return {connected:true,status:'connected'};
        }
        return {};
      };
      const automaticConnectResults = await Promise.all([
        ensureSftpConnection(connection.id),
        ensureSftpConnection(connection.id)
      ]);
      const automaticConnectStatus = document.querySelector('#sftpConnectionToggle')?.dataset.status || '';
      const automaticConnectShared = automaticConnectCalls === 1
        && automaticConnectResults.every(Boolean)
        && automaticConnectStatus === 'connected'
        && !sftpConnectionRequests.has(connection.id);
      const reconnectSequence = [];
      api = async (path, options={}) => {
        if (String(path).includes('/sftp/session') && options.method === 'DELETE') {
          reconnectSequence.push('disconnect-start');
          await new Promise(resolve => setTimeout(resolve, 15));
          reconnectSequence.push('disconnect-done');
          return {connected:false,status:'disconnected'};
        }
        if (String(path).includes('/sftp/session') && options.method === 'POST') {
          reconnectSequence.push('connect');
          return {connected:true,status:'connected'};
        }
        return {};
      };
      const manualDisconnectRequest = disconnectSftpConnection(connection.id);
      const operationReconnectRequest = ensureSftpConnection(connection.id);
      await Promise.all([manualDisconnectRequest, operationReconnectRequest]);
      const manualDisconnectAutoReconnect = reconnectSequence.join(',') === 'disconnect-start,disconnect-done,connect'
        && document.querySelector('#sftpConnectionToggle')?.dataset.status === 'connected'
        && !sftpDisconnectRequests.has(connection.id)
        && !sftpConnectionRequests.has(connection.id);
      api = savedConnectApi;

      const nativeDragApi = api;
      const nativeDragBridgeDescriptor = Object.getOwnPropertyDescriptor(window, 'tunnelDeskDesktop');
      const nativeDragNotify = notify;
      const nativeDragFallbackNoticeWasShown = sftpNativeDragFallbackNoticeShown;
      const nativeDragFallbackNotices = [];
      const nativeDragRenameNotices = [];
      const nativeDragRow = document.createElement('div');
      const nativeDragDropTarget = document.createElement('button');
      const nativeDragEntries = [{path:'/source/native-drag.txt',name:'native-drag.txt',type:'file'}];
      const nativeDragKey = sftpNativeDragKey(connection.id, nativeDragEntries);
      const nativeDragBridgeCalls = [];
      const nativeDragTargetCalls = [];
      const nativeDragActivateCalls = [];
      const nativeDragCancelCalls = [];
      const nativeDragCrossRequests = [];
      let nativeDragStageCalls = 0;
      let nativeDragCallReturned = false;
      let nativeDragPhase = '';
      let webExternalDragBlocked = false;
      const nativeDragEvent = () => ({
        preventDefault(){ this.defaultPrevented = true; },
        defaultPrevented:false,
        currentTarget:nativeDragRow,
        dataTransfer:{effectAllowed:'',setData(){}},
        clientX:window.innerWidth - 1,
        clientY:window.innerHeight - 1
      });
      try {
        nativeDragRow.className = 'sftp-row';
        nativeDragDropTarget.className = 'tab';
        document.body.append(nativeDragRow, nativeDragDropTarget);
        sftpNativeDragCache.delete(nativeDragKey);
        sftpNativeDragArmed.delete(nativeDragKey);
        Object.defineProperty(window, 'tunnelDeskDesktop', {
          configurable:true,
          writable:true,
          value:undefined
        });
        let webStageCalls = 0;
        api = async (pathname, options={}) => {
          if (pathname.endsWith('/sftp/stage-drag') && options.method === 'POST') webStageCalls += 1;
          return nativeDragApi(pathname, options);
        };
        const webDragEvent = nativeDragEvent();
        beginSftpItemDrag(webDragEvent, connection.id, nativeDragEntries[0].path, nativeDragEntries[0].name, nativeDragEntries[0].type);
        handleSftpDocumentDragLeave({relatedTarget:null,clientX:0,clientY:0});
        await new Promise(resolve => setTimeout(resolve, 100));
        webExternalDragBlocked = webStageCalls === 0
          && sftpNativeDragRequests.size === 0
          && document.querySelector('#sftpDragHint')?.textContent.includes('Web 版不能拖到系统');
        finishSftpItemDrag({...webDragEvent,currentTarget:nativeDragRow,clientX:0,clientY:0});
        api = async (pathname, options={}) => {
          if (pathname.endsWith('/sftp/stage-drag') && options.method === 'POST') {
            nativeDragStageCalls += 1;
            return {files:['C:\\TunnelDesk\\drag-cache\\native-drag.txt']};
          }
          return nativeDragApi(pathname, options);
        };
        sftpNativeDragFallbackNoticeShown = false;
        notify = (text, type='info') => {
          const message = String(text || '');
          if (message.includes('Linux 一次拖出当前不可用')) {
            nativeDragFallbackNotices.push({text:message,type});
          }
          if (message.includes('Finder 已自动保存为')) {
            nativeDragRenameNotices.push({text:message,type});
          }
          return nativeDragNotify(text, type);
        };
        Object.defineProperty(window, 'tunnelDeskDesktop', {
          configurable:true,
          writable:true,
          value:{
            ...(nativeDragBridgeDescriptor?.value || {}),
            capabilities:{
              ...(nativeDragBridgeDescriptor?.value?.capabilities || {}),
              platform:'linux',
              sftpExternalDrag:'staged',
              sftpNativeDragStart:'leave-window',
              sftpNativeDragReason:'fusermount3 is unavailable'
            },
            startSftpDrag(payload, requestId) {
              nativeDragBridgeCalls.push({
                files:Array.isArray(payload) ? [...payload] : [],
                payload,
                requestId,
                phase:nativeDragPhase,
                synchronous:!nativeDragCallReturned
              });
            },
            setSftpDragTarget(requestId, target) {
              nativeDragTargetCalls.push({requestId,target});
            },
            activateSftpDrag(requestId) {
              nativeDragActivateCalls.push(requestId);
            },
            cancelSftpDrag(requestId) {
              nativeDragCancelCalls.push(requestId);
            }
          }
        });

        nativeDragPhase = 'stage';
        nativeDragCallReturned = false;
        const firstDragEvent = nativeDragEvent();
        beginSftpItemDrag(firstDragEvent, connection.id, nativeDragEntries[0].path, nativeDragEntries[0].name, nativeDragEntries[0].type);
        nativeDragCallReturned = true;
        const linuxFallbackHint = document.querySelector('#sftpDragHint')?.textContent || '';
        if (sftpInternalDrag) sftpInternalDrag.leftWindow = true;
        await new Promise(resolve => setTimeout(resolve, 20));
        const firstDragOnlyStages = nativeDragStageCalls === 1
          && nativeDragBridgeCalls.length === 0
          && sftpNativeDragArmed.has(nativeDragKey)
          && sftpNativeDragCache.get(nativeDragKey)?.files?.length === 1;
        finishSftpItemDrag({...firstDragEvent,currentTarget:nativeDragRow,clientX:window.innerWidth,clientY:window.innerHeight});
        const firstDragReset = sftpInternalDrag === null
          && !nativeDragRow.classList.contains('is-dragging')
          && !document.body.classList.contains('sftp-item-drag-active');

        nativeDragPhase = 'cached-internal';
        sftpNativeDragArmed.delete(nativeDragKey);
        nativeDragCallReturned = false;
        const secondDragEvent = nativeDragEvent();
        beginSftpItemDrag(secondDragEvent, connection.id, nativeDragEntries[0].path, nativeDragEntries[0].name, nativeDragEntries[0].type);
        nativeDragCallReturned = true;
        const cachedUnarmedStaysInternal = Boolean(
          !secondDragEvent.defaultPrevented
          && sftpInternalDrag?.connectionId === Number(connection.id)
          && nativeDragBridgeCalls.length === 0
          && !sftpNativeDragArmed.has(nativeDragKey)
        );
        handleSftpDocumentDragLeave({relatedTarget:null,clientX:0,clientY:0});
        finishSftpItemDrag({...secondDragEvent,currentTarget:nativeDragRow,clientX:0,clientY:0});
        await new Promise(resolve => setTimeout(resolve, 100));
        const sameWindowDropDoesNotArm = sftpInternalDrag === null && !sftpNativeDragArmed.has(nativeDragKey);

        nativeDragPhase = 'failure';
        sftpNativeDragArmed.add(nativeDragKey);
        nativeDragCallReturned = false;
        const armedDragEvent = nativeDragEvent();
        beginSftpItemDrag(armedDragEvent, connection.id, nativeDragEntries[0].path, nativeDragEntries[0].name, nativeDragEntries[0].type);
        nativeDragCallReturned = true;
        const failedCall = nativeDragBridgeCalls.at(-1);
        const armedDragStartsSynchronously = Boolean(
          armedDragEvent.defaultPrevented
          && failedCall?.phase === 'failure'
          && failedCall.synchronous
          && failedCall.files?.[0] === 'C:\\TunnelDesk\\drag-cache\\native-drag.txt'
          && nativeDragStageCalls === 1
        );
        nativeDragRow.classList.add('is-dragging', 'is-preparing-drag');
        nativeDragDropTarget.classList.add('sftp-drop-target');
        document.body.classList.add('sftp-item-drag-active');
        handleSftpNativeDragResult({requestId:failedCall?.requestId,ok:false,message:'native drag rejected'});
        const failureRearmed = Boolean(
          failedCall?.requestId
          && !sftpNativeDragRequests.has(failedCall.requestId)
          && sftpNativeDragArmed.has(nativeDragKey)
          && sftpNativeDragCache.get(nativeDragKey)?.files?.length === 1
          && !nativeDragRow.classList.contains('is-dragging')
          && !nativeDragRow.classList.contains('is-preparing-drag')
          && !nativeDragDropTarget.classList.contains('sftp-drop-target')
          && !document.body.classList.contains('sftp-item-drag-active')
          && !document.querySelector('#sftpDragHint')
        );

        nativeDragPhase = 'retry';
        nativeDragCallReturned = false;
        const retryDragEvent = nativeDragEvent();
        beginSftpItemDrag(retryDragEvent, connection.id, nativeDragEntries[0].path, nativeDragEntries[0].name, nativeDragEntries[0].type);
        nativeDragCallReturned = true;
        const successfulCall = nativeDragBridgeCalls.at(-1);
        nativeDragRow.classList.add('is-dragging', 'is-preparing-drag');
        nativeDragDropTarget.classList.add('sftp-drop-target');
        document.body.classList.add('sftp-item-drag-active');
        handleSftpNativeDragResult({
          requestId:successfulCall?.requestId,
          ok:true,
          renamedItems:[{promisedName:'native-drag.txt',savedName:'native-drag 2.txt'}]
        });
        const successClearsState = Boolean(
          retryDragEvent.defaultPrevented
          && successfulCall?.phase === 'retry'
          && successfulCall.synchronous
          && nativeDragStageCalls === 1
          && !sftpNativeDragRequests.has(successfulCall.requestId)
          && !sftpNativeDragArmed.has(nativeDragKey)
          && !sftpNativeDragCache.has(nativeDragKey)
          && sftpInternalDrag === null
          && sftpExternalDragPreparing === null
          && !nativeDragRow.classList.contains('is-dragging')
          && !nativeDragRow.classList.contains('is-preparing-drag')
          && !nativeDragDropTarget.classList.contains('sftp-drop-target')
          && !document.body.classList.contains('sftp-item-drag-active')
          && !document.querySelector('#sftpDragHint')
        );
        const linuxFallbackNotice = nativeDragFallbackNotices[0];
        const linuxFallbackNoticeOnce = nativeDragFallbackNotices.length === 1
          && linuxFallbackNotice?.type === 'info'
          && linuxFallbackNotice.text.includes('Linux 一次拖出当前不可用')
          && linuxFallbackNotice.text.includes('系统没有安装 FUSE3（fusermount3）')
          && linuxFallbackNotice.text.includes('当前仍可使用兼容拖出')
          && linuxFallbackNotice.text.includes('再拖一次');
        const linuxFallbackUsesCompatibilityMode = firstDragOnlyStages
          && linuxFallbackHint.includes('Linux 当前使用兼容拖出')
          && linuxFallbackHint.includes('保存到本机需准备完成后再拖一次');
        const finderRenameNoticeShown = nativeDragRenameNotices.length === 1
          && nativeDragRenameNotices[0].type === 'info'
          && nativeDragRenameNotices[0].text.includes('native-drag 2.txt');

        const streamingTargetConnection = {...connection,id:Number(connection.id) + 8000,name:'native-stream-target'};
        const streamingTargetTab = {
          key:'sftp-' + streamingTargetConnection.id,
          kind:'sftp',
          id:streamingTargetConnection.id,
          title:'native-stream-target · SFTP',
          path:'/stream-target'
        };
        connections.push(streamingTargetConnection);
        tabs.push(streamingTargetTab);
        const streamingTargetNode = document.createElement('button');
        streamingTargetNode.className = 'tab';
        streamingTargetNode.dataset.kind = 'sftp';
        streamingTargetNode.dataset.tabKey = streamingTargetTab.key;
        Object.assign(streamingTargetNode.style, {
          position:'fixed',
          left:'10px',
          top:'10px',
          width:'160px',
          height:'40px',
          zIndex:'2147483647',
          pointerEvents:'auto'
        });
        document.body.appendChild(streamingTargetNode);
        const streamingStageCallsBefore = nativeDragStageCalls;
        api = async (pathname, options={}) => {
          if (pathname.endsWith('/sftp/stage-drag') && options.method === 'POST') {
            nativeDragStageCalls += 1;
            return {files:['unexpected-stage-call']};
          }
          if (pathname.endsWith('/sftp/upload-plan') && options.method === 'POST') return {items:[]};
          if (pathname.endsWith('/sftp/cross-copy') && options.method === 'POST') {
            nativeDragCrossRequests.push({pathname,body:JSON.parse(options.body || '{}')});
            return {id:'native-stream-cross-copy',type:'cross-copy',status:'completed',progress:100};
          }
          return nativeDragApi(pathname, options);
        };
        Object.defineProperty(window, 'tunnelDeskDesktop', {
          configurable:true,
          writable:true,
          value:{
            ...(nativeDragBridgeDescriptor?.value || {}),
            capabilities:{
              ...(nativeDragBridgeDescriptor?.value?.capabilities || {}),
              platform:'win32',
              sftpExternalDrag:'streaming',
              sftpNativeDragStart:'pointerdown'
            },
            startSftpDrag(payload, requestId) {
              nativeDragBridgeCalls.push({
                files:Array.isArray(payload) ? [...payload] : [],
                payload,
                requestId,
                phase:'streaming',
                synchronous:true
              });
            },
            setSftpDragTarget(requestId, target) {
              nativeDragTargetCalls.push({requestId,target});
            },
            activateSftpDrag(requestId) {
              nativeDragActivateCalls.push(requestId);
            },
            cancelSftpDrag(requestId) {
              nativeDragCancelCalls.push(requestId);
            }
          }
        });
        nativeDragRow.setAttribute('draggable', 'true');
        const streamingCallsBefore = nativeDragBridgeCalls.length;
        primeSftpNativeDrag(
          {
            button:0,
            pointerId:8080,
            clientX:20,
            clientY:20,
            target:nativeDragRow,
            currentTarget:nativeDragRow
          },
          connection.id,
          nativeDragEntries[0].path,
          nativeDragEntries[0].name,
          nativeDragEntries[0].type
        );
        const streamingCall = nativeDragBridgeCalls.findLast(call => call.phase === 'streaming');
        const streamingPreparesOnPointerDown = nativeDragBridgeCalls.length === streamingCallsBefore + 1
          && Boolean(streamingCall?.requestId)
          && streamingCall?.synchronous
          && nativeDragRow.getAttribute('draggable') === 'false';
        handleSftpNativeDragPointerMove({
          pointerId:8080,
          buttons:1,
          clientX:23,
          clientY:22
        });
        const streamingIgnoresTinyMovement = nativeDragActivateCalls.length === 0;
        handleSftpNativeDragPointerMove({
          pointerId:8080,
          buttons:1,
          clientX:28,
          clientY:20
        });
        const streamingCallsAfterThreshold = nativeDragBridgeCalls.filter(call => call.phase === 'streaming').length;
        handleSftpNativeDragPointerMove({
          pointerId:8080,
          buttons:1,
          clientX:48,
          clientY:20
        });
        const streamingDragEvent = nativeDragEvent();
        beginSftpItemDrag(
          streamingDragEvent,
          connection.id,
          nativeDragEntries[0].path,
          nativeDragEntries[0].name,
          nativeDragEntries[0].type
        );
        const streamingThresholdActivatesOnce = Boolean(
          streamingPreparesOnPointerDown
          && streamingIgnoresTinyMovement
          && streamingCall?.requestId
          && streamingDragEvent.defaultPrevented
          && nativeDragRow.getAttribute('draggable') === 'false'
          && streamingCallsAfterThreshold === 1
          && nativeDragBridgeCalls.filter(call => call.phase === 'streaming').length === streamingCallsAfterThreshold
          && nativeDragActivateCalls.length === 1
          && nativeDragActivateCalls[0] === streamingCall.requestId
        );
        const cancelCallsBeforeCapture = nativeDragCancelCalls.length;
        handleSftpNativeDragEvent({type:'ready',requestId:streamingCall?.requestId});
        handleSftpNativeDragPointerUp({pointerId:8080});
        const streamingReadyPointerUpSurvives = sftpNativeDragPointer?.nativeRequestId === streamingCall?.requestId
          && nativeDragCancelCalls.length === cancelCallsBeforeCapture
          && nativeDragActivateCalls.length === 2
          && nativeDragActivateCalls.at(-1) === streamingCall?.requestId;
        handleSftpNativeDragPointerCancel({pointerId:8080});
        const streamingCaptureCancelSurvives = sftpNativeDragPointer?.nativeRequestId === streamingCall?.requestId
          && nativeDragCancelCalls.length === cancelCallsBeforeCapture
          && streamingReadyPointerUpSurvives;
        handleSftpNativeDragEvent({type:'started',requestId:streamingCall?.requestId});
        const streamingRestoresDraggableOnNativeStart = nativeDragRow.getAttribute('draggable') === 'true';
        const parallelBrowserDragEvent = nativeDragEvent();
        beginSftpItemDrag(
          parallelBrowserDragEvent,
          connection.id,
          nativeDragEntries[0].path,
          nativeDragEntries[0].name,
          nativeDragEntries[0].type
        );
        const streamingNativeBlocksParallelBrowserDrag = Boolean(
          parallelBrowserDragEvent.defaultPrevented
          && sftpInternalDrag === null
          && streamingRestoresDraggableOnNativeStart
          && nativeDragBridgeCalls.filter(call => call.phase === 'streaming').length === streamingCallsAfterThreshold
        );
        const streamingSkipsStage = Boolean(
          streamingCall?.requestId
          && streamingCall.payload?.connectionId === Number(connection.id)
          && streamingCall.payload?.entries?.[0]?.path === nativeDragEntries[0].path
          && nativeDragStageCalls === streamingStageCallsBefore
        );
        const originalElementFromPoint = document.elementFromPoint;
        const nativeSourceShell = document.querySelector('#view-sftp .sftp-shell') || document.querySelector('.sftp-shell');
        let nativeIdleHintStable = false;
        let nativeOutsideHintStaysStable = false;
        try {
          document.elementFromPoint = () => nativeSourceShell;
          const nativeInsideMotion = {
            type:'motion',
            requestId:streamingCall?.requestId,
            clientX:Math.round(window.innerWidth / 2),
            clientY:Math.round(window.innerHeight / 2)
          };
          handleSftpNativeDragEvent(nativeInsideMotion);
          const hintAfterNativeMotion = document.querySelector('#sftpDragHint');
          const hintCopyAfterNativeMotion = hintAfterNativeMotion?.querySelector('span');
          const hintContentAfterNativeMotion = hintAfterNativeMotion?.dataset.content || '';
          const hintTextAfterNativeMotion = hintAfterNativeMotion?.textContent || '';
          const windowsDragOverEvent = {
            defaultPrevented:false,
            propagationStopped:false,
            preventDefault(){ this.defaultPrevented = true; },
            stopPropagation(){ this.propagationStopped = true; },
            dataTransfer:{types:['Files'],items:[],files:[],dropEffect:'copy'}
          };
          handleSftpDragOver(windowsDragOverEvent);
          const hintAfterChromiumDragOver = document.querySelector('#sftpDragHint');
          const hintCopyAfterChromiumDragOver = hintAfterChromiumDragOver?.querySelector('span');
          const hintContentAfterChromiumDragOver = hintAfterChromiumDragOver?.dataset.content || '';
          const hintTextAfterChromiumDragOver = hintAfterChromiumDragOver?.textContent || '';
          handleSftpNativeDragEvent(nativeInsideMotion);
          const hintAfterSecondNativeMotion = document.querySelector('#sftpDragHint');
          nativeIdleHintStable = Boolean(
            windowsDragOverEvent.defaultPrevented
            && windowsDragOverEvent.propagationStopped
            && windowsDragOverEvent.dataTransfer.dropEffect === 'none'
            && hintAfterNativeMotion
            && hintAfterChromiumDragOver === hintAfterNativeMotion
            && hintAfterSecondNativeMotion === hintAfterNativeMotion
            && hintCopyAfterNativeMotion
            && hintCopyAfterChromiumDragOver === hintCopyAfterNativeMotion
            && hintAfterSecondNativeMotion?.querySelector('span') === hintCopyAfterNativeMotion
            && hintContentAfterChromiumDragOver === hintContentAfterNativeMotion
            && hintAfterSecondNativeMotion?.dataset.content === hintContentAfterNativeMotion
            && hintTextAfterChromiumDragOver === hintTextAfterNativeMotion
            && hintAfterSecondNativeMotion?.textContent === hintTextAfterNativeMotion
            && hintTextAfterNativeMotion.includes('拖到其他 SFTP 标签可跨主机复制')
            && hintTextAfterNativeMotion.includes('拖出窗口可直接保存到本机')
            && !hintTextAfterNativeMotion.includes('松开后保存到本机目录')
          );
          document.elementFromPoint = () => null;
          handleSftpNativeDragEvent({
            type:'motion',
            requestId:streamingCall?.requestId,
            clientX:window.innerWidth + 100,
            clientY:window.innerHeight + 100
          });
          const outsideHint = document.querySelector('#sftpDragHint');
          nativeOutsideHintStaysStable = Boolean(
            outsideHint === hintAfterNativeMotion
            && outsideHint?.querySelector('span') === hintCopyAfterNativeMotion
            && outsideHint?.dataset.content === hintContentAfterNativeMotion
            && outsideHint?.textContent === hintTextAfterNativeMotion
            && outsideHint?.textContent.includes('拖出窗口可直接保存到本机')
            && !outsideHint?.textContent.includes('松开后保存到本机目录')
          );
        } finally {
          document.elementFromPoint = originalElementFromPoint;
        }
        const streamingTargetRect = streamingTargetNode.getBoundingClientRect();
        handleSftpNativeDragEvent({
          type:'motion',
          requestId:streamingCall?.requestId,
          clientX:streamingTargetRect.left + streamingTargetRect.width / 2,
          clientY:streamingTargetRect.top + streamingTargetRect.height / 2
        });
        const streamingTargetCall = nativeDragTargetCalls.findLast(call => call.requestId === streamingCall?.requestId);
        const nativeMotionTargetsSftp = Boolean(
          streamingTargetCall?.target?.id === streamingTargetConnection.id
          && streamingTargetCall.target.tabKey === streamingTargetTab.key
          && streamingTargetCall.target.path === streamingTargetTab.path
        );
        const nativeTargetCallsBeforeTransientMiss = nativeDragTargetCalls.length;
        const nativeHintBeforeTransientMiss = document.querySelector('#sftpDragHint');
        try {
          document.elementFromPoint = () => null;
          handleSftpNativeDragEvent({
            type:'motion',
            requestId:streamingCall?.requestId,
            clientX:Math.round(window.innerWidth / 2),
            clientY:Math.round(window.innerHeight / 2)
          });
        } finally {
          document.elementFromPoint = originalElementFromPoint;
        }
        const nativeTransientMissKeepsTarget = Boolean(
          nativeDragTargetCalls.length === nativeTargetCallsBeforeTransientMiss
          && nativeHintBeforeTransientMiss
          && document.querySelector('#sftpDragHint') === nativeHintBeforeTransientMiss
          && document.querySelector('#sftpDragHint')?.textContent.includes('native-stream-target')
          && !document.querySelector('#sftpDragHint')?.textContent.includes('本机目录')
        );
        const streamingRequest = sftpNativeDragRequests.get(streamingCall?.requestId);
        const activeTabBeforeFinalMiss = activeTabKey;
        const nativeTargetCallsBeforeFinalMiss = nativeDragTargetCalls.length;
        try {
          activeTabKey = streamingTargetTab.key;
          document.elementFromPoint = () => null;
          syncSftpNativeDragTargetAt(
            streamingCall?.requestId,
            streamingRequest,
            Math.round(window.innerWidth / 2),
            Math.round(window.innerHeight / 2),
            {final:true}
          );
        } finally {
          activeTabKey = activeTabBeforeFinalMiss;
          document.elementFromPoint = originalElementFromPoint;
        }
        const nativeFinalTransientMissKeepsTarget = Boolean(
          nativeDragTargetCalls.length === nativeTargetCallsBeforeFinalMiss + 1
          && nativeDragTargetCalls.at(-1)?.target?.id === streamingTargetConnection.id
          && nativeDragTargetCalls.at(-1)?.target?.tabKey === streamingTargetTab.key
        );
        handleSftpNativeDragEvent({
          type:'released',
          requestId:streamingCall?.requestId,
          clientX:window.innerWidth + 100,
          clientY:window.innerHeight + 100
        });
        const releasedTargetCall = nativeDragTargetCalls.findLast(call => call.requestId === streamingCall?.requestId);
        const nativeReleasedClearsStaleTarget = releasedTargetCall?.target === null;
        clearSftpTabDragPreview();
        await handleSftpNativeDragResult({
          requestId:streamingCall?.requestId,
          ok:true,
          internalTarget:{
            id:streamingTargetConnection.id,
            tabKey:streamingTargetTab.key,
            path:streamingTargetTab.path
          }
        });
        const nativeResultCopiesOnce = nativeDragCrossRequests.length === 1
          && nativeDragCrossRequests[0].body.target_connection_id === streamingTargetConnection.id
          && nativeDragCrossRequests[0].body.paths?.[0] === nativeDragEntries[0].path;
        const pendingCancelCallsBefore = nativeDragCancelCalls.length;
        primeSftpNativeDrag(
          {
            button:0,
            pointerId:8081,
            clientX:20,
            clientY:20,
            target:nativeDragRow,
            currentTarget:nativeDragRow
          },
          connection.id,
          nativeDragEntries[0].path,
          nativeDragEntries[0].name,
          nativeDragEntries[0].type
        );
        const pendingPointerRequest = sftpNativeDragPointer?.nativeRequestId;
        handleSftpNativeDragPointerUp({pointerId:8081});
        const pointerUpCancelsPending = Boolean(
          pendingPointerRequest
          && nativeDragCancelCalls.length === pendingCancelCallsBefore + 1
          && nativeDragCancelCalls.at(-1) === pendingPointerRequest
          && sftpNativeDragPointer === null
        );
        await handleSftpNativeDragResult({requestId:pendingPointerRequest,ok:false,message:'已取消拖出'});
        resetSftpItemDrag(nativeDragRow);
        streamingTargetNode.remove();
        tabs.splice(tabs.findIndex(item => item.key === streamingTargetTab.key), 1);
        connections.splice(connections.findIndex(item => Number(item.id) === Number(streamingTargetConnection.id)), 1);
        api = nativeDragApi;
        nativeDragUi = {
          found:true,
          webExternalDragBlocked,
          linuxFallbackNoticeOnce,
          linuxFallbackUsesCompatibilityMode,
          streamingPreparesOnPointerDown,
          streamingThresholdActivatesOnce,
          streamingCaptureCancelSurvives,
          pointerUpCancelsPending,
          streamingSkipsStage,
          streamingNativeBlocksParallelBrowserDrag,
          nativeIdleHintStable,
          nativeOutsideHintStaysStable,
          nativeMotionTargetsSftp,
          nativeTransientMissKeepsTarget,
          nativeFinalTransientMissKeepsTarget,
          nativeReleasedClearsStaleTarget,
          nativeResultCopiesOnce,
          firstDragOnlyStages,
          firstDragReset,
          cacheReused:nativeDragStageCalls === 1
            && nativeDragBridgeCalls.filter(call => call.phase !== 'streaming').length === 2,
          cachedUnarmedStaysInternal,
          sameWindowDropDoesNotArm,
          armedDragStartsSynchronously,
          failureRearmed,
          successClearsState,
          finderRenameNoticeShown,
          stageCalls:nativeDragStageCalls,
          bridgeCalls:nativeDragBridgeCalls.length
        };
      } finally {
        notify = nativeDragNotify;
        sftpNativeDragFallbackNoticeShown = nativeDragFallbackNoticeWasShown;
        resetSftpItemDrag(nativeDragRow);
        sftpNativeDragCache.delete(nativeDragKey);
        sftpNativeDragArmed.delete(nativeDragKey);
        for (const [requestId, request] of sftpNativeDragRequests) {
          if (request.key === nativeDragKey) sftpNativeDragRequests.delete(requestId);
        }
        nativeDragRow.remove();
        nativeDragDropTarget.remove();
        api = nativeDragApi;
        if (nativeDragBridgeDescriptor) Object.defineProperty(window, 'tunnelDeskDesktop', nativeDragBridgeDescriptor);
        else delete window.tunnelDeskDesktop;
      }
      const sourceSftpTabKey = activeTabKey;
      const sourceSftpPath = sftpState.path;
      const dragTargetConnection = {...connection,id:Number(connection.id) + 9000,name:'测试目标'};
      connections.push(dragTargetConnection);
      const dragTargetTab = {key:'sftp-' + dragTargetConnection.id,kind:'sftp',id:dragTargetConnection.id,title:'测试目标 · SFTP',path:'/target'};
      tabs.push(dragTargetTab);
      renderTabs();
      const dragTargetButton = [...document.querySelectorAll('#tabs .tab')].find(tab => tab.dataset.tabKey === dragTargetTab.key);
      const webCrossHostBridgeDescriptor = Object.getOwnPropertyDescriptor(window, 'tunnelDeskDesktop');
      Object.defineProperty(window, 'tunnelDeskDesktop', {
        configurable:true,
        writable:true,
        value:undefined
      });
      const webCrossHostMode = sftpExternalDragMode() === false;
      sftpInternalDrag = {connectionId:Number(connection.id),entries:[{path:'/source.txt',name:'source.txt',type:'file'}],row:null};
      const serializedCrossDrag = serializeSftpDragPayload(sftpInternalDrag.connectionId, sftpInternalDrag.entries, sourceSftpTabKey);
      const crossDragDataTransfer = {
        types:['application/x-tunneldesk-sftp'],
        dropEffect:'',
        getData(type) {
          return type === 'application/x-tunneldesk-sftp' ? serializedCrossDrag : '';
        }
      };
      const dragFeedbackEvent = {preventDefault(){},dataTransfer:crossDragDataTransfer,currentTarget:dragTargetButton};
      handleSftpTabDragOver(dragFeedbackEvent, dragTargetTab.key);
      await new Promise(resolve => setTimeout(resolve, 210));
      const dragFeedbackVisible = dragTargetButton.classList.contains('sftp-drop-target')
        && dragFeedbackEvent.dataTransfer.dropEffect === 'copy'
        && document.querySelector('#sftpDragHint')?.textContent.includes('测试目标');
      const dragTargetViewActivated = activeTabKey === dragTargetTab.key
        && view.dataset.sftpTabKey === dragTargetTab.key;
      const dragTargetActiveKey = activeTabKey;
      const dragTargetViewKey = view.dataset.sftpTabKey;
      const targetListDropEvent = {
        defaultPrevented:false,
        propagationStopped:false,
        preventDefault(){ this.defaultPrevented = true; },
        stopPropagation(){ this.propagationStopped = true; },
        dataTransfer:crossDragDataTransfer
      };
      handleSftpDragOver(targetListDropEvent);
      const targetDropOverlay = document.querySelector('#sftpDropOverlay');
      const targetDropRect = targetDropOverlay?.getBoundingClientRect();
      const targetDropHint = document.querySelector('#sftpDragHint');
      const targetStickyBottom = document.querySelector('.sftp-top')?.getBoundingClientRect()?.bottom || 0;
      const targetListDropPrompt = Boolean(
        targetListDropEvent.defaultPrevented
        && targetListDropEvent.dataTransfer.dropEffect === 'copy'
        && targetDropOverlay
        && !targetDropOverlay.hidden
        && !targetDropOverlay.textContent.trim()
        && targetDropOverlay.dataset.mode === 'copy'
        && targetDropHint?.textContent.includes('松开复制到 测试目标')
        && document.querySelectorAll('#sftpDragHint').length === 1
        && targetDropRect.width > 0
        && targetDropRect.height > 0
        && targetDropRect.top >= targetStickyBottom
        && targetDropRect.bottom <= window.innerHeight
      );
      const targetHintBeforeTransientLeave = document.querySelector('#sftpDragHint');
      handleSftpDragLeave({currentTarget:document.querySelector('.sftp-shell'),relatedTarget:null,dataTransfer:targetListDropEvent.dataTransfer});
      handleSftpDragOver(targetListDropEvent);
      await new Promise(resolve => setTimeout(resolve, 120));
      const targetListDropPromptStable = Boolean(
        targetHintBeforeTransientLeave
        && document.querySelector('#sftpDragHint') === targetHintBeforeTransientLeave
        && !targetDropOverlay.hidden
        && targetDropOverlay.dataset.mode === 'copy'
        && targetHintBeforeTransientLeave.textContent.includes('松开复制到 测试目标')
      );
      crossDragDataTransfer.dropEffect = 'copy';
      sftpDropDepth = 1;
      finishSftpItemDrag({currentTarget:null,dataTransfer:crossDragDataTransfer});
      const crossHostPreviewHandoffSurvives = Boolean(
        sftpInternalDrag === null
        && currentSftpInternalDragHandoff()
        && activeSftpDragPayload(crossDragDataTransfer)?.entries?.[0]?.path === '/source.txt'
      );
      const dragDropApi = api;
      const crossDropRequests = [];
      const crossDropNotices = [];
      const dragDropNotify = notify;
      api = async (pathname, options={}) => {
        if (pathname.endsWith('/sftp/upload-plan') && options.method === 'POST') return {items:[]};
        if (pathname.endsWith('/sftp/cross-copy') && options.method === 'POST') {
          crossDropRequests.push({pathname,body:JSON.parse(options.body || '{}')});
          return {id:'ui-cross-drop',type:'cross-copy',status:'completed',progress:100};
        }
        return dragDropApi(pathname, options);
      };
      notify = (text, type='info') => crossDropNotices.push({text:String(text || ''),type});
      sftpInternalDrag = null;
      clearSftpInternalDragHandoff();
      const restoredCrossHostPayload = activeSftpDragPayload(targetListDropEvent.dataTransfer);
      try {
        await handleSftpDrop(targetListDropEvent);
      } finally {
        notify = dragDropNotify;
      }
      const crossHostListDropCopies = crossDropRequests.length === 1
        && crossDropRequests[0].body.target_connection_id === dragTargetConnection.id
        && crossDropRequests[0].body.paths?.[0] === '/source.txt'
        && restoredCrossHostPayload?.entries?.[0]?.name === 'source.txt'
        && sftpInternalDrag === null
        && !document.body.classList.contains('sftp-item-drag-active')
        && webCrossHostMode;
      const crossHostDropHasNoUploadToast = !crossDropNotices.some(item => item.text.includes('已上传到'));
      sftpInternalDrag = {connectionId:Number(dragTargetConnection.id),entries:[{path:'/target/local.txt',name:'local.txt',type:'file'}],row:null};
      const sameHostDropEvent = {
        defaultPrevented:false,
        propagationStopped:false,
        preventDefault(){ this.defaultPrevented = true; },
        stopPropagation(){ this.propagationStopped = true; },
        dataTransfer:{types:['application/x-tunneldesk-sftp'],dropEffect:'copy'}
      };
      await handleSftpDrop(sameHostDropEvent);
      const sameHostListDropCancels = sameHostDropEvent.defaultPrevented
        && sameHostDropEvent.dataTransfer.dropEffect === 'copy'
        && crossDropRequests.length === 1
        && sftpInternalDrag === null
        && !document.querySelector('#sftpDragHint');
      if (webCrossHostBridgeDescriptor) Object.defineProperty(window, 'tunnelDeskDesktop', webCrossHostBridgeDescriptor);
      else delete window.tunnelDeskDesktop;
      api = dragDropApi;
      resetSftpItemDrag();
      tabs.splice(tabs.findIndex(item => item.key === dragTargetTab.key), 1);
      connections.splice(connections.findIndex(item => Number(item.id) === Number(dragTargetConnection.id)), 1);
      activeTabKey = sourceSftpTabKey;
      await openSftp(connection.id, sourceSftpPath, false);
      stickyTop = view.querySelector('.sftp-top');
      toolbar = document.querySelector('#workspaceHeaderTools .sftp-toolbar') || view.querySelector('.sftp-toolbar');
      navigationRow = view.querySelector('.sftp-navigation-row');
      breadcrumb = view.querySelector('.sftp-breadcrumb');
      pathEditor = view.querySelector('#sftpPathEditor');
      floatingSearch = view.querySelector('#sftpFloatingSearch');
      dropOverlay = view.querySelector('#sftpDropOverlay');
      clipboardActions = toolbar?.querySelector('#sftpClipboardActions') || view.querySelector('#sftpClipboardActions') || document.querySelector('#sftpClipboardActions') || document.createElement('span');
      cancelSftpDropLeaveClear();
      sftpDropDepth = 0;
      setSftpExternalDropState(false);
      const externalFileDropDetected = sftpDataTransferHasFiles({types:{0:'Files',length:1},items:[],files:[]});
      const externalCollectedFile = new File(['drag-in'], 'drag-in.txt', {type:'text/plain'});
      const externalCollectedFiles = await collectDroppedFiles({items:[],files:[externalCollectedFile]});
      const externalFileDropCollected = externalCollectedFiles.length === 1
        && externalCollectedFiles[0].file === externalCollectedFile
        && externalCollectedFiles[0].relativePath === 'drag-in.txt';
      const externalDropDataTransfer = {types:['Files'],items:[],files:[],dropEffect:''};
      const externalDropEvent = {
        defaultPrevented:false,
        preventDefault(){ this.defaultPrevented = true; },
        dataTransfer:externalDropDataTransfer
      };
      handleSftpDragEnter(externalDropEvent);
      handleSftpDragEnter(externalDropEvent);
      const externalDropOverlay = document.querySelector('#sftpDropOverlay');
      const externalDropOverlayRect = externalDropOverlay?.getBoundingClientRect();
      const workspaceHeaderRect = document.querySelector('.workspace-header')?.getBoundingClientRect();
      const workspaceTabsRect = document.querySelector('#tabs')?.getBoundingClientRect();
      const externalDropHint = document.querySelector('#sftpDragHint');
      const externalDropHintRect = externalDropHint?.getBoundingClientRect();
      const externalDropListRect = document.querySelector('#sftpList')?.getBoundingClientRect();
      const externalDropVisibleLeft = Math.max(0, Number(externalDropListRect?.left || 0));
      const externalDropVisibleRight = Math.min(window.innerWidth, Number(externalDropListRect?.right || window.innerWidth));
      const externalDropVisibleWidth = Math.max(0, externalDropVisibleRight - externalDropVisibleLeft);
      const externalDropHintCenterError = externalDropHintRect
        ? Math.abs(
          (externalDropHintRect.left + externalDropHintRect.right) / 2
          - (externalDropVisibleLeft + externalDropVisibleRight) / 2
        )
        : Number.POSITIVE_INFINITY;
      const externalDropPromptMetrics = {
        prevented:externalDropEvent.defaultPrevented,
        overlays:document.querySelectorAll('#sftpDropOverlay').length,
        hints:document.querySelectorAll('#sftpDragHint').length,
        hidden:Boolean(externalDropOverlay?.hidden),
        mode:externalDropOverlay?.dataset.mode || '',
        overlayText:externalDropOverlay?.textContent.trim() || '',
        overlayChildren:externalDropOverlay?.children.length || 0,
        hint:externalDropHint?.textContent || '',
        hintCenterError:externalDropHintCenterError,
        hintWidth:Number(externalDropHintRect?.width || 0),
        visibleListWidth:externalDropVisibleWidth
      };
      const externalDropPromptIsSingle = Boolean(
        externalDropPromptMetrics.prevented
        && externalDropPromptMetrics.overlays === 1
        && externalDropPromptMetrics.hints === 1
        && externalDropOverlay
        && !externalDropPromptMetrics.hidden
        && externalDropPromptMetrics.mode === 'upload'
        && !externalDropPromptMetrics.overlayText
        && externalDropPromptMetrics.overlayChildren === 0
        && externalDropPromptMetrics.hint.includes('松开上传到 ')
      );
      const externalDropPromptAvoidsWorkspaceChrome = Boolean(
        externalDropOverlayRect
        && externalDropOverlayRect.width > 0
        && externalDropOverlayRect.height > 0
        && externalDropOverlayRect.top >= Math.max(
          Number(workspaceHeaderRect?.bottom || 0),
          Number(workspaceTabsRect?.bottom || 0)
        )
      );
      const externalDropPromptListCentered = Boolean(
        externalDropHintRect
        && externalDropVisibleWidth > 32
        && externalDropHintCenterError <= 1.5
        && externalDropHintRect.width <= externalDropVisibleWidth - 31
      );
      const externalDropSurfaceRect = document.querySelector('.sftp-shell')?.getBoundingClientRect();
      const externalDropWorkspaceRect = document.querySelector('.content.sftp-content .workspace')?.getBoundingClientRect();
      const externalDropSurfaceFillsWorkspace = Boolean(
        externalDropSurfaceRect
        && externalDropWorkspaceRect
        && externalDropSurfaceRect.height >= externalDropWorkspaceRect.height - 25
        && externalDropSurfaceRect.bottom >= externalDropWorkspaceRect.bottom - 13
      );
      const externalDropList = document.querySelector('#sftpList');
      const originalExternalDropListRect = externalDropList?.getBoundingClientRect;
      let externalDropPromptScrollClamped = false;
      let externalDropPromptHorizontalClamped = false;
      if (externalDropList && originalExternalDropListRect) {
        const currentRect = originalExternalDropListRect.call(externalDropList);
        const stickyBottom = Number(document.querySelector('.sftp-top')?.getBoundingClientRect()?.bottom || 0);
        try {
          externalDropList.getBoundingClientRect = () => ({
            left:currentRect.left,
            right:currentRect.right,
            top:-240,
            bottom:window.innerHeight - 24
          });
          setSftpExternalDropState(true, {path:'/scroll-top'});
          const clippedAtTop = externalDropOverlay.getBoundingClientRect();
          const topClamped = clippedAtTop.top >= stickyBottom
            && clippedAtTop.bottom <= window.innerHeight
            && document.querySelectorAll('#sftpDragHint').length === 1;

          const bottomTop = Math.max(stickyBottom + 8, window.innerHeight - 150);
          externalDropList.getBoundingClientRect = () => ({
            left:currentRect.left,
            right:currentRect.right,
            top:bottomTop,
            bottom:window.innerHeight + 260
          });
          setSftpExternalDropState(true, {path:'/scroll-bottom'});
          const clippedAtBottom = externalDropOverlay.getBoundingClientRect();
          const bottomClamped = clippedAtBottom.top >= bottomTop
            && clippedAtBottom.bottom <= window.innerHeight
            && document.querySelectorAll('#sftpDragHint').length === 1;
          externalDropPromptScrollClamped = topClamped && bottomClamped;

          const horizontalLeft = Math.max(36, Math.round(window.innerWidth * .3));
          const horizontalRight = window.innerWidth + 180;
          externalDropList.getBoundingClientRect = () => ({
            left:horizontalLeft,
            right:horizontalRight,
            top:currentRect.top,
            bottom:currentRect.bottom
          });
          setSftpExternalDropState(true, {path:'/resized-sidebar'});
          const resizedHint = document.querySelector('#sftpDragHint')?.getBoundingClientRect();
          const expectedVisibleRight = window.innerWidth;
          const expectedCenter = (horizontalLeft + expectedVisibleRight) / 2;
          const expectedWidth = expectedVisibleRight - horizontalLeft;
          externalDropPromptHorizontalClamped = Boolean(
            resizedHint
            && Math.abs((resizedHint.left + resizedHint.right) / 2 - expectedCenter) <= 1.5
            && resizedHint.width <= expectedWidth - 31
          );
        } finally {
          externalDropList.getBoundingClientRect = originalExternalDropListRect;
          setSftpExternalDropState(true);
        }
      }
      handleSftpDragLeave(externalDropEvent);
      handleSftpDragLeave(externalDropEvent);
      await new Promise(resolve => setTimeout(resolve, 220));
      const externalDropPromptClears = Boolean(
        externalDropOverlay?.hidden
        && !document.querySelector('#sftpDragHint')
        && sftpDropDepth === 0
      );
      const cancelledArmedRequestId = 'ui-cancelled-armed-drag';
      sftpNativeDragRequests.set(cancelledArmedRequestId, {key:'ui-cancelled-armed-drag',row:null,activated:false,nativeStarted:false});
      sftpNativeDragPointer = {
        pointerId:9191,
        timer:null,
        row:null,
        originalDraggable:null,
        nativeRequestId:cancelledArmedRequestId,
        nativeStarted:false
      };
      clearSftpNativeDragPointer();
      const armedPointerCancelClearsRequest = !sftpNativeDragRequests.has(cancelledArmedRequestId)
        && sftpNativeDragPointer === null;
      const armedDragRequestId = 'ui-armed-drag-allows-upload';
      sftpNativeDragRequests.set(armedDragRequestId, {key:'ui-armed-drag',row:null,activated:false,nativeStarted:false});
      const armedDragEvent = {
        defaultPrevented:false,
        propagationStopped:false,
        preventDefault(){ this.defaultPrevented = true; },
        stopPropagation(){ this.propagationStopped = true; },
        dataTransfer:{types:{0:'Files',length:1},items:[],files:[],dropEffect:'copy'}
      };
      handleSftpDragEnter(armedDragEvent);
      const armedDragAllowsExternalUpload = armedDragEvent.defaultPrevented
        && !armedDragEvent.propagationStopped
        && !document.querySelector('#sftpDropOverlay')?.hidden
        && sftpDropDepth === 1;
      handleSftpDragLeave(armedDragEvent);
      await new Promise(resolve => setTimeout(resolve, 220));
      sftpNativeDragRequests.delete(armedDragRequestId);
      sftpInternalDrag = {
        connectionId:Number(sftpState.connectionId),
        entries:[{path:'/stale.txt',name:'stale.txt',type:'file'}],
        row:null
      };
      const staleInternalDragEvent = {
        defaultPrevented:false,
        propagationStopped:false,
        preventDefault(){ this.defaultPrevented = true; },
        stopPropagation(){ this.propagationStopped = true; },
        dataTransfer:{types:['Files'],items:[{kind:'file',type:'text/plain'}],files:[],dropEffect:'copy'}
      };
      handleSftpDragEnter(staleInternalDragEvent);
      const staleInternalDragAllowsExternalUpload = staleInternalDragEvent.defaultPrevented
        && !staleInternalDragEvent.propagationStopped
        && sftpInternalDrag === null
        && !document.querySelector('#sftpDropOverlay')?.hidden;
      handleSftpDragLeave(staleInternalDragEvent);
      await new Promise(resolve => setTimeout(resolve, 220));
      const uriListBridgeDescriptor = Object.getOwnPropertyDescriptor(window, 'tunnelDeskDesktop');
      if (!uriListBridgeDescriptor || uriListBridgeDescriptor.configurable) {
        Object.defineProperty(window, 'tunnelDeskDesktop', {
          configurable:true,
          writable:true,
          value:{
            ...(uriListBridgeDescriptor?.value || {}),
            capabilities:{...(uriListBridgeDescriptor?.value?.capabilities || {}),platform:'linux'}
          }
        });
      }
      const uriListDragEvent = {
        defaultPrevented:false,
        propagationStopped:false,
        preventDefault(){ this.defaultPrevented = true; },
        stopPropagation(){ this.propagationStopped = true; },
        dataTransfer:{types:{0:'text/uri-list',length:1},items:[],files:[],dropEffect:'copy'}
      };
      handleSftpDragEnter(uriListDragEvent);
      const desktopUriListDragAccepted = uriListDragEvent.defaultPrevented
        && !uriListDragEvent.propagationStopped
        && !document.querySelector('#sftpDropOverlay')?.hidden
        && sftpDropDepth === 1;
      handleSftpDragLeave(uriListDragEvent);
      await new Promise(resolve => setTimeout(resolve, 220));
      if (!uriListBridgeDescriptor || uriListBridgeDescriptor.configurable) {
        if (uriListBridgeDescriptor) Object.defineProperty(window, 'tunnelDeskDesktop', uriListBridgeDescriptor);
        else delete window.tunnelDeskDesktop;
      }
      const ownDragRequestId = 'ui-own-drag-suppression';
      sftpNativeDragRequests.set(ownDragRequestId, {key:'ui-own-drag',row:null,activated:true});
      const ownDragEvent = {
        defaultPrevented:false,
        propagationStopped:false,
        preventDefault(){ this.defaultPrevented = true; },
        stopPropagation(){ this.propagationStopped = true; },
        dataTransfer:{types:{0:'Files',length:1},items:[],files:[],dropEffect:'copy'}
      };
      handleSftpDragEnter(ownDragEvent);
      const ownDragUploadSuppressed = ownDragEvent.defaultPrevented
        && ownDragEvent.propagationStopped
        && ownDragEvent.dataTransfer.dropEffect === 'none'
        && Boolean(document.querySelector('#sftpDropOverlay')?.hidden);
      sftpNativeDragRequests.get(ownDragRequestId).released = true;
      const releasedDragEvent = {
        defaultPrevented:false,
        propagationStopped:false,
        preventDefault(){ this.defaultPrevented = true; },
        stopPropagation(){ this.propagationStopped = true; },
        dataTransfer:{types:{0:'Files',length:1},items:[],files:[],dropEffect:'copy'}
      };
      handleSftpDragEnter(releasedDragEvent);
      const releasedDragAllowsExternalUpload = releasedDragEvent.defaultPrevented
        && !releasedDragEvent.propagationStopped
        && !document.querySelector('#sftpDropOverlay')?.hidden
        && sftpDropDepth === 1;
      handleSftpDragLeave(releasedDragEvent);
      await new Promise(resolve => setTimeout(resolve, 220));
      sftpNativeDragRequests.delete(ownDragRequestId);
      connectionSessionUi = {
        found:Boolean(disconnectedButton && disconnectedBanner),
        addressIncludesPort:document.querySelector('#workspaceSubtitle')?.textContent === connection.ssh_user+'@'+connection.ssh_host+':'+connection.ssh_port,
        disconnectedAction,
        disconnectedBanner:bannerVisible,
        connectedAction:Boolean(disconnectedButton?.querySelector('.lucide-link-2-off') && disconnectedButton.title.includes('断开')),
        preservedWhileDisconnected,
        automaticConnectShared,
        automaticConnectCalls,
        automaticConnectStatus,
        manualDisconnectAutoReconnect,
        disconnectedTabSwitchDoesNotReconnect,
        disconnectedFolderOperationReconnects,
        reconnectSequence,
        dragFeedbackVisible,
        dragTargetViewActivated,
        dragTargetActiveKey,
        dragTargetViewKey,
        targetListDropPrompt,
        targetListDropPromptStable,
        crossHostListDropCopies,
        crossHostPreviewHandoffSurvives,
        crossHostDropHasNoUploadToast,
        sameHostListDropCancels,
        ownDragUploadSuppressed,
        armedPointerCancelClearsRequest,
        armedDragAllowsExternalUpload,
        staleInternalDragAllowsExternalUpload,
        desktopUriListDragAccepted,
        releasedDragAllowsExternalUpload,
        externalFileDropDetected,
        externalFileDropCollected,
        externalDropPromptMetrics,
        externalDropPromptIsSingle,
        externalDropPromptAvoidsWorkspaceChrome,
        externalDropPromptListCentered,
        externalDropSurfaceFillsWorkspace,
        externalDropPromptScrollClamped,
        externalDropPromptHorizontalClamped,
        externalDropPromptClears
      };

      copySingleSftp('/Users/junruo/Public/copy.txt', 'copy');
      const copyPaste = [...clipboardActions.querySelectorAll('button')].find(button => button.textContent.includes('粘贴'));
      const copyCancel = clipboardActions.querySelector('[aria-label="取消复制或移动队列"]');
      const copyQueueVisible = clipboardActions.textContent.includes('复制队列 1 项') && Boolean(copyPaste && !copyPaste.disabled && copyCancel);
      copyCancel?.click();
      const copyCancelled = sftpClipboard === null && !clipboardActions.querySelector('button');

      copySingleSftp('/Users/junruo/Public/move.txt', 'move');
      const movePaste = [...clipboardActions.querySelectorAll('button')].find(button => button.textContent.includes('粘贴'));
      const moveCancel = clipboardActions.querySelector('[aria-label="取消复制或移动队列"]');
      const moveQueueVisible = clipboardActions.textContent.includes('移动队列 1 项') && Boolean(movePaste && !movePaste.disabled && moveCancel);
      moveCancel?.click();
      const moveCancelled = sftpClipboard === null && !clipboardActions.querySelector('button');
      sftpClipboard = {mode:'copy', paths:['/source/cross.txt'], connectionId:999999, connectionName:'另一台主机'};
      refreshSftpDirectoryActions();
      const crossCopyButton = [...clipboardActions.querySelectorAll('button')].find(button => button.textContent.includes('跨主机复制'));
      const crossHostCopyEnabled = Boolean(crossCopyButton && !crossCopyButton.disabled);
      sftpClipboard = {mode:'move', paths:['/source/cross.txt'], connectionId:999999, connectionName:'另一台主机'};
      refreshSftpDirectoryActions();
      const crossHostMoveDisabled = Boolean([...clipboardActions.querySelectorAll('button')].find(button => button.disabled));
      const crossPasteApi = api;
      const crossPasteChoice = chooseModal;
      const crossPasteActiveTabKey = activeTabKey;
      const crossPasteState = sftpState;
      const crossPasteTargetTab = {key:'sftp-cross-paste-target',kind:'sftp',id:Number(connection.id),title:'测试目标 · SFTP',path:'/target'};
      tabs.push(crossPasteTargetTab);
      let crossHostConflictPrompted = false;
      let crossHostConflictBody = null;
      try {
        activeTabKey = crossPasteTargetTab.key;
        sftpState = {...sftpState, connectionId:connection.id, path:'/target'};
        sftpClipboard = {mode:'copy', paths:['/source/cross.txt'], connectionId:999999, connectionName:'另一台主机'};
        api = async (pathname, options={}) => {
          if (pathname.endsWith('/sftp/upload-plan')) return {items:[{name:'cross.txt',exists:true}]};
          if (pathname.endsWith('/sftp/cross-copy')) {
            crossHostConflictBody = JSON.parse(options.body || '{}');
            return {id:'cross-copy-job',status:'pending'};
          }
          return {};
        };
        chooseModal = async (title, message, actions) => {
          crossHostConflictPrompted = title.includes('同名') && message.includes('cross.txt') && actions.some(action=>action.value==='rename');
          return 'rename';
        };
        await pasteSftpClipboard();
      } finally {
        api = crossPasteApi;
        chooseModal = crossPasteChoice;
        activeTabKey = crossPasteActiveTabKey;
        sftpState = crossPasteState;
        tabs.splice(tabs.indexOf(crossPasteTargetTab), 1);
      }
      const crossHostClipboardConflict = crossHostConflictPrompted
        && crossHostConflictBody?.conflict === 'rename'
        && crossHostConflictBody?.target_connection_id === Number(connection.id)
        && crossHostConflictBody?.target === '/target'
        && sftpClipboard === null;
      sftpClipboard = null;
      refreshSftpDirectoryActions();
      const filenameEncodingButton = toolbar?.querySelector('#sftpFilenameEncodingButton') || document.querySelector('#sftpFilenameEncodingButton');
      filenameEncodingButton?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:160,clientY:100}));
      const filenameEncodingLabels = [...document.querySelectorAll('#actionMenu button span')].map(item=>item.textContent.trim());
      const filenameEncodingMenu = ['UTF-8','GB18030','GBK','Big5','Shift_JIS','EUC-KR','ISO-8859-1'].every(label=>filenameEncodingLabels.includes(label));
      hideActionMenu();
      const favorites = view.querySelector('#sftpFavorites');
      const shell = view.querySelector('.sftp-shell');
      const previousFavoritesHtml = favorites.innerHTML;
      const previousFavoritesClass = favorites.className;
      const previousShellStyle = shell.style.cssText;
      const previousStickyTopStyle = stickyTop.style.cssText;
      const emptyFavoritesRect = favorites.getBoundingClientRect();
      const emptyNavigationRect = navigationRow.getBoundingClientRect();
      const jobsRect = view.querySelector('#sftpJobs').getBoundingClientRect();
      const emptyFavoritesMinHeight = parseFloat(getComputedStyle(favorites).minHeight);
      const emptyFavoritesCompact = emptyFavoritesRect.height < 50
        && (!Number.isFinite(emptyFavoritesMinHeight) || emptyFavoritesMinHeight < 60)
        && emptyNavigationRect.height < 60
        && jobsRect.top - emptyNavigationRect.bottom < 32;
      favorites.classList.remove('is-empty');
      favorites.innerHTML = '<span class="sftp-favorites-label">常用目录</span><button type="button">根目录</button>';
      const naturalNavigationHeight = navigationRow.getBoundingClientRect().height;
      const naturalTopHeight = stickyTop.getBoundingClientRect().height;
      shell.style.height = '900px';
      const tallShellNavigationHeight = navigationRow.getBoundingClientRect().height;
      const tallShellTopHeight = stickyTop.getBoundingClientRect().height;
      const wideNavigationCompact = naturalNavigationHeight < 60
        && tallShellNavigationHeight < 60
        && naturalTopHeight < 180
        && tallShellTopHeight < 180
        && Math.abs(tallShellTopHeight - naturalTopHeight) < 1
        && getComputedStyle(shell).alignContent === 'start'
        && getComputedStyle(stickyTop).display === 'flex'
        && getComputedStyle(stickyTop).flexDirection === 'column';
      shell.style.cssText = previousShellStyle;
      stickyTop.style.cssText = previousStickyTopStyle;
      favorites.className = previousFavoritesClass;
      favorites.innerHTML = previousFavoritesHtml;
      const narrowHint = document.createElement('span');
      narrowHint.className = 'muted';
      narrowHint.textContent = '收藏当前目录后可快速跳转';
      favorites.appendChild(narrowHint);
      const previousFavoritesEmpty = favorites.classList.contains('is-empty');
      favorites.classList.add('is-empty');
      const previousViewStyle = view.style.cssText;
      view.style.width = '650px';
      view.style.flex = '0 0 650px';
      const narrowNavigationRect = navigationRow.getBoundingClientRect();
      const narrowTopRect = stickyTop.getBoundingClientRect();
      const narrowNavigationCompact = narrowNavigationRect.height < 100
        && narrowTopRect.height < 200
        && getComputedStyle(favorites).display === 'none';
      view.style.cssText = previousViewStyle;
      favorites.classList.toggle('is-empty', previousFavoritesEmpty);
      narrowHint.remove();

      directoryActionsUi = {
        found:Boolean(stickyTop && toolbar && navigationRow && breadcrumb && pathEditor && floatingSearch && dropOverlay),
        toolbarAnywhere:Boolean(document.querySelector('.sftp-toolbar')),
        stickyPosition:stickyTop ? getComputedStyle(stickyTop).position : '',
        toolbarInHeader:Boolean(document.querySelector('#workspaceHeaderTools')?.contains(toolbar)),
        navigationBeforeFavorites:Boolean(breadcrumb && favorites && (breadcrumb.compareDocumentPosition(favorites) & Node.DOCUMENT_POSITION_FOLLOWING)),
        actionTitles,
        searchHidden:floatingSearch.hidden,
        pathEditorHidden:pathEditor.hidden,
        pathEditorReplacesBreadcrumb,
        emptyClipboardHidden,
        copyQueueVisible,
        copyCancelled,
        moveQueueVisible,
        moveCancelled,
        crossHostCopyEnabled,
        crossHostMoveDisabled,
        crossHostClipboardConflict,
        crossHostConflictPrompted,
        crossHostConflictBody,
        crossHostClipboardCleared:sftpClipboard === null,
        filenameEncodingMenu,
        emptyFavoritesCompact,
        emptyFavoritesMetrics:{height:emptyFavoritesRect.height,minHeight:emptyFavoritesMinHeight,jobsGap:jobsRect.top-emptyNavigationRect.bottom},
        wideNavigationCompact,
        narrowNavigationCompact,
        terminalJump:Boolean(toolbar?.querySelector('button[title="打开此连接的终端"]')),
        reusedWithSilentRefresh
      };

      await showSftpGlobalSettings();
      const globalSettingsModal = document.querySelector('#modal');
      const globalSettingsCard = globalSettingsModal?.querySelector('.sftp-global-settings-modal');
      const globalSettingsRect = globalSettingsCard?.getBoundingClientRect();
      globalSettingsModal?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
      globalSettingsUi = {
        found:Boolean(document.querySelector('#sftpGlobalSettingsButton') && globalSettingsCard && !globalSettingsModal?.hidden),
        globalScope:Boolean(globalSettingsCard?.textContent.includes('应用到所有 SFTP 标签和连接')),
        controls:Boolean(document.querySelector('#sftpRecycleBinEnabled') && document.querySelector('#sftpMaxOpenFileSizeMb') && document.querySelector('#sftpGlobalSettingsSave')),
        downloadBehavior:Boolean(globalSettingsCard?.textContent.includes('SFTP 自动保存目录') || globalSettingsCard?.textContent.includes('当前设备的浏览器下载目录')),
        defaultLimit:document.querySelector('#sftpMaxOpenFileSizeMb')?.value === '5',
        backdropIgnored:Boolean(globalSettingsCard?.isConnected && !globalSettingsModal?.hidden),
        withinViewport:Boolean(globalSettingsRect && globalSettingsRect.left >= -0.5 && globalSettingsRect.right <= innerWidth + 0.5 && globalSettingsRect.top >= -0.5 && globalSettingsRect.bottom <= innerHeight + 0.5)
      };
      closeSftpGlobalSettings();

      const cachePreviousApi = api;
      const cachePreviousRender = renderSftpEntries;
      const savedDirectoryCache = [...sftpDirectoryViewCache.entries()];
      const savedDirectoryAliases = [...sftpDirectoryViewAliases.entries()];
      try {
        const cachePath = '/cache-behavior';
        const tabKey = 'sftp-' + connection.id;
        activeTabKey = tabKey;
        activeView = 'sftp';
        view.dataset.sftpTabKey = tabKey;
        view.innerHTML = '<div class="sftp-shell"><div id="sftpList" class="sftp-list"><div class="sftp-head"></div></div></div>';
        sftpState = {
          ...sftpState,
          connectionId:connection.id,
          path:cachePath,
          entries:[{name:'stable.txt',type:'file',size:1,mtime:1,mode:'644',owner:'root',group:'root'}],
          query:'',
          sort:'name',
          dir:'asc',
          page:1,
          pageSize:50,
          total:1,
          totalPages:1,
          unfilteredTotal:1,
          selected:null,
          loading:false
        };
        let responseEntries = sftpState.entries.map(entry=>({...entry}));
        let silentRenders = 0;
        api = async () => ({
          path:cachePath,
          entries:responseEntries.map(entry=>({...entry})),
          page:1,
          page_size:50,
          total:responseEntries.length,
          total_pages:1,
          unfiltered_total:responseEntries.length
        });
        renderSftpEntries = () => { silentRenders += 1; };
        loadSftpPage = previousLoadSftpPage;
        const checkedCacheLoad = options => Promise.race([
          loadSftpPage(options),
          new Promise((_, reject) => setTimeout(() => reject(new Error('SFTP silent cache load timed out')), 5000))
        ]);
        await checkedCacheLoad({connectionId:connection.id,path:cachePath,page:1,tabKey,refresh:true,keepContents:true,preserveView:true,silent:true,renderIfChangedOnly:true});
        const sameResponseUntouched = silentRenders === 0 && !view.querySelector('#sftpList')?.classList.contains('is-refreshing');
        responseEntries = [...responseEntries,{name:'new.txt',type:'file',size:2,mtime:2,mode:'644',owner:'root',group:'root'}];
        await checkedCacheLoad({connectionId:connection.id,path:cachePath,page:1,tabKey,refresh:true,keepContents:true,preserveView:true,silent:true,renderIfChangedOnly:true});
        const changedResponseRendered = silentRenders === 1 && sftpState.entries.some(entry=>entry.name === 'new.txt');

        sftpDirectoryViewCache.clear();
        sftpDirectoryViewAliases.clear();
        const hundredEntries = Array.from({length:100},(_,index)=>({name:'entry-'+index,type:'file',size:index,mtime:index}));
        for (let index=0; index<65; index += 1) {
          sftpState = {...sftpState,path:'/cache-'+index,entries:hundredEntries};
          cacheSftpDirectoryView(tabKey,sftpState.path,{scrollTop:0,selectedPaths:[],activePath:''});
        }
        const totalCachedEntries = [...sftpDirectoryViewCache.values()].reduce((sum,item)=>sum+(item.state?.entries?.length||0),0);
        const bounded = sftpDirectoryViewCache.size <= SFTP_DIRECTORY_VIEW_CACHE_MAX_DIRECTORIES
          && totalCachedEntries <= SFTP_DIRECTORY_VIEW_CACHE_MAX_ENTRIES;
        pruneSftpDirectoryViewCache(Date.now() + SFTP_DIRECTORY_VIEW_CACHE_TTL_MS + 1);
        const expired = sftpDirectoryViewCache.size === 0;
        directoryCacheBehavior = {sameResponseUntouched,changedResponseRendered,boundedAndExpired:bounded&&expired};
      } finally {
        api = cachePreviousApi;
        renderSftpEntries = cachePreviousRender;
        sftpDirectoryViewCache.clear();
        sftpDirectoryViewAliases.clear();
        savedDirectoryCache.forEach(([key,value])=>sftpDirectoryViewCache.set(key,value));
        savedDirectoryAliases.forEach(([key,value])=>sftpDirectoryViewAliases.set(key,value));
      }
    } finally {
      loadSftpPage = previousLoadSftpPage;
      refreshSftpJobs = previousRefreshSftpJobs;
      startSftpJobsTimer = previousStartSftpJobsTimer;
      sftpClipboard = previousClipboardState;
      sftpState = previousState;
      selectedId = previousSelectedId;
      activeView = previousActiveView;
      activeTabKey = previousActiveTabKey;
    }
    const actions = [];
    openSftp = (id, path) => actions.push({kind:'dir', id, path});
    previewSftpText = (id, path) => actions.push({kind:'file', id, path});
    const specialName = "weird" + String.fromCharCode(39, 34) + "<&>.bin";
    view.hidden = false;
    view.innerHTML = '<div class="sftp-shell"><div class="sftp-top"><div class="sftp-path-block"><div class="sftp-title">iMac</div><nav class="sftp-breadcrumb" id="sftpBreadcrumb" aria-label="远程目录路径">'+sftpBreadcrumbHtml(1,'/Users/junruo/Public')+'</nav></div><div class="sftp-top-actions"></div><div class="sftp-selection-bar" id="sftpSelectionBar" hidden><div class="sftp-selected" id="sftpSelectedInfo"></div><div class="sftp-selection-actions"><button id="sftpSelectionCompress">压缩</button><button id="sftpSelectionPermissions">权限</button><button id="sftpSelectionExtract" hidden>解压</button><button>复制</button><button>移动</button><button>删除</button><button onclick="clearSftpSelection()">取消</button></div></div></div><div id="sftpList" class="sftp-list"></div></div>';
    const pageEntries = [
      {name:'folder', type:'dir', size:0, mtime:0, mode:'755', owner:'root', group:'wheel'},
      {name:specialName, type:'file', size:12, mtime:'2026-07-20T12:34:56Z', mode:'600', owner:'junruo', group:'staff'},
      {name:'vmlinuz', type:'file', size:8181696, mtime:'2026-07-20T12:40:00Z', mode:'644', owner:'root', group:'root', is_symlink:true, link_size:27, link_target_missing:false},
      ...Array.from({length:47},(_,index)=>({name:'file-'+String(index+1).padStart(2,'0')+'.txt',type:'file',size:index+1,mtime:index+1,mode:'644',owner:'junruo',group:'staff'}))
    ];
    sftpState = {...sftpState, connectionId:1, path:'/fixture', query:'', sort:'name', dir:'asc', selected:null, page:1, pageSize:50, total:75, totalPages:2, unfilteredTotal:75, entries:pageEntries};
    renderSftpEntries();
    const rows = [...document.querySelectorAll('#view-sftp .sftp-row')];
    const feedbackPath = '/fixture/' + specialName;
    const feedbackButton = rows[1]?.querySelector('.sftp-file-open-button');
    let finishFeedbackRequest;
    let duplicateFeedbackRequestRan = false;
    const feedbackRequest = withSftpFileOpenFeedback(1, feedbackPath, () => new Promise(resolve => { finishFeedbackRequest = resolve; }));
    await Promise.resolve();
    const feedbackBusy = Boolean(feedbackButton?.disabled && feedbackButton?.getAttribute('aria-busy') === 'true' && feedbackButton?.textContent.includes('打开中'));
    await withSftpFileOpenFeedback(1, feedbackPath, async () => { duplicateFeedbackRequestRan = true; });
    finishFeedbackRequest?.({ok:true});
    await feedbackRequest;
    const fileOpenFeedback = {
      busy:feedbackBusy,
      duplicateBlocked:!duplicateFeedbackRequestRan,
      restored:Boolean(feedbackButton && !feedbackButton.disabled && feedbackButton.getAttribute('aria-busy') === 'false' && feedbackButton.textContent.includes('打开'))
    };
    const idleDirectorySizeButton = rows[0]?.querySelector('.sftp-directory-size-button');
    const previousDirectorySizeApi = api;
    let directorySizeRequests = 0;
    try {
      api = async (url, options={}) => {
        if (url.endsWith('/sftp/directory-size')) {
          directorySizeRequests += 1;
          return {path:'/fixture/folder',size:6146,size_bytes:'6146',method:'recursive-file-bytes'};
        }
        return previousDirectorySizeApi(url, options);
      };
      await readSftpDirectorySize(1, '/fixture/folder');
    } finally {
      api = previousDirectorySizeApi;
    }
    const readyDirectorySizeButton = rows[0]?.querySelector('.sftp-directory-size-button');
    const directorySizeUi = {
      idleButton:Boolean(idleDirectorySizeButton && idleDirectorySizeButton.textContent.includes('读取')),
      requestedOnce:directorySizeRequests === 1,
      exactBytes:Boolean(readyDirectorySizeButton?.title.includes('6146 字节')),
      formatted:Boolean(readyDirectorySizeButton?.textContent.includes('6.0 KB')),
      refreshable:Boolean(readyDirectorySizeButton?.title.includes('点击重新读取'))
    };
    rows[0]?.dispatchEvent(new MouseEvent('dblclick', {bubbles:true, cancelable:true}));
    rows[1]?.dispatchEvent(new MouseEvent('dblclick', {bubbles:true, cancelable:true}));
    const top = document.querySelector('#view-sftp .sftp-top');
    const checks = [...document.querySelectorAll('#view-sftp .sftp-check')];
    checks[0].checked = true;
    checks[1].checked = true;
    updateSftpSelection();
    const selectionBar = document.querySelector('#view-sftp #sftpSelectionBar');
    const selectionShown = !selectionBar.hidden && selectionBar.textContent.includes('已选择 2 项');
    const selectionActionsShown = getComputedStyle(document.querySelector('#sftpSelectionCompress')).display !== 'none' && getComputedStyle(document.querySelector('#sftpSelectionPermissions')).display !== 'none';
    const specialSelectionExact = selectedSftpPaths().includes('/fixture/' + specialName);
    const selectedRows = document.querySelectorAll('#view-sftp .sftp-row.is-selected').length;
    clearSftpSelection();
    const selectionCleared = selectionBar.hidden;
    const moreButton = rows[1]?.querySelector('.sftp-row-action-more');
    moreButton?.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, clientX:320, clientY:240}));
    const moreMenuLabels = [...document.querySelectorAll('#actionMenu button span')].map(node => node.textContent.trim());
    const moreMenuOpened = moreMenuLabels.includes('以文本打开') && moreMenuLabels.includes('压缩') && moreMenuLabels.includes('设置权限') && moreMenuLabels.includes('删除');
    hideActionMenu();
    rows[0]?.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:260, clientY:220}));
    const directoryMenuText = document.querySelector('#actionMenu')?.textContent || '';
    const contextMenuOpened = Boolean(document.querySelector('#actionMenu')) && directoryMenuText.includes('打开') && directoryMenuText.includes('下载') && directoryMenuText.includes('压缩') && directoryMenuText.includes('设置权限');
    const directoryDownloadMenu = directoryMenuText.includes('下载');
    hideActionMenu();
    const fileHasCompression = Boolean(rows[1]?.querySelector('.sftp-row-action[title="压缩"]'));
    const fileHasPermissions = Boolean(rows[1]?.querySelector('.sftp-row-action[title="设置权限"]'));
    const permissionOwnerColumn = rows[1]?.querySelector(':scope > .sftp-access code')?.textContent === '600' && rows[1]?.querySelector(':scope > .sftp-access span')?.textContent === 'junruo';
    const permissionOwnerTitle = rows[1]?.querySelector(':scope > .sftp-access')?.title.includes('用户组 staff');
    const symlinkUsesTargetSize = rows[2]?.querySelector(':scope > .sftp-size')?.textContent === formatBytes(8181696);
    const symlinkExplainsBothSizes = rows[2]?.querySelector('.sftp-name')?.title.includes(formatBytes(8181696))
      && rows[2]?.querySelector('.sftp-name')?.title.includes(formatBytes(27));
    const symlinkMarked = rows[2]?.querySelector('.sftp-icon')?.classList.contains('symlink');
    openSftpPermissionsForSelection(['/fixture/folder']);
    const permissionModal = document.querySelector('#sftpPermissionMode');
    permissionModal.value = '640';
    permissionModal.dispatchEvent(new Event('input', {bubbles:true}));
    const permissionModeSync = permissionModal.value === '640' && document.querySelector('[data-permission="ownerWrite"]')?.checked && !document.querySelector('[data-permission="ownerExecute"]')?.checked;
    const recursiveVisible = Boolean(document.querySelector('#sftpPermissionRecursive'));
    document.querySelector('#sftpPermissionCancel')?.click();
    const breadcrumbText = document.querySelector('#view-sftp #sftpBreadcrumb')?.textContent.replace(/\s+/g,' ').trim() || '';
    const breadcrumbLabels = [...document.querySelectorAll('#view-sftp #sftpBreadcrumb .crumb')].map(node => node.textContent.trim());
    const compactRowHeight = rows[0]?.getBoundingClientRect().height || 0;
    const sftpList = document.querySelector('#view-sftp #sftpList');
    sftpList.style.width = '1280px';
    syncSftpListLayout(sftpList, 1280);
    const head = sftpList.querySelector('.sftp-head');
    const alignmentSelectors = ['.sftp-size','.sftp-time','.sftp-access','.sftp-head-actions'];
    const rowAlignmentSelectors = ['.sftp-size','.sftp-time','.sftp-access','.sftp-row-actions'];
    const wideColumnAlignment = alignmentSelectors.every((selector,index) => {
      const headLeft = head.querySelector(selector)?.getBoundingClientRect().left;
      const rowLeft = rows[0]?.querySelector(':scope > ' + rowAlignmentSelectors[index])?.getBoundingClientRect().left;
      return Number.isFinite(headLeft) && Number.isFinite(rowLeft) && Math.abs(headLeft - rowLeft) <= 1;
    });
    const wideActions = rows[0]?.querySelector(':scope > .sftp-row-actions');
    const wideLastAction = wideActions?.lastElementChild;
    const wideActionsFit = Boolean(wideActions && wideLastAction && wideLastAction.getBoundingClientRect().right <= wideActions.getBoundingClientRect().right + 1);
    sftpList.style.width = '760px';
    syncSftpListLayout(sftpList, 760);
    const compactSizeVisible = getComputedStyle(rows[1].querySelector(':scope > .sftp-size')).display !== 'none';
    const compactTimeVisible = getComputedStyle(rows[1].querySelector(':scope > .sftp-time')).display !== 'none';
    const compactAccessVisible = getComputedStyle(rows[1].querySelector(':scope > .sftp-access')).display !== 'none';
    const compactMediumHidden = getComputedStyle(rows[1].querySelector('.sftp-row-action-medium')).display === 'none';
    const compactCoreVisible = getComputedStyle(rows[1].querySelector('.sftp-row-action-core')).display !== 'none';
    const compactNoOverflow = sftpList.scrollWidth <= sftpList.clientWidth + 1;
    sftpList.style.width = '390px';
    syncSftpListLayout(sftpList, 390);
    const narrowListWidth = sftpList.getBoundingClientRect().width;
    const narrowCoreDisplay = getComputedStyle(rows[0].querySelector('.sftp-row-action-core')).display;
    const narrowCoreHidden = narrowCoreDisplay === 'none';
    const narrowMoreVisible = getComputedStyle(rows[0].querySelector('.sftp-row-action-more')).display !== 'none';
    const narrowMetaVisible = getComputedStyle(rows[1].querySelector('.sftp-mobile-meta')).display !== 'none' && rows[1].querySelector('.sftp-mobile-meta')?.textContent.includes('12 B');
    const narrowAccessHidden = getComputedStyle(rows[1].querySelector(':scope > .sftp-access')).display === 'none';
    const narrowLayoutClass = sftpList.classList.contains('sftp-actions-more-only');
    sftpList.style.width = '';
    sftpKnownJobStatuses.set('ui-smoke-extract', 'running');
    const completedMutationDetected = completedSftpMutationForCurrentView([{id:'ui-smoke-extract',status:'done',type:'extract',connection_id:1}]);
    sftpKnownJobStatuses.delete('ui-smoke-extract');
    let jobUi = {found:false};
    let jobFixture = view.querySelector('#sftpJobs');
    const ownsJobFixture = !jobFixture;
    if (!jobFixture) {
      jobFixture = document.createElement('div');
      jobFixture.id = 'sftpJobs';
      jobFixture.className = 'sftp-jobs';
      view.querySelector('.sftp-shell')?.insertBefore(jobFixture, view.querySelector('#sftpList'));
    }
    if (!jobFixture?.isConnected) throw new Error('SFTP task list fixture is missing');
    const previousJobFixtureHtml = jobFixture.innerHTML;
    const previousJobFixtureClassName = jobFixture.className;
    const previousApi = api;
    const previousJobTimer = startSftpJobsTimer;
    const previousLatestJobs = sftpLatestJobs;
    try {
      const jobFixtures = [
        {id:'running-job',status:'running',type:'upload',label:'正在上传任务',connection_id:Number(connection.id),connection_name:'iMac',size:100,transferred:40,progress:40},
        {id:'failed-job',status:'failed',type:'copy',label:'失败任务',connection_id:Number(connection.id),connection_name:'iMac',error:'fixture failed'},
        {id:'done-job',status:'done',type:'compress',label:'完成历史任务',connection_id:Number(connection.id),connection_name:'iMac',finished_at:Date.now()-1000},
        {id:'saved-download',status:'done',type:'download',label:'桌面已保存下载',connection_id:Number(connection.id),connection_name:'iMac',delivery_mode:'desktop',delivery_status:'saved',saved_path:'C:\\Users\\fixture\\Downloads\\saved.txt',finished_at:Date.now()-1200},
        {id:'browser-download',status:'done',type:'download',label:'浏览器已保存下载',connection_name:'iMac',connection_id:1,remote_path:'/tmp/browser.txt',delivery_mode:'browser',delivery_status:'delivered',finished_at:Date.now()-1300},
        {id:'cancelled-job',status:'cancelled',type:'move',label:'取消历史任务',connection_id:Number(connection.id),connection_name:'iMac',finished_at:Date.now()-2000}
      ];
      api = async pathname => pathname === '/api/sftp/jobs' ? jobFixtures : [];
      startSftpJobsTimer = () => {};
      await refreshSftpJobs();
      const mainText = jobFixture.textContent.replace(/\s+/g,' ').trim();
      const floatingTask = document.querySelector('#sftpTaskFloat');
      const floatingText = floatingTask?.textContent.replace(/\s+/g,' ').trim() || '';
      const floatingProgress = Number.parseFloat(floatingTask?.querySelector('.progress i')?.style.width || '0');
      const floatingInitiallyVisible = Boolean(floatingTask && !floatingTask.hidden && floatingText.includes('正在上传任务'));
      const floatingIconHolder = floatingTask?.querySelector('.sftp-task-float-icon')?.getBoundingClientRect();
      const floatingIconGlyph = floatingTask?.querySelector('.sftp-task-float-icon > *')?.getBoundingClientRect();
      const floatingCloseHolder = floatingTask?.querySelector('.sftp-task-float-close')?.getBoundingClientRect();
      const floatingCloseGlyph = floatingTask?.querySelector('.sftp-task-float-close svg')?.getBoundingClientRect();
      const floatingCancelHolder = floatingTask?.querySelector('.sftp-task-float-cancel')?.getBoundingClientRect();
      const floatingCancelGlyph = floatingTask?.querySelector('.sftp-task-float-cancel svg')?.getBoundingClientRect();
      const floatingIconsAligned = Boolean(
        floatingIconHolder && floatingIconGlyph && floatingCloseHolder && floatingCloseGlyph && floatingCancelHolder && floatingCancelGlyph
        && floatingTask?.querySelector('.sftp-task-spinner')
        && Math.abs((floatingIconHolder.left + floatingIconHolder.width / 2) - (floatingIconGlyph.left + floatingIconGlyph.width / 2)) <= 1
        && Math.abs((floatingIconHolder.top + floatingIconHolder.height / 2) - (floatingIconGlyph.top + floatingIconGlyph.height / 2)) <= 1
        && Math.abs((floatingCloseHolder.left + floatingCloseHolder.width / 2) - (floatingCloseGlyph.left + floatingCloseGlyph.width / 2)) <= 1
        && Math.abs((floatingCloseHolder.top + floatingCloseHolder.height / 2) - (floatingCloseGlyph.top + floatingCloseGlyph.height / 2)) <= 1
        && Math.abs((floatingCancelHolder.left + floatingCancelHolder.width / 2) - (floatingCancelGlyph.left + floatingCancelGlyph.width / 2)) <= 1
        && Math.abs((floatingCancelHolder.top + floatingCancelHolder.height / 2) - (floatingCancelGlyph.top + floatingCancelGlyph.height / 2)) <= 1
      );
      const uploadPhaseSnapshots = [
        {phase:'receiving',transferred:100,progress:10,speed_bps:0},
        {phase:'receiving',transferred:350,progress:35,speed_bps:0},
        {phase:'receiving',transferred:600,progress:60,speed_bps:0},
        {phase:'uploading',transferred:750,progress:75,speed_bps:128}
      ];
      const uploadPhaseSpinnerNodes = [];
      const uploadPhaseDetails = [];
      const uploadPhaseProgressWidths = [];
      for (const snapshot of uploadPhaseSnapshots) {
        updateSftpTaskFloat([{
          id:'upload-phase-job',
          status:'running',
          type:'upload',
          phase:snapshot.phase,
          label:'上传 external-drag.7z',
          connection_id:Number(connection.id),
          connection_name:'iMac',
          size:1000,
          transferred:snapshot.transferred,
          progress:snapshot.progress,
          speed_bps:snapshot.speed_bps
        }]);
        uploadPhaseSpinnerNodes.push(floatingTask?.querySelector('.sftp-task-spinner') || null);
        uploadPhaseDetails.push(floatingTask?.querySelector('.sftp-task-float-copy > span')?.textContent || '');
        uploadPhaseProgressWidths.push(Number.parseFloat(floatingTask?.querySelector('.progress i')?.style.width || '0'));
      }
      const floatingSpinnerStableAcrossUpdates = Boolean(
        uploadPhaseSpinnerNodes[0]
        && uploadPhaseSpinnerNodes.every(node => node === uploadPhaseSpinnerNodes[0])
      );
      const floatingUploadPhaseLabels = uploadPhaseDetails.slice(0, 3).every(text =>
        text.includes('正在准备上传')
        && !text.includes('正在接收')
        && !text.includes('正在上传到远端')
      ) && uploadPhaseDetails[3]?.includes('正在上传到远端')
        && !uploadPhaseDetails[3]?.includes('正在准备上传')
        && !uploadPhaseDetails[3]?.includes('正在接收');
      const floatingProgressRefreshes = uploadPhaseProgressWidths.length === 4
        && uploadPhaseProgressWidths.every((width, index) => Math.abs(width - [10,35,60,75][index]) <= 0.1);
      updateSftpTaskFloat([{
        id:'cross-copy-progress-job',
        status:'running',
        type:'cross-copy',
        label:'从 bt01 复制 1 项',
        connection_id:Number(connection.id),
        connection_name:'Linux 图形界面测试',
        size:1000,
        size_known:true,
        progress_known:true,
        progress_estimated:true,
        transferred:520,
        progress:52,
        speed_bps:256
      }]);
      const floatingCrossCopyProgress = Math.abs(Number.parseFloat(floatingTask?.querySelector('.progress i')?.style.width || '0') - 52) <= 0.1;
      const floatingCrossCopyDetail = (floatingTask?.querySelector('.sftp-task-float-detail')?.textContent || '').includes('约 52%')
        && (floatingTask?.querySelector('.sftp-task-float-detail')?.textContent || '').includes('/s');
      const nativeDragJob = {
        id:'native-drag-job',
        status:'running',
        type:'native-drag',
        phase:'cancelling',
        can_cancel:false,
        label:'拖出 large.bin 到本机',
        connection_id:Number(connection.id),
        connection_name:'iMac',
        size:1000,
        transferred:500,
        progress:50
      };
      updateSftpTaskFloat([nativeDragJob]);
      const nativeDragFloatingStopHidden = Boolean(floatingTask?.querySelector('.sftp-task-float-cancel')?.hidden)
        && floatingTask?.textContent.includes('正在停止');
      const nativeDragTaskStopHidden = !renderSftpJob(nativeDragJob).includes('>取消</button>');
      updateSftpTaskFloat(jobFixtures);
      const taskDrawer = jobFixture.querySelector('.sftp-task-drawer');
      if (taskDrawer) taskDrawer.open = false;
      const floatingTabKey = 'sftp-' + connection.id;
      const previousFloatingOpenSftp = openSftp;
      const previousFloatingActiveView = activeView;
      const previousFloatingActiveTabKey = activeTabKey;
      const previousFloatingViewTabKey = view.dataset.sftpTabKey;
      let resolveFloatingOpen;
      let floatingOpenCall = null;
      let addedFloatingTab = false;
      if (!tabs.some(item => item.key === floatingTabKey)) {
        tabs.push({key:floatingTabKey,kind:'sftp',id:Number(connection.id),title:'任务跳转测试 · SFTP',path:'/fixture'});
        addedFloatingTab = true;
      }
      openSftp = (id, path) => {
        floatingOpenCall = {id:Number(id),path};
        activeView = 'sftp';
        activeTabKey = 'sftp-' + id;
        view.dataset.sftpTabKey = activeTabKey;
        return new Promise(resolve => { resolveFloatingOpen = resolve; });
      };
      activeView = 'welcome';
      activeTabKey = 'sftp-task-origin';
      const workspace = document.querySelector('.workspace');
      if (workspace) workspace.scrollTop = workspace.scrollHeight;
      floatingTask?.querySelector('.sftp-task-float-open')?.click();
      await new Promise(resolve => setTimeout(resolve, 40));
      const floatingOpensTaskList = Boolean(
        floatingOpenCall?.id === Number(connection.id)
        && activeView === 'sftp'
        && activeTabKey === floatingTabKey
        && view.dataset.sftpTabKey === floatingTabKey
        && jobFixture.querySelector('.sftp-task-drawer')?.open
      );
      const stickyTaskTop = view.querySelector('.sftp-top')?.getBoundingClientRect().bottom || 0;
      const floatingTaskVisibleBelowToolbar = Boolean(
        workspace
          ? workspace.scrollTop <= 1
          : (jobFixture.getBoundingClientRect().top || 0) >= stickyTaskTop - 1
      );
      const navigationSeqBeforeClose = sftpTaskNavigationSeq;
      const activeTabBeforeClose = activeTabKey;
      floatingTask?.querySelector('.sftp-task-float-close')?.click();
      await Promise.resolve();
      const floatingCloses = Boolean(floatingTask?.hidden);
      const floatingCloseDoesNotNavigate = sftpTaskNavigationSeq === navigationSeqBeforeClose && activeTabKey === activeTabBeforeClose;
      resolveFloatingOpen?.(true);
      openSftp = previousFloatingOpenSftp;
      activeView = previousFloatingActiveView;
      activeTabKey = previousFloatingActiveTabKey;
      view.dataset.sftpTabKey = previousFloatingViewTabKey;
      if (addedFloatingTab) tabs.splice(tabs.findIndex(item => item.key === floatingTabKey), 1);
      updateSftpTaskFloat(jobFixtures);
      const floatingSameBatchStaysClosed = Boolean(floatingTask?.hidden);
      const deleteJob = {id:'delete-job',status:'running',type:'delete',label:'删除 3 项',connection_id:Number(connection.id),connection_name:'iMac',progress_unit:'items',size:3,transferred:1,progress:33};
      updateSftpTaskFloat([...jobFixtures, deleteJob]);
      const floatingNewTaskReopens = Boolean(floatingTask && !floatingTask.hidden && floatingTask.textContent.includes('2 个 SFTP 任务'));
      notify('SFTP 测试提示\\n任务进度仍然可见', 'success');
      await Promise.resolve();
      const toast = document.querySelector('#toast');
      const toastRect = toast?.getBoundingClientRect();
      const floatingRect = floatingTask?.getBoundingClientRect();
      const toastStyle = toast ? getComputedStyle(toast) : null;
      const floatingStyle = floatingTask ? getComputedStyle(floatingTask) : null;
      const floatingStacksBelowToast = Boolean(
        toastRect && floatingRect
        && toastRect.width > 0 && floatingRect.width > 0
        && toastRect.bottom <= floatingRect.top + 0.5
      );
      const floatingMatchesToastStyle = Boolean(
        toastStyle && floatingStyle
        && Math.abs((toastRect?.width || 0) - (floatingRect?.width || 0)) <= 1
        && toastStyle.borderRadius === floatingStyle.borderRadius
        && toastStyle.backgroundColor === floatingStyle.backgroundColor
        && toastStyle.boxShadow === floatingStyle.boxShadow
      );
      const toastIconsAligned = ['success','info','error'].every(type => {
        notify('SFTP ' + type + ' 图标测试\\n图标应与提示文字对齐', type);
        const holder = document.querySelector('#toast .toast-icon')?.getBoundingClientRect();
        const glyph = document.querySelector('#toast .toast-icon svg')?.getBoundingClientRect();
        if (!holder || !glyph || !holder.width || !glyph.width) return false;
        return Math.abs((holder.left + holder.width / 2) - (glyph.left + glyph.width / 2)) <= 1
          && Math.abs((holder.top + holder.height / 2) - (glyph.top + glyph.height / 2)) <= 1;
      });
      dismissToast();
      updateSftpTaskFloat([deleteJob]);
      const floatingItemProgress = floatingTask?.textContent.includes('已处理 1 / 3 项');
      let resolveStaleJobs;
      let jobRequestCount = 0;
      api = pathname => {
        if (pathname !== '/api/sftp/jobs') return Promise.resolve([]);
        jobRequestCount += 1;
        if (jobRequestCount === 1) return new Promise(resolve => { resolveStaleJobs = resolve; });
        return Promise.resolve([deleteJob]);
      };
      const staleRefresh = refreshSftpJobs();
      await refreshSftpJobs();
      resolveStaleJobs?.(jobFixtures);
      await staleRefresh;
      const staleJobResponseIgnored = sftpLatestJobs.length === 1 && sftpLatestJobs[0]?.id === deleteJob.id;
      api = async pathname => pathname === '/api/sftp/jobs' ? jobFixtures : [];
      await refreshSftpJobs();
      updateSftpTaskFloat(jobFixtures.filter(job => ['done','cancelled','failed'].includes(job.status)));
      const floatingAutoHides = Boolean(floatingTask?.hidden);
      const historyButton = jobFixture.querySelector('.sftp-task-summary-actions button');
      const mainJobRowHeight = jobFixture.querySelector('.sftp-job')?.getBoundingClientRect().height || 0;
      await showSftpJobHistory();
      const historyText = document.querySelector('#sftpJobHistoryList')?.textContent.replace(/\s+/g,' ').trim() || '';
      const historyModal=document.querySelector('#modal');
      historyModal?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
      const historyBackdropIgnored=Boolean(historyModal&&!historyModal.hidden&&historyModal.querySelector('.sftp-history-modal'));
      jobUi = {
        found:Boolean(jobFixture.querySelector('.sftp-task-drawer')),
        mainHasRunning:mainText.includes('正在上传任务'),
        mainHasFailed:mainText.includes('失败任务'),
        mainHidesDone:!mainText.includes('完成历史任务') && !mainText.includes('取消历史任务'),
        historyEnabled:Boolean(historyButton && !historyButton.disabled),
        historyCount:historyButton?.querySelector('small')?.textContent || '',
        historyHasDone:historyText.includes('完成历史任务') && historyText.includes('取消历史任务'),
        savedDownloadOnlyOpensDirectory:historyText.includes('桌面已保存下载') && historyText.includes('打开目录') && ![...document.querySelectorAll('#sftpJobHistoryList .sftp-job')].find(row=>row.textContent.includes('桌面已保存下载'))?.textContent.includes('保存到本机'),
        browserDownloadCanRepeat:historyText.includes('浏览器已保存下载') && [...document.querySelectorAll('#sftpJobHistoryList .sftp-job')].find(row=>row.textContent.includes('浏览器已保存下载'))?.textContent.includes('再次下载'),
        historyHidesCurrent:!historyText.includes('正在上传任务') && !historyText.includes('失败任务'),
        backdropIgnored:historyBackdropIgnored,
        noManualRefresh:!jobFixture.textContent.includes('刷新目录') && !historyText.includes('刷新目录'),
        compactRow:mainJobRowHeight > 0 && mainJobRowHeight <= 88,
        floatingVisible:floatingInitiallyVisible,
        floatingProgress:floatingProgress >= 39 && floatingProgress <= 41,
        floatingIconsAligned,
        floatingSpinnerStableAcrossUpdates,
        floatingUploadPhaseLabels,
        floatingProgressRefreshes,
        floatingCrossCopyProgress,
        floatingCrossCopyDetail,
        nativeDragFloatingStopHidden,
        nativeDragTaskStopHidden,
        floatingOpensTaskList,
        floatingTaskVisibleBelowToolbar,
        floatingCloses,
        floatingCloseDoesNotNavigate,
        floatingSameBatchStaysClosed,
        floatingNewTaskReopens,
        floatingStacksBelowToast,
        floatingMatchesToastStyle,
        toastIconsAligned,
        floatingItemProgress,
        staleJobResponseIgnored,
        floatingAutoHides
      };
      closeSftpJobHistory();
    } finally {
      api = previousApi;
      startSftpJobsTimer = previousJobTimer;
      sftpLatestJobs = previousLatestJobs;
      updateSftpTaskFloat([]);
      if (ownsJobFixture) jobFixture.remove();
      else {
        jobFixture.className = previousJobFixtureClassName;
        jobFixture.innerHTML = previousJobFixtureHtml;
      }
    }
    const previousDownloadApi=api;
    const previousDownloadConfirm=confirmModal;
    const previousDownloadChoice=chooseModal;
    const previousDownloadRefresh=refreshSftpJobs;
    const previousDownloadTimer=startSftpJobsTimer;
    const previousDownloadTabKey=activeTabKey;
    const desktopNotice=localStorage.getItem('sftpDesktopDownloadNoticeV1');
    const browserNotice=localStorage.getItem('sftpBrowserDownloadNoticeV1');
    let deliveryMode='desktop';
    let noticeCalls=0;
    const noticeMessages=[];
    const downloadRequests=[];
    let batchChoiceCalls=0;
    const downloadFixtureTab={key:'sftp-download-fixture',kind:'sftp',id:1,title:'下载测试'};
    try {
      tabs.push(downloadFixtureTab);
      activeTabKey=downloadFixtureTab.key;
      localStorage.removeItem('sftpDesktopDownloadNoticeV1');
      localStorage.removeItem('sftpBrowserDownloadNoticeV1');
      api=async (pathname,options={})=>{
        if(pathname==='/api/sftp/download-settings')return deliveryMode==='desktop'?{delivery_mode:'desktop',effective_directory:'C:\\Users\\fixture\\Downloads'}:{delivery_mode:'browser'};
        if(pathname.includes('/sftp/download')){
          const body=JSON.parse(options.body||'{}');
          const result={pathname,body,id:'notice-'+deliveryMode+'-'+downloadRequests.length,delivery_mode:deliveryMode};
          downloadRequests.push(result);
          return result;
        }
        return [];
      };
      confirmModal=async message=>{noticeCalls+=1;noticeMessages.push(message);return true;};
      chooseModal=async (title,message,actions)=>{batchChoiceCalls+=1;return actions.some(action=>action.value==='separate')?'separate':'';};
      refreshSftpJobs=async()=>[];
      startSftpJobsTimer=()=>{};
      await downloadSftp(1,'/tmp/first.txt');
      await downloadSftp(1,'/tmp/second.txt');
      deliveryMode='browser';
      checks[0].checked=true;
      checks[1].checked=true;
      updateSftpSelection();
      await downloadSftpSelection();
      await downloadSftp(1,'/tmp/mobile.txt');
    } finally {
      api=previousDownloadApi;
      confirmModal=previousDownloadConfirm;
      chooseModal=previousDownloadChoice;
      refreshSftpJobs=previousDownloadRefresh;
      startSftpJobsTimer=previousDownloadTimer;
      activeTabKey=previousDownloadTabKey;
      const downloadFixtureIndex=tabs.findIndex(tab=>tab.key===downloadFixtureTab.key);
      if(downloadFixtureIndex>=0)tabs.splice(downloadFixtureIndex,1);
      sftpPendingBrowserDownloads.clear();
      if(desktopNotice===null)localStorage.removeItem('sftpDesktopDownloadNoticeV1');else localStorage.setItem('sftpDesktopDownloadNoticeV1',desktopNotice);
      if(browserNotice===null)localStorage.removeItem('sftpBrowserDownloadNoticeV1');else localStorage.setItem('sftpBrowserDownloadNoticeV1',browserNotice);
    }
    const downloadNoticeUi={
      oncePerMode:noticeCalls===2,
      desktopPath:noticeMessages.some(message=>message.includes('C:\\Users\\fixture\\Downloads')),
      browserDevice:noticeMessages.some(message=>message.includes('当前设备')||message.includes('当前手机')),
      batchUsesSharedNotice:noticeCalls===2,
      browserSeparateChoice:batchChoiceCalls===1,
      browserSeparateQueued:downloadRequests.some(request=>request.pathname.endsWith('/sftp/download-batch')&&request.body.mode==='archive'&&request.body.paths?.[0]==='/fixture/folder')
        && downloadRequests.some(request=>request.pathname.endsWith('/sftp/download')&&request.body.path==='/fixture/'+specialName),
      noDuplicateBatchNotice:noticeCalls===2
    };
    const editorPromise = sftpTextModal('/tmp/gbk.txt', '中文内容', 8, 512*1024, 'gbk', 'auto');
    await new Promise(resolve=>setTimeout(resolve,20));
    const editorHost=document.querySelector('#sftpTextEditor');
    const languageSelect=document.querySelector('#sftpEditorLanguage');
    if (languageSelect) {
      languageSelect.value='markdown';
      languageSelect.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    let jsonFormatting=false;
    if (languageSelect && window.ace && editorHost) {
      const editor=ace.edit(editorHost);
      languageSelect.value='json';
      languageSelect.dispatchEvent(new Event('change',{bubbles:true}));
      editor.setValue('{"name":"TunnelDesk","items":[1,2]}',-1);
      document.querySelector('#sftpTextFormatJson')?.click();
      await new Promise(resolve=>setTimeout(resolve,20));
      jsonFormatting=!document.querySelector('#sftpTextFormatJson')?.hidden
        && editor.getValue().includes('\\n  "name": "TunnelDesk"')
        && editor.getValue().includes('\\n  "items": [');
      editor.setValue('中文内容',-1);
      languageSelect.value='markdown';
      languageSelect.dispatchEvent(new Event('change',{bubbles:true}));
    }
    const textEncodingUi={
      opened:Boolean(document.querySelector('.sftp-editor-modal')),
      aceLoaded:Boolean(editorHost?.classList.contains('ace_editor')),
      selected:document.querySelector('#sftpTextEncoding')?.value||'',
      options:[...document.querySelectorAll('#sftpTextEncoding option')].map(option=>option.value),
      languageOptions:[...document.querySelectorAll('#sftpEditorLanguage option')].map(option=>option.value),
      manualLanguage:Boolean(window.ace&&editorHost&&ace.edit(editorHost).session.$modeId==='ace/mode/markdown'),
      jsonFormatting,
      wordWrap:Boolean(document.querySelector('#sftpEditorWordWrap')?.checked),
      persistDefault:Boolean(document.querySelector('#sftpPersistEncoding')),
      backup:Boolean(document.querySelector('#sftpBackupBeforeSave')?.checked)
    };
    document.querySelector('#sftpTextClose')?.click();
    await editorPromise;
    const result = {
      folderOpened: actions[0]?.kind === 'dir' && actions[0]?.path === '/fixture/folder',
      fileOpened: actions[1]?.kind === 'file' && actions[1]?.path === '/fixture/' + specialName,
      connectionSessionUi,
      nativeDragUi,
      directoryActionsUi,
      globalSettingsUi,
      directoryCacheBehavior,
      directorySizeUi,
      fileOpenFeedback,
      unknownAction: Boolean([...document.querySelectorAll('#view-sftp .sftp-row-actions button')].find(button => button.title === '以文本打开')),
      stickyPosition: top ? getComputedStyle(top).position : '',
      breadcrumbScrollable: Boolean(document.querySelector('#view-sftp .sftp-breadcrumb')),
      breadcrumbText,
      breadcrumbLabels,
      singlePathPresentation: !document.querySelector('#view-sftp #sftpPath'),
      selectionShown,
      selectionActionsShown,
      specialSelectionExact,
      selectedRows,
      selectionCleared,
      fileHasCompression,
      fileHasPermissions,
      permissionOwnerColumn,
      permissionOwnerTitle,
      symlinkUsesTargetSize,
      symlinkExplainsBothSizes,
      symlinkMarked,
      wideColumnAlignment,
      wideActionsFit,
      compactSizeVisible,
      compactTimeVisible,
      compactAccessVisible,
      compactMediumHidden,
      compactCoreVisible,
      compactNoOverflow,
      permissionModeSync,
      recursiveVisible,
      compactRowHeight,
      moreMenuOpened,
      contextMenuOpened,
      directoryDownloadMenu,
      narrowCoreHidden,
      narrowCoreDisplay,
      narrowListWidth,
      narrowLayoutClass,
      narrowMoreVisible,
      narrowMetaVisible,
      narrowAccessHidden,
      completedMutationDetected,
      textEncodingUi,
      jobUi,
      downloadNoticeUi,
      pageRows:rows.length,
      pagerVisible:Boolean(document.querySelector('#view-sftp .sftp-pager')),
      pagerText:document.querySelector('#view-sftp .sftp-pager')?.textContent.replace(/\s+/g,' ').trim()||'',
      previousDisabled:Boolean(document.querySelector('#view-sftp .sftp-pager button:first-child')?.disabled),
      nextEnabled:!document.querySelector('#view-sftp .sftp-pager button:last-child')?.disabled
    };
    sftpState = previousState;
    sftpDirectorySizeCache.clear();
    previousDirectorySizes.forEach(([key,value])=>sftpDirectorySizeCache.set(key,value));
    view.innerHTML = previousHtml;
    view.hidden = previousHidden;
    openSftp = previousOpen;
    previewSftpText = previousPreview;
    hideActionMenu();
    return result;
    } catch (error) {
      return {error:error?.stack || error?.message || String(error)};
    }
  })()`);
  console.log("[ui-smoke] clipboard and themes");
  const previousClipboard = clipboard.readText();
  window.setAlwaysOnTop(true);
  window.show();
  window.focus();
  window.webContents.focus();
  await new Promise(resolve => setTimeout(resolve, 120));
  const clipboardFixture = JSON.stringify(`TunnelDesk clipboard smoke ${Date.now()}`);
  const clipboardUi = await window.webContents.executeJavaScript(`(async()=>{
    return Promise.race([
      (async()=>{
        try {
          const expected = ${clipboardFixture};
          await writeClipboardText(expected);
          return {ok:true};
        } catch (error) {
          return {ok:false,error:error.message};
        }
      })(),
      new Promise(resolve=>setTimeout(()=>resolve({ok:false,error:'clipboard timeout'}),3000))
    ]);
  })()`);
  clipboard.writeText(previousClipboard);
  if (process.env.TUNNELDESK_UI_NOTIFICATION_SCREENSHOT === "1") {
    window.setContentSize(1180, 760);
    window.show();
    await window.webContents.executeJavaScript(`(() => {
      const connectionId = Number(connections?.[0]?.id || 1);
      updateSftpTaskFloat([{
        id:'notification-screenshot-job',
        status:'running',
        type:'upload',
        phase:'uploading',
        label:'上传 TunnelDesk-notification-check.bin',
        connection_id:connectionId,
        connection_name:'SFTP 测试连接',
        size:32 * 1024 * 1024,
        transferred:19 * 1024 * 1024,
        progress:59,
        speed_bps:6.6 * 1024 * 1024
      }]);
      notify('SFTP 提示图标检查\\n成功、提示和错误使用同一套居中布局', 'info');
    })()`);
    await new Promise(resolve => setTimeout(resolve, 160));
    const notificationImage = await window.webContents.capturePage();
    require("node:fs").writeFileSync(path.join(process.cwd(), "data", "ui-smoke-notifications.png"), notificationImage.toPNG());
    await window.webContents.executeJavaScript("dismissToast(); updateSftpTaskFloat([])");
  }
  window.setAlwaysOnTop(false);
  if (process.env.TUNNELDESK_UI_SCREENSHOT !== "1") window.hide();
  const dark = await window.webContents.executeJavaScript(`(async () => {
    const testStyle = document.createElement('style');
    testStyle.textContent = '*{transition:none!important}';
    document.head.appendChild(testStyle);
    applyTheme('dark');
    await new Promise(resolve => setTimeout(resolve, 50));
    const button = document.querySelector('button');
    const style = getComputedStyle(button);
    const root = getComputedStyle(document.documentElement);
    const result = {theme:document.documentElement.dataset.theme,panel:root.getPropertyValue('--panel').trim(),buttonPanel:style.getPropertyValue('--panel').trim(),buttonBackground:style.backgroundColor,buttonColor:style.color};
    applyTheme('light');
    testStyle.remove();
    return result;
  })()`);
  if (process.env.TUNNELDESK_UI_SCREENSHOT === "1") {
    const image = await window.webContents.capturePage();
    require("node:fs").writeFileSync(path.join(process.cwd(), "data", "ui-smoke-desktop.png"), image.toPNG());
  }
  console.log("[ui-smoke] mobile layout");
  window.setContentSize(390, 844);
  let mobileViewportReady = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    mobileViewportReady = await window.webContents.executeJavaScript("window.innerWidth <= 760 && isMobileLayout()");
    if (mobileViewportReady) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!mobileViewportReady) {
    const viewport = await window.webContents.executeJavaScript("({width:window.innerWidth,mobile:isMobileLayout()})");
    throw new Error(`Mobile viewport did not become ready: ${JSON.stringify(viewport)}`);
  }
  const mobile = await window.webContents.executeJavaScript(`(async()=>{
    document.documentElement.dataset.uiSmokeStage='mobile-sftp';
    const leftPane=document.querySelector('.left-pane');
    const content=document.querySelector('#content');
    const mobileWorkspaceVisible=()=>leftPane?.classList.contains('mobile-hide')&&content?.classList.contains('mobile-show');
    const mobileExplorerVisible=()=>!leftPane?.classList.contains('mobile-hide')&&!content?.classList.contains('mobile-show');
    const workspaceStateSurvivesResize=(input,value)=>{
      if(!input)return false;
      const viewBefore=activeView;
      const tabBefore=activeTabKey;
      input.value=value;
      input.focus();
      window.dispatchEvent(new Event('resize'));
      return mobileWorkspaceVisible()&&document.activeElement===input&&input.value===value&&activeView===viewBefore&&activeTabKey===tabBefore;
    };
    const mobileSftpLoad = loadSftpPage;
    const mobileSftpJobs = refreshSftpJobs;
    const mobileSftpTimer = startSftpJobsTimer;
    loadSftpPage = async () => true;
    refreshSftpJobs = async () => {};
    startSftpJobsTimer = () => {};
    localStorage.removeItem(SFTP_MOBILE_TOOLBAR_EXPANDED_KEY);
    document.querySelector('#view-sftp').dataset.sftpTabKey='';
    await openSftp(connections[0].id, '.', true);
    document.documentElement.dataset.uiSmokeStage='mobile-import';
    const mobileSftpToolbarMount = document.querySelector('#view-sftp #sftpToolbarMount');
    const mobileSftpToolbarToggle = document.querySelector('#view-sftp #sftpMobileToolbarToggle');
    const mobileSftpBreadcrumb = document.querySelector('#view-sftp #sftpBreadcrumb');
    const mobileSftpToolbarDefaultCollapsed = Boolean(mobileSftpToolbarMount?.hidden);
    const mobileSftpToolbarToggleVisible = Boolean(mobileSftpToolbarToggle?.getBoundingClientRect().width);
    const mobileSftpBreadcrumbAlwaysVisible = Boolean(mobileSftpBreadcrumb?.getBoundingClientRect().width);
    mobileSftpToolbarToggle?.click();
    const mobileSftpActions = document.querySelector('#view-sftp .sftp-toolbar');
    const mobileSftpActionNodes = [...(mobileSftpActions?.querySelectorAll('.sftp-toolbar-actions > button, .sftp-toolbar-actions > label') || [])];
    const mobileSftpActionRects = mobileSftpActionNodes.map(node => node.getBoundingClientRect());
    const mobileSftpActionTitles = mobileSftpActionNodes.map(node => node.title || node.getAttribute('aria-label') || '');
    const expectedMobileSftpActions = ['收藏当前目录','新建文件夹','新建文件','上传文件','SFTP 回收站','搜索当前目录','切换 SFTP 文件名编码','打开此连接的终端','刷新目录','SFTP 全局设置'];
    const mobileSftpLayout = {
      found:Boolean(mobileSftpActions),
      fits:Boolean(mobileSftpActions && mobileSftpActions.scrollWidth <= mobileSftpActions.clientWidth + 0.5),
      encodingVisible:Boolean(document.querySelector('#sftpFilenameEncodingButton')?.getBoundingClientRect().width),
      terminalJumpVisible:Boolean(mobileSftpActions?.querySelector('button[title="打开此连接的终端"]')?.getBoundingClientRect().width),
      allActionsVisible:expectedMobileSftpActions.every(title => mobileSftpActionTitles.includes(title)) && mobileSftpActionRects.every(rect => rect.width > 0 && rect.height > 0),
      uniformButtons:mobileSftpActionRects.every(rect => Math.abs(rect.width - 38) <= 0.5 && Math.abs(rect.height - 38) <= 0.5),
      wrapsCompletely:mobileSftpActions?.querySelector('.sftp-toolbar-actions')?.scrollWidth <= mobileSftpActions?.querySelector('.sftp-toolbar-actions')?.clientWidth + 0.5,
      defaultCollapsed:mobileSftpToolbarDefaultCollapsed,
      toggleVisible:mobileSftpToolbarToggleVisible,
      breadcrumbAlwaysVisible:mobileSftpBreadcrumbAlwaysVisible,
      expandedPersisted:localStorage.getItem(SFTP_MOBILE_TOOLBAR_EXPANDED_KEY) === '1' && !mobileSftpToolbarMount?.hidden,
      searchFontSize:parseFloat(getComputedStyle(document.querySelector('#sftpSearch')).fontSize)
    };
    toggleSftpSearch();
    const sftpWorkspaceAfterKeyboardResize=workspaceStateSurvivesResize(document.querySelector('#sftpSearch'),'mobile-resize-sftp');
    closeSftpSearch();
    loadSftpPage = mobileSftpLoad;
    refreshSftpJobs = mobileSftpJobs;
    startSftpJobsTimer = mobileSftpTimer;
    openBatchCommand(false);
    const batchCommandFontSize=parseFloat(getComputedStyle(document.querySelector('#batchCommandText')).fontSize);
    const batchWorkspaceAfterKeyboardResize=workspaceStateSurvivesResize(document.querySelector('#batchCommandText'),'printf mobile-resize-batch');
    newConnection();
    const connectionNameFontSize=parseFloat(getComputedStyle(document.querySelector('#conn_name')).fontSize);
    const connectionWorkspaceAfterKeyboardResize=workspaceStateSurvivesResize(document.querySelector('#conn_name'),'mobile-resize-connection');
    showPrimary('import');
    window.dispatchEvent(new Event('resize'));
    await new Promise(resolve=>setTimeout(resolve,80));
    const importExplorerFirst=mobileExplorerVisible();
    document.querySelector('#explorerTools [data-explorer-section="import-source"]')?.click();
    for(let i=0;i<40&&(activeView!=='import'||!content?.classList.contains('mobile-show'));i+=1)await new Promise(resolve=>setTimeout(resolve,25));
    const layout={
      width:document.documentElement.clientWidth,
      scrollWidth:document.documentElement.scrollWidth,
      bodyWidth:document.body.scrollWidth,
      mobileNav:getComputedStyle(document.querySelector('.mobile-tabs')).display,
      contentVisible:getComputedStyle(content).display,
      active:document.querySelector('.mobile-tabs .active')?.getAttribute('aria-label')||'',
      importExplorerFirst,
      importWorkspaceEntered:leftPane?.classList.contains('mobile-hide')&&content?.classList.contains('mobile-show'),
      sftp:mobileSftpLayout,
      workspaceFormFonts:{
        sftpSearch:mobileSftpLayout.searchFontSize,
        batchCommand:batchCommandFontSize,
        connectionName:connectionNameFontSize,
        preventsFocusZoom:[mobileSftpLayout.searchFontSize,batchCommandFontSize,connectionNameFontSize].every(size=>size>=16)
      },
      workspaceResizeNavigation:{
        sftpStaysInWorkspace:sftpWorkspaceAfterKeyboardResize,
        batchStaysInWorkspace:batchWorkspaceAfterKeyboardResize,
        connectionFormStaysInWorkspace:connectionWorkspaceAfterKeyboardResize,
        explicitExplorerStaysVisible:importExplorerFirst
      }
    };
    const mobileTabs=document.querySelector('.mobile-tabs');
    const mobileTabItems=[...mobileTabs.querySelectorAll('button, a')];
    const mobileTabLabels=[...mobileTabs.querySelectorAll('.mobile-tab-label')];
    const mobileTabIcons=mobileTabItems.map(item=>item.querySelector('svg'));
    const mobileTabRects=mobileTabItems.map(item=>item.getBoundingClientRect());
    layout.mobileTabs={
      count:mobileTabItems.length,
      labelsHidden:mobileTabLabels.every(label=>getComputedStyle(label).display==='none'),
      iconsCentered:mobileTabIcons.every((svg,index)=>{const icon=svg?.getBoundingClientRect();const rect=mobileTabRects[index];return Boolean(icon&&rect&&Math.abs((icon.left+icon.width/2)-(rect.left+rect.width/2))<0.5&&Math.abs((icon.top+icon.height/2)-(rect.top+rect.height/2))<0.5)}),
      fits:mobileTabs.scrollWidth<=mobileTabs.clientWidth+0.5&&mobileTabRects.every(rect=>rect.left>=-0.5&&rect.right<=innerWidth+0.5)
    };
    document.documentElement.dataset.uiSmokeStage='mobile-settings';
    showPrimary('settings');
    await new Promise(resolve=>setTimeout(resolve,80));
    const settingsButtons=[...document.querySelectorAll('#explorerTools > button[data-explorer-section]')];
    const settingsLabels=settingsButtons.map(button=>button.querySelector('span')?.textContent.trim()||'');
    const settingsRects=settingsButtons.map(button=>button.getBoundingClientRect());
    const settingsVertical=settingsRects.every((rect,index)=>index===0||rect.top>=settingsRects[index-1].bottom-0.5)&&settingsRects.every(rect=>Math.abs(rect.left-settingsRects[0].left)<1&&Math.abs(rect.width-settingsRects[0].width)<1);
    const settingsExplorerFirst=!leftPane?.classList.contains('mobile-hide')&&!content?.classList.contains('mobile-show');
    document.querySelector('#explorerTools [data-explorer-section="settings-about"]')?.click();
    for (let i=0;i<80&&(activeView!=='settings'||!document.querySelector('#settings-about')||document.querySelector('#settings-about').hidden||!content?.classList.contains('mobile-show'));i+=1) await new Promise(resolve=>setTimeout(resolve,50));
    const visibleSettingsGroups=[...document.querySelectorAll('#view-settings .settings-group')].filter(group=>!group.hidden).map(group=>group.id);
    layout.settingsNavigation={
      labels:settingsLabels,
      vertical:settingsVertical,
      explorerFirst:settingsExplorerFirst,
      workspaceEntered:leftPane?.classList.contains('mobile-hide')&&content?.classList.contains('mobile-show'),
      selectedOnly:visibleSettingsGroups.length===1&&visibleSettingsGroups[0]==='settings-about',
      noDuplicateMenu:document.querySelectorAll('.settings-nav').length===0
    };
    document.documentElement.dataset.uiSmokeStage='mobile-license';
    const licenseTrigger=document.querySelector('#openLicenseBtn');
    licenseTrigger?.click();
    for (let i=0;i<20&&document.querySelector('#modal')?.hidden;i+=1) await new Promise(resolve=>setTimeout(resolve,25));
    const modal=document.querySelector('#modal');
    const card=modal?.querySelector('.license-modal');
    const text=modal?.querySelector('#licenseText');
    const close=document.querySelector('#licenseModalClose');
    const cardRect=card?.getBoundingClientRect();
    const textRect=text?.getBoundingClientRect();
    const closeRect=close?.getBoundingClientRect();
    layout.about={
      modalOpen:Boolean(modal&&!modal.hidden&&card),
      cardWithinViewport:Boolean(cardRect&&cardRect.left>=-0.5&&cardRect.right<=innerWidth+0.5&&cardRect.top>=-0.5&&cardRect.bottom<=innerHeight+0.5),
      textWithinCard:Boolean(cardRect&&textRect&&textRect.left>=cardRect.left-0.5&&textRect.right<=cardRect.right+0.5),
      textScrollable:Boolean(text&&text.scrollHeight>text.clientHeight&&getComputedStyle(text).overflowY==='auto'),
      closeVisible:Boolean(closeRect&&closeRect.width>0&&closeRect.height>0&&closeRect.top>=-0.5&&closeRect.bottom<=innerHeight+0.5)
    };
    close?.click();
    await new Promise(resolve=>setTimeout(resolve,25));
    layout.about.closed=Boolean(modal?.hidden&&!modal.querySelector('.license-modal'));
    document.documentElement.dataset.uiSmokeStage='mobile-groups';
    showPrimary('connections');
    if(!document.querySelector('.conn-row'))document.querySelector('.group-head')?.click();
    const groupActionButton=document.querySelector('.connection-group-menu-button');
    const groupDragHandle=document.querySelector('.connection-group-drag-handle');
    const groupTitle=document.querySelector('.connection-group-head-row .group-head');
    const actionRect=groupActionButton?.getBoundingClientRect();
    const dragRect=groupDragHandle?.getBoundingClientRect();
    const titleRect=groupTitle?.getBoundingClientRect();
    layout.groupControlsInline=Boolean(actionRect&&dragRect&&titleRect&&Math.abs((actionRect.top+actionRect.height/2)-(dragRect.top+dragRect.height/2))<2&&Math.abs((actionRect.top+actionRect.height/2)-(titleRect.top+titleRect.height/2))<2);
    layout.groupDragFirst=Boolean(actionRect&&dragRect&&titleRect&&dragRect.left<titleRect.left&&titleRect.left<actionRect.left);
    const previousSaveConnectionGroupOrder=saveConnectionGroupOrder;
    let groupOrderSaveCalls=0;
    saveConnectionGroupOrder=async()=>{groupOrderSaveCalls+=1;};
    groupDragHandle?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:77,pointerType:'touch',button:0,clientX:dragRect?.left||10,clientY:dragRect?.top||10}));
    await new Promise(resolve=>setTimeout(resolve,500));
    const draggingNode=document.querySelector('.group-dragging');
    renderConnections();
    await new Promise(resolve=>setTimeout(resolve,1800));
    layout.groupDragSurvivesRefresh=Boolean(draggingNode&&draggingNode.isConnected&&draggingNode.classList.contains('group-dragging'));
    document.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:77,pointerType:'touch'}));
    await new Promise(resolve=>setTimeout(resolve,30));
    layout.groupCancelDoesNotSave=!document.querySelector('.group-dragging')&&groupOrderSaveCalls===0;
    saveConnectionGroupOrder=previousSaveConnectionGroupOrder;
    const refreshedGroupActionButton=document.querySelector('.connection-group-menu-button');
    layout.groupActionVisible=Boolean(refreshedGroupActionButton&&getComputedStyle(refreshedGroupActionButton).opacity==='1'&&refreshedGroupActionButton.getBoundingClientRect().width>0);
    refreshedGroupActionButton?.click();
    layout.groupActionMenuOpened=Boolean(document.querySelector('#actionMenu')?.textContent.includes('重命名分组')&&document.querySelector('#actionMenuBackdrop'));
    document.querySelector('#actionMenuBackdrop')?.click();
    document.querySelector('.conn-actions .icon-button')?.click();
    layout.menuOpened=Boolean(document.querySelector('#actionMenu')&&document.querySelector('#actionMenuBackdrop'));
    document.querySelector('#actionMenuBackdrop')?.click();
    layout.menuClosed=!document.querySelector('#actionMenu')&&!document.querySelector('#actionMenuBackdrop');
    document.documentElement.dataset.uiSmokeStage='mobile-terminal-back';
    const terminalBackFixture=document.createElement('div');
    terminalBackFixture.className='terminal-toolbar';
    terminalBackFixture.innerHTML='<div class="terminal-title-row"><button class="terminal-mobile-back" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="backToExplorer()">'+icon('arrow-left')+'<span>返回</span></button><span class="terminal-connection-dot"></span><span class="terminal-status">root@example.invalid:22 · 已连接</span><span class="terminal-latency good">延迟 5 ms</span></div><div class="actions terminal-actions"><button class="terminal-action-sftp">'+icon('folder-open')+'<span>SFTP</span></button><button class="terminal-action-keys">'+icon('keyboard')+'<span>快捷键</span></button><button class="terminal-action-reconnect">'+icon('refresh-cw')+'<span>重连</span></button><button class="terminal-action-forward">'+icon('play')+'<span>转发</span></button><button class="terminal-global-settings-button">'+icon('settings')+'</button></div>';
    document.body.appendChild(terminalBackFixture);
    document.querySelector('.left-pane')?.classList.add('mobile-hide');
    document.querySelector('#content')?.classList.add('mobile-show');
    document.body.classList.add('mobile-terminal-active');
    const terminalBackButton=terminalBackFixture.querySelector('.terminal-mobile-back');
    const terminalBackStyle=getComputedStyle(terminalBackButton);
    const terminalBackRect=terminalBackButton.getBoundingClientRect();
    const terminalMobileToolbarRect=terminalBackFixture.getBoundingClientRect();
    const terminalMobileTitleRect=terminalBackFixture.querySelector('.terminal-title-row').getBoundingClientRect();
    const terminalMobileActionsRect=terminalBackFixture.querySelector('.terminal-actions').getBoundingClientRect();
    const terminalMobileSftpButton=terminalBackFixture.querySelector('.terminal-action-sftp');
    const terminalBackVisible=terminalBackStyle.display!=='none'&&terminalBackRect.width>0&&terminalBackRect.height>0;
    showTerminalFontMenu(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:180,clientY:100}),'mobile-font-smoke',connections[0].id);
    const mobileFontMenu=document.querySelector('#actionMenu');
    if (!(mobileFontMenu instanceof HTMLElement)) throw new Error('Mobile terminal font menu was not created');
    const mobileFontMenuRect=mobileFontMenu.getBoundingClientRect();
    const mobileFontClose=mobileFontMenu.querySelector('.action-menu-close');
    if (!(mobileFontClose instanceof HTMLElement)) throw new Error('Mobile terminal font menu is missing its close button');
    const mobileFontButtons=[...mobileFontMenu.querySelectorAll('button')];
    layout.terminalFontMenu={
      opened:Boolean(mobileFontMenu&&document.querySelector('#actionMenuBackdrop')),
      withinViewport:Boolean(mobileFontMenuRect&&mobileFontMenuRect.left>=-0.5&&mobileFontMenuRect.right<=innerWidth+0.5&&mobileFontMenuRect.top>=-0.5&&mobileFontMenuRect.bottom<=innerHeight+0.5),
      compact:Boolean(mobileFontMenuRect&&mobileFontMenuRect.height<=innerHeight*0.69),
      scrollable:Boolean(mobileFontMenu&&mobileFontMenu.scrollHeight>mobileFontMenu.clientHeight&&getComputedStyle(mobileFontMenu).overflowY==='auto'),
      closeSticky:getComputedStyle(mobileFontClose).position==='sticky',
      touchTargets:mobileFontButtons.every(button=>button.getBoundingClientRect().height>=39.5)
    };
    hideActionMenu();
    const previousGlobalTerminalSettings=terminalGlobalSettings;
    terminalGlobalSettings=normalizeTerminalGlobalSettings(defaultTerminalGlobalSettings);
    const mobileGlobalSettingsButton=terminalBackFixture.querySelector('.terminal-global-settings-button');
    layout.terminalGlobalSettings={
      buttonHidden:Boolean(mobileGlobalSettingsButton&&getComputedStyle(mobileGlobalSettingsButton).display==='none')
    };
    const longPressKey='mobile-terminal-long-press-smoke';
    const longPressMount=document.createElement('div');
    longPressMount.className='terminal-box';
    longPressMount.style.cssText='position:fixed;left:0;top:0;width:300px;height:160px;z-index:-1';
    const longPressScreen=document.createElement('div');
    longPressScreen.className='xterm-screen';
    longPressScreen.style.cssText='width:300px;height:160px';
    longPressMount.appendChild(longPressScreen);
    document.body.appendChild(longPressMount);
    const longPressLine='root command';
    let longPressSelection='';
    let longPressRange=null;
    const longPressTerm={
      options:{},
      rows:8,
      cols:30,
      element:longPressMount,
      hasSelection:()=>Boolean(longPressSelection),
      getSelection:()=>longPressSelection,
      select:(column,row,length)=>{
        longPressRange={column,row,length};
        longPressSelection=longPressLine.slice(column,column+length);
      },
      clearSelection:()=>{longPressSelection='';},
      selectAll:()=>{},
      clear:()=>{},
      focus:()=>{},
      scrollLines:()=>{},
      scrollToBottom:()=>{},
      refresh:()=>{},
      buffer:{active:{viewportY:0,length:1,getLine:()=>({translateToString:()=>longPressLine,getCell:index=>({getChars:()=>longPressLine[index]||''})})}}
    };
    longPressTerm._core={_renderService:{dimensions:{css:{cell:{width:10,height:20}}}}};
    terminalSessions.set(longPressKey,{term:longPressTerm,id:connections[0].id});
    terminalGlobalSettings=normalizeTerminalGlobalSettings({...defaultTerminalGlobalSettings,right_mouse_action:'paste_clipboard'});
    bindTerminalGlobalBehavior(terminalSessions.get(longPressKey),longPressKey,connections[0].id,longPressMount);
    longPressMount.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:15,clientY:10}));
    const longPressMenuLabels=[...document.querySelectorAll('#actionMenu button span')].map(item=>item.textContent.trim());
    const longPressMenuOpened=Boolean(document.querySelector('#actionMenu')&&document.querySelector('#actionMenuBackdrop')&&longPressMenuLabels.includes('光标复制')&&longPressMenuLabels.includes('会话复制')&&longPressMenuLabels.includes('粘贴')&&!longPressMenuLabels.includes('复制选中')&&!longPressMenuLabels.includes('全选终端')&&!longPressMenuLabels.includes('全局终端设置'));
    const longPressOnlyOpensMenu=longPressSelection==='';
    hideActionMenu();
    showTerminalSessionText(longPressKey);
    const sessionTextModal=document.querySelector('#modal .terminal-session-text-modal');
    const sessionTextModalRect=sessionTextModal?.getBoundingClientRect();
    const sessionTextEditor=document.querySelector('#terminalSessionTextEditor');
    const sessionTextStyle=sessionTextEditor?getComputedStyle(sessionTextEditor):null;
    document.querySelector('#modal')?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    layout.terminalSessionText={
      open:Boolean(sessionTextModal&&sessionTextEditor&&!document.querySelector('#modal')?.hidden),
      withinViewport:Boolean(sessionTextModalRect&&sessionTextModalRect.left>=-0.5&&sessionTextModalRect.right<=innerWidth+0.5&&sessionTextModalRect.top>=-0.5&&sessionTextModalRect.bottom<=innerHeight+0.5),
      selectable:Boolean(sessionTextEditor?.readOnly&&sessionTextStyle?.userSelect==='text'),
      scrollable:sessionTextStyle?.overflowY==='auto',
      fullText:sessionTextEditor?.value===longPressLine,
      copyAll:Boolean(document.querySelector('#terminalSessionTextCopy')),
      backdropIgnored:Boolean(!document.querySelector('#modal')?.hidden)
    };
    let sessionTextCopied='';
    const originalSessionTextCopy=copyText;
    copyText=async text=>{sessionTextCopied=text;return true;};
    document.querySelector('#terminalSessionTextCopy')?.click();
    await new Promise(resolve=>setTimeout(resolve,0));
    copyText=originalSessionTextCopy;
    layout.terminalSessionText.copyAllWorks=sessionTextCopied===longPressLine&&document.querySelector('#modal')?.hidden===true;
    let cursorCopied='';
    const originalCopyText=copyText;
    copyText=async text=>{cursorCopied=text;return true;};
    startTerminalCursorCopy(longPressKey);
    const cursorHintStarted=Boolean(terminalSessions.get(longPressKey)?.cursorCopyState&&longPressMount.classList.contains('terminal-cursor-copy-active')&&!document.querySelector('.terminal-cursor-copy-hint'));
    longPressMount.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:11,pointerType:'touch',clientX:5,clientY:10}));
    longPressMount.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:11,pointerType:'touch',clientX:5,clientY:10}));
    longPressMount.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:11,pointerType:'touch',clientX:5,clientY:10}));
    const cursorStartStored=terminalSessions.get(longPressKey)?.cursorCopyState?.phase==='end';
    longPressMount.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:12,pointerType:'touch',clientX:5,clientY:10}));
    longPressMount.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:12,pointerType:'touch',clientX:115,clientY:10}));
    const cursorSelectionBlue=longPressTerm.options.theme?.selectionBackground==='#2563eb'&&longPressSelection===longPressLine;
    longPressMount.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:12,pointerType:'touch',clientX:115,clientY:10}));
    await new Promise(resolve=>setTimeout(resolve,0));
    copyText=originalCopyText;
    const cursorCopyCompleted=cursorCopied===longPressLine&&!terminalSessions.get(longPressKey)?.cursorCopyState&&!document.querySelector('.terminal-cursor-copy-cancel');
    const clipboardDescriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard');
    let clipboardFallback=false;
    try {
      Object.defineProperty(navigator,'clipboard',{value:undefined,configurable:true});
      const fallbackPromise=pasteTerminalText(longPressKey);
      await new Promise(resolve=>setTimeout(resolve,0));
      const fallbackEditor=document.querySelector('#terminalPasteEditor');
      clipboardFallback=Boolean(fallbackEditor&&document.activeElement===fallbackEditor);
      document.querySelector('#terminalPasteCancel')?.click();
      clipboardFallback=clipboardFallback&&(await fallbackPromise)===false;
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator,'clipboard',clipboardDescriptor);
      else delete navigator.clipboard;
    }
    layout.terminalLongPress={
      menuOnly:longPressOnlyOpensMenu,
      menuOpened:longPressMenuOpened,
      cursorHintStarted,
      cursorStartStored,
      cursorSelectionBlue,
      cursorCopyCompleted,
      clipboardFallback
    };
    terminalSessions.delete(longPressKey);
    longPressMount.remove();
    const mobilePastePromise=sendTerminalPasteText('mobile-terminal-paste-smoke','first command\\nsecond command');
    await new Promise(resolve=>setTimeout(resolve,0));
    const mobilePasteModal=document.querySelector('#modal .terminal-paste-modal');
    const mobilePasteModalRect=mobilePasteModal?.getBoundingClientRect();
    const mobilePasteEditor=document.querySelector('#terminalPasteEditor');
    const mobilePasteActions=document.querySelector('.terminal-paste-actions');
    const mobilePasteActionsVisible=Boolean(mobilePasteActions&&[...mobilePasteActions.querySelectorAll('button')].every(button=>{const rect=button.getBoundingClientRect();return rect.top>=-0.5&&rect.bottom<=innerHeight+0.5}));
    document.querySelector('#modal')?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    const mobilePasteBackdropIgnored=Boolean(!document.querySelector('#modal')?.hidden&&mobilePasteEditor?.isConnected);
    document.querySelector('#terminalPasteCancel')?.click();
    const mobilePasteCancelled=(await mobilePastePromise)===false;
    layout.terminalPasteEditor={
      open:Boolean(mobilePasteModal&&mobilePasteEditor),
      withinViewport:Boolean(mobilePasteModalRect&&mobilePasteModalRect.left>=-0.5&&mobilePasteModalRect.right<=innerWidth+0.5&&mobilePasteModalRect.top>=-0.5&&mobilePasteModalRect.bottom<=innerHeight+0.5),
      editable:Boolean(mobilePasteEditor&&!mobilePasteEditor.readOnly),
      actionsVisible:mobilePasteActionsVisible,
      backdropIgnored:mobilePasteBackdropIgnored,
      cancelled:mobilePasteCancelled
    };
    terminalGlobalSettings=previousGlobalTerminalSettings;
    terminalBackButton.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerType:'touch'}));
    terminalBackButton.click();
    layout.terminalBack={
      visible:terminalBackVisible,
      display:terminalBackStyle.display,
      compactToolbar:terminalMobileTitleRect.height<=48&&terminalMobileToolbarRect.height<=96&&terminalMobileActionsRect.top>=terminalMobileTitleRect.bottom-0.5,
      titleHeight:terminalMobileTitleRect.height,
      toolbarHeight:terminalMobileToolbarRect.height,
      priorityOrder:[...terminalBackFixture.querySelectorAll('.terminal-action-reconnect,.terminal-action-keys,.terminal-action-forward,.terminal-action-sftp')].sort((left,right)=>Number(getComputedStyle(left).order)-Number(getComputedStyle(right).order)).map(button=>button.className.match(/terminal-action-(reconnect|keys|forward|sftp)/)?.[1]),
      sftpTextFits:Boolean(terminalMobileSftpButton && terminalMobileSftpButton.clientWidth >= 82 && terminalMobileSftpButton.scrollWidth <= terminalMobileSftpButton.clientWidth + 1 && terminalMobileSftpButton.textContent.trim() === 'SFTP'),
      globalSettingsHidden:getComputedStyle(mobileGlobalSettingsButton).display==='none',
      returned:!document.querySelector('.left-pane')?.classList.contains('mobile-hide')&&!document.querySelector('#content')?.classList.contains('mobile-show')&&!document.body.classList.contains('mobile-terminal-active')
    };
    terminalBackFixture.remove();
    document.documentElement.dataset.uiSmokeStage='mobile-complete';
    return layout
  })()`);
  if (process.env.TUNNELDESK_UI_SCREENSHOT === "1") {
    const image = await window.webContents.capturePage();
    require("node:fs").writeFileSync(path.join(process.cwd(), "data", "ui-smoke-mobile.png"), image.toPNG());
  }
  console.log(JSON.stringify({ ...result, refreshStateUi, workspaceTabDragUi, pages, navigationUi, aboutUi, desktopMenu, runningActions, authUi, saveAndClearUi, notificationUi, restoreKeyUi, restoreCredentialUi, terminalUi, logSettingsUi, sftpUi, clipboardUi, dark, mobile, errors }, null, 2));
  const overflow = pages.some(page => page.scrollWidth > page.width) || mobile.scrollWidth > mobile.width || mobile.bodyWidth > mobile.width;
  const darkFailed = dark.theme !== "dark" || dark.buttonBackground === "rgb(255, 255, 255)";
  const menuFailed = !desktopMenu.opened || !desktopMenu.closedOnScroll || !mobile.menuOpened || !mobile.menuClosed;
  const refreshStateUiFailed = !refreshStateUi.found || !refreshStateUi.collapsedBeforeRefresh || !refreshStateUi.collapsedAfterRefresh || !refreshStateUi.collapsePersisted || !refreshStateUi.explicitSelectionReopens || !refreshStateUi.runningCountLive || !refreshStateUi.failureCountLive || !refreshStateUi.oldStartupLabelsRemoved;
  const workspaceTabDragUiFailed = !workspaceTabDragUi.beganImmediately || !workspaceTabDragUi.activatedOnPress || !workspaceTabDragUi.dragGhostVisible || !workspaceTabDragUi.dropPositionVisible || !workspaceTabDragUi.dragGhostRemoved || !workspaceTabDragUi.touchReady || !workspaceTabDragUi.commonTitleFits || !workspaceTabDragUi.numberedSessionTitleFits || !workspaceTabDragUi.compactTabFont || !workspaceTabDragUi.shortTabUsesContentWidth || !workspaceTabDragUi.fullTitleTooltip || JSON.stringify(workspaceTabDragUi.liveOrder) !== JSON.stringify(['drag-b','drag-c','drag-a']) || JSON.stringify(workspaceTabDragUi.savedOrder) !== JSON.stringify(['drag-b','drag-c','drag-a']) || JSON.stringify(workspaceTabDragUi.persistedOrder) !== JSON.stringify(['drag-b','drag-c','drag-a']) || !workspaceTabDragUi.activeFollowsDragged || !workspaceTabDragUi.clickSuppressed || !workspaceTabDragUi.cancelStarted || !workspaceTabDragUi.cancelRestored || !workspaceTabDragUi.closeDoesNotDrag || !workspaceTabDragUi.fallbackMove || !workspaceTabDragUi.scrollControlsVisible || !workspaceTabDragUi.scrollControlsHideWhenFit || !workspaceTabDragUi.nativeScrollbarHidden || !workspaceTabDragUi.wheelScrollsTabs;
  const runningActionsFailed = runningActions.found && (Math.abs(runningActions.open.width - runningActions.retry.width) > 1 || Math.abs(runningActions.open.height - runningActions.retry.height) > 1);
  const authUiFailed = !authUi.found || !Object.values(authUi.passwordMode).every(Boolean) || !Object.values(authUi.keyMode).every(Boolean);
  const saveAndClearUiFailed = !Object.values(saveAndClearUi).every(Boolean);
  const notificationUiFailed = notificationUi.replayed !== 0 || !notificationUi.initialized || notificationUi.cursor !== notificationUi.stored;
  const restoreKeyUiFailed = !restoreKeyUi.opened || restoreKeyUi.rowCount !== 12 || JSON.stringify(restoreKeyUi.originalNames) !== JSON.stringify(['old-key-a','old-key-b']) || restoreKeyUi.candidates.length !== 3 || !restoreKeyUi.candidates.some(item=>item.includes('当前密钥目录')) || !restoreKeyUi.candidates.some(item=>item.includes('用户 ~/.ssh')) || !restoreKeyUi.candidateValuePreserved || !restoreKeyUi.stagesWindowsPath || !restoreKeyUi.backdropIgnored || !restoreKeyUi.continuedWithUnbound || !restoreKeyUi.continuedAllUnbound || !restoreKeyUi.configAllowsUnbound || !restoreKeyUi.configSortEditable || !restoreKeyUi.acceptsAll || !restoreKeyUi.uploadDirectory || !restoreKeyUi.actions || !restoreKeyUi.statusReady || !restoreKeyUi.cardWithinViewport || !restoreKeyUi.closed;
  const restoreCredentialUiFailed = !restoreCredentialUi.opened || !restoreCredentialUi.backdropIgnored || !restoreCredentialUi.originalLabels.some(item=>item.includes('私钥：id_old')) || !restoreCredentialUi.originalLabels.some(item=>item.includes('备份含密码')) || !restoreCredentialUi.originalLabels.some(item=>item.includes('备份未包含密码')) || !restoreCredentialUi.initialStatuses.includes('保留备份密码') || !restoreCredentialUi.stagedStatuses.some(item=>item.includes('将绑定：id_key')) || !restoreCredentialUi.stagedStatuses.includes('将使用新密码') || !restoreCredentialUi.preservesSavedPassword || !restoreCredentialUi.replacesMissingPassword || !restoreCredentialUi.bindsKey || !restoreCredentialUi.sortFields || !restoreCredentialUi.updatesSort || !restoreCredentialUi.preservesSort || !restoreCredentialUi.cardWithinViewport || !restoreCredentialUi.closed;
  const settingsSectionsFailed = navigationUi.settingsChecks.some(item=>item.visible.length!==1||item.visible[0]!==item.requested||item.active.length!==1||item.active[0]!==item.requested) || navigationUi.aboutVisible?.length!==1 || navigationUi.aboutVisible?.[0]!=='settings-about' || navigationUi.aboutActive?.length!==1 || navigationUi.aboutActive?.[0]!=='settings-about';
  const importSectionsFailed = navigationUi.importChecks.some(item=>item.visible.length!==1||item.visible[0]!==item.requested||item.active.length!==1||item.active[0]!==item.requested);
  const importSourceCheck = navigationUi.importChecks.find(item => item.requested === 'import-source');
  const runtimeUi = navigationUi.runtimeUi || {};
  const sessionUi = navigationUi.sessionUi || {};
  const runtimeUiFailed = !runtimeUi.found || runtimeUi.port !== '18100' || JSON.stringify(runtimeUi.selectedHosts) !== JSON.stringify(['0.0.0.0']) || !runtimeUi.sftpSettingsAbsent || !runtimeUi.terminalLatencySettingChecked || !runtimeUi.wildcardCollapsed || runtimeUi.urlLinks.length !== 2 || !runtimeUi.urlLinks.some(url=>url.includes('192.0.2.10:18100')) || !runtimeUi.restartNotice;
  const sessionUiFailed = sessionUi.ttl !== '720' || sessionUi.max !== '1000' || sessionUi.cleanup !== '10' || !sessionUi.active || !sessionUi.save;
  const activityUiFailed = result.activity.count !== 9 || !result.activity.iconCentered || !result.activity.centersAligned || !result.activity.insideColumn || !result.activityUtilities;
  const navigationUiFailed = !navigationUi.settingsOnlySections || !navigationUi.settingsSectionMode || !navigationUi.settingsVertical || settingsSectionsFailed || runtimeUiFailed || sessionUiFailed || navigationUi.duplicateSettingsNav !== 0 || navigationUi.inlineUpdateDotPresent || !navigationUi.importOwnSections || !navigationUi.importSectionMode || !navigationUi.importVertical || !navigationUi.importResultsMerged || !importSourceCheck?.resultsVisible || importSectionsFailed || !navigationUi.treeHidden || navigationUi.dotsBeforeRead.some(dot=>!dot.found||dot.hidden!==false) || navigationUi.dotsAfterRead.some(dot=>!dot.found||dot.hidden!==true) || navigationUi.storedReadVersion !== '1.0.9' || !navigationUi.sameVersionStaysRead || !navigationUi.ignoredVersionHidesNotice || !navigationUi.newerAfterIgnoredShowsNotice || !navigationUi.newerVersionShowsAgain;
  const aboutUiFailed = Boolean(aboutUi.error) || !aboutUi.found || !aboutUi.aboutSelected || aboutUi.duplicateSettingsNav !== 0 || !aboutUi.versionMatches || !aboutUi.licenseMetadata || !aboutUi.sourceLink || !aboutUi.modalOpen || !aboutUi.accessible || !aboutUi.fullText || !aboutUi.textScrollable || !aboutUi.cardWithinViewport || !aboutUi.closeFocused || !aboutUi.backdropIgnored || !aboutUi.closedByEscape || !aboutUi.focusReturned || !aboutUi.followupBackdropClean || !aboutUi.followupResolved || !aboutUi.updateUi;
  const expectedSettingsActions = ['通用设置','安全设置','通知设置','启动与运行','关于'];
  const mobileResizeNavigationFailed = !mobile.workspaceResizeNavigation || !Object.values(mobile.workspaceResizeNavigation).every(Boolean);
  const mobileNavigationFailed = mobileResizeNavigationFailed || !mobile.importExplorerFirst || !mobile.importWorkspaceEntered || !mobile.sftp?.found || !mobile.sftp?.fits || !mobile.sftp?.encodingVisible || !mobile.sftp?.terminalJumpVisible || !mobile.sftp?.allActionsVisible || !mobile.sftp?.uniformButtons || !mobile.sftp?.wrapsCompletely || !mobile.sftp?.defaultCollapsed || !mobile.sftp?.toggleVisible || !mobile.sftp?.breadcrumbAlwaysVisible || !mobile.sftp?.expandedPersisted || !mobile.workspaceFormFonts?.preventsFocusZoom || !mobile.settingsNavigation?.explorerFirst || !mobile.settingsNavigation?.workspaceEntered || !mobile.settingsNavigation?.vertical || !mobile.settingsNavigation?.selectedOnly || !mobile.settingsNavigation?.noDuplicateMenu || JSON.stringify(mobile.settingsNavigation?.labels)!==JSON.stringify(expectedSettingsActions) || mobile.mobileTabs?.count !== 7 || !mobile.mobileTabs?.labelsHidden || !mobile.mobileTabs?.iconsCentered || !mobile.mobileTabs?.fits || !mobile.groupActionVisible || !mobile.groupActionMenuOpened || !mobile.groupControlsInline || !mobile.groupDragFirst || !mobile.groupCancelDoesNotSave || !mobile.groupDragSurvivesRefresh;
  const mobileAboutFailed = !mobile.about || !mobile.about.modalOpen || !mobile.about.cardWithinViewport || !mobile.about.textWithinCard || !mobile.about.textScrollable || !mobile.about.closeVisible || !mobile.about.closed;
  const terminalLabels = ['复制选中','光标复制','会话复制','粘贴','清屏','滚动到底部','断开连接','全局终端设置'];
  const terminalSettingsUi = terminalUi.terminalSettingsUi || {};
  const mobileTerminalSettingsUi = mobile.terminalGlobalSettings || {};
  const terminalUiFailed = !terminalUi.found || !terminalUi.desktopBackHidden || !terminalUi.desktopKeysHidden || terminalUi.binaryType !== 'arraybuffer' || !terminalUi.binaryWrite || !terminalUi.encodingMenuOpened || !terminalUi.fontMenuOpened || !terminalUi.statusHoverShowsFull || !terminalUi.desktopStatusAvoidsDuplicate || !terminalUi.desktopToolbarInHeader || !terminalUi.connectionToggleUsesLinkAction || !terminalUi.activeToolbarReplacesPrevious || !terminalUi.narrowToolbarFits || !terminalUi.narrowToolbarLeftAligned || !terminalUi.responsiveToolbarFits || !terminalUi.latencyMeasured || !terminalUi.latencyCanDisable || !terminalUi.latencyCanEnable || !terminalSettingsUi.open || !terminalSettingsUi.globalScope || !terminalSettingsUi.controls || !terminalSettingsUi.withinViewport || !terminalSettingsUi.requestedDefaults || !terminalSettingsUi.editablePasteSetting || !terminalSettingsUi.appliesToAllOpenSessions || !terminalSettingsUi.copyFormatting || !terminalSettingsUi.singleLinePaste || !terminalSettingsUi.linkProvider || !terminalSettingsUi.editablePaste || !mobileTerminalSettingsUi.buttonHidden || !mobile.terminalLongPress?.menuOnly || !mobile.terminalLongPress?.menuOpened || !mobile.terminalLongPress?.cursorHintStarted || !mobile.terminalLongPress?.cursorStartStored || !mobile.terminalLongPress?.cursorSelectionBlue || !mobile.terminalLongPress?.cursorCopyCompleted || !mobile.terminalLongPress?.clipboardFallback || !mobile.terminalSessionText?.open || !mobile.terminalSessionText?.withinViewport || !mobile.terminalSessionText?.selectable || !mobile.terminalSessionText?.scrollable || !mobile.terminalSessionText?.fullText || !mobile.terminalSessionText?.copyAll || !mobile.terminalSessionText?.copyAllWorks || !mobile.terminalSessionText?.backdropIgnored || !mobile.terminalPasteEditor?.open || !mobile.terminalPasteEditor?.withinViewport || !mobile.terminalPasteEditor?.editable || !mobile.terminalPasteEditor?.actionsVisible || !mobile.terminalPasteEditor?.backdropIgnored || !mobile.terminalPasteEditor?.cancelled || !mobile.terminalBack?.visible || !mobile.terminalBack?.compactToolbar || !mobile.terminalBack?.sftpTextFits || !mobile.terminalBack?.globalSettingsHidden || JSON.stringify(mobile.terminalBack?.priorityOrder)!==JSON.stringify(['reconnect','keys','forward','sftp']) || !mobile.terminalBack?.returned || !mobile.terminalFontMenu?.opened || !mobile.terminalFontMenu?.withinViewport || !mobile.terminalFontMenu?.compact || !mobile.terminalFontMenu?.scrollable || !mobile.terminalFontMenu?.closeSticky || !mobile.terminalFontMenu?.touchTargets || !terminalLabels.every(label=>terminalUi.labels.includes(label)) || terminalUi.metrics.some(item=>Math.abs(item.buttonHeight-30)>0.5||Math.abs(item.iconWidth-14)>0.5||Math.abs(item.iconHeight-14)>0.5||item.centerDelta>0.5);
  const logSettingsUiFailed = !logSettingsUi.open || !logSettingsUi.accessible || !logSettingsUi.days || !logSettingsUi.fileMb || !logSettingsUi.totalMb || !logSettingsUi.rotations || !logSettingsUi.cleanup || !logSettingsUi.save || !logSettingsUi.closed;
  const expectedSftpToolActions = ['收藏当前目录','新建文件夹','新建文件','上传文件','SFTP 回收站','搜索当前目录','打开此连接的终端','刷新目录','SFTP 全局设置'];
  const directoryActionsUi = sftpUi.directoryActionsUi || {};
  const connectionSessionUi = sftpUi.connectionSessionUi || {};
  const nativeDragUi = sftpUi.nativeDragUi || {};
  const directoryCacheBehavior = sftpUi.directoryCacheBehavior || {};
  const directorySizeUi = sftpUi.directorySizeUi || {};
  const jobUi = sftpUi.jobUi || {};
  const textEncodingUi = sftpUi.textEncodingUi || {};
  const globalSettingsUi = sftpUi.globalSettingsUi || {};
  const downloadNoticeUi = sftpUi.downloadNoticeUi || {};
  const jobUiFailed = !jobUi.found || !jobUi.mainHasRunning || !jobUi.mainHasFailed || !jobUi.mainHidesDone || !jobUi.historyEnabled || jobUi.historyCount !== '4' || !jobUi.historyHasDone || !jobUi.savedDownloadOnlyOpensDirectory || !jobUi.browserDownloadCanRepeat || !jobUi.historyHidesCurrent || !jobUi.backdropIgnored || !jobUi.noManualRefresh || !jobUi.compactRow || !jobUi.floatingVisible || !jobUi.floatingProgress || !jobUi.floatingIconsAligned || !jobUi.floatingSpinnerStableAcrossUpdates || !jobUi.floatingUploadPhaseLabels || !jobUi.floatingProgressRefreshes || !jobUi.floatingCrossCopyProgress || !jobUi.floatingCrossCopyDetail || !jobUi.nativeDragFloatingStopHidden || !jobUi.nativeDragTaskStopHidden || !jobUi.floatingOpensTaskList || !jobUi.floatingTaskVisibleBelowToolbar || !jobUi.floatingCloses || !jobUi.floatingCloseDoesNotNavigate || !jobUi.floatingSameBatchStaysClosed || !jobUi.floatingNewTaskReopens || !jobUi.floatingStacksBelowToast || !jobUi.floatingMatchesToastStyle || !jobUi.toastIconsAligned || !jobUi.floatingItemProgress || !jobUi.staleJobResponseIgnored || !jobUi.floatingAutoHides;
  const textEncodingUiFailed = !textEncodingUi.opened || !textEncodingUi.aceLoaded || textEncodingUi.selected !== 'gbk' || !textEncodingUi.manualLanguage || !textEncodingUi.jsonFormatting || !textEncodingUi.wordWrap || !textEncodingUi.persistDefault || !textEncodingUi.backup || !['utf8','utf8bom','gb18030','gbk','big5','shift_jis','euc-kr','latin1'].every(value=>textEncodingUi.options?.includes(value)) || !['auto','json','yaml','xml','sh','batchfile','powershell','javascript','java','c_cpp','sql','markdown'].every(value=>textEncodingUi.languageOptions?.includes(value));
  const nativeDragUiFailed = !nativeDragUi.found || !nativeDragUi.webExternalDragBlocked || !nativeDragUi.linuxFallbackNoticeOnce || !nativeDragUi.linuxFallbackUsesCompatibilityMode || !nativeDragUi.streamingPreparesOnPointerDown || !nativeDragUi.streamingThresholdActivatesOnce || !nativeDragUi.streamingCaptureCancelSurvives || !nativeDragUi.pointerUpCancelsPending || !nativeDragUi.streamingSkipsStage || !nativeDragUi.streamingNativeBlocksParallelBrowserDrag || !nativeDragUi.nativeIdleHintStable || !nativeDragUi.nativeOutsideHintStaysStable || !nativeDragUi.nativeMotionTargetsSftp || !nativeDragUi.nativeTransientMissKeepsTarget || !nativeDragUi.nativeFinalTransientMissKeepsTarget || !nativeDragUi.nativeReleasedClearsStaleTarget || !nativeDragUi.nativeResultCopiesOnce || !nativeDragUi.firstDragOnlyStages || !nativeDragUi.firstDragReset || !nativeDragUi.cacheReused || !nativeDragUi.cachedUnarmedStaysInternal || !nativeDragUi.sameWindowDropDoesNotArm || !nativeDragUi.armedDragStartsSynchronously || !nativeDragUi.failureRearmed || !nativeDragUi.successClearsState || !nativeDragUi.finderRenameNoticeShown;
  const sftpUiFailed = Boolean(sftpUi.error) || !connectionSessionUi.found || !connectionSessionUi.addressIncludesPort || !connectionSessionUi.disconnectedAction || !connectionSessionUi.disconnectedBanner || !connectionSessionUi.connectedAction || !connectionSessionUi.preservedWhileDisconnected || !connectionSessionUi.automaticConnectShared || !connectionSessionUi.manualDisconnectAutoReconnect || !connectionSessionUi.disconnectedTabSwitchDoesNotReconnect || !connectionSessionUi.disconnectedFolderOperationReconnects || !connectionSessionUi.dragFeedbackVisible || !connectionSessionUi.dragTargetViewActivated || !connectionSessionUi.targetListDropPrompt || !connectionSessionUi.targetListDropPromptStable || !connectionSessionUi.crossHostListDropCopies || !connectionSessionUi.crossHostPreviewHandoffSurvives || !connectionSessionUi.crossHostDropHasNoUploadToast || !connectionSessionUi.sameHostListDropCancels || !connectionSessionUi.ownDragUploadSuppressed || !connectionSessionUi.armedPointerCancelClearsRequest || !connectionSessionUi.armedDragAllowsExternalUpload || !connectionSessionUi.staleInternalDragAllowsExternalUpload || !connectionSessionUi.desktopUriListDragAccepted || !connectionSessionUi.releasedDragAllowsExternalUpload || !connectionSessionUi.externalFileDropDetected || !connectionSessionUi.externalFileDropCollected || !connectionSessionUi.externalDropPromptIsSingle || !connectionSessionUi.externalDropPromptAvoidsWorkspaceChrome || !connectionSessionUi.externalDropPromptListCentered || !connectionSessionUi.externalDropSurfaceFillsWorkspace || !connectionSessionUi.externalDropPromptScrollClamped || !connectionSessionUi.externalDropPromptHorizontalClamped || !connectionSessionUi.externalDropPromptClears || nativeDragUiFailed || jobUiFailed || textEncodingUiFailed || !downloadNoticeUi.oncePerMode || !downloadNoticeUi.desktopPath || !downloadNoticeUi.browserDevice || !downloadNoticeUi.batchUsesSharedNotice || !downloadNoticeUi.browserSeparateChoice || !downloadNoticeUi.browserSeparateQueued || !downloadNoticeUi.noDuplicateBatchNotice || !globalSettingsUi.found || !globalSettingsUi.globalScope || !globalSettingsUi.controls || !globalSettingsUi.downloadBehavior || !globalSettingsUi.defaultLimit || !globalSettingsUi.backdropIgnored || !globalSettingsUi.withinViewport || !directorySizeUi.idleButton || !directorySizeUi.requestedOnce || !directorySizeUi.exactBytes || !directorySizeUi.formatted || !directorySizeUi.refreshable || !sftpUi.fileOpenFeedback?.busy || !sftpUi.fileOpenFeedback?.duplicateBlocked || !sftpUi.fileOpenFeedback?.restored || !directoryCacheBehavior.sameResponseUntouched || !directoryCacheBehavior.changedResponseRendered || !directoryActionsUi.found || directoryActionsUi.stickyPosition !== 'sticky' || !directoryActionsUi.toolbarInHeader || !directoryActionsUi.navigationBeforeFavorites || !directoryActionsUi.reusedWithSilentRefresh || !expectedSftpToolActions.every(action=>directoryActionsUi.actionTitles?.includes(action)) || !directoryActionsUi.searchHidden || !directoryActionsUi.pathEditorHidden || !directoryActionsUi.pathEditorReplacesBreadcrumb || !directoryActionsUi.emptyClipboardHidden || !directoryActionsUi.copyQueueVisible || !directoryActionsUi.copyCancelled || !directoryActionsUi.moveQueueVisible || !directoryActionsUi.moveCancelled || !directoryActionsUi.crossHostCopyEnabled || !directoryActionsUi.crossHostMoveDisabled || !directoryActionsUi.crossHostClipboardConflict || !directoryActionsUi.filenameEncodingMenu || !directoryActionsUi.wideNavigationCompact || !directoryActionsUi.narrowNavigationCompact || !directoryActionsUi.terminalJump || !sftpUi.folderOpened || !sftpUi.fileOpened || !sftpUi.unknownAction || sftpUi.stickyPosition !== "sticky" || !sftpUi.breadcrumbScrollable || !sftpUi.singlePathPresentation || sftpUi.breadcrumbLabels?.join('/') !== '根目录/Users/junruo/Public' || sftpUi.breadcrumbText.includes('//') || !sftpUi.selectionShown || !sftpUi.selectionActionsShown || !sftpUi.specialSelectionExact || sftpUi.selectedRows !== 2 || !sftpUi.selectionCleared || !sftpUi.fileHasCompression || !sftpUi.permissionOwnerColumn || !sftpUi.permissionOwnerTitle || !sftpUi.symlinkUsesTargetSize || !sftpUi.symlinkExplainsBothSizes || !sftpUi.symlinkMarked || !sftpUi.wideColumnAlignment || !sftpUi.wideActionsFit || !sftpUi.compactSizeVisible || !sftpUi.compactTimeVisible || !sftpUi.compactAccessVisible || !sftpUi.compactMediumHidden || !sftpUi.compactCoreVisible || !sftpUi.compactNoOverflow || !sftpUi.permissionModeSync || !sftpUi.recursiveVisible || sftpUi.compactRowHeight > 48 || !sftpUi.moreMenuOpened || !sftpUi.contextMenuOpened || !sftpUi.directoryDownloadMenu || !sftpUi.narrowLayoutClass || !sftpUi.narrowCoreHidden || !sftpUi.narrowMoreVisible || !sftpUi.narrowMetaVisible || !sftpUi.narrowAccessHidden || !sftpUi.completedMutationDetected || sftpUi.pageRows !== 50 || !sftpUi.pagerVisible || !sftpUi.pagerText.includes('第 1/2 页') || !sftpUi.previousDisabled || !sftpUi.nextEnabled;
  const code = errors.length || overflow || darkFailed || menuFailed || refreshStateUiFailed || workspaceTabDragUiFailed || runningActionsFailed || authUiFailed || saveAndClearUiFailed || notificationUiFailed || restoreKeyUiFailed || restoreCredentialUiFailed || activityUiFailed || navigationUiFailed || aboutUiFailed || mobileNavigationFailed || mobileAboutFailed || terminalUiFailed || logSettingsUiFailed || sftpUiFailed || !clipboardUi.ok || mobile.contentVisible === "none" || !result.groups || !result.icons || !result.groupRenameMenu || !result.groupActionButton || !result.stickyGroupHeaders || !result.stickyGroupHeaderSealsTop || !result.operationPaneCollapsible || !result.compactDesktopHeader || !result.forwardToggleFits ? 1 : 0;
  clearTimeout(smokeWatchdog);
  window.destroy();
  app.exit(code);
}).catch(error => {
  clearTimeout(smokeWatchdog);
  console.error(error);
  app.exit(1);
});
