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
    // Keep background polling from crossing the temporary API fixtures below.
    // SFTP job refresh behavior is exercised explicitly in the dedicated checks.
    if (sftpJobsTimer) {
      clearInterval(sftpJobsTimer);
      sftpJobsTimer = null;
    }
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
    const activityHandle = document.querySelector('#activityBarResize');
    const activityStoredBefore = localStorage.getItem('activityBarWidth');
    const activityWidthBefore = activityBarWidth;
    let activityResizable = false;
    if (activityHandle) {
      const handleRect = activityHandle.getBoundingClientRect();
      const startX = handleRect.left + handleRect.width / 2;
      activityHandle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:91,pointerType:'mouse',button:0,clientX:startX,clientY:handleRect.top+20}));
      window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:91,pointerType:'mouse',button:0,clientX:startX+1000,clientY:handleRect.top+20}));
      window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:91,pointerType:'mouse',button:0,clientX:startX+1000,clientY:handleRect.top+20}));
      const pointerMax = activityBarWidth === ACTIVITY_BAR_WIDTH_MAX
        && Number(localStorage.getItem('activityBarWidth')) === ACTIVITY_BAR_WIDTH_MAX
        && activityBarResize === null
        && !document.body.classList.contains('activity-bar-resizing');
      activityHandle.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Home'}));
      const keyboardMin = activityBarWidth === ACTIVITY_BAR_WIDTH_MIN
        && Math.abs(activity.getBoundingClientRect().width-ACTIVITY_BAR_WIDTH_MIN) <= 0.5;
      activityHandle.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'ArrowRight',shiftKey:true}));
      const keyboardStep = activityBarWidth === ACTIVITY_BAR_WIDTH_MIN + 4;
      activityHandle.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'End'}));
      const keyboardMax = activityBarWidth === ACTIVITY_BAR_WIDTH_MAX;
      activityHandle.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0}));
      const doubleClickReset = activityBarWidth === ACTIVITY_BAR_WIDTH_DEFAULT
        && Number(localStorage.getItem('activityBarWidth')) === ACTIVITY_BAR_WIDTH_DEFAULT
        && Math.abs(activity.getBoundingClientRect().width-ACTIVITY_BAR_WIDTH_DEFAULT) <= 0.5;
      activityResizable = getComputedStyle(activityHandle).display !== 'none'
        && handleRect.width >= 6
        && activityHandle.getAttribute('aria-orientation') === 'vertical'
        && Number(activityHandle.getAttribute('aria-valuemin')) === ACTIVITY_BAR_WIDTH_MIN
        && Number(activityHandle.getAttribute('aria-valuemax')) === ACTIVITY_BAR_WIDTH_MAX
        && Number(activityHandle.getAttribute('aria-valuenow')) === ACTIVITY_BAR_WIDTH_DEFAULT
        && pointerMax && keyboardMin && keyboardStep && keyboardMax && doubleClickReset;
    }
    applyActivityBarWidth(activityWidthBefore,{fit:false});
    if (activityStoredBefore === null) localStorage.removeItem('activityBarWidth');
    else localStorage.setItem('activityBarWidth',activityStoredBefore);
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
    const originalPanePinnedByView = {...operationPanePinnedByView};
    const originalPanePinnedStorage = localStorage.getItem(OPERATION_PANE_PINNED_STORAGE_KEY);
    const originalPinGuideSeen = localStorage.getItem(OPERATION_PANE_PIN_GUIDE_STORAGE_KEY);
    const originalPinGuideShown = operationPanePinGuideShown;
    const originalPinGuideHidden = document.querySelector('#operationPanePinGuide')?.hidden !== false;
    operationPaneCollapsed = false;
    primaryView = 'connections';
    operationPanePinnedByView = Object.fromEntries(OPERATION_PANE_PRIMARY_VIEWS.map(name=>[name,true]));
    saveOperationPanePinnedState();
    localStorage.removeItem(OPERATION_PANE_PIN_GUIDE_STORAGE_KEY);
    operationPanePinGuideShown = false;
    showPrimary('connections');
    const pinGuide = document.querySelector('#operationPanePinGuide');
    const pinButton = document.querySelector('#operationPanePin');
    const pinGuideRect = pinGuide?.getBoundingClientRect();
    const pinButtonRect = pinButton?.getBoundingClientRect();
    const pinGuideAnchor = parseFloat(pinGuide?.style.getPropertyValue('--operation-pane-pin-guide-anchor') || 'NaN');
    const pinGuideExpectedAnchor = pinGuideRect&&pinButtonRect ? pinButtonRect.left+pinButtonRect.width/2-pinGuideRect.left : NaN;
    const pinGuideArrowStyle = pinGuide ? getComputedStyle(pinGuide, '::before') : null;
    const pinGuideArrowLeft = parseFloat(pinGuideArrowStyle?.left || 'NaN');
    const pinGuideArrowWidth = parseFloat(pinGuideArrowStyle?.width || 'NaN');
    const pinGuideArrowCenter = pinGuideRect&&Number.isFinite(pinGuideArrowLeft)&&Number.isFinite(pinGuideArrowWidth)
      ? pinGuideRect.left+pinGuideArrowLeft+pinGuideArrowWidth/2
      : NaN;
    const pinButtonCenter = pinButtonRect ? pinButtonRect.left+pinButtonRect.width/2 : NaN;
    const pinGuideShownOnce = Boolean(pinGuide&&!pinGuide.hidden&&localStorage.getItem(OPERATION_PANE_PIN_GUIDE_STORAGE_KEY)==='1');
    const pinGuideTargetsPin = Number.isFinite(pinGuideAnchor)&&Number.isFinite(pinGuideExpectedAnchor)
      &&Math.abs(pinGuideAnchor-pinGuideExpectedAnchor)<=1
      &&Number.isFinite(pinGuideArrowCenter)&&Number.isFinite(pinButtonCenter)
      &&Math.abs(pinGuideArrowCenter-pinButtonCenter)<=1;
    dismissOperationPanePinGuide();
    operationPanePinGuideShown = false;
    syncOperationPaneState();
    const pinGuideDoesNotRepeat = pinGuide?.hidden === true;
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
    setOperationPaneCollapsed(false);
    setOperationPanePinned(false, 'running');
    const runningPinShowsAutoCollapse = document.querySelector('#operationPanePin')?.getAttribute('aria-pressed') === 'false'
      && document.querySelector('#operationPanePin')?.dataset.icon === 'pin-off';
    const captureFixture = document.createElement('button');
    let captureFixtureClicked = false;
    captureFixture.addEventListener('click', event=>{ captureFixtureClicked=true; event.stopPropagation(); });
    document.querySelector('#content')?.appendChild(captureFixture);
    captureFixture.click();
    const unpinnedContentClickCollapses = captureFixtureClicked&&operationPaneCollapsed&&document.querySelector('.app')?.classList.contains('operation-pane-collapsed');
    captureFixture.remove();
    setOperationPaneCollapsed(false);
    showPrimary('connections');
    document.querySelector('#content')?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0}));
    const pinnedContentClickStaysOpen = !operationPaneCollapsed&&isOperationPanePinned('connections')&&!isOperationPanePinned('running');
    const persistedPinState = JSON.parse(localStorage.getItem(OPERATION_PANE_PINNED_STORAGE_KEY) || '{}');
    const independentPinPersistence = persistedPinState.connections===true&&persistedPinState.running===false
      &&OPERATION_PANE_PRIMARY_VIEWS.filter(name=>!['connections','running'].includes(name)).every(name=>persistedPinState[name]===true);
    operationPaneCollapsed = originalPaneCollapsed;
    primaryView = originalPrimaryView;
    operationPanePinnedByView = originalPanePinnedByView;
    localStorage.setItem('operationPaneCollapsed', originalPaneCollapsed ? '1' : '0');
    if (originalPanePinnedStorage === null) localStorage.removeItem(OPERATION_PANE_PINNED_STORAGE_KEY);
    else localStorage.setItem(OPERATION_PANE_PINNED_STORAGE_KEY, originalPanePinnedStorage);
    if (originalPinGuideSeen === null) localStorage.removeItem(OPERATION_PANE_PIN_GUIDE_STORAGE_KEY);
    else localStorage.setItem(OPERATION_PANE_PIN_GUIDE_STORAGE_KEY, originalPinGuideSeen);
    operationPanePinGuideShown = originalPinGuideShown;
    showPrimary(originalPrimaryView);
    if (pinGuide) {
      pinGuide.hidden = originalPinGuideHidden;
      positionOperationPanePinGuide();
    }
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
      operationPanePinBehavior: pinGuideShownOnce&&pinGuideTargetsPin&&pinGuideDoesNotRepeat&&runningPinShowsAutoCollapse&&unpinnedContentClickCollapses&&pinnedContentClickStaysOpen&&independentPinPersistence,
      activityUtilities: document.querySelector('.activity-bottom')?.children[0]?.id === 'themeToggle'
        && document.querySelector('.activity-bottom')?.children[1]?.id === 'activityRefresh'
        && document.querySelector('.activity-bottom')?.children[2]?.classList.contains('github-link'),
      compactDesktopHeader: brandHeight >= 33.5
        && brandHeight <= 64.5
        && topbarHeight >= 33.5
        && topbarHeight <= 64.5
        && Math.abs(brandHeight - topbarHeight) <= 0.5
        && tabsHeight >= 25.5
        && tabsHeight <= 48.5
        && workspacePaddingTop <= 12.5,
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
        resizable:activityResizable,
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
      const activeDraggedTab = workspaceTabDrag?.tab || draggedTab;
      const dragGhost = document.querySelector('.workspace-tab-drag-ghost');
      const insertionIndicator = activeDraggedTab?.closest('.workspace-pane')?.querySelector('.workspace-tab-insert-indicator');
      const beganImmediately = Boolean(workspaceTabDrag?.dragging && activeDraggedTab?.classList.contains('tab-dragging') && document.body.classList.contains('workspace-tab-drag-active'));
      const dragGhostVisible = Boolean(dragGhost && dragGhost.textContent.includes('bt01 · 终端') && getComputedStyle(dragGhost).display !== 'none');
      const dropPositionVisible = Boolean(
        insertionIndicator
        && !insertionIndicator.hidden
        && getComputedStyle(insertionIndicator).display !== 'none'
        && insertionIndicator.getBoundingClientRect().left >= lastRect.right - 4
      );
      const touchReady = getComputedStyle(activeDraggedTab).touchAction === 'pan-y';
      const commonTitleFits = activeDraggedTab.querySelector('.tab-title').scrollWidth <= activeDraggedTab.querySelector('.tab-title').clientWidth;
      const sessionTitle = document.querySelector('.tab[data-tab-key="drag-b"] .tab-title');
      const numberedSessionTitleFits = sessionTitle.scrollWidth <= sessionTitle.clientWidth;
      const tabFontSize = parseFloat(getComputedStyle(activeDraggedTab).fontSize);
      const tabFontWithinResizeRange = tabFontSize >= 10.4 && tabFontSize <= 15.1;
      const fullTitleTooltip = activeDraggedTab.title === 'bt01 · 终端 - root@bt01.example:22';
      const liveOrder = [...document.querySelectorAll('#tabs .tab')].map(tab => tab.dataset.tabKey);
      window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:71,pointerType:'mouse',button:0,clientX:lastRect.right-2,clientY:firstRect.top+8}));
      const savedOrder = tabs.map(tab => tab.key);
      const persistedOrder = JSON.parse(localStorage.getItem('workspaceTabs') || '{}').tabs?.map(tab => tab.key) || [];
      const activeFollowsDragged = activeTabKey === 'drag-a';
      const dragGhostRemoved = !document.querySelector('.workspace-tab-drag-ghost');
      const dropPositionRemoved = !document.querySelector('.workspace-tab-insert-indicator:not([hidden])');
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
        dropPositionRemoved,
        dragGhostRemoved,
        touchReady,
        commonTitleFits,
        numberedSessionTitleFits,
        tabFontWithinResizeRange,
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
  console.log("[ui-smoke] recursive workspace docking");
  const workspaceDockingUi = await window.webContents.executeJavaScript(`(async () => {
    const previousTabs = tabs.map(tab => ({...tab}));
    const previousLayout = JSON.parse(JSON.stringify(workspaceLayout));
    const previousFocusedPaneId = focusedPaneId;
    const previousActiveTabKey = activeTabKey;
    const previousActiveView = activeView;
    const previousStoredTabs = localStorage.getItem('workspaceTabs');
    const previousStoredHeaderHeight = localStorage.getItem('workspaceHeaderHeight');
    const previousStoredTabHeight = localStorage.getItem('workspaceTabHeight');
    const previousHeaderHeight = workspaceHeaderHeight;
    const previousTabHeight = workspaceTabHeight;
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
    const nearly = (value, expected, tolerance=0.6) => Math.abs(value - expected) <= tolerance;
    const dragChromeHandle = async (handle, pointerId, deltaY, kind) => {
      if (!handle) return {started:false,ended:false};
      const rect = handle.getBoundingClientRect();
      const startY = rect.top + rect.height / 2;
      handle.dispatchEvent(new PointerEvent('pointerdown',{
        bubbles:true,
        cancelable:true,
        pointerId,
        pointerType:'mouse',
        button:0,
        clientX:rect.left + Math.max(1, rect.width / 2),
        clientY:startY
      }));
      const started = workspaceChromeResize?.kind === kind
        && workspaceChromeResize.pointerId === pointerId
        && document.body.classList.contains('workspace-chrome-resizing');
      window.dispatchEvent(new PointerEvent('pointermove',{
        bubbles:true,
        cancelable:true,
        pointerId,
        pointerType:'mouse',
        button:0,
        clientX:rect.left + Math.max(1, rect.width / 2),
        clientY:startY + deltaY
      }));
      await nextFrame();
      window.dispatchEvent(new PointerEvent('pointerup',{
        bubbles:true,
        cancelable:true,
        pointerId,
        pointerType:'mouse',
        button:0,
        clientX:rect.left + Math.max(1, rect.width / 2),
        clientY:startY + deltaY
      }));
      await nextFrame();
      return {
        started,
        ended:workspaceChromeResize === null
          && !document.body.classList.contains('workspace-chrome-resizing')
      };
    };
    try {
      tabs = ['a','b','c','d'].map(key => ({key:'dock-'+key,title:'Dock '+key.toUpperCase(),subtitle:'',viewName:'welcome',closable:true,kind:'fixture'}));
      workspaceLayout = {type:'pane',id:'dock-pane-root',tabs:tabs.map(tab=>tab.key),activeTabKey:'dock-a'};
      focusedPaneId = 'dock-pane-root';
      activeTabKey = 'dock-a';
      activeView = 'welcome';
      renderTabs();
      const firstSplit = applyWorkspaceTabDrop({key:'dock-b',sourcePaneId:'dock-pane-root'}, {paneId:'dock-pane-root',zone:'right'});
      const rightPane = workspaceFindPaneForTab('dock-b');
      const sourcePane = workspaceFindPaneForTab('dock-a');
      const secondSplit = Boolean(rightPane && sourcePane)
        && applyWorkspaceTabDrop({key:'dock-c',sourcePaneId:sourcePane.id}, {paneId:rightPane.id,zone:'bottom'});
      const nestedTree = workspaceLayout.type === 'split'
        && workspaceLayout.direction === 'row'
        && workspaceLayout.second?.type === 'split'
        && workspaceLayout.second.direction === 'column';
      const paneCount = document.querySelectorAll('#workspaceDock .workspace-pane').length;
      const eachPaneComplete = [...document.querySelectorAll('#workspaceDock .workspace-pane')].every(pane => pane.querySelector('.tabs-shell') && pane.querySelector('.workspace'));
      const expectedActivityFitPaneIds=workspaceVisiblePanes().map(pane=>pane.id);
      const activityFitPaneIds=[];
      const originalUpdateTabScrollControls=updateWorkspaceTabScrollControls;
      const activityWidthBeforeFit=activityBarWidth;
      updateWorkspaceTabScrollControls=paneId=>{
        activityFitPaneIds.push(paneId);
        return originalUpdateTabScrollControls(paneId);
      };
      applyActivityBarWidth(activityWidthBeforeFit===ACTIVITY_BAR_WIDTH_MAX?ACTIVITY_BAR_WIDTH_MIN:activityWidthBeforeFit+1);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      applyActivityBarWidth(activityWidthBeforeFit,{fit:false});
      updateWorkspaceTabScrollControls=originalUpdateTabScrollControls;
      const activityResizeReflowsEveryPane=expectedActivityFitPaneIds.every(paneId=>activityFitPaneIds.includes(paneId));
      const splitters = [...document.querySelectorAll('#workspaceDock .workspace-splitter')];
      const splitterMetrics = splitters.map(splitter => {
        const splitElement = splitter.parentElement;
        const vertical = splitElement?.classList.contains('workspace-split-row');
        const rect = splitter.getBoundingClientRect();
        const style = getComputedStyle(splitter);
        const line = getComputedStyle(splitter, '::before');
        const firstRect = splitElement?.querySelector(':scope > .workspace-split-first')?.getBoundingClientRect();
        const secondRect = splitElement?.querySelector(':scope > .workspace-split-second')?.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        // Probe away from the midpoint, where a nested perpendicular splitter can overlap.
        const hitX = vertical ? centerX : rect.left + rect.width / 4;
        const hitY = vertical ? rect.top + rect.height / 4 : centerY;
        const hitOffsets = [-3, 0, 3];
        return {
          vertical,
          orientation:splitter.getAttribute('aria-orientation'),
          trackSize:vertical ? rect.width : rect.height,
          layoutGap:vertical
            ? (secondRect?.left ?? 0) - (firstRect?.right ?? 0)
            : (secondRect?.top ?? 0) - (firstRect?.bottom ?? 0),
          hitAreaCoversTrack:hitOffsets.every(offset => document.elementFromPoint(
            vertical ? hitX + offset : hitX,
            vertical ? hitY : hitY + offset
          ) === splitter),
          lineSize:parseFloat(vertical ? line.width : line.height),
          lineColor:line.backgroundColor,
          trackColor:style.backgroundColor,
          content:line.content,
          spansAxis:vertical
            ? nearly(parseFloat(line.top), 0) && nearly(parseFloat(line.bottom), 0)
            : nearly(parseFloat(line.left), 0) && nearly(parseFloat(line.right), 0)
        };
      });
      const splitterTracksUsable = splitterMetrics.every(metric => metric.trackSize >= 9.5
        && metric.layoutGap >= 1.5
        && metric.layoutGap <= 2.5
        && metric.hitAreaCoversTrack);
      const splitterLinesVisible = splitterMetrics.every(metric => metric.lineSize >= 0.75
        && metric.lineSize <= 1.25
        && metric.content !== 'none'
        && metric.content !== 'normal'
        && metric.lineColor !== 'transparent'
        && metric.lineColor !== 'rgba(0, 0, 0, 0)'
        && metric.lineColor !== metric.trackColor
        && metric.spansAxis
        && metric.orientation === (metric.vertical ? 'vertical' : 'horizontal'));
      const paneElements = [...document.querySelectorAll('#workspaceDock .workspace-pane')];
      paneElements.forEach(pane => pane.classList.add('terminal-pane'));
      const terminalWorkspaceStyles = paneElements.map(pane => getComputedStyle(pane.querySelector(':scope > .workspace')));
      const terminalInsetsCompact = terminalWorkspaceStyles.every(style => nearly(parseFloat(style.paddingTop), 4)
        && nearly(parseFloat(style.paddingRight), 2)
        && nearly(parseFloat(style.paddingBottom), 2)
        && nearly(parseFloat(style.paddingLeft), 2));
      const terminalScrollbarGutterReleased = terminalWorkspaceStyles.every(style => style.scrollbarGutter === 'auto');
      paneElements.forEach(pane => pane.classList.remove('terminal-pane'));
      const rootSplitId = workspaceLayout.id;
      setWorkspaceSplitRatio(rootSplitId, 0.64);
      const ratioAdjusted = Math.abs(workspaceFindSplit(rootSplitId).ratio - 0.64) < 0.001
        && document.querySelector('[data-split-id="'+rootSplitId+'"]')?.style.getPropertyValue('--workspace-split-ratio') === '64%';
      const persistedLayout = JSON.parse(localStorage.getItem('workspaceTabs') || '{}').layout;
      const ratioPersisted = persistedLayout?.id === rootSplitId
        && Math.abs(Number(persistedLayout.ratio) - 0.64) < 0.001;

      for (const pane of paneElements) {
        const tab = pane.querySelector('.tab');
        if (!tab || tab.querySelector('.tab-connection-dot')) continue;
        const dot = document.createElement('span');
        dot.className = 'tab-connection-dot connected';
        dot.setAttribute('aria-hidden', 'true');
        tab.prepend(dot);
      }
      const tabResizeHandles = [...document.querySelectorAll('#workspaceDock .workspace-tab-resizer')];
      const tabResizeAccessible = tabResizeHandles.length === paneCount
        && tabResizeHandles.every(handle => handle.getAttribute('role') === 'separator'
          && handle.getAttribute('aria-orientation') === 'horizontal'
          && Number(handle.getAttribute('aria-valuemin')) === WORKSPACE_TAB_HEIGHT_MIN
          && Number(handle.getAttribute('aria-valuemax')) === WORKSPACE_TAB_HEIGHT_MAX
          && getComputedStyle(handle).display !== 'none'
          && handle.getBoundingClientRect().height >= 6);
      const tabSnapshot = () => {
        const shells = [...document.querySelectorAll('#workspaceDock .tabs-shell')];
        const tabNodes = shells.map(shell => shell.querySelector('.tab')).filter(Boolean);
        const dots = shells.map(shell => shell.querySelector('.tab-connection-dot')).filter(Boolean);
        const handles = [...document.querySelectorAll('#workspaceDock .workspace-tab-resizer')];
        return {
          heights:shells.map(shell => shell.getBoundingClientRect().height),
          fonts:tabNodes.map(tab => parseFloat(getComputedStyle(tab).fontSize)),
          dots:dots.map(dot => {
            const rect = dot.getBoundingClientRect();
            return {width:rect.width,height:rect.height};
          }),
          aria:handles.map(handle => Number(handle.getAttribute('aria-valuenow')))
        };
      };
      const headerStorageBeforeTabResize = localStorage.getItem('workspaceHeaderHeight');
      const tabMinDrag = await dragChromeHandle(tabResizeHandles[0], 181, -1000, 'tabs');
      const tabMin = tabSnapshot();
      const tabMaxDrag = await dragChromeHandle(tabResizeHandles[1] || tabResizeHandles[0], 182, 1000, 'tabs');
      const tabMax = tabSnapshot();
      const tabAllPanesClampMin = tabMin.heights.length === paneCount
        && tabMin.heights.every(height => nearly(height, WORKSPACE_TAB_HEIGHT_MIN))
        && tabMin.aria.every(value => value === WORKSPACE_TAB_HEIGHT_MIN);
      const tabAllPanesClampMax = tabMax.heights.length === paneCount
        && tabMax.heights.every(height => nearly(height, WORKSPACE_TAB_HEIGHT_MAX))
        && tabMax.aria.every(value => value === WORKSPACE_TAB_HEIGHT_MAX);
      const tabTextScales = tabMin.fonts.length === paneCount
        && tabMax.fonts.length === paneCount
        && Math.min(...tabMax.fonts) >= Math.max(...tabMin.fonts) + 1;
      const statusDotScales = tabMin.dots.length === paneCount
        && tabMax.dots.length === paneCount
        && Math.min(...tabMax.dots.map(dot => Math.min(dot.width, dot.height)))
          >= Math.max(...tabMin.dots.map(dot => Math.max(dot.width, dot.height))) + 1;
      const tabPointerLifecycle = tabMinDrag.started && tabMinDrag.ended && tabMaxDrag.started && tabMaxDrag.ended;
      const tabHeightPersisted = Number(localStorage.getItem('workspaceTabHeight')) === WORKSPACE_TAB_HEIGHT_MAX;
      const tabKeyboardHandle = tabResizeHandles.at(-1);
      tabKeyboardHandle?.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'ArrowUp'}));
      await nextFrame();
      const tabKeyboardUp = workspaceTabHeight === WORKSPACE_TAB_HEIGHT_MAX - 1
        && Number(localStorage.getItem('workspaceTabHeight')) === WORKSPACE_TAB_HEIGHT_MAX - 1;
      tabKeyboardHandle?.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'ArrowDown'}));
      await nextFrame();
      const tabKeyboardDown = workspaceTabHeight === WORKSPACE_TAB_HEIGHT_MAX;
      tabKeyboardHandle?.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Home'}));
      await nextFrame();
      const tabKeyboardHome = workspaceTabHeight === WORKSPACE_TAB_HEIGHT_MIN;
      tabKeyboardHandle?.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'End'}));
      await nextFrame();
      const tabKeyboardEnd = workspaceTabHeight === WORKSPACE_TAB_HEIGHT_MAX
        && tabSnapshot().heights.every(height => nearly(height, WORKSPACE_TAB_HEIGHT_MAX));
      const tabKeyboardControls = tabKeyboardUp && tabKeyboardDown && tabKeyboardHome && tabKeyboardEnd;
      tabKeyboardHandle?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0}));
      await nextFrame();
      const tabDoubleClickResets = workspaceTabHeight === WORKSPACE_TAB_HEIGHT_DEFAULT
        && Number(localStorage.getItem('workspaceTabHeight')) === WORKSPACE_TAB_HEIGHT_DEFAULT
        && tabSnapshot().heights.every(height => nearly(height, WORKSPACE_TAB_HEIGHT_DEFAULT));
      applyWorkspaceTabHeight(45, {persist:true,fit:false});
      applyWorkspaceTabHeight(WORKSPACE_TAB_HEIGHT_MIN, {fit:false});
      initWorkspaceChromeSizing();
      await nextFrame();
      const restoredTabSnapshot = tabSnapshot();
      const tabHeightRestored = workspaceTabHeight === 45
        && restoredTabSnapshot.heights.every(height => nearly(height, 45))
        && restoredTabSnapshot.aria.every(value => value === 45);
      const tabStorageIndependent = localStorage.getItem('workspaceHeaderHeight') === headerStorageBeforeTabResize;

      const cPane = workspaceFindPaneForTab('dock-c');
      const mergedNested = Boolean(cPane && sourcePane)
        && applyWorkspaceTabDrop({key:'dock-c',sourcePaneId:cPane.id}, {paneId:sourcePane.id,zone:'tabs',index:sourcePane.tabs.length});
      const bPane = workspaceFindPaneForTab('dock-b');
      const mergedAll = Boolean(bPane && sourcePane)
        && applyWorkspaceTabDrop({key:'dock-b',sourcePaneId:bPane.id}, {paneId:sourcePane.id,zone:'tabs',index:sourcePane.tabs.length});
      const collapsedToSinglePane = workspaceLayout.type === 'pane' && workspaceLeaves().length === 1
        && document.querySelectorAll('#workspaceDock .workspace-pane').length === 1;
      return {
        firstSplit,
        secondSplit,
        nestedTree,
        paneCount,
        eachPaneComplete,
        activityResizeReflowsEveryPane,
        splitterCount:splitters.length,
        splitterMetrics,
        splitterTracksUsable,
        splitterLinesVisible,
        terminalInsetsCompact,
        terminalScrollbarGutterReleased,
        ratioAdjusted,
        ratioPersisted,
        tabResizeAccessible,
        tabAllPanesClampMin,
        tabAllPanesClampMax,
        tabTextScales,
        statusDotScales,
        tabPointerLifecycle,
        tabHeightPersisted,
        tabKeyboardControls,
        tabDoubleClickResets,
        tabHeightRestored,
        tabStorageIndependent,
        tabMin,
        tabMax,
        mergedNested,
        mergedAll,
        collapsedToSinglePane
      };
    } finally {
      if (workspaceChromeResize) endWorkspaceChromeResize(null, true);
      if (previousStoredHeaderHeight === null) localStorage.removeItem('workspaceHeaderHeight');
      else localStorage.setItem('workspaceHeaderHeight', previousStoredHeaderHeight);
      if (previousStoredTabHeight === null) localStorage.removeItem('workspaceTabHeight');
      else localStorage.setItem('workspaceTabHeight', previousStoredTabHeight);
      applyWorkspaceHeaderHeight(previousHeaderHeight, {fit:false});
      applyWorkspaceTabHeight(previousTabHeight, {fit:false});
      tabs = previousTabs;
      workspaceLayout = previousLayout;
      focusedPaneId = previousFocusedPaneId;
      activeTabKey = previousActiveTabKey;
      activeView = previousActiveView;
      window.restoringTabs = true;
      renderTabs();
      const focused = workspaceFindPane(focusedPaneId) || workspaceLeaves()[0];
      if (focused?.activeTabKey) renderWorkspacePaneContent(focused.id);
      window.restoringTabs = false;
      if (previousStoredTabs === null) localStorage.removeItem('workspaceTabs');
      else localStorage.setItem('workspaceTabs', previousStoredTabs);
    }
  })()`);
  console.log("[ui-smoke] workspace header resize");
  const workspaceHeaderResizeUi = await window.webContents.executeJavaScript(`(async () => {
    const topbar = document.querySelector('.topbar');
    const brand = document.querySelector('.brand');
    const handle = document.querySelector('#workspaceHeaderResize');
    const tools = document.querySelector('#workspaceGlobalHeaderTools');
    if (!topbar || !brand || !handle || !tools) return {found:false};
    const previousStoredHeaderHeight = localStorage.getItem('workspaceHeaderHeight');
    const previousStoredTabHeight = localStorage.getItem('workspaceTabHeight');
    const previousHeaderHeight = workspaceHeaderHeight;
    const previousTabHeight = workspaceTabHeight;
    const previousToolsHidden = tools.hidden;
    const fixture = document.createElement('div');
    fixture.className = 'terminal-toolbar terminal-toolbar-header workspace-header-resize-fixture';
    fixture.innerHTML = '<div class="actions terminal-actions"><button class="terminal-dropdown-button workspace-header-resize-fixture-button">'
      + icon('type') + '<span>Header size</span>' + icon('chevron-down') + '</button></div>';
    tools.appendChild(fixture);
    tools.hidden = false;
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
    const nearly = (value, expected, tolerance=0.6) => Math.abs(value - expected) <= tolerance;
    const snapshot = () => {
      const button = fixture.querySelector('button');
      const label = button?.querySelector('span');
      const svg = button?.querySelector('svg');
      const topbarRect = topbar.getBoundingClientRect();
      const brandRect = brand.getBoundingClientRect();
      const buttonRect = button?.getBoundingClientRect();
      const svgRect = svg?.getBoundingClientRect();
      return {
        height:topbarRect.height,
        brandHeight:brandRect.height,
        titleFont:parseFloat(getComputedStyle(document.querySelector('#workspaceTitle')).fontSize),
        subtitleFont:parseFloat(getComputedStyle(document.querySelector('#workspaceSubtitle')).fontSize),
        controlHeight:buttonRect?.height || 0,
        controlFont:parseFloat(getComputedStyle(button).fontSize),
        labelFont:parseFloat(getComputedStyle(label).fontSize),
        iconSize:svgRect ? Math.max(svgRect.width, svgRect.height) : 0,
        ariaNow:Number(handle.getAttribute('aria-valuenow'))
      };
    };
    const dragHeader = async (pointerId, deltaY) => {
      const rect = handle.getBoundingClientRect();
      const startY = rect.top + rect.height / 2;
      handle.dispatchEvent(new PointerEvent('pointerdown',{
        bubbles:true,
        cancelable:true,
        pointerId,
        pointerType:'mouse',
        button:0,
        clientX:rect.left + Math.max(1, rect.width / 2),
        clientY:startY
      }));
      const started = workspaceChromeResize?.kind === 'header'
        && workspaceChromeResize.pointerId === pointerId
        && document.body.classList.contains('workspace-header-resizing');
      window.dispatchEvent(new PointerEvent('pointermove',{
        bubbles:true,
        cancelable:true,
        pointerId,
        pointerType:'mouse',
        button:0,
        clientX:rect.left + Math.max(1, rect.width / 2),
        clientY:startY + deltaY
      }));
      await nextFrame();
      window.dispatchEvent(new PointerEvent('pointerup',{
        bubbles:true,
        cancelable:true,
        pointerId,
        pointerType:'mouse',
        button:0,
        clientX:rect.left + Math.max(1, rect.width / 2),
        clientY:startY + deltaY
      }));
      await nextFrame();
      return {
        started,
        ended:workspaceChromeResize === null
          && !document.body.classList.contains('workspace-chrome-resizing')
      };
    };
    try {
      const accessible = handle.getAttribute('role') === 'separator'
        && handle.getAttribute('aria-orientation') === 'horizontal'
        && Number(handle.getAttribute('aria-valuemin')) === WORKSPACE_HEADER_HEIGHT_MIN
        && Number(handle.getAttribute('aria-valuemax')) === WORKSPACE_HEADER_HEIGHT_MAX
        && getComputedStyle(handle).display !== 'none'
        && handle.getBoundingClientRect().height >= 6;
      const tabStorageBeforeHeaderResize = localStorage.getItem('workspaceTabHeight');
      const minDrag = await dragHeader(191, -1000);
      const compact = snapshot();
      const maxDrag = await dragHeader(192, 1000);
      const expanded = snapshot();
      const minClamped = nearly(compact.height, WORKSPACE_HEADER_HEIGHT_MIN)
        && compact.ariaNow === WORKSPACE_HEADER_HEIGHT_MIN;
      const maxClamped = nearly(expanded.height, WORKSPACE_HEADER_HEIGHT_MAX)
        && expanded.ariaNow === WORKSPACE_HEADER_HEIGHT_MAX;
      const brandAligned = nearly(compact.brandHeight, compact.height)
        && nearly(expanded.brandHeight, expanded.height);
      const textScales = expanded.titleFont >= compact.titleFont + 1
        && expanded.subtitleFont >= compact.subtitleFont + 1;
      const controlsScale = expanded.controlHeight >= compact.controlHeight + 4
        && expanded.controlFont >= compact.controlFont + 1
        && expanded.labelFont >= compact.labelFont + 1
        && expanded.iconSize >= compact.iconSize + 1;
      const pointerLifecycle = minDrag.started && minDrag.ended && maxDrag.started && maxDrag.ended;
      const heightPersisted = Number(localStorage.getItem('workspaceHeaderHeight')) === WORKSPACE_HEADER_HEIGHT_MAX;
      handle.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'ArrowUp'}));
      await nextFrame();
      const keyboardUp = workspaceHeaderHeight === WORKSPACE_HEADER_HEIGHT_MAX - 1
        && Number(localStorage.getItem('workspaceHeaderHeight')) === WORKSPACE_HEADER_HEIGHT_MAX - 1;
      handle.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'ArrowDown'}));
      await nextFrame();
      const keyboardDown = workspaceHeaderHeight === WORKSPACE_HEADER_HEIGHT_MAX;
      handle.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Home'}));
      await nextFrame();
      const keyboardHome = workspaceHeaderHeight === WORKSPACE_HEADER_HEIGHT_MIN;
      handle.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'End'}));
      await nextFrame();
      const keyboardEnd = workspaceHeaderHeight === WORKSPACE_HEADER_HEIGHT_MAX
        && nearly(snapshot().height, WORKSPACE_HEADER_HEIGHT_MAX);
      const keyboardControls = keyboardUp && keyboardDown && keyboardHome && keyboardEnd;
      handle.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0}));
      await nextFrame();
      const doubleClickResets = workspaceHeaderHeight === WORKSPACE_HEADER_HEIGHT_DEFAULT
        && Number(localStorage.getItem('workspaceHeaderHeight')) === WORKSPACE_HEADER_HEIGHT_DEFAULT
        && nearly(snapshot().height, WORKSPACE_HEADER_HEIGHT_DEFAULT);
      applyWorkspaceHeaderHeight(58, {persist:true,fit:false});
      applyWorkspaceHeaderHeight(WORKSPACE_HEADER_HEIGHT_MIN, {fit:false});
      initWorkspaceChromeSizing();
      await nextFrame();
      const restored = snapshot();
      const heightRestored = workspaceHeaderHeight === 58
        && nearly(restored.height, 58)
        && nearly(restored.brandHeight, 58)
        && restored.ariaNow === 58;
      const tabStorageIndependent = localStorage.getItem('workspaceTabHeight') === tabStorageBeforeHeaderResize;
      return {
        found:true,
        accessible,
        minClamped,
        maxClamped,
        brandAligned,
        textScales,
        controlsScale,
        pointerLifecycle,
        heightPersisted,
        keyboardControls,
        doubleClickResets,
        heightRestored,
        tabStorageIndependent,
        compact,
        expanded,
        restored
      };
    } finally {
      if (workspaceChromeResize) endWorkspaceChromeResize(null, true);
      if (previousStoredHeaderHeight === null) localStorage.removeItem('workspaceHeaderHeight');
      else localStorage.setItem('workspaceHeaderHeight', previousStoredHeaderHeight);
      if (previousStoredTabHeight === null) localStorage.removeItem('workspaceTabHeight');
      else localStorage.setItem('workspaceTabHeight', previousStoredTabHeight);
      applyWorkspaceHeaderHeight(previousHeaderHeight, {fit:false});
      applyWorkspaceTabHeight(previousTabHeight, {fit:false});
      fixture.remove();
      tools.hidden = previousToolsHidden;
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
        && updateArea.textContent.includes('下载前会测试直连与加速线路并自动选择最快线路')
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
        state:'downloading',
        phase:'probing',
        bytes_downloaded:0,
        progress_percent:0
      };
      updateArea.innerHTML = updateStatusHtml();
      const probingStateReady = updateArea.textContent.includes('正在测速')
        && updateArea.textContent.includes('正在测试直连和加速线路')
        && updateArea.textContent.includes('正在并行测速')
        && Boolean([...updateArea.querySelectorAll('button')].find(button=>button.textContent.includes('正在测速') && button.disabled));
      updateSettings.download_status = {
        ...updateSettings.download_status,
        phase:'downloading',
        source_label:'ghfast.top',
        source_speed_bytes_per_second:2097152,
        bytes_downloaded:5242880,
        progress_percent:50
      };
      updateArea.innerHTML = updateStatusHtml();
      const selectedRouteReady = updateArea.textContent.includes('ghfast.top · 测速 2.0 MB/s')
        && updateArea.textContent.includes('线路不可用时会自动切换')
        && updateArea.textContent.includes('50% · 5.0 MB / 10.0 MB');
      updateSettings.download_status = {
        ...updateSettings.download_status,
        phase:'verifying',
        bytes_downloaded:10485760,
        progress_percent:99
      };
      updateArea.innerHTML = updateStatusHtml();
      const verifyingStateReady = updateArea.textContent.includes('正在校验')
        && updateArea.textContent.includes('100% · 正在校验 SHA-256');
      updateSettings = {
        ...updateSettings,
        current_version:'1.0.9',
        update_available:false,
        download_status:{state:'failed', error:'fetch failed', progress_percent:18}
      };
      updateArea.innerHTML = updateStatusHtml();
      const staleFailureCleared = updateArea.textContent.includes('已是最新版')
        && updateArea.textContent.includes('当前无需下载')
        && !updateArea.textContent.includes('下载失败')
        && !updateArea.textContent.includes('fetch failed')
        && !document.querySelector('#downloadUpdateBtn');
      updateSettings = {
        ...updateSettings,
        current_version:'1.0.8',
        update_available:true,
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
      result.updateUi = updateCardReady
        && probingStateReady
        && selectedRouteReady
        && verifyingStateReady
        && staleFailureCleared
        && portableActionsReady
        && installerActionsReady;
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
  const connectionStartupUi = await window.webContents.executeJavaScript(`(async () => {
    const originalApi=api;
    const originalNotify=notify;
    let testedPayload=null;
    const notices=[];
    api=async (path,options={}) => {
      if(path==='/api/test-ssh'){
        testedPayload=JSON.parse(options.body||'{}');
        return {
          ok:true,
          elapsed_ms:12,
          capabilities:{
            platform:'linux',
            platform_label:'Linux',
            default_shell:{name:'bash',label:'Bash',path:'/bin/bash'},
            profiles:[
              {id:'bash',kind:'shell',label:'Bash',path:'/bin/bash',args:'-l',platform:'posix',is_default:true},
              {id:'python3',kind:'repl',label:'Python 3',path:'/usr/bin/python3',args:'-i',platform:'posix',is_default:false},
              {id:'tmux',kind:'session',label:'tmux',path:'/usr/bin/tmux',args:'new-session -A -s tunneldesk',platform:'posix',is_default:false}
            ],
            tools:[{id:'git',label:'Git',path:'/usr/bin/git'}],
            warnings:[]
          }
        };
      }
      return {};
    };
    notify=(...args)=>notices.push(args);
    newConnection();
    const form=document.querySelector('#connectionForm');
    document.querySelector('#conn_name').value='startup-smoke';
    document.querySelector('#conn_user').value='root';
    document.querySelector('#conn_host').value='example.test';
    document.querySelector('#conn_terminal_startup_mode').value='program';
    document.querySelector('#conn_terminal_profile_name').value='My shell';
    document.querySelector('#conn_terminal_profile_kind').value='custom';
    document.querySelector('#conn_terminal_program_path').value='/custom/my-shell';
    document.querySelector('#conn_terminal_program_args').value='--interactive';
    toggleConnectionTerminalStartup(form);
    await testConnectionForm(document.querySelector('#connTestBtn'));
    const select=document.querySelector('#conn_terminal_profile_select');
    const customPreserved=document.querySelector('#conn_terminal_program_path').value==='/custom/my-shell'
      && select.value==='__current__';
    const pythonOption=[...select.options].find(option=>option.textContent.includes('Python 3'));
    if(pythonOption) applyConnectionTerminalProfile(pythonOption.value,select);
    const detectedApplied=document.querySelector('#conn_terminal_program_path').value==='/usr/bin/python3'
      && document.querySelector('#conn_terminal_program_args').value==='-i'
      && document.querySelector('#conn_terminal_profile_kind').value==='repl'
      && document.querySelector('#conn_terminal_program_platform').value==='posix';
    document.querySelector('#conn_host').value='changed.example';
    document.querySelector('#conn_host').dispatchEvent(new Event('input',{bubbles:true}));
    const card=document.querySelector('.terminal-startup-card');
    const formRect=form.getBoundingClientRect();
    const cardRect=card?.getBoundingClientRect();
    const result={
      found:Boolean(form&&card&&select),
      defaultMode:testedPayload?.terminal_startup_mode==='program',
      requestedDiscovery:testedPayload?.discover_terminal===true,
      customPreserved,
      categories:[...select.querySelectorAll('optgroup')].map(group=>group.label),
      toolShown:document.querySelector('#connTerminalCapabilities')?.textContent.includes('Git'),
      detectedApplied,
      stale:form._terminalProbeStale===true&&document.querySelector('#connTerminalDetectionStatus')?.textContent.includes('已变化'),
      noOverflow:Boolean(cardRect&&cardRect.left>=formRect.left-0.5&&cardRect.right<=formRect.right+0.5),
      pathRequired:document.querySelector('#conn_terminal_program_path').required===true
    };
    api=originalApi;
    notify=originalNotify;
    return result;
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
    const previousTheme = document.documentElement.dataset.theme || 'light';
    const fixturePane = workspaceFindPane(focusedPaneId);
    const previousFixtureTabs = fixturePane ? [...fixturePane.tabs] : [];
    const previousFixtureActive = fixturePane?.activeTabKey || '';
    tabs.push({key,title:'终端测试',subtitle:'',viewName:'terminal',closable:true,kind:'terminal',id:first.id});
    if (fixturePane) {
      fixturePane.tabs.push(key);
      fixturePane.activeTabKey = key;
    }
    activeTabKey = key;
    activeView = 'terminal';
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
    const desktopToolbarInHeader = statusIndicator?.closest('#workspaceGlobalHeaderTools') !== null
      && document.querySelector('#workspaceGlobalHeaderTools')?.hidden === false
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
    const terminalBoxStyle=getComputedStyle(mount);
    const terminalFrameColors=[terminalBoxStyle.borderTopColor,terminalBoxStyle.borderRightColor,terminalBoxStyle.borderBottomColor];
    const terminalBackgroundColor=terminalBoxStyle.backgroundColor;
    const colorChannels=value=>{
      const channels=(value.match(/[\\d.]+/g)||[]).slice(0,3).map(Number);
      return value.startsWith('color(srgb ') ? channels.map(channel=>channel*255) : channels;
    };
    const backgroundChannels=colorChannels(terminalBackgroundColor);
    const terminalFrameLowContrast=backgroundChannels.length===3&&terminalFrameColors.every(color=>{
      const channels=colorChannels(color);
      return channels.length===3
        && Math.max(...channels)<140
        && Math.max(...channels.map((channel,index)=>Math.abs(channel-backgroundChannels[index])))<=48;
    });
    const dropApi=api;
    const dropChoice=chooseModal;
    const dropRefreshJobs=refreshSftpJobs;
    const dropStartJobsTimer=startSftpJobsTimer;
    const dropUploadWithProgress=uploadWithProgress;
    const dropNotify=notify;
    const terminalDropCalls={crossCopies:[],uploadJobs:[],uploads:[],prompts:[],notices:[]};
    const terminalDropFeedbackFixtures=[];
    let terminalDropUi={found:false};
    try {
      latencySession.connected=true;
      latencySession.currentDirectory='/workspace/current';
      latencySession.currentDirectoryKnown=true;
      latencySession.mount=mount;
      bindTerminalDropUpload(latencySession,first,key,mount);
      api=async (pathname,options={})=>{
        const body=options.body ? JSON.parse(options.body) : {};
        if(pathname.endsWith('/sftp/upload-plan')) {
          return {items:(body.filenames||[]).map(name=>({name,exists:true}))};
        }
        if(pathname.endsWith('/sftp/cross-copy')) {
          terminalDropCalls.crossCopies.push({pathname,body});
          return {id:'terminal-copy-job',type:'cross-copy',status:'pending',progress:0};
        }
        if(pathname.endsWith('/sftp/upload-job')) {
          terminalDropCalls.uploadJobs.push({pathname,body});
          return {id:'terminal-upload-job',type:'upload',status:'running',progress:0};
        }
        if(pathname==='/api/sftp/jobs') return [];
        return dropApi(pathname,options);
      };
      chooseModal=async (title,message,actions)=>{
        terminalDropCalls.prompts.push({
          title:String(title||''),
          message:String(message||''),
          values:actions.map(action=>action.value),
          hint:document.querySelector('#sftpDragHint')?.textContent||''
        });
        return 'rename';
      };
      refreshSftpJobs=async()=>[];
      startSftpJobsTimer=()=>{};
      uploadWithProgress=async (url,body,job)=>{
        terminalDropCalls.uploads.push({url,name:body?.name||'',jobId:job?.id||''});
        return {...job,status:'done',progress:100};
      };
      notify=(text,type='info')=>terminalDropCalls.notices.push({text:String(text||''),type});
      const dispatchDropEvent=(type,dataTransfer)=>{
        const event=new Event(type,{bubbles:true,cancelable:true});
        Object.defineProperty(event,'dataTransfer',{value:dataTransfer});
        mount.dispatchEvent(event);
        return event;
      };
      const createSftpDropFeedbackFixture=tabKey=>{
        const root=document.createElement('div');
        root.dataset.sftpTabKey=tabKey;
        root.style.cssText='position:fixed;left:8px;top:8px;width:220px;height:160px;';
        root.innerHTML='<div class="sftp-shell" style="width:100%;height:100%"><div id="sftpDropOverlay" class="sftp-drop-overlay" hidden></div></div>';
        document.body.appendChild(root);
        ensureSftpRuntime(tabKey,first.id,'.',root);
        terminalDropFeedbackFixtures.push({tabKey,root});
        return root.querySelector('#sftpDropOverlay');
      };
      const firstSftpFeedback=createSftpDropFeedbackFixture('ui-drop-feedback-sftp-1');
      const secondSftpFeedback=createSftpDropFeedbackFixture('ui-drop-feedback-sftp-2');
      const targetSwitchDataTransfer={types:['Files'],files:[],items:[],dropEffect:''};
      setSftpExternalDropState(true,{tabKey:'ui-drop-feedback-sftp-1',path:'/sftp-1'});
      const firstSftpOnly=firstSftpFeedback.hidden===false&&secondSftpFeedback.hidden===true;
      dispatchDropEvent('dragenter',targetSwitchDataTransfer);
      const terminalAfterFirstSftp=mount.querySelector('.terminal-drop-overlay')?.hidden===false
        &&firstSftpFeedback.hidden===true
        &&secondSftpFeedback.hidden===true
        &&!document.querySelector('#sftpDragHint');
      setSftpExternalDropState(true,{tabKey:'ui-drop-feedback-sftp-2',path:'/sftp-2'});
      const secondSftpAfterTerminal=mount.querySelector('.terminal-drop-overlay')?.hidden===true
        &&firstSftpFeedback.hidden===true
        &&secondSftpFeedback.hidden===false
        &&document.querySelector('#sftpDragHint')?.textContent.includes('/sftp-2');
      setSftpExternalDropState(true,{tabKey:'ui-drop-feedback-sftp-1',path:'/sftp-1'});
      const firstSftpAfterSecond=mount.querySelector('.terminal-drop-overlay')?.hidden===true
        &&firstSftpFeedback.hidden===false
        &&secondSftpFeedback.hidden===true
        &&document.querySelector('#sftpDragHint')?.textContent.includes('/sftp-1');
      setSftpExternalDropState(false,{tabKey:'ui-drop-feedback-sftp-2'});
      const lateLeaveKeepsCurrentTarget=firstSftpFeedback.hidden===false
        &&secondSftpFeedback.hidden===true
        &&document.querySelector('#sftpDragHint')?.textContent.includes('/sftp-1');
      const singleActiveDropTarget=firstSftpOnly&&terminalAfterFirstSftp&&secondSftpAfterTerminal&&firstSftpAfterSecond&&lateLeaveKeepsCurrentTarget;
      clearSftpDragFeedback();
      const copyEntries=[{path:'/remote/source.txt',name:'source.txt',type:'file'}];
      const copyDataTransfer={
        types:[SFTP_INTERNAL_DRAG_MIME],
        files:[],
        items:[],
        dropEffect:'',
        getData(type){
          return type===SFTP_INTERNAL_DRAG_MIME
            ? serializeSftpDragPayload(Number(first.id)+7000,copyEntries,'remote-source-tab')
            : '';
        }
      };
      dispatchDropEvent('dragenter',copyDataTransfer);
      const copyOverEvent=dispatchDropEvent('dragover',copyDataTransfer);
      const dropOverlay=mount.querySelector('.terminal-drop-overlay');
      const dropHint=dropOverlay?.querySelector('.terminal-drop-hint');
      const overlayRect=dropOverlay?.getBoundingClientRect();
      const hintRect=dropHint?.getBoundingClientRect();
      const overlayStyle=dropOverlay?getComputedStyle(dropOverlay):null;
      const copyFeedbackVisible=Boolean(
        dropOverlay&&!dropOverlay.hidden
        &&dropOverlay.dataset.mode==='copy'
        &&dropOverlay.textContent.includes('松开复制到终端当前目录：/workspace/current')
        &&copyOverEvent.defaultPrevented
        &&copyDataTransfer.dropEffect==='copy'
        &&overlayStyle?.borderTopStyle==='dashed'
        &&overlayRect&&hintRect
        &&hintRect.left>=overlayRect.left-0.5
        &&hintRect.right<=overlayRect.right+0.5
        &&hintRect.bottom<=overlayRect.bottom+0.5
      );
      const copyFeedbackMetrics={
        hidden:dropOverlay?.hidden,
        mode:dropOverlay?.dataset.mode||'',
        text:dropOverlay?.textContent||'',
        defaultPrevented:copyOverEvent.defaultPrevented,
        dropEffect:copyDataTransfer.dropEffect,
        borderStyle:overlayStyle?.borderTopStyle||'',
        overlayRect:overlayRect ? {left:overlayRect.left,right:overlayRect.right,top:overlayRect.top,bottom:overlayRect.bottom} : null,
        hintRect:hintRect ? {left:hintRect.left,right:hintRect.right,top:hintRect.top,bottom:hintRect.bottom} : null
      };
      const copyDropEvent=dispatchDropEvent('drop',copyDataTransfer);
      await new Promise(resolve=>setTimeout(resolve,20));
      const copyPrompt=terminalDropCalls.prompts.find(item=>item.title.includes('终端：/workspace/current')&&item.message.includes('source.txt'));
      const copyRequest=terminalDropCalls.crossCopies[0]?.body;
      const sftpCopyToCurrentDirectory=Boolean(
        copyDropEvent.defaultPrevented
        &&copyRequest?.target_connection_id===Number(first.id)
        &&copyRequest?.target==='/workspace/current'
        &&copyRequest?.paths?.[0]==='/remote/source.txt'
        &&copyRequest?.conflict==='rename'
        &&copyPrompt?.values.includes('overwrite')
        &&copyPrompt?.values.includes('rename')
        &&copyPrompt?.values.includes('cancel')
        &&copyPrompt?.hint.includes('正在检查 终端：/workspace/current 并准备复制')
        &&dropOverlay?.hidden===true
      );
      const localFile={name:'duplicate.txt',size:9,webkitRelativePath:''};
      const uploadDataTransfer={types:['Files'],files:[localFile],items:[],dropEffect:''};
      dispatchDropEvent('dragenter',uploadDataTransfer);
      const uploadOverEvent=dispatchDropEvent('dragover',uploadDataTransfer);
      const uploadFeedbackVisible=Boolean(
        dropOverlay&&!dropOverlay.hidden
        &&dropOverlay.dataset.mode==='upload'
        &&dropOverlay.textContent.includes('松开上传到终端当前目录：/workspace/current')
        &&uploadOverEvent.defaultPrevented
        &&uploadDataTransfer.dropEffect==='copy'
      );
      const uploadFeedbackMetrics={
        hidden:dropOverlay?.hidden,
        mode:dropOverlay?.dataset.mode||'',
        text:dropOverlay?.textContent||'',
        defaultPrevented:uploadOverEvent.defaultPrevented,
        dropEffect:uploadDataTransfer.dropEffect
      };
      const uploadDropEvent=dispatchDropEvent('drop',uploadDataTransfer);
      await new Promise(resolve=>setTimeout(resolve,20));
      const uploadPrompt=terminalDropCalls.prompts.find(item=>item.title==='发现同名文件');
      const uploadRequest=terminalDropCalls.uploadJobs[0]?.body;
      const localUploadToCurrentDirectory=Boolean(
        uploadDropEvent.defaultPrevented
        &&uploadRequest?.path==='/workspace/current'
        &&uploadRequest?.filename==='duplicate.txt'
        &&uploadRequest?.conflict==='rename'
        &&terminalDropCalls.uploads[0]?.name==='duplicate.txt'
        &&uploadPrompt?.message.includes('duplicate.txt')
        &&uploadPrompt?.values.includes('overwrite')
        &&uploadPrompt?.values.includes('rename')
        &&uploadPrompt?.values.includes('')
        &&dropOverlay?.hidden===true
      );
      dispatchDropEvent('dragenter',uploadDataTransfer);
      const resizeFeedbackBefore = !dropOverlay.hidden;
      window.dispatchEvent(new Event('resize'));
      await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,20)));
      const resizeFeedbackClears = resizeFeedbackBefore && dropOverlay.hidden && !document.querySelector('#sftpDragHint');
      dispatchDropEvent('dragenter',uploadDataTransfer);
      const staleFeedbackBefore = !dropOverlay.hidden;
      await new Promise(resolve=>setTimeout(resolve,1050));
      const staleFeedbackClears = staleFeedbackBefore && dropOverlay.hidden && !document.querySelector('#sftpDragHint') && latencySession.terminalDropDepth === 0;
      terminalDropUi={
        found:Boolean(dropOverlay&&dropHint),
        copyFeedbackVisible,
        copyFeedbackMetrics,
        sftpCopyToCurrentDirectory,
        uploadFeedbackVisible,
        uploadFeedbackMetrics,
        localUploadToCurrentDirectory,
        singleActiveDropTarget,
        resizeFeedbackClears,
        staleFeedbackClears,
        completionNoticeNotDuplicated:!terminalDropCalls.notices.some(item=>item.text.includes('已上传到')),
        copyTarget:copyRequest?.target||'',
        uploadTarget:uploadRequest?.path||'',
        prompts:terminalDropCalls.prompts
      };
    } finally {
      api=dropApi;
      chooseModal=dropChoice;
      refreshSftpJobs=dropRefreshJobs;
      startSftpJobsTimer=dropStartJobsTimer;
      uploadWithProgress=dropUploadWithProgress;
      notify=dropNotify;
      clearSftpDragFeedback?.();
      document.querySelector('#sftpDragHint')?.remove();
      for(const fixture of terminalDropFeedbackFixtures){
        disposeSftpRuntime(fixture.tabKey);
        fixture.root.remove();
      }
    }
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
    const terminalSettingsPanels=document.querySelector('.terminal-settings-panels');
    selectTerminalSettingsTab('clipboard');
    const terminalClipboardPanel=document.querySelector('#terminalSettingsPanelClipboard');
    const terminalSettingsNoHorizontalOverflow=Boolean(
      terminalSettingsPanels&&terminalClipboardPanel
      &&terminalSettingsPanels.scrollWidth<=terminalSettingsPanels.clientWidth+1
      &&terminalClipboardPanel.scrollWidth<=terminalClipboardPanel.clientWidth+1
    );
    selectTerminalSettingsTab('appearance');
    const terminalSettingsUi={
      open:Boolean(terminalSettingsCard&&!document.querySelector('#modal')?.hidden),
      globalScope:Boolean(terminalSettingsCard?.textContent.includes('应用到全部连接和终端会话')),
      controls:['terminalSettingBackgroundColor','terminalSettingMiddleMouse','terminalSettingRightMouse','terminalSettingCtrlClick','terminalSettingUrlLinks','terminalSettingWordSeparators','terminalSettingAutoCopy','terminalSettingMultilinePaste'].every(id=>Boolean(document.querySelector('#'+id))),
      withinViewport:Boolean(terminalSettingsRect&&terminalSettingsRect.left>=-0.5&&terminalSettingsRect.right<=innerWidth+0.5&&terminalSettingsRect.top>=-0.5&&terminalSettingsRect.bottom<=innerHeight+0.5),
      compact:Boolean(terminalSettingsRect&&terminalSettingsRect.height<480),
      readableWidth:Boolean(terminalSettingsRect&&terminalSettingsRect.width>=Math.min(800,innerWidth-28)-1),
      noHorizontalOverflow:terminalSettingsNoHorizontalOverflow,
      tabs:[...document.querySelectorAll('.terminal-settings-tabs [role="tab"]')].map(tab=>tab.textContent.trim()),
      backgroundModes:[...document.querySelectorAll('input[name="terminalSettingBackgroundMode"]')].map(input=>input.value),
      requestedDefaults:defaultTerminalGlobalSettings.background_mode==='theme'&&defaultTerminalGlobalSettings.url_links_enabled===true&&defaultTerminalGlobalSettings.auto_copy_selection===false&&defaultTerminalGlobalSettings.copy_include_trailing_newline===false,
      editablePasteSetting:document.querySelector('#terminalSettingMultilinePaste')?.selectedOptions[0]?.textContent.includes('可编辑命令窗口')
    };
    terminalSettingsUi.drop=terminalDropUi;
    const whiteBackground=document.querySelector('input[name="terminalSettingBackgroundMode"][value="white"]');
    whiteBackground.checked=true;
    syncTerminalBackgroundForm();
    const whitePreview=document.querySelector('#terminalBackgroundPreview');
    const whitePreviewBackgroundText=whitePreview.style.background;
    const whitePreviewForegroundText=whitePreview.style.color;
    const whitePreviewBackground=colorChannels(whitePreviewBackgroundText);
    const whitePreviewForeground=colorChannels(whitePreviewForegroundText);
    const whitePreviewReadable=whitePreviewBackground.length===3&&whitePreviewBackground.every(channel=>channel>=254)
      &&whitePreviewForeground.length===3&&whitePreviewForeground.every(channel=>channel<=1);
    selectTerminalCustomBackground('#808080');
    const customPreview=document.querySelector('#terminalBackgroundPreview');
    const customPreviewBackground=colorChannels(customPreview.style.background);
    const customPreviewForeground=colorChannels(customPreview.style.color);
    terminalSettingsUi.backgroundPreview=whitePreviewReadable
      &&customPreviewBackground.length===3&&customPreviewBackground.every(channel=>Math.abs(channel-128)<=1)
      &&customPreviewForeground.length===3&&customPreviewForeground.every(channel=>channel<=1)
      && selectedTerminalBackgroundMode()==='custom';
    terminalSettingsUi.backgroundPreviewMetrics={
      whiteBackground:whitePreviewBackgroundText,
      whiteForeground:whitePreviewForegroundText,
      whiteBackgroundChannels:whitePreviewBackground,
      whiteForegroundChannels:whitePreviewForeground,
      customBackground:customPreview.style.background,
      customForeground:customPreview.style.color,
      customBackgroundChannels:customPreviewBackground,
      customForegroundChannels:customPreviewForeground,
      selectedMode:selectedTerminalBackgroundMode(),
      pickerValue:document.querySelector('#terminalSettingBackgroundColor')?.value,
      directCustomBackground:terminalThemeForSettings({background_mode:'custom',background_color:document.querySelector('#terminalSettingBackgroundColor')?.value}).background
    };
    closeTerminalGlobalSettings(key);
    const secondMount=document.createElement('div');
    secondMount.className='terminal-box';
    document.body.appendChild(secondMount);
    const secondTerm={options:{},rows:24,refresh:()=>{}};
    terminalSessions.get(key).mount=mount;
    terminalSessions.set(secondKey,{term:secondTerm,id:first.id,mount:secondMount});
    terminalGlobalSettings=normalizeTerminalGlobalSettings({...defaultTerminalGlobalSettings,background_mode:'custom',background_color:'#808080',word_separators:'-_'});
    applyTerminalGlobalSettingsToSessions();
    const readablePaletteKeys=['black','red','green','yellow','blue','magenta','cyan','white','brightBlack','brightRed','brightGreen','brightYellow','brightBlue','brightMagenta','brightCyan','brightWhite'];
    terminalSettingsUi.appliesToAllOpenSessions=fakeTerm.options.wordSeparator==='-_'&&secondTerm.options.wordSeparator==='-_'
      &&fakeTerm.options.theme?.background==='#808080'&&secondTerm.options.theme?.background==='#808080'
      &&fakeTerm.options.theme?.foreground==='#000000'&&secondTerm.options.theme?.foreground==='#000000'
      &&fakeTerm.options.minimumContrastRatio===4.5&&secondTerm.options.minimumContrastRatio===4.5
      &&mount.style.getPropertyValue('--terminal-background')==='#808080'
      &&secondMount.style.getPropertyValue('--terminal-background')==='#808080';
    terminalSettingsUi.readableCustomPalette=readablePaletteKeys.every(name=>terminalContrastRatio(fakeTerm.options.theme[name],fakeTerm.options.theme.background)>=4.5);
    terminalGlobalSettings=normalizeTerminalGlobalSettings({...defaultTerminalGlobalSettings,background_mode:'theme'});
    applyTheme('dark');
    const followsDark=fakeTerm.options.theme?.background==='#000000'&&fakeTerm.options.theme?.foreground==='#ffffff';
    applyTheme('light');
    terminalSettingsUi.followsTheme=followsDark&&fakeTerm.options.theme?.background==='#ffffff'&&fakeTerm.options.theme?.foreground==='#000000';
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
    toolbarFixture.innerHTML='<div class="terminal-title-row"><span class="terminal-connection-dot"></span><span class="terminal-status">tester@example.invalid:22 · 已连接</span><span class="terminal-latency good">延迟 5 ms</span></div><div class="actions terminal-actions"><button class="icon-button">'+icon('folder-open')+'</button><button class="icon-button">'+icon('minus')+'</button><button class="icon-button">'+icon('plus')+'</button><button class="terminal-dropdown-button">'+icon('languages')+'<span>UTF-8</span>'+icon('chevron-down')+'</button><button class="terminal-dropdown-button">'+icon('type')+'<span>字体</span>'+icon('chevron-down')+'</button><button class="icon-button terminal-startup-button">'+icon('command')+'<span>启动</span></button><button class="icon-button terminal-global-settings-button">'+icon('settings')+'</button><button class="terminal-action-keys">'+icon('keyboard')+'<span>快捷键</span></button><button>'+icon('history')+'<span>最近命令</span></button><button>'+icon('link-2')+'<span>重连</span></button><button>'+icon('play')+'<span>启用转发</span></button></div>';
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
    const compactStartupButton=toolbarFixture.querySelector('.terminal-startup-button');
    const compactStartupRect=compactStartupButton.getBoundingClientRect();
    const compactStartupLabel=compactStartupButton.querySelector('span');
    const startupCompactIconOnly=getComputedStyle(compactStartupLabel).display==='none'
      && Math.abs(compactStartupRect.width-30)<=0.5
      && Math.abs(compactStartupRect.height-30)<=0.5;
    toolbarViewFixture.style.width='720px';
    const widerToolbar=toolbarFixture.querySelector('.terminal-actions');
    const widerToolbarRect=widerToolbar.getBoundingClientRect();
    const widerActionsLeftAligned=Math.abs(widerToolbar.querySelector('button').getBoundingClientRect().left-widerToolbarRect.left)<1;
    const wideStartupRect=compactStartupButton.getBoundingClientRect();
    const wideStartupLabelRect=compactStartupLabel.getBoundingClientRect();
    const wideStartupLabelStyle=getComputedStyle(compactStartupLabel);
    const wideStartupIconRect=compactStartupButton.querySelector('svg').getBoundingClientRect();
    const standaloneStartupWideSingleLine=wideStartupLabelStyle.display!=='none'
      && wideStartupLabelStyle.whiteSpace==='nowrap'
      && wideStartupRect.width>30.5
      && Math.abs(wideStartupRect.height-30)<=0.5
      && wideStartupLabelRect.height<=parseFloat(wideStartupLabelStyle.lineHeight)+1
      && wideStartupLabelRect.left>=wideStartupIconRect.right-0.5
      && Math.abs((wideStartupLabelRect.top+wideStartupLabelRect.height/2)-(wideStartupIconRect.top+wideStartupIconRect.height/2))<=1;
    const headerStartupFixture=document.createElement('div');
    headerStartupFixture.className='topbar';
    headerStartupFixture.style.cssText='position:fixed;left:-10000px;top:0;width:760px;';
    headerStartupFixture.innerHTML='<div class="workspace-header-tools workspace-global-header-tools"><div class="terminal-toolbar terminal-toolbar-header"><div class="actions terminal-actions"><button class="icon-button terminal-startup-button">'+icon('command')+'<span>启动</span></button></div></div></div>';
    document.body.appendChild(headerStartupFixture);
    const headerStartupButton=headerStartupFixture.querySelector('.terminal-startup-button');
    const headerStartupLabel=headerStartupButton.querySelector('span');
    const headerHeightBefore=workspaceHeaderHeight;
    const headerStartupFits=[WORKSPACE_HEADER_HEIGHT_MIN,WORKSPACE_HEADER_HEIGHT_DEFAULT,WORKSPACE_HEADER_HEIGHT_MAX].every(height=>{
      applyWorkspaceHeaderHeight(height,{fit:false});
      const buttonRect=headerStartupButton.getBoundingClientRect();
      const labelRect=headerStartupLabel.getBoundingClientRect();
      const labelStyle=getComputedStyle(headerStartupLabel);
      return labelStyle.display!=='none'
        && labelStyle.whiteSpace==='nowrap'
        && buttonRect.width>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--workspace-header-control-height'))+4
        && headerStartupButton.scrollWidth<=headerStartupButton.clientWidth
        && labelRect.left>=buttonRect.left-0.5
        && labelRect.right<=buttonRect.right+0.5
        && labelRect.top>=buttonRect.top-0.5
        && labelRect.bottom<=buttonRect.bottom+0.5;
    });
    applyWorkspaceHeaderHeight(headerHeightBefore,{fit:false});
    headerStartupFixture.remove();
    const startupWideSingleLine=standaloneStartupWideSingleLine&&headerStartupFits;
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
    const staleToolbar=document.createElement('div');
    staleToolbar.className='terminal-toolbar';
    staleToolbar.dataset.workspaceToolbarKind='terminal';
    staleToolbar.dataset.workspaceTabKey='terminal-stale-toolbar';
    staleToolbar.innerHTML='<span id="terminalStatus" data-connection-address="stale:22"></span>';
    document.querySelector('#workspaceGlobalHeaderTools')?.appendChild(staleToolbar);
    const replacementToolbar=document.createElement('div');
    replacementToolbar.className='terminal-toolbar';
    replacementToolbar.innerHTML='<div class="terminal-title-row"><span id="terminalStatus" class="terminal-status" data-connection-address="replacement:22" data-connection-state="已连接"></span></div><div class="actions terminal-actions"></div>';
    replacementMount.appendChild(replacementToolbar);
    syncTerminalToolbarPlacement();
    const activeToolbarReplacesPrevious=document.querySelector('#workspaceGlobalHeaderTools')?.children.length===1
      && document.querySelector('#workspaceGlobalHeaderTools')?.firstElementChild===replacementToolbar
      && replacementMount.children.length===0
      && !staleToolbar.isConnected
      && terminalElementForKey(key,'#terminalStatus')===replacementToolbar.querySelector('#terminalStatus');
    hideActionMenu();
    terminalSessions.delete(secondKey);
    terminalSessions.delete(key);
    secondMount.remove();
    terminalGlobalSettings = previousTerminalGlobalSettings;
    applyTheme(previousTheme);
    tabs = tabs.filter(tab=>tab.key!==key);
    if (fixturePane) {
      fixturePane.tabs = previousFixtureTabs;
      fixturePane.activeTabKey = previousFixtureActive;
    }
    activeTabKey = previousTerminalTabKey;
    terminalLatencyVisible = previousLatencyVisible;
    if (previousLatencyStored === null) localStorage.removeItem('terminalLatencyVisible');
    else localStorage.setItem('terminalLatencyVisible', previousLatencyStored);
    return {found:true,labels,metrics,desktopBackHidden,desktopKeysHidden,binaryType,binaryWrite,encodingMenuOpened,fontMenuOpened,statusHoverShowsFull,desktopStatusAvoidsDuplicate,desktopToolbarInHeader,connectionToggleUsesLinkAction,activeToolbarReplacesPrevious,narrowToolbarFits,narrowToolbarLeftAligned,responsiveToolbarFits,startupCompactIconOnly,startupWideSingleLine,terminalFrameLowContrast,terminalFrameColors,terminalBackgroundColor,latencyMeasured,latencyCanDisable,latencyCanEnable,terminalSettingsUi};
  })()`);
  const terminalStartupOriginalContentSize = window.getContentSize();
  window.setContentSize(1000, 600);
  await new Promise(resolve => setTimeout(resolve, 50));
  const terminalStartupUi = await window.webContents.executeJavaScript(`(async () => {
    const connection=connections[0];
    if(!connection) return {found:false};
    const key='terminal-startup-smoke';
    const otherKey='terminal-startup-smoke-other';
    const newKey='terminal-startup-smoke-new';
    const splitKey='terminal-startup-smoke-split';
    const originalApi=api;
    const originalNotify=notify;
    const originalReconnect=reconnectTerminal;
    const originalDuplicateWorkspaceTab=duplicateWorkspaceTab;
    const originalStartup=terminalStartupConfigForConnection(connection);
    const reconnects=[];
    const notices=[];
    const duplicateCalls=[];
    let savedPayload=null;
    api=async (path,options={}) => {
      if(path.endsWith('/terminal-capabilities')) return {capabilities:{
        platform:'linux',
        platform_label:'Linux',
        default_shell:{name:'bash',label:'Bash',path:'/bin/bash'},
        profiles:[
          {id:'bash',kind:'shell',label:'Bash',path:'/bin/bash',args:'-l',platform:'posix',is_default:true},
          {id:'python3',kind:'repl',label:'Python 3',path:'/usr/bin/python3',args:'-i',platform:'posix',is_default:false}
        ],
        tools:[{id:'git',label:'Git',path:'/usr/bin/git'}],
        warnings:[]
      }};
      if(path.endsWith('/terminal-startup')){
        savedPayload=JSON.parse(options.body||'{}');
        return {startup:savedPayload};
      }
      return {};
    };
    notify=(...args)=>notices.push(args);
    reconnectTerminal=(id,tabKey)=>reconnects.push({id,tabKey});
    duplicateWorkspaceTab=(sourceKey,options={}) => {
      const duplicateKey=duplicateCalls.length===0?newKey:splitKey;
      if(typeof options.beforeOpen==='function') options.beforeOpen(duplicateKey,'复制终端',tabs.find(tab=>tab.key===sourceKey));
      duplicateCalls.push({sourceKey,splitZone:options.splitZone||'',duplicateKey});
      return duplicateKey;
    };
    tabs.push({key,title:'启动配置测试',viewName:'terminal',kind:'terminal',id:connection.id,closable:true});
    terminalSessions.set(key,{id:connection.id,term:{reset(){},focus(){}}});
    terminalSessions.set(otherKey,{id:connection.id,term:{reset(){},focus(){}}});
    showTerminalStartupSettings(key,connection.id);
    await new Promise(resolve=>setTimeout(resolve,25));
    const modal=document.querySelector('#modal');
    const card=modal.querySelector('.terminal-startup-modal');
    const profileSelect=document.querySelector('#terminalStartupProfile');
    const pythonOption=[...profileSelect.options].find(option=>option.textContent.includes('Python 3'));
    const controlsPresent=['terminalStartupProfile','terminalStartupPath','terminalStartupArgs','terminalStartupCwd','terminalStartupSaveDefault','terminalStartupCurrent','terminalStartupNewTab','terminalStartupSplit'].every(id=>Boolean(document.querySelector('#'+id)));
    const saveDefaultUnchecked=document.querySelector('#terminalStartupSaveDefault')?.checked===false;
    profileSelect.value=pythonOption?.value||'custom';
    chooseTerminalStartupProfile();
    await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
    const cardRect=card?.getBoundingClientRect();
    const scrollRegion=card?.querySelector('.terminal-startup-scroll');
    const header=card?.querySelector('.terminal-settings-head');
    const actionBar=card?.querySelector('.terminal-startup-actions');
    const scrollStyle=scrollRegion?getComputedStyle(scrollRegion):null;
    const headerRect=header?.getBoundingClientRect();
    const actionRect=actionBar?.getBoundingClientRect();
    const modalFitsShortViewport=Boolean(cardRect
      && cardRect.left>=-0.5
      && cardRect.right<=innerWidth+0.5
      && cardRect.top>=-0.5
      && cardRect.bottom<=innerHeight+0.5);
    const bodyScrollsInShortViewport=Boolean(scrollRegion
      && scrollStyle?.overflowY==='auto'
      && scrollRegion.scrollHeight>scrollRegion.clientHeight+1);
    const fixedHeaderAndActions=Boolean(headerRect
      && actionRect
      && cardRect
      && headerRect.top>=cardRect.top-0.5
      && actionRect.bottom<=cardRect.bottom+0.5
      && actionRect.top>headerRect.bottom);
    if(scrollRegion) scrollRegion.scrollTop=scrollRegion.scrollHeight;
    await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
    const actionAfterScroll=actionBar?.getBoundingClientRect();
    const actionsStayVisibleWhileScrolling=Boolean(actionAfterScroll
      && cardRect
      && actionAfterScroll.top>=cardRect.top-0.5
      && actionAfterScroll.bottom<=cardRect.bottom+0.5);
    modal.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    const backdropIgnored=!modal.hidden&&Boolean(modal.querySelector('.terminal-startup-modal'));
    await applyTerminalStartupSettings(key,connection.id,'current');
    const temporary=terminalStartupOverrides.get(key);
    const currentTemporaryOnly=temporary?.terminal_program_path==='/usr/bin/python3'
      && !terminalStartupOverrides.has(otherKey)
      && savedPayload===null
      && reconnects.length===1
      && reconnects[0].tabKey===key;
    terminalStartupOverrides.set(otherKey,normalizeTerminalStartupConfig({
      terminal_startup_mode:'program',
      terminal_profile_name:'Other tab',
      terminal_profile_kind:'shell',
      terminal_program_path:'/bin/zsh',
      terminal_program_args:'-l',
      terminal_program_platform:'posix'
    }));
    showTerminalStartupSettings(key,connection.id);
    await new Promise(resolve=>setTimeout(resolve,25));
    document.querySelector('#terminalStartupProfile').value='custom';
    document.querySelector('#terminalStartupProfileName').value='Permanent Bash';
    document.querySelector('#terminalStartupKind').value='shell';
    document.querySelector('#terminalStartupPath').value='/bin/bash';
    document.querySelector('#terminalStartupArgs').value='-l';
    document.querySelector('#terminalStartupPlatform').value='posix';
    document.querySelector('#terminalStartupSaveDefault').checked=true;
    const checkDoesNotSave=savedPayload===null;
    await applyTerminalStartupSettings(key,connection.id,'current');
    const checkedCurrentSaves=savedPayload?.terminal_program_path==='/bin/bash'
      && connection.terminal_program_path==='/bin/bash'
      && !terminalStartupOverrides.has(key)
      && terminalStartupOverrides.get(otherKey)?.terminal_program_path==='/bin/zsh'
      && reconnects.length===2
      && reconnects.every(item=>item.tabKey===key);
    showTerminalStartupSettings(key,connection.id);
    await new Promise(resolve=>setTimeout(resolve,25));
    const newProfileSelect=document.querySelector('#terminalStartupProfile');
    const newPythonOption=[...newProfileSelect.options].find(option=>option.textContent.includes('Python 3'));
    newProfileSelect.value=newPythonOption?.value||'custom';
    chooseTerminalStartupProfile();
    const newTabDefaultsTemporary=document.querySelector('#terminalStartupSaveDefault')?.checked===false;
    const reconnectsBeforeNew=reconnects.length;
    await applyTerminalStartupSettings(key,connection.id,'new');
    const newTabTemporary=duplicateCalls.length===1
      && duplicateCalls[0].sourceKey===key
      && duplicateCalls[0].splitZone===''
      && terminalStartupOverrides.get(newKey)?.terminal_program_path==='/usr/bin/python3'
      && !terminalStartupOverrides.has(key)
      && reconnects.length===reconnectsBeforeNew;
    showTerminalStartupSettings(key,connection.id);
    await new Promise(resolve=>setTimeout(resolve,25));
    const splitProfileSelect=document.querySelector('#terminalStartupProfile');
    const splitPythonOption=[...splitProfileSelect.options].find(option=>option.textContent.includes('Python 3'));
    splitProfileSelect.value=splitPythonOption?.value||'custom';
    chooseTerminalStartupProfile();
    const splitPicker=document.querySelector('.terminal-startup-split-picker');
    const splitTrigger=document.querySelector('#terminalStartupSplit');
    const splitOptions=document.querySelector('.terminal-startup-split-options');
    const splitButtons=[...splitOptions.querySelectorAll('[role="menuitem"][data-split-zone]')];
    const splitZones=splitButtons.map(button=>button.dataset.splitZone);
    const splitCenter=splitOptions.querySelector('.terminal-startup-split-center');
    const splitCenterPresent=Boolean(splitCenter);
    const splitInteractionSelectors=[...document.styleSheets].flatMap(sheet=>{
      try { return [...sheet.cssRules].map(rule=>rule.selectorText||''); }
      catch { return []; }
    });
    const splitHoverRulePresent=splitInteractionSelectors.some(selector=>selector.includes('.terminal-startup-split-picker:hover')&&selector.includes('.terminal-startup-split-options'));
    const splitFocusRulePresent=splitInteractionSelectors.some(selector=>selector.includes('.terminal-startup-split-picker:focus-within')&&selector.includes('.terminal-startup-split-options'));
    const splitInitiallyCollapsed=getComputedStyle(splitOptions).visibility==='hidden'
      && getComputedStyle(splitOptions).pointerEvents==='none';
    splitOptions.style.transition='none';
    if(splitCenter) splitCenter.style.transition='none';
    splitButtons.forEach(button=>{ button.style.transition='none'; });
    splitTrigger.focus();
    await new Promise(resolve=>setTimeout(resolve,0));
    const focusedSplitStyle=getComputedStyle(splitOptions);
    const splitExpandsOnFocus=document.activeElement===splitTrigger
      && focusedSplitStyle.visibility==='visible'
      && focusedSplitStyle.pointerEvents==='auto'
      && Number.parseFloat(focusedSplitStyle.opacity)>0.9
      && splitButtons.every(button=>{
        const style=getComputedStyle(button);
        const rect=button.getBoundingClientRect();
        return style.visibility!=='hidden'&&style.pointerEvents!=='none'&&Number.parseFloat(style.opacity)>0.9&&rect.width>0&&rect.height>0;
      });
    const reconnectsBeforeSplit=reconnects.length;
    splitButtons.find(button=>button.dataset.splitZone==='right')?.click();
    await new Promise(resolve=>setTimeout(resolve,25));
    const splitOpenUsesDirection=duplicateCalls.length===2
      && duplicateCalls[1].sourceKey===key
      && duplicateCalls[1].splitZone==='right'
      && terminalStartupOverrides.get(splitKey)?.terminal_program_path==='/usr/bin/python3'
      && reconnects.length===reconnectsBeforeSplit;
    const fourSplitDirections=splitCenterPresent
      && splitButtons.length===4
      && ['top','bottom','left','right'].every(zone=>splitZones.includes(zone))
      && splitHoverRulePresent
      && splitFocusRulePresent;
    duplicateWorkspaceTab=originalDuplicateWorkspaceTab;
    let resolveSlowCapabilities;
    let capabilityRaceCall=0;
    api=async path => {
      if(!path.endsWith('/terminal-capabilities')) return {};
      capabilityRaceCall+=1;
      if(capabilityRaceCall===1) {
        return new Promise(resolve=>{ resolveSlowCapabilities=resolve; });
      }
      return {capabilities:{
        platform:'macos',
        platform_label:'Race B',
        default_shell:{name:'zsh',label:'Zsh',path:'/bin/zsh'},
        profiles:[{id:'zsh',kind:'shell',label:'Zsh',path:'/bin/zsh',args:'-l',platform:'posix',is_default:true}],
        tools:[],
        warnings:[]
      }};
    };
    showTerminalStartupSettings(key,connection.id);
    await new Promise(resolve=>setTimeout(resolve,0));
    closeTerminalStartupSettings(key);
    showTerminalStartupSettings(otherKey,connection.id);
    await new Promise(resolve=>setTimeout(resolve,25));
    resolveSlowCapabilities?.({capabilities:{
      platform:'linux',
      platform_label:'Race A',
      default_shell:{name:'bash',label:'Bash',path:'/bin/bash'},
      profiles:[{id:'python3',kind:'repl',label:'Python 3',path:'/usr/bin/python3',args:'-i',platform:'posix',is_default:false}],
      tools:[],
      warnings:[]
    }});
    await new Promise(resolve=>setTimeout(resolve,25));
    const raceOptions=[...document.querySelectorAll('#terminalStartupProfile option')].map(option=>option.textContent);
    const requestRaceIsolated=document.querySelector('#terminalStartupCapabilitySummary')?.textContent.includes('Race B')
      && raceOptions.some(label=>label.includes('Zsh'))
      && !raceOptions.some(label=>label.includes('Python 3'));
    closeTerminalStartupSettings(otherKey);
    const closedKey='terminal-startup-smoke-closed';
    const OriginalWebSocket=window.WebSocket;
    let hiddenSocketCount=0;
    let resolveStartupTicket;
    class HiddenSessionWebSocket extends EventTarget {
      static OPEN=1;
      constructor(){ super(); hiddenSocketCount+=1; this.readyState=1; }
      close(){}
      send(){}
    }
    window.WebSocket=HiddenSessionWebSocket;
    api=async path => {
      if(path==='/api/terminal/startup-tickets') {
        return new Promise(resolve=>{ resolveStartupTicket=resolve; });
      }
      return {};
    };
    tabs.push({key:closedKey,title:'等待关闭',viewName:'terminal',kind:'terminal',id:connection.id});
    terminalSessions.set(closedKey,{
      id:connection.id,
      term:{cols:80,rows:24,writeln(){},dispose(){}},
      connectionAttempt:0
    });
    terminalStartupOverrides.set(closedKey,normalizeTerminalStartupConfig({
      terminal_startup_mode:'program',
      terminal_profile_name:'Python 3',
      terminal_profile_kind:'repl',
      terminal_program_path:'/usr/bin/python3',
      terminal_program_args:'-i',
      terminal_program_platform:'posix'
    }));
    const pendingClosedConnect=connectTerminal(connection,closedKey);
    await new Promise(resolve=>setTimeout(resolve,0));
    closeTerminalSession(closedKey);
    tabs=tabs.filter(tab=>tab.key!==closedKey);
    resolveStartupTicket?.({token:'closed-tab-ticket'});
    await pendingClosedConnect;
    const closedTabDoesNotConnect=hiddenSocketCount===0
      && !terminalSessions.has(closedKey)
      && !terminalStartupOverrides.has(closedKey);
    window.WebSocket=OriginalWebSocket;
    const result={
      found:Boolean(card&&profileSelect),
      controls:controlsPresent,
      capabilities:Boolean(pythonOption&&card?.textContent.includes('Git')),
      withinViewport:Boolean(cardRect&&cardRect.left>=-0.5&&cardRect.right<=innerWidth+0.5&&cardRect.top>=-0.5&&cardRect.bottom<=innerHeight+0.5),
      modalFitsShortViewport,
      bodyScrollsInShortViewport,
      fixedHeaderAndActions,
      actionsStayVisibleWhileScrolling,
      backdropIgnored,
      saveDefaultUnchecked,
      currentTemporaryOnly,
      checkDoesNotSave,
      checkedCurrentSaves,
      newTabDefaultsTemporary,
      newTabTemporary,
      splitInitiallyCollapsed,
      splitExpandsOnFocus,
      fourSplitDirections,
      splitOpenUsesDirection,
      requestRaceIsolated,
      closedTabDoesNotConnect,
      reconnectNotice:notices.some(args=>String(args[0]).includes('本终端'))
    };
    Object.assign(connection,originalStartup);
    terminalStartupOverrides.delete(key);
    terminalStartupOverrides.delete(otherKey);
    terminalStartupOverrides.delete(newKey);
    terminalStartupOverrides.delete(splitKey);
    terminalSessions.delete(key);
    terminalSessions.delete(otherKey);
    tabs=tabs.filter(tab=>![key,newKey,splitKey].includes(tab.key));
    api=originalApi;
    notify=originalNotify;
    reconnectTerminal=originalReconnect;
    duplicateWorkspaceTab=originalDuplicateWorkspaceTab;
    closeModal();
    return result;
  })()`);
  window.setContentSize(...terminalStartupOriginalContentSize);
  await new Promise(resolve => setTimeout(resolve, 50));
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
    const previousNavigateSftpPath = navigateSftpPath;
    const previousPreview = previewSftpText;
    const previousClipboardState = sftpClipboard;
    const previousLoadSftpPage = loadSftpPage;
    const previousRefreshSftpJobs = refreshSftpJobs;
    const previousStartSftpJobsTimer = startSftpJobsTimer;
    const previousSelectedId = selectedId;
    const previousActiveView = activeView;
    const previousActiveTabKey = activeTabKey;
    const previousFocusedPaneId = focusedPaneId;
    const previousWorkspaceLayout = JSON.parse(JSON.stringify(workspaceLayout));
    const previousTabs = tabs.map(tab => ({...tab}));
    const previousSftpRuntimes = [...sftpTabRuntimes.entries()];
    const previousSftpTabCounts = [...sftpTabCounts.entries()];
    const previousSftpActiveRuntimeKey = sftpActiveRuntimeKey;
    const previousSftpRequestController = sftpRequestController;
    const previousSftpSearchTimer = sftpSearchTimer;
    const previousSftpListResizeObserver = sftpListResizeObserver;
    const previousSftpListResizeFrame = sftpListResizeFrame;
    const previousSftpDisconnectedTabs = [...sftpDisconnectedTabs];
    const previousSftpConnectionRequests = [...sftpConnectionRequests.entries()];
    const previousSftpConnectionVersions = [...sftpConnectionVersions.entries()];
    const previousSftpDisconnectRequests = [...sftpDisconnectRequests.entries()];
    const previousDirectorySizes = [...sftpDirectorySizeCache.entries()];
    const connection = connections[0];
    const fixtureTabKey = 'sftp-smoke-' + connection.id;
    let directoryActionsUi = {found:false};
    let connectionSessionUi = {found:false};
    let nativeDragUi = {found:false};
    let globalSettingsUi = {found:false};
    let directoryCacheBehavior = {sameResponseUntouched:false,changedResponseRendered:false,boundedAndExpired:false};
    let sftpPageLoads = 0;
    const sftpPageLoadOptions = [];
    let mutateStubbedSftpPaths = false;
    try {
      loadSftpPage = async options => {
        sftpPageLoads += 1;
        sftpPageLoadOptions.push({...options});
        if (mutateStubbedSftpPaths) {
          const key = String(options.tabKey || "");
          const runtime = sftpTabRuntimes.get(key);
          const tab = tabs.find(item => item.key === key);
          const path = String(options.path || ".");
          if (runtime) runtime.state = {...runtime.state, path, loading:false};
          if (tab) tab.path = path;
          if (runtime && sftpActiveRuntimeKey === key) sftpState = runtime.state;
          if (!options.historyNavigation) rememberSftpNavigation(key, path);
        }
        return true;
      };
      refreshSftpJobs = async () => {};
      startSftpJobsTimer = () => {};
      sftpClipboard = null;
      activeTabKey = fixtureTabKey;
      activeView = 'sftp';
      await openSftp(connection.id, '/Users/junruo/Public', true, fixtureTabKey);
      setWorkspace('切换测试', 'UI', 'welcome', 'sftp-switch-fixture', false, true);
      activeTabKey = fixtureTabKey;
      activeView = 'sftp';
      await openSftp(connection.id, '/Users/junruo/Public', false, fixtureTabKey);
      let stickyTop = view.querySelector('.sftp-top');
      const fixturePane = view.closest('.workspace-pane');
      let toolbar = document.querySelector('#workspaceGlobalHeaderTools .sftp-toolbar') || fixturePane?.querySelector('[data-workspace-role="header-tools"] .sftp-toolbar') || view.querySelector('.sftp-toolbar');
      toolbar?.remove();
      await openSftp(connection.id, '/Users/junruo/Public', false, fixtureTabKey);
      const recoveredMissingToolbar = Boolean(
        document.querySelector('.sftp-toolbar[data-workspace-tab-key="' + CSS.escape(fixtureTabKey) + '"]')
      );
      toolbar = document.querySelector('#workspaceGlobalHeaderTools .sftp-toolbar') || fixturePane?.querySelector('[data-workspace-role="header-tools"] .sftp-toolbar') || view.querySelector('.sftp-toolbar');
      const duplicateSftpKey = 'sftp-' + connection.id + '-901';
      await openSftp(connection.id, '/Users/junruo/Public', true, duplicateSftpKey);
      const duplicateToolbarFirstVisible = Boolean(
        document.querySelector('.sftp-toolbar[data-workspace-tab-key="' + CSS.escape(duplicateSftpKey) + '"]:not([hidden])')
      );
      activateTab(fixtureTabKey);
      await Promise.resolve();
      const originalToolbarVisibleAgain = Boolean(
        document.querySelector('.sftp-toolbar[data-workspace-tab-key="' + CSS.escape(fixtureTabKey) + '"]:not([hidden])')
      );
      activateTab(duplicateSftpKey);
      await Promise.resolve();
      const duplicateToolbarVisibleAgain = Boolean(
        document.querySelector('.sftp-toolbar[data-workspace-tab-key="' + CSS.escape(duplicateSftpKey) + '"]:not([hidden])')
      );
      const duplicateSftpToolbarsFollowActiveTab = duplicateToolbarFirstVisible
        && originalToolbarVisibleAgain
        && duplicateToolbarVisibleAgain;

      const numberingConnectionId = Math.max(100000, ...connections.map(item => Number(item.id || 0))) + 1000;
      const numberingConnection = {...connection, id:numberingConnectionId, name:'SFTP 编号测试'};
      const numberingFirstKey = 'sftp-' + numberingConnectionId + '-7';
      const numberingSecondKey = 'sftp-' + numberingConnectionId + '-11';
      connections.push(numberingConnection);
      tabs.push({key:numberingFirstKey,kind:'sftp',id:numberingConnectionId,title:'SFTP 编号测试 · SFTP #7',path:'/first'});
      syncSftpTabTitles(numberingConnectionId);
      const reopenedSingleTabHasNoSuffix = tabs.find(tab => tab.key === numberingFirstKey)?.title === 'SFTP 编号测试 · SFTP';
      tabs.push({key:numberingSecondKey,kind:'sftp',id:numberingConnectionId,title:'SFTP 编号测试 · SFTP #11',path:'/second'});
      syncSftpTabTitles(numberingConnectionId);
      const twoOpenTabsUseCurrentOrdinals = tabs.find(tab => tab.key === numberingFirstKey)?.title === 'SFTP 编号测试 · SFTP'
        && tabs.find(tab => tab.key === numberingSecondKey)?.title === 'SFTP 编号测试 · SFTP #2';
      const numberingFirstIndex = tabs.findIndex(tab => tab.key === numberingFirstKey);
      if (numberingFirstIndex >= 0) tabs.splice(numberingFirstIndex, 1);
      syncSftpTabTitles(numberingConnectionId);
      const remainingTabRenumberedWithoutChangingKey = tabs.find(tab => tab.key === numberingSecondKey)?.title === 'SFTP 编号测试 · SFTP'
        && tabs.find(tab => tab.key === numberingSecondKey)?.path === '/second';
      const numberingSecondIndex = tabs.findIndex(tab => tab.key === numberingSecondKey);
      if (numberingSecondIndex >= 0) tabs.splice(numberingSecondIndex, 1);
      const numberingConnectionIndex = connections.findIndex(item => Number(item.id) === numberingConnectionId);
      if (numberingConnectionIndex >= 0) connections.splice(numberingConnectionIndex, 1);
      const sftpVisibleNumberingStable = reopenedSingleTabHasNoSuffix
        && twoOpenTabsUseCurrentOrdinals
        && remainingTabRenumberedWithoutChangingKey;

      activateTab(fixtureTabKey);
      await Promise.resolve();
      const fixtureRuntime = sftpTabRuntimes.get(fixtureTabKey);
      const duplicateRuntime = sftpTabRuntimes.get(duplicateSftpKey);
      const fixtureTab = tabs.find(tab => tab.key === fixtureTabKey);
      const duplicateTab = tabs.find(tab => tab.key === duplicateSftpKey);
      fixtureRuntime.state = {...fixtureRuntime.state, path:'/alpha/child'};
      duplicateRuntime.state = {...duplicateRuntime.state, path:'/beta/child'};
      fixtureTab.path = '/alpha/child';
      duplicateTab.path = '/beta/child';
      sftpState = fixtureRuntime.state;
      sftpActiveRuntimeKey = fixtureTabKey;
      sftpNavigationHistories.set(fixtureTabKey, {paths:['/alpha','/alpha/child'],index:1});
      sftpNavigationHistories.set(duplicateSftpKey, {paths:['/beta','/beta/child'],index:1});
      const duplicateHistoryBefore = JSON.stringify(sftpNavigationHistories.get(duplicateSftpKey));
      const fixtureVisibleView = workspaceElementForTab(fixtureTabKey, '#view-sftp');
      const fixtureVisibleShell = fixtureVisibleView?.querySelector(':scope > .sftp-shell');
      const fixtureVisibleToolbar = document.querySelector('.sftp-toolbar[data-workspace-tab-key="' + CSS.escape(fixtureTabKey) + '"]');
      const fixtureUpButton = [...fixtureVisibleView?.querySelectorAll('button') || []].find(button => button.title === '上一级');
      const activeShellMatchesTab = fixtureVisibleView?.dataset.sftpTabKey === fixtureTabKey
        && fixtureVisibleShell?.dataset.sftpTabKey === fixtureTabKey
        && fixtureVisibleToolbar?.dataset.workspaceTabKey === fixtureTabKey
        && fixtureUpButton?.getAttribute('onclick')?.includes("'" + fixtureTabKey + "'");
      const loadsBeforeParentNavigation = sftpPageLoadOptions.length;
      mutateStubbedSftpPaths = true;
      fixtureUpButton?.click();
      await Promise.resolve();
      await Promise.resolve();
      const parentLoad = sftpPageLoadOptions.at(-1);
      const fixturePaneAfterParent = workspaceFindPaneForTab(fixtureTabKey);
      const parentNavigationStaysOnOwner = sftpPageLoadOptions.length === loadsBeforeParentNavigation + 1
        && parentLoad?.tabKey === fixtureTabKey
        && parentLoad?.path === '/alpha'
        && activeTabKey === fixtureTabKey
        && fixturePaneAfterParent?.activeTabKey === fixtureTabKey;
      const duplicateDirectoryStateIsolated = sftpTabRuntimes.get(duplicateSftpKey)?.state.path === '/beta/child'
        && tabs.find(tab => tab.key === duplicateSftpKey)?.path === '/beta/child';
      const duplicateHistoryIsolated = JSON.stringify(sftpNavigationHistories.get(duplicateSftpKey)) === duplicateHistoryBefore;
      activateTab(duplicateSftpKey);
      await Promise.resolve();
      const duplicateVisibleView = workspaceElementForTab(duplicateSftpKey, '#view-sftp');
      const duplicateShellMatchesTab = duplicateVisibleView?.dataset.sftpTabKey === duplicateSftpKey
        && duplicateVisibleView?.querySelector(':scope > .sftp-shell')?.dataset.sftpTabKey === duplicateSftpKey
        && sftpTabRuntimes.get(duplicateSftpKey)?.state.path === '/beta/child';
      mutateStubbedSftpPaths = false;

      const duplicatePane = workspaceFindPaneForTab(duplicateSftpKey);
      if (duplicatePane) {
        duplicatePane.tabs = duplicatePane.tabs.filter(key => key !== duplicateSftpKey);
        duplicatePane.activeTabKey = fixtureTabKey;
      }
      const duplicateTabIndex = tabs.findIndex(tab => tab.key === duplicateSftpKey);
      if (duplicateTabIndex >= 0) tabs.splice(duplicateTabIndex, 1);
      disposeSftpRuntime(duplicateSftpKey);
      activeTabKey = fixtureTabKey;
      activeView = 'sftp';
      await openSftp(connection.id, '/Users/junruo/Public', false, fixtureTabKey);
      toolbar = document.querySelector('#workspaceGlobalHeaderTools .sftp-toolbar') || fixturePane?.querySelector('[data-workspace-role="header-tools"] .sftp-toolbar') || view.querySelector('.sftp-toolbar');
      let navigationRow = view.querySelector('.sftp-navigation-row');
      let breadcrumb = view.querySelector('.sftp-breadcrumb');
      let pathEditor = view.querySelector('#sftpPathEditor');
      let floatingSearch = view.querySelector('#sftpFloatingSearch');
      let dropOverlay = view.querySelector('#sftpDropOverlay');
      let clipboardActions = toolbar?.querySelector('#sftpClipboardActions') || view.querySelector('#sftpClipboardActions') || document.querySelector('#sftpClipboardActions') || document.createElement('span');
      const actionTitles = [...toolbar?.querySelectorAll('button, label') || []].map(node => node.title || node.getAttribute('aria-label') || '').filter(Boolean);
      const emptyClipboardHidden = Boolean(clipboardActions && !clipboardActions.querySelector('button') && !clipboardActions.textContent.trim());
      const reusedWithSilentRefresh = sftpPageLoads >= 2
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
        && view.querySelector('#sftpPathEditButton')?.hidden
        && visiblePathControls.length === 1
        && visiblePathControls[0] === pathEditor
      );
      hideSftpPathEditor();
      const preservedListHtml = view.querySelector('#sftpList')?.innerHTML;
      updateSftpConnectionUi(connection.id, 'disconnected', '测试断线');
      const disconnectedButton = sftpElement('sftpConnectionToggle', fixtureTabKey);
      const disconnectedBanner = view.querySelector('#sftpConnectionBanner');
      const disconnectedAction = Boolean(disconnectedButton?.querySelector('.lucide-link-2') && !disconnectedButton?.querySelector('.lucide-link-2-off'));
      const bannerVisible = Boolean(disconnectedBanner && !disconnectedBanner.hidden && disconnectedBanner.querySelector('.sftp-connection-detail')?.textContent === '测试断线');
      const preservedWhileDisconnected = view.querySelector('#sftpList')?.innerHTML === preservedListHtml;
      updateSftpConnectionUi(connection.id, 'connected');
      sftpDisconnectedTabs.add(fixtureTabKey);
      const disconnectedPageLoads = sftpPageLoads;
      await openSftp(connection.id, '/Users/junruo/Public', false, fixtureTabKey);
      const disconnectedTabSwitchDoesNotReconnect = sftpPageLoads === disconnectedPageLoads;
      await openSftp(connection.id, '/Users/junruo/Public', true, fixtureTabKey);
      const disconnectedFolderOperationReconnects = sftpPageLoads === disconnectedPageLoads + 1;
      const savedConnectApi = api;
      let automaticConnectCalls = 0;
      updateSftpConnectionUi(connection.id, 'disconnected');
      sftpDisconnectedTabs.add(fixtureTabKey);
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
      const automaticConnectStatus = tabs.find(tab=>tab.key===fixtureTabKey)?.connectionStatus || '';
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
        && tabs.find(tab=>tab.key===fixtureTabKey)?.connectionStatus === 'connected'
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
        handleSftpNativeDragPointerCancel({pointerId:8080});
        const streamingCaptureCancelSurvives = sftpNativeDragPointer?.nativeRequestId === streamingCall?.requestId
          && nativeDragCancelCalls.length === cancelCallsBeforeCapture
          && nativeDragActivateCalls.length === 2
          && nativeDragActivateCalls.at(-1) === streamingCall?.requestId;
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
        handleSftpNativeDragPointerMove({
          pointerId:8081,
          buttons:1,
          clientX:28,
          clientY:20
        });
        handleSftpNativeDragEvent({type:'ready',requestId:pendingPointerRequest});
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
      sftpInternalDrag = {
        connectionId:Number(dragTargetConnection.id),
        sourceTabKey:'sftp-same-host-source',
        entries:[{path:'/source/local.txt',name:'local.txt',type:'file'}],
        row:null
      };
      const sameHostDropEvent = {
        defaultPrevented:false,
        propagationStopped:false,
        preventDefault(){ this.defaultPrevented = true; },
        stopPropagation(){ this.propagationStopped = true; },
        dataTransfer:{types:['application/x-tunneldesk-sftp'],dropEffect:'copy'}
      };
      await handleSftpDrop(sameHostDropEvent);
      const sameHostListDropCopies = sameHostDropEvent.defaultPrevented
        && sameHostDropEvent.dataTransfer.dropEffect === 'copy'
        && crossDropRequests.length === 2
        && crossDropRequests[1].body.target_connection_id === dragTargetConnection.id
        && crossDropRequests[1].body.target === '/target'
        && crossDropRequests[1].body.paths?.[0] === '/source/local.txt'
        && sftpInternalDrag === null
        && !document.querySelector('#sftpDragHint');
      if (webCrossHostBridgeDescriptor) Object.defineProperty(window, 'tunnelDeskDesktop', webCrossHostBridgeDescriptor);
      else delete window.tunnelDeskDesktop;
      api = dragDropApi;
      resetSftpItemDrag();
      tabs.splice(tabs.findIndex(item => item.key === dragTargetTab.key), 1);
      connections.splice(connections.findIndex(item => Number(item.id) === Number(dragTargetConnection.id)), 1);
      activeTabKey = sourceSftpTabKey;
      const sourcePane = workspaceFindPaneForTab(sourceSftpTabKey);
      if (sourcePane) {
        sourcePane.tabs = sourcePane.tabs.filter(key=>key!==dragTargetTab.key);
        sourcePane.activeTabKey = sourceSftpTabKey;
        focusedPaneId = sourcePane.id;
      }
      await openSftp(connection.id, sourceSftpPath, false, sourceSftpTabKey);
      stickyTop = view.querySelector('.sftp-top');
      toolbar = document.querySelector('#workspaceGlobalHeaderTools .sftp-toolbar') || fixturePane?.querySelector('[data-workspace-role="header-tools"] .sftp-toolbar') || view.querySelector('.sftp-toolbar');
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
      const centeredHintLeft = externalDropHint?.style.left || '';
      showSftpDragHint(externalDropHint?.querySelector('span')?.textContent || '', true, 'upload', 'sftp-missing-toolbar-fixture');
      const missingTabKeepsHintPosition = externalDropHint?.style.left === centeredHintLeft;
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
        && missingTabKeepsHintPosition
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
        sameHostListDropCopies,
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

      copySingleSftp('/Users/junruo/Public/copy.txt', 'copy', fixtureTabKey);
      const copyPaste = [...clipboardActions.querySelectorAll('button')].find(button => button.textContent.includes('粘贴'));
      const copyCancel = clipboardActions.querySelector('[aria-label="取消复制或移动队列"]');
      const copyQueueVisible = clipboardActions.textContent.includes('复制队列 1 项') && Boolean(copyPaste && !copyPaste.disabled && copyCancel);
      copyCancel?.click();
      const copyCancelled = sftpClipboard === null && !clipboardActions.querySelector('button');

      copySingleSftp('/Users/junruo/Public/move.txt', 'move', fixtureTabKey);
      const movePaste = [...clipboardActions.querySelectorAll('button')].find(button => button.textContent.includes('粘贴'));
      const moveCancel = clipboardActions.querySelector('[aria-label="取消复制或移动队列"]');
      const moveQueueVisible = clipboardActions.textContent.includes('移动队列 1 项') && Boolean(movePaste && !movePaste.disabled && moveCancel);
      moveCancel?.click();
      const moveCancelled = sftpClipboard === null && !clipboardActions.querySelector('button');
      sftpClipboard = {mode:'copy', paths:['/source/cross.txt'], connectionId:999999, connectionName:'另一台主机'};
      refreshSftpDirectoryActions(fixtureTabKey);
      const crossCopyButton = [...clipboardActions.querySelectorAll('button')].find(button => button.textContent.includes('跨主机复制'));
      const crossHostCopyEnabled = Boolean(crossCopyButton && !crossCopyButton.disabled);
      sftpClipboard = {mode:'move', paths:['/source/cross.txt'], connectionId:999999, connectionName:'另一台主机'};
      refreshSftpDirectoryActions(fixtureTabKey);
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
      refreshSftpDirectoryActions(fixtureTabKey);
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
      const listRect = view.querySelector('#sftpList').getBoundingClientRect();
      const emptyFavoritesMinHeight = parseFloat(getComputedStyle(favorites).minHeight);
      const emptyFavoritesCompact = emptyFavoritesRect.height < 50
        && (!Number.isFinite(emptyFavoritesMinHeight) || emptyFavoritesMinHeight < 60)
        && emptyNavigationRect.height < 60
        && listRect.top - emptyNavigationRect.bottom < 32;
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
        recoveredMissingToolbar,
        duplicateSftpToolbarsFollowActiveTab,
        sftpVisibleNumberingStable,
        activeShellMatchesTab,
        parentNavigationStaysOnOwner,
        duplicateDirectoryStateIsolated,
        duplicateHistoryIsolated,
        duplicateShellMatchesTab,
        toolbarAnywhere:Boolean(fixturePane?.querySelector('.sftp-toolbar')),
        stickyPosition:stickyTop ? getComputedStyle(stickyTop).position : '',
        toolbarInHeader:Boolean(document.querySelector('#workspaceGlobalHeaderTools')?.contains(toolbar) || fixturePane?.querySelector('[data-workspace-role="header-tools"]')?.contains(toolbar)),
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
        emptyFavoritesMetrics:{height:emptyFavoritesRect.height,minHeight:emptyFavoritesMinHeight,listGap:listRect.top-emptyNavigationRect.bottom},
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
        controls:Boolean(document.querySelector('#sftpRecycleBinEnabled') && document.querySelector('#sftpFloatingProgressEnabled') && document.querySelector('#sftpMaxOpenFileSizeMb') && document.querySelector('#sftpGlobalSettingsSave')),
        floatingProgressDefaultOn:Boolean(document.querySelector('#sftpFloatingProgressEnabled')?.checked),
        floatingProgressCanRestore:Boolean(globalSettingsCard?.textContent.includes('选择“静默”后会永久关闭') && globalSettingsCard.textContent.includes('重新开启')),
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
        const tabKey = fixtureTabKey;
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
        const cacheRuntime = ensureSftpRuntime(tabKey, connection.id, cachePath, view);
        cacheRuntime.state = sftpState;
        sftpActiveRuntimeKey = tabKey;
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
          cacheRuntime.state = sftpState;
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
    navigateSftpPath = (path, tabKey) => actions.push({kind:'dir', id:tabs.find(tab => tab.key === tabKey)?.id, path, tabKey});
    previewSftpText = (id, path) => actions.push({kind:'file', id, path});
    const specialName = "weird" + String.fromCharCode(39, 34) + "<&>.bin";
    activeTabKey = fixtureTabKey;
    activeView = 'sftp';
    const fixturePaneState = workspaceFindPaneForTab(fixtureTabKey);
    if (fixturePaneState) {
      fixturePaneState.activeTabKey = fixtureTabKey;
      focusedPaneId = fixturePaneState.id;
    }
    view.hidden = false;
    view.dataset.sftpTabKey = fixtureTabKey;
    view.innerHTML = '<div class="sftp-shell"><div class="sftp-top"><div class="sftp-path-block"><div class="sftp-title">iMac</div><nav class="sftp-breadcrumb" id="sftpBreadcrumb" aria-label="远程目录路径">'+sftpBreadcrumbHtml(1,'/Users/junruo/Public')+'</nav></div><div class="sftp-top-actions"></div><div class="sftp-selection-bar" id="sftpSelectionBar" hidden><div class="sftp-selected" id="sftpSelectedInfo"></div><div class="sftp-selection-actions"><button id="sftpSelectionCompress">压缩</button><button id="sftpSelectionPermissions">权限</button><button id="sftpSelectionExtract" hidden>解压</button><button>复制</button><button>移动</button><button>删除</button><button onclick="clearSftpSelection()">取消</button></div></div></div><div id="sftpList" class="sftp-list"></div></div>';
    const pageEntries = [
      {name:'folder', type:'dir', size:0, mtime:0, mode:'755', owner:'root', group:'wheel'},
      {name:specialName, type:'file', size:12, mtime:'2026-07-20T12:34:56Z', mode:'600', owner:'junruo', group:'staff'},
      {name:'vmlinuz', type:'file', size:8181696, mtime:'2026-07-20T12:40:00Z', mode:'644', owner:'root', group:'root', is_symlink:true, link_size:27, link_target_missing:false},
      ...Array.from({length:47},(_,index)=>({name:'file-'+String(index+1).padStart(2,'0')+'.txt',type:'file',size:index+1,mtime:index+1,mode:'644',owner:'junruo',group:'staff'}))
    ];
    sftpState = {...sftpState, connectionId:1, path:'/fixture', query:'', sort:'name', dir:'asc', selected:null, page:1, pageSize:50, total:75, totalPages:2, unfilteredTotal:75, entries:pageEntries};
    const fixtureRuntime = ensureSftpRuntime(fixtureTabKey, 1, '/fixture', view);
    fixtureRuntime.state = sftpState;
    fixtureRuntime.root = view;
    sftpActiveRuntimeKey = fixtureTabKey;
    renderSftpEntries(fixtureTabKey);
    const rows = [...view.querySelectorAll('.sftp-row')];
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
    const top = view.querySelector('.sftp-top');
    view.dataset.sftpTabKey = fixtureTabKey;
    fixtureRuntime.root = view;
    fixtureRuntime.state = sftpState;
    sftpActiveRuntimeKey = fixtureTabKey;
    const checks = [...view.querySelectorAll('.sftp-check')];
    checks[0].checked = true;
    checks[1].checked = true;
    updateSftpSelection(fixtureTabKey);
    const selectionBar = view.querySelector('#sftpSelectionBar');
    const selectionShown = !selectionBar.hidden && selectionBar.textContent.includes('已选择 2 项');
    const selectionActionsShown = getComputedStyle(document.querySelector('#sftpSelectionCompress')).display !== 'none' && getComputedStyle(document.querySelector('#sftpSelectionPermissions')).display !== 'none';
    const specialSelectionExact = selectedSftpPaths(fixtureTabKey).includes('/fixture/' + specialName);
    const selectedRows = view.querySelectorAll('.sftp-row.is-selected').length;
    clearSftpSelection(fixtureTabKey);
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
    const previousApi = api;
    const previousJobTimer = startSftpJobsTimer;
    const previousLatestJobs = sftpLatestJobs;
    const previousTaskCenterView = sftpTaskCenterView;
    const previousJobRuntimeSettings = runtimeSettings;
    const previousConfirmModal = confirmModal;
    try {
      const jobFixtures = [
        {id:'running-job',status:'running',type:'upload',phase:'uploading',label:'正在上传任务',connection_id:Number(connection.id),connection_name:'iMac',size:100,transferred:40,progress:40,can_pause:true,can_cancel:true},
        {id:'failed-job',status:'failed',type:'upload',label:'失败任务',connection_id:Number(connection.id),connection_name:'iMac',error:'fixture failed',can_resume:true},
        {id:'done-job',status:'done',type:'compress',label:'完成历史任务',connection_id:Number(connection.id),connection_name:'iMac',finished_at:Date.now()-1000},
        {id:'saved-download',status:'done',type:'download',label:'桌面已保存下载',connection_id:Number(connection.id),connection_name:'iMac',delivery_mode:'desktop',delivery_status:'saved',saved_path:'C:\\Users\\fixture\\Downloads\\saved.txt',finished_at:Date.now()-1200},
        {id:'browser-download',status:'done',type:'download',label:'浏览器已保存下载',connection_name:'iMac',connection_id:1,remote_path:'/tmp/browser.txt',delivery_mode:'browser',delivery_status:'delivered',finished_at:Date.now()-1300},
        {id:'cancelled-job',status:'cancelled',type:'move',label:'取消历史任务',connection_id:Number(connection.id),connection_name:'iMac',finished_at:Date.now()-2000}
      ];
      runtimeSettings = normalizeRuntimeSettingsResponse({...runtimeSettings, saved:{...runtimeSettings?.saved, sftp_floating_progress_enabled:true}});
      api = async pathname => pathname === '/api/sftp/jobs' ? jobFixtures : [];
      startSftpJobsTimer = () => {};
      await refreshSftpJobs();
      const button = document.querySelector('#sftpTaskCenterButton');
      const drawer = document.querySelector('#sftpTaskCenterDrawer');
      const list = document.querySelector('#sftpTaskCenterList');
      const badge = document.querySelector('#sftpTaskCenterBadge');
      const totalProgress = document.querySelector('#sftpTaskCenterProgress');
      const floatingCard = document.querySelector('#sftpTaskFloat');
      const singleGlobalEntry = document.querySelectorAll('#sftpTaskCenterButton').length === 1
        && !document.querySelector('#workspaceDock')?.contains(button);
      const noPaneTaskRegions = document.querySelectorAll('#workspaceDock #sftpJobs, #workspaceDock .sftp-task-drawer, #workspaceDock #sftpTaskFloat').length === 0;
      const failedStatusVisible = Boolean(button?.classList.contains('is-running')
        && button.classList.contains('is-failed')
        && button.querySelector('.lucide-circle-alert')
        && badge?.textContent === '2'
        && !badge.hidden);
      const totalProgressVisible = Boolean(totalProgress
        && !totalProgress.hidden
        && !totalProgress.classList.contains('is-indeterminate')
        && totalProgress.getAttribute('aria-valuenow') === '40'
        && Math.abs(Number.parseFloat(totalProgress.querySelector('i')?.style.width || '0') - 40) <= 0.1
        && Math.abs(totalProgress.getBoundingClientRect().height - 2) <= 0.1);
      const floatingRect = floatingCard?.getBoundingClientRect();
      const topbarRect = document.querySelector('.topbar')?.getBoundingClientRect();
      const taskButtonRect = button?.getBoundingClientRect();
      const floatingVisibleBelowHeader = Boolean(floatingCard
        && !floatingCard.hidden
        && floatingRect
        && topbarRect
        && taskButtonRect
        && floatingRect.top >= topbarRect.bottom + 6
        && (floatingRect.bottom <= taskButtonRect.top || floatingRect.top >= taskButtonRect.bottom)
        && floatingRect.right <= window.innerWidth + 1);
      const floatingActions = Boolean(floatingCard?.querySelector('.sftp-task-float-cancel:not([hidden])')
        && floatingCard.querySelector('.sftp-task-float-close')
        && floatingCard.querySelector('.sftp-task-float-mute')
        && floatingCard.querySelector('.lucide-bell-off'));
      const floatingProgress = Math.abs(Number.parseFloat(floatingCard?.querySelector('.progress i')?.style.width || '0') - 40) <= 0.1;
      await toggleSftpTaskCenter();
      const drawerOpened = Boolean(drawer && !drawer.hidden && button?.getAttribute('aria-expanded') === 'true');
      const currentText = list?.textContent.replace(/\s+/g,' ').trim() || '';
      const currentRows = [...(list?.querySelectorAll('.sftp-job') || [])];
      const runningRow = currentRows.find(row => row.textContent.includes('正在上传任务'));
      const failedRow = currentRows.find(row => row.textContent.includes('失败任务'));
      const currentActions = Boolean(runningRow?.textContent.includes('暂停')
        && runningRow.textContent.includes('取消')
        && failedRow?.textContent.includes('重试')
        && failedRow.textContent.includes('删除'));
      const currentProgress = Math.abs(Number.parseFloat(runningRow?.querySelector('.progress i')?.style.width || '0') - 40) <= 0.1;
      const currentOnly = currentText.includes('正在上传任务')
        && currentText.includes('失败任务')
        && !currentText.includes('完成历史任务')
        && !currentText.includes('取消历史任务');
      const drawerRect = drawer?.getBoundingClientRect();
      const drawerFitsViewport = Boolean(drawerRect
        && drawerRect.left >= -1
        && drawerRect.right <= window.innerWidth + 1
        && drawerRect.top >= 0
        && drawerRect.bottom <= window.innerHeight + 1);
      setSftpTaskCenterView('history');
      const historyText = list?.textContent.replace(/\s+/g,' ').trim() || '';
      const historyOnly = historyText.includes('完成历史任务')
        && historyText.includes('取消历史任务')
        && !historyText.includes('正在上传任务')
        && !historyText.includes('失败任务');
      const historyCounts = document.querySelector('#sftpTaskCenterCurrentCount')?.textContent === '2'
        && document.querySelector('#sftpTaskCenterHistoryCount')?.textContent === '4';
      const historyFooter = document.querySelector('#sftpTaskCenterFooter');
      const historyActions = Boolean(historyFooter && !historyFooter.hidden
        && historyText.includes('桌面已保存下载')
        && historyText.includes('打开目录')
        && ![...list.querySelectorAll('.sftp-job')].find(row=>row.textContent.includes('桌面已保存下载'))?.textContent.includes('保存到本机')
        && historyText.includes('浏览器已保存下载')
        && [...list.querySelectorAll('.sftp-job')].find(row=>row.textContent.includes('浏览器已保存下载'))?.textContent.includes('再次下载'));
      document.body.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
      const outsideClickCloses = Boolean(drawer.hidden && button?.getAttribute('aria-expanded') === 'false');
      await toggleSftpTaskCenter();
      document.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Escape'}));
      const escapeCloses = Boolean(drawer.hidden && button?.getAttribute('aria-expanded') === 'false');
      await openSftpTaskList({preventDefault(){},stopPropagation(){},target:floatingCard});
      const floatingOpensTaskCenter = Boolean(!drawer.hidden && button?.getAttribute('aria-expanded') === 'true'
        && document.querySelector('#sftpTaskCenterCurrentTab')?.getAttribute('aria-selected') === 'true');
      closeSftpTaskCenter();
      dismissSftpTaskFloat();
      updateSftpTaskCenter(jobFixtures);
      const floatingCloseHidesCurrent = Boolean(floatingCard?.hidden);
      const nextFloatingJob = {...jobFixtures[0],id:'next-running-job',label:'新传输任务'};
      updateSftpTaskCenter([...jobFixtures,nextFloatingJob]);
      const floatingNewTaskReopens = Boolean(floatingCard && !floatingCard.hidden && floatingCard.textContent.includes('2 个传输任务'));
      let muteConfirmation = null;
      let mutePayload = null;
      confirmModal = async (...args) => { muteConfirmation = args; return true; };
      api = async (pathname, options={}) => {
        if (pathname === '/api/runtime-settings') {
          mutePayload = JSON.parse(options.body || '{}');
          const saved = {...runtimeSettings.saved, sftp_floating_progress_enabled:false};
          return {...runtimeSettings, saved, sftp_floating_progress_enabled:false};
        }
        return pathname === '/api/sftp/jobs' ? jobFixtures : [];
      };
      await muteSftpTaskFloat();
      const floatingMutePersists = Boolean(mutePayload?.sftp_floating_progress_enabled === false
        && runtimeSettings?.saved?.sftp_floating_progress_enabled === false
        && floatingCard?.hidden
        && muteConfirmation?.[0]?.includes('永久关闭此类悬浮进度卡')
        && muteConfirmation?.[0]?.includes('SFTP 全局设置'));
      runtimeSettings = normalizeRuntimeSettingsResponse({...runtimeSettings, saved:{...runtimeSettings.saved, sftp_floating_progress_enabled:true}});
      updateSftpTaskCenter([nextFloatingJob]);
      const floatingSettingRestores = Boolean(floatingCard && !floatingCard.hidden);
      updateSftpTaskCenter([jobFixtures[0]]);
      const runningStatusVisible = Boolean(button?.classList.contains('is-running')
        && !button.classList.contains('is-failed')
        && button.querySelector('.lucide-loader-circle')
        && badge?.textContent === '1');
      updateSftpTaskCenter([{id:'unknown-progress-job',status:'running',type:'compress',label:'Unknown progress'}]);
      const totalProgressIndeterminate = Boolean(totalProgress
        && !totalProgress.hidden
        && totalProgress.classList.contains('is-indeterminate')
        && !totalProgress.hasAttribute('aria-valuenow'));
      updateSftpTaskCenter([]);
      const totalProgressHidesWhenIdle = Boolean(totalProgress?.hidden);
      updateSftpTaskCenter([jobFixtures[0]]);
      const nativeDragJob = {id:'native-drag-job',status:'running',type:'native-drag',phase:'cancelling',can_cancel:false,label:'拖出 large.bin 到本机',connection_id:Number(connection.id),connection_name:'iMac',size:1000,transferred:500,progress:50};
      const nativeDragTaskStopHidden = !renderSftpJob(nativeDragJob).includes('>取消</button>')
        && renderSftpJob(nativeDragJob).includes('正在停止');
      const deleteJob = {id:'delete-job',status:'running',type:'delete',label:'删除 3 项',connection_id:Number(connection.id),connection_name:'iMac',progress_unit:'items',size:3,transferred:1,progress:33};
      const itemProgress = renderSftpJob(deleteJob).includes('已处理 1 / 3 项');
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
      const toastIconsAligned = ['success','info','error'].every(type => {
        notify('SFTP ' + type + ' 图标测试\\n图标应与提示文字对齐', type);
        const holder = document.querySelector('#toast .toast-icon')?.getBoundingClientRect();
        const glyph = document.querySelector('#toast .toast-icon svg')?.getBoundingClientRect();
        if (!holder || !glyph || !holder.width || !glyph.width) return false;
        return Math.abs((holder.left + holder.width / 2) - (glyph.left + glyph.width / 2)) <= 1
          && Math.abs((holder.top + holder.height / 2) - (glyph.top + glyph.height / 2)) <= 1;
      });
      dismissToast();
      jobUi = {
        found:Boolean(button && drawer && list),
        singleGlobalEntry,
        noPaneTaskRegions,
        failedStatusVisible,
        totalProgressVisible,
        totalProgressIndeterminate,
        totalProgressHidesWhenIdle,
        floatingVisibleBelowHeader,
        floatingActions,
        floatingProgress,
        floatingOpensTaskCenter,
        floatingCloseHidesCurrent,
        floatingNewTaskReopens,
        floatingMutePersists,
        floatingSettingRestores,
        drawerOpened,
        currentOnly,
        currentActions,
        currentProgress,
        drawerFitsViewport,
        historyOnly,
        historyCounts,
        historyActions,
        outsideClickCloses,
        escapeCloses,
        runningStatusVisible,
        nativeDragTaskStopHidden,
        itemProgress,
        staleJobResponseIgnored,
        toastIconsAligned
      };
    } finally {
      api = previousApi;
      startSftpJobsTimer = previousJobTimer;
      sftpLatestJobs = previousLatestJobs;
      sftpTaskCenterView = previousTaskCenterView;
      runtimeSettings = previousJobRuntimeSettings;
      confirmModal = previousConfirmModal;
      closeSftpTaskCenter();
      updateSftpTaskCenter(previousLatestJobs);
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
      view.dataset.sftpTabKey=downloadFixtureTab.key;
      const downloadRuntime=ensureSftpRuntime(downloadFixtureTab.key,1,'/fixture',view);
      downloadRuntime.state=fixtureRuntime.state;
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
      disposeSftpRuntime(downloadFixtureTab.key);
      view.dataset.sftpTabKey=fixtureTabKey;
      fixtureRuntime.root=view;
      sftpActiveRuntimeKey=fixtureTabKey;
      sftpState=fixtureRuntime.state;
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
    const textEncodingUi={
      opened:Boolean(document.querySelector('.sftp-editor-modal')),
      aceLoaded:Boolean(editorHost?.classList.contains('ace_editor')),
      selected:document.querySelector('#sftpTextEncoding')?.value||'',
      options:[...document.querySelectorAll('#sftpTextEncoding option')].map(option=>option.value),
      languageOptions:[...document.querySelectorAll('#sftpEditorLanguage option')].map(option=>option.value),
      manualLanguage:false,
      nonJsonFormattingHidden:false,
      jsonFormatting:false,
      jsonHiddenAfterLanguageChange:false,
      json5FormattingHidden:!isSftpJsonFileName('/tmp/example.json5'),
      wordWrap:Boolean(document.querySelector('#sftpEditorWordWrap')?.checked),
      persistDefault:Boolean(document.querySelector('#sftpPersistEncoding')),
      backup:Boolean(document.querySelector('#sftpBackupBeforeSave')?.checked)
    };
    if (languageSelect) {
      languageSelect.value='markdown';
      languageSelect.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(resolve=>setTimeout(resolve,20));
      textEncodingUi.manualLanguage=Boolean(window.ace&&editorHost&&ace.edit(editorHost).session.$modeId==='ace/mode/markdown');
      languageSelect.value='json';
      languageSelect.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(resolve=>setTimeout(resolve,20));
      const nonJsonFormatButton=document.querySelector('#sftpTextFormatJson');
      textEncodingUi.nonJsonFormattingHidden=Boolean(nonJsonFormatButton?.hidden)
        && getComputedStyle(nonJsonFormatButton).display==='none';
    }
    document.querySelector('#sftpTextClose')?.click();
    await editorPromise;
    const jsonEditorPromise=sftpTextModal('/tmp/config.json','{"name":"TunnelDesk","items":[1,2]}',36,512*1024,'utf8','auto');
    await new Promise(resolve=>setTimeout(resolve,20));
    const jsonEditorHost=document.querySelector('#sftpTextEditor');
    const jsonLanguageSelect=document.querySelector('#sftpEditorLanguage');
    if (jsonLanguageSelect && window.ace && jsonEditorHost) {
      const jsonEditor=ace.edit(jsonEditorHost);
      const formatButton=document.querySelector('#sftpTextFormatJson');
      formatButton?.click();
      await new Promise(resolve=>setTimeout(resolve,20));
      textEncodingUi.jsonFormatting=!formatButton?.hidden
        && getComputedStyle(formatButton).display!=='none'
        && jsonEditor.getValue().includes('\\n  "name": "TunnelDesk"')
        && jsonEditor.getValue().includes('\\n  "items": [');
      jsonLanguageSelect.value='markdown';
      jsonLanguageSelect.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(resolve=>setTimeout(resolve,20));
      textEncodingUi.jsonHiddenAfterLanguageChange=Boolean(formatButton?.hidden)
        && getComputedStyle(formatButton).display==='none';
    }
    document.querySelector('#sftpTextSave')?.click();
    await jsonEditorPromise;
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
    sftpDirectorySizeCache.clear();
    previousDirectorySizes.forEach(([key,value])=>sftpDirectorySizeCache.set(key,value));
    view.innerHTML = previousHtml;
    view.hidden = previousHidden;
    openSftp = previousOpen;
    navigateSftpPath = previousNavigateSftpPath;
    previewSftpText = previousPreview;
    for (const [key,runtime] of sftpTabRuntimes) {
      if (previousSftpRuntimes.some(([previousKey])=>previousKey===key)) continue;
      runtime.requestController?.abort?.();
      clearTimeout(runtime.searchTimer);
      runtime.resizeObserver?.disconnect?.();
      if (runtime.resizeFrame) cancelAnimationFrame(runtime.resizeFrame);
    }
    sftpTabRuntimes.clear();
    previousSftpRuntimes.forEach(([key,runtime])=>{
      if (runtime.root?.isConnected) runtime.root.dataset.sftpTabKey=key;
      sftpTabRuntimes.set(key,runtime);
    });
    sftpTabCounts.clear();
    previousSftpTabCounts.forEach(([key,value])=>sftpTabCounts.set(key,value));
    sftpDisconnectedTabs.clear();
    previousSftpDisconnectedTabs.forEach(key=>sftpDisconnectedTabs.add(key));
    sftpConnectionRequests.clear();
    previousSftpConnectionRequests.forEach(([key,value])=>sftpConnectionRequests.set(key,value));
    sftpConnectionVersions.clear();
    previousSftpConnectionVersions.forEach(([key,value])=>sftpConnectionVersions.set(key,value));
    sftpDisconnectRequests.clear();
    previousSftpDisconnectRequests.forEach(([key,value])=>sftpDisconnectRequests.set(key,value));
    sftpActiveRuntimeKey = previousSftpActiveRuntimeKey;
    sftpState = previousState;
    sftpRequestController = previousSftpRequestController;
    sftpSearchTimer = previousSftpSearchTimer;
    sftpListResizeObserver = previousSftpListResizeObserver;
    sftpListResizeFrame = previousSftpListResizeFrame;
    tabs = previousTabs;
    workspaceLayout = previousWorkspaceLayout;
    focusedPaneId = previousFocusedPaneId;
    activeView = previousActiveView;
    activeTabKey = previousActiveTabKey;
    window.restoringTabs = true;
    renderTabs();
    window.restoringTabs = false;
    syncFocusedWorkspaceClasses();
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
      updateSftpTaskCenter([{
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
    await window.webContents.executeJavaScript("dismissToast(); updateSftpTaskCenter([]); closeSftpTaskCenter()");
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
    const pendingMobileSftpView=$('view-sftp');
    if(pendingMobileSftpView)pendingMobileSftpView.dataset.sftpTabKey='';
    await openSftp(connections[0].id, '.', true);
    syncResponsivePane();
    await new Promise(resolve=>setTimeout(resolve,0));
    const mobileSftpTabKey=activeTabKey;
    const mobileSftpView=sftpRuntimeRoot(mobileSftpTabKey);
    let mobileWorkspaceChromeResize={found:false};
    {
      const headerHandle=document.querySelector('#workspaceHeaderResize');
      const activePane=workspacePaneElement(focusedPaneId);
      const tabHandle=activePane?.querySelector('.workspace-tab-resizer');
      const topbar=document.querySelector('.topbar');
      const title=document.querySelector('#workspaceTitle');
      const tabShell=activePane?.querySelector('.tabs-shell');
      const tabNode=activePane?.querySelector('.tab');
      const tabDot=activePane?.querySelector('.tab-connection-dot');
      const activityHandle=document.querySelector('#activityBarResize');
      const storedHeaderBefore=localStorage.getItem('workspaceHeaderHeight');
      const storedTabBefore=localStorage.getItem('workspaceTabHeight');
      const storedActivityBefore=localStorage.getItem('activityBarWidth');
      const headerValueBefore=workspaceHeaderHeight;
      const tabValueBefore=workspaceTabHeight;
      const activityValueBefore=activityBarWidth;
      const nextFrame=()=>new Promise(resolve=>setTimeout(resolve,0));
      const snapshot=()=>({
        headerHeight:topbar?.getBoundingClientRect().height||0,
        headerFont:title?parseFloat(getComputedStyle(title).fontSize):0,
        tabHeight:tabShell?.getBoundingClientRect().height||0,
        tabFont:tabNode?parseFloat(getComputedStyle(tabNode).fontSize):0,
        dotSize:tabDot?Math.max(tabDot.getBoundingClientRect().width,tabDot.getBoundingClientRect().height):0
      });
      const equalMetric=(left,right)=>Math.abs(left-right)<=0.5;
      try{
        const baseline=snapshot();
        const handlesHidden=Boolean(headerHandle&&tabHandle&&activityHandle
          && getComputedStyle(headerHandle).display==='none'
          && getComputedStyle(tabHandle).display==='none'
          && getComputedStyle(activityHandle).display==='none'
          && headerHandle.getBoundingClientRect().height===0
          && tabHandle.getBoundingClientRect().height===0
          && activityHandle.getBoundingClientRect().width===0);
        applyWorkspaceHeaderHeight(WORKSPACE_HEADER_HEIGHT_MAX,{fit:false});
        applyWorkspaceTabHeight(WORKSPACE_TAB_HEIGHT_MAX,{fit:false});
        applyActivityBarWidth(ACTIVITY_BAR_WIDTH_MAX,{fit:false});
        await nextFrame();
        const afterProgrammaticApply=snapshot();
        const desktopSizingIgnored=equalMetric(afterProgrammaticApply.headerHeight,baseline.headerHeight)
          && equalMetric(afterProgrammaticApply.headerFont,baseline.headerFont)
          && equalMetric(afterProgrammaticApply.tabHeight,baseline.tabHeight)
          && equalMetric(afterProgrammaticApply.tabFont,baseline.tabFont)
          && equalMetric(afterProgrammaticApply.dotSize,baseline.dotSize);
        applyWorkspaceHeaderHeight(headerValueBefore,{fit:false});
        applyWorkspaceTabHeight(tabValueBefore,{fit:false});
        applyActivityBarWidth(activityValueBefore,{fit:false});
        const dispatchHiddenDrag=(handle,pointerId,horizontal=false)=>{
          handle?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId,pointerType:'touch',button:0,clientX:0,clientY:0}));
          window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId,pointerType:'touch',button:0,clientX:horizontal?200:0,clientY:horizontal?0:200}));
          window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId,pointerType:'touch',button:0,clientX:horizontal?200:0,clientY:horizontal?0:200}));
        };
        dispatchHiddenDrag(headerHandle,201);
        dispatchHiddenDrag(tabHandle,202);
        dispatchHiddenDrag(activityHandle,203,true);
        headerHandle?.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'End'}));
        tabHandle?.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'End'}));
        activityHandle?.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'End'}));
        headerHandle?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0}));
        tabHandle?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0}));
        activityHandle?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0}));
        await nextFrame();
        const afterInteractions=snapshot();
        const interactionsIgnored=workspaceHeaderHeight===headerValueBefore
          && workspaceTabHeight===tabValueBefore
          && activityBarWidth===activityValueBefore
          && workspaceChromeResize===null
          && activityBarResize===null
          && !document.body.classList.contains('workspace-chrome-resizing')
          && !document.body.classList.contains('activity-bar-resizing')
          && equalMetric(afterInteractions.headerHeight,baseline.headerHeight)
          && equalMetric(afterInteractions.headerFont,baseline.headerFont)
          && equalMetric(afterInteractions.tabHeight,baseline.tabHeight)
          && equalMetric(afterInteractions.tabFont,baseline.tabFont)
          && equalMetric(afterInteractions.dotSize,baseline.dotSize);
        const storageUntouched=localStorage.getItem('workspaceHeaderHeight')===storedHeaderBefore
          && localStorage.getItem('workspaceTabHeight')===storedTabBefore
          && localStorage.getItem('activityBarWidth')===storedActivityBefore;
        mobileWorkspaceChromeResize={
          found:Boolean(headerHandle&&tabHandle&&activityHandle&&topbar&&title&&tabShell&&tabNode&&tabDot),
          handlesHidden,
          desktopSizingIgnored,
          interactionsIgnored,
          storageUntouched,
          baseline,
          afterProgrammaticApply,
          afterInteractions
        };
      }finally{
        if(workspaceChromeResize)endWorkspaceChromeResize(null,true);
        if(storedHeaderBefore===null)localStorage.removeItem('workspaceHeaderHeight');else localStorage.setItem('workspaceHeaderHeight',storedHeaderBefore);
        if(storedTabBefore===null)localStorage.removeItem('workspaceTabHeight');else localStorage.setItem('workspaceTabHeight',storedTabBefore);
        if(storedActivityBefore===null)localStorage.removeItem('activityBarWidth');else localStorage.setItem('activityBarWidth',storedActivityBefore);
        applyWorkspaceHeaderHeight(headerValueBefore,{fit:false});
        applyWorkspaceTabHeight(tabValueBefore,{fit:false});
        applyActivityBarWidth(activityValueBefore,{fit:false});
      }
    }
    document.documentElement.dataset.uiSmokeStage='mobile-import';
    const mobileSftpToolbarMount = mobileSftpView?.querySelector('#sftpToolbarMount');
    const mobileSftpToolbarToggle = mobileSftpView?.querySelector('#sftpMobileToolbarToggle');
    const mobileSftpBreadcrumb = mobileSftpView?.querySelector('#sftpBreadcrumb');
    const mobileSftpToolbarDefaultCollapsed = Boolean(mobileSftpToolbarMount?.hidden);
    const mobileSftpToolbarToggleVisible = Boolean(mobileSftpToolbarToggle?.getBoundingClientRect().width);
    const mobileSftpBreadcrumbAlwaysVisible = Boolean(mobileSftpBreadcrumb?.getBoundingClientRect().width);
    mobileSftpToolbarToggle?.click();
    const mobileSftpActions = mobileSftpView?.querySelector('.sftp-toolbar');
    const mobileSftpActionNodes = [...(mobileSftpActions?.querySelectorAll('.sftp-toolbar-actions > button, .sftp-toolbar-actions > label') || [])];
    const mobileSftpActionRects = mobileSftpActionNodes.map(node => node.getBoundingClientRect());
    const mobileSftpActionTitles = mobileSftpActionNodes.map(node => node.title || node.getAttribute('aria-label') || '');
    const expectedMobileSftpActions = ['收藏当前目录','新建文件夹','新建文件','上传文件','SFTP 回收站','搜索当前目录','切换 SFTP 文件名编码','打开此连接的终端','刷新目录','SFTP 全局设置'];
    const mobileSftpLayout = {
      found:Boolean(mobileSftpActions),
      fits:Boolean(mobileSftpActions && mobileSftpActions.scrollWidth <= mobileSftpActions.clientWidth + 0.5),
      encodingVisible:Boolean(mobileSftpView?.querySelector('#sftpFilenameEncodingButton')?.getBoundingClientRect().width),
      terminalJumpVisible:Boolean(mobileSftpActions?.querySelector('button[title="打开此连接的终端"]')?.getBoundingClientRect().width),
      allActionsVisible:expectedMobileSftpActions.every(title => mobileSftpActionTitles.includes(title)) && mobileSftpActionRects.every(rect => rect.width > 0 && rect.height > 0),
      uniformButtons:mobileSftpActionRects.every(rect => Math.abs(rect.width - 38) <= 0.5 && Math.abs(rect.height - 38) <= 0.5),
      wrapsCompletely:mobileSftpActions?.querySelector('.sftp-toolbar-actions')?.scrollWidth <= mobileSftpActions?.querySelector('.sftp-toolbar-actions')?.clientWidth + 0.5,
      defaultCollapsed:mobileSftpToolbarDefaultCollapsed,
      toggleVisible:mobileSftpToolbarToggleVisible,
      breadcrumbAlwaysVisible:mobileSftpBreadcrumbAlwaysVisible,
      expandedPersisted:localStorage.getItem(SFTP_MOBILE_TOOLBAR_EXPANDED_KEY) === '1' && !mobileSftpToolbarMount?.hidden,
      searchFontSize:parseFloat(mobileSftpView?.querySelector('#sftpSearch') ? getComputedStyle(mobileSftpView.querySelector('#sftpSearch')).fontSize : '0')
    };
    toggleSftpSearch(mobileSftpTabKey);
    const sftpResizeInput=mobileSftpView?.querySelector('#sftpSearch');
    const sftpResizeViewBefore=activeView;
    const sftpResizeTabBefore=activeTabKey;
    if(sftpResizeInput){sftpResizeInput.value='mobile-resize-sftp';sftpResizeInput.focus();}
    window.dispatchEvent(new Event('resize'));
    const sftpResizeDiagnostics={
      input:Boolean(sftpResizeInput),
      workspace:mobileWorkspaceVisible(),
      focused:document.activeElement===sftpResizeInput,
      value:sftpResizeInput?.value||'',
      viewBefore:sftpResizeViewBefore,
      viewAfter:activeView,
      tabBefore:sftpResizeTabBefore,
      tabAfter:activeTabKey
    };
    const sftpWorkspaceAfterKeyboardResize=sftpResizeDiagnostics.input
      && sftpResizeDiagnostics.workspace
      && sftpResizeDiagnostics.focused
      && sftpResizeDiagnostics.value==='mobile-resize-sftp'
      && sftpResizeDiagnostics.viewAfter===sftpResizeDiagnostics.viewBefore
      && sftpResizeDiagnostics.tabAfter===sftpResizeDiagnostics.tabBefore;
    closeSftpSearch(mobileSftpTabKey);
    loadSftpPage = mobileSftpLoad;
    refreshSftpJobs = mobileSftpJobs;
    startSftpJobsTimer = mobileSftpTimer;
    openBatchCommand(false);
    const batchCommandFontSize=parseFloat(document.querySelector('#batchCommandText') ? getComputedStyle(document.querySelector('#batchCommandText')).fontSize : '0');
    const batchWorkspaceAfterKeyboardResize=workspaceStateSurvivesResize(document.querySelector('#batchCommandText'),'printf mobile-resize-batch');
    newConnection();
    const connectionNameFontSize=parseFloat(document.querySelector('#conn_name') ? getComputedStyle(document.querySelector('#conn_name')).fontSize : '0');
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
      workspaceChromeResize:mobileWorkspaceChromeResize,
      sftp:mobileSftpLayout,
      workspaceFormFonts:{
        sftpSearch:mobileSftpLayout.searchFontSize,
        batchCommand:batchCommandFontSize,
        connectionName:connectionNameFontSize,
        preventsFocusZoom:[mobileSftpLayout.searchFontSize,batchCommandFontSize,connectionNameFontSize].every(size=>size>=16)
      },
      workspaceResizeNavigation:{
        sftpStaysInWorkspace:sftpWorkspaceAfterKeyboardResize,
        sftpDiagnostics:sftpResizeDiagnostics,
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
  console.log(JSON.stringify({ ...result, refreshStateUi, workspaceTabDragUi, workspaceDockingUi, workspaceHeaderResizeUi, pages, navigationUi, aboutUi, desktopMenu, runningActions, authUi, connectionStartupUi, saveAndClearUi, notificationUi, restoreKeyUi, restoreCredentialUi, terminalUi, terminalStartupUi, logSettingsUi, sftpUi, clipboardUi, dark, mobile, errors }, null, 2));
  const overflow = pages.some(page => page.scrollWidth > page.width) || mobile.scrollWidth > mobile.width || mobile.bodyWidth > mobile.width;
  const darkFailed = dark.theme !== "dark" || dark.buttonBackground === "rgb(255, 255, 255)";
  const menuFailed = !desktopMenu.opened || !desktopMenu.closedOnScroll || !mobile.menuOpened || !mobile.menuClosed;
  const refreshStateUiFailed = !refreshStateUi.found || !refreshStateUi.collapsedBeforeRefresh || !refreshStateUi.collapsedAfterRefresh || !refreshStateUi.collapsePersisted || !refreshStateUi.explicitSelectionReopens || !refreshStateUi.runningCountLive || !refreshStateUi.failureCountLive || !refreshStateUi.oldStartupLabelsRemoved;
  const workspaceTabDragUiFailed = !workspaceTabDragUi.beganImmediately || !workspaceTabDragUi.activatedOnPress || !workspaceTabDragUi.dragGhostVisible || !workspaceTabDragUi.dropPositionVisible || !workspaceTabDragUi.dropPositionRemoved || !workspaceTabDragUi.dragGhostRemoved || !workspaceTabDragUi.touchReady || !workspaceTabDragUi.commonTitleFits || !workspaceTabDragUi.numberedSessionTitleFits || !workspaceTabDragUi.tabFontWithinResizeRange || !workspaceTabDragUi.shortTabUsesContentWidth || !workspaceTabDragUi.fullTitleTooltip || JSON.stringify(workspaceTabDragUi.liveOrder) !== JSON.stringify(['drag-a','drag-b','drag-c']) || JSON.stringify(workspaceTabDragUi.savedOrder) !== JSON.stringify(['drag-b','drag-c','drag-a']) || JSON.stringify(workspaceTabDragUi.persistedOrder) !== JSON.stringify(['drag-b','drag-c','drag-a']) || !workspaceTabDragUi.activeFollowsDragged || !workspaceTabDragUi.clickSuppressed || !workspaceTabDragUi.cancelStarted || !workspaceTabDragUi.cancelRestored || !workspaceTabDragUi.closeDoesNotDrag || !workspaceTabDragUi.fallbackMove || !workspaceTabDragUi.scrollControlsVisible || !workspaceTabDragUi.scrollControlsHideWhenFit || !workspaceTabDragUi.nativeScrollbarHidden || !workspaceTabDragUi.wheelScrollsTabs;
  const workspaceDockingUiFailed = !workspaceDockingUi.firstSplit
    || !workspaceDockingUi.secondSplit
    || !workspaceDockingUi.nestedTree
    || workspaceDockingUi.paneCount !== 3
    || !workspaceDockingUi.eachPaneComplete
    || !workspaceDockingUi.activityResizeReflowsEveryPane
    || workspaceDockingUi.splitterCount !== 2
    || !workspaceDockingUi.splitterTracksUsable
    || !workspaceDockingUi.splitterLinesVisible
    || !workspaceDockingUi.terminalInsetsCompact
    || !workspaceDockingUi.terminalScrollbarGutterReleased
    || !workspaceDockingUi.ratioAdjusted
    || !workspaceDockingUi.ratioPersisted
    || !workspaceDockingUi.tabResizeAccessible
    || !workspaceDockingUi.tabAllPanesClampMin
    || !workspaceDockingUi.tabAllPanesClampMax
    || !workspaceDockingUi.tabTextScales
    || !workspaceDockingUi.statusDotScales
    || !workspaceDockingUi.tabPointerLifecycle
    || !workspaceDockingUi.tabHeightPersisted
    || !workspaceDockingUi.tabKeyboardControls
    || !workspaceDockingUi.tabDoubleClickResets
    || !workspaceDockingUi.tabHeightRestored
    || !workspaceDockingUi.tabStorageIndependent
    || !workspaceDockingUi.mergedNested
    || !workspaceDockingUi.mergedAll
    || !workspaceDockingUi.collapsedToSinglePane;
  const workspaceHeaderResizeUiFailed = !workspaceHeaderResizeUi.found
    || !workspaceHeaderResizeUi.accessible
    || !workspaceHeaderResizeUi.minClamped
    || !workspaceHeaderResizeUi.maxClamped
    || !workspaceHeaderResizeUi.brandAligned
    || !workspaceHeaderResizeUi.textScales
    || !workspaceHeaderResizeUi.controlsScale
    || !workspaceHeaderResizeUi.pointerLifecycle
    || !workspaceHeaderResizeUi.heightPersisted
    || !workspaceHeaderResizeUi.keyboardControls
    || !workspaceHeaderResizeUi.doubleClickResets
    || !workspaceHeaderResizeUi.heightRestored
    || !workspaceHeaderResizeUi.tabStorageIndependent;
  const runningActionsFailed = runningActions.found && (Math.abs(runningActions.open.width - runningActions.retry.width) > 1 || Math.abs(runningActions.open.height - runningActions.retry.height) > 1);
  const authUiFailed = !authUi.found || !Object.values(authUi.passwordMode).every(Boolean) || !Object.values(authUi.keyMode).every(Boolean);
  const connectionStartupUiFailed = !Object.values(connectionStartupUi).every(value => Array.isArray(value) ? value.length > 0 : Boolean(value))
    || !connectionStartupUi.categories.includes('Shell')
    || !connectionStartupUi.categories.includes('交互式语言')
    || !connectionStartupUi.categories.includes('会话工具');
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
  const activityUiFailed = result.activity.count !== 9 || !result.activity.iconCentered || !result.activity.centersAligned || !result.activity.insideColumn || !result.activity.resizable || !result.activityUtilities;
  const navigationUiFailed = !navigationUi.settingsOnlySections || !navigationUi.settingsSectionMode || !navigationUi.settingsVertical || settingsSectionsFailed || runtimeUiFailed || sessionUiFailed || navigationUi.duplicateSettingsNav !== 0 || navigationUi.inlineUpdateDotPresent || !navigationUi.importOwnSections || !navigationUi.importSectionMode || !navigationUi.importVertical || !navigationUi.importResultsMerged || !importSourceCheck?.resultsVisible || importSectionsFailed || !navigationUi.treeHidden || navigationUi.dotsBeforeRead.some(dot=>!dot.found||dot.hidden!==false) || navigationUi.dotsAfterRead.some(dot=>!dot.found||dot.hidden!==true) || navigationUi.storedReadVersion !== '1.0.9' || !navigationUi.sameVersionStaysRead || !navigationUi.ignoredVersionHidesNotice || !navigationUi.newerAfterIgnoredShowsNotice || !navigationUi.newerVersionShowsAgain;
  const aboutUiFailed = Boolean(aboutUi.error) || !aboutUi.found || !aboutUi.aboutSelected || aboutUi.duplicateSettingsNav !== 0 || !aboutUi.versionMatches || !aboutUi.licenseMetadata || !aboutUi.sourceLink || !aboutUi.modalOpen || !aboutUi.accessible || !aboutUi.fullText || !aboutUi.textScrollable || !aboutUi.cardWithinViewport || !aboutUi.closeFocused || !aboutUi.backdropIgnored || !aboutUi.closedByEscape || !aboutUi.focusReturned || !aboutUi.followupBackdropClean || !aboutUi.followupResolved || !aboutUi.updateUi;
  const expectedSettingsActions = ['通用设置','安全设置','通知设置','启动与运行','关于'];
  const mobileResizeNavigationFailed = !mobile.workspaceResizeNavigation || !Object.values(mobile.workspaceResizeNavigation).every(Boolean);
  const mobileWorkspaceChromeResizeFailed = !mobile.workspaceChromeResize?.found
    || !mobile.workspaceChromeResize?.handlesHidden
    || !mobile.workspaceChromeResize?.desktopSizingIgnored
    || !mobile.workspaceChromeResize?.interactionsIgnored
    || !mobile.workspaceChromeResize?.storageUntouched;
  const mobileNavigationFailed = mobileResizeNavigationFailed || mobileWorkspaceChromeResizeFailed || !mobile.importExplorerFirst || !mobile.importWorkspaceEntered || !mobile.sftp?.found || !mobile.sftp?.fits || !mobile.sftp?.encodingVisible || !mobile.sftp?.terminalJumpVisible || !mobile.sftp?.allActionsVisible || !mobile.sftp?.uniformButtons || !mobile.sftp?.wrapsCompletely || !mobile.sftp?.defaultCollapsed || !mobile.sftp?.toggleVisible || !mobile.sftp?.breadcrumbAlwaysVisible || !mobile.sftp?.expandedPersisted || !mobile.workspaceFormFonts?.preventsFocusZoom || !mobile.settingsNavigation?.explorerFirst || !mobile.settingsNavigation?.workspaceEntered || !mobile.settingsNavigation?.vertical || !mobile.settingsNavigation?.selectedOnly || !mobile.settingsNavigation?.noDuplicateMenu || JSON.stringify(mobile.settingsNavigation?.labels)!==JSON.stringify(expectedSettingsActions) || mobile.mobileTabs?.count !== 7 || !mobile.mobileTabs?.labelsHidden || !mobile.mobileTabs?.iconsCentered || !mobile.mobileTabs?.fits || !mobile.groupActionVisible || !mobile.groupActionMenuOpened || !mobile.groupControlsInline || !mobile.groupDragFirst || !mobile.groupCancelDoesNotSave || !mobile.groupDragSurvivesRefresh;
  const mobileAboutFailed = !mobile.about || !mobile.about.modalOpen || !mobile.about.cardWithinViewport || !mobile.about.textWithinCard || !mobile.about.textScrollable || !mobile.about.closeVisible || !mobile.about.closed;
  const terminalLabels = ['复制选中','光标复制','会话复制','粘贴','清屏','滚动到底部','终端启动配置','断开连接','全局终端设置'];
  const terminalSettingsUi = terminalUi.terminalSettingsUi || {};
  const terminalDropUi = terminalSettingsUi.drop || {};
  const mobileTerminalSettingsUi = mobile.terminalGlobalSettings || {};
  const terminalStartupUiFailed = !terminalStartupUi.found || !Object.values(terminalStartupUi).every(Boolean);
  const terminalUiFailed = !terminalUi.found || !terminalUi.desktopBackHidden || !terminalUi.desktopKeysHidden || terminalUi.binaryType !== 'arraybuffer' || !terminalUi.binaryWrite || !terminalUi.encodingMenuOpened || !terminalUi.fontMenuOpened || !terminalUi.statusHoverShowsFull || !terminalUi.desktopStatusAvoidsDuplicate || !terminalUi.desktopToolbarInHeader || !terminalUi.connectionToggleUsesLinkAction || !terminalUi.activeToolbarReplacesPrevious || !terminalUi.narrowToolbarFits || !terminalUi.narrowToolbarLeftAligned || !terminalUi.responsiveToolbarFits || !terminalUi.startupCompactIconOnly || !terminalUi.startupWideSingleLine || !terminalUi.terminalFrameLowContrast || !terminalUi.latencyMeasured || !terminalUi.latencyCanDisable || !terminalUi.latencyCanEnable || !terminalSettingsUi.open || !terminalSettingsUi.globalScope || !terminalSettingsUi.controls || !terminalDropUi.found || !terminalDropUi.copyFeedbackVisible || !terminalDropUi.sftpCopyToCurrentDirectory || !terminalDropUi.uploadFeedbackVisible || !terminalDropUi.localUploadToCurrentDirectory || !terminalDropUi.singleActiveDropTarget || !terminalDropUi.resizeFeedbackClears || !terminalDropUi.staleFeedbackClears || !terminalDropUi.completionNoticeNotDuplicated || !terminalSettingsUi.withinViewport || !terminalSettingsUi.compact || !terminalSettingsUi.readableWidth || !terminalSettingsUi.noHorizontalOverflow || JSON.stringify(terminalSettingsUi.tabs)!==JSON.stringify(['外观','鼠标与链接','选择与粘贴']) || JSON.stringify(terminalSettingsUi.backgroundModes)!==JSON.stringify(['theme','black','white','custom']) || !terminalSettingsUi.backgroundPreview || !terminalSettingsUi.requestedDefaults || !terminalSettingsUi.editablePasteSetting || !terminalSettingsUi.appliesToAllOpenSessions || !terminalSettingsUi.readableCustomPalette || !terminalSettingsUi.followsTheme || !terminalSettingsUi.copyFormatting || !terminalSettingsUi.singleLinePaste || !terminalSettingsUi.linkProvider || !terminalSettingsUi.editablePaste || !mobileTerminalSettingsUi.buttonHidden || !mobile.terminalLongPress?.menuOnly || !mobile.terminalLongPress?.menuOpened || !mobile.terminalLongPress?.cursorHintStarted || !mobile.terminalLongPress?.cursorStartStored || !mobile.terminalLongPress?.cursorSelectionBlue || !mobile.terminalLongPress?.cursorCopyCompleted || !mobile.terminalLongPress?.clipboardFallback || !mobile.terminalSessionText?.open || !mobile.terminalSessionText?.withinViewport || !mobile.terminalSessionText?.selectable || !mobile.terminalSessionText?.scrollable || !mobile.terminalSessionText?.fullText || !mobile.terminalSessionText?.copyAll || !mobile.terminalSessionText?.copyAllWorks || !mobile.terminalSessionText?.backdropIgnored || !mobile.terminalPasteEditor?.open || !mobile.terminalPasteEditor?.withinViewport || !mobile.terminalPasteEditor?.editable || !mobile.terminalPasteEditor?.actionsVisible || !mobile.terminalPasteEditor?.backdropIgnored || !mobile.terminalPasteEditor?.cancelled || !mobile.terminalBack?.visible || !mobile.terminalBack?.compactToolbar || !mobile.terminalBack?.sftpTextFits || !mobile.terminalBack?.globalSettingsHidden || JSON.stringify(mobile.terminalBack?.priorityOrder)!==JSON.stringify(['reconnect','keys','forward','sftp']) || !mobile.terminalBack?.returned || !mobile.terminalFontMenu?.opened || !mobile.terminalFontMenu?.withinViewport || !mobile.terminalFontMenu?.compact || !mobile.terminalFontMenu?.scrollable || !mobile.terminalFontMenu?.closeSticky || !mobile.terminalFontMenu?.touchTargets || !terminalLabels.every(label=>terminalUi.labels.includes(label)) || terminalUi.metrics.some(item=>Math.abs(item.buttonHeight-30)>0.5||Math.abs(item.iconWidth-14)>0.5||Math.abs(item.iconHeight-14)>0.5||item.centerDelta>0.5);
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
  const jobUiFailed = !jobUi.found || !jobUi.singleGlobalEntry || !jobUi.noPaneTaskRegions || !jobUi.failedStatusVisible || !jobUi.totalProgressVisible || !jobUi.totalProgressIndeterminate || !jobUi.totalProgressHidesWhenIdle || !jobUi.floatingVisibleBelowHeader || !jobUi.floatingActions || !jobUi.floatingProgress || !jobUi.floatingOpensTaskCenter || !jobUi.floatingCloseHidesCurrent || !jobUi.floatingNewTaskReopens || !jobUi.floatingMutePersists || !jobUi.floatingSettingRestores || !jobUi.drawerOpened || !jobUi.currentOnly || !jobUi.currentActions || !jobUi.currentProgress || !jobUi.drawerFitsViewport || !jobUi.historyOnly || !jobUi.historyCounts || !jobUi.historyActions || !jobUi.outsideClickCloses || !jobUi.escapeCloses || !jobUi.runningStatusVisible || !jobUi.nativeDragTaskStopHidden || !jobUi.itemProgress || !jobUi.staleJobResponseIgnored || !jobUi.toastIconsAligned;
  const textEncodingUiFailed = !textEncodingUi.opened || !textEncodingUi.aceLoaded || textEncodingUi.selected !== 'gbk' || !textEncodingUi.manualLanguage || !textEncodingUi.nonJsonFormattingHidden || !textEncodingUi.jsonFormatting || !textEncodingUi.jsonHiddenAfterLanguageChange || !textEncodingUi.json5FormattingHidden || !textEncodingUi.wordWrap || !textEncodingUi.persistDefault || !textEncodingUi.backup || !['utf8','utf8bom','gb18030','gbk','big5','shift_jis','euc-kr','latin1'].every(value=>textEncodingUi.options?.includes(value)) || !['auto','json','yaml','xml','sh','batchfile','powershell','javascript','java','c_cpp','sql','markdown'].every(value=>textEncodingUi.languageOptions?.includes(value));
  const nativeDragUiFailed = !nativeDragUi.found || !nativeDragUi.webExternalDragBlocked || !nativeDragUi.linuxFallbackNoticeOnce || !nativeDragUi.linuxFallbackUsesCompatibilityMode || !nativeDragUi.streamingPreparesOnPointerDown || !nativeDragUi.streamingThresholdActivatesOnce || !nativeDragUi.streamingCaptureCancelSurvives || !nativeDragUi.pointerUpCancelsPending || !nativeDragUi.streamingSkipsStage || !nativeDragUi.streamingNativeBlocksParallelBrowserDrag || !nativeDragUi.nativeIdleHintStable || !nativeDragUi.nativeOutsideHintStaysStable || !nativeDragUi.nativeMotionTargetsSftp || !nativeDragUi.nativeTransientMissKeepsTarget || !nativeDragUi.nativeFinalTransientMissKeepsTarget || !nativeDragUi.nativeReleasedClearsStaleTarget || !nativeDragUi.nativeResultCopiesOnce || !nativeDragUi.firstDragOnlyStages || !nativeDragUi.firstDragReset || !nativeDragUi.cacheReused || !nativeDragUi.cachedUnarmedStaysInternal || !nativeDragUi.sameWindowDropDoesNotArm || !nativeDragUi.armedDragStartsSynchronously || !nativeDragUi.failureRearmed || !nativeDragUi.successClearsState || !nativeDragUi.finderRenameNoticeShown;
  const sftpUiFailed = Boolean(sftpUi.error) || !connectionSessionUi.found || !connectionSessionUi.addressIncludesPort || !connectionSessionUi.disconnectedAction || !connectionSessionUi.disconnectedBanner || !connectionSessionUi.connectedAction || !connectionSessionUi.preservedWhileDisconnected || !connectionSessionUi.automaticConnectShared || !connectionSessionUi.manualDisconnectAutoReconnect || !connectionSessionUi.disconnectedTabSwitchDoesNotReconnect || !connectionSessionUi.disconnectedFolderOperationReconnects || !connectionSessionUi.dragFeedbackVisible || !connectionSessionUi.dragTargetViewActivated || !connectionSessionUi.targetListDropPrompt || !connectionSessionUi.targetListDropPromptStable || !connectionSessionUi.crossHostListDropCopies || !connectionSessionUi.crossHostPreviewHandoffSurvives || !connectionSessionUi.crossHostDropHasNoUploadToast || !connectionSessionUi.sameHostListDropCopies || !connectionSessionUi.ownDragUploadSuppressed || !connectionSessionUi.armedPointerCancelClearsRequest || !connectionSessionUi.armedDragAllowsExternalUpload || !connectionSessionUi.staleInternalDragAllowsExternalUpload || !connectionSessionUi.desktopUriListDragAccepted || !connectionSessionUi.releasedDragAllowsExternalUpload || !connectionSessionUi.externalFileDropDetected || !connectionSessionUi.externalFileDropCollected || !connectionSessionUi.externalDropPromptIsSingle || !connectionSessionUi.externalDropPromptAvoidsWorkspaceChrome || !connectionSessionUi.externalDropPromptListCentered || !connectionSessionUi.externalDropSurfaceFillsWorkspace || !connectionSessionUi.externalDropPromptScrollClamped || !connectionSessionUi.externalDropPromptHorizontalClamped || !connectionSessionUi.externalDropPromptClears || nativeDragUiFailed || jobUiFailed || textEncodingUiFailed || !downloadNoticeUi.oncePerMode || !downloadNoticeUi.desktopPath || !downloadNoticeUi.browserDevice || !downloadNoticeUi.batchUsesSharedNotice || !downloadNoticeUi.browserSeparateChoice || !downloadNoticeUi.browserSeparateQueued || !downloadNoticeUi.noDuplicateBatchNotice || !globalSettingsUi.found || !globalSettingsUi.globalScope || !globalSettingsUi.controls || !globalSettingsUi.floatingProgressDefaultOn || !globalSettingsUi.floatingProgressCanRestore || !globalSettingsUi.downloadBehavior || !globalSettingsUi.defaultLimit || !globalSettingsUi.backdropIgnored || !globalSettingsUi.withinViewport || !directorySizeUi.idleButton || !directorySizeUi.requestedOnce || !directorySizeUi.exactBytes || !directorySizeUi.formatted || !directorySizeUi.refreshable || !sftpUi.fileOpenFeedback?.busy || !sftpUi.fileOpenFeedback?.duplicateBlocked || !sftpUi.fileOpenFeedback?.restored || !directoryCacheBehavior.sameResponseUntouched || !directoryCacheBehavior.changedResponseRendered || !directoryActionsUi.found || directoryActionsUi.stickyPosition !== 'sticky' || !directoryActionsUi.toolbarInHeader || !directoryActionsUi.navigationBeforeFavorites || !directoryActionsUi.reusedWithSilentRefresh || !expectedSftpToolActions.every(action=>directoryActionsUi.actionTitles?.includes(action)) || !directoryActionsUi.searchHidden || !directoryActionsUi.pathEditorHidden || !directoryActionsUi.pathEditorReplacesBreadcrumb || !directoryActionsUi.emptyClipboardHidden || !directoryActionsUi.copyQueueVisible || !directoryActionsUi.copyCancelled || !directoryActionsUi.moveQueueVisible || !directoryActionsUi.moveCancelled || !directoryActionsUi.crossHostCopyEnabled || !directoryActionsUi.crossHostMoveDisabled || !directoryActionsUi.crossHostClipboardConflict || !directoryActionsUi.filenameEncodingMenu || !directoryActionsUi.wideNavigationCompact || !directoryActionsUi.narrowNavigationCompact || !directoryActionsUi.terminalJump || !sftpUi.folderOpened || !sftpUi.fileOpened || !sftpUi.unknownAction || sftpUi.stickyPosition !== "sticky" || !sftpUi.breadcrumbScrollable || !sftpUi.singlePathPresentation || sftpUi.breadcrumbLabels?.join('/') !== '根目录/Users/junruo/Public' || sftpUi.breadcrumbText.includes('//') || !sftpUi.selectionShown || !sftpUi.selectionActionsShown || !sftpUi.specialSelectionExact || sftpUi.selectedRows !== 2 || !sftpUi.selectionCleared || !sftpUi.fileHasCompression || !sftpUi.permissionOwnerColumn || !sftpUi.permissionOwnerTitle || !sftpUi.symlinkUsesTargetSize || !sftpUi.symlinkExplainsBothSizes || !sftpUi.symlinkMarked || !sftpUi.wideColumnAlignment || !sftpUi.wideActionsFit || !sftpUi.compactSizeVisible || !sftpUi.compactTimeVisible || !sftpUi.compactAccessVisible || !sftpUi.compactMediumHidden || !sftpUi.compactCoreVisible || !sftpUi.compactNoOverflow || !sftpUi.permissionModeSync || !sftpUi.recursiveVisible || sftpUi.compactRowHeight > 48 || !sftpUi.moreMenuOpened || !sftpUi.contextMenuOpened || !sftpUi.directoryDownloadMenu || !sftpUi.narrowLayoutClass || !sftpUi.narrowCoreHidden || !sftpUi.narrowMoreVisible || !sftpUi.narrowMetaVisible || !sftpUi.narrowAccessHidden || !sftpUi.completedMutationDetected || sftpUi.pageRows !== 50 || !sftpUi.pagerVisible || !sftpUi.pagerText.includes('第 1/2 页') || !sftpUi.previousDisabled || !sftpUi.nextEnabled;
  const sftpToolbarRecoveryFailed = !directoryActionsUi.recoveredMissingToolbar || !directoryActionsUi.duplicateSftpToolbarsFollowActiveTab;
  const sftpTabIsolationFailed = !directoryActionsUi.sftpVisibleNumberingStable
    || !directoryActionsUi.activeShellMatchesTab
    || !directoryActionsUi.parentNavigationStaysOnOwner
    || !directoryActionsUi.duplicateDirectoryStateIsolated
    || !directoryActionsUi.duplicateHistoryIsolated
    || !directoryActionsUi.duplicateShellMatchesTab;
  const code = errors.length || overflow || darkFailed || menuFailed || refreshStateUiFailed || workspaceTabDragUiFailed || workspaceDockingUiFailed || workspaceHeaderResizeUiFailed || runningActionsFailed || authUiFailed || connectionStartupUiFailed || saveAndClearUiFailed || notificationUiFailed || restoreKeyUiFailed || restoreCredentialUiFailed || activityUiFailed || navigationUiFailed || aboutUiFailed || mobileNavigationFailed || mobileAboutFailed || terminalUiFailed || terminalStartupUiFailed || logSettingsUiFailed || sftpUiFailed || sftpToolbarRecoveryFailed || sftpTabIsolationFailed || !clipboardUi.ok || mobile.contentVisible === "none" || !result.groups || !result.icons || !result.groupRenameMenu || !result.groupActionButton || !result.stickyGroupHeaders || !result.stickyGroupHeaderSealsTop || !result.operationPaneCollapsible || !result.operationPanePinBehavior || !result.compactDesktopHeader || !result.forwardToggleFits ? 1 : 0;
  clearTimeout(smokeWatchdog);
  window.destroy();
  app.exit(code);
}).catch(error => {
  clearTimeout(smokeWatchdog);
  console.error(error);
  app.exit(1);
});
