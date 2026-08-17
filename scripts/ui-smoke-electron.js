const { app, BrowserWindow, clipboard, ipcMain, session } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runMobileScenario } = require("./ui-smoke-mobile-scenario");
const { runVisualRegression } = require("./ui-visual-regression");

const url = process.env.TERMA_CHECK_URL || process.env.TUNNELDESK_CHECK_URL || "http://127.0.0.1:8099";
const errors = [];
const cspViolations = [];
let smokeWindow = null;
let rendererFailure = null;
const smokeUserData = process.env.TERMA_UI_USER_DATA || process.env.TUNNELDESK_UI_USER_DATA || path.join(os.tmpdir(), `terma-ui-smoke-${process.pid}`);
const screenshotEnabled = (process.env.TERMA_UI_SCREENSHOT || process.env.TUNNELDESK_UI_SCREENSHOT) === "1";
const notificationScreenshotEnabled = (process.env.TERMA_UI_NOTIFICATION_SCREENSHOT || process.env.TUNNELDESK_UI_NOTIFICATION_SCREENSHOT) === "1";
const diagnosticsDirectory = path.join(process.cwd(), "data");
if (screenshotEnabled || notificationScreenshotEnabled) {
  fs.mkdirSync(diagnosticsDirectory, { recursive: true });
}
ipcMain.on("terma-ui-smoke:csp-violation", (_event, violation) => {
  const item = violation && typeof violation === "object" ? violation : {};
  cspViolations.push(item);
  errors.push(`CSP violation: ${item.effectiveDirective || item.violatedDirective || "unknown"} blocked ${item.blockedURI || "unknown"}${item.sourceFile ? ` (${item.sourceFile}:${item.lineNumber || 0})` : ""}`);
});
app.disableHardwareAcceleration();
app.setPath("userData", smokeUserData);
const smokeTimeoutMs = Math.max(180000, Number(process.env.TERMA_UI_SMOKE_TIMEOUT_MS) || 300000);
const smokeWatchdog = setTimeout(async () => {
  let stage = "unknown";
  try {
    stage = await Promise.race([
      smokeWindow?.webContents.executeJavaScript("document.documentElement.dataset.uiSmokeStage || 'unknown'"),
      new Promise(resolve => setTimeout(() => resolve("renderer-unresponsive"), 1000))
    ]);
  } catch {}
  console.error(`UI 冒烟超过 ${Math.round(smokeTimeoutMs / 1000)} 秒仍未完成，停留阶段：${stage}`);
  app.exit(1);
}, smokeTimeoutMs);

app.whenReady().then(async () => {
  await session.defaultSession.clearCache();
  const window = new BrowserWindow({
    show:false,
    width:1200,
    height:800,
    webPreferences:{
      contextIsolation:true,
      backgroundThrottling:false,
      preload:path.join(__dirname, "ui-smoke-preload.js")
    }
  });
  smokeWindow = window;
  window.webContents.on("console-message", details => {
    if (["warning", "error"].includes(details.level)) {
      errors.push(`${details.message}${details.sourceId ? ` (${details.sourceId}:${details.lineNumber || 0})` : ""}`);
    }
  });
  window.webContents.on("did-fail-load", (_event, code, description) => errors.push(`${code}: ${description}`));
  window.webContents.on("render-process-gone", (_event, details) => {
    rendererFailure = {reason:details.reason, exitCode:details.exitCode};
    errors.push(`renderer process gone: ${details.reason} (${details.exitCode})`);
  });
  await window.loadURL(url);
  await new Promise(resolve => setTimeout(resolve, 1200));
  console.log("[ui-smoke] page loaded");
  console.log("[ui-smoke] language onboarding");
  window.setSize(392, 800);
  await new Promise(resolve => setTimeout(resolve, 80));
  const languageOnboardingUi = await window.webContents.executeJavaScript(`(async () => {
    const previousApi = api;
    const previousRuntimeSettings = runtimeSettings;
    const previousSuggestedLanguage = suggestedTermaLanguage;
    const previousLanguage = document.documentElement.lang || 'zh-CN';
    let savedPayload = null;
    try {
      const regionDefaults = suggestedTermaLanguage(['zh-CN']) === 'zh-CN'
        && suggestedTermaLanguage(['zh-Hans-CN']) === 'zh-CN'
        && suggestedTermaLanguage(['en-US']) === 'en-US'
        && suggestedTermaLanguage(['zh-HK']) === 'en-US'
        && suggestedTermaLanguage(['invalid-locale']) === 'en-US';
      suggestedTermaLanguage = () => 'en-US';
      await setTermaLanguage('en-US', {emit:false});
      window.i18next.removeResourceBundle('zh-CN', 'common');
      window.i18next.removeResourceBundle('zh-CN', 'settings');
      const coldStartMissingChineseResources = !window.i18next.hasResourceBundle('zh-CN', 'common')
        && !window.i18next.hasResourceBundle('zh-CN', 'settings');
      runtimeSettings = {settings_persisted:false, saved:{language:'zh-CN', language_onboarding_version:0}};
      await ensureTermaLanguageOnboarding();
      const newCard = document.querySelector('.language-onboarding');
      const newRect = newCard?.getBoundingClientRect();
      await new Promise(resolve => queueMicrotask(() => requestAnimationFrame(resolve)));
      const newUserDefaultsEnglish = document.querySelector('input[name="terma-onboarding-language"]:checked')?.value === 'en-US';
      const englishOption = document.querySelector('input[name="terma-onboarding-language"][value="en-US"]')?.closest('.language-onboarding-option');
      const chineseOption = document.querySelector('input[name="terma-onboarding-language"][value="zh-CN"]')?.closest('.language-onboarding-option');
      const nativeChoiceCopy = englishOption?.querySelector('strong')?.textContent?.trim() === 'English'
        && englishOption?.querySelector('small')?.textContent?.trim() === 'Default outside mainland China'
        && chineseOption?.querySelector('strong')?.textContent?.trim() === '简体中文'
        && chineseOption?.querySelector('small')?.textContent?.trim() === '中国大陆默认';
      const englishCopy = newCard?.querySelector('#languageOnboardingTitle')?.textContent?.trim() === 'Choose your language'
        && newCard?.querySelector('.language-onboarding-message')?.textContent?.trim() === "Terma selected a default from this device's region. You can change it before entering."
        && newCard?.querySelector('.language-onboarding-note')?.textContent?.trim() === 'You can switch languages at any time from the language button.'
        && newCard?.querySelector('button[type="submit"]')?.textContent?.trim() === 'Continue'
        && newCard?.lang === 'en-US';
      const chineseChoice = document.querySelector('input[name="terma-onboarding-language"][value="zh-CN"]');
      chineseChoice?.click();
      await new Promise(resolve => queueMicrotask(() => requestAnimationFrame(resolve)));
      const selectedChineseCopy = newCard?.querySelector('#languageOnboardingTitle')?.textContent?.trim() === '选择界面语言'
        && newCard?.querySelector('.language-onboarding-message')?.textContent?.trim() === 'Terma 已按当前设备地区预选语言，进入前可以修改。'
        && newCard?.querySelector('.language-onboarding-note')?.textContent?.trim() === '之后可随时通过语言按钮切换。'
        && newCard?.querySelector('button[type="submit"]')?.textContent?.trim() === '继续'
        && newCard?.lang === 'zh-CN'
        && chineseOption?.classList.contains('selected')
        && !englishOption?.classList.contains('selected');
      document.querySelector('input[name="terma-onboarding-language"][value="en-US"]')?.click();
      await new Promise(resolve => queueMicrotask(() => requestAnimationFrame(resolve)));
      const selectedEnglishCopy = newCard?.querySelector('#languageOnboardingTitle')?.textContent?.trim() === 'Choose your language'
        && newCard?.querySelector('button[type="submit"]')?.textContent?.trim() === 'Continue'
        && newCard?.lang === 'en-US'
        && !/[\u3400-\u9fff]/.test(newCard?.querySelector('input[name="terma-onboarding-language"][value="en-US"]')?.closest('.language-onboarding-option')?.textContent || '')
        && englishOption?.classList.contains('selected')
        && !chineseOption?.classList.contains('selected');
      const coldStartChineseResourcesLoaded = window.i18next.hasResourceBundle('zh-CN', 'common')
        && window.i18next.hasResourceBundle('zh-CN', 'settings');
      const fitsNarrowViewport = Boolean(newRect
        && newRect.left >= -0.5
        && newRect.right <= innerWidth + 0.5
        && newRect.top >= -0.5
        && newRect.bottom <= innerHeight + 0.5
        && document.documentElement.scrollWidth <= innerWidth + 1);
      closeTermaLanguageOnboarding();

      runtimeSettings = {settings_persisted:true, saved:{language:'zh-CN', language_onboarding_version:0}};
      await setTermaLanguage('zh-CN', {emit:false});
      await ensureTermaLanguageOnboarding();
      const existingUserKeepsLanguage = document.querySelector('input[name="terma-onboarding-language"]:checked')?.value === 'zh-CN';
      const existingUserChineseCopy = document.querySelector('#languageOnboardingTitle')?.textContent?.trim() === '选择界面语言'
        && document.querySelector('.language-onboarding-message')?.textContent?.trim() === '请选择要继续使用的 Terma 界面语言。'
        && document.querySelector('.language-onboarding-note')?.textContent?.trim() === '之后可随时通过语言按钮切换。'
        && document.querySelector('.language-onboarding button[type="submit"]')?.textContent?.trim() === '继续'
        && document.querySelector('.language-onboarding')?.lang === 'zh-CN';
      const englishChoice = document.querySelector('input[name="terma-onboarding-language"][value="en-US"]');
      englishChoice?.click();
      const existingUserEnglishCopy = document.querySelector('#languageOnboardingTitle')?.textContent?.trim() === 'Choose your language'
        && document.querySelector('.language-onboarding-message')?.textContent?.trim() === 'Choose the Terma interface language to continue.'
        && document.querySelector('.language-onboarding-note')?.textContent?.trim() === 'You can switch languages at any time from the language button.'
        && document.querySelector('.language-onboarding button[type="submit"]')?.textContent?.trim() === 'Continue'
        && document.querySelector('.language-onboarding')?.lang === 'en-US';
      api = async (path, options={}) => {
        if (path !== '/api/runtime-settings' || options.method !== 'PUT') throw new Error('Unexpected language onboarding request');
        savedPayload = JSON.parse(options.body || '{}');
        return {settings_persisted:true, saved:{...runtimeSettings.saved, ...savedPayload}};
      };
      const saved = await confirmTermaLanguageOnboarding(document.querySelector('.language-onboarding button[type="submit"]'));
      return {
        regionDefaults,
        newUserDefaultsEnglish,
        nativeChoiceCopy,
        englishCopy,
        selectedChineseCopy,
        selectedEnglishCopy,
        coldStartNativeChoice:Boolean(coldStartMissingChineseResources && coldStartChineseResourcesLoaded && nativeChoiceCopy),
        existingUserKeepsLanguage,
        existingUserChineseCopy,
        existingUserEnglishCopy,
        fitsNarrowViewport,
        saved:Boolean(saved && savedPayload?.language === 'en-US' && savedPayload?.language_onboarding_version === 1),
        closed:document.querySelector('.language-onboarding') === null
      };
    } finally {
      api = previousApi;
      runtimeSettings = previousRuntimeSettings;
      suggestedTermaLanguage = previousSuggestedLanguage;
      closeTermaLanguageOnboarding();
      await setTermaLanguage(previousLanguage, {emit:false});
    }
  })()`);
  window.setSize(1200, 800);
  let desktopViewportReady = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 50));
    desktopViewportReady = await window.webContents.executeJavaScript("window.innerWidth > 760 && !isMobileLayout()");
    if (desktopViewportReady) break;
  }
  if (!desktopViewportReady) throw new Error("语言引导窄屏检查后未恢复桌面视口");
  await window.webContents.executeJavaScript(`(async () => {
    // The onboarding scenario intentionally exercises the non-mainland English
    // default. Keep the legacy geometry and interaction scenarios on their
    // explicit Chinese baseline; English coverage runs in the dedicated i18n
    // scenario below and must not make localized selectors data-dependent.
    await setTermaLanguage('zh-CN', {emit:false});
    syncResponsivePane();
  })()`);
  console.log("[ui-smoke] noVNC module");
  const noVncModuleUi = await window.webContents.executeJavaScript(`(async () => {
    const RFB = await noVncRfbClass();
    return {
      loaded:typeof RFB === 'function',
      named:Boolean(RFB?.name),
      prototype:Boolean(RFB?.prototype)
    };
  })()`);
  console.log("[ui-smoke] ZMODEM module");
  const zmodemModuleUi = await window.webContents.executeJavaScript(`(async () => {
    const Zmodem = await ensureTerminalZmodemLibrary();
    return {
      loaded:Boolean(Zmodem?.Sentry),
      browser:Boolean(Zmodem?.Browser?.send_files),
      abortSequence:Boolean(Zmodem?.ZMLIB?.ABORT_SEQUENCE?.length)
    };
  })()`);
  await window.webContents.executeJavaScript(`(() => {
    window.__uiSmokeRealLoadAll = loadAll;
    // Keep background polling from crossing the temporary API fixtures below.
    // SFTP job refresh behavior is exercised explicitly in the dedicated checks.
    if (sftpJobsTimer) {
      clearInterval(sftpJobsTimer);
      sftpJobsTimer = null;
    }
    const fixtureConnection = {
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
    };
    const fixtureIndex = connections.findIndex(item => Number(item?.id) === fixtureConnection.id);
    if (fixtureIndex >= 0) connections.splice(fixtureIndex, 1);
    connections.unshift(fixtureConnection);
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
    const operationPaneRect = document.querySelector('.left-pane')?.getBoundingClientRect();
    const connectionToolStrip = document.querySelector('#explorerTools .connection-action-strip');
    const connectionToolStripRect = connectionToolStrip?.getBoundingClientRect();
    const connectionToolButtons = [...(connectionToolStrip?.querySelectorAll('button') || [])].map(button=>button.getBoundingClientRect());
    const connectionFooter = document.querySelector('.conn-footer');
    const connectionFooterRect = connectionFooter?.getBoundingClientRect();
    const connectionActionButtons = [...document.querySelectorAll('.conn-actions > button')];
    const connectionHasSftpAction = Boolean(document.querySelector('.conn-actions button[title="打开 SFTP 文件管理"]'));
    const quickConnectButton = document.querySelector('.workspace-quick-connect-button');
    openQuickConnectionLauncher();
    const quickConnectModal = document.querySelector('.quick-connection-modal');
    const quickConnectTable = document.querySelector('.quick-connection-table');
    const quickConnectHeadings = [...document.querySelectorAll('.quick-connection-columns > span')];
    const quickConnectRow = document.querySelector('.quick-connection-row');
    const quickConnectCells = quickConnectRow ? [...quickConnectRow.children].map(item=>item.getBoundingClientRect()) : [];
    const quickConnectHeadingRects = quickConnectHeadings.map(item=>item.getBoundingClientRect());
    let quickActionsPinned = false;
    let quickActionScrollMetrics = null;
    if (quickConnectTable && quickConnectRow) {
      quickConnectTable.style.width = '620px';
      const action = quickConnectRow.querySelector('.quick-connection-actions');
      quickConnectTable.scrollLeft = 0;
      const rightBeforeScroll = action?.getBoundingClientRect().right;
      quickConnectTable.scrollLeft = quickConnectTable.scrollWidth;
      const rightAfterScroll = action?.getBoundingClientRect().right;
      const tableRight = quickConnectTable.getBoundingClientRect().right;
      quickActionScrollMetrics = {
        position: action ? getComputedStyle(action).position : '',
        rightBeforeScroll,
        rightAfterScroll,
        tableRight,
        scrollWidth: quickConnectTable.scrollWidth,
        clientWidth: quickConnectTable.clientWidth,
        scrollLeft: quickConnectTable.scrollLeft
      };
      quickActionsPinned = Boolean(
        getComputedStyle(action).position === 'sticky'
        && Math.abs(Number(rightBeforeScroll)-tableRight) < 12
        && Math.abs(Number(rightAfterScroll)-tableRight) < 12
      );
      quickConnectTable.style.width = '';
      quickConnectTable.scrollLeft = 0;
    }
    const quickConnectionLauncher = Boolean(
      quickConnectButton
      && quickConnectModal?.getBoundingClientRect().width >= Math.min(1000, innerWidth-40)
      && quickConnectRow
      && document.querySelectorAll('.quick-connection-actions button').length === 3
      && quickConnectCells.length === 5
      && quickConnectHeadingRects.length === 5
      && quickConnectHeadingRects.slice(0,4).every((rect,index)=>Math.abs(rect.left-quickConnectCells[index].left)<2)
      && quickConnectCells.every(rect=>Math.abs((rect.top+rect.bottom)-(quickConnectCells[0].top+quickConnectCells[0].bottom))<4)
      && quickActionsPinned
    );
    const quickConnectionLayout = {
      modalWidth: quickConnectModal?.getBoundingClientRect().width || 0,
      requiredWidth: Math.min(1000, innerWidth-40),
      actionButtons: document.querySelectorAll('.quick-connection-actions button').length,
      rowCells: quickConnectCells.length,
      headingCells: quickConnectHeadingRects.length,
      headingDeltas: quickConnectHeadingRects.slice(0,4).map((rect,index)=>Math.abs(rect.left-(quickConnectCells[index]?.left || 0))),
      rowAligned: quickConnectCells.every(rect=>Math.abs((rect.top+rect.bottom)-(quickConnectCells[0].top+quickConnectCells[0].bottom))<4),
      actionsPinned: quickActionsPinned,
      actionScrollMetrics: quickActionScrollMetrics
    };
    const quickConnectionSearch = document.querySelector('#quickConnectionSearch');
    quickConnectionSearch.value = 'tester@198.51.100.25:2200';
    renderQuickConnectionRows(quickConnectionSearch.value);
    const quickSshCandidates = Boolean(
      document.querySelector('[data-action="quick-connect-direct"]')?.textContent.includes('tester@198.51.100.25:2200')
      && document.querySelector('[data-action="quick-connect-new"]')?.textContent.includes('新建 SSH 连接')
      && parseQuickSshTarget('root@[2001:db8::1]:2222')?.port === 2222
      && parseQuickSshTarget('example.test')?.port === 22
    );
    closeQuickConnectionLauncher();
    const originalOpenTerminalForDoubleClick = openTerminal;
    let doubleClickedConnectionId = 0;
    openTerminal = id => { doubleClickedConnectionId = Number(id); };
    document.querySelector('.conn-name-open')?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0}));
    openTerminal = originalOpenTerminalForDoubleClick;
    const connectionNameDoubleClickOpens = doubleClickedConnectionId === Number(connections[0]?.id || 0);
    const explorerTree = document.querySelector('#connectionGroups')?.closest('.tree');
    const compactOperationPane = Boolean(operationPaneRect&&operationPaneRect.width<=292.5&&operationPaneRect.width>=280);
    const compactConnectionTools = Boolean(connectionToolStripRect&&connectionToolButtons.length===4&&connectionToolButtons.every(rect=>Math.abs((rect.top+rect.bottom)-(connectionToolStripRect.top+connectionToolStripRect.bottom))<2&&rect.left>=connectionToolStripRect.left-0.5&&rect.right<=connectionToolStripRect.right+0.5));
    const compactConnectionRows = Boolean(connectionFooterRect&&connectionActionButtons.length===6&&connectionActionButtons.every(button=>{const rect=button.getBoundingClientRect();return !button.textContent.trim()&&rect.width<=30&&rect.left>=connectionFooterRect.left-0.5&&rect.right<=connectionFooterRect.right+0.5;}));
    const operationHandle = document.querySelector('#operationPaneResize');
    const operationStoredBefore = localStorage.getItem('operationPaneWidth');
    const operationWidthBefore = operationPaneWidth;
    let operationPaneResizable = false;
    if (operationHandle) {
      const handleRect = operationHandle.getBoundingClientRect();
      const startX = handleRect.left + handleRect.width / 2;
      operationHandle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:92,pointerType:'mouse',button:0,clientX:startX,clientY:handleRect.top+20}));
      window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:92,pointerType:'mouse',button:0,clientX:startX+1000,clientY:handleRect.top+20}));
      window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:92,pointerType:'mouse',button:0,clientX:startX+1000,clientY:handleRect.top+20}));
      const pointerMax = operationPaneWidth === OPERATION_PANE_WIDTH_MAX
        && Number(localStorage.getItem('operationPaneWidth')) === OPERATION_PANE_WIDTH_MAX
        && operationPaneResize === null
        && !document.body.classList.contains('operation-pane-resizing');
      operationHandle.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Home'}));
      const keyboardMin = operationPaneWidth === OPERATION_PANE_WIDTH_MIN
        && document.documentElement.classList.contains('operation-pane-narrow');
      operationHandle.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'ArrowRight',shiftKey:true}));
      const keyboardStep = operationPaneWidth === OPERATION_PANE_WIDTH_MIN + 16
        && !document.documentElement.classList.contains('operation-pane-narrow');
      operationHandle.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'End'}));
      const keyboardMax = operationPaneWidth === OPERATION_PANE_WIDTH_MAX;
      operationHandle.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0}));
      const doubleClickReset = operationPaneWidth === OPERATION_PANE_WIDTH_DEFAULT
        && Number(localStorage.getItem('operationPaneWidth')) === OPERATION_PANE_WIDTH_DEFAULT;
      operationPaneResizable = getComputedStyle(operationHandle).display !== 'none'
        && handleRect.width >= 6
        && operationHandle.getAttribute('aria-orientation') === 'vertical'
        && Number(operationHandle.getAttribute('aria-valuemin')) === OPERATION_PANE_WIDTH_MIN
        && Number(operationHandle.getAttribute('aria-valuemax')) === OPERATION_PANE_WIDTH_MAX
        && Number(operationHandle.getAttribute('aria-valuenow')) === OPERATION_PANE_WIDTH_DEFAULT
        && pointerMax && keyboardMin && keyboardStep && keyboardMax && doubleClickReset;
    }
    applyOperationPaneWidth(operationWidthBefore,{fit:false});
    if (operationStoredBefore === null) localStorage.removeItem('operationPaneWidth');
    else localStorage.setItem('operationPaneWidth',operationStoredBefore);
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
    const connectionActionsRect = forwardToggle?.closest('.conn-actions')?.getBoundingClientRect();
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
    const brandMark = document.querySelector('.brand h1 .brand-mark');
    const collapsedBrandButton = document.querySelector('#operationPaneExpand');
    const collapsedBrandMark = collapsedBrandButton?.querySelector('.brand-mark');
    const expandedBrand = Boolean(brandMark)
      && getComputedStyle(brandMark).display !== 'none'
      && brandMark.getBoundingClientRect().width > 0
      && brandMark.getAttribute('src') === '/assets/terma-icon.png'
      && getComputedStyle(document.querySelector('.brand-name-full')).display !== 'none'
      && getComputedStyle(document.querySelector('#operationPaneCollapse')).display !== 'none';
    const paneExpanded = getComputedStyle(document.querySelector('#sidebar')).display !== 'none'
      && document.querySelector('#navConnections')?.getAttribute('aria-expanded') === 'true';
    document.querySelector('#operationPaneCollapse')?.click();
    const collapsedContentWidth = document.querySelector('#content')?.getBoundingClientRect().width || 0;
    const collapsedBrand = getComputedStyle(document.querySelector('.brand h1')).display === 'none'
      && Boolean(collapsedBrandButton)
      && getComputedStyle(collapsedBrandButton).display !== 'none'
      && collapsedBrandButton.getBoundingClientRect().width > 0
      && collapsedBrandMark?.getAttribute('src') === '/assets/terma-icon.png';
    const paneCollapsed = getComputedStyle(document.querySelector('#sidebar')).display === 'none'
      && document.querySelector('#navConnections')?.getAttribute('aria-expanded') === 'false'
      && document.querySelector('.app')?.classList.contains('operation-pane-collapsed');
    collapsedBrandButton?.click();
    const collapsedBrandExpandState = {
      actionRegistered:window.TermaEvents?.registeredActions?.().includes('static-operation-expand') === true,
      expandedState:!operationPaneCollapsed,
      sidebarVisible:getComputedStyle(document.querySelector('#sidebar')).display !== 'none',
      buttonHidden:getComputedStyle(collapsedBrandButton).display === 'none'
    };
    const collapsedBrandExpands = Object.values(collapsedBrandExpandState).every(Boolean);
    setOperationPaneCollapsed(true);
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
      compactOperationPane,
      compactConnectionTools,
      compactConnectionRows,
      connectionHasSftpAction,
      quickConnectionLauncher,
      quickConnectionLayout,
      quickSshCandidates,
      connectionNameDoubleClickOpens,
      operationPaneHorizontalScrollHidden:Boolean(explorerTree&&getComputedStyle(explorerTree).overflowX==='hidden'),
      operationPaneResizable,
      operationPaneCollapsible: expandedBrand && collapsedBrand && paneExpanded && paneCollapsed && collapsedBrandExpands && differentActivityExpands && activeActivityCollapses && collapsedContentWidth >= expandedContentWidth + 250,
      operationPaneCollapseLayout:{expandedBrand,collapsedBrand,paneExpanded,paneCollapsed,collapsedBrandExpands,collapsedBrandExpandState,differentActivityExpands,activeActivityCollapses,expandedContentWidth,collapsedContentWidth},
      operationPanePinBehavior: pinGuideShownOnce&&pinGuideTargetsPin&&pinGuideDoesNotRepeat&&runningPinShowsAutoCollapse&&unpinnedContentClickCollapses&&pinnedContentClickStaysOpen&&independentPinPersistence,
      activityUtilities: document.querySelector('.activity-bottom')?.children[0]?.id === 'languageToggle'
        && document.querySelector('.activity-bottom')?.children[1]?.id === 'themeToggle'
        && document.querySelector('.activity-bottom')?.children[2]?.id === 'activityRefresh'
        && document.querySelector('.activity-bottom')?.children[3]?.classList.contains('github-link'),
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
        && forwardToggle.getAttribute('aria-label') === '停止转发'
        && forwardToggleRect
        && connectionActionsRect
        && forwardToggleRect.right <= connectionActionsRect.right + 0.5
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
  console.log("[ui-smoke] forwarding template actions");
  const forwardTemplateLayoutUi = await window.webContents.executeJavaScript(`(() => {
    const previousTemplates = forwardTemplates;
    const previousEditing = editingForwardTemplateId;
    let host = document.querySelector('#forwardTemplateManager');
    const created = !host;
    if (!host) {
      host = document.createElement('div');
      host.id = 'forwardTemplateManager';
      document.body.appendChild(host);
    }
    const previousStyle = host.getAttribute('style');
    const previousHtml = host.innerHTML;
    try {
      host.hidden = false;
      host.style.position = 'fixed';
      host.style.left = '8px';
      host.style.top = '8px';
      host.style.width = '292px';
      host.style.zIndex = '-1';
      forwardTemplates = [
        {id:'layout-1',name:'Memcached',mode:'local',bind_host:'127.0.0.1',bind_port:11211,target_host:'127.0.0.1',target_port:11211},
        {id:'layout-2',name:'Web HTTP',mode:'local',bind_host:'127.0.0.1',bind_port:8080,target_host:'127.0.0.1',target_port:80}
      ];
      editingForwardTemplateId = null;
      renderForwardTemplateManager();
      const rows = [...host.querySelectorAll('.template-row')];
      const actionGroups = rows.map(row => row.querySelector('.template-actions'));
      const buttons = [...host.querySelectorAll('.template-actions button')];
      const singleLine = buttons.every(button => {
        const range = document.createRange();
        range.selectNodeContents(button);
        return [...range.getClientRects()].length <= 1
          && getComputedStyle(button).whiteSpace === 'nowrap'
          && button.scrollWidth <= button.clientWidth + 1;
      });
      const insideRows = rows.every((row,index) => {
        const rowRect = row.getBoundingClientRect();
        const actionsRect = actionGroups[index]?.getBoundingClientRect();
        return Boolean(actionsRect
          && actionsRect.left >= rowRect.left - 0.5
          && actionsRect.right <= rowRect.right + 0.5
          && actionsRect.top >= rowRect.top - 0.5
          && actionsRect.bottom <= rowRect.bottom + 0.5);
      });
      const noOverlap = actionGroups.every(group => {
        const rects = [...group.querySelectorAll('button')].map(button => button.getBoundingClientRect());
        return rects.every((rect,index) => index === 0 || rect.left >= rects[index - 1].right - 0.5);
      });
      return {rows:rows.length, buttons:buttons.length, singleLine, insideRows, noOverlap};
    } finally {
      forwardTemplates = previousTemplates;
      editingForwardTemplateId = previousEditing;
      if (created) host.remove();
      else {
        host.innerHTML = previousHtml;
        if (previousStyle === null) host.removeAttribute('style');
        else host.setAttribute('style', previousStyle);
      }
    }
  })()`);
  console.log("[ui-smoke] appearance effects disabled");
  const appearanceEffectsUi = await window.webContents.executeJavaScript(`(async () => {
    localStorage.setItem(TERMA_APPEARANCE_STORAGE_KEY, JSON.stringify({preset:'luminous',frosted_strength:53,liquid_strength:39}));
    document.documentElement.classList.add('terma-liquid-enabled');
    const track = document.querySelector('.activity-top');
    if (track) {
      track.classList.add('terma-liquid-track','has-liquid-selection');
      track.insertAdjacentHTML('afterbegin','<span class="terma-liquid-lens" aria-hidden="true"></span>');
    }
    termaAppearanceSettings = readTermaAppearanceSettings();
    applyTermaAppearanceSettings();
    syncTermaLiquidNavigation();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const root = document.documentElement;
    return {
      featureDisabled:TERMA_APPEARANCE_EFFECTS_ENABLED === false,
      storageCleared:localStorage.getItem(TERMA_APPEARANCE_STORAGE_KEY) === null,
      clearPreset:root.dataset.appearancePreset === 'clear' && termaAppearanceSettings.preset === 'clear',
      clearStrengths:termaAppearanceSettings.frosted_strength === 0 && termaAppearanceSettings.liquid_strength === 0,
      classesCleared:!root.classList.contains('terma-liquid-enabled') && root.classList.contains('terma-glass-disabled') && root.classList.contains('terma-frosted-disabled'),
      noLenses:document.querySelectorAll('.terma-liquid-lens').length === 0,
      noTracks:document.querySelectorAll('.terma-liquid-track').length === 0,
      zeroBlur:getComputedStyle(root).getPropertyValue('--terma-frosted-backdrop-blur').trim() === '0px'
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
      const startupCountSnapshot = state => {
        const card = document.querySelector('[data-startup-state="' + state + '"]');
        const count = card?.querySelector('strong');
        const label = card?.querySelector('small');
        const countRect = count?.getBoundingClientRect();
        const labelRect = label?.getBoundingClientRect();
        return {
          count:count?.textContent?.trim() || '',
          label:label?.textContent?.trim() || '',
          labelBelow:Boolean(countRect && labelRect && labelRect.top >= countRect.bottom - 0.5)
        };
      };
      fixture.forwards[0].status = 'running';
      renderStartupSummary();
      const runningState = startupCountSnapshot('running');
      const runningFailedState = startupCountSnapshot('failed');
      fixture.forwards[0].status = 'reconnecting';
      renderStartupSummary();
      const reconnectingState = startupCountSnapshot('reconnecting');
      fixture.forwards[0].status = 'failed';
      renderStartupSummary();
      const failedText = document.querySelector('#startupSummary')?.textContent || '';
      const failedRunningState = startupCountSnapshot('running');
      const failedState = startupCountSnapshot('failed');
      selectConnection(fixture.id);
      const explicitSelectionReopens = groupOpen.has(fixture.group_name);
      return {
        found:true,
        collapsedBeforeRefresh,
        collapsedAfterRefresh,
        collapsePersisted,
        explicitSelectionReopens,
        runningCountLive:runningState.count === '1' && runningState.label === '运行中' && runningFailedState.count === '0' && runningFailedState.label === '启动失败',
        failureCountLive:failedRunningState.count === '0' && failedRunningState.label === '运行中' && failedState.count === '1' && failedState.label === '启动失败' && failedText.includes('存在启动失败的转发'),
        startupLabelsBelowNumbers:runningState.labelBelow && reconnectingState.labelBelow && failedState.labelBelow,
        oldStartupLabelsRemoved:!failedText.includes('转发成功') && !failedText.includes('部分转发异常') && !failedText.includes('异常 1')
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
        {key:'drag-a',title:'demo-host · 终端',subtitle:'demo@demo-host.example:22',viewName:'welcome',closable:true,kind:'terminal',id:900001},
        {key:'drag-b',title:'测试 · 终端 #5',subtitle:'root@192.0.2.5:22',viewName:'welcome',closable:true,kind:'terminal',id:900002},
        {key:'drag-c',title:'标签 C · SFTP',subtitle:'',viewName:'welcome',closable:true,kind:'sftp',id:900003}
      ];
      activeTabKey = 'drag-b';
      renderTabs();
      const first = document.querySelector('.tab[data-tab-key="drag-a"]');
      const last = document.querySelector('.tab[data-tab-key="drag-c"]');
      const firstRect = first.getBoundingClientRect();
      const lastRect = last.getBoundingClientRect();
      const shortTitleRect = last.querySelector('.tab-title').getBoundingClientRect();
      const shortCloseRect = last.querySelector('.tab-close').getBoundingClientRect();
      const terminalKindIcon = first.querySelector('.tab-kind-icon.terminal svg');
      const sftpKindIcon = last.querySelector('.tab-kind-icon.sftp svg');
      const compactKindLabels = first.querySelector('.tab-title').textContent === 'demo-host'
        && document.querySelector('.tab[data-tab-key="drag-b"] .tab-title').textContent === '测试 #5'
        && last.querySelector('.tab-title').textContent === '标签 C';
      const distinctKindIcons = Boolean(terminalKindIcon && sftpKindIcon && terminalKindIcon.outerHTML !== sftpKindIcon.outerHTML);
      const remoteProtocolHost = document.createElement('div');
      remoteProtocolHost.className = 'tabs';
      remoteProtocolHost.style.cssText = 'position:fixed;left:8px;top:8px;height:var(--workspace-tab-height);visibility:hidden;pointer-events:none';
      const remoteProtocolFixtures = [
        {key:'remote-rdp',title:'Linux图形界面测试 · RDP',kind:'remote-desktop',protocol:'rdp'},
        {key:'remote-vnc',title:'Linux图形界面测试 · VNC',kind:'remote-desktop',protocol:'vnc'},
        {key:'remote-xdmcp',title:'Linux图形界面测试 · XDMCP',kind:'remote-desktop'}
      ];
      remoteProtocolHost.innerHTML = remoteProtocolFixtures.map(tab => {
        const presentation = workspaceTabPresentation(tab);
        return '<button class="tab" data-test-protocol="'+tab.key+'">'+presentation.icon+'<span class="tab-title">'+presentation.title+'</span></button>';
      }).join('');
      document.body.appendChild(remoteProtocolHost);
      const remoteProtocolTabs = [...remoteProtocolHost.querySelectorAll('.tab')];
      const remoteProtocolTitlesCompact = remoteProtocolTabs.every(tab => tab.querySelector('.tab-title')?.textContent === 'Linux图形界面测试');
      const remoteProtocolLetters = remoteProtocolTabs.map(tab => tab.querySelector('.tab-protocol-letter')?.textContent || '');
      const remoteProtocolMonitorBadges = remoteProtocolTabs.every(tab => {
        const badge = tab.querySelector('.tab-kind-icon.remote-desktop');
        const badgeRect = badge?.getBoundingClientRect();
        const letterRect = badge?.querySelector('.tab-protocol-letter')?.getBoundingClientRect();
        return Boolean(badge?.querySelector('svg') && badgeRect && letterRect
          && letterRect.left >= badgeRect.left - 0.5 && letterRect.right <= badgeRect.right + 0.5
          && letterRect.top >= badgeRect.top - 0.5 && letterRect.bottom <= badgeRect.bottom + 0.5);
      });
      const remoteProtocolThemeColors = remoteProtocolTabs.map(tab => getComputedStyle(tab.querySelector('.tab-kind-icon')).color);
      const remoteProtocolThemeAware = new Set(remoteProtocolThemeColors).size === 3
        && remoteProtocolThemeColors.every(color => color && color !== 'rgba(0, 0, 0, 0)');
      remoteProtocolHost.remove();
      const activeTab = document.querySelector('.tab[data-tab-key="drag-b"]');
      const inactiveStyle = getComputedStyle(first);
      const activeStyle = getComputedStyle(activeTab);
      const activeSelectionVisible = activeTab.classList.contains('active')
        && activeStyle.backgroundColor !== inactiveStyle.backgroundColor
        && activeStyle.boxShadow !== 'none'
        && Number.parseInt(activeStyle.fontWeight, 10) >= 600;
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
      const dragGhostVisible = Boolean(dragGhost && dragGhost.textContent.includes('demo-host') && !dragGhost.textContent.includes('终端') && getComputedStyle(dragGhost).display !== 'none');
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
      const fullTitleTooltip = activeDraggedTab.title === 'demo-host · 终端 - demo@demo-host.example:22';
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
        compactKindLabels,
        distinctKindIcons,
        remoteProtocolTitlesCompact,
        remoteProtocolLetters,
        remoteProtocolMonitorBadges,
        remoteProtocolThemeAware,
        activeSelectionVisible,
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
  console.log("[ui-smoke] connected tab close confirmation");
  const workspaceTabCloseUi = await window.webContents.executeJavaScript(`(async () => {
    const previousTabs = tabs.map(tab => ({...tab}));
    const previousLayout = JSON.parse(JSON.stringify(workspaceLayout));
    const previousActiveTabKey = activeTabKey;
    const previousActiveView = activeView;
    const previousCloseTabsByKey = closeTabsByKey;
    const previousStoredTabs = localStorage.getItem('workspaceTabs');
    const closeCalls = [];
    const pause = () => new Promise(resolve => setTimeout(resolve, 0));
    try {
      tabs = [
        {key:'close-connected',title:'Connected terminal',subtitle:'',viewName:'welcome',closable:true,kind:'terminal',connectionStatus:'connected'},
        {key:'close-connecting',title:'Connecting SFTP',subtitle:'',viewName:'welcome',closable:true,kind:'sftp',connectionStatus:'connecting'},
        {key:'close-remote',title:'Connecting VNC',subtitle:'',viewName:'welcome',closable:true,kind:'remote-desktop',protocol:'vnc',connectionStatus:'connecting'},
        {key:'close-system-remote',title:'RDP management',subtitle:'',viewName:'welcome',closable:true,kind:'remote-desktop',protocol:'rdp',connectionStatus:'connected'},
        {key:'close-xdmcp',title:'XDMCP management',subtitle:'',viewName:'welcome',closable:true,kind:'remote-desktop',protocol:'xdmcp',connectionStatus:'connecting'},
        {key:'close-disconnected',title:'Disconnected terminal',subtitle:'',viewName:'welcome',closable:true,kind:'terminal',connectionStatus:'disconnected'}
      ];
      workspaceLayout = {type:'pane',id:'close-pane',tabs:tabs.map(tab => tab.key),activeTabKey:'close-connected'};
      focusedPaneId = 'close-pane';
      activeTabKey = 'close-connected';
      activeView = 'welcome';
      closeTabsByKey = (keys, anchorKey) => closeCalls.push({keys:[...keys],anchorKey});
      renderTabs();
      const remoteStatusDotVisible = document.querySelector('.tab[data-tab-key="close-remote"] .tab-connection-dot.connecting') !== null;
      const systemRemoteStatusHidden = !document.querySelector('.tab[data-tab-key="close-system-remote"] .tab-connection-dot')
        && !document.querySelector('.tab[data-tab-key="close-xdmcp"] .tab-connection-dot');
      closeTab({stopPropagation:()=>{}}, 'close-system-remote');
      await pause();
      const systemRemoteClosesImmediately = closeCalls.length === 1
        && JSON.stringify(closeCalls[0].keys) === JSON.stringify(['close-system-remote'])
        && document.querySelector('#modal')?.hidden;
      closeCalls.length = 0;
      tabs = tabs.filter(tab => !['close-system-remote','close-xdmcp'].includes(tab.key));
      workspaceLayout.tabs = workspaceLayout.tabs.filter(key => !['close-system-remote','close-xdmcp'].includes(key));
      renderTabs();
      let stopped = false;
      closeTab({stopPropagation:()=>{ stopped = true; }}, 'close-connected');
      await pause();
      const modal = document.querySelector('#modal');
      const connectedCard = modal.querySelector('.workspace-close-tabs-modal');
      const connectedRect = connectedCard?.getBoundingClientRect();
      const connectedPrompt = Boolean(stopped && connectedCard && connectedCard.textContent.includes('Connected terminal') && document.activeElement === document.querySelector('#workspaceCloseTabsCancel'));
      modal.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
      const backdropIgnored = Boolean(!modal.hidden && modal.querySelector('.workspace-close-tabs-modal'));
      modal.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Escape'}));
      await pause();
      const escapePreservesTabs = closeCalls.length === 0 && tabs.length === 4 && modal.hidden;
      closeTab({stopPropagation:()=>{}}, 'close-connecting');
      await pause();
      document.querySelector('#workspaceCloseTabsCancel')?.click();
      await pause();
      const cancelPreservesTabs = closeCalls.length === 0 && tabs.some(tab => tab.key === 'close-connecting') && modal.hidden;
      closeTabsByMode('others','close-disconnected');
      await pause();
      const multiCard = modal.querySelector('.workspace-close-tabs-modal');
      const multiRect = multiCard?.getBoundingClientRect();
      const multiItems = [...(multiCard?.querySelectorAll('.workspace-close-tabs-list li') || [])];
      const multiPromptListsNames = Boolean(multiCard
        && multiItems.length === 3
        && multiCard.textContent.includes('Connected terminal')
        && multiCard.textContent.includes('Connecting SFTP')
        && multiCard.textContent.includes('Connecting VNC'));
      document.querySelector('#workspaceCloseTabsConfirm')?.click();
      await pause();
      const confirmed = closeCalls.length === 1
        && JSON.stringify(closeCalls[0].keys) === JSON.stringify(['close-connected','close-connecting','close-remote'])
        && closeCalls[0].anchorKey === 'close-disconnected';
      closeTab({stopPropagation:()=>{}}, 'close-disconnected');
      await pause();
      const disconnectedClosesImmediately = closeCalls.length === 2
        && JSON.stringify(closeCalls[1].keys) === JSON.stringify(['close-disconnected'])
        && modal.hidden;
      return {
        remoteStatusDotVisible,
        systemRemoteStatusHidden,
        systemRemoteClosesImmediately,
        connectedPrompt,
        backdropIgnored,
        escapePreservesTabs,
        cancelPreservesTabs,
        multiPromptListsNames,
        multiPromptDiagnostics:{itemCount:multiItems.length,items:multiItems.map(item=>item.textContent.trim()),text:multiCard?.textContent.replace(/\s+/g,' ').trim()||''},
        confirmed,
        disconnectedClosesImmediately,
        withinViewport:Boolean(connectedRect && multiRect
          && connectedRect.left >= -0.5 && connectedRect.right <= innerWidth + 0.5
          && connectedRect.top >= -0.5 && connectedRect.bottom <= innerHeight + 0.5
          && multiRect.left >= -0.5 && multiRect.right <= innerWidth + 0.5
          && multiRect.top >= -0.5 && multiRect.bottom <= innerHeight + 0.5)
      };
    } finally {
      closeTabsByKey = previousCloseTabsByKey;
      tabs = previousTabs;
      workspaceLayout = previousLayout;
      activeTabKey = previousActiveTabKey;
      activeView = previousActiveView;
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
        dot.className = 'tab-connection-dot connected ui-smoke-tab-connection-dot';
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
      document.querySelectorAll('.ui-smoke-tab-connection-dot').forEach(dot => dot.remove());
      renderTabs();
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
  console.log("[ui-smoke] startup workspace restore guard");
  const workspaceStartupRestoreUi = await window.webContents.executeJavaScript(`(() => {
    const previousTabs=tabs;
    const previousLayout=workspaceLayout;
    const previousGroups=workspaceGroups;
    const previousGroupId=activeWorkspaceGroupId;
    const previousFocusedPaneId=focusedPaneId;
    const previousActiveTabKey=activeTabKey;
    const previousActiveView=activeView;
    const previousPending=window.workspaceRestorePending;
    const previousStoredTabs=localStorage.getItem('workspaceTabs');
    const fixtureTabs=[
      {key:'startup-fixture-a',title:'终端 A',subtitle:'',viewName:'welcome',closable:true,kind:'fixture',id:1},
      {key:'startup-fixture-b',title:'终端 B',subtitle:'',viewName:'welcome',closable:true,kind:'fixture',id:2},
      {key:'startup-fixture-c',title:'终端 C',subtitle:'',viewName:'welcome',closable:true,kind:'fixture',id:3}
    ];
    const fixtureStorage={version:1,workspaceGroupsVersion:1,activeWorkspaceGroupId:'workspace-main',activeTabKey:'startup-fixture-b',focusedPaneId:'pane-1',workspaceGroups:[{id:'workspace-main',name:'主工作区',tabs:fixtureTabs,layout:{type:'pane',id:'pane-1',tabs:fixtureTabs.map(tab=>tab.key),activeTabKey:'startup-fixture-b'},activeTabKey:'startup-fixture-b',focusedPaneId:'pane-1'}],tabs:fixtureTabs,layout:{type:'pane',id:'pane-1',tabs:fixtureTabs.map(tab=>tab.key),activeTabKey:'startup-fixture-b'}};
    const serializedFixture=JSON.stringify(fixtureStorage);
    try {
      localStorage.setItem('workspaceTabs',serializedFixture);
      tabs=[{key:'settings',title:'设置',subtitle:'',viewName:'settings',closable:true,kind:'settings'}];
      workspaceLayout={type:'pane',id:'pane-1',tabs:['settings'],activeTabKey:'settings'};
      workspaceGroups=[{id:'workspace-main',name:'主工作区',tabs:[...tabs],layout:workspaceLayout,activeTabKey:'settings',focusedPaneId:'pane-1'}];
      activeWorkspaceGroupId='workspace-main';
      focusedPaneId='pane-1';
      activeTabKey='settings';
      activeView='settings';
      window.workspaceRestorePending=true;
      saveTabsState();
      const storageProtected=localStorage.getItem('workspaceTabs')===serializedFixture;
      const restored=restoreTabsState();
      const restoredKeys=tabs.map(tab=>tab.key);
      const restoredThreeTabs=restored&&restoredKeys.length===3&&restoredKeys.join(',')===fixtureTabs.map(tab=>tab.key).join(',');
      const activeRestored=activeTabKey==='startup-fixture-b';
      return {storageProtected,restoredThreeTabs,activeRestored};
    } finally {
      tabs=previousTabs;
      workspaceLayout=previousLayout;
      workspaceGroups=previousGroups;
      activeWorkspaceGroupId=previousGroupId;
      focusedPaneId=previousFocusedPaneId;
      activeTabKey=previousActiveTabKey;
      activeView=previousActiveView;
      window.workspaceRestorePending=true;
      renderTabs();
      window.workspaceRestorePending=previousPending;
      if(previousStoredTabs===null)localStorage.removeItem('workspaceTabs');else localStorage.setItem('workspaceTabs',previousStoredTabs);
    }
  })()`);
  console.log("[ui-smoke] workspace tab visibility");
  const workspaceTabVisibilityUi = await window.webContents.executeJavaScript(`(async () => {
    const previousTabs = tabs.map(tab => ({...tab}));
    const previousLayout = JSON.parse(JSON.stringify(workspaceLayout));
    const previousFocusedPaneId = focusedPaneId;
    const previousActiveTabKey = activeTabKey;
    const previousActiveView = activeView;
    const previousStoredTabs = localStorage.getItem('workspaceTabs');
    const previousOpenLocalFiles = openLocalFiles;
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
    const settle = async () => { await nextFrame(); await nextFrame(); await nextFrame(); };
    const tabVisible = (paneId, key) => {
      const strip = workspacePaneElement(paneId)?.querySelector('.tabs');
      const tab = strip?.querySelector('.tab[data-tab-key="' + CSS.escape(key) + '"]');
      if (!strip || !tab) return false;
      const stripRect = strip.getBoundingClientRect();
      const tabRect = tab.getBoundingClientRect();
      return tabRect.left >= stripRect.left - 1 && tabRect.right <= stripRect.right + 1;
    };
    try {
      tabs = Array.from({length:9}, (_, index) => ({
        key:'visibility-' + (index + 1),
        title:'Visibility ' + (index + 1),
        subtitle:'',
        viewName:'welcome',
        closable:true,
        kind:'welcome'
      }));
      workspaceLayout = {type:'pane',id:'visibility-pane',tabs:tabs.map(tab => tab.key),activeTabKey:'visibility-7'};
      focusedPaneId = 'visibility-pane';
      activeTabKey = 'visibility-7';
      activeView = 'welcome';
      renderTabs();
      await settle();
      const paneElement = workspacePaneElement('visibility-pane');
      const shell = paneElement.querySelector('.tabs-shell');
      const strip = paneElement.querySelector('.tabs');
      shell.style.width = '270px';
      await settle();

      strip.scrollLeft = 0;
      activateTab('visibility-9');
      await settle();
      const switchKeepsActiveVisible = tabVisible('visibility-pane', 'visibility-9');

      strip.scrollLeft = 0;
      shell.style.width = '190px';
      await settle();
      const resizeKeepsActiveVisible = tabVisible('visibility-pane', 'visibility-9');

      activateTab('visibility-1');
      await settle();
      applyWorkspaceTabDrop({key:'visibility-1'}, {paneId:'visibility-pane', zone:'tabs', index:9});
      await settle();
      const dragKeepsActiveVisible = tabVisible('visibility-pane', 'visibility-1');

      const sourceOrderBeforeSplit = [...(workspaceFindPane('visibility-pane')?.tabs || [])];
      const sourceActiveBeforeSplit = sourceOrderBeforeSplit.at(-3);
      const sourceLastBeforeSplit = sourceOrderBeforeSplit.at(-1);
      activateTab(sourceActiveBeforeSplit);
      await settle();
      const sourceScrollBefore = strip.scrollLeft;
      const localKey = 'visibility-local-files';
      openLocalFiles = async (requestedPath='', updateTab=true, existingKey='') => {
        if (existingKey) return existingKey;
        addTab(localKey, '本地文件', '', 'local-files', true, {kind:'local-files', path:requestedPath});
        return localKey;
      };
      await openLocalFilesInPlacement('left');
      await settle();
      const sourcePane = workspaceFindPaneForTab(sourceActiveBeforeSplit);
      const localPane = workspaceFindPaneForTab(localKey);
      const sourceStrip = workspacePaneElement(sourcePane?.id)?.querySelector('.tabs');
      const sourceLast = sourceStrip?.querySelector('.tab[data-tab-key="' + CSS.escape(sourceLastBeforeSplit) + '"]');
      const sourceRect = sourceStrip?.getBoundingClientRect();
      const lastRect = sourceLast?.getBoundingClientRect();
      const splitSourceActivePreserved = sourcePane?.activeTabKey === sourceActiveBeforeSplit;
      const splitSourceActiveVisible = Boolean(sourcePane && tabVisible(sourcePane.id, sourceActiveBeforeSplit));
      const splitSourceDidNotJumpLast = Boolean(sourceRect && lastRect && lastRect.right > sourceRect.right + 1);
      const splitSourceScrollNearPrevious = Math.abs(Number(sourceStrip?.scrollLeft || 0) - sourceScrollBefore) < 180;
      const localSplitCreated = Boolean(localPane && sourcePane && localPane.id !== sourcePane.id && localPane.activeTabKey === localKey);
      const splitSourceOrderPreserved = Boolean(sourcePane && JSON.stringify(sourcePane.tabs) === JSON.stringify(sourceOrderBeforeSplit));
      const splitSourceActiveIndexPreserved = Boolean(sourcePane && sourcePane.tabs.indexOf(sourceActiveBeforeSplit) === sourcePane.tabs.length - 3);
      return {
        switchKeepsActiveVisible,
        resizeKeepsActiveVisible,
        dragKeepsActiveVisible,
        splitSourceActivePreserved,
        splitSourceActiveVisible,
        splitSourceDidNotJumpLast,
        splitSourceScrollNearPrevious,
        localSplitCreated,
        splitSourceOrderPreserved,
        splitSourceActiveIndexPreserved
      };
    } finally {
      openLocalFiles = previousOpenLocalFiles;
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
        topbarTop:topbarRect.top,
        topbarBottom:topbarRect.bottom,
        controlTop:buttonRect?.top || 0,
        controlBottom:buttonRect?.bottom || 0,
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
      const hitTarget = document.elementFromPoint(
        rect.left + Math.max(1, rect.width / 2),
        startY
      );
      hitTarget?.dispatchEvent(new PointerEvent('pointerdown',{
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
      applyTermaAppearanceSettings();
      await nextFrame();
      const classicAppearance = document.documentElement.dataset.appearancePreset === 'clear'
        && !document.documentElement.classList.contains('terma-liquid-enabled');
      const accessible = handle.getAttribute('role') === 'separator'
        && handle.getAttribute('aria-orientation') === 'horizontal'
        && Number(handle.getAttribute('aria-valuemin')) === WORKSPACE_HEADER_HEIGHT_MIN
        && Number(handle.getAttribute('aria-valuemax')) === WORKSPACE_HEADER_HEIGHT_MAX
        && getComputedStyle(handle).display !== 'none'
        && handle.getBoundingClientRect().height >= 6;
      const visibleTabHandle = [...document.querySelectorAll('.workspace-tab-resizer')].find(item => item.getBoundingClientRect().width > 0 && getComputedStyle(item).display !== 'none');
      const tabShell = visibleTabHandle?.closest('.tabs-shell');
      const headerHandleRect = handle.getBoundingClientRect();
      const tabHandleRect = visibleTabHandle?.getBoundingClientRect();
      const tabShellRect = tabShell?.getBoundingClientRect();
      const headerHandleStyle = getComputedStyle(handle);
      const tabHandleStyle = visibleTabHandle ? getComputedStyle(visibleTabHandle) : null;
      const resizeHandlesPlaced = Boolean(visibleTabHandle && tabShell
        && headerHandleStyle.position === 'absolute'
        && tabHandleStyle?.position === 'absolute'
        && nearly(headerHandleRect.top + headerHandleRect.height / 2, topbar.getBoundingClientRect().bottom)
        && nearly(tabHandleRect.top + tabHandleRect.height / 2, tabShellRect.bottom)
        && tabHandleRect.top > headerHandleRect.bottom + 8);
      const headerHandleHit = document.elementFromPoint(
        headerHandleRect.left + headerHandleRect.width / 2,
        headerHandleRect.top + headerHandleRect.height / 2
      ) === handle;
      const tabHandleHit = Boolean(visibleTabHandle && tabHandleRect && document.elementsFromPoint(
        tabHandleRect.left + tabHandleRect.width / 2,
        tabHandleRect.top + tabHandleRect.height / 2
      )[0] === visibleTabHandle);
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
      const controlsUnclipped = [compact, expanded].every(state => state.controlTop >= state.topbarTop - .5
        && state.controlBottom <= state.topbarBottom + .5);
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
        classicAppearance,
        accessible,
        minClamped,
        maxClamped,
        brandAligned,
        textScales,
        controlsScale,
        controlsUnclipped,
        resizeHandlesPlaced,
        resizeHandlesHitTestable:headerHandleHit && tabHandleHit,
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
    for (const name of ['connections','remote','running','command','logs','settings','import']) {
      showPrimary(name);
      await new Promise(resolve => setTimeout(resolve, 250));
      const tools=document.querySelector('#explorerTools');
      const toolsRect=tools?.getBoundingClientRect();
      const expectedMode=['settings','import'].includes(name)?'section-mode':(['connections','remote'].includes(name)?'connection-mode':'compact-mode');
      const maxToolHeight=name==='settings'?264:(name==='import'?220:(['connections','remote','logs'].includes(name)?96:58));
      const controls=[...(tools?.querySelectorAll('button')||[])].map(button=>button.getBoundingClientRect());
      rows.push({
        name,
        width:document.documentElement.clientWidth,
        scrollWidth:document.documentElement.scrollWidth,
        visibleView:Array.from(document.querySelectorAll('.view')).find(el => !el.hidden)?.id || '',
        operationPaneWidth:document.querySelector('.left-pane')?.getBoundingClientRect().width||0,
        toolHeight:toolsRect?.height||0,
        toolFits:Boolean(tools&&toolsRect&&tools.scrollWidth<=tools.clientWidth+1&&controls.every(rect=>rect.left>=toolsRect.left-0.5&&rect.right<=toolsRect.right+0.5)),
        layoutMode:Boolean(tools?.classList.contains(expectedMode)),
        compactHeight:Boolean(toolsRect&&toolsRect.height<=maxToolHeight)
      });
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
    const previousSecurity = securitySettings;
    const previousDesktopSettings = desktopSettings;
    const previousLatestJobs = sftpLatestJobs;
    const previousLanguage = normalizeTermaLanguage(document.documentElement.lang || runtimeSettings?.saved?.language);
    const previousReadVersion = updateNoticeReadVersion;
    const previousStoredVersion = sessionStorage.getItem(UPDATE_NOTICE_SESSION_KEY);
    const previousLatencyVisible = terminalLatencyVisible;
    let thirdPartyLiveFixture = null;
    let thirdPartyLiveEditor = null;
    let thirdPartyLiveZmodemSession = null;
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
      securitySettings = {
        ...securitySettings,
        trusted_proxy_enabled:false,
        local_direct_desktop_integration_enabled:false,
        local_direct_desktop_integration:{
          enabled:false,
          available:false,
          authorized:false,
          actual_listen_hosts:['127.0.0.1'],
          listen_loopback_only:true,
          direct_loopback_request:true,
          web_session_authenticated:true,
          web_access_authorized:true,
          blocked_reason:'disabled'
        }
      };
      desktopSettings = {
        available:true,
        storage_management_available:true,
        settings:{
          dataMode:'project',
          customDataDir:'',
          openAtLogin:false,
          minimizeToTray:true,
          startMinimizedToTray:false,
          showStartupNotification:true,
          xServerAutoStart:true
        },
        paths:{
          dataDir:'C:\\\\TermaSmoke\\\\data',
          sshDir:'C:\\\\TermaSmoke\\\\.ssh'
        },
        storage:{
          root:'C:\\\\TermaSmoke',
          data_dir:'C:\\\\TermaSmoke\\\\data',
          ssh_dir:'C:\\\\TermaSmoke\\\\.ssh'
        },
        project_mode_available:true,
        project_mode_label:'项目所在文件夹',
        xserver:{available:false,installed:false}
      };
      updateNoticeReadVersion = '';
      sessionStorage.removeItem(UPDATE_NOTICE_SESSION_KEY);
      setWorkspace('设置', '通用设置', 'settings', 'settings-ui-smoke', false, true, {kind:'settings'});
      renderSettings();
      renderExplorerTools();
      syncUpdateNoticeDots();
      await setTermaLanguage('zh-CN');
      const visibleHan = [];
      const thirdPartyLiveSwitch = {
        scenario:'third-party-live-language-switch',
        aceSeededChinese:false,
        zmodemSeededChinese:false,
        aceClean:false,
        zmodemClean:false,
        zmodemLocalizedTitle:false,
        zmodemUserTextPreserved:false
      };
      const collectThirdPartyChromeHan = (root, textSelector, preservedValues=[]) => {
        const findings = [];
        if (!root) return findings;
        const chromeValue = value => preservedValues.reduce((result, preserved) => result.split(preserved).join(''), value);
        for (const textRoot of root.querySelectorAll(textSelector)) {
          const walker = document.createTreeWalker(textRoot, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const value = String(walker.currentNode.nodeValue || '').replace(/\\s+/g, ' ').trim();
            if (value && /[\u3400-\u9fff]/.test(chromeValue(value))) findings.push(value);
          }
        }
        const elements = [];
        if (root.matches?.('[title],[aria-label],[placeholder],[aria-roledescription]')) elements.push(root);
        elements.push(...root.querySelectorAll('[title],[aria-label],[placeholder],[aria-roledescription]'));
        for (const element of elements) {
          for (const attribute of ['title','aria-label','placeholder','aria-roledescription']) {
            const value = String(element.getAttribute(attribute) || '').replace(/\\s+/g, ' ').trim();
            if (value && /[\u3400-\u9fff]/.test(chromeValue(value))) findings.push('@' + attribute + '=' + value);
          }
        }
        return findings;
      };
      if (typeof window.ace?.edit !== 'function') throw new Error('Ace runtime was not loaded before the live language-switch scenario');
      window.ace.config.set('basePath', '/vendor/ace');
      window.ace.config.set('useStrictCSP', true);
      syncTermaAceLocalization();
      thirdPartyLiveFixture = document.createElement('section');
      thirdPartyLiveFixture.style.cssText = 'position:fixed;left:-2000px;top:0;width:720px;height:420px;z-index:9999;background:var(--panel)';
      thirdPartyLiveFixture.innerHTML = '<div class="sftp-code-editor third-party-live-ace" style="width:100%;height:260px"></div><div class="terminal-box third-party-live-zmodem"></div>';
      document.body.appendChild(thirdPartyLiveFixture);
      const thirdPartyLiveAceHost = thirdPartyLiveFixture.querySelector('.third-party-live-ace');
      thirdPartyLiveEditor = window.ace.edit(thirdPartyLiveAceHost);
      thirdPartyLiveAceHost.__termaAceEditor = thirdPartyLiveEditor;
      thirdPartyLiveEditor.session.setUseWorker(false);
      thirdPartyLiveEditor.setValue('{\\n  "value": 1\\n}\\n', -1);
      await new Promise(resolve => thirdPartyLiveEditor.session.setMode('ace/mode/json', resolve));
      thirdPartyLiveEditor.setOption('enableKeyboardAccessibility', true);
      thirdPartyLiveEditor.session.setAnnotations([{row:0,column:0,text:'Smoke warning',type:'warning'}]);
      thirdPartyLiveEditor.renderer.updateFull(true);
      thirdPartyLiveEditor.execCommand('find');
      for (let attempt=0; attempt<20 && !thirdPartyLiveFixture.querySelector('.ace_search'); attempt+=1) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      syncTermaAceLocalization(thirdPartyLiveFixture);
      thirdPartyLiveZmodemSession = {mount:thirdPartyLiveFixture.querySelector('.third-party-live-zmodem')};
      const thirdPartyLiveZmodemFilename = '设置';
      terminalZmodemRender(thirdPartyLiveZmodemSession, {
        titleKey:'terminal:zmodem.receiving_file',
        titleOptions:{name:thirdPartyLiveZmodemFilename, defaultValue:'正在接收 ' + thirdPartyLiveZmodemFilename},
        detailKey:'terminal:zmodem.binary_mode_hint',
        detailOptions:{defaultValue:'已启用二进制传输模式；按 Ctrl+C 可取消'},
        primaryAction:'send',
        primaryLabelKey:'terminal:zmodem.choose_files',
        primaryLabelOptions:{defaultValue:'选择文件'}
      });
      const aceChineseBeforeSwitch = collectThirdPartyChromeHan(thirdPartyLiveAceHost, '.ace_search');
      const zmodemChineseBeforeSwitch = collectThirdPartyChromeHan(thirdPartyLiveZmodemSession.mount, '.terminal-zmodem-panel', [thirdPartyLiveZmodemFilename]);
      thirdPartyLiveSwitch.aceSeededChinese = aceChineseBeforeSwitch.length > 0;
      thirdPartyLiveSwitch.zmodemSeededChinese = zmodemChineseBeforeSwitch.length > 0;
      const tabsBeforeLanguageSwitch = tabs.map(tab => tab.key);
      const languageTaskFixtures = [
        {id:'language-paused-cross-copy',status:'paused',type:'cross-copy',label:'跨 SFTP 传输',connection_id:1,connection_name:'Target',size:100,transferred:50,can_resume:true,resume_supported:true},
        {id:'language-running-cross-copy',status:'running',type:'cross-copy',phase:'transferring',label:'跨 SFTP 传输',connection_id:1,connection_name:'Target',size:100,transferred:25,can_pause:true,resume_supported:true}
      ];
      sftpLatestJobs = languageTaskFixtures;
      updateSftpTaskCenter(languageTaskFixtures);
      const originalLanguageApi = api;
      const languageRequests = [];
      api = async (path, options={}) => {
        if (path === '/api/runtime-settings' && String(options.method || 'GET').toUpperCase() === 'PUT') {
          const body = JSON.parse(options.body || '{}');
          languageRequests.push(body);
          return normalizeRuntimeSettingsResponse({
            ...runtimeSettings,
            saved:{...runtimeSettings.saved, language:body.language}
          });
        }
        return originalLanguageApi(path, options);
      };
      document.querySelector('#languageToggle')?.click();
      for (let attempt=0; attempt<30 && document.documentElement.lang !== 'en-US'; attempt+=1) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      api = originalLanguageApi;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const aceHanAfterSwitch = collectThirdPartyChromeHan(thirdPartyLiveAceHost, '.ace_search');
      const zmodemHanAfterSwitch = collectThirdPartyChromeHan(thirdPartyLiveZmodemSession.mount, '.terminal-zmodem-panel', [thirdPartyLiveZmodemFilename]);
      thirdPartyLiveSwitch.aceClean = aceHanAfterSwitch.length === 0;
      thirdPartyLiveSwitch.zmodemClean = zmodemHanAfterSwitch.length === 0;
      const thirdPartyLiveZmodemTitle = String(thirdPartyLiveZmodemSession.mount.querySelector('.terminal-zmodem-copy strong')?.textContent || '');
      thirdPartyLiveSwitch.zmodemLocalizedTitle = thirdPartyLiveZmodemTitle === tr('terminal:zmodem.receiving_file', {name:thirdPartyLiveZmodemFilename});
      thirdPartyLiveSwitch.zmodemUserTextPreserved = thirdPartyLiveZmodemTitle.includes(thirdPartyLiveZmodemFilename);
      visibleHan.push(...aceHanAfterSwitch.map(value => 'third-party-live-ace: ' + value));
      visibleHan.push(...zmodemHanAfterSwitch.map(value => 'third-party-live-zmodem: ' + value));
      terminalZmodemRender(thirdPartyLiveZmodemSession, {hidden:true});
      try { thirdPartyLiveEditor.destroy(); } catch {}
      thirdPartyLiveFixture.remove();
      thirdPartyLiveEditor = null;
      thirdPartyLiveZmodemSession = null;
      thirdPartyLiveFixture = null;
      renderSettings();
      renderExplorerTools();
      await new Promise(resolve => setTimeout(resolve, 0));
      const englishTaskMarkup = languageTaskFixtures.map(renderSftpJob).join('');
      const languageButton = document.querySelector('#languageToggle');
      const languageThemeButton = document.querySelector('#themeToggle');
      const languageRect = languageButton?.getBoundingClientRect();
      const themeRect = languageThemeButton?.getBoundingClientRect();
      const collectVisibleHan = (scope, includeHidden=false, root=document.body) => {
        const scanRoot = root?.nodeType ? root : document.body;
        const walker = document.createTreeWalker(scanRoot, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const parent = node.parentElement;
          const value = String(node.nodeValue || '').replace(/\\s+/g,' ').trim();
          if (!value || !/[\u3400-\u9fff]/.test(value) || !parent || termaI18nSkipped(parent)) continue;
           if (!includeHidden && (!parent.getClientRects().length || getComputedStyle(parent).visibility === 'hidden')) continue;
           visibleHan.push(scope+': '+value);
         }
        for (const element of scanRoot.querySelectorAll?.('[title],[aria-label],[placeholder]') || []) {
          if (termaI18nSkipped(element) || (!includeHidden && (!element.getClientRects().length || getComputedStyle(element).visibility === 'hidden'))) continue;
          for (const attribute of ['title','aria-label','placeholder']) {
            const value = String(element.getAttribute(attribute) || '').replace(/\\s+/g,' ').trim();
            if (value && /[\u3400-\u9fff]/.test(value)) visibleHan.push(scope+': @'+attribute+'='+value);
          }
        }
      };
      const collectTranslatedHan = async (scope, includeHidden=false, root=document.body) => {
        applyTermaTranslations(root || document.body);
        await new Promise(resolve => setTimeout(resolve, 0));
        collectVisibleHan(scope, includeHidden, root);
      };
      for (const section of ['settings-general','settings-basic','settings-notifications','settings-runtime','settings-cache','settings-about']) {
        showSettingsSection(section, {moveToWorkspace:false});
        await new Promise(resolve => setTimeout(resolve, 0));
        collectVisibleHan(section);
      }
      const generalVncFullscreenToolbar = document.querySelector('#settings-general #generalVncFullscreenToolbar');
      if (!generalVncFullscreenToolbar || JSON.stringify([...generalVncFullscreenToolbar.options].map(option => option.value)) !== JSON.stringify(['always','never','edge'])) {
        throw new Error('VNC fullscreen toolbar preference is missing from general settings');
      }
      if (document.querySelector('#settings-runtime #runtimeVncFullscreenToolbar')) {
        throw new Error('VNC fullscreen toolbar preference is still present in listener settings');
      }
      for (const name of ['connections','remote','running','command','logs','import']) {
        showPrimary(name);
        await new Promise(resolve => setTimeout(resolve, 0));
        collectVisibleHan(name);
      }
      const previousLanguageApi = api;
      const languageRemoteConnection = connections[0] || {id:1,name:'Language SSH',ssh_host:'192.0.2.7',ssh_port:22,ssh_user:'smoke',x11_mode:'trusted'};
      const languageVncProfile = {id:910091,name:'Language VNC',protocol:'vnc',host:'192.0.2.77',port:5900,username:'',options:{source_ssh_connection_id:Number(languageRemoteConnection.id),view_only:false}};
      const languageVncKey = 'language-vnc-clipboard';
      const languageVncSession = {key:languageVncKey,profile:languageVncProfile,rfb:{viewOnly:false},screen:document.createElement('div'),connecting:false,connected:true,clipboardAutoSync:false,clipboardTransport:'ssh-linux-x11',clipboardTransportChecked:true,clipboardBridgeTool:'xclip',remoteClipboardAvailable:false,remoteClipboardPending:false,remoteClipboardText:'',viewport:null};
      vncSessions.set(languageVncKey, languageVncSession);
      api = async (path, options={}) => {
        const value = String(path);
        if (value === '/api/xserver') return {integration_available:true,desktop:true,desktop_backend_available:true,authorization_required:false,platform:'linux',available:true,running:true,managed:true,mode:'native',server:'X11',display:':0',reason:'X Server 已就绪',can_start:false,can_stop:false,can_install:false};
        if (value.endsWith('/x11-forwarding')) return {platform:'linux',ready:true,enabled:true,x11_forwarding:'yes',sshd_present:true,config_present:true,can_manage:true,can_terminal_manage:true,xauth_path:'/usr/bin/xauth',xauth_location:'/usr/bin/xauth',x11_display_offset:'10',terminal_commands:{}};
        if (value.endsWith('/x11-clipboard/helper')) return {platform:'linux',installed:false,package_manager:'apt',reason:'远端尚未安装 xclip；安装后可从 X11 转发终端粘贴图片',install_plan:{online:{available:true,description:'在线安装'},offline:{available:true,description:'使用远端缓存'},local_offline:{available:true,package_names:['xclip'],description:'本机下载后离线安装'},manual:{available:true,description:'手动安装/配置说明'}},guide:{steps:['确认本机 X Server 已启动'],commands:['command -v xclip']},uninstall_plan:{available:false}};
        return previousLanguageApi(value, options);
      };
      try {
        await openXServerManager(Number(languageRemoteConnection.id));
        collectVisibleHan('xserver');
        closeXServerManager();
        renderEmbeddedVnc(languageVncProfile, languageVncKey, {platform:'linux'});
        await new Promise(resolve => setTimeout(resolve, 0));
        const vncToolbar = document.querySelector('#view-remote-desktop .vnc-toolbar-actions');
        if (!vncToolbar?.querySelector('[data-vnc-fullscreen-toggle]')) throw new Error('VNC fullscreen toggle is missing');
        if (vncToolbar?.querySelector('[data-vnc-window-maximize]')) throw new Error('VNC native maximize toggle should use the Electron title bar instead');
        if (![...vncToolbar.querySelectorAll('button')].some(button => button.title === 'Open in new window')) throw new Error('VNC detached-window action is missing');
        if (!document.querySelector('#view-remote-desktop .vnc-fullscreen-toolbar-edge-zone')) throw new Error('VNC fullscreen top-edge target is missing');
        const originalSetTimeout = window.setTimeout;
        let fullscreenToolbarHideDelay = null;
        try {
          window.setTimeout = (callback, delay, ...args) => {
            fullscreenToolbarHideDelay = Number(delay);
            return originalSetTimeout(callback, 0, ...args);
          };
          document.documentElement.classList.add('vnc-fullscreen-toolbar-edge-visible');
          hideVncFullscreenEdgeToolbar();
        } finally {
          window.setTimeout = originalSetTimeout;
        }
        await new Promise(resolve => originalSetTimeout(resolve, 0));
        if (fullscreenToolbarHideDelay !== 500) throw new Error('VNC fullscreen toolbar hide delay should be 500ms, got ' + fullscreenToolbarHideDelay);
        if (document.documentElement.classList.contains('vnc-fullscreen-toolbar-edge-visible')) throw new Error('VNC fullscreen toolbar hide timer did not collapse the toolbar');
        collectVisibleHan('vnc');
        collectVisibleHan('document', true);
        const vncWindowBridgeDescriptor = Object.getOwnPropertyDescriptor(window, 'termaDesktop');
        const vncWindowLifecycle = [];
        try {
          Object.defineProperty(window, 'termaDesktop', {
            configurable:true,
            writable:true,
            value:{
              async openVncWindow(profileId) {
                vncWindowLifecycle.push({action:'open-detached',profileId,embeddedActive:vncSessions.has(languageVncKey)});
                return {ok:true,profileId,reused:false};
              },
              async closeVncWindowForProfile(profileId) {
                vncWindowLifecycle.push({action:'close-detached',profileId});
                return {ok:true,profileId,closed:true};
              }
            }
          });
          const detachedOpened = await openVncInNewWindow(languageVncProfile.id, languageVncKey);
          const embeddedPrepared = await prepareEmbeddedVncWindowSwitch(languageVncProfile.id);
          if (!detachedOpened || vncSessions.has(languageVncKey)) throw new Error('Opening a detached VNC window did not close the built-in session');
          if (vncWindowLifecycle[0]?.action !== 'open-detached' || vncWindowLifecycle[0]?.embeddedActive) throw new Error('Detached VNC opened before the built-in session was closed');
          if (!embeddedPrepared || vncWindowLifecycle[1]?.action !== 'close-detached') throw new Error('Switching to built-in VNC did not close the detached window');
        } finally {
          if (vncWindowBridgeDescriptor) Object.defineProperty(window, 'termaDesktop', vncWindowBridgeDescriptor);
          else delete window.termaDesktop;
        }
      } finally {
        closeXServerManager();
        vncSessions.delete(languageVncKey);
        api = previousLanguageApi;
      }
      const i18nScenarioErrors = [];
      const runI18nScenario = async (name, action) => {
        try {
          await action();
          await new Promise(resolve => setTimeout(resolve, 0));
          applyTermaTranslations(document);
          await new Promise(resolve => setTimeout(resolve, 0));
        } catch (error) {
          i18nScenarioErrors.push(name + ': ' + (error?.message || error));
        }
      };
      await runI18nScenario('file-picker-language-switch', async () => {
        const input = document.getElementById('config_upload');
        const name = input?.closest('.file-picker')?.querySelector('.file-picker-name');
        if (!input || !name) throw new Error('config file picker was not found');
        try {
          Object.defineProperty(input, 'files', {configurable:true,value:[]});
          updateFilePicker(input);
          if (name.textContent.trim() !== 'No file selected' || name.dataset.i18n !== 'common:auto.not_selected') throw new Error('empty file picker was not generated in English');
          Object.defineProperty(input, 'files', {configurable:true,value:[{name:'中文配置.conf'}]});
          updateFilePicker(input);
          if (name.textContent.trim() !== '中文配置.conf' || name.dataset.i18n || name.dataset.i18nSkip !== 'true') throw new Error('selected user filename was not protected from translation');
          await setTermaLanguage('zh-CN', {emit:false});
          await setTermaLanguage('en-US', {emit:false});
          applyTermaTranslations(name);
          if (name.textContent.trim() !== '中文配置.conf') throw new Error('selected user filename changed after switching languages');
          Object.defineProperty(input, 'files', {configurable:true,value:[{name:'一.txt'},{name:'二.txt'}]});
          updateFilePicker(input);
          if (name.textContent.trim() !== '2 files selected' || name.dataset.filePickerCount !== '2') throw new Error('multi-file count was not generated in English');
          await setTermaLanguage('zh-CN', {emit:false});
          if (name.textContent.trim() !== '已选择 2 个文件') throw new Error('multi-file count did not refresh in Chinese');
          await setTermaLanguage('en-US', {emit:false});
          if (name.textContent.trim() !== '2 files selected') throw new Error('multi-file count did not refresh back to English');
          Object.defineProperty(input, 'files', {configurable:true,value:[]});
          updateFilePicker(input);
          if (name.textContent.trim() !== 'No file selected' || name.dataset.i18n !== 'common:auto.not_selected' || name.dataset.i18nSkip) throw new Error('cleared file picker did not restore the English empty state');
        } finally {
          delete input.files;
          updateFilePicker(input);
        }
      });
      await runI18nScenario('connection-health-diagnosis', async () => {
        const fixed = localizedHealthSshDiagnosis({
          diagnosis:{reason_code:'ssh_handshake_timeout',reason:'SSH 握手超时',message:'SSH 握手超时，请检查主机地址、端口和 SSH 服务'},
          raw_output:'SSH 握手超时，请检查主机地址、端口和 SSH 服务',
          preserve_raw_output:false
        });
        if (fixed !== 'SSH handshake timed out. Check the host address, port, and SSH service.' || /[\u3400-\u9fff]/.test(fixed)) throw new Error('fixed SSH health diagnosis was not generated in English');
        const remoteOutput = '远端自定义诊断输出';
        const preserved = localizedHealthSshDiagnosis({
          diagnosis:{reason_code:'ssh_failed',reason:'SSH 操作失败',message:remoteOutput},
          raw_output:remoteOutput,
          preserve_raw_output:true
        });
        if (!preserved.includes('The SSH connection failed.') || !preserved.includes(remoteOutput)) throw new Error('raw remote SSH output was not preserved');
      });
      await runI18nScenario('third-party-components', async () => {
        if (typeof window.ace?.edit !== 'function') throw new Error('Ace runtime was not loaded');
        if (typeof window.Diff?.diffLines !== 'function') throw new Error('jsdiff runtime was not loaded');
        if (typeof window.Zmodem?.Sentry !== 'function') throw new Error('ZMODEM runtime was not loaded');
        const aceMessages = termaAceMessages();
        if (Object.values(aceMessages).some(value => /[\u3400-\u9fff]/.test(String(value)))) {
          throw new Error('Ace messages still contain Chinese');
        }
        const fixture = document.createElement('section');
        fixture.style.cssText = 'position:fixed;left:24px;top:24px;width:720px;height:420px;z-index:9999;background:var(--panel)';
        fixture.innerHTML = '<div class="third-party-ace" style="width:100%;height:220px"></div><div class="third-party-diff"></div><div class="third-party-zmodem"></div>';
        document.body.appendChild(fixture);
        let editor = null;
        try {
          const aceHost = fixture.querySelector('.third-party-ace');
          editor = window.ace.edit(aceHost);
          editor.setValue('first\\nsecond\\n', -1);
          editor.execCommand('find');
          let findInput = null;
          let replaceInput = null;
          for (let attempt=0; attempt<20 && !findInput; attempt+=1) {
            await new Promise(resolve => setTimeout(resolve, 10));
            findInput = fixture.querySelector('.ace_search_form .ace_search_field');
            replaceInput = fixture.querySelector('.ace_replace_form .ace_search_field');
          }
          syncTermaAceLocalization(fixture);
          if (!findInput || findInput.placeholder !== aceMessages['search-box.find.placeholder']) {
            throw new Error('Ace find placeholder was not localized: ' + JSON.stringify({actual:findInput?.placeholder || '', expected:aceMessages['search-box.find.placeholder']}));
          }
          if (!replaceInput || replaceInput.placeholder !== aceMessages['search-box.replace.placeholder']) {
            throw new Error('Ace replace placeholder was not localized: ' + JSON.stringify({actual:replaceInput?.placeholder || '', expected:aceMessages['search-box.replace.placeholder']}));
          }
          const diffHost = fixture.querySelector('.third-party-diff');
          diffHost.innerHTML = sftpDiffViewerHtml('first\\nold value\\n', 'first\\nnew value\\n', {
            oldLabel:tr('sftp:diff.old_version'),
            newLabel:tr('sftp:diff.new_version')
          });
          const zmodemMount = fixture.querySelector('.third-party-zmodem');
          const zmodemSession = {mount:zmodemMount};
          terminalZmodemRender(zmodemSession, {
            detailKey:'terminal:zmodem.binary_mode_hint',
            detailOptions:{defaultValue:'已启用二进制传输模式；按 Ctrl+C 可取消'},
            primaryAction:'send',
            primaryLabelKey:'terminal:zmodem.choose_files',
            primaryLabelOptions:{defaultValue:'选择文件'}
          });
          collectVisibleHan('third-party-components', true, fixture);
          terminalZmodemRender(zmodemSession, {hidden:true});
        } finally {
          try { editor?.destroy(); } catch {}
          fixture.remove();
        }
      });
      await runI18nScenario('welcome', async () => {
        const scenarioApi = api;
        api = async (path, options={}) => String(path) === '/api/startup-status'
          ? {state:'ready',local_url:'http://127.0.0.1:18100',lan_urls:[]}
          : scenarioApi(path, options);
        try {
          await setTermaLanguage('zh-CN', {emit:false});
          renderWelcome();
          await new Promise(resolve => setTimeout(resolve, 0));
          if (document.getElementById('workspaceSubtitle')?.textContent.trim() !== '选择左侧项目后开始操作') throw new Error('welcome workspace subtitle was not seeded in Chinese');
          await setTermaLanguage('en-US', {emit:false});
          await new Promise(resolve => setTimeout(resolve, 0));
          applyTermaTranslations(document.getElementById('view-welcome'));
          collectVisibleHan('welcome-open', true, document.getElementById('view-welcome'));
          collectVisibleHan('welcome-workspace-header-after-switch', true, document.querySelector('.workspace-heading'));
          if (document.getElementById('workspaceSubtitle')?.textContent.trim() !== 'Select an item on the left to begin') throw new Error('welcome workspace subtitle did not switch to English');
        } finally {
          api = scenarioApi;
        }
      });
      await runI18nScenario('rdp-form', async () => {
        renderRemoteProfileForm({id:910099,protocol:'rdp',name:'Language RDP',group_name:'Default',options:{display_mode:'dynamic',clipboard:true}});
        await new Promise(resolve => setTimeout(resolve, 0));
        applyTermaTranslations(document.getElementById('view-edit'));
        const editActions = [...document.querySelectorAll('#remoteProfileForm button[type="submit"]')].map(button => button.textContent.trim());
        if (!['Save only','Save and close','Save and open'].every(label => editActions.includes(label))) throw new Error('remote connection edit save actions were not generated in English');
        collectVisibleHan('rdp-form-open', true, document.getElementById('view-edit'));
      });
      await runI18nScenario('quick-panel', async () => {
        await openQuickPanel();
        renderQuickPanel('');
        await new Promise(resolve => setTimeout(resolve, 0));
        applyTermaTranslations(document);
        collectVisibleHan('quick-panel-open', true, document.getElementById('quickPanel'));
        closeQuickPanel();
      });
      await runI18nScenario('ssh-key-wizard', async () => {
        openSshKeyWizard();
        await new Promise(resolve => setTimeout(resolve, 0));
        applyTermaTranslations(document);
        collectVisibleHan('ssh-key-wizard-open', true, document.getElementById('modal'));
        closeModal();
      });
      await runI18nScenario('connected-tab-close', async () => {
        const decision = confirmWorkspaceConnectedTabClose([{title:'Language Terminal',connectionStatus:'connected'}]);
        await new Promise(resolve => setTimeout(resolve, 0));
        collectVisibleHan('connected-tab-close-modal', true, document.getElementById('modal'));
        document.getElementById('workspaceCloseTabsCancel')?.click();
        await decision;
      });
      await runI18nScenario('recent-commands', async () => {
        const previousRecentCommands = recentTerminalCommands;
        recentTerminalCommands = ['printf "language smoke"'];
        try {
          showRecentTerminalCommands('language-terminal');
          const modal = document.getElementById('modal');
          collectVisibleHan('recent-commands-immediate', true, modal);
          if (modal?.querySelector('h2')?.textContent.trim() !== 'Recent commands') throw new Error('recent commands dialog was not generated in English');
          document.getElementById('recentCommandClose')?.click();
        } finally {
          recentTerminalCommands = previousRecentCommands;
          closeModal();
        }
      });
      await runI18nScenario('workspace-tab-menu', async () => {
        const tab = tabs.find(item => item.closable !== false) || tabs[0];
        if (!tab) throw new Error('no workspace tab available');
        showTabContextMenu({preventDefault(){},stopPropagation(){},clientX:160,clientY:120}, tab.key);
        await collectTranslatedHan('workspace-tab-menu-open', true, document.getElementById('tabContextMenu'));
        hideTabContextMenu();
      });
      await runI18nScenario('local-files-shortcuts', async () => {
        const scenarioLocalFilesAvailable = localFilesAvailable;
        localFilesAvailable = () => true;
        const host = document.createElement('div');
        try {
          host.innerHTML = localFilesToolbarButtonHtml('language-local-files');
          document.body.appendChild(host);
          await collectTranslatedHan('local-files-shortcut-button', true, host);
          showNewLocalFilesMenu({preventDefault(){},stopPropagation(){},clientX:180,clientY:140});
          const menu = document.getElementById('actionMenu');
          if (!menu) throw new Error('local files menu was not opened');
          await collectTranslatedHan('local-files-shortcut-menu', true, menu);
        } finally {
          hideActionMenu();
          host.remove();
          localFilesAvailable = scenarioLocalFilesAvailable;
        }
      });
      await runI18nScenario('local-files-view', async () => {
        const scenarioLocalFilesRoot = localFilesRoot;
        const tabKey = 'language-local-files-view';
        const host = document.createElement('div');
        host.innerHTML = '<div id="view-local-files"><div class="local-files-shell"><div class="local-files-list"></div></div></div>';
        document.body.appendChild(host);
        localFilesRoot = () => host.querySelector('#view-local-files');
        Object.assign(localFilesRuntime(tabKey), {
          path:'C:/LanguageSmoke',displayPath:'C:/LanguageSmoke',location:'directory',parent:'C:/',parentKind:'directory',
          page:1,pageSize:50,total:1,totalPages:1,loaded:true,query:'',sort:'name',dir:'asc',
          entries:[{name:'notes.txt',path:'C:/LanguageSmoke/notes.txt',type:'file',size:12,mtime:1700000000,mode:'644'}]
        });
        try {
          renderLocalFiles(tabKey);
          const root = localFilesRoot(tabKey);
          collectVisibleHan('local-files-view-immediate', true, root);
          const row = root?.querySelector('.local-files-row');
          if (!row) throw new Error('local files row was not rendered');
          showLocalFileEntryMenu({preventDefault(){},stopPropagation(){},clientX:220,clientY:180}, 'C:/LanguageSmoke/notes.txt', 'file', tabKey);
          const menu = document.getElementById('actionMenu');
          collectVisibleHan('local-files-context-menu-immediate', true, menu);
          const labels = [...menu.querySelectorAll('button span')].map(item => item.textContent.trim());
          if (!labels.includes('Open / Edit') || !labels.includes('Open in system file manager') || !labels.includes('Copy path')) throw new Error('local files context menu was not generated in English');
        } finally {
          hideActionMenu();
          localFileRuntimes.delete(tabKey);
          localFilesRoot = scenarioLocalFilesRoot;
          host.remove();
        }
      });
      await runI18nScenario('remote-explorer-menu', async () => {
        showRemoteExplorerMenu({preventDefault(){},stopPropagation(){},clientX:180,clientY:140});
        await collectTranslatedHan('remote-explorer-menu-open', true, document.getElementById('actionMenu'));
        hideActionMenu();
      });
      await runI18nScenario('sftp-settings', async () => {
        const scenarioApi = api;
        api = async (path, options={}) => String(path) === '/api/sftp/download-settings'
          ? {delivery_mode:'desktop',configured_directory:'',default_directory:'C:\\Downloads',effective_directory:'C:\\Downloads'}
          : scenarioApi(path, options);
        try {
          await showSftpGlobalSettings();
          for (const section of ['general','editor','transfer']) {
            selectSftpSettingsTab(section);
            await new Promise(resolve => setTimeout(resolve, 0));
            collectVisibleHan('sftp-settings-' + section, true, document.getElementById('modal'));
          }
        } finally {
          closeSftpGlobalSettings();
          api = scenarioApi;
        }
      });
      await runI18nScenario('sftp-view', async () => {
        const scenarioApi = api;
        const scenarioRefreshSftpJobs = refreshSftpJobs;
        const scenarioStartSftpJobsTimer = startSftpJobsTimer;
        const connectionId = Number(languageRemoteConnection.id);
        const tabKey = 'language-sftp-view';
        refreshSftpJobs = async () => [];
        startSftpJobsTimer = () => {};
        api = async (path, options={}) => {
          const value = String(path);
          if (['/api/sftp/jobs','/api/sftp/sync/jobs','/api/linux-desktop/tasks','/api/remote-component/tasks'].includes(value)) return [];
          if (value.startsWith('/api/connections/' + connectionId + '/sftp?')) return {
            path:'/',page:1,page_size:50,total:1,total_pages:1,unfiltered_total:1,paged:true,sort:'name',dir:'asc',
            entries:[{name:'notes.txt',path:'/notes.txt',type:'file',size:12,mtime:1700000000,mode:'-rw-r--r--',owner:'smoke',group:'smoke',metadata_known:true}]
          };
          return scenarioApi(path, options);
        };
        try {
          await openSftp(connectionId, '/', true, tabKey);
          toggleSftpSearch(tabKey);
          updateSftpConnectionUi(connectionId, 'disconnected', 'SFTP 连接已断开');
          await new Promise(resolve => setTimeout(resolve, 0));
          applyTermaTranslations(document);
          collectVisibleHan('sftp-view-open', true, document.querySelector('[data-sftp-tab-key="' + tabKey + '"]'));
          await runI18nScenario('sftp-context-menu', async () => {
            const row = document.querySelector('[data-sftp-tab-key="' + tabKey + '"] .sftp-row');
            if (!row) throw new Error('SFTP row was not rendered');
            showSftpEntryMenu({currentTarget:row,target:row,preventDefault(){},stopPropagation(){},clientX:220,clientY:180}, connectionId, '/notes.txt', 'notes.txt', 'file', tabKey);
            await collectTranslatedHan('sftp-context-menu-open', true, document.getElementById('actionMenu'));
            hideActionMenu();
          });
          await runI18nScenario('sftp-permissions-dialog', async () => {
            openSftpPermissionsForSelection(['/notes.txt'], tabKey);
            const modal = document.getElementById('modal');
            collectVisibleHan('sftp-permissions-dialog-immediate', true, modal);
            if (modal?.querySelector('h2')?.textContent.trim() !== 'Set permissions') throw new Error('SFTP permissions dialog was not generated in English');
            document.getElementById('sftpPermissionCancel')?.click();
          });
          await runI18nScenario('sftp-rename-dialog', async () => {
            const operation = renameSftp(connectionId, '/notes.txt', 'notes.txt', tabKey);
            await new Promise(resolve => setTimeout(resolve, 0));
            const modal = document.getElementById('modal');
            collectVisibleHan('sftp-rename-dialog-immediate', true, modal);
            if (modal?.querySelector('h2')?.textContent.trim() !== 'Rename' || modal?.querySelector('label')?.textContent.trim() !== 'New name') throw new Error('SFTP rename dialog was not generated in English');
            document.getElementById('modalCancelBtn')?.click();
            await operation;
          });
          await runI18nScenario('sftp-compress-dialog', async () => {
            const operation = compressSingleSftp(connectionId, '/notes.txt', tabKey);
            await new Promise(resolve => setTimeout(resolve, 0));
            const modal = document.getElementById('modal');
            collectVisibleHan('sftp-compress-dialog-immediate', true, modal);
            if (modal?.querySelector('h2')?.textContent.trim() !== 'Compress remote item') throw new Error('SFTP compression dialog was not generated in English');
            document.getElementById('modalCancelBtn')?.click();
            await operation;
          });
        } finally {
          closeTabsByKey([tabKey], tabKey);
          refreshSftpJobs = scenarioRefreshSftpJobs;
          startSftpJobsTimer = scenarioStartSftpJobsTimer;
          api = scenarioApi;
        }
      });
      await runI18nScenario('xclip-local-offline', async () => {
        const scenarioApi = api;
        const connectionId = Number(languageRemoteConnection.id);
        api = async (path, options={}) => String(path).endsWith('/x11-clipboard/helper')
          ? {platform:'linux',root:true,installed:false,install_plan:{local_offline:{available:true}}}
          : scenarioApi(path, options);
        try {
          const action = runX11ClipboardHelperAction(connectionId, 'local-offline');
          for (let attempt=0; attempt<20 && document.getElementById('modal')?.hidden; attempt+=1) await new Promise(resolve => setTimeout(resolve, 5));
          collectVisibleHan('xclip-local-offline-modal', true, document.getElementById('modal'));
          document.querySelector('#modal .actions button:not(.primary):last-child')?.click();
          await action;
        } finally {
          closeModal();
          api = scenarioApi;
        }
      });
      await runI18nScenario('xclip-no-plan-notification', async () => {
        notify('当前系统没有可用的 xclip 安装方案，请查看手动安装说明', 'error');
        await new Promise(resolve => setTimeout(resolve, 0));
        applyTermaTranslations(document.getElementById('toast'));
        collectVisibleHan('xclip-no-plan-notification-open', true, document.getElementById('toast'));
      });
      await runI18nScenario('named-workspaces', async () => {
        const previousWorkspaces = productivityState.workspaces;
        const scenarioWorkspaces = [{
          id:910101,
          name:'Workspace 4',
          description:'',
          layout:{tabs:[{kind:'settings',key:'settings'}],workspace_groups:[{id:'workspace-main',name:'Main',tabs:[{kind:'settings',key:'settings'}]}]}
        }];
        const scenarioApi = api;
        api = async (path, options={}) => String(path) === '/api/named-workspaces' && !options.method ? scenarioWorkspaces : scenarioApi(path, options);
        try {
          await openNamedWorkspaceManager();
          await collectTranslatedHan('named-workspaces-open', true, document.getElementById('modal'));
          const rename = renameNamedWorkspace(910101);
          await new Promise(resolve => setTimeout(resolve, 0));
          await collectTranslatedHan('named-workspaces-rename', true, document.getElementById('modal'));
          document.querySelector('#modal .actions button:not(.primary):last-child')?.click();
          await rename;
        } finally {
          productivityState.workspaces = previousWorkspaces;
          api = scenarioApi;
          closeModal();
        }
      });
      await runI18nScenario('batch-template-editor', async () => {
        openCommandTemplateEditor({id:'language-template',name:'Language template',command:'uname -a',description:'Fixture'});
        const modal = document.getElementById('modal');
        collectVisibleHan('batch-template-editor-immediate', true, modal);
        if (modal?.querySelector('h2')?.textContent.trim() !== 'Edit command template') throw new Error('batch template editor was not generated in English');
        modal?.querySelector('[data-template-cancel]')?.click();
      });
      await runI18nScenario('command-snippet-manager', async () => {
        const previousSnippets = productivityState.snippets;
        const scenarioApi = api;
        const snippets = [{id:910150,name:'Inspect service',group_name:'Operations',command:'systemctl status example.service',description:'Service status',tags:'service',favorite:1,quick_visible:1,quick_action:'execute',quick_badge:'服',quick_color:'blue'}];
        productivityState.snippets = [{id:910150,name:'Inspect service',group_name:'Operations',command:'systemctl status example.service',description:'Service status',tags:'service',favorite:1,quick_visible:1,quick_action:'execute',quick_badge:'服',quick_color:'blue'}];
        api = async (path, options={}) => String(path) === '/api/command-snippets' && !options.method ? snippets : scenarioApi(path, options);
        try {
          await openCommandSnippetManager();
          const modal = document.getElementById('modal');
          collectVisibleHan('command-snippet-manager-immediate', true, modal);
          if (!modal?.innerText.includes('Command snippets') || !modal?.innerText.includes('Command bar')) throw new Error('command snippet manager was not generated in English');
          openCommandSnippetEditor(910150);
          collectVisibleHan('command-snippet-editor-immediate', true, modal);
          if (!modal?.innerText.includes('Edit command snippet') || !modal?.innerText.includes('Click action')) throw new Error('command snippet editor was not generated in English');
        } finally {
          productivityState.snippets = previousSnippets;
          api = scenarioApi;
          closeModal();
        }
      });
      await runI18nScenario('sftp-clipboard-actions', async () => {
        const previousClipboard = sftpClipboard;
        const previousState = {...sftpState};
        const tabKey = 'language-sftp-clipboard';
        const host = document.createElement('div');
        document.body.appendChild(host);
        try {
          sftpClipboard = {mode:'copy',connectionId:Number(languageRemoteConnection.id),connectionName:'Language SSH',paths:['/one.txt','/two.txt']};
          sftpState.connectionId = Number(languageRemoteConnection.id) + 1;
          host.innerHTML = renderSftpClipboardActions(tabKey);
          collectVisibleHan('sftp-copy-queue-immediate', true, host);
          if (!host.innerText.includes('Copy queue')) throw new Error('cross-host SFTP copy queue was not generated in English');
          sftpState.connectionId = Number(languageRemoteConnection.id);
          sftpClipboard = {...sftpClipboard,mode:'move'};
          host.innerHTML = renderSftpClipboardActions(tabKey);
          collectVisibleHan('sftp-move-queue-immediate', true, host);
          if (!host.innerText.includes('Move queue') || !host.innerText.includes('Paste')) throw new Error('SFTP move queue actions were not generated in English');
        } finally {
          sftpClipboard = previousClipboard;
          Object.assign(sftpState, previousState);
          host.remove();
        }
      });
      await runI18nScenario('remote-protocol-forms', async () => {
        for (const protocol of ['ftp','vnc','xdmcp','telnet','serial']) {
          renderRemoteProfileForm({protocol,name:'Language ' + protocol.toUpperCase(),group_name:'Default',options:{}});
          const view = document.getElementById('view-edit');
          collectVisibleHan(protocol + '-form-immediate', true, view);
          const formText = view?.innerText || '';
          if (protocol === 'ftp' && (!formText.includes('Transfer security') || !formText.includes('Explicit FTPS'))) throw new Error('FTP options were not generated in English');
          if (protocol === 'vnc' && (!formText.includes('Open with') || !formText.includes('Image quality'))) throw new Error('VNC options were not generated in English');
          if (protocol === 'xdmcp' && (!formText.includes('Connection mode') || !formText.includes('LAN broadcast'))) throw new Error('XDMCP options were not generated in English');
          if (protocol === 'telnet' && (!formText.includes('Terminal type') || !formText.includes('does not encrypt'))) throw new Error('Telnet options were not generated in English');
          if (protocol === 'serial' && (!formText.includes('Serial device') || !formText.includes('Baud rate'))) throw new Error('serial options were not generated in English');
        }
      });
      await runI18nScenario('ssh-extra-args-validation', async () => {
        const host = document.createElement('div');
        host.innerHTML = '<form id="languageConnectionForm"><textarea id="conn_extra"></textarea><div id="connExtraDiagnostics"></div><div id="connAdvancedStatus"></div></form>';
        document.body.appendChild(host);
        const form = host.querySelector('#languageConnectionForm');
        renderConnectionExtraArgsDiagnostics(form, [{severity:'warning',code:'SSH_EXTRA_ARGS_DUPLICATES_STRUCTURED_FIELD',line:2,start:8,end:27,option:'KeepAliveInterval',message:'与上方“KeepAliveInterval”设置重复（当前：60）',suggestion:'删除这一项并使用上方结构化设置，避免两处数值不一致。'}]);
        const diagnostics = document.getElementById('connExtraDiagnostics');
        collectVisibleHan('ssh-extra-args-validation-immediate', true, diagnostics);
        if (!diagnostics?.innerText.includes('current: 60') || !diagnostics?.innerText.includes('argument warning')) throw new Error('SSH additional-argument diagnostics were not generated in English');
        renderConnectionExtraArgsDiagnostics(form, []);
        host.remove();
      });
      await runI18nScenario('connection-terminal-startup-form', async () => {
        const host = document.createElement('div');
        host.innerHTML = '<form id="languageTerminalForm"><select id="conn_terminal_startup_mode"><option value="default">default</option><option value="program">program</option></select><input id="conn_terminal_profile_name"><input id="conn_terminal_profile_kind"><input id="conn_terminal_program_path"><input id="conn_terminal_program_args"><input id="conn_terminal_working_directory"><select id="conn_terminal_program_platform"><option value="auto">auto</option></select><select id="conn_terminal_profile_select"></select><div id="connTerminalProgramFields"></div><div id="connTerminalDetectionStatus"></div><div id="connTerminalCapabilities"></div></form>';
        document.body.appendChild(host);
        const form = host.querySelector('#languageTerminalForm');
        resetConnectionTerminalStartup(form);
        renderConnectionTerminalProfiles(form, {platform:'linux',platform_label:'Linux',default_shell:{name:'bash',label:'Bash',path:'/bin/bash'},profiles:[{name:'python',label:'Python',path:'/usr/bin/python3',kind:'repl'}],tools:[{label:'Git',version:'2.51'}],warnings:[]});
        const startupRoot = document.getElementById('connTerminalStartupFields') || form;
        collectVisibleHan('connection-terminal-startup-form-immediate', true, startupRoot);
        const text = startupRoot.innerText || '';
        const groupLabel = form.querySelector('#conn_terminal_profile_select optgroup')?.label || '';
        if (groupLabel !== 'Interactive languages' || !text.includes('Installed tools')) throw new Error('connection terminal startup form was not generated in English');
        host.remove();
      });
      await runI18nScenario('forward-empty', async () => {
        const previousForwards = languageRemoteConnection.forwards;
        languageRemoteConnection.forwards = [];
        try {
          openForwards(Number(languageRemoteConnection.id), false);
          const view = $('view-forwards') || document.getElementById('view-forwards');
          collectVisibleHan('forward-empty-immediate', true, view);
          const forwardEmptyText = view?.textContent || '';
          if (!forwardEmptyText.includes('No forwarding rules')) throw new Error('empty forwarding state was not generated in English');
        } finally {
          languageRemoteConnection.forwards = previousForwards;
        }
      });
      await runI18nScenario('forward-list', async () => {
        const previousForwards = languageRemoteConnection.forwards;
        languageRemoteConnection.forwards = [{id:910201,connection_id:Number(languageRemoteConnection.id),mode:'local',bind_host:'127.0.0.1',bind_port:3210,target_host:'127.0.0.1',target_port:8080,service_name:'Language service',service_type:'web',status:'running',started_at:Date.now()/1000-36,reconnect_count:2}];
        try {
          openForwards(Number(languageRemoteConnection.id), false);
          await new Promise(resolve => setTimeout(resolve, 0));
          const forwardView = $('view-forwards') || document.getElementById('view-forwards');
          applyTermaTranslations(forwardView);
          await collectTranslatedHan('forward-list-open', true, forwardView);
          await runI18nScenario('forward-runtime', async () => {
            await collectTranslatedHan('forward-runtime-open', true, forwardView);
            const runtime = forwardView?.querySelector('.forward-status .conn-meta')?.textContent || '';
            if (!runtime.includes('Running for') || !runtime.includes('Reconnected 2 times')) throw new Error('forward runtime was not localized');
          });
        } finally {
          languageRemoteConnection.forwards = previousForwards;
        }
      });
      await runI18nScenario('terminal-startup-dialog', async () => {
        const scenarioApi = api;
        const scenarioRequireUnlocked = requireConfigEncryptionUnlocked;
        requireConfigEncryptionUnlocked = () => true;
        api = async (path, options={}) => String(path).endsWith('/terminal-capabilities')
          ? {capabilities:{platform:'linux',platform_label:'Linux',default_shell:{name:'bash',label:'Bash'},profiles:[{name:'bash',label:'Bash',path:'/bin/bash',kind:'shell',is_default:true}],tools:[{name:'git',label:'Git',version:'2.51'}],warnings:[]}}
          : scenarioApi(path, options);
        try {
          showTerminalStartupSettings('language-terminal-startup', Number(languageRemoteConnection.id));
          await new Promise(resolve => setTimeout(resolve, 20));
          await collectTranslatedHan('terminal-startup-dialog-open', true, document.getElementById('modal'));
        } finally {
          closeTerminalStartupSettings('language-terminal-startup', false, true);
          api = scenarioApi;
          requireConfigEncryptionUnlocked = scenarioRequireUnlocked;
        }
      });
      await runI18nScenario('terminal-x11-menu', async () => {
        showActionMenu({preventDefault(){},stopPropagation(){},clientX:200,clientY:140}, x11LaunchActions(Number(languageRemoteConnection.id), ''));
        await collectTranslatedHan('terminal-x11-menu-open', true, document.getElementById('actionMenu'));
        hideActionMenu();
      });
      await runI18nScenario('terminal-context-menu', async () => {
        const key = 'language-terminal-context';
        terminalSessions.set(key, {
          id:Number(languageRemoteConnection.id),
          connected:true,
          connection:languageRemoteConnection,
          term:{
            clear(){}, focus(){}, scrollToBottom(){}, getSelection(){ return ''; }, hasSelection(){ return false; }
          }
        });
        try {
          showTerminalContextMenu({preventDefault(){},stopPropagation(){},clientX:200,clientY:140}, key, Number(languageRemoteConnection.id));
          const menu = document.getElementById('actionMenu');
          collectVisibleHan('terminal-context-menu-immediate', true, menu);
          const labels = [...menu.querySelectorAll('button span')].map(item => item.textContent.trim());
          if (!labels.includes('Copy selection') || !labels.includes('Open current directory in SFTP') || !labels.includes('Global terminal settings')) throw new Error('terminal context menu was not generated in English');
        } finally {
          hideActionMenu();
          terminalSessions.delete(key);
        }
      });
      await runI18nScenario('command-complete-notification', async () => {
        const key = 'language-command-complete';
        const tab = {key,title:'Language Terminal',kind:'terminal',id:Number(languageRemoteConnection.id),notificationsMuted:false,activityState:''};
        const originalNotify = notify;
        const originalDesktop = showDesktopNotification;
        const captured = [];
        tabs.push(tab);
        terminalSessions.set(key, {id:Number(languageRemoteConnection.id),smartCommandStartedAt:Date.now()-6200,smartHadOutput:true});
        notify = (message, type) => captured.push({kind:'toast',message,type});
        showDesktopNotification = event => captured.push({kind:'desktop',event});
        try {
          markTerminalCommandComplete(key, 'shell');
          const desktop = captured.find(item => item.kind === 'desktop')?.event;
          if (desktop?.title !== 'Command completed' || !/^Language Terminal · 6s$/.test(desktop?.message || '')) throw new Error('command completion notification was not generated in English');
        } finally {
          notify = originalNotify;
          showDesktopNotification = originalDesktop;
          terminalSessions.delete(key);
          const index = tabs.findIndex(item => item.key === key);
          if (index >= 0) tabs.splice(index, 1);
        }
      });
      await runI18nScenario('download-complete-notification', async () => {
        notify(tr('tasks:notifications.connection_download_item',{connection:'Game',name:'switchcodex.service'}) + '\\n' + tr('tasks:notifications.saved_to',{path:'D:/Downloads/switchcodex.service'}), 'success');
        const toast = document.querySelector('#toast .toast:last-child');
        collectVisibleHan('download-complete-notification-immediate', true, toast);
        const text = toast?.innerText || '';
        if (!text.includes('Game · Download switchcodex.service') || !text.includes('Saved to D:/Downloads/switchcodex.service')) throw new Error('download completion notification was not generated in English');
      });
      await runI18nScenario('progress-notification-controls', async () => {
        const controller = createProgressToast({title:'正在处理',detail:'准备中',onPauseChange(){},onCancel(){}});
        const toast = document.querySelector('#toast .toast-progress:last-child');
        if (!toast) throw new Error('progress toast was not created');
        collectVisibleHan('progress-notification-immediate', true, toast);
        const text = toast.innerText;
        if (!text.includes('Pause') || !text.includes('Stop')) throw new Error('progress notification controls were not generated in English');
        controller.dismiss();
      });
      await runI18nScenario('task-confirmations', async () => {
        const prompts = [
          [tr('tasks:dialogs.delete_message'),tr('tasks:dialogs.delete_title'),tr('common:actions.delete')],
          [tr('tasks:dialogs.clear_history_message'),tr('tasks:dialogs.clear_history_title'),tr('tasks:dialogs.clear_history_action')],
          [tr('tasks:dialogs.clear_failed_message',{count:3}),tr('tasks:dialogs.clear_failed_title'),tr('tasks:dialogs.clear_failed_action')]
        ];
        for (const [message,title,action] of prompts) {
          const decision = confirmModal(message,title,action,tr('common:actions.cancel'),true);
          await new Promise(resolve => setTimeout(resolve, 0));
          await collectTranslatedHan('task-confirmation-open', true, document.getElementById('modal'));
          document.querySelector('#modal .actions button:last-child')?.click();
          await decision;
        }
      });
      await runI18nScenario('batch-log-label', async () => {
        const host = document.createElement('div');
        host.innerHTML = renderLogButton({path:'batch/sample.log',label:'批量执行-8月14日 21:15:24'}, 'batch');
        document.body.appendChild(host);
        await collectTranslatedHan('batch-log-label-open', true, host);
        if (!host.innerText.includes('Batch execution - Aug 14 21:15:24')) throw new Error('batch log label was not localized');
        host.remove();
      });
      await runI18nScenario('quick-open-notice', async () => {
        const previousQuickOpen = remoteDesktopQuickOpen;
        remoteDesktopQuickOpen = false;
        try {
          toggleRemoteDesktopQuickOpen();
          await collectTranslatedHan('quick-open-notice-open', true, document.getElementById('toast'));
        } finally {
          remoteDesktopQuickOpen = previousQuickOpen;
          localStorage.setItem('remoteDesktopQuickOpen', previousQuickOpen ? '1' : '0');
          renderExplorerTools();
        }
      });
      await runI18nScenario('connection-controls', async () => {
        showPrimary('connections');
        connectionBulkMode = true;
        selectedConnectionIds.clear();
        renderConnections();
        await collectTranslatedHan('connection-bulk-open', true, document.getElementById('connectionGroups'));
        const menuEvent = {preventDefault(){},stopPropagation(){},clientX:120,clientY:120};
        showConnectionExplorerMenu(menuEvent);
        await collectTranslatedHan('connection-actions-open', true, document.getElementById('actionMenu'));
        hideActionMenu();
        showConnectionGroupMenu(menuEvent, languageRemoteConnection.group_name || 'UI Smoke');
        await collectTranslatedHan('connection-group-menu-open', true, document.getElementById('actionMenu'));
        hideActionMenu();
        openGroupModal(() => {});
        await collectTranslatedHan('connection-group-modal-open', true, document.getElementById('modal'));
        closeModal();
        connectionBulkMode = false;
        selectedConnectionIds.clear();
        renderConnections();
      });
      await runI18nScenario('connection-row-menu', async () => {
        const menuEvent = {preventDefault(){},stopPropagation(){},clientX:120,clientY:120};
        showConnectionMenu(menuEvent, Number(languageRemoteConnection.id));
        const menu = document.getElementById('actionMenu');
        collectVisibleHan('connection-row-menu-immediate', true, menu);
        const labels = [...menu.querySelectorAll('button span')].map(item => item.textContent.trim());
        if (!labels.includes('SFTP files') || !labels.includes('Server dashboard') || !labels.includes('Health check')) throw new Error('connection row menu was not generated in English');
        hideActionMenu();
      });
      await runI18nScenario('remote-profile-menu', async () => {
        const profile = {...languageVncProfile,name:'Language VNC Menu'};
        const existingIndex = remoteProfiles.findIndex(item => Number(item.id) === Number(profile.id));
        if (existingIndex >= 0) remoteProfiles.splice(existingIndex, 1);
        remoteProfiles.push(profile);
        const host = document.createElement('div');
        document.body.appendChild(host);
        try {
          host.innerHTML = renderRemoteProfileRow(profile);
          collectVisibleHan('remote-profile-row-immediate', true, host);
          showRemoteProfileMenu({preventDefault(){},stopPropagation(){},clientX:140,clientY:140}, profile.id);
          const menu = document.getElementById('actionMenu');
          collectVisibleHan('remote-profile-menu-immediate', true, menu);
          const labels = [...menu.querySelectorAll('button span')].map(item => item.textContent.trim());
          if (!labels.includes('Open Remote Desktop') || !labels.includes('Test connection') || !labels.includes('Edit connection')) throw new Error('remote profile menu was not generated in English');
        } finally {
          hideActionMenu();
          host.remove();
          const index = remoteProfiles.findIndex(item => Number(item.id) === Number(profile.id));
          if (index >= 0) remoteProfiles.splice(index, 1);
        }
      });
      await runI18nScenario('quick-connection', async () => {
        openQuickConnectionLauncher();
        await collectTranslatedHan('quick-connection-open', true, document.getElementById('modal'));
        closeQuickConnectionLauncher();
      });
      await runI18nScenario('linux-desktop-empty', async () => {
        const previousState = {...linuxDesktopManagerState};
        Object.assign(linuxDesktopManagerState, {connectionId:0,diagnostics:null,sshX11:null,error:null,loading:false,taskId:'',task:null,logs:[]});
        try {
          renderLinuxDesktopManager();
          await collectTranslatedHan('linux-desktop-empty-open', true, document.getElementById('view-linux-desktop'));
        } finally {
          Object.assign(linuxDesktopManagerState, previousState);
        }
      });
      await runI18nScenario('linux-desktop-error', async () => {
        const previousState = {...linuxDesktopManagerState};
        Object.assign(linuxDesktopManagerState, {connectionId:Number(languageRemoteConnection.id),diagnostics:null,sshX11:null,error:{message:'SSH 握手超时，请检查主机地址、端口和 SSH 服务',code:'SSH_HANDSHAKE_TIMEOUT'},loading:false,taskId:'',task:null,logs:[]});
        try {
          renderLinuxDesktopManager();
          await collectTranslatedHan('linux-desktop-error-open', true, document.getElementById('view-linux-desktop'));
          if (!(document.getElementById('view-linux-desktop')?.innerText || '').includes('SSH handshake timed out')) throw new Error('Linux desktop SSH error was not localized');
        } finally {
          Object.assign(linuxDesktopManagerState, previousState);
        }
      });
      await runI18nScenario('migration-snapshots', async () => {
        const scenarioApi = api;
        api = async (path, options={}) => {
          const value = String(path);
          if (value === '/api/legacy-brand-migration') return {available:true,completed:true,source_available:true,legacy_running:false,source:'C:\\LegacyData',last_migration:{migrated_at:'2026-08-07T10:39:27.000Z',backup:'C:\\TermaData\\migration-backup'}};
          if (value === '/api/config-snapshots') return [
            {id:'snapshot-1',reason:'调整 SSH 连接分组顺序前自动快照',created_at:'2026-08-06T07:50:12.000Z',counts:{connections:17,forwards:25,templates:6}},
            {id:'snapshot-2',reason:'手动快照',created_at:'2026-08-05T14:45:14.000Z',counts:{connections:14,forwards:24,templates:6}}
          ];
          return scenarioApi(path, options);
        };
        try {
          showImport(false);
          await Promise.all([renderLegacyBrandMigration(), renderConfigSnapshots()]);
          await collectTranslatedHan('legacy-migration-open', true, document.getElementById('legacyBrandMigration'));
          await collectTranslatedHan('config-snapshots-open', true, document.getElementById('configSnapshots'));
        } finally {
          api = scenarioApi;
        }
      });
      await runI18nScenario('storage-update-status', async () => {
        const previousDesktopSettings = desktopSettings;
        const previousUpdateSettings = updateSettings;
        desktopSettings = {
          ...desktopSettings,
          available:true,
          storage_management_available:true,
          xserver:{available:true,installed:true,display:'127.0.0.1:0.0'},
          paths:{dataDir:'C:\\TermaSmoke\\data',sshDir:'C:\\TermaSmoke\\.ssh'},
          settings:{...(desktopSettings?.settings || {}),dataMode:'user'}
        };
        updateSettings = {current_version:'1.4.6',latest_version:'1.4.6',checked_at:'2026-08-15T07:58:07.000Z',published_at:'2026-08-15T00:00:00.000Z',update_available:false,release_notes:[{version:'1.4.6',published_at:'2026-08-15T00:00:00.000Z',notes:'Release notes fixture'}]};
        try {
          renderSettings();
          showSettingsSection('settings-general', {moveToWorkspace:false});
          await collectTranslatedHan('storage-status-open', true, document.getElementById('settings-general'));
          showSettingsSection('settings-about', {moveToWorkspace:false});
          await collectTranslatedHan('update-status-open', true, document.getElementById('settings-about'));
        } finally {
          desktopSettings = previousDesktopSettings;
          updateSettings = previousUpdateSettings;
        }
      });
      await runI18nScenario('cache-clear-confirmation', async () => {
        const decision = clearProgramCache('', null);
        await new Promise(resolve => setTimeout(resolve, 0));
        const modal = document.getElementById('modal');
        collectVisibleHan('cache-clear-confirmation-immediate', true, modal);
        if (modal?.querySelector('h2')?.textContent.trim() !== 'Clear application cache') throw new Error('cache cleanup confirmation was not generated in English');
        modal?.querySelector('button[data-choice="1"]')?.click();
        await decision;
      });
      await runI18nScenario('sftp-single-download-task', async () => {
        const host = document.createElement('div');
        const job = {id:'language-download-task',status:'done',type:'download',label:'SFTP 下载到本机',phase:'delivering',current:'发送到桌面',connection_name:'Language SSH',size:1,transferred:1,progress_unit:'items',delivery_status:'done',delivery_path:'C:/Desktop/notes.txt'};
        host.innerHTML = renderSftpJob(job);
        document.body.appendChild(host);
        try {
          collectVisibleHan('sftp-single-download-task-immediate', true, host);
          const text = host.innerText || '';
          if (/\\b1 items\\b/.test(text) || !text.includes('1 item')) throw new Error('single-item SFTP task did not use the English singular');
        } finally {
          host.remove();
        }
      });
      await runI18nScenario('system-log-compatibility', async () => {
        const source = [
          '[08:00:00] Terma 正在关闭',
          '[08:00:01] Terma 已启动：http://127.0.0.1:18100',
          '[08:00:02] 终端已启动（内置 SSH PTY）：Game · 终端',
          '[08:00:03] 启动任务完成：自动转发成功0、失败0；恢复转发成功1、失败0',
          '[08:00:04] 已停止连接 Game 的全部转发',
          '[08:00:05] 通知：SFTP 下载到本机已完成：Game · 发送到桌面',
          '[08:00:06] 已保存到 C:/Desktop'
        ].join('\\n');
        const translated = localizedSystemLogText(source, {sourceTitle:'system-2026-08-15'});
        if (/[\u3400-\u9fff]/.test(translated)) throw new Error('known system log lines still contain Chinese: ' + translated);
        if (!translated.includes('Terma is shutting down') || !translated.includes('Saved to C:/Desktop')) throw new Error('known system log templates were not localized');
      });
      const terminalSystemSamples = [
        tr('terminal:system.connecting', {endpoint:'tester@127.0.0.1:22'}),
        tr('terminal:system.connected', {endpoint:'tester@127.0.0.1:22',pty:tr('terminal:system.pty_suffix'),startup:''}),
        tr('terminal:system.x11_connected', {display:'localhost:10.0'}),
        tr('terminal:system.closed_reconnect'),
        tr('terminal:system.reconnecting_preserved')
      ];
      for (const value of terminalSystemSamples) {
        if (/[\u3400-\u9fff]/.test(value)) visibleHan.push('terminal-system: ' + value);
      }
      sftpLatestJobs = languageTaskFixtures;
      updateSftpTaskCenter(languageTaskFixtures);
      const forbiddenMixedTranslations = [
        '根Directory',
        'SFTP Connection已断开',
        'Close仍在Connection的Tab',
        'SFTP 全局Settings',
        '管理命名Workspace',
        'Save当前Workspace为预设',
        'Automatic跟随窗口',
        '当前SystemNo 可用的 xclip Install方案'
      ];
      const renderedI18nText = document.body.innerText;
      const mixedTranslations = forbiddenMixedTranslations.filter(value => renderedI18nText.includes(value));
      const i18nUi = {
        language:document.documentElement.lang,
        settingsTitle:document.querySelector('#settings-general .settings-group-head h3')?.textContent.trim() || '',
        activityTitle:languageButton?.title || '',
        mobileTitle:document.querySelector('#mobileLanguageToggle')?.title || '',
        activityOrder:Boolean(languageRect && themeRect && languageRect.bottom <= themeRect.top + 0.5),
        persisted:languageRequests.length === 1 && JSON.stringify(languageRequests[0]) === JSON.stringify({language:'en-US'}),
        settingsSelectorRemoved:!document.querySelector('#interfaceLanguage'),
        resumeButton:englishTaskMarkup.includes('>Resume</button>'),
        pauseButton:englishTaskMarkup.includes('>Pause</button>'),
        visibleHan:[...new Set([
          ...visibleHan,
          ...i18nScenarioErrors.map(value => 'scenario-error: ' + value),
          ...mixedTranslations.map(value => 'mixed-translation: ' + value)
        ])].slice(0,300),
        scenarioErrors:i18nScenarioErrors,
        mixedTranslations,
        thirdPartyLiveSwitch,
        tasksPreserved:JSON.stringify(sftpLatestJobs.map(job=>job.id)) === JSON.stringify(languageTaskFixtures.map(job=>job.id)),
        tabsPreserved:JSON.stringify(tabs.map(tab=>tab.key)) === JSON.stringify(tabsBeforeLanguageSwitch)
      };
      if (i18nUi.visibleHan.length) console.log("[ui-smoke] visible Chinese in English mode: " + JSON.stringify(i18nUi.visibleHan));
      updateNoticeReadVersion = '';
      sessionStorage.removeItem(UPDATE_NOTICE_SESSION_KEY);
      syncUpdateNoticeDots();
      showPrimary('settings');
      activeSettingsSection = 'settings-general';
      showSettingsSection('settings-general', {moveToWorkspace:false});
      await setTermaLanguage('zh-CN');
      renderSettings();
      renderExplorerTools();
      showSettingsSection('settings-general', {moveToWorkspace:false});
      sftpLatestJobs = previousLatestJobs;
      updateSftpTaskCenter(previousLatestJobs);
      const storagePrimaryRow = document.querySelector('.storage-settings-primary-row');
      const storagePrimaryControl = storagePrimaryRow?.firstElementChild;
      const storageSaveButton = storagePrimaryRow?.querySelector('.storage-settings-save');
      const storageControlRect = storagePrimaryControl?.getBoundingClientRect();
      const storageSaveRect = storageSaveButton?.getBoundingClientRect();
      const storageAlignmentUi = {
        found:Boolean(storagePrimaryRow && storagePrimaryControl && storageSaveButton),
        topAligned:Boolean(storageControlRect && storageSaveRect && Math.abs(storageControlRect.top-storageSaveRect.top)<=0.5),
        bottomAligned:Boolean(storageControlRect && storageSaveRect && Math.abs(storageControlRect.bottom-storageSaveRect.bottom)<=0.5)
      };
      const storageMode = document.querySelector('#desktopDataMode');
      const storageCustomPath = document.querySelector('#desktopCustomDataDir');
      const originalStorageMode = storageMode?.value || '';
      const originalStorageCustomPath = storageCustomPath?.value || '';
      const originalStorageButtonHtml = storageSaveButton?.innerHTML || '';
      const originalChooseModal = chooseModal;
      const originalApi = api;
      let storageMigrationCalls = [];
      let storageMigrationActions = [];
      let storageCancelBlockedRequest = false;
      let storageMigrationPayload = null;
      try {
        if (storageMode && storageSaveButton) {
          const alternateMode = originalStorageMode === 'user'
            ? (storageMode.querySelector('option[value="project"]') ? 'project' : 'custom')
            : 'user';
          storageMode.value = alternateMode;
          if (alternateMode === 'custom' && storageCustomPath) storageCustomPath.value = 'C:\\TermaSmokeMigration';
          syncDesktopCustomDataMode();
          api = async (path, options) => {
            storageMigrationCalls.push({path, options});
            storageMigrationPayload = JSON.parse(options?.body || '{}');
            return {ok:true, restart_required:true, migration_requested:Boolean(storageMigrationPayload.migrateData)};
          };
          chooseModal = async (_title, _message, actions) => {
            storageMigrationActions = actions.map(item=>item.label);
            return 'cancel';
          };
          await saveDesktopSettings(storageSaveButton);
          storageCancelBlockedRequest = storageMigrationCalls.length === 0;
          chooseModal = async () => 'migrate';
          await saveDesktopSettings(storageSaveButton);
        }
      } finally {
        api = originalApi;
        chooseModal = originalChooseModal;
        if (storageMode) storageMode.value = originalStorageMode;
        if (storageCustomPath) storageCustomPath.value = originalStorageCustomPath;
        if (storageSaveButton) {
          storageSaveButton.disabled = false;
          storageSaveButton.removeAttribute('aria-busy');
          storageSaveButton.innerHTML = originalStorageButtonHtml;
        }
        syncDesktopCustomDataMode();
      }
      const storageMigrationUi = {
        controlsFound:Boolean(storageMode && storageSaveButton),
        threeChoices:JSON.stringify(storageMigrationActions) === JSON.stringify(['迁移并重启','仅切换并重启','取消']),
        cancelBlockedRequest:storageCancelBlockedRequest,
        oneMigrationRequest:storageMigrationCalls.length === 1,
        migrationRequested:storageMigrationPayload?.migrateData === true
      };
      const tools = document.querySelector('#explorerTools');
      const settingsButtons = [...tools.querySelectorAll(':scope > button[data-explorer-section]')];
      const settingsLabels = settingsButtons.map(button => button.querySelector('span')?.textContent.trim() || '');
      const settingsExpected = ['通用设置','安全','通知设置','启动与运行','缓存管理','关于'];
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
      const cacheButton = tools.querySelector('[data-explorer-section="settings-cache"]');
      cacheButton?.click();
      await Promise.resolve();
      const cacheUi = {
        selected:Boolean(cacheButton?.classList.contains('active') && !document.querySelector('#settings-cache')?.hidden),
        panel:Boolean(document.querySelector('#settings-cache #cacheManagementPanel')),
        categories:document.querySelectorAll('#settings-cache .cache-category-row').length,
        beforeAbout:settingsButtons.indexOf(cacheButton) === settingsButtons.findIndex(item => item.dataset.explorerSection === 'settings-about') - 1,
        absentFromGeneral:!document.querySelector('#settings-general #cacheManagementPanel')
      };
      const themeButton = tools.querySelector('[data-explorer-section="settings-theme"]');
      localStorage.setItem(TERMA_APPEARANCE_STORAGE_KEY, JSON.stringify({preset:'luminous',frosted_strength:53,liquid_strength:39}));
      termaAppearanceSettings = readTermaAppearanceSettings();
      applyTermaAppearanceSettings();
      syncTermaLiquidNavigation();
      const themeUi = {
        entryHidden:!themeButton && !document.querySelector('#settings-theme'),
        controlsHidden:!document.querySelector('#themeAppearancePanel, #themeFrostedStrength, #themeLiquidStrength'),
        oldConfigIgnored:localStorage.getItem(TERMA_APPEARANCE_STORAGE_KEY) === null,
        clearPreset:document.documentElement.dataset.appearancePreset === 'clear' && termaAppearanceSettings.preset === 'clear',
        noEffects:!document.documentElement.classList.contains('terma-liquid-enabled')
          && document.querySelectorAll('.terma-liquid-lens, .terma-liquid-track').length === 0,
        zeroBlur:getComputedStyle(document.documentElement).getPropertyValue('--terma-frosted-backdrop-blur').trim() === '0px'
      };
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
      updateSettings = {...updateSettings, latest_version:'1.0.9', update_available:false, republished_available:true, release_revision:2, update_ignored:false};
      updateNoticeReadVersion = '';
      sessionStorage.removeItem(UPDATE_NOTICE_SESSION_KEY);
      syncUpdateNoticeDots();
      const republishedShowsNotice = shouldShowUpdateNotice() && updateDotIds.every(id => document.getElementById(id)?.hidden === false);
      tools.querySelector('[data-explorer-section="settings-about"]')?.click();
      await Promise.resolve();
      const republishedStoredReadVersion = sessionStorage.getItem(UPDATE_NOTICE_SESSION_KEY);
      const republishedReadMarksNotice = republishedStoredReadVersion === '1.0.9:r2' && !shouldShowUpdateNotice();
      tools.querySelector('[data-explorer-section="settings-basic"]')?.click();
      await Promise.resolve();
      const sessionUi = {
        ttl:document.querySelector('#securitySessionTtlMinutes')?.value,
        max:document.querySelector('#securitySessionMaxSessions')?.value,
        cleanup:document.querySelector('#securitySessionCleanupMinutes')?.value,
        active:document.querySelector('#settings-basic')?.textContent.includes('当前活动会话'),
        save:Boolean([...document.querySelectorAll('#settings-basic button')].find(button=>button.textContent.includes('保存会话设置')))
      };
      const authPolicyUi = {
        redundantCheckboxRemoved:!document.querySelector('#securityLanAuth'),
        localOnlyLabel:[...document.querySelectorAll('#securityAuthMode option')].some(option=>option.value==='lan'&&option.textContent.includes('仅非本机访问')),
        alwaysLabel:[...document.querySelectorAll('#securityAuthMode option')].some(option=>option.value==='always'&&option.textContent.includes('所有浏览器访问')),
        directDefinition:document.querySelector('#settings-basic')?.textContent.includes('来源和 Host 都是回环或当前机器地址')
      };
      const localDirectControl = document.querySelector('#securityLocalDirectDesktopIntegration');
      const localDirectState = document.querySelector('#securityLocalDirectDesktopIntegrationState');
      const localDirectDefaultOff = Boolean(localDirectControl && !localDirectControl.checked && localDirectState?.textContent.includes('默认关闭'));
      const localDirectPolicyCopy = Boolean(localDirectState?.textContent.includes('已通过当前 Web 访问策略') && !localDirectState?.textContent.includes('且已登录时'));
      if (localDirectControl) {
        localDirectControl.checked = true;
        localDirectControl.dispatchEvent(new Event('change',{bubbles:true}));
      }
      const localDirectEnabled = Boolean(localDirectState?.classList.contains('success') && localDirectState.textContent.includes('当前已生效'));
      const trustedProxyControl = document.querySelector('#securityTrustedProxyEnabled');
      if (trustedProxyControl) {
        trustedProxyControl.checked = true;
        trustedProxyControl.dispatchEvent(new Event('change',{bubbles:true}));
      }
      const localDirectProxyBlocked = Boolean(localDirectState?.classList.contains('warning')
        && localDirectState.textContent.includes('已启用可信反向代理')
        && localDirectState.textContent.includes('桌面集成继续使用临时授权'));
      const localDirectUi = {control:Boolean(localDirectControl), defaultOff:localDirectDefaultOff, policyCopy:localDirectPolicyCopy, enabled:localDirectEnabled, proxyBlocked:localDirectProxyBlocked};
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
      const importExpected = ['SSH config 导入导出','数据库导入导出','配置版本快照'];
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
        cacheUi,
        themeUi,
        storageAlignmentUi,
        storageMigrationUi,
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
        republishedShowsNotice,
        republishedReadMarksNotice,
        newerVersionShowsAgain,
        sessionUi,
        authPolicyUi,
        localDirectUi,
        runtimeUi,
        i18nUi,
        importLabels,
        importOwnSections:JSON.stringify(importLabels) === JSON.stringify(importExpected),
        importSectionMode:tools.classList.contains('section-mode'),
        importVertical,
        importResultsMerged,
        importChecks,
        treeHidden:Boolean(document.querySelector('#connectionGroups')?.hidden)
      };
    } finally {
      try { if (thirdPartyLiveZmodemSession) terminalZmodemRender(thirdPartyLiveZmodemSession, {hidden:true}); } catch {}
      try { thirdPartyLiveEditor?.destroy(); } catch {}
      thirdPartyLiveFixture?.remove();
      updateSettings = previousUpdate;
      runtimeSettings = previousRuntimeSettings;
      runtimeSettingsMessage = previousRuntimeMessage;
      runtimeSettingsCheck = previousRuntimeCheck;
      securitySettings = previousSecurity;
      desktopSettings = previousDesktopSettings;
      sftpLatestJobs = previousLatestJobs;
      updateSftpTaskCenter(previousLatestJobs);
      await setTermaLanguage(previousLanguage);
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
      const section = [...document.querySelectorAll('#settings-about')].find(item=>!item.hidden&&item.getClientRects().length)
        || document.querySelector('#settings-about');
      const visibleGroups = [...document.querySelectorAll('#view-settings .settings-group')].filter(group => !group.hidden).map(group => group.id);
      const sourceLink = section?.querySelector('.about-actions a');
      const trigger = [...document.querySelectorAll('#openLicenseBtn')].find(item=>item.getClientRects().length)
        || document.querySelector('#openLicenseBtn');
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
      const originalTriggerFocus = trigger.focus.bind(trigger);
      let triggerFocusCalls = 0;
      trigger.focus = (...args) => {
        triggerFocusCalls += 1;
        return originalTriggerFocus(...args);
      };
      modal.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));
      await new Promise(resolve => setTimeout(resolve, 0));
      result.backdropIgnored = Boolean(!modal.hidden && modal.querySelector('.license-modal') && modal.querySelector('#licenseText')?.textContent === aboutSettings?.license_text);
      document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
      await new Promise(resolve => setTimeout(resolve, 25));
      result.closedByEscape = Boolean(modal?.hidden && !modal.querySelector('.license-modal'));
      result.focusReturned = triggerFocusCalls > 0 || document.activeElement === trigger || document.activeElement?.id === 'openLicenseBtn';
      trigger.focus = originalTriggerFocus;
      const followup = chooseModal('后续确认框', '验证共享弹窗状态已经清理。', [{label:'确定', value:'ok'}]);
      result.followupBackdropClean = modal.onclick === null;
      modal.querySelector('button[data-choice]')?.click();
      result.followupResolved = await followup === 'ok';
      const previousUpdate = updateSettings;
      updateSettings = {
        current_version:'1.0.8',
        latest_version:'1.0.9',
        update_available:true,
        release_url:'https://github.com/zmide/Terma/releases/tag/v1.0.9',
        published_at:'2026-07-20T00:00:00Z',
        checked_at:'2026-07-20T00:01:00Z',
        notes:'更新检查测试',
        update_ignored:false,
        release_notes:Array.from({length:10}, (_, index) => ({
          version:'1.0.'+(9-index),
          published_at:'2026-07-'+String(20-index).padStart(2, '0')+'T00:00:00Z',
          notes:index===0?'更新检查测试：新版本更新内容':index===1?'上一版本更新内容':'历史版本 '+(9-index)+' 更新内容'
        })),
        download_status:{
          state:'idle',
          selected_asset_name:'Terma-1.0.9-windows-x64-portable.exe',
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
      const updateCardReady = updateArea?.textContent.includes(tr('settings:auto.github_release_updates'))
        && updateArea.textContent.includes('Terma-1.0.9-windows-x64-portable.exe')
        && updateArea.textContent.includes('Windows · x64 · '+tr('settings:auto.update_portable'))
        && updateArea.textContent.includes(tr('settings:auto.update_security_hint'))
        && updateArea.textContent.includes('更新检查测试')
        && releaseEntries.length === 10
        && releaseEntries[0].textContent.includes('v1.0.9')
        && releaseEntries[0].textContent.includes('新版本更新内容')
        && releaseEntries[1].textContent.includes('v1.0.8')
        && releaseEntries[1].textContent.includes('上一版本更新内容')
        && Boolean(updateArea.querySelector('#updateIgnoreCurrentVersion'))
        && updateArea.textContent.includes(tr('settings:auto.ignore_version_hint'))
        && updateArea.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') === '0'
        && Boolean([...updateArea.querySelectorAll('button')].find(button=>button.textContent.includes('下载并校验')))
        && updateLink?.textContent.includes(tr('settings:updates.view_release'))
        && updateLink?.href === 'https://github.com/zmide/Terma/releases/tag/v1.0.9';
      updateSettings.download_status = {
        ...updateSettings.download_status,
        state:'downloading',
        phase:'probing',
        bytes_downloaded:0,
        progress_percent:0
      };
      const notesBeforeRefresh = updateArea.querySelector('.update-notes');
      const requestedNotesScroll = Math.min(120, Math.max(0, notesBeforeRefresh.scrollHeight - notesBeforeRefresh.clientHeight));
      notesBeforeRefresh.scrollTop = requestedNotesScroll;
      renderUpdateStatus();
      const preservedNotesScroll = updateArea.querySelector('.update-notes')?.scrollTop || 0;
      const probingStateReady = updateArea.textContent.includes(tr('settings:auto.update_speed_test'))
        && updateArea.textContent.includes(tr('settings:updates.testing_routes'))
        && updateArea.textContent.includes(tr('settings:auto.update_parallel_speed'))
        && Boolean([...updateArea.querySelectorAll('button')].find(button=>button.textContent.includes(tr('settings:auto.update_speed_test')) && button.disabled))
        && requestedNotesScroll > 0
        && Math.abs(preservedNotesScroll - requestedNotesScroll) <= 1;
      updateSettings.download_status = {
        ...updateSettings.download_status,
        phase:'downloading',
        source_label:'ghfast.top',
        source_speed_bytes_per_second:2097152,
        bytes_downloaded:5242880,
        progress_percent:50
      };
      updateArea.innerHTML = updateStatusHtml();
      const selectedRouteReady = updateArea.textContent.includes('ghfast.top'+tr('settings:updates.speed_suffix',{speed:'2.0 MB/s'}))
        && updateArea.textContent.includes(tr('settings:auto.route_fallback'))
        && updateArea.textContent.includes('50% · 5.0 MB / 10.0 MB');
      updateSettings.download_status = {
        ...updateSettings.download_status,
        phase:'verifying',
        bytes_downloaded:10485760,
        progress_percent:99
      };
      updateArea.innerHTML = updateStatusHtml();
      const verifyingStateReady = updateArea.textContent.includes('正在校验')
        && updateArea.textContent.includes(tr('settings:updates.verifying_sha', {progress:100}));
      updateSettings = {
        ...updateSettings,
        current_version:'1.0.9',
        update_available:false,
        download_status:{state:'failed', error:'fetch failed', progress_percent:18}
      };
      updateArea.innerHTML = updateStatusHtml();
      const staleFailureCleared = updateArea.textContent.includes(tr('settings:auto.update_latest'))
        && updateArea.textContent.includes(tr('settings:auto.update_no_download'))
        && !updateArea.textContent.includes(tr('settings:auto.update_failed'))
        && !updateArea.textContent.includes('fetch failed')
        && !document.querySelector('#downloadUpdateBtn');
      updateSettings = {
        ...updateSettings,
        current_version:'1.0.8',
        update_available:true,
        download_status:{
          state:'idle',
          selected_asset_name:'Terma-1.0.9-windows-x64-portable.exe',
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
        asset_name:'Terma-1.0.9-windows-x64-portable.exe',
        progress_percent:100,
        can_open:true,
        can_open_directory:true
      };
      updateArea.innerHTML = updateStatusHtml();
      const portableButtons = [...updateArea.querySelectorAll('button')].map(button=>button.textContent.trim());
      const portableActionsReady = portableButtons.includes(tr('settings:updates.open_download_directory'))
        && portableButtons.includes(tr('settings:auto.update_redownload'))
        && !portableButtons.includes(tr('settings:updates.open_verified_package'));
      updateSettings.download_status = {
        ...updateSettings.download_status,
        selected_asset_name:'Terma-1.0.9-windows-x64-installer.exe',
        asset_name:'Terma-1.0.9-windows-x64-installer.exe',
        package_type:'installer'
      };
      updateArea.innerHTML = updateStatusHtml();
      const installerButtons = [...updateArea.querySelectorAll('button')].map(button=>button.textContent.trim());
      const installerActionsReady = installerButtons.includes(tr('settings:updates.open_verified_package'))
        && installerButtons.includes(tr('settings:updates.open_download_directory'))
        && installerButtons.includes(tr('settings:auto.update_redownload'));
      result.updateUiParts = {updateCardReady,probingStateReady,selectedRouteReady,verifyingStateReady,staleFailureCleared,portableActionsReady,installerActionsReady,portableButtons,installerButtons,text:updateArea.textContent.replace(/\s+/g,' ').trim()};
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
  console.log("[ui-smoke] ssh host trust");
  const hostTrustUi = await window.webContents.executeJavaScript(`(async () => {
    const modal=document.querySelector('#modal');
    const unknownPromise=sshHostTrustModal({
      token:'unknown-token',state:'unknown',host_label:'server.example:22',key_type:'ssh-ed25519',
      fingerprint:'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    });
    await Promise.resolve();
    const unknownCard=modal.querySelector('.ssh-host-trust-modal.unknown');
    const unknown={
      open:Boolean(unknownCard&&!modal.hidden),
      fingerprint:unknownCard?.textContent.includes('SHA256:AAAA'),
      actions:[...unknownCard?.querySelectorAll('button')||[]].map(button=>button.textContent.trim()),
      cancelFocused:document.activeElement?.id==='sshHostTrustCancel'
    };
    modal.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    unknown.backdropIgnored=!modal.hidden;
    modal.querySelector('#sshHostTrustOnce')?.click();
    unknown.result=await unknownPromise;

    const changedPromise=sshHostTrustModal({
      token:'changed-token',state:'changed',host_label:'server.example:22',key_type:'ssh-ed25519',
      previous_fingerprint:'SHA256:OLD',fingerprint:'SHA256:NEW'
    });
    await Promise.resolve();
    const changedCard=modal.querySelector('.ssh-host-trust-modal.changed');
    const changed={
      open:Boolean(changedCard&&!modal.hidden),
      warning:changedCard?.textContent.includes('主机密钥发生变化'),
      oldAndNew:changedCard?.textContent.includes('SHA256:OLD')&&changedCard?.textContent.includes('SHA256:NEW'),
      updateDanger:changedCard?.querySelector('#sshHostTrustPersist')?.classList.contains('danger'),
      updateLabel:changedCard?.querySelector('#sshHostTrustPersist')?.textContent.trim()==='更新并永久信任'
    };
    changedCard?.querySelector('#sshHostTrustPersist')?.click();
    changed.result=await changedPromise;

    const cancelPromise=sshHostTrustModal({state:'unknown',host_label:'cancel.example:22',key_type:'ssh-rsa',fingerprint:'SHA256:CANCEL'});
    await Promise.resolve();
    modal.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    const escapeCancelled=await cancelPromise===null&&modal.hidden;

    const previousHosts=sshTrustedHosts;
    sshTrustedHosts=[{id:'host-record',host:'server.example',port:22,host_label:'server.example:22',key_type:'ssh-ed25519',fingerprint:'SHA256:TRUSTED',updated_at:Date.now()}];
    const fixture=document.createElement('div');
    fixture.innerHTML=sshHostTrustPanelHtml();
    document.body.appendChild(fixture);
    const trustPanel=fixture.querySelector('#sshHostTrustPanel');
    const settings={
      visible:Boolean(trustPanel&&getComputedStyle(trustPanel).display!=='none'),
      record:trustPanel?.textContent.includes('server.example:22')&&trustPanel?.textContent.includes('SHA256:TRUSTED'),
      removeButton:Boolean(trustPanel?.querySelector('button[aria-label="删除信任记录"]'))
    };
    fixture.remove();
    sshTrustedHosts=previousHosts;
    return {unknown,changed,escapeCancelled,settings};
  })()`);
  console.log("[ui-smoke] menus and actions");
  const desktopMenu = await window.webContents.executeJavaScript(`(() => {
    showPrimary('connections');
    if (!document.querySelector('.conn-row')) document.querySelector('.group-head')?.click();
    document.querySelector('.conn-actions .icon-button[title="更多操作"]')?.click();
    const opened = Boolean(document.querySelector('#actionMenu'));
    const labels = [...document.querySelectorAll('#actionMenu button')].map(button => button.textContent.trim());
    const duplicateConnection = labels.includes('复制');
    const simplifiedMenu=['复制 SSH 命令','复制 SFTP 命令','用 VS Code Remote SSH 打开'].every(label=>!labels.includes(label))&&labels.includes('生成其他连接…');
    const menuContentIsPhysicallyLeftAligned = selector => {
      const menu=document.querySelector(selector);
      if (!menu) return false;
      const menuLeft=menu.getBoundingClientRect().left;
      return [...menu.querySelectorAll(':scope > button')].every(button => {
        const firstContent=button.querySelector('svg, span');
        return getComputedStyle(button).textAlign==='left'
          && getComputedStyle(button).justifyContent==='flex-start'
          && firstContent
          && firstContent.getBoundingClientRect().left-menuLeft<=18;
      });
    };
    const leftAligned=menuContentIsPhysicallyLeftAligned('#actionMenu');
    const generatedMenuButton=[...document.querySelectorAll('#actionMenu button')].find(button=>button.textContent.includes('生成其他连接'));
    generatedMenuButton?.click();
    const parentStaysOpen=Boolean(document.querySelector('#actionMenu'));
    const submenu=Boolean(document.querySelector('#actionSubMenu'));
    const submenuLeftAligned=menuContentIsPhysicallyLeftAligned('#actionSubMenu');
    const submenuLabels=[...document.querySelectorAll('#actionSubMenu button span')].map(node=>node.textContent.trim());
    const generateAll=submenuLabels.includes('生成全部连接');
    document.dispatchEvent(new Event('scroll', {bubbles:true}));
    return {opened, duplicateConnection, simplifiedMenu, leftAligned, submenuLeftAligned, parentStaysOpen, submenu, generateAll, labels, submenuLabels, closedOnScroll:!document.querySelector('#actionMenu')&&!document.querySelector('#actionSubMenu')};
  })()`);
  console.log("[ui-smoke] running actions");
  const runningActions = await window.webContents.executeJavaScript(`(() => {
    const connection = connections[0];
    const previousForwards = connection?.forwards;
    const previousRunningFilter = runningFilter;
    const fixture = {
      id:990001,
      connection_id:Number(connection?.id || 0),
      mode:'local',
      service_name:'Running actions fixture',
      service_type:'web',
      url_scheme:'http',
      bind_host:'127.0.0.1',
      bind_port:18099,
      target_host:'127.0.0.1',
      target_port:80,
      status:'running',
      reconnect_count:0
    };
    try {
      if (!connection) return {found:false,reason:'connection fixture missing'};
      connection.forwards = [fixture];
      runningFilter = '';
      runningOpen.add(connection.name);
      showPrimary('running');
      renderRunningForwards();
      const actions = document.querySelector('.running-actions');
      const open = actions?.querySelector('.open-forward-link');
      const buttons = [...(actions?.querySelectorAll('button') || [])];
      const retry = buttons.find(button => button.getAttribute('onclick')?.includes('retryForwardFromRunning'));
      const stop = buttons.find(button => button.getAttribute('onclick')?.includes('stopForwardFromRunning'));
      const copy = buttons.find(button => button.getAttribute('onclick')?.includes('copyText'));
      const overviewCards = [...document.querySelectorAll('.running-overview > span')];
      const overviewLabelsBelowNumbers = overviewCards.length === 3 && overviewCards.every(card => {
        const countRect = card.querySelector('strong')?.getBoundingClientRect();
        const labelRect = card.querySelector('.running-overview-label')?.getBoundingClientRect();
        return Boolean(countRect && labelRect && labelRect.top >= countRect.bottom - 0.5);
      });
      if (!actions || !open || !retry || !stop || !copy) return {
        found:false,
        actionCount:document.querySelectorAll('.running-actions').length,
        text:document.querySelector('#connectionGroups')?.textContent || ''
      };
      const actionsRect = actions.getBoundingClientRect();
      const openRect = open.getBoundingClientRect();
      const retryRect = retry.getBoundingClientRect();
      const buttonRects = [retry,stop,copy].map(button=>button.getBoundingClientRect());
      return {
        found:true,
        fits:openRect.left>=actionsRect.left-0.5&&openRect.right<=actionsRect.right+0.5&&buttonRects.every(rect=>rect.left>=actionsRect.left-0.5&&rect.right<=actionsRect.right+0.5),
        compact:buttonRects.every(rect=>rect.width<=31&&rect.height<=31)&&openRect.height<=31,
        iconOnly:[retry,stop,copy].every(button=>!button.textContent.trim()),
        overviewLabelsBelowNumbers,
        open:{width:openRect.width,height:openRect.height},
        retry:{width:retryRect.width,height:retryRect.height}
      };
    } finally {
      if (connection) connection.forwards = previousForwards;
      runningFilter = previousRunningFilter;
    }
  })()`);
  console.log("[ui-smoke] auth fields");
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
    const passwordInputs=[...document.querySelectorAll('#connectionForm input[data-password-visibility-input]')];
    const passwordToggleCount=passwordInputs.length===2&&passwordInputs.every(input=>input.closest('.password-input-control')?.querySelectorAll('.password-visibility-toggle').length===1);
    const passwordInput=document.querySelector('#conn_password');
    const passwordToggle=passwordInput?.closest('.password-input-control')?.querySelector('.password-visibility-toggle');
    passwordInput.value='connection-visibility-secret';
    passwordToggle?.click();
    const passwordShown=passwordInput.type==='text'&&passwordInput.value==='connection-visibility-secret'&&passwordToggle?.getAttribute('aria-pressed')==='true';
    passwordToggle?.click();
    const passwordHidden=passwordInput.type==='password'&&passwordInput.value==='connection-visibility-secret'&&passwordToggle?.getAttribute('aria-pressed')==='false';
    const passwordEyeToggle=Boolean(passwordToggleCount&&passwordShown&&passwordHidden);
    auth.value = 'key';
    toggleAuthFields();
    const keyMode = {
      keyVisible:!keyBox.hidden && getComputedStyle(keyBox).display !== 'none',
      keyEnabled:Array.from(keyBox.querySelectorAll('input,select,button')).every(control=>!control.disabled),
      passwordHidden:passwordBox.hidden && getComputedStyle(passwordBox).display === 'none',
      passwordDisabled:Array.from(passwordBox.querySelectorAll('input,select,button')).every(control=>control.disabled)
    };
    return {found:true,passwordMode,keyMode,passwordEyeToggle};
  })()`);
  console.log("[ui-smoke] connection startup form");
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
              {id:'tmux',kind:'session',label:'tmux',path:'/usr/bin/tmux',args:'new-session -A -s terma',platform:'posix',is_default:false}
            ],
            tools:[{id:'git',label:'Git',path:'/usr/bin/git'}],
            warnings:[]
          }
        };
      }
      return {};
    };
    notify=(...args)=>notices.push(args);
    showPrimary('connections');
    newConnection();
    const form=$("connectionForm");
    const field=id=>form?.querySelector('#'+id);
    if(!form || !field('conn_host')) {
      api=originalApi;
      notify=originalNotify;
      return {found:false,missingConnectionForm:true};
    }
    field('conn_name').value='startup-smoke';
    field('conn_user').value='root';
    field('conn_host').value='example.test';
    const advanced=field('connAdvancedOptions');
    const defaultAdvancedCollapsed=advanced?.open===false;
    field('conn_terminal_startup_mode').value='program';
    field('conn_terminal_profile_name').value='My shell';
    field('conn_terminal_profile_kind').value='custom';
    field('conn_terminal_program_path').value='/custom/my-shell';
    field('conn_terminal_program_args').value='--interactive';
    toggleConnectionTerminalStartup(form);
    await testConnectionForm(field('connTestBtn'));
    const select=field('conn_terminal_profile_select');
    const customPreserved=field('conn_terminal_program_path').value==='/custom/my-shell'
      && select.value==='__current__';
    const pythonOption=[...select.options].find(option=>option.textContent.includes('Python 3'));
    if(pythonOption) applyConnectionTerminalProfile(pythonOption.value,select);
    const detectedApplied=field('conn_terminal_program_path').value==='/usr/bin/python3'
      && field('conn_terminal_program_args').value==='-i'
      && field('conn_terminal_profile_kind').value==='repl'
      && field('conn_terminal_program_platform').value==='posix';
    field('conn_host').value='changed.example';
    field('conn_host').dispatchEvent(new Event('input',{bubbles:true}));
    const stale=form._terminalProbeStale===true
      && field('connTerminalDetectionStatus')?.textContent.includes('已变化');
    renderConnectionExtraArgsDiagnostics(form,[{
      severity:'error',
      line:1,
      start:0,
      end:18,
      option:'StrictHostKeyChecking',
      message:'SSH 主机信任由 Terma 统一管理。',
      suggestion:'请删除该参数。'
    }]);
    const parameterIssueExpanded=advanced?.open===true
      && field('connAdvancedStatus')?.textContent.includes('参数错误')
      && field('connExtraDiagnostics')?.hidden===false;
    advanced.open=false;
    field('connTerminalDetectionStatus').className='terminal-startup-detection error';
    field('connTerminalDetectionStatus').textContent='无法检测远端启动环境。';
    updateConnectionAdvancedStatus(form);
    const terminalIssueExpanded=advanced?.open===true
      && field('connAdvancedStatus')?.textContent.includes('终端检测失败');
    const card=form.querySelector('.terminal-startup-card');
    const formRect=form.getBoundingClientRect();
    const cardRect=card?.getBoundingClientRect();
    const result={
      found:Boolean(form&&card&&select),
      defaultMode:testedPayload?.terminal_startup_mode==='program',
      requestedDiscovery:testedPayload?.discover_terminal===true,
      customPreserved,
      categories:[...select.querySelectorAll('optgroup')].map(group=>group.label),
      toolShown:field('connTerminalCapabilities')?.textContent.includes('Git'),
      detectedApplied,
      stale,
      defaultAdvancedCollapsed,
      parameterIssueExpanded,
      terminalIssueExpanded,
      noOverflow:Boolean(cardRect&&cardRect.left>=formRect.left-0.5&&cardRect.right<=formRect.right+0.5),
      pathRequired:field('conn_terminal_program_path').required===true,
      batchHealthIdentifiesServers:(()=>{
        const text=formatAllHealthMessage([
          {id:901,name:'生产机 A',ssh_user:'root',ssh_host:'prod-a.test',ssh_port:22,ok:false,status:'异常',ssh:{ok:false,output:'参数错误 A'},forwards:[]},
          {id:902,name:'生产机 B',ssh_user:'deploy',ssh_host:'prod-b.test',ssh_port:2202,ok:false,status:'异常',ssh:{ok:false,output:'参数错误 B'},forwards:[]}
        ]);
        return text.includes('生产机 A · root@prod-a.test:22')
          && text.includes('参数错误 A')
          && text.includes('生产机 B · deploy@prod-b.test:2202')
          && text.includes('参数错误 B');
      })()
    };
    api=originalApi;
    notify=originalNotify;
    return result;
  })()`);
  console.log("[ui-smoke] save and clear form");
  const saveAndClearUi = await window.webContents.executeJavaScript(`(async () => {
    const originalApi = api;
    const originalLoadAll = loadAll;
    const originalLoadKeys = loadKeys;
    const originalNotify = notify;
    const originalOpenTerminal = openTerminal;
    const originalCloseTabsByKey = closeTabsByKey;
    const saved = [];
    const notices = [];
    let openedConnectionId = 0;
    let closedSourceTab = false;
    api = async (url, options={}) => {
      if(url==='/api/connections'&&options.method==='POST') {
        saved.push(JSON.parse(options.body));
        return {id:9902};
      }
      return {};
    };
    loadAll = async () => {};
    loadKeys = async () => {};
    notify = (...args) => notices.push(args);
    openTerminal = id => { openedConnectionId=Number(id); return 'terminal-'+id; };
    closeTabsByKey = keys => { closedSourceTab=Array.isArray(keys)&&keys.includes(activeTabKey); };
    newConnection();
    document.querySelector('#conn_name').value='save-clear-test';
    document.querySelector('#conn_user').value='root';
    document.querySelector('#conn_host').value='example.test';
    const button=document.querySelector('#connSaveAndClear');
    const visible=Boolean(button&&!button.hidden&&getComputedStyle(button).display!=='none');
    button?.click();
    await new Promise(resolve=>setTimeout(resolve,25));
    const clearResult={
      visible,
      saved:saved.length===1&&saved[0].name==='save-clear-test'&&saved[0].ssh_host==='example.test'&&saved[0].sort_order===1,
      cleared:document.querySelector('#conn_name')?.value===''&&document.querySelector('#conn_user')?.value===''&&document.querySelector('#conn_host')?.value===''&&document.querySelector('#conn_port')?.value==='22',
      defaultsRestored:document.querySelector('#conn_auth_type')?.value==='key'
        && document.querySelector('#conn_sort_order')?.value==='1'
        && document.querySelector('#conn_extra')?.value===''
        && document.querySelector('#conn_remote_generation')?.value===''
        && document.querySelector('#conn_connect_timeout')?.value==='10'
        && document.querySelector('#conn_keepalive_interval')?.value==='60'
        && document.querySelector('#conn_keepalive_count')?.value==='3'
        && document.querySelector('#conn_tcp_keepalive')?.value==='1',
      focused:document.activeElement===document.querySelector('#conn_name'),
      notice:notices.some(args=>String(args[0]).includes('表单已清空')),
      readyAgain:button?.disabled===false&&button?.textContent.trim()==='保存并清空'
    };
    newConnection();
    document.querySelector('#conn_name').value='save-connect-test';
    document.querySelector('#conn_user').value='root';
    document.querySelector('#conn_host').value='connect.example.test';
    const connectButton=document.querySelector('#connSaveAndConnect');
    const connectVisible=Boolean(connectButton&&!connectButton.hidden&&getComputedStyle(connectButton).display!=='none');
    connectButton?.click();
    await new Promise(resolve=>setTimeout(resolve,25));
    const editFixture={id:9903,name:'edit-save-actions',group_name:TERMA_DEFAULT_CONNECTION_GROUP,ssh_user:'root',ssh_host:'edit.example.test',ssh_port:22,sort_order:1,auth_type:'key',identity_file:'',ssh_agent_mode:'auto',jump_connection_id:null,connect_timeout_seconds:10,keepalive_interval_seconds:60,keepalive_count_max:3,tcp_keepalive:1,x11_mode:'off',tags:'',autostart_forwards:0,extra_args:'',forwards:[]};
    connections.push(editFixture);
    editConnection(editFixture.id);
    const sshEditActions=[...document.querySelectorAll('#connectionForm .actions button')].filter(item=>!item.hidden).map(item=>item.textContent.trim());
    const sshEditSaveActions=['仅保存','保存并关闭','保存并打开'].every(label=>sshEditActions.includes(label))&&document.querySelector('#connSaveAndClear')?.hidden===true;
    connections.splice(connections.indexOf(editFixture),1);
    renderRemoteProfileForm({id:9904,protocol:'rdp',name:'remote-edit-save-actions',group_name:TERMA_DEFAULT_CONNECTION_GROUP,host:'rdp.example.test',port:3389,username:'',options:{display_mode:'dynamic'}});
    const remoteEditActions=[...document.querySelectorAll('#remoteProfileForm button[type="submit"]')].map(item=>item.textContent.trim());
    const remoteEditSaveActions=['仅保存','保存并关闭','保存并打开'].every(label=>remoteEditActions.includes(label));
    const result={
      ...clearResult,
      saveConnectVisible:connectVisible,
      saveConnectOpens:openedConnectionId===9902,
      saveConnectClosesSource:closedSourceTab,
      saveConnectReadyAgain:connectButton?.disabled===false&&connectButton?.textContent.trim()==='保存并连接',
      sshEditSaveActions,
      remoteEditSaveActions
    };
    api=originalApi;
    loadAll=originalLoadAll;
    loadKeys=originalLoadKeys;
    notify=originalNotify;
    openTerminal=originalOpenTerminal;
    closeTabsByKey=originalCloseTabsByKey;
    return result;
  })()`);
  console.log("[ui-smoke] notification cursor");
  const notificationUi = await window.webContents.executeJavaScript(`(async () => {
    const originalNotify = notify;
    const originalDesktop = showDesktopNotification;
    const originalRuntimeSettings = runtimeSettings;
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
    runtimeSettings = normalizeRuntimeSettingsResponse({
      ...runtimeSettings,
      saved:{
        ...runtimeSettings?.saved,
        notification_display:{
          info:{enabled:true,duration_ms:60000},
          success:{enabled:false,duration_ms:3500},
          error:{enabled:true,duration_ms:8000},
          progress:{enabled:false,success_duration_ms:null,error_duration_ms:8000}
        }
      }
    });
    dismissToast();
    await new Promise(resolve=>setTimeout(resolve,260));
    const before = document.querySelectorAll('#toast .toast').length;
    notify('disabled success category','success');
    const successSuppressed = document.querySelectorAll('#toast .toast').length === before;
    notify('enabled info category','info');
    const infoVisible = document.querySelectorAll('#toast .toast').length === before + 1;
    const progressBefore = document.querySelectorAll('#toast .toast-progress').length;
    createProgressToast({title:'disabled progress category'});
    const progressSuppressed = document.querySelectorAll('#toast .toast-progress').length === progressBefore;
    renderSettings();
    result.categoryControls = ['notificationInfoEnabled','notificationInfoDuration','notificationSuccessEnabled','notificationSuccessDuration','notificationErrorEnabled','notificationErrorDuration','notificationProgressEnabled','notificationProgressSuccessDuration','notificationProgressErrorDuration','taskCenterFloatingProgressEnabled'].every(id=>document.getElementById(id));
    result.floatingUnderNotifications = Boolean(document.querySelector('#taskCenterFloatingProgressEnabled')?.closest('#settings-notifications'));
    result.successSuppressed = successSuppressed;
    result.infoVisible = infoVisible;
    result.progressSuppressed = progressSuppressed;
    dismissToast();
    runtimeSettings = originalRuntimeSettings;
    return result;
  })()`);
  console.log("[ui-smoke] restore key modal");
  const restoreKeyUi = await window.webContents.executeJavaScript(`(async () => {
    const originalLoadIdentityBindingOptions = loadIdentityBindingOptions;
    const windowsIdentityPath = ['C:','Temp','TermaFixture','.ssh','id_ed25519_demo'].join('\\\\');
    loadIdentityBindingOptions = async () => ({
      items:[
        {name:'id_ed25519_demo',path:windowsIdentityPath,source_label:'用户 ~/.ssh'},
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
    const stagesWindowsPath = modal.querySelector('[data-binding-result="0"]')?.textContent.includes('已暂存：id_ed25519_demo');
    modal.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    const backdropIgnored = Boolean(!modal.hidden && modal.querySelector('.restore-key-modal') && modal.querySelector('[data-binding-result="0"]')?.textContent.includes('已暂存：id_ed25519_demo'));
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
  console.log("[ui-smoke] restore credential modal");
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
  console.log("[ui-smoke] terminal interactions");
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
    const numberingConnectionId = Number(first.id) + 900000;
    const tabsBeforeNumberingCheck = tabs;
    tabs = [{key:'terminal-'+numberingConnectionId+'-2',kind:'terminal',id:numberingConnectionId}];
    terminalCounts.set(numberingConnectionId,5);
    const numberingContinuesWithOpenTabs=nextTerminalTabIndex(numberingConnectionId)===6;
    tabs = [];
    terminalCounts.set(numberingConnectionId,5);
    const numberingRestartsAfterAllClosed=nextTerminalTabIndex(numberingConnectionId)===1;
    terminalCounts.delete(numberingConnectionId);
    tabs = tabsBeforeNumberingCheck;
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
    let fakeInputHandler = null;
    let terminalFocusCalls = 0;
    let fakeSocketUrl = '';
    let fakeLinkProvider = null;
    let fakeSelectionHandler = null;
    let terminalResetCalls = 0;
    const terminalWrites = [];
    const fakeTerm = {
      hasSelection:()=>true,
      getSelection:()=> 'selected text',
      select:()=>{}, selectAll:()=>{}, clearSelection:()=>{}, clear:()=>{}, reset:()=>{ terminalResetCalls += 1; }, focus:()=>{ terminalFocusCalls += 1; }, scrollToBottom:()=>{}, writeln:value=>terminalWrites.push(String(value||'')), refresh:()=>{},
      write:data=>{ binaryWrite = data instanceof Uint8Array && data[0]===0xff && data[1]===0xfe; },
      onData:handler=>{ fakeInputHandler=handler; return {dispose:()=>{}}; }, onResize:()=>({dispose:()=>{}}),
      onSelectionChange:handler=>{ fakeSelectionHandler=handler; return {dispose:()=>{}}; },
      registerLinkProvider:provider=>{ fakeLinkProvider=provider; return {dispose:()=>{}}; },
      cols:80, rows:24, options:{fontSize:13}, buffer:{active:{length:0,cursorX:0,cursorY:0}}
    };
    terminalSessions.set(key,{term:fakeTerm,fit:{fit:()=>{}},id:first.id,logId:'1700000000000-terminaluismoke'});
    const inactiveOutputKey = 'terminal-ui-smoke-inactive-output';
    const inactiveOutputWrites = [];
    let inactiveOutputRefreshes = 0;
    const inactiveOutputSession = {
      id:first.id,
      term:{
        write(data, callback){ inactiveOutputWrites.push(String(data || '')); callback?.(); },
        refresh(){ inactiveOutputRefreshes += 1; },
        rows:24,
        buffer:{active:{length:0,cursorX:0,cursorY:0}}
      }
    };
    terminalSessions.set(inactiveOutputKey, inactiveOutputSession);
    queueTerminalOutput(inactiveOutputSession, 'inactive-tab-output');
    await new Promise(resolve=>setTimeout(resolve,25));
    refreshTerminalSessionsAfterWindowResume();
    const inactiveTerminalOutputContinues = activeTabKey !== inactiveOutputKey
      && inactiveOutputWrites.join('').includes('inactive-tab-output')
      && !inactiveOutputSession.pendingTerminalOutput?.length
      && !inactiveOutputSession.terminalOutputWriting
      && inactiveOutputRefreshes > 0;
    terminalSessions.delete(inactiveOutputKey);
    const OriginalWebSocket = window.WebSocket;
    class FakeWebSocket extends EventTarget {
      static OPEN = 1;
      constructor(url){ super(); fakeSocketUrl=String(url||''); this.readyState=1; this.binaryType='blob'; this.sent=[]; }
      send(data){ this.sent.push(data); }
      close(){}
    }
    window.WebSocket = FakeWebSocket;
    const originalTerminalApi = api;
    const fallbackKey = 'terminal-x11-fallback-smoke';
    const fallbackMessages = [];
    const fallbackTicketBodies = [];
    tabs.push({key:fallbackKey,title:'X11 fallback',subtitle:'',viewName:'terminal',closable:true,kind:'terminal',id:first.id});
    if (fixturePane) fixturePane.tabs.push(fallbackKey);
    terminalSessions.set(fallbackKey,{
      term:{cols:80,rows:24,writeln:value=>fallbackMessages.push(String(value||'')),onData:()=>({dispose(){}}),onResize:()=>({dispose(){}})},
      id:first.id,
      connectionAttempt:0
    });
    api = async (path, options={}) => {
      if(path==='/api/ssh/preflight') return {ok:true};
      if(path==='/api/terminal/startup-tickets') {
        const body=JSON.parse(options.body||'{}');
        fallbackTicketBodies.push(body.startup||{});
        if(body.startup?.x11_mode!=='off') {
          const error=new Error('当前浏览器没有 X11 桌面集成授权');
          error.code='DESKTOP_INTEGRATION_AUTH_REQUIRED';
          throw error;
        }
        return {token:'x11-fallback-ticket'};
      }
      return originalTerminalApi(path, options);
    };
    await connectTerminal({...first,x11_mode:'trusted'},fallbackKey);
    const fallbackSocketUrl=fakeSocketUrl;
    const x11DefaultFallsBack=fallbackTicketBodies.length===2
      && !fallbackTicketBodies[0].x11_mode
      && fallbackTicketBodies[1].x11_mode==='off'
      && fallbackSocketUrl.includes('startup_token=x11-fallback-ticket')
      && fallbackMessages.some(line=>line.includes('已自动降级为普通 SSH 终端'));
    showX11LaunchMenu(new MouseEvent('click',{bubbles:true,clientX:120,clientY:80}),first.id,key);
    const x11ModeButton=[...document.querySelectorAll('#actionMenu button')]
      .find(button=>button.textContent.includes('默认使用受限 X11'));
    x11ModeButton?.click();
    const x11ScopeLabels=[...document.querySelectorAll('#actionSubMenu button span')]
      .map(node=>node.textContent.trim());
    const x11ScopeMenu=Boolean(x11ModeButton
      && document.querySelector('#actionMenu')
      && document.querySelector('#actionSubMenu')
      && JSON.stringify(x11ScopeLabels)===JSON.stringify(['当前终端生效','新建终端','下次生效']));
    hideActionMenu();
    terminalSessions.get(fallbackKey)?.socket?.close?.();
    terminalSessions.delete(fallbackKey);
    tabs=tabs.filter(tab=>tab.key!==fallbackKey);
    if(fixturePane) fixturePane.tabs=fixturePane.tabs.filter(tabKey=>tabKey!==fallbackKey);
    fakeSocketUrl='';
    api = async (path, options={}) => path==='/api/ssh/preflight' ? {ok:true} : originalTerminalApi(path, options);
    await connectTerminal(first,key);
    const fakeSocket = terminalSessions.get(key).socket;
    const ctrlVSession = terminalSessions.get(key);
    ctrlVSession.connected = true;
    ctrlVSession.connection = {...first, x11_mode:'trusted'};
    ctrlVSession.effectiveX11Mode = 'trusted';
    ctrlVSession.currentDirectoryKnown = true;
    ctrlVSession.currentDirectory = '/home/terma-smoke';
    const originalClipboardReader = readTerminalClipboardImage;
    const originalClipboardApi = api;
    const originalClipboardUpload = uploadSftpFilesToDirectory;
    const originalTermaDesktop = window.termaDesktop;
    if (!window.termaDesktop) window.termaDesktop = {readClipboardImage:async () => ({ok:false,reason:'empty'})};
    const ctrlVUploads = [];
    const ctrlVSentBefore = fakeSocket.sent.length;
    const ctrlVImage = new File([Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3,4])], 'ctrl-v.png', {type:'image/png'});
    readTerminalClipboardImage = async () => ctrlVImage;
    api = async (path, options={}) => String(path).includes('/terminal-clipboard/image')
      ? {ready:false, available:false, reason:'xclip'}
      : originalClipboardApi(path, options);
    uploadSftpFilesToDirectory = async (files, connectionId, directory, options) => {
      ctrlVUploads.push({files,connectionId,directory,options});
      return {ok:true};
    };
    fakeInputHandler?.(String.fromCharCode(22));
    await new Promise(resolve => setTimeout(resolve, 20));
    const ctrlVImageSent = fakeSocket.sent.slice(ctrlVSentBefore);
    const ctrlVImageIntercepted = ctrlVUploads.length === 1
      && ctrlVUploads[0].directory === '/tmp'
      && ctrlVUploads[0].options?.private === true
      && ctrlVImageSent.some(value => String(value).includes('/tmp/ctrl-v.png'))
      && !ctrlVImageSent.includes(String.fromCharCode(22));
    const ctrlVDiagnostics = {
      uploads:ctrlVUploads.map(item=>({connectionId:item.connectionId,directory:item.directory,options:item.options,fileCount:item.files.length})),
      sent:ctrlVImageSent.map(value=>typeof value === 'string' ? value : Object.prototype.toString.call(value))
    };
    readTerminalClipboardImage = async () => null;
    const ctrlVEmptyBefore = fakeSocket.sent.length;
    fakeInputHandler?.(String.fromCharCode(22));
    await new Promise(resolve => setTimeout(resolve, 20));
    const ctrlVEmptyFallsThrough = fakeSocket.sent.slice(ctrlVEmptyBefore).includes(String.fromCharCode(22));
    readTerminalClipboardImage = originalClipboardReader;
    api = originalClipboardApi;
    uploadSftpFilesToDirectory = originalClipboardUpload;
    if (originalTermaDesktop) window.termaDesktop = originalTermaDesktop;
    else delete window.termaDesktop;
    ctrlVSession.connection = first;
    ctrlVSession.effectiveX11Mode = 'off';
    fakeSocket.dispatchEvent(new MessageEvent('message',{data:new Uint8Array([0xff,0xfe]).buffer}));
    const binaryType = fakeSocket.binaryType;
    const stableLogId = fakeSocketUrl.includes('log_id=1700000000000-terminaluismoke');
    fakeSocket.readyState = 3;
    reconnectTerminal(first.id,key);
    await new Promise(resolve=>setTimeout(resolve,10));
    const reconnectedFakeSocket = terminalSessions.get(key).socket;
    const reconnectPreservesOutput = terminalResetCalls===0
      && terminalWrites.some(line=>line.includes('以上终端内容已保留'))
      && reconnectedFakeSocket!==fakeSocket;
    api = originalTerminalApi;
    const originalReconnectForEnter = reconnectTerminal;
    const enterReconnects = [];
    reconnectTerminal = (id, tabKey) => enterReconnects.push({id,tabKey});
    reconnectedFakeSocket.readyState = 3;
    fakeInputHandler?.(String.fromCharCode(13));
    const enterReconnect = enterReconnects.length===1&&enterReconnects[0].id===first.id&&enterReconnects[0].tabKey===key;
    reconnectTerminal = originalReconnectForEnter;
    reconnectedFakeSocket.readyState = 1;
    window.WebSocket = OriginalWebSocket;
    const fontSizeField = terminalFontSizeField();
    const previousFontSize = first[fontSizeField];
    const focusBeforeFont = terminalFocusCalls;
    changeTerminalFont(key,1);
    await new Promise(resolve=>setTimeout(resolve,5));
    const fontActionRestoresFocus = terminalFocusCalls>focusBeforeFont;
    clearTimeout(terminalPreferencesSaveTimers.get(first.id));
    terminalPreferencesSaveTimers.delete(first.id);
    first[fontSizeField] = previousFontSize;
    const previousRecentTerminalCommands = [...recentTerminalCommands];
    recentTerminalCommands = ['echo terminal focus smoke'];
    const focusBeforeRecent = terminalFocusCalls;
    showRecentTerminalCommands(key);
    const recentCommandSequenceVisible = document.querySelector('.recent-command-index')?.textContent.trim() === '1'
      && document.querySelector('.recent-command-list button code')?.textContent === 'echo terminal focus smoke';
    document.querySelector('#recentCommandClose')?.click();
    await new Promise(resolve=>setTimeout(resolve,5));
    const recentCommandsRestoreFocus = terminalFocusCalls>focusBeforeRecent;
    recentTerminalCommands = previousRecentTerminalCommands;
    const connectionAddress=first.ssh_user+'@'+first.ssh_host+':'+first.ssh_port;
    document.querySelector('#view-terminal').innerHTML='<div id="terminalToolbarMount"><div class="terminal-toolbar"><div class="terminal-title-row"><span class="terminal-connection-dot"></span><span id="terminalStatus" class="terminal-status" data-connection-address="'+connectionAddress+'" data-connection-state="连接中"></span><span id="terminalLatency" class="terminal-latency pending"></span></div><div class="actions terminal-actions"><button class="terminal-action-reconnect"></button></div></div></div><div id="terminalMount" class="terminal-box"></div>';
    setWorkspace('终端测试',connectionAddress,'terminal',key,false,true,{kind:'terminal',id:first.id});
    const resourceWindowTitle = document.title === 'Terma · '+first.ssh_host+':'+first.ssh_port+' · 终端';
    activeTabKey = key;
    updateTerminalConnectionStatus(first, key, 'connected');
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
    latencySession.term.element=mount;
    startTerminalCursorCopy(key);
    const cursorCopyHint=mount.querySelector('.terminal-cursor-copy-hint');
    const cursorCopyHintRect=cursorCopyHint?.getBoundingClientRect();
    const cursorCopyMountRect=mount.getBoundingClientRect();
    const desktopCursorCopyHintVisible=Boolean(
      cursorCopyHint
      && cursorCopyHint.textContent.includes('光标复制：拖到复制起点后松手')
      && cursorCopyHint.querySelector('.terminal-cursor-copy-cancel')
      && cursorCopyHintRect?.width>160
      && cursorCopyHintRect.left>=cursorCopyMountRect.left-0.5
      && cursorCopyHintRect.right<=cursorCopyMountRect.right+0.5
      && cursorCopyHintRect.top>=cursorCopyMountRect.top-0.5
      && cursorCopyHintRect.bottom<=cursorCopyMountRect.bottom+0.5
    );
    cancelTerminalCursorCopy(latencySession,key);
    const desktopCursorCopyHintCleansUp=!mount.querySelector('.terminal-cursor-copy-hint,.terminal-cursor-copy-cancel')&&!latencySession.cursorCopyState;
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
      globalScope:Boolean(terminalSettingsCard?.textContent.includes('应用到继承默认值的连接；连接独立设置优先')),
      controls:['terminalSettingFontFamily','terminalSettingFontSize','terminalSettingBackgroundColor','terminalSettingMiddleMouse','terminalSettingRightMouse','terminalSettingCtrlClick','terminalSettingUrlLinks','terminalSettingWordSeparators','terminalSettingAutoCopy','terminalSettingMultilinePaste'].every(id=>Boolean(document.querySelector('#'+id))),
      withinViewport:Boolean(terminalSettingsRect&&terminalSettingsRect.left>=-0.5&&terminalSettingsRect.right<=innerWidth+0.5&&terminalSettingsRect.top>=-0.5&&terminalSettingsRect.bottom<=innerHeight+0.5),
      compact:Boolean(terminalSettingsRect&&terminalSettingsRect.height<600),
      readableWidth:Boolean(terminalSettingsRect&&terminalSettingsRect.width>=Math.min(800,innerWidth-28)-1),
      noHorizontalOverflow:terminalSettingsNoHorizontalOverflow,
      tabs:[...document.querySelectorAll('.terminal-settings-tabs [role="tab"]')].map(tab=>tab.textContent.trim()),
      backgroundModes:[...document.querySelectorAll('input[name="terminalSettingBackgroundMode"]')].map(input=>input.value),
      requestedDefaults:defaultTerminalGlobalSettings.font_size===13&&defaultTerminalGlobalSettings.font_family.includes('monospace')&&defaultTerminalGlobalSettings.background_mode==='theme'&&defaultTerminalGlobalSettings.url_links_enabled===true&&defaultTerminalGlobalSettings.auto_copy_selection===false&&defaultTerminalGlobalSettings.copy_include_trailing_newline===false,
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
    const firstSession=terminalSessions.get(key);
    firstSession.connection={...firstSession.connection,terminal_font_family_inherit:1,terminal_font_size_inherit:1,terminal_mobile_font_size_inherit:1};
    secondTerm.options.fontFamily='Connection Font';
    secondTerm.options.fontSize=19;
    terminalSessions.set(secondKey,{term:secondTerm,id:first.id,mount:secondMount,connection:{...first,terminal_font_family:'Connection Font',terminal_font_family_inherit:0,terminal_font_size:19,terminal_font_size_inherit:0,terminal_mobile_font_size:19,terminal_mobile_font_size_inherit:0}});
    terminalGlobalSettings=normalizeTerminalGlobalSettings({...defaultTerminalGlobalSettings,font_family:'Global Font',font_size:15,background_mode:'custom',background_color:'#808080',word_separators:'-_'});
    applyTerminalGlobalSettingsToSessions();
    const readablePaletteKeys=['black','red','green','yellow','blue','magenta','cyan','white','brightBlack','brightRed','brightGreen','brightYellow','brightBlue','brightMagenta','brightCyan','brightWhite'];
    terminalSettingsUi.appliesToAllOpenSessions=fakeTerm.options.wordSeparator==='-_'&&secondTerm.options.wordSeparator==='-_'
      &&fakeTerm.options.theme?.background==='#808080'&&secondTerm.options.theme?.background==='#808080'
      &&fakeTerm.options.theme?.foreground==='#000000'&&secondTerm.options.theme?.foreground==='#000000'
      &&fakeTerm.options.minimumContrastRatio===4.5&&secondTerm.options.minimumContrastRatio===4.5
      &&mount.style.getPropertyValue('--terminal-background')==='#808080'
      &&secondMount.style.getPropertyValue('--terminal-background')==='#808080';
    terminalSettingsUi.fontInheritance=fakeTerm.options.fontFamily==='Global Font'&&fakeTerm.options.fontSize===15
      &&secondTerm.options.fontFamily==='Connection Font'&&secondTerm.options.fontSize===19;
    terminalSettingsUi.readableCustomPalette=readablePaletteKeys.every(name=>terminalContrastRatio(fakeTerm.options.theme[name],fakeTerm.options.theme.background)>=4.5);
    terminalGlobalSettings=normalizeTerminalGlobalSettings({...defaultTerminalGlobalSettings,background_mode:'theme'});
    applyTheme('dark');
    const followsDark=fakeTerm.options.theme?.background==='#000000'&&fakeTerm.options.theme?.foreground==='#ffffff';
    applyTheme('light');
    terminalSettingsUi.followsTheme=followsDark&&fakeTerm.options.theme?.background==='#ffffff'&&fakeTerm.options.theme?.foreground==='#000000';
    terminalSettingsUi.copyFormatting=formatTerminalCopiedText('one\\t  \\r\\ntwo  ',{...defaultTerminalGlobalSettings,copy_tabs_to_spaces:true,copy_trim_trailing_spaces:true,copy_include_trailing_newline:false})==='one\\ntwo';
    terminalSettingsUi.singleLinePaste=terminalSingleLinePaste('one\\r\\n two \\n\\nthree')==='one two three';
    const previousRecentCommandStorage=localStorage.getItem('recentTerminalCommands');
    const previousRecentCommandsForPaste=[...recentTerminalCommands];
    recentTerminalCommands=[];
    localStorage.removeItem('recentTerminalCommands');
    terminalGlobalSettings=normalizeTerminalGlobalSettings({...defaultTerminalGlobalSettings,multiline_paste_mode:'paste'});
    const pasteSession=terminalSessions.get(key);
    await sendTerminalPasteText(key,'echo pasted-one\\r\\n');
    const completedPasteRecorded=recentTerminalCommands[0]==='echo pasted-one'&&pasteSession.commandBuffer==='';
    await sendTerminalPasteText(key,'echo pasted-two');
    const incompletePasteBuffered=!recentTerminalCommands.includes('echo pasted-two')&&pasteSession.commandBuffer==='echo pasted-two';
    fakeInputHandler?.('\\r');
    const bufferedPasteRecordedOnEnter=recentTerminalCommands[0]==='echo pasted-two'&&pasteSession.commandBuffer==='';
    await sendTerminalPasteText(key,'printf first\\nprintf second\\npartial third');
    const multilinePasteRecorded=recentTerminalCommands.includes('printf first')&&recentTerminalCommands.includes('printf second')&&!recentTerminalCommands.includes('partial third')&&pasteSession.commandBuffer==='partial third';
    fakeInputHandler?.('\\r');
    const trailingPasteRecordedOnEnter=recentTerminalCommands[0]==='partial third';
    pasteSession.sensitiveInput=true;
    await sendTerminalPasteText(key,'very-secret-command\\r');
    pasteSession.sensitiveInput=false;
    terminalSettingsUi.pasteCommandHistory=Boolean(completedPasteRecorded&&incompletePasteBuffered&&bufferedPasteRecordedOnEnter&&multilinePasteRecorded&&trailingPasteRecordedOnEnter&&!recentTerminalCommands.includes('very-secret-command')&&pasteSession.commandBuffer==='');
    recentTerminalCommands=previousRecentCommandsForPaste;
    if(previousRecentCommandStorage===null)localStorage.removeItem('recentTerminalCommands');else localStorage.setItem('recentTerminalCommands',previousRecentCommandStorage);
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
    terminalSettingsUi.editablePaste=Boolean(pasteBackdropIgnored&&pasteEditable&&pasteSummaryUpdated&&pasteModalRect&&pasteModalRect.left>=-0.5&&pasteModalRect.right<=innerWidth+0.5&&pasteModalRect.top>=-0.5&&pasteModalRect.bottom<=innerHeight+0.5&&pasteSent&&reconnectedFakeSocket.sent.at(-1)==='edited command\\nsecond command');
    const toolbarFixture=document.createElement('div');
    toolbarFixture.className='terminal-toolbar';
    toolbarFixture.style.width='100%';
    toolbarFixture.innerHTML='<div class="terminal-title-row"><span class="terminal-connection-dot"></span><span class="terminal-status">tester@example.invalid:22 · 已连接</span><span class="terminal-latency good">延迟 5 ms</span></div><div class="actions terminal-actions"><button class="icon-button">'+icon('folder-open')+'<span>SFTP</span></button><button class="icon-button">'+icon('minus')+'</button><button class="icon-button">'+icon('plus')+'</button><button class="terminal-dropdown-button terminal-action-encoding">'+icon('earth')+'<span>UTF-8</span>'+icon('chevron-down')+'</button><button class="terminal-dropdown-button">'+icon('type')+'<span>字体</span>'+icon('chevron-down')+'</button><button class="icon-button terminal-startup-button">'+icon('command')+'<span>配置</span></button><button class="icon-button terminal-x11-button">'+icon('x11')+'</button><button class="icon-button terminal-global-settings-button">'+icon('settings')+'</button><button class="terminal-action-keys">'+icon('keyboard')+'<span>快捷键</span></button><button>'+icon('history')+'<span>最近命令</span></button><button>'+icon('link-2')+'<span>重连</span></button><button class="terminal-action-forward-list">'+icon('route')+'<span>转发列表</span></button><button>'+icon('play')+'<span>启用转发</span></button></div>';
    const toolbarViewFixture=document.createElement('div');
    toolbarViewFixture.style.width='540px';
    toolbarViewFixture.style.containerType='inline-size';
    toolbarViewFixture.style.containerName='terminal-view';
    toolbarViewFixture.appendChild(toolbarFixture);
    document.body.appendChild(toolbarViewFixture);
    const toolbar=toolbarFixture.querySelector('.terminal-actions');
    const toolbarRect=toolbar.getBoundingClientRect();
    const toolbarButtons=[...toolbar.querySelectorAll('button')];
    const terminalToolbarIconSet=Boolean(
      toolbar.querySelector('.terminal-action-encoding .lucide-earth')
      && toolbar.querySelector('.terminal-x11-button .x11-icon b')?.textContent==='X11'
      && toolbar.querySelector('.terminal-action-forward-list .lucide-route')
    );
    const desktopKeysHidden=getComputedStyle(toolbarFixture.querySelector('.terminal-action-keys')).display==='none';
    const visibleToolbarButtons=toolbarButtons.filter(button=>getComputedStyle(button).display!=='none');
    const encodingButton=toolbarFixture.querySelector('.terminal-action-encoding');
    const encodingLabelVisible=Boolean(
      encodingButton
      && encodingButton.querySelector('span')?.textContent==='UTF-8'
      && getComputedStyle(encodingButton.querySelector('span')).display!=='none'
      && encodingButton.getBoundingClientRect().width>=92
    );
    const compactLabelsHidden=toolbarButtons.filter(button=>button!==encodingButton)
      .flatMap(button=>[...button.querySelectorAll(':scope > span:not(.composite-icon)')])
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
    const widerVisibleButtons=[...widerToolbar.querySelectorAll('button')].filter(button=>getComputedStyle(button).display!=='none');
    const widerIconButtons=widerVisibleButtons.filter(button=>!button.classList.contains('terminal-action-encoding'));
    const widerActionsIconOnly=widerIconButtons.every(button=>Math.abs(button.getBoundingClientRect().width-30)<=0.5)
      && widerIconButtons.flatMap(button=>[...button.querySelectorAll(':scope > span:not(.composite-icon)')]).every(span=>getComputedStyle(span).display==='none')
      && widerIconButtons.filter(button=>button.classList.contains('terminal-dropdown-button')).every(button=>getComputedStyle(button.querySelector(':scope > svg:last-child')).display==='none');
    const headerStartupFixture=document.createElement('div');
    headerStartupFixture.className='topbar';
    headerStartupFixture.style.cssText='position:fixed;left:-10000px;top:0;width:760px;';
    headerStartupFixture.innerHTML='<div class="workspace-header-tools workspace-global-header-tools"><div class="terminal-toolbar terminal-toolbar-header"><div class="actions terminal-actions"><button class="icon-button terminal-startup-button">'+icon('command')+'<span>配置</span></button></div></div></div>';
    document.body.appendChild(headerStartupFixture);
    const headerStartupButton=headerStartupFixture.querySelector('.terminal-startup-button');
    const headerStartupLabel=headerStartupButton.querySelector('span');
    const headerHeightBefore=workspaceHeaderHeight;
    const headerStartupFits=[WORKSPACE_HEADER_HEIGHT_MIN,WORKSPACE_HEADER_HEIGHT_DEFAULT,WORKSPACE_HEADER_HEIGHT_MAX].every(height=>{
      applyWorkspaceHeaderHeight(height,{fit:false});
      const buttonRect=headerStartupButton.getBoundingClientRect();
      const labelStyle=getComputedStyle(headerStartupLabel);
      return labelStyle.display==='none'
        && Math.abs(buttonRect.width-parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--workspace-header-control-height')))<=0.5
        && headerStartupButton.scrollWidth<=headerStartupButton.clientWidth;
    });
    applyWorkspaceHeaderHeight(headerHeightBefore,{fit:false});
    headerStartupFixture.remove();
    const desktopActionsIconOnly=encodingLabelVisible&&compactLabelsHidden&&widerActionsIconOnly&&headerStartupFits;
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
    bindWorkspaceToolbarHorizontalScroll(toolbarFixture);
    toolbar.style.width='220px';
    toolbar.style.flex='0 0 220px';
    toolbar.scrollLeft=0;
    const toolbarOverflows=toolbar.scrollWidth>toolbar.clientWidth+1;
    toolbar.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:180}));
    const toolbarWheelScrolls=toolbar.scrollLeft>0;
    toolbar.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'End'}));
    const toolbarKeyboardScrolls=toolbar.scrollLeft+toolbar.clientWidth>=toolbar.scrollWidth-1;
    const terminalToolbarScrollable=toolbarOverflows&&toolbarWheelScrolls&&toolbarKeyboardScrolls
      && toolbar.dataset.workspaceHorizontalScroll==='1'
      && getComputedStyle(toolbar).overflowX==='auto';
    toolbar.style.width='';
    toolbar.style.flex='';
    toolbar.scrollLeft=0;
    const desktopBackButton=document.querySelector('#mobileBack');
    const desktopBackHidden=Boolean(desktopBackButton&&getComputedStyle(desktopBackButton).display==='none');
    const metrics=visibleToolbarButtons.map(button=>{const br=button.getBoundingClientRect(),svg=button.querySelector('svg').getBoundingClientRect();return {buttonHeight:br.height,iconWidth:svg.width,iconHeight:svg.height,centerDelta:Math.abs((svg.top+svg.height/2)-(br.top+br.height/2))}});
    toolbarViewFixture.remove();
    let terminalCtrlWheelZooms=false;
    let terminalCtrlWheelKeepsPosition=false;
    let terminalPlainWheelScrolls=false;
    let terminalFontChangePreservesMiddleScroll=false;
    let terminalFontChangeKeepsWheelContinuity=false;
    let terminalWheelMetrics={};
    let terminalCjkTextDoesNotClip=false;
    let terminalCjkMetrics={};
    try {
      await ensureTerminalLibs();
      const scrollbarFixture=document.createElement('div');
      scrollbarFixture.className='terminal-box';
      scrollbarFixture.style.cssText='position:fixed;left:-10000px;top:0;width:520px;height:240px;min-height:0;';
      document.body.appendChild(scrollbarFixture);
      const scrollbarTerm=new TerminalClass({allowProposedApi:true,overviewRuler:{width:8},fontSize:13});
      const scrollbarFit=createTerminalFitAddon(scrollbarTerm);
      scrollbarTerm.loadAddon(scrollbarFit);
      scrollbarTerm.open(scrollbarFixture);
      scrollbarFit.fit();
      await new Promise(resolve=>scrollbarTerm.write(Array.from({length:80},(_,index)=>'line '+index+'\\r\\n').join(''),resolve));
      scrollbarTerm.scrollToBottom();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const terminalScrollState=()=>{
        const viewport=scrollbarTerm?._core?._viewport;
        const scrollable=viewport?._scrollableElement;
        const cellHeight=Number(scrollbarTerm?._core?._renderService?.dimensions?.css?.cell?.height||0);
        return {
          viewportY:Number(scrollbarTerm.buffer.active.viewportY||0),
          baseY:Number(scrollbarTerm.buffer.active.baseY||0),
          latestYDisp:Number(viewport?._latestYDisp),
          scrollTop:Number(scrollable?.getScrollPosition?.()?.scrollTop||0),
          futureScrollTop:Number(scrollable?._scrollable?.getFutureScrollPosition?.()?.scrollTop||0),
          cellHeight
        };
      };
      const terminalWheelEvent=(deltaY,ctrlKey=false)=>{
        const event=new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey,deltaY,deltaMode:WheelEvent.DOM_DELTA_PIXEL});
        try { Object.defineProperty(event,'wheelDeltaY',{value:-deltaY}); } catch {}
        return event;
      };
      const wheelKey='terminal-wheel-smoke';
      const wheelSession={term:scrollbarTerm,fit:{fit:()=>{}},id:first.id};
      const wheelTarget=scrollbarFixture.querySelector('.xterm-screen');
      const wheelFontSizeField=terminalFontSizeField();
      const wheelPreviousSavedFontSize=first[wheelFontSizeField];
      terminalSessions.set(wheelKey,wheelSession);
      try {
        enableTerminalFontWheel(wheelSession,wheelKey);
        scrollTerminalToLineImmediately(scrollbarTerm,Math.max(1,Math.floor(Number(scrollbarTerm.buffer.active.baseY||0)/2)));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const ctrlViewportBefore=scrollbarTerm.buffer.active.viewportY;
        const ctrlFontBefore=Number(scrollbarTerm.options.fontSize);
        const ctrlScrollEvent=terminalWheelEvent(100,true);
        const ctrlScrollDispatchResult=wheelTarget?.dispatchEvent(ctrlScrollEvent);
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const ctrlViewportAfter=scrollbarTerm.buffer.active.viewportY;
        const ctrlFontAfter=Number(scrollbarTerm.options.fontSize);
        const ctrlZoomOut=Boolean(wheelTarget)
          &&ctrlFontAfter===ctrlFontBefore-1
          &&ctrlScrollEvent.defaultPrevented
          &&ctrlScrollDispatchResult===false;
        const ctrlUpFontBefore=Number(scrollbarTerm.options.fontSize);
        const ctrlUpEvent=terminalWheelEvent(-100,true);
        const ctrlUpDispatchResult=wheelTarget?.dispatchEvent(ctrlUpEvent);
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const ctrlUpFontAfter=Number(scrollbarTerm.options.fontSize);
        const ctrlZoomIn=ctrlUpFontAfter===ctrlUpFontBefore+1
          &&ctrlUpEvent.defaultPrevented
          &&ctrlUpDispatchResult===false;
        terminalCtrlWheelZooms=ctrlZoomOut&&ctrlZoomIn;
        terminalCtrlWheelKeepsPosition=ctrlViewportAfter===ctrlViewportBefore
          &&scrollbarTerm.buffer.active.viewportY===ctrlViewportAfter;
        const plainStateBefore=terminalScrollState();
        const plainViewportBefore=scrollbarTerm.buffer.active.viewportY;
        const plainFontBefore=Number(scrollbarTerm.options.fontSize);
        const plainWheelEvent=terminalWheelEvent(100);
        wheelTarget?.dispatchEvent(plainWheelEvent);
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const plainStateAfter=terminalScrollState();
        const plainViewportAfter=scrollbarTerm.buffer.active.viewportY;
        const plainFontAfter=Number(scrollbarTerm.options.fontSize);
        const plainWheelDistance=plainViewportAfter-plainViewportBefore;
        terminalPlainWheelScrolls=plainFontAfter===plainFontBefore&&plainWheelDistance>0&&plainWheelDistance<=6;
        terminalWheelMetrics={ctrlViewportBefore,ctrlViewportAfter,ctrlFontBefore,ctrlFontAfter,ctrlUpFontBefore,ctrlUpFontAfter,plainViewportBefore,plainViewportAfter,plainWheelDistance,plainFontBefore,plainFontAfter,plainStateBefore,plainStateAfter,ctrlDefaultPrevented:ctrlScrollEvent.defaultPrevented,ctrlUpDefaultPrevented:ctrlUpEvent.defaultPrevented,plainDefaultPrevented:plainWheelEvent.defaultPrevented};

        scrollbarTerm.scrollToLine(Math.max(1, Math.floor(Number(scrollbarTerm.buffer.active.baseY || 0) / 2)), true);
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const middleViewportBefore=Number(scrollbarTerm.buffer.active.viewportY || 0);
        const middleBaseBefore=Number(scrollbarTerm.buffer.active.baseY || 0);
        const middleFontBefore=Number(scrollbarTerm.options.fontSize);
        changeTerminalFont(wheelKey,-1);
        await new Promise(resolve=>setTimeout(resolve,80));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const middleViewportAfterShrink=Number(scrollbarTerm.buffer.active.viewportY || 0);
        const middleBaseAfterShrink=Number(scrollbarTerm.buffer.active.baseY || 0);
        const shrinkStateBefore=terminalScrollState();
        const shrinkStayedMiddle=middleViewportAfterShrink>0&&middleViewportAfterShrink<middleBaseAfterShrink-1;
        const shrinkWheelBefore=middleViewportAfterShrink;
        const shrinkWheelEvent=terminalWheelEvent(100);
        wheelTarget?.dispatchEvent(shrinkWheelEvent);
        await new Promise(resolve=>setTimeout(resolve,100));
        const shrinkStateAfter=terminalScrollState();
        const shrinkWheelAfter=Number(scrollbarTerm.buffer.active.viewportY || 0);
        const shrinkWheelDistance=shrinkWheelAfter-shrinkWheelBefore;
        const shrinkWheelMoved=shrinkWheelDistance>0&&shrinkWheelDistance<=6;
        changeTerminalFont(wheelKey,1);
        await new Promise(resolve=>setTimeout(resolve,80));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const middleViewportAfterGrow=Number(scrollbarTerm.buffer.active.viewportY || 0);
        const middleBaseAfterGrow=Number(scrollbarTerm.buffer.active.baseY || 0);
        const growStayedMiddle=middleViewportAfterGrow>0&&middleViewportAfterGrow<middleBaseAfterGrow-1;
        terminalFontChangePreservesMiddleScroll=middleBaseBefore>8&&shrinkStayedMiddle&&growStayedMiddle;
        terminalFontChangeKeepsWheelContinuity=shrinkWheelMoved;
        terminalWheelMetrics={...terminalWheelMetrics,middleViewportBefore,middleBaseBefore,middleFontBefore,middleViewportAfterShrink,middleBaseAfterShrink,shrinkWheelBefore,shrinkWheelAfter,shrinkWheelDistance,middleViewportAfterGrow,middleBaseAfterGrow,shrinkStateBefore,shrinkStateAfter,shrinkStayedMiddle,growStayedMiddle,shrinkWheelMoved};
        scrollbarTerm.options.fontSize=middleFontBefore;
      } catch (error) {
        terminalWheelMetrics={error:String(error?.stack||error)};
      } finally {
        clearTimeout(terminalPreferencesSaveTimers.get(first.id));
        terminalPreferencesSaveTimers.delete(first.id);
        first[wheelFontSizeField]=wheelPreviousSavedFontSize;
        terminalSessions.delete(wheelKey);
      }
      const cjkLine='[X11] 转发未建立：远端 SSH 服务未开启或拒绝了 X11 转发。本次已自动降级为普通 SSH 终端，命令行仍可正常使用；图形程序不会显示。请在 X Server 管理中检查 X11Forwarding 和远端 xauth/XQuartz。';
      await new Promise(resolve=>scrollbarTerm.write('\\x1b[2J\\x1b[H'+cjkLine,resolve));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const terminalScreenRect=scrollbarFixture.querySelector('.xterm-screen')?.getBoundingClientRect();
      const terminalScrollbarRect=scrollbarFixture.querySelector('.xterm-scrollable-element > .scrollbar.vertical')?.getBoundingClientRect();
      const terminalXterm=scrollbarFixture.querySelector('.xterm');
      const cjkRows=[...scrollbarFixture.querySelectorAll('.xterm-rows > div')].filter(row=>row.textContent.trim());
      const cjkRowMetrics=cjkRows.map(row=>{
        const rowRect=row.getBoundingClientRect();
        const spanRects=[...row.querySelectorAll('span')].map(span=>span.getBoundingClientRect()).filter(rect=>rect.width||rect.height);
        return {
          text:row.textContent,
          rowRight:rowRect.right,
          maxSpanRight:spanRects.length?Math.max(...spanRects.map(rect=>rect.right)):rowRect.left
        };
      });
      const textSpacingTrim=terminalXterm ? getComputedStyle(terminalXterm).textSpacingTrim : '';
      const maxOverflow=cjkRowMetrics.length ? Math.max(...cjkRowMetrics.map(row=>row.maxSpanRight-row.rowRight)) : null;
      const maxTextRight=cjkRowMetrics.length ? Math.max(...cjkRowMetrics.map(row=>row.maxSpanRight)) : null;
      terminalCjkMetrics={
        screenRight:terminalScreenRect?.right,
        scrollbarLeft:terminalScrollbarRect?.left,
        scrollbarWidth:terminalScrollbarRect?.width,
        textSpacingTrim,
        maxOverflow,
        maxTextRight,
        rows:cjkRowMetrics,
        gap:terminalScreenRect&&terminalScrollbarRect ? terminalScrollbarRect.left-terminalScreenRect.right : null
      };
      terminalCjkTextDoesNotClip=Boolean(terminalScreenRect&&terminalScrollbarRect&&cjkRowMetrics.length
        && terminalScrollbarRect.width>=7.5
        && textSpacingTrim==='space-all'
        && cjkRowMetrics.every(row=>row.maxSpanRight<=row.rowRight+0.25)
        && maxTextRight<=terminalScrollbarRect.left-0.25);
      scrollbarTerm.dispose();
      scrollbarFixture.remove();
    } catch (error) {
      terminalCjkMetrics={error:String(error?.stack||error)};
    }
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
    const zmodemPanelMetrics=[];
    for (const width of [560,360]) {
      const zmodemMount=document.createElement('div');
      zmodemMount.className='terminal-box';
      zmodemMount.style.cssText='position:fixed;left:-10000px;top:0;width:'+width+'px;height:220px;min-height:0;';
      document.body.appendChild(zmodemMount);
      const zmodemSession={mount:zmodemMount};
      terminalZmodemRender(zmodemSession,{
        icon:'download',
        title:'正在接收 long-zmodem-transfer-filename.log',
        detail:'25.0 MB / 50.0 MB',
        showProgress:true,
        progress:50,
        primaryAction:'receive',
        primaryIcon:'download',
        primaryLabel:'接收本批文件'
      });
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const panel=zmodemMount.querySelector('.terminal-zmodem-panel');
      const mountRect=zmodemMount.getBoundingClientRect();
      const panelRect=panel?.getBoundingClientRect();
      const buttons=[...zmodemMount.querySelectorAll('.terminal-zmodem-actions button')].map(button=>button.getBoundingClientRect());
      zmodemPanelMetrics.push({
        width,
        visible:Boolean(panel&&!panel.hidden&&panelRect?.width&&panelRect?.height),
        withinMount:Boolean(panelRect&&panelRect.left>=mountRect.left-0.5&&panelRect.right<=mountRect.right+0.5),
        actionsVisible:Boolean(panelRect&&buttons.length===2&&buttons.every(rect=>rect.width>0&&rect.height>=30&&rect.left>=panelRect.left-0.5&&rect.right<=panelRect.right+0.5)),
        progressVisible:Boolean(zmodemMount.querySelector('[role="progressbar"][aria-valuenow="50"]'))
      });
      closeTerminalZmodem(zmodemSession);
      zmodemMount.remove();
    }
    const zmodemPanelUi=zmodemPanelMetrics.every(item=>item.visible&&item.withinMount&&item.actionsVisible&&item.progressVisible);
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
    return {found:true,labels,metrics,desktopBackHidden,desktopKeysHidden,binaryType,binaryWrite,stableLogId,x11DefaultFallsBack,x11ScopeMenu,ctrlVImageIntercepted,ctrlVEmptyFallsThrough,ctrlVDiagnostics,enterReconnect,reconnectPreservesOutput,inactiveTerminalOutputContinues,fontActionRestoresFocus,recentCommandsRestoreFocus,recentCommandSequenceVisible,resourceWindowTitle,numberingContinuesWithOpenTabs,numberingRestartsAfterAllClosed,encodingMenuOpened,fontMenuOpened,statusHoverShowsFull,desktopStatusAvoidsDuplicate,desktopToolbarInHeader,connectionToggleUsesLinkAction,activeToolbarReplacesPrevious,narrowToolbarFits,narrowToolbarLeftAligned,responsiveToolbarFits,terminalToolbarScrollable,startupCompactIconOnly,desktopActionsIconOnly,terminalToolbarIconSet,terminalFrameLowContrast,terminalFrameColors,terminalBackgroundColor,desktopCursorCopyHintVisible,desktopCursorCopyHintCleansUp,terminalCtrlWheelZooms,terminalCtrlWheelKeepsPosition,terminalPlainWheelScrolls,terminalFontChangePreservesMiddleScroll,terminalFontChangeKeepsWheelContinuity,terminalWheelMetrics,terminalCjkTextDoesNotClip,terminalCjkMetrics,latencyMeasured,latencyCanDisable,latencyCanEnable,zmodemPanelUi,zmodemPanelMetrics,terminalSettingsUi};
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
    const fixture=document.createElement('div');
    fixture.style.cssText='position:fixed;left:-10000px;top:0;width:260px;';
    fixture.innerHTML=renderLogButton({label:'日志测试机 · 终端-2026年7月30日 01:31:49',path:'terminals/fixture.log'},'server:1');
    document.body.appendChild(fixture);
    const time=fixture.querySelector('.log-item-time');
    const timeRect=time?.getBoundingClientRect();
    const buttonRect=fixture.querySelector('.log-item')?.getBoundingClientRect();
    result.fullTerminalTime=Boolean(time?.textContent==='2026-07-30 01:31:49'&&getComputedStyle(time).whiteSpace==='nowrap'&&timeRect&&buttonRect&&timeRect.left>=buttonRect.left-0.5&&timeRect.right<=buttonRect.right+0.5);
    fixture.remove();
    const logFixture=document.createElement('div');
    logFixture.style.cssText='position:fixed;left:-10000px;top:0;width:260px;height:96px;overflow:auto;';
    logFixture.innerHTML='<pre class="log-view" style="min-height:320px">old\\nnew</pre>';
    document.body.appendChild(logFixture);
    positionLogViewerScroll(logFixture,'end');
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    result.defaultsToLatest=logFixture.scrollTop+logFixture.clientHeight>=logFixture.scrollHeight-1;
    const previousTheme=document.documentElement.dataset.theme||'light';
    const panelProbe=document.createElement('div');
    panelProbe.style.background='var(--panel)';
    logFixture.appendChild(panelProbe);
    applyTheme('light');
    const lightThemeMatches=getComputedStyle(logFixture.querySelector('.log-view')).backgroundColor===getComputedStyle(panelProbe).backgroundColor;
    applyTheme('dark');
    const darkThemeMatches=getComputedStyle(logFixture.querySelector('.log-view')).backgroundColor===getComputedStyle(panelProbe).backgroundColor;
    result.followsTheme=lightThemeMatches&&darkThemeMatches;
    applyTheme(previousTheme);
    logFixture.remove();
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
    let directoryCacheBehavior = {sameResponseUntouched:false,changedResponseRendered:false,boundedAndExpired:false,permissionFailureRestored:false};
    let searchKeyboardUi = {opened:false,closed:false,recursive:false,feedback:false};
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
      await openSftp(connection.id, '/Users/demo/Public', true, fixtureTabKey);
      setWorkspace('切换测试', 'UI', 'welcome', 'sftp-switch-fixture', false, true);
      activeTabKey = fixtureTabKey;
      activeView = 'sftp';
      const pageLoadsBeforeReturn = sftpPageLoads;
      await openSftp(connection.id, '/Users/demo/Public', false, fixtureTabKey);
      const reusedWithoutDirectoryReload = sftpPageLoads === pageLoadsBeforeReturn;
      let stickyTop = view.querySelector('.sftp-top');
      const fixturePane = view.closest('.workspace-pane');
      let toolbar = document.querySelector('#workspaceGlobalHeaderTools .sftp-toolbar') || fixturePane?.querySelector('[data-workspace-role="header-tools"] .sftp-toolbar') || view.querySelector('.sftp-toolbar');
      toolbar?.remove();
      await openSftp(connection.id, '/Users/demo/Public', false, fixtureTabKey);
      const recoveredMissingToolbar = Boolean(
        document.querySelector('.sftp-toolbar[data-workspace-tab-key="' + CSS.escape(fixtureTabKey) + '"]')
      );
      toolbar = document.querySelector('#workspaceGlobalHeaderTools .sftp-toolbar') || fixturePane?.querySelector('[data-workspace-role="header-tools"] .sftp-toolbar') || view.querySelector('.sftp-toolbar');
      const duplicateSftpKey = 'sftp-' + connection.id + '-901';
      await openSftp(connection.id, '/Users/demo/Public', true, duplicateSftpKey);
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
      await openSftp(connection.id, '/Users/demo/Public', false, fixtureTabKey);
      toolbar = document.querySelector('#workspaceGlobalHeaderTools .sftp-toolbar') || fixturePane?.querySelector('[data-workspace-role="header-tools"] .sftp-toolbar') || view.querySelector('.sftp-toolbar');
      let navigationRow = view.querySelector('.sftp-navigation-row');
      let breadcrumb = view.querySelector('.sftp-breadcrumb');
      let pathEditor = view.querySelector('#sftpPathEditor');
      let floatingSearch = view.querySelector('#sftpFloatingSearch');
      let dropOverlay = view.querySelector('#sftpDropOverlay');
      let clipboardActions = toolbar?.querySelector('#sftpClipboardActions') || view.querySelector('#sftpClipboardActions') || document.querySelector('#sftpClipboardActions') || document.createElement('span');
      const actionTitles = [...toolbar?.querySelectorAll('button, label') || []].map(node => node.title || node.getAttribute('aria-label') || '').filter(Boolean);
      const emptyClipboardHidden = Boolean(clipboardActions && !clipboardActions.querySelector('button') && !clipboardActions.textContent.trim());
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
      const connectedButton = sftpElement('sftpConnectionToggle', fixtureTabKey);
      const connectedAction = Boolean(
        connectedButton?.dataset.status === 'connected'
        && connectedButton?.title === '断开 SFTP 连接'
        && connectedButton?.getAttribute('aria-label') === '断开 SFTP 连接'
        && connectedButton?.querySelector('.lucide-link-2-off')
      );
      sftpDisconnectedTabs.add(fixtureTabKey);
      const disconnectedPageLoads = sftpPageLoads;
      await openSftp(connection.id, '/Users/demo/Public', false, fixtureTabKey);
      const disconnectedTabSwitchDoesNotReconnect = sftpPageLoads === disconnectedPageLoads;
      await openSftp(connection.id, '/Users/demo/Public', true, fixtureTabKey);
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
      const nativeDragBridgeDescriptor = Object.getOwnPropertyDescriptor(window, 'termaDesktop');
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
        Object.defineProperty(window, 'termaDesktop', {
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
            return {files:['C:\\Terma\\drag-cache\\native-drag.txt']};
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
        Object.defineProperty(window, 'termaDesktop', {
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
          && failedCall.files?.[0] === 'C:\\Terma\\drag-cache\\native-drag.txt'
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
        Object.defineProperty(window, 'termaDesktop', {
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
        if (nativeDragBridgeDescriptor) Object.defineProperty(window, 'termaDesktop', nativeDragBridgeDescriptor);
        else delete window.termaDesktop;
      }
      const sourceSftpTabKey = activeTabKey;
      const sourceSftpPath = sftpState.path;
      const dragTargetConnection = {...connection,id:Number(connection.id) + 9000,name:'测试目标'};
      connections.push(dragTargetConnection);
      const dragTargetTab = {key:'sftp-' + dragTargetConnection.id,kind:'sftp',id:dragTargetConnection.id,title:'测试目标 · SFTP',path:'/target'};
      tabs.push(dragTargetTab);
      renderTabs();
      const dragTargetButton = [...document.querySelectorAll('#tabs .tab')].find(tab => tab.dataset.tabKey === dragTargetTab.key);
      const webCrossHostBridgeDescriptor = Object.getOwnPropertyDescriptor(window, 'termaDesktop');
      Object.defineProperty(window, 'termaDesktop', {
        configurable:true,
        writable:true,
        value:undefined
      });
      const webCrossHostMode = sftpExternalDragMode() === false;
      sftpInternalDrag = {connectionId:Number(connection.id),entries:[{path:'/source.txt',name:'source.txt',type:'file'}],row:null};
      const serializedCrossDrag = serializeSftpDragPayload(sftpInternalDrag.connectionId, sftpInternalDrag.entries, sourceSftpTabKey);
      const crossDragDataTransfer = {
        types:['application/x-terma-sftp'],
        dropEffect:'',
        getData(type) {
          return type === 'application/x-terma-sftp' ? serializedCrossDrag : '';
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
        dataTransfer:{types:['application/x-terma-sftp'],dropEffect:'copy'}
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
      if (webCrossHostBridgeDescriptor) Object.defineProperty(window, 'termaDesktop', webCrossHostBridgeDescriptor);
      else delete window.termaDesktop;
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
      const uriListBridgeDescriptor = Object.getOwnPropertyDescriptor(window, 'termaDesktop');
      if (!uriListBridgeDescriptor || uriListBridgeDescriptor.configurable) {
        Object.defineProperty(window, 'termaDesktop', {
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
        if (uriListBridgeDescriptor) Object.defineProperty(window, 'termaDesktop', uriListBridgeDescriptor);
        else delete window.termaDesktop;
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
      const terminalDropTab = {key:'terminal-sftp-drop-target',kind:'terminal',id:Number(connection.id),title:'终端拖放目标'};
      tabs.push(terminalDropTab);
      terminalSessions.set(terminalDropTab.key, {id:Number(connection.id),connected:true,currentDirectoryKnown:true,currentDirectory:'/terminal/current'});
      const terminalTabButton = document.createElement('button');
      terminalTabButton.className = 'tab';
      terminalTabButton.dataset.tabKey = terminalDropTab.key;
      const terminalDragTransfer = {
        types:['application/x-terma-sftp'],
        dropEffect:'',
        getData(type) { return type === 'application/x-terma-sftp' ? serializeSftpDragPayload(connection.id, [{path:'/source.txt',name:'source.txt',type:'file'}], sourceSftpTabKey) : ''; }
      };
      const originalActivateTabForTerminalDrop = activateTab;
      activateTab = tabKey => { activeTabKey = tabKey; };
      let terminalTabPreviewActivated = false;
      let invalidTerminalDropRestoresSource = false;
      let invalidSftpDropRestoresSource = false;
      const invalidDropZone = document.createElement('div');
      invalidDropZone.className = 'ui-smoke-invalid-sftp-drop-zone';
      document.body.appendChild(invalidDropZone);
      const invalidSftpTargetConnection = {...connection,id:Number(connection.id) + 9100,name:'无效投放预览目标'};
      const invalidSftpTargetTab = {key:'sftp-invalid-drop-target',kind:'sftp',id:invalidSftpTargetConnection.id,title:'无效投放预览目标 · SFTP',path:'/invalid-target'};
      connections.push(invalidSftpTargetConnection);
      tabs.push(invalidSftpTargetTab);
      const invalidSftpTargetButton = document.createElement('button');
      invalidSftpTargetButton.className = 'tab';
      invalidSftpTargetButton.dataset.tabKey = invalidSftpTargetTab.key;
      const originalCopySftpDraggedItemsToDirectory = copySftpDraggedItemsToDirectory;
      let terminalDropCapture = null;
      try {
        activeTabKey = sourceSftpTabKey;
        sftpInternalDrag = {connectionId:Number(connection.id),entries:[{path:'/source.txt',name:'source.txt',type:'file'}],sourceTabKey:sourceSftpTabKey,row:null,previewActivated:false,dropAccepted:false};
        handleSftpTabDragOver({preventDefault(){},dataTransfer:terminalDragTransfer,currentTarget:terminalTabButton}, terminalDropTab.key, terminalTabButton);
        await new Promise(resolve => setTimeout(resolve, 210));
        terminalTabPreviewActivated = activeTabKey === terminalDropTab.key && document.querySelector('#sftpDragHint')?.textContent.includes('终端当前目录');
        handleSftpTabDragLeave({relatedTarget:invalidDropZone,currentTarget:terminalTabButton}, terminalTabButton);
        await new Promise(resolve => setTimeout(resolve, 25));
        invalidTerminalDropRestoresSource = activeTabKey === sourceSftpTabKey && !sftpTabDragPreviewSession;

        activeTabKey = sourceSftpTabKey;
        sftpInternalDrag = {connectionId:Number(connection.id),entries:[{path:'/source.txt',name:'source.txt',type:'file'}],sourceTabKey:sourceSftpTabKey,row:null,previewActivated:false,dropAccepted:false};
        handleSftpTabDragOver({preventDefault(){},dataTransfer:terminalDragTransfer,currentTarget:invalidSftpTargetButton}, invalidSftpTargetTab.key, invalidSftpTargetButton);
        await new Promise(resolve => setTimeout(resolve, 210));
        handleSftpDocumentDragOver({target:invalidDropZone});
        await new Promise(resolve => setTimeout(resolve, 25));
        invalidSftpDropRestoresSource = activeTabKey === sourceSftpTabKey && !sftpTabDragPreviewSession;

        sftpInternalDrag = {connectionId:Number(connection.id),entries:[{path:'/source.txt',name:'source.txt',type:'file'}],sourceTabKey:sourceSftpTabKey,row:null,previewActivated:true,dropAccepted:false};
        copySftpDraggedItemsToDirectory = async (drag, targetConnectionId, directory, options={}) => {
          terminalDropCapture = {targetConnectionId,directory,tabKey:options.tabKey};
          markSftpDragDropAccepted(drag, options.tabKey);
          finishSftpDragPayload(drag);
        };
        await dropSftpItemsOnTab({preventDefault(){},stopPropagation(){},dataTransfer:terminalDragTransfer}, terminalDropTab.key, terminalTabButton);
      } finally {
        copySftpDraggedItemsToDirectory = originalCopySftpDraggedItemsToDirectory;
        activateTab = originalActivateTabForTerminalDrop;
        invalidDropZone.remove();
        tabs.splice(tabs.findIndex(item => item.key === invalidSftpTargetTab.key), 1);
        connections.splice(connections.findIndex(item => Number(item.id) === Number(invalidSftpTargetConnection.id)), 1);
      }
      const acceptedTerminalDropStays = activeTabKey === terminalDropTab.key
        && terminalDropCapture?.targetConnectionId === Number(connection.id)
        && terminalDropCapture?.directory === '/terminal/current'
        && terminalDropCapture?.tabKey === terminalDropTab.key;
      terminalSessions.delete(terminalDropTab.key);
      tabs.splice(tabs.indexOf(terminalDropTab), 1);
      activeTabKey = sourceSftpTabKey;
      connectionSessionUi = {
        found:Boolean(disconnectedButton && disconnectedBanner),
        addressIncludesPort:document.querySelector('#workspaceSubtitle')?.textContent === connection.ssh_user+'@'+connection.ssh_host+':'+connection.ssh_port,
        disconnectedAction,
        disconnectedBanner:bannerVisible,
        connectedAction,
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
        terminalTabPreviewActivated,
        invalidTerminalDropRestoresSource,
        invalidSftpDropRestoresSource,
        acceptedTerminalDropStays,
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

      copySingleSftp('/Users/demo/Public/copy.txt', 'copy', fixtureTabKey);
      const copyPaste = [...clipboardActions.querySelectorAll('button')].find(button => button.textContent.includes('粘贴'));
      const copyCancel = clipboardActions.querySelector('[aria-label="取消复制或移动队列"]');
      const copyQueueVisible = clipboardActions.textContent.includes('复制队列 1 项') && Boolean(copyPaste && !copyPaste.disabled && copyCancel);
      copyCancel?.click();
      const copyCancelled = sftpClipboard === null && !clipboardActions.querySelector('button');

      copySingleSftp('/Users/demo/Public/move.txt', 'move', fixtureTabKey);
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
      floatingSearch.hidden = true;
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true}));
      const searchInput = floatingSearch.querySelector('#sftpSearch');
      const shortcutOpened = !floatingSearch.hidden && document.activeElement === searchInput;
      const recursiveInput = floatingSearch.querySelector('.sftp-search-recursive input');
      if (recursiveInput) {
        recursiveInput.checked = true;
        recursiveInput.dispatchEvent(new Event('change',{bubbles:true}));
      }
      await new Promise(resolve=>setTimeout(resolve,10));
      syncSftpSearchFeedback(fixtureTabKey, true);
      const searchFeedback = getComputedStyle(floatingSearch.querySelector('.lucide-loader-circle')).display !== 'none'
        && getComputedStyle(floatingSearch.querySelector('.lucide-loader-circle')).animationName === 'state-spin'
        && floatingSearch.getAttribute('aria-busy') === 'true';
      syncSftpSearchFeedback(fixtureTabKey, false);
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      searchKeyboardUi = {
        opened:shortcutOpened,
        closed:floatingSearch.hidden,
        recursive:Boolean(sftpTabRuntimes.get(fixtureTabKey)?.state.recursiveSearch),
        feedback:searchFeedback
      };
      const favorites = view.querySelector('#sftpFavorites');
      const shell = view.querySelector('.sftp-shell');
      const previousFavoritesHtml = favorites.innerHTML;
      const previousFavoritesClass = favorites.className;
      const previousShellStyle = shell.style.cssText;
      const previousStickyTopStyle = stickyTop.style.cssText;
      favorites.classList.add('is-empty');
      favorites.innerHTML = '';
      const emptyFavoritesRect = favorites.getBoundingClientRect();
      const emptyNavigationRect = navigationRow.getBoundingClientRect();
      const emptyStickyTopRect = stickyTop.getBoundingClientRect();
      const listRect = view.querySelector('#sftpList').getBoundingClientRect();
      const emptyFavoritesMinHeight = parseFloat(getComputedStyle(favorites).minHeight);
      const emptyFavoritesCompact = favorites.classList.contains('is-empty')
        && getComputedStyle(favorites).display === 'none'
        && emptyFavoritesRect.height === 0
        && emptyNavigationRect.height < 60
        && listRect.top - emptyStickyTopRect.bottom >= 0
        && listRect.top - emptyStickyTopRect.bottom <= 12;
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
        && getComputedStyle(shell).display === 'flex'
        && getComputedStyle(shell).flexDirection === 'column'
        && getComputedStyle(shell).alignItems === 'stretch'
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
        toolbarAnywhere:Boolean(toolbar && (document.querySelector('#workspaceGlobalHeaderTools')?.contains(toolbar) || fixturePane?.querySelector('[data-workspace-role="header-tools"]')?.contains(toolbar))),
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
        emptyFavoritesMetrics:{height:emptyFavoritesRect.height,minHeight:emptyFavoritesMinHeight,listGap:listRect.top-emptyStickyTopRect.bottom},
        wideNavigationCompact,
        narrowNavigationCompact,
        terminalJump:Boolean(toolbar?.querySelector('button[title="打开此连接的终端"]')),
        terminalJumpFirst:actionTitles[0] === '打开此连接的终端',
        reusedWithoutDirectoryReload
      };

      try {
        applyTermaAppearanceSettings();
        await showSftpGlobalSettings();
        const globalSettingsModal = document.querySelector('#modal');
        const globalSettingsCard = globalSettingsModal?.querySelector('.sftp-global-settings-modal');
        const globalSettingsRect = globalSettingsCard?.getBoundingClientRect();
        const globalSettingsChildren = [...globalSettingsCard?.children || []];
        const globalSettingsSamplers = [globalSettingsCard, ...globalSettingsChildren].filter(node => {
          const style = getComputedStyle(node);
          const filter = String(style.backdropFilter || '') + ' ' + String(style.getPropertyValue('-webkit-backdrop-filter') || '');
          return filter.includes('blur(') && !filter.includes('blur(0px)');
        });
        globalSettingsModal?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
        renderSettings();
        const taskCenterSetting = document.querySelector('#taskCenterFloatingProgressEnabled');
        const taskCenterSettingsSection = taskCenterSetting?.closest('section');
        globalSettingsUi = {
          found:Boolean(document.querySelector('#sftpGlobalSettingsButton') && globalSettingsCard && !globalSettingsModal?.hidden),
          globalScope:Boolean(globalSettingsCard?.textContent.includes('应用到所有 SFTP 标签和连接')),
          controls:Boolean(document.querySelector('#sftpRecycleBinEnabled')
            && document.querySelector('#sftpMaxOpenFileSizeMb')
            && document.querySelector('#sftpTextEditorMode')
            && document.querySelector('#sftpSettingsTabTransfer')
            && document.querySelector('#sftpDownloadConcurrency')
            && document.querySelector('#sftpUploadConcurrency')
            && document.querySelector('#sftpLightEditorThresholdMb')
            && (!window.termaDesktop || (document.querySelector('#sftpExternalEditSaveRule') && document.querySelector('#sftpExternalEditBackupEnabled')))
            && document.querySelector('#sftpGlobalSettingsSave')),
          floatingProgressDefaultOn:Boolean(taskCenterSetting?.checked),
          floatingProgressCanRestore:Boolean(taskCenterSettingsSection?.closest('#settings-notifications') && taskCenterSettingsSection.textContent.includes('悬浮任务进度卡')),
          downloadBehavior:Boolean(globalSettingsCard?.textContent.includes('SFTP 自动保存目录') || globalSettingsCard?.textContent.includes('当前设备的浏览器下载目录')),
          defaultLimit:document.querySelector('#sftpMaxOpenFileSizeMb')?.value === '50',
          backdropIgnored:Boolean(globalSettingsCard?.isConnected && !globalSettingsModal?.hidden),
          withinViewport:Boolean(globalSettingsRect && globalSettingsRect.left >= -0.5 && globalSettingsRect.right <= innerWidth + 0.5 && globalSettingsRect.top >= -0.5 && globalSettingsRect.bottom <= innerHeight + 0.5),
          classicSurface:globalSettingsSamplers.length === 0,
          themedField:Boolean(globalSettingsCard?.querySelector('input') && getComputedStyle(globalSettingsCard.querySelector('input')).backgroundColor !== 'rgba(0, 0, 0, 0)')
        };
        closeSftpGlobalSettings();
      } finally {
        applyTermaAppearanceSettings();
      }

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

        renderSftpEntries = cachePreviousRender;
        const safePath = '/home/demo';
        const safeEntries = [{name:'keep.txt',type:'file',size:3,mtime:3,mode:'644',owner:'demo',group:'demo'}];
        view.innerHTML = '<div class="sftp-shell"><nav id="sftpBreadcrumb" class="sftp-breadcrumb">'+sftpBreadcrumbHtml(connection.id,safePath,tabKey)+'</nav><input id="sftpPathInput" value="'+safePath+'"><button id="sftpConnectionToggle" data-status="connected"></button><div id="sftpConnectionBanner" hidden><span class="sftp-connection-detail"></span></div><div id="sftpList" class="sftp-list"></div></div>';
        view.dataset.sftpTabKey = tabKey;
        cacheRuntime.root = view;
        cacheRuntime.state = {...cacheRuntime.state,path:safePath,entries:safeEntries,selected:null,page:1,total:1,totalPages:1,unfilteredTotal:1,loading:false};
        sftpState = cacheRuntime.state;
        const cacheTab = tabs.find(item => item.key === tabKey);
        if (cacheTab) cacheTab.path = safePath;
        renderSftpEntries(tabKey);
        const safeList = view.querySelector('#sftpList');
        safeList.scrollTop = 4;
        const beforePermissionListText = safeList.textContent;
        api = async () => {
          const error = new Error('没有权限访问远程目录：/root');
          error.code = 'SFTP_DIRECTORY_PERMISSION_DENIED';
          error.status = 403;
          throw error;
        };
        const permissionLoaded = await checkedCacheLoad({connectionId:connection.id,path:'/root',page:1,tabKey});
        const permissionRestoreChecks = {
          rejected:permissionLoaded === false,
          runtimePath:cacheRuntime.state.path === safePath,
          runtimeEntries:cacheRuntime.state.entries?.[0]?.name === 'keep.txt',
          tabPath:cacheTab?.path === safePath,
          breadcrumbSafe:Boolean(view.querySelector('#sftpBreadcrumb')?.textContent.includes('demo') && !view.querySelector('#sftpBreadcrumb')?.textContent.includes('/root')),
          listPreserved:Boolean(view.querySelectorAll('#sftpList .sftp-row').length === 1 && view.querySelector('#sftpList .sftp-file-name')?.textContent === 'keep.txt' && !view.querySelector('#sftpList')?.textContent.includes('没有权限')),
          connectionPreserved:view.querySelector('#sftpConnectionToggle')?.dataset.status === 'connected'
        };
        const permissionFailureRestored = Object.values(permissionRestoreChecks).every(Boolean);

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
        directoryCacheBehavior = {sameResponseUntouched,changedResponseRendered,boundedAndExpired:bounded&&expired,permissionFailureRestored,permissionRestoreChecks,permissionRestoreDiagnostics:{runtimePath:cacheRuntime.state.path,tabPath:cacheTab?.path,breadcrumb:view.querySelector('#sftpBreadcrumb')?.textContent||'',list:view.querySelector('#sftpList')?.textContent||'',beforePermissionListText,connectionStatus:view.querySelector('#sftpConnectionToggle')?.dataset.status||''}};
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
    view.innerHTML = '<div class="sftp-shell"><div class="sftp-top"><div class="sftp-path-block"><div class="sftp-title">iMac</div><nav class="sftp-breadcrumb" id="sftpBreadcrumb" aria-label="远程目录路径">'+sftpBreadcrumbHtml(1,'/Users/demo/Public')+'</nav></div><div class="sftp-top-actions"></div><div class="sftp-selection-bar" id="sftpSelectionBar" hidden><div class="sftp-selected" id="sftpSelectedInfo"></div><div class="sftp-selection-actions"><button id="sftpSelectionCompress">压缩</button><button id="sftpSelectionPermissions">权限</button><button id="sftpSelectionExtract" hidden>解压</button><button>复制</button><button>移动</button><button>删除</button><button onclick="clearSftpSelection()">取消</button></div></div></div><div id="sftpList" class="sftp-list"></div></div>';
    const pageEntries = [
      {name:'folder', type:'dir', size:0, mtime:0, mode:'755', owner:'root', group:'wheel'},
      {name:specialName, type:'file', size:12, mtime:'2026-07-20T12:34:56Z', mode:'600', owner:'demo', group:'staff'},
      {name:'vmlinuz', type:'file', size:8181696, mtime:'2026-07-20T12:40:00Z', mode:'644', owner:'root', group:'root', is_symlink:true, link_size:27, link_target_missing:false},
      ...Array.from({length:47},(_,index)=>({name:'file-'+String(index+1).padStart(2,'0')+'.txt',type:'file',size:index+1,mtime:index+1,mode:'644',owner:'demo',group:'staff'}))
    ];
    sftpState = {...sftpState, connectionId:1, path:'/fixture', query:'', sort:'name', dir:'asc', selected:null, page:1, pageSize:50, total:75, totalPages:2, unfilteredTotal:75, entries:pageEntries};
    const fixtureRuntime = ensureSftpRuntime(fixtureTabKey, 1, '/fixture', view);
    fixtureRuntime.state = sftpState;
    fixtureRuntime.root = view;
    view.dataset.sftpTabKey = fixtureTabKey;
    activeTabKey = fixtureTabKey;
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
    const pauseEvents = [];
    const openProgress = createProgressToast({
      title:'正在打开 smoke.txt',
      detail:'正在读取 · 1 MB / 2 MB',
      progress:50,
      onPauseChange:value=>pauseEvents.push(value)
    });
    const openProgressToast = document.querySelector('.toast-progress');
    const openProgressInTaskCenter = Boolean(openProgressToast?.closest('#sftpTaskCenter'));
    openProgressToast?.querySelector('.toast-progress-pause')?.click();
    const openProgressPaused = Boolean(openProgressToast?.classList.contains('paused') && openProgressToast?.textContent.includes('继续'));
    openProgressToast?.querySelector('.toast-progress-pause')?.click();
    const openProgressResumed = Boolean(!openProgressToast?.classList.contains('paused') && pauseEvents.join(',') === 'true,false');
    openProgress.dismiss();
    const previousOpenFetch = window.fetch;
    const previousEnsureSftpConnection = ensureSftpConnection;
    const previousCreateProgressToast = createProgressToast;
    let retryFetches = 0;
    const retryProgressUpdates = [];
    let retryOpened = null;
    try {
      ensureSftpConnection = async () => true;
      createProgressToast = () => ({
        update:value=>retryProgressUpdates.push(value),
        fail() {},
        finish() {},
        dismiss() {}
      });
      window.fetch = async (input, options) => {
        const url = String(input?.url || input || '');
        if (!url.includes('/api/connections/1/sftp/open?path=%2Ffixture%2Fretry.txt')) return previousOpenFetch(input, options);
        retryFetches += 1;
        const body = retryFetches === 1
          ? new ReadableStream({start(controller) { controller.enqueue(new Uint8Array([1,2])); controller.error(new TypeError('network error')); }})
          : new ReadableStream({start(controller) { controller.enqueue(new Uint8Array([1,2,3,4])); controller.close(); }});
        return new Response(body, {status:200,headers:{'X-Terma-File-Size':'4','X-Terma-File-Limit':'52428800'}});
      };
      retryOpened = await readSftpOpenBytes(1, '/fixture/retry.txt');
    } finally {
      window.fetch = previousOpenFetch;
      ensureSftpConnection = previousEnsureSftpConnection;
      createProgressToast = previousCreateProgressToast;
    }
    const fileOpenFeedback = {
      busy:feedbackBusy,
      duplicateBlocked:!duplicateFeedbackRequestRan,
      restored:Boolean(feedbackButton && !feedbackButton.disabled && feedbackButton.getAttribute('aria-busy') === 'false' && feedbackButton.textContent.includes('打开')) && !openProgressInTaskCenter && openProgressPaused && openProgressResumed,
      progressOutsideTaskCenter:!openProgressInTaskCenter,
      pausable:openProgressPaused&&openProgressResumed,
      interruptedRetry:Boolean(retryFetches === 2 && retryOpened?.bytes?.join(',') === '1,2,3,4' && retryProgressUpdates.some(item=>String(item?.detail || '').includes('自动重试'))),
      retryFetches,
      retryBytes:retryOpened?.bytes?.join(',') || '',
      retryDetails:retryProgressUpdates.map(item=>String(item?.detail || '')),
      buttonDiagnostics:{found:Boolean(feedbackButton),disabled:feedbackButton?.disabled,ariaBusy:feedbackButton?.getAttribute('aria-busy'),text:feedbackButton?.textContent||'',connectionId:feedbackButton?.dataset.sftpConnectionId||'',remotePath:feedbackButton?.dataset.sftpRemotePath||'',expectedPath:feedbackPath,runtimeRootConnected:Boolean(fixtureRuntime.root?.isConnected),runtimeRootTabKey:fixtureRuntime.root?.dataset.sftpTabKey||'',activeTabKey,sftpActiveRuntimeKey}
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
    selectSftpEntry({shiftKey:false,ctrlKey:false,metaKey:false},1,checks[2].value,checks[2].dataset.name,checks[2].dataset.type,fixtureTabKey);
    const multiNameAddsSelection = checks.slice(0,3).every(input => input.checked);
    selectSftpEntry({shiftKey:false,ctrlKey:false,metaKey:false},1,checks[2].value,checks[2].dataset.name,checks[2].dataset.type,fixtureTabKey);
    const multiNameCancelsSelection = checks[0].checked && checks[1].checked && !checks[2].checked;
    selectSftpEntry({shiftKey:false,ctrlKey:false,metaKey:false},1,checks[1].value,checks[1].dataset.name,checks[1].dataset.type,fixtureTabKey);
    selectSftpEntry({shiftKey:false,ctrlKey:false,metaKey:false},1,checks[2].value,checks[2].dataset.name,checks[2].dataset.type,fixtureTabKey);
    const singleNameReplacesSelection = !checks[0].checked && !checks[1].checked && checks[2].checked;
    checks.forEach((input,index) => { input.checked = index < 2; });
    updateSftpSelection(fixtureTabKey);
    const selectionBar = view.querySelector('#sftpSelectionBar');
    const selectionShown = !selectionBar.hidden && selectionBar.textContent.includes('已选择 2 项');
    const selectionActionsShown = getComputedStyle(document.querySelector('#sftpSelectionCompress')).display !== 'none' && getComputedStyle(document.querySelector('#sftpSelectionPermissions')).display !== 'none';
    const specialSelectionExact = selectedSftpPaths(fixtureTabKey).includes('/fixture/' + specialName);
    const selectedRows = view.querySelectorAll('.sftp-row.is-selected').length;
    selectSftpDragSource(checks[2].value, checks[2].dataset.name, checks[2].dataset.type, fixtureTabKey);
    const dragSelectionSynchronized = checks.every((input,index) => input.checked === (index === 2))
      && rows.every((row,index) => row.classList.contains('is-selected') === (index === 2))
      && rows.every((row,index) => row.classList.contains('active') === (index === 2));
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
    const permissionOwnerColumn = rows[1]?.querySelector(':scope > .sftp-access code')?.textContent === '600' && rows[1]?.querySelector(':scope > .sftp-access span')?.textContent === 'demo';
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
      const compactHorizontalScroll = sftpList.scrollWidth <= sftpList.clientWidth + 1
        && !['auto','scroll'].includes(getComputedStyle(sftpList).overflowX)
        && document.documentElement.scrollWidth <= innerWidth + 1;
    sftpList.style.width = '390px';
    syncSftpListLayout(sftpList, 390);
    const narrowListWidth = sftpList.getBoundingClientRect().width;
    const narrowCoreDisplay = getComputedStyle(rows[0].querySelector('.sftp-row-action-core')).display;
    const narrowCoreHidden = narrowCoreDisplay === 'none';
    const narrowMoreVisible = getComputedStyle(rows[0].querySelector('.sftp-row-action-more')).display !== 'none';
    const narrowMeta = rows[1].querySelector('.sftp-mobile-meta');
    const narrowMetaDisplay = narrowMeta ? getComputedStyle(narrowMeta).display : '';
    const narrowMetaText = narrowMeta?.textContent || '';
    const narrowMetaVisible = Boolean(
      narrowMeta
      && narrowMetaDisplay !== 'none'
      && narrowMetaText.replace(/\\s+/g,'').includes(formatBytes(12).replace(/\\s+/g,''))
      && !narrowMetaText.includes('Invalid Date')
    );
    const narrowAccessHidden = getComputedStyle(rows[1].querySelector(':scope > .sftp-access')).display === 'none';
    const narrowLayoutClass = sftpList.classList.contains('sftp-actions-more-only');
    const narrowHeaderNameVisible = getComputedStyle(sftpList.querySelector('.sftp-head-cell.sftp-column-name')).display !== 'none';
    const narrowHeaderSummaryVisible = getComputedStyle(sftpList.querySelector('.sftp-compact-column-labels')).display !== 'none'
      && sftpList.querySelector('.sftp-compact-column-labels')?.textContent.includes('大小');
    const narrowCompactActions = Math.round((rows[0]?.querySelector('.sftp-row-actions')?.getBoundingClientRect().width || 0)) <= 60;
    const previousColumnLayout = localStorage.getItem(SFTP_COLUMN_LAYOUT_STORAGE_KEY);
    writeSftpColumnLayout({order:['name','size','mtime','access'],weights:{name:2.45,size:.72,mtime:1.28,access:1.34},actionWeight:3.6});
    sftpList.style.width = '760px';
    syncSftpListLayout(sftpList, 760);
    renderSftpEntries(fixtureTabKey);
    const compactColumnList = document.querySelector('#view-sftp #sftpList');
    const compactAccessHeader = compactColumnList.querySelector('.sftp-head [data-sftp-column="access"]');
    const compactActionsHeader = compactColumnList.querySelector('.sftp-head-actions');
    const compactAccessHandle = compactColumnList.querySelector('[data-sftp-column-resize="access"]');
    const compactNameHeader = compactColumnList.querySelector('.sftp-head [data-sftp-column="name"]');
    const compactNameHandle = compactColumnList.querySelector('[data-sftp-column-resize="name"]');
    const compactFollowingBoundariesBefore = ['size','mtime','access'].map(key => compactColumnList.querySelector('[data-sftp-column="' + key + '"]')?.getBoundingClientRect().right || 0);
    const compactOpenButtonBefore = compactColumnList.querySelector('.sftp-row .sftp-file-open-button')?.getBoundingClientRect().left || 0;
    const compactNameBoundaryBefore = compactNameHeader?.getBoundingClientRect().right || 0;
    const compactNameHandleRect = compactNameHandle?.getBoundingClientRect();
    const compactNameStartX = compactNameHandleRect ? compactNameHandleRect.left + compactNameHandleRect.width / 2 : compactNameBoundaryBefore;
    compactNameHandle?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:540,pointerType:'mouse',button:0,buttons:1,clientX:compactNameStartX,clientY:(compactNameHandleRect?.top || 0) + 8}));
    document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:540,pointerType:'mouse',button:0,buttons:1,clientX:compactNameStartX-20,clientY:(compactNameHandleRect?.top || 0) + 8}));
    document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:540,pointerType:'mouse',button:0,buttons:0,clientX:compactNameStartX-20,clientY:(compactNameHandleRect?.top || 0) + 8}));
    const compactFollowingBoundariesAfter = ['size','mtime','access'].map(key => compactColumnList.querySelector('[data-sftp-column="' + key + '"]')?.getBoundingClientRect().right || 0);
    const compactOpenButtonAfter = compactColumnList.querySelector('.sftp-row .sftp-file-open-button')?.getBoundingClientRect().left || 0;
    const compactAdjacentResizeStable = Math.abs((compactNameHeader?.getBoundingClientRect().right || 0) - (compactNameBoundaryBefore - 20)) <= 2
      && compactFollowingBoundariesBefore.every((boundary,index) => Math.abs(compactFollowingBoundariesAfter[index] - boundary) <= 1)
      && Math.abs(compactOpenButtonAfter - compactOpenButtonBefore) <= 1;
    const compactStableWidthsBefore = ['name','size','mtime'].map(key => compactColumnList.querySelector('[data-sftp-column="' + key + '"]')?.getBoundingClientRect().width || 0);
    const compactBoundaryBefore = compactAccessHeader?.getBoundingClientRect().right || 0;
    const compactHandleRect = compactAccessHandle?.getBoundingClientRect();
    const compactStartX = compactHandleRect ? compactHandleRect.left + compactHandleRect.width / 2 : compactBoundaryBefore;
    compactAccessHandle?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:541,pointerType:'mouse',button:0,buttons:1,clientX:compactStartX,clientY:(compactHandleRect?.top || 0) + 8}));
    document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:541,pointerType:'mouse',button:0,buttons:1,clientX:compactStartX-20,clientY:(compactHandleRect?.top || 0) + 8}));
    const compactBoundaryAfterFirstMove = compactAccessHeader?.getBoundingClientRect().right || 0;
    document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:541,pointerType:'mouse',button:0,buttons:1,clientX:compactStartX-20,clientY:(compactHandleRect?.top || 0) + 8}));
    const compactBoundaryAfterSecondMove = compactAccessHeader?.getBoundingClientRect().right || 0;
    document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:541,pointerType:'mouse',button:0,buttons:0,clientX:compactStartX-20,clientY:(compactHandleRect?.top || 0) + 8}));
    const compactStableWidthsAfter = ['name','size','mtime'].map(key => compactColumnList.querySelector('[data-sftp-column="' + key + '"]')?.getBoundingClientRect().width || 0);
    const compactPointerStable = Math.abs(compactBoundaryAfterFirstMove - (compactBoundaryBefore - 20)) <= 2
      && Math.abs(compactBoundaryAfterSecondMove - compactBoundaryAfterFirstMove) <= 1;
    const compactPairOnly = compactStableWidthsBefore.every((width,index) => Math.abs(compactStableWidthsAfter[index] - width) <= 1);
    const compactDividerUniform = Boolean(compactAccessHandle
      && compactActionsHeader
      && Math.abs(compactAccessHeader.getBoundingClientRect().right - compactActionsHeader.getBoundingClientRect().left) <= 1
      && getComputedStyle(compactAccessHeader).borderRightWidth === '0px'
      && getComputedStyle(compactAccessHandle,'::before').backgroundColor === getComputedStyle(compactColumnList.querySelector('[data-sftp-column-resize="name"]'),'::before').backgroundColor);

    const previousLocalColumnLayout = localStorage.getItem(LOCAL_FILES_COLUMN_LAYOUT_STORAGE_KEY);
    writeLocalFilesColumnLayout({weights:{name:2.45,size:.98,mtime:1.28}});
    const localColumnFixture = document.createElement('div');
    localColumnFixture.style.cssText = 'position:fixed;left:8px;top:8px;width:420px;height:180px;container-type:inline-size;container-name:local-files-view;z-index:-1';
    localColumnFixture.innerHTML = '<div class="local-files-list" style="width:420px;height:160px"><div class="local-files-head"><label><input type="checkbox"></label>'
      + ['name','size','mtime'].map(key => localFilesHeaderColumnHtml(key,'ui-smoke-local')).join('')
      + '</div><div class="local-files-row"><input type="checkbox"><button class="local-files-name">fixture.txt</button><span class="local-files-size">12 B</span><span class="local-files-time">2026-08-13</span></div></div>';
    document.body.appendChild(localColumnFixture);
    const localColumnList = localColumnFixture.querySelector('.local-files-list');
    bindLocalFilesColumnControls(localColumnList);
    const localNameHeader = localColumnList.querySelector('[data-local-files-column="name"]');
    const localNameHandle = localColumnList.querySelector('[data-local-files-column-resize="name"]');
    const localSizeHandle = localColumnList.querySelector('[data-local-files-column-resize="size"]');
    const localHandleRect = localNameHandle?.getBoundingClientRect();
    const localStartX = localHandleRect ? localHandleRect.left + localHandleRect.width / 2 : 0;
    const localBoundaryBefore = localNameHeader?.getBoundingClientRect().right || 0;
    localNameHandle?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:542,pointerType:'mouse',button:0,buttons:1,clientX:localStartX,clientY:(localHandleRect?.top || 0) + 8}));
    document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:542,pointerType:'mouse',button:0,buttons:1,clientX:localStartX+24,clientY:(localHandleRect?.top || 0) + 8}));
    const localBoundaryAfterFirstMove = localNameHeader?.getBoundingClientRect().right || 0;
    document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:542,pointerType:'mouse',button:0,buttons:1,clientX:localStartX+24,clientY:(localHandleRect?.top || 0) + 8}));
    const localBoundaryAfterSecondMove = localNameHeader?.getBoundingClientRect().right || 0;
    document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:542,pointerType:'mouse',button:0,buttons:0,clientX:localStartX+24,clientY:(localHandleRect?.top || 0) + 8}));
    const localNarrowResizable = Boolean(localNameHandle
      && !localNameHandle.hidden
      && localSizeHandle?.hidden
      && getComputedStyle(localColumnList.querySelector('[data-local-files-column="mtime"]')).display === 'none'
      && Math.abs(localBoundaryAfterFirstMove - (localBoundaryBefore + 24)) <= 2
      && Math.abs(localBoundaryAfterSecondMove - localBoundaryAfterFirstMove) <= 1
      && localColumnList.scrollWidth <= localColumnList.clientWidth + 1);
    const selectionToolbarFixture = document.createElement('div');
    selectionToolbarFixture.style.cssText = 'position:fixed;left:12px;top:12px;width:330px;z-index:2147483640';
    selectionToolbarFixture.innerHTML = '<div class="local-files-selection"><strong>已选择 <span>2</span> 项</strong><div class="local-files-selection-actions">'
      + '<button>打开</button><button>上传</button><button>路径</button><button>重命名</button><button>删除</button><button>权限</button><button class="icon-button" data-smoke-close aria-label="取消选择">×</button></div></div>';
    document.body.appendChild(selectionToolbarFixture);
    const selectionActions = selectionToolbarFixture.querySelector('.local-files-selection-actions');
    const selectionClose = selectionToolbarFixture.querySelector('[data-smoke-close]');
    selectionActions.scrollLeft = selectionActions.scrollWidth;
    const closeRect = selectionClose.getBoundingClientRect();
    const closeHit = document.elementFromPoint(closeRect.right - 2, closeRect.top + closeRect.height / 2);
    const selectionToolbarStable = getComputedStyle(selectionActions).overflowY === 'hidden'
      && selectionActions.scrollHeight <= selectionActions.clientHeight + 1
      && getComputedStyle(selectionClose).flexShrink === '0'
      && Boolean(closeHit === selectionClose || selectionClose.contains(closeHit));
    const scrollbarProbe = document.querySelector('.tree');
    const scrollbarStyles = [compactColumnList, localColumnList, scrollbarProbe]
      .filter(Boolean)
      .map(node => getComputedStyle(node).scrollbarColor);
    const scrollbarUnified = scrollbarStyles.length === 3
      && scrollbarStyles.every(value => value && value !== 'auto' && value === scrollbarStyles[0]);
    selectionToolbarFixture.remove();
    localColumnFixture.remove();
    if (previousLocalColumnLayout === null) localStorage.removeItem(LOCAL_FILES_COLUMN_LAYOUT_STORAGE_KEY);
    else localStorage.setItem(LOCAL_FILES_COLUMN_LAYOUT_STORAGE_KEY, previousLocalColumnLayout);

    sftpList.style.width = '1280px';
    syncSftpListLayout(sftpList, 1280);
    writeSftpColumnLayout({order:['name','size','mtime','access'],weights:{name:2,size:1.2,mtime:1.28,access:1.34},actionWeight:3.6});
    renderSftpEntries(fixtureTabKey);
    persistSftpColumnOrder('mtime','name',false);
    const columnList = document.querySelector('#view-sftp #sftpList');
    const headerOrder = [...columnList.querySelectorAll('.sftp-head [data-sftp-column]')].map(cell=>cell.dataset.sftpColumn);
    const rowOrder = [...columnList.querySelector('.sftp-row').children].filter(node=>node.className.includes('sftp-column-')).map(node=>[...node.classList].find(name=>name.startsWith('sftp-column-')).replace('sftp-column-',''));
    const weightBeforeKeyboard = readSftpColumnLayout().weights.name;
    const nextWeightBeforeKeyboard = readSftpColumnLayout().weights.size;
    const pairWeightBeforeKeyboard = weightBeforeKeyboard + nextWeightBeforeKeyboard;
    columnList.querySelector('[data-sftp-column-resize="name"]')?.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
    const storedColumnLayout = readSftpColumnLayout();
    const accessHeader = columnList.querySelector('.sftp-head [data-sftp-column="access"]');
    const actionsHeader = columnList.querySelector('.sftp-head-actions');
    const accessWeightBeforeActionResize = storedColumnLayout.weights.access;
    const actionWeightBeforeResize = storedColumnLayout.actionWeight;
    const actionBoundaryBeforeResize = accessHeader?.getBoundingClientRect().right || 0;
    const actionWidthBeforeResize = actionsHeader?.getBoundingClientRect().width || 0;
    const stableWidthsBeforeActionResize = ['name','size','mtime'].map(key => columnList.querySelector('[data-sftp-column="' + key + '"]')?.getBoundingClientRect().width || 0);
    columnList.querySelector('[data-sftp-column-resize="access"]')?.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));
    const actionResizeLayout = readSftpColumnLayout();
    const actionBoundaryAfterResize = accessHeader?.getBoundingClientRect().right || 0;
    const actionWidthAfterResize = actionsHeader?.getBoundingClientRect().width || 0;
    const stableWidthsAfterActionResize = ['name','size','mtime'].map(key => columnList.querySelector('[data-sftp-column="' + key + '"]')?.getBoundingClientRect().width || 0);
    const actionResizable = actionResizeLayout.weights.access < accessWeightBeforeActionResize
      && actionResizeLayout.actionWeight > actionWeightBeforeResize
      && Math.abs(actionBoundaryAfterResize - (actionBoundaryBeforeResize - 16)) <= 2
      && Math.abs(actionWidthAfterResize - (actionWidthBeforeResize + 16)) <= 2
      && stableWidthsBeforeActionResize.every((width,index) => Math.abs(stableWidthsAfterActionResize[index] - width) <= 1);
    const columnLayoutUi = {
      order:JSON.stringify(headerOrder) === JSON.stringify(['mtime','name','size','access']) && JSON.stringify(rowOrder) === JSON.stringify(headerOrder),
      persisted:JSON.stringify(storedColumnLayout.order) === JSON.stringify(headerOrder),
      resized:Math.abs(storedColumnLayout.weights.name - weightBeforeKeyboard) > .001
        && Math.abs(storedColumnLayout.weights.size - nextWeightBeforeKeyboard) > .001
        && Math.abs(storedColumnLayout.weights.name + storedColumnLayout.weights.size - pairWeightBeforeKeyboard) < .01
        && actionResizable,
      pointerStable:compactPointerStable,
      pairOnly:compactPairOnly,
      adjacentResizeStable:compactAdjacentResizeStable,
      dividerUniform:compactDividerUniform,
      localNarrowResizable,
      openButtonStable:Math.abs(compactOpenButtonAfter - compactOpenButtonBefore) <= 1,
      selectionToolbarStable,
      scrollbarUnified,
      globalCss:Boolean(columnList.style.getPropertyValue('--sftp-grid-columns'))
        && columnList.scrollWidth <= columnList.clientWidth + 1
        && !['auto','scroll'].includes(getComputedStyle(columnList).overflowX)
        && Boolean(accessHeader && actionsHeader && Math.abs(accessHeader.getBoundingClientRect().right - actionsHeader.getBoundingClientRect().left) <= 1)
    };
    if (previousColumnLayout === null) localStorage.removeItem(SFTP_COLUMN_LAYOUT_STORAGE_KEY);
    else localStorage.setItem(SFTP_COLUMN_LAYOUT_STORAGE_KEY, previousColumnLayout);
    sftpList.style.width = '';
    syncSftpListLayout(sftpList);
    renderSftpEntries(fixtureTabKey);
    sftpKnownJobStatuses.set('ui-smoke-extract', 'running');
    const completedMutationDetected = completedSftpMutationForCurrentView([{id:'ui-smoke-extract',status:'done',type:'extract',connection_id:1}]).has(1);
    sftpKnownJobStatuses.delete('ui-smoke-extract');
    let jobUi = {found:false};
    const previousApi = api;
    const previousJobTimer = startSftpJobsTimer;
    const previousLatestJobs = sftpLatestJobs;
    const previousTaskCenterView = sftpTaskCenterView;
    const previousJobRuntimeSettings = runtimeSettings;
    const previousConfirmModal = confirmModal;
    const previousTaskCenterSize = localStorage.getItem(SFTP_TASK_CENTER_SIZE_STORAGE_KEY);
    try {
      const jobFixtures = [
        {id:'running-job',status:'running',type:'upload',phase:'uploading',label:'正在上传任务',connection_id:Number(connection.id),connection_name:'iMac',size:100,transferred:40,progress:40,resume_supported:true,can_pause:true,can_cancel:true},
        {id:'component:failed-job',status:'failed',type:'upload',label:'失败任务',connection_id:Number(connection.id),connection_name:'iMac',error:'fixture failed',can_resume:true,logs:Array.from({length:40},(_,index)=>({at:Date.now()+index,text:'task-log-line-'+String(index+1).padStart(2,'0')+' '+'.'.repeat(48)}))},
        {id:'done-job',status:'done',type:'compress',label:'完成历史任务',connection_id:Number(connection.id),connection_name:'iMac',finished_at:Date.now()-1000},
        {id:'saved-download',status:'done',type:'download',label:'桌面已保存下载',connection_id:Number(connection.id),connection_name:'Demo Mac',delivery_mode:'desktop',delivery_status:'saved',saved_path:'C:\\Temp\\TermaFixture\\Downloads\\saved.txt',finished_at:Date.now()-1200},
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
      const floatingActions = Boolean(floatingCard?.querySelector('.sftp-task-float-pause:not([hidden])')?.dataset.action === 'pause'
        && floatingCard.querySelector('.sftp-task-float-pause .lucide-pause')
        && floatingCard.querySelector('.sftp-task-float-cancel:not([hidden])')
        && floatingCard.querySelector('.sftp-task-float-close')
        && floatingCard.querySelector('.sftp-task-float-mute')
        && floatingCard.querySelector('.lucide-bell-off'));
      updateSftpTaskCenter([{...jobFixtures[0],status:'paused',can_pause:false,can_resume:true}]);
      const floatingResumeAction = Boolean(floatingCard?.querySelector('.sftp-task-float-pause:not([hidden])')?.dataset.action === 'resume'
        && floatingCard.querySelector('.sftp-task-float-pause .lucide-play'));
      updateSftpTaskCenter(jobFixtures);
      const floatingProgress = Math.abs(Number.parseFloat(floatingCard?.querySelector('.progress i')?.style.width || '0') - 40) <= 0.1;
      resetSftpTaskCenterSize();
      await toggleSftpTaskCenter();
      const drawerOpened = Boolean(drawer && !drawer.hidden && button?.getAttribute('aria-expanded') === 'true');
      const defaultDrawerRect = drawer?.getBoundingClientRect();
      const drawerDefaultCompact = Boolean(defaultDrawerRect
        && defaultDrawerRect.width >= 338
        && defaultDrawerRect.width <= 502
        && defaultDrawerRect.height >= 238
        && defaultDrawerRect.height <= 402);
      const currentText = list?.textContent.replace(/\s+/g,' ').trim() || '';
      const currentRows = [...(list?.querySelectorAll('.sftp-job') || [])];
      const runningRow = currentRows.find(row => row.textContent.includes('正在上传任务'));
      const failedInCurrent = currentRows.find(row => row.textContent.includes('失败任务'));
      const currentActions = Boolean(runningRow?.textContent.includes('暂停')
        && runningRow.textContent.includes('取消')
        && !failedInCurrent);
      const currentProgress = Math.abs(Number.parseFloat(runningRow?.querySelector('.progress i')?.style.width || '0') - 40) <= 0.1;
      const currentOnly = currentText.includes('正在上传任务')
        && !currentText.includes('失败任务')
        && !currentText.includes('完成历史任务')
        && !currentText.includes('取消历史任务');
      setSftpTaskCenterView('failed');
      const failedText = list?.textContent.replace(/\s+/g,' ').trim() || '';
      const failedRows = [...(list?.querySelectorAll('.sftp-job') || [])];
      const failedRow = failedRows.find(row => row.textContent.includes('失败任务'));
      const failedOnly = failedText.includes('失败任务') && !failedText.includes('正在上传任务') && !failedText.includes('完成历史任务') && !failedText.includes('取消历史任务');
      const failedActions = Boolean(failedRow?.textContent.includes('重试') && failedRow?.querySelector('button[title="删除任务"]'));
      const failedFooter = document.querySelector('#sftpTaskCenterFooter');
      const failedClearAvailable = Boolean(failedFooter && !failedFooter.hidden
        && document.querySelector('#sftpTaskCenterClearLabel')?.textContent === '清空失败'
        && document.querySelector('#sftpTaskCenterClearButton')?.getAttribute('aria-label')?.includes('失败任务'));
      const taskLogDetails=failedRow?.querySelector('.global-task-log');
      taskLogDetails?.querySelector('summary')?.click();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const taskLogBeforeRefresh=taskLogDetails?.querySelector('pre');
      const taskLogInitialOpen=Boolean(taskLogDetails?.open);
      const taskLogInitialBottom=Boolean(taskLogBeforeRefresh&&sftpTaskLogAtBottom(taskLogBeforeRefresh));
      const refreshedJobFixtures=jobFixtures.map(job=>job.id==='component:failed-job'
        ? {...job,logs:[...job.logs,{at:Date.now()+100,text:'task-log-line-latest'}]}
        : job);
      updateSftpTaskCenter(refreshedJobFixtures);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const refreshedTaskLogDetails=list?.querySelector('.global-task-log[data-task-id="component:failed-job"]');
      const refreshedTaskLog=refreshedTaskLogDetails?.querySelector('pre');
      const taskLogRefreshKeepsOpen=Boolean(refreshedTaskLogDetails?.open);
      const taskLogRefreshShowsLatest=Boolean(refreshedTaskLog?.textContent.includes('task-log-line-latest'));
      const taskLogRefreshFollowsBottom=Boolean(refreshedTaskLog&&sftpTaskLogAtBottom(refreshedTaskLog));
      const drawerResizeStyle = getComputedStyle(drawer);
      const drawerResizeHandle = document.querySelector('#sftpTaskCenterResize');
      const drawerResizeHandleStyle = drawerResizeHandle ? getComputedStyle(drawerResizeHandle) : null;
      const drawerResizable = Boolean(drawerResizeHandle
        && drawerResizeHandleStyle?.display !== 'none'
        && drawerResizeHandleStyle?.cursor === 'nesw-resize'
        && drawerResizeStyle.resize === 'none');
      const drawerBeforeResizeRect = drawer.getBoundingClientRect();
      const drawerResizeHandleRect = drawerResizeHandle?.getBoundingClientRect();
      const resizePointerId = 451;
      const resizeStartX = (drawerResizeHandleRect?.left || drawerBeforeResizeRect.left) + 6;
      const resizeStartY = (drawerResizeHandleRect?.bottom || drawerBeforeResizeRect.bottom) - 6;
      drawerResizeHandle?.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true,cancelable:true,pointerId:resizePointerId,pointerType:'mouse',button:0,buttons:1,clientX:resizeStartX,clientY:resizeStartY}));
      const drawerResizeLifecycleStarted = document.body.classList.contains('sftp-task-center-resizing');
      window.dispatchEvent(new PointerEvent('pointermove', {bubbles:true,cancelable:true,pointerId:resizePointerId,pointerType:'mouse',button:0,buttons:1,clientX:resizeStartX + 70,clientY:resizeStartY - 60}));
      window.dispatchEvent(new PointerEvent('pointerup', {bubbles:true,cancelable:true,pointerId:resizePointerId,pointerType:'mouse',button:0,buttons:0,clientX:resizeStartX + 70,clientY:resizeStartY - 60}));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const resizedDrawerRect = drawer.getBoundingClientRect();
      const resizedListRect = list.getBoundingClientRect();
      const drawerResizeAdaptive = Boolean(drawerResizeLifecycleStarted
        && !document.body.classList.contains('sftp-task-center-resizing')
        && Math.abs(resizedDrawerRect.width - (drawerBeforeResizeRect.width - 70)) <= 2
        && Math.abs(resizedDrawerRect.height - (drawerBeforeResizeRect.height - 60)) <= 2
        && Math.abs(resizedDrawerRect.right - drawerBeforeResizeRect.right) <= 1
        && resizedListRect.left >= resizedDrawerRect.left - 1
        && resizedListRect.right <= resizedDrawerRect.right + 1
        && resizedListRect.top >= resizedDrawerRect.top - 1
         && resizedListRect.bottom <= resizedDrawerRect.bottom + 1
         && list.scrollWidth <= list.clientWidth + 1);
      const persistedDrawerSize=savedSftpTaskCenterSize();
      drawer.style.removeProperty('width');
      drawer.style.removeProperty('height');
      const drawerSizeRestored=restoreSftpTaskCenterSize(drawer);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const restoredDrawerRect=drawer.getBoundingClientRect();
      const drawerResizePersists=Boolean(persistedDrawerSize
        && drawerSizeRestored
        && Math.abs(persistedDrawerSize.width-resizedDrawerRect.width)<=2
        && Math.abs(persistedDrawerSize.height-resizedDrawerRect.height)<=2
        && Math.abs(restoredDrawerRect.width-resizedDrawerRect.width)<=2
        && Math.abs(restoredDrawerRect.height-resizedDrawerRect.height)<=2);
      drawerResizeHandle?.dispatchEvent(new MouseEvent('dblclick', {bubbles:true,cancelable:true,button:0}));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const resetDrawerRect = drawer.getBoundingClientRect();
      const drawerResizeReset = Boolean(Math.abs(resetDrawerRect.width - drawerBeforeResizeRect.width) <= 2
        && Math.abs(resetDrawerRect.height - drawerBeforeResizeRect.height) <= 2
        && localStorage.getItem(SFTP_TASK_CENTER_SIZE_STORAGE_KEY)===null);

      const deleteFixture = {id:'delete-record-job',status:'failed',type:'upload',label:'待删除失败任务',connection_id:Number(connection.id),connection_name:'iMac'};
      updateSftpTaskCenter([...refreshedJobFixtures, deleteFixture]);
      const deleteButton = [...list.querySelectorAll('.sftp-job')].find(row=>row.textContent.includes('待删除失败任务'))?.querySelector('.danger');
      let deleteRequestCount = 0;
      let releaseDeleteRequest;
      confirmModal = async () => true;
      api = (pathname, options={}) => {
        if (pathname === '/api/sftp/jobs/delete-record-job' && options.method === 'DELETE') {
          deleteRequestCount += 1;
          return new Promise(resolve => { releaseDeleteRequest = resolve; });
        }
        return Promise.resolve(pathname === '/api/sftp/jobs' ? refreshedJobFixtures : []);
      };
      const firstDelete = deleteSftpJob('delete-record-job', deleteButton);
      const secondDelete = deleteSftpJob('delete-record-job', deleteButton);
      await new Promise(resolve=>setTimeout(resolve,0));
      const deleteDuplicateBlocked = Boolean(deleteButton?.disabled && deleteRequestCount === 1);
      releaseDeleteRequest?.({ok:true});
      await Promise.all([firstDelete, secondDelete]);
      const deleteKeepsDrawerOpen = Boolean(!drawer.hidden && button?.getAttribute('aria-expanded') === 'true');
      api = async pathname => pathname === '/api/sftp/jobs' ? jobFixtures : [];
      confirmModal = previousConfirmModal;
      updateSftpTaskCenter(jobFixtures);
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
      const historyCounts = document.querySelector('#sftpTaskCenterCurrentCount')?.textContent === '1'
        && document.querySelector('#sftpTaskCenterFailedCount')?.textContent === '1'
        && document.querySelector('#sftpTaskCenterHistoryCount')?.textContent === '4';
      const historyFooter = document.querySelector('#sftpTaskCenterFooter');
      const desktopSavedRow = [...list.querySelectorAll('.sftp-job')].find(row=>row.textContent.includes('桌面已保存下载'));
      const browserSavedRow = [...list.querySelectorAll('.sftp-job')].find(row=>row.textContent.includes('browser.txt'));
      const desktopOpenFileLabel=tr('tasks:actions.open_file');
      const desktopOpenDirectoryLabel=tr('tasks:actions.open_directory');
      const deleteTaskLabel=tr('tasks:actions.delete');
      const historyActions = Boolean(historyFooter && !historyFooter.hidden
        && historyText.includes('桌面已保存下载')
        && desktopSavedRow?.querySelector('button[aria-label="'+CSS.escape(desktopOpenFileLabel)+'"]')
        && desktopSavedRow?.querySelector('button[aria-label="'+CSS.escape(desktopOpenDirectoryLabel)+'"]')
        && desktopSavedRow?.querySelector('button[aria-label="'+CSS.escape(deleteTaskLabel)+'"]')
        && !desktopSavedRow?.textContent.includes('保存到本机')
        && browserSavedRow?.textContent.includes(tr('tasks:actions.download_again')));
      const historyActionDiagnostics={footerHidden:historyFooter?.hidden,desktopLabels:[...(desktopSavedRow?.querySelectorAll('button')||[])].map(button=>({title:button.title,ariaLabel:button.getAttribute('aria-label'),text:button.textContent.trim()})),historyText};
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
      const nextFloatingJob = {...jobFixtures[0],id:'next-running-job',label:'新后台任务'};
      updateSftpTaskCenter([...jobFixtures,nextFloatingJob]);
      const floatingNewTaskReopens = Boolean(floatingCard && !floatingCard.hidden && floatingCard.textContent.includes('2 个后台任务'));
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
        && muteConfirmation?.[0]?.includes('通知设置'));
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
      const previousFloatingTransition = floatingCard?.style.transition || '';
      if (floatingCard) floatingCard.style.transition = 'none';
      dismissToast();
      for (let attempt=0;attempt<20&&document.querySelector('#toast .toast');attempt+=1) await new Promise(resolve => setTimeout(resolve, 25));
      const toastIconResults = [];
      const toastTitles = ['SFTP success 图标测试','SFTP info 图标测试','SFTP error 图标测试'];
      const expectedToastTitles = toastTitles.map(title=>localizedTermaUiPhrase(title));
      for (const [index,type] of ['success','info','error'].entries()) {
        notify(toastTitles[index] + '\\n图标应与提示文字对齐', type);
        const card = document.querySelector('#toast .toast:last-child');
        const holder = card?.querySelector('.toast-icon')?.getBoundingClientRect();
        const glyph = card?.querySelector('.toast-icon svg')?.getBoundingClientRect();
        toastIconResults.push(Boolean(holder && glyph && holder.width && glyph.width
          && Math.abs((holder.left + holder.width / 2) - (glyph.left + glyph.width / 2)) <= 1
          && Math.abs((holder.top + holder.height / 2) - (glyph.top + glyph.height / 2)) <= 1));
      }
      const toastIconsAligned = toastIconResults.every(Boolean);
      await new Promise(resolve => setTimeout(resolve, 320));
      const toastStack = document.querySelector('#toast');
      const stackedToasts = [...(toastStack?.querySelectorAll('.toast') || [])];
      const stackedToastTitles=stackedToasts.map(card => card.querySelector('strong')?.textContent || '');
      const toastOrderPreserved = stackedToasts.length === 3
        && stackedToastTitles.join('|') === expectedToastTitles.join('|');
      const toastStackedDown = stackedToasts.length === 3 && stackedToasts.slice(1).every((card,index) => {
        const previous = stackedToasts[index].getBoundingClientRect();
        const current = card.getBoundingClientRect();
        return current.top >= previous.bottom + 5;
      });
      syncToastStackLayout();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const toastStackRect = toastStack?.getBoundingClientRect();
      const floatingWithToastsRect = floatingCard?.getBoundingClientRect();
      const toastAvoidsFloatingTask = Boolean(floatingCard?.hidden
        || (toastStackRect && floatingWithToastsRect && floatingWithToastsRect.top >= toastStackRect.bottom + 6));
      if (floatingCard) floatingCard.style.transition = previousFloatingTransition;
      const firstToast = stackedToasts[0];
      const secondToastTopBefore = stackedToasts[1]?.getBoundingClientRect().top;
      dismissToast(firstToast);
      const toastExitAnimated = prefersReducedToastMotion() || Boolean(firstToast?.getAnimations?.().length);
      await new Promise(resolve => setTimeout(resolve, 220));
      const firstRemainingToast = toastStack?.querySelector('.toast');
      const toastReflowAnimated = prefersReducedToastMotion() || Boolean(firstRemainingToast?.getAnimations?.().some(animation => animation.playState === 'running'));
      await new Promise(resolve => setTimeout(resolve, 320));
      const toastMovedUp = Boolean(firstRemainingToast
        && Number.isFinite(secondToastTopBefore)
        && firstRemainingToast.getBoundingClientRect().top < secondToastTopBefore - 4);
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
        floatingResumeAction,
        floatingProgress,
        floatingOpensTaskCenter,
        floatingCloseHidesCurrent,
        floatingNewTaskReopens,
        floatingMutePersists,
        floatingSettingRestores,
         drawerOpened,
         drawerDefaultCompact,
         currentOnly,
         currentActions,
         failedOnly,
         failedActions,
         failedClearAvailable,
         currentProgress,
         drawerResizable,
         drawerResizeAdaptive,
         drawerResizePersists,
         drawerResizeReset,
         deleteDuplicateBlocked,
         deleteKeepsDrawerOpen,
        taskLogInitialOpen,
        taskLogInitialBottom,
        taskLogRefreshKeepsOpen,
        taskLogRefreshShowsLatest,
        taskLogRefreshFollowsBottom,
        drawerFitsViewport,
        historyOnly,
        historyCounts,
        historyActions,
        historyActionDiagnostics,
        outsideClickCloses,
        escapeCloses,
        runningStatusVisible,
        nativeDragTaskStopHidden,
        itemProgress,
        staleJobResponseIgnored,
        toastIconsAligned,
        toastOrderPreserved,
        stackedToastTitles,
        toastStackedDown,
        toastAvoidsFloatingTask,
        toastExitAnimated,
        toastReflowAnimated,
        toastMovedUp
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
      if (previousTaskCenterSize === null) localStorage.removeItem(SFTP_TASK_CENTER_SIZE_STORAGE_KEY);
      else localStorage.setItem(SFTP_TASK_CENTER_SIZE_STORAGE_KEY, previousTaskCenterSize);
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
        if(pathname==='/api/sftp/download-settings')return deliveryMode==='desktop'?{delivery_mode:'desktop',effective_directory:'C:\\Temp\\TermaFixture\\Downloads'}:{delivery_mode:'browser'};
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
      const downloadChecks=[...view.querySelectorAll('.sftp-check')];
      downloadChecks[0].checked=true;
      downloadChecks[1].checked=true;
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
      desktopPath:noticeMessages.some(message=>message.includes('C:\\Temp\\TermaFixture\\Downloads')),
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
    const lightFixture='x'.repeat(1024*1024+37);
    const lightEditorPromise=sftpTextModal('/tmp/large.log',lightFixture,lightFixture.length,2*1024*1024,'utf8','auto',{editorKind:'light',lineCount:1});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const lightTextarea=document.querySelector('.sftp-light-editor-shell textarea');
    const lightPager=document.querySelector('.sftp-light-editor-pager');
    const lightPageInput=lightPager?.querySelector('input');
    const lightNextButton=lightPager?.querySelectorAll('button')?.[1];
    textEncodingUi.lightPaged=Boolean(lightTextarea
      && lightTextarea.value.length<=256*1024
      && Number(lightPageInput?.max||0)>=5
      && document.querySelector('#sftpEditorLanguage')?.disabled
      && document.querySelector('#sftpTextDiff')?.disabled);
    lightNextButton?.click();
    textEncodingUi.lightNextPage=Boolean(lightTextarea?.value.length<=256*1024 && lightPageInput?.value==='2');
    document.querySelector('#sftpTextClose')?.click();
    await lightEditorPromise;
    const jsonEditorPromise=sftpTextModal('/tmp/config.json','{"name":"Terma","items":[1,2]}',36,512*1024,'utf8','auto');
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
        && jsonEditor.getValue().includes('\\n  "name": "Terma"')
        && jsonEditor.getValue().includes('\\n  "items": [');
      jsonLanguageSelect.value='markdown';
      jsonLanguageSelect.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(resolve=>setTimeout(resolve,20));
      textEncodingUi.jsonHiddenAfterLanguageChange=Boolean(formatButton?.hidden)
        && getComputedStyle(formatButton).display==='none';
    }
    document.querySelector('#sftpTextSave')?.click();
    await jsonEditorPromise;
    const pagerLayoutFixture = document.createElement('div');
    pagerLayoutFixture.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;height:360px;display:flex;';
    pagerLayoutFixture.innerHTML = '<div class="sftp-pager-layout-probe" style="container-type:inline-size;container-name:sftp-view;display:flex;flex:1;min-height:0;flex-direction:column;"><div class="sftp-shell" style="height:100%;min-height:0;flex:1 1 auto;"><div class="sftp-top" style="position:static;min-height:48px;margin:0;padding:0;"></div><div class="sftp-list"><div class="sftp-head"></div><div class="sftp-row"></div><div class="sftp-pager-dock"><div class="pager sftp-pager"><button>previous</button><span class="pager-count"><span class="sftp-scroll-cue" title="more below">'+icon('chevron-down')+'</span>page 1/1 · 1-3 / 3 · <select><option>50 items</option></select></span><button>next</button></div></div></div></div></div>';
    document.body.appendChild(pagerLayoutFixture);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const pagerProbe = pagerLayoutFixture.querySelector('.sftp-pager');
    const pagerProbeDock = pagerLayoutFixture.querySelector('.sftp-pager-dock');
    const pagerProbeList = pagerLayoutFixture.querySelector('.sftp-list');
    const pagerProbeShell = pagerLayoutFixture.querySelector('.sftp-shell');
    const pagerProbeCount = pagerProbe?.querySelector('.pager-count');
    const pagerProbeButtons = [...(pagerProbe?.querySelectorAll('button') || [])];
    const desktopPagerRects = [pagerProbeButtons[0], pagerProbeCount, pagerProbeButtons[1]].map(node=>node?.getBoundingClientRect());
    const desktopPagerCenters = desktopPagerRects.map(rect=>rect ? rect.top + rect.height / 2 : Number.NaN);
    const desktopPagerSingleRow = desktopPagerCenters.every(Number.isFinite)
      && Math.max(...desktopPagerCenters) - Math.min(...desktopPagerCenters) <= 1;
    const pagerBottomGap = (pagerProbeDock?.getBoundingClientRect().bottom || 0) - (pagerProbe?.getBoundingClientRect().bottom || 0);
    const pagerDockScrollbarGap = (pagerProbeList?.getBoundingClientRect().bottom || 0) - (pagerProbeDock?.getBoundingClientRect().bottom || 0);
    const pagerFloatsAtWorkspaceBottom = Math.abs((pagerProbeList?.getBoundingClientRect().bottom || 0) - (pagerProbeShell?.getBoundingClientRect().bottom || 0)) <= 1
      && pagerDockScrollbarGap >= 0
      && pagerDockScrollbarGap <= 18
      && pagerBottomGap >= 7
      && pagerBottomGap <= 12;
    const pagerStyle = getComputedStyle(pagerProbe);
    const pagerDockStyle = getComputedStyle(pagerProbeDock);
    const pagerOpaqueAndElevated = !['transparent','rgba(0, 0, 0, 0)'].includes(pagerStyle.backgroundColor)
      && pagerStyle.boxShadow !== 'none'
      && parseFloat(pagerStyle.borderRadius) >= 6;
    const pagerDockSealsBottom = !['transparent','rgba(0, 0, 0, 0)'].includes(pagerDockStyle.backgroundColor)
      && pagerDockStyle.boxShadow !== 'none'
      && pagerDockScrollbarGap >= 0
      && pagerDockScrollbarGap <= 18;
    for (let index=0; index<16; index+=1) {
      const row = document.createElement('div');
      row.className = 'sftp-row';
      pagerProbeList.insertBefore(row, pagerProbeDock);
    }
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    syncSftpListScrollCue(pagerProbeList);
    const pagerScrollCue = pagerProbe?.querySelector('.sftp-scroll-cue');
    const scrollCueVisibleAboveContent = getComputedStyle(pagerScrollCue).display === 'grid';
    const pagerViewportBottom = pagerProbeList.getBoundingClientRect().bottom;
    const pagerBottomBeforeScroll = pagerProbeDock?.getBoundingClientRect().bottom || 0;
    pagerProbeList.scrollTop = 120;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    syncSftpListScrollCue(pagerProbeList);
    const pagerBottomAfterScroll = pagerProbeDock?.getBoundingClientRect().bottom || 0;
    const pagerBottomGapBeforeScroll = pagerViewportBottom - pagerBottomBeforeScroll;
    const pagerBottomGapAfterScroll = pagerViewportBottom - pagerBottomAfterScroll;
    const pagerPinnedToViewport = getComputedStyle(pagerProbeDock).position === 'sticky'
      && pagerBottomGapBeforeScroll >= 0
      && pagerBottomGapBeforeScroll <= 18
      && pagerBottomGapAfterScroll >= 0
      && pagerBottomGapAfterScroll <= 18
      && Math.abs(pagerBottomGapBeforeScroll - pagerBottomGapAfterScroll) <= 1;
    pagerProbeList.scrollTop = pagerProbeList.scrollHeight;
    syncSftpListScrollCue(pagerProbeList);
    const scrollCueHidesAtEnd = getComputedStyle(pagerScrollCue).display === 'none';
    const pagerProbeContainer = pagerLayoutFixture.querySelector('.sftp-pager-layout-probe');
    pagerProbeContainer.style.width = '440px';
    pagerProbeContainer.style.flex = '0 0 440px';
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const narrowPagerCountRect = pagerProbeCount?.getBoundingClientRect();
    const narrowPagerButtonRects = pagerProbeButtons.map(node=>node?.getBoundingClientRect());
    const narrowPagerWraps = Boolean(narrowPagerCountRect
      && narrowPagerButtonRects.every(Boolean)
      && narrowPagerCountRect.bottom <= narrowPagerButtonRects[0].top + 1
      && Math.abs(narrowPagerButtonRects[0].top - narrowPagerButtonRects[1].top) <= 1);
    pagerLayoutFixture.remove();
    const syncList = view.querySelector('#sftpList');
    const syncIndicator = syncList?.querySelector('.sftp-refresh-indicator');
    if (syncList) {
      syncList.classList.add('is-refreshing');
      syncList.scrollTop = 0;
    }
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const syncTopBefore = syncIndicator?.getBoundingClientRect().top;
    if (syncList) syncList.scrollTop = 120;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const syncTopAfter = syncIndicator?.getBoundingClientRect().top;
    const syncIndicatorFollowsScroll = Boolean(syncIndicator
      && getComputedStyle(syncIndicator).position === 'absolute'
      && getComputedStyle(syncIndicator.parentElement).position === 'sticky'
      && getComputedStyle(syncIndicator).visibility === 'visible'
      && Number.isFinite(syncTopBefore)
      && Math.abs(syncTopAfter - syncTopBefore) <= 1);
    syncList?.classList.remove('is-refreshing');
    const diffRuntimeLoaded = typeof window.Diff?.diffLines === 'function';
    const diffFixture = document.createElement('div');
    diffFixture.className = 'diff-preview';
    diffFixture.innerHTML = sftpDiffViewerHtml('first\\nold value\\nlast\\n', 'first\\nnew value\\nlast\\n', {oldLabel:'远端旧文件',newLabel:'外部新文件'});
    document.body.appendChild(diffFixture);
    const diffSideBySide = diffFixture.querySelectorAll('.sftp-diff-columns strong').length === 2
      && Boolean(diffFixture.querySelector('.sftp-diff-cell.removed'))
      && Boolean(diffFixture.querySelector('.sftp-diff-cell.added'));
    diffFixture.remove();
    const previousEditorLayout = localStorage.getItem(SFTP_EDITOR_LAYOUT_STORAGE_KEY);
    let loadedVersionPath = '';
    const historyEditorPromise = sftpTextModal('/tmp/history.txt', 'new value\\n', 10, 1024, 'utf8', 'auto', {
      versions:[
        {path:'/tmp/history.txt.bak-2',size:10,changed_at:2000},
        {path:'/tmp/history.txt.bak-1',size:9,changed_at:1000}
      ],
      loadVersion:async version => {
        loadedVersionPath = version.path;
        return {content:'old value\\n'};
      }
    });
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const historySelect = document.querySelector('#sftpDiffHistory');
    const historyOptions = [...(historySelect?.options || [])];
    document.querySelector('#sftpTextDiff')?.click();
    await new Promise(resolve=>setTimeout(resolve,40));
    const editorCard = document.querySelector('.sftp-editor-modal');
    const editorWorkspace = document.querySelector('#sftpEditorWorkspace');
    const editorSplitter = document.querySelector('#sftpEditorSplit');
    const editorDiff = document.querySelector('#sftpDiffPreview');
    const workspaceRect = editorWorkspace?.getBoundingClientRect();
    if (editorSplitter && workspaceRect) {
      editorSplitter.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerId:31,clientY:workspaceRect.top+workspaceRect.height*.58}));
      editorSplitter.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,button:0,pointerId:31,clientY:workspaceRect.top+workspaceRect.height*.66}));
      editorSplitter.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,button:0,pointerId:31,clientY:workspaceRect.top+workspaceRect.height*.66}));
    }
    await new Promise(resolve=>setTimeout(resolve,20));
    const editorDiffRect = editorDiff?.getBoundingClientRect();
    const diffHeaderRect = editorDiff?.querySelector('.sftp-diff-columns')?.getBoundingClientRect();
    const diffRowRect = editorDiff?.querySelector('.sftp-diff-row')?.getBoundingClientRect();
    const storedEditorLayout = readSftpEditorLayout();
    const diffEditorUi = Boolean(editorCard
      && getComputedStyle(editorCard).resize === 'both'
      && historyOptions.length === 2
      && historySelect?.value === '0'
      && !historyOptions.some(option=>option.textContent.includes('本次打开内容'))
      && loadedVersionPath === '/tmp/history.txt.bak-2'
      && editorWorkspace?.classList.contains('showing-diff')
      && editorSplitter && !editorSplitter.hidden
      && editorDiff && !editorDiff.hidden
      && editorDiff.querySelector('.sftp-diff-columns')?.textContent.includes('当前编辑内容')
      && diffHeaderRect && editorDiffRect && diffHeaderRect.top >= editorDiffRect.top - 1
      && diffRowRect && diffRowRect.height <= 34
      && storedEditorLayout.split >= 64 && storedEditorLayout.split <= 68);
    document.querySelector('#sftpTextClose')?.click();
    await historyEditorPromise;
    const noHistoryEditorPromise = sftpTextModal('/tmp/no-history.txt', 'same\\n', 5, 1024, 'utf8', 'auto', {versions:[]});
    await new Promise(resolve=>requestAnimationFrame(resolve));
    const noHistoryUi = Boolean(document.querySelector('#sftpTextDiff')?.disabled
      && document.querySelector('#sftpDiffHistory')?.disabled
      && document.querySelector('#sftpDiffHistory')?.textContent.includes('没有可比较的备份'));
    document.querySelector('#sftpTextClose')?.click();
    await noHistoryEditorPromise;
    if (previousEditorLayout === null) localStorage.removeItem(SFTP_EDITOR_LAYOUT_STORAGE_KEY);
    else localStorage.setItem(SFTP_EDITOR_LAYOUT_STORAGE_KEY, previousEditorLayout);
    const comparisonPromise = openSftpExternalComparison({status:'conflict',remote_path:'/tmp/example.txt'}, {
      remote_path:'/tmp/example.txt',old_label:'远端当前版本',new_label:'外部编辑内容',old_text:'old\\n',new_text:'new\\n',old_size:4,new_size:4,remote_changed_at:Date.now()-1000,local_changed_at:Date.now()
    });
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const comparisonCard = document.querySelector('.sftp-comparison-modal');
    const comparisonRect = comparisonCard?.getBoundingClientRect();
    const externalComparisonUi = Boolean(comparisonCard
      && comparisonCard.querySelectorAll('.sftp-comparison-meta span').length === 2
      && comparisonCard.querySelectorAll('.sftp-comparison-actions button').length === 3
      && comparisonRect.left >= 0 && comparisonRect.right <= innerWidth + 1
      && comparisonRect.top >= 0 && comparisonRect.bottom <= innerHeight + 1);
    comparisonCard?.querySelector('[data-sftp-compare-choice="cancel"]')?.click();
    const comparisonChoice = await comparisonPromise;
    const diffComparisonUi = diffRuntimeLoaded && diffSideBySide && diffEditorUi && noHistoryUi && externalComparisonUi && comparisonChoice === 'cancel';
    const result = {
      folderOpened: actions[0]?.kind === 'dir' && actions[0]?.path === '/fixture/folder',
      fileOpened: actions[1]?.kind === 'file' && actions[1]?.path === '/fixture/' + specialName,
      connectionSessionUi,
      nativeDragUi,
      directoryActionsUi,
      globalSettingsUi,
      directoryCacheBehavior,
      searchKeyboardUi,
      syncIndicatorFollowsScroll,
      diffComparisonUi,
      columnLayoutUi,
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
      multiNameAddsSelection,
      multiNameCancelsSelection,
      singleNameReplacesSelection,
      specialSelectionExact,
      selectedRows,
      dragSelectionSynchronized,
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
      compactHorizontalScroll,
      compactScrollMetrics:{clientWidth:sftpList.clientWidth,scrollWidth:sftpList.scrollWidth},
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
      narrowMetaDiagnostics:{found:Boolean(narrowMeta),display:narrowMetaDisplay,text:narrowMeta?.textContent||'',listClass:sftpList.className},
      narrowAccessHidden,
      narrowHeaderNameVisible,
      narrowHeaderSummaryVisible,
      narrowCompactActions,
      completedMutationDetected,
      textEncodingUi,
      jobUi,
      downloadNoticeUi,
      desktopPagerSingleRow,
      pagerFloatsAtWorkspaceBottom,
      pagerOpaqueAndElevated,
      pagerDockSealsBottom,
      pagerPinnedToViewport,
      pagerLayoutMetrics:{
        position:pagerProbeDock?getComputedStyle(pagerProbeDock).position:'',
        listBottom:pagerProbeList?.getBoundingClientRect().bottom||0,
        shellBottom:pagerProbeShell?.getBoundingClientRect().bottom||0,
        dockBottom:pagerProbeDock?.getBoundingClientRect().bottom||0,
        pagerBottom:pagerProbe?.getBoundingClientRect().bottom||0,
        pagerBottomGap,
        beforeScroll:pagerBottomGapBeforeScroll,
        afterScroll:pagerBottomGapAfterScroll,
        background:pagerDockStyle.backgroundColor,
        shadow:pagerDockStyle.boxShadow
      },
      scrollCueVisibleAboveContent,
      scrollCueHidesAtEnd,
      narrowPagerWraps,
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
      return {error:error?.stack || error?.message || String(error), errorLine:typeof error?.lineNumber === 'number' ? error.lineNumber : null};
    }
  })()`);
  console.log("[ui-smoke] remote admin authorization");
  const remoteAdminOriginalContentSize = window.getContentSize();
  let remoteAdminUi = {desktop:{error:"not run"},mobile:{error:"not run"}};
  await window.webContents.executeJavaScript(`(() => {
    window.__runRemoteAdminModalSmoke = async mode => {
      const previousApi=api;
      const connection=connections[0];
      const previousHasPassword=connection?.has_password;
      let pending=null;
      const modal=document.getElementById('modal');
      const open=async scope => {
        pending=requestRemoteAdminAuthorization(connection.id,scope);
        await new Promise(resolve=>setTimeout(resolve,0));
        return {
          card:modal.querySelector('.remote-admin-modal'),
          form:modal.querySelector('.remote-admin-modal'),
          promise:pending
        };
      };
      const clearPending=async () => {
        const cancel=modal.querySelector('[data-admin-cancel]');
        if (cancel) cancel.click();
        if (pending) await Promise.race([pending,new Promise(resolve=>setTimeout(()=>resolve(null),100))]);
        pending=null;
      };
      try {
        if (!connection) return {error:'SSH fixture missing'};
        connection.has_password=true;
        let lastAdminGrantRequest=null;
        api=async (path,options) => {
          if (String(path)==='/api/identity-files') return [{path:'C:/Users/tester/.ssh/id_ui_smoke',label:'UI smoke private key with a deliberately long label',permission_ok:true}];
          if (String(path)==='/api/admin-grants') {
            lastAdminGrantRequest=JSON.parse(String(options?.body || '{}'));
            const reusePolicy=String(lastAdminGrantRequest?.admin_auth?.reuse_policy || 'once');
            return {ok:true,admin_grant:{id:'ui-smoke-grant-'+Date.now(),reuse_policy:reusePolicy,expires_at:reusePolicy==='session'?0:Date.now()+600000}};
          }
          return previousApi(path,options);
        };
        const first=await open(mode==='mobile'?'移动端临时管理员授权布局检查':'桌面端临时管理员授权检查');
        const card=first.card;
        if (!card) return {error:'remote admin modal missing'};
        const cardRect=card.getBoundingClientRect();
        const title=card.querySelector('.modal-title-row');
        const actions=card.querySelector('.actions');
        const grid=card.querySelector('.remote-admin-grid');
        const visibleControls=[...card.querySelectorAll('input,select,button')].filter(control=>!control.closest('[hidden]')&&getComputedStyle(control).display!=='none');
        const controlsFit=visibleControls.every(control=>{
          const rect=control.getBoundingClientRect();
          return rect.left>=cardRect.left-1&&rect.right<=cardRect.right+1&&control.scrollWidth<=control.clientWidth+1;
        });
        const viewportFit=cardRect.left>=-1&&cardRect.right<=innerWidth+1&&cardRect.top>=-1&&cardRect.bottom<=innerHeight+1;
        const noHorizontalOverflow=card.scrollWidth<=card.clientWidth+1;
        if (mode==='mobile') {
          const password=card.querySelector('#remoteAdminPassword');
          password.value='mobile-secret';
          card.scrollTop=card.scrollHeight;
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const scrolledCardRect=card.getBoundingClientRect();
          const titleRect=title.getBoundingClientRect();
          const actionsRect=actions.getBoundingClientRect();
          const buttons=[...actions.querySelectorAll('button')];
          const singleColumn=getComputedStyle(grid).gridTemplateColumns.trim().split(/\\s+/).length===1;
          const stickyRegions=titleRect.top>=scrolledCardRect.top-1&&titleRect.bottom<=scrolledCardRect.bottom+1&&actionsRect.top>=scrolledCardRect.top-1&&actionsRect.bottom<=scrolledCardRect.bottom+1;
          const actionButtonsFit=buttons.length===2&&buttons.every(button=>{
            const rect=button.getBoundingClientRect();
            return rect.left>=actionsRect.left-1&&rect.right<=actionsRect.right+1&&button.scrollWidth<=button.clientWidth+1;
          });
          card.querySelector('[data-admin-cancel]').click();
          const result=await first.promise;
          pending=null;
          return {viewportFit,noHorizontalOverflow,controlsFit,singleColumn,stickyRegions,actionButtonsFit,cancelled:result===null,secretCleared:password.value===''&&!modal.innerHTML&&modal.hidden};
        }

        const method=card.querySelector('#remoteAdminMethod');
        const passwordBox=card.querySelector('#remoteAdminPasswordBox');
        const keyBox=card.querySelector('#remoteAdminKeyBox');
        const sudoMode=card.querySelector('#remoteAdminSudoMode');
        const sudoBox=card.querySelector('#remoteAdminSudoPasswordBox');
        const reusePolicy=card.querySelector('#remoteAdminReusePolicy');
        const reusePolicyOptions=[...reusePolicy.options].map(option=>option.value);
        const sameOption=sudoMode.querySelector('option[value="same"]');
        const passwordInputs=[...card.querySelectorAll('input[data-password-visibility-input]')];
        const passwordToggleCount=passwordInputs.length===3&&passwordInputs.every(input=>input.closest('.password-input-control')?.querySelectorAll('.password-visibility-toggle').length===1);
        const eyeInput=card.querySelector('#remoteAdminPassword');
        const eyeButton=eyeInput?.closest('.password-input-control')?.querySelector('.password-visibility-toggle');
        eyeInput.value='visibility-secret';
        eyeInput.focus();
        eyeInput.setSelectionRange(2,8);
        eyeButton?.click();
        const passwordShown=eyeInput.type==='text'&&eyeInput.value==='visibility-secret'&&eyeButton?.getAttribute('aria-label')==='隐藏密码'&&eyeButton?.getAttribute('aria-pressed')==='true'&&eyeButton?.querySelector('.lucide-eye-off');
        eyeButton?.click();
        const passwordHidden=eyeInput.type==='password'&&eyeInput.value==='visibility-secret'&&eyeButton?.getAttribute('aria-label')==='显示密码'&&eyeButton?.getAttribute('aria-pressed')==='false'&&eyeButton?.querySelector('.lucide-eye');
        const passwordEyeToggle=Boolean(passwordToggleCount&&passwordShown&&passwordHidden);
        const initialPasswordMode=method.value==='password'&&!passwordBox.hidden&&keyBox.hidden&&sudoMode.value==='none'&&sudoBox.hidden&&!sameOption.disabled;
        sudoMode.value='same';
        sudoMode.dispatchEvent(new Event('change',{bubbles:true}));
        const sameSudoMode=sudoMode.value==='same'&&sudoBox.hidden;
        method.value='key';
        method.dispatchEvent(new Event('change',{bubbles:true}));
        const keyMode=passwordBox.hidden&&!keyBox.hidden&&sameOption.disabled&&sudoMode.value==='none'&&sudoBox.hidden;
        sudoMode.value='separate';
        sudoMode.dispatchEvent(new Event('change',{bubbles:true}));
        const passwordSeparateSudo=sudoMode.value==='separate'&&!sudoBox.hidden;
        sudoMode.value='none';
        sudoMode.dispatchEvent(new Event('change',{bubbles:true}));
        const sudoNone=sudoBox.hidden;
        method.value='agent';
        method.dispatchEvent(new Event('change',{bubbles:true}));
        const agentMode=passwordBox.hidden&&keyBox.hidden&&sameOption.disabled&&sudoMode.value==='none'&&sudoBox.hidden;
        method.value='password';
        method.dispatchEvent(new Event('change',{bubbles:true}));
        sudoMode.value='separate';
        sudoMode.dispatchEvent(new Event('change',{bubbles:true}));
        const sshPassword=card.querySelector('#remoteAdminPassword');
        const sudoPassword=card.querySelector('#remoteAdminSudoPassword');
        sshPassword.value='ssh-secret';
        sudoPassword.value='sudo-secret';
        card.requestSubmit();
        const submitted=await first.promise;
        pending=null;
        const separatePayload=Boolean(submitted?.admin_grant_id&&lastAdminGrantRequest?.admin_auth?.auth_method==='password'&&lastAdminGrantRequest?.admin_auth?.ssh_password==='ssh-secret'&&lastAdminGrantRequest?.admin_auth?.sudo_password==='sudo-secret'&&lastAdminGrantRequest?.admin_auth?.reuse_policy==='once');
        const submitClearsSecrets=sshPassword.value===''&&sudoPassword.value===''&&!modal.innerHTML&&modal.hidden;

        const cancelCheck=await open('取消清理检查');
        const cancelPassword=modal.querySelector('#remoteAdminPassword');
        const cancelPassphrase=modal.querySelector('#remoteAdminPassphrase');
        const cancelSudo=modal.querySelector('#remoteAdminSudoPassword');
        cancelPassword.value='cancel-ssh-secret';
        cancelPassphrase.value='cancel-key-secret';
        cancelSudo.value='cancel-sudo-secret';
        modal.querySelector('[data-admin-cancel]').click();
        const cancelled=await cancelCheck.promise;
        pending=null;
        const cancelClearsSecrets=cancelled===null&&[cancelPassword,cancelPassphrase,cancelSudo].every(input=>input.value==='')&&!modal.innerHTML&&modal.hidden;

        const backdropCheck=await open('遮罩关闭清理检查');
        const backdropPassword=modal.querySelector('#remoteAdminPassword');
        const backdropPassphrase=modal.querySelector('#remoteAdminPassphrase');
        const backdropSudo=modal.querySelector('#remoteAdminSudoPassword');
        backdropPassword.value='backdrop-ssh-secret';
        backdropPassphrase.value='backdrop-key-secret';
        backdropSudo.value='backdrop-sudo-secret';
        let backdropSettled=false;
        backdropCheck.promise.then(()=>{backdropSettled=true;});
        modal.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        await new Promise(resolve=>setTimeout(resolve,0));
        const backdropIgnored=!backdropSettled&&!modal.hidden&&Boolean(modal.querySelector('.remote-admin-modal'));
        const backdropPreservesSecrets=[backdropPassword,backdropPassphrase,backdropSudo].every(input=>input.value.startsWith('backdrop-'));
        modal.querySelector('[data-admin-cancel]').click();
        const backdropResult=await backdropCheck.promise;
        pending=null;
        const backdropCancelClearsSecrets=backdropResult===null&&[backdropPassword,backdropPassphrase,backdropSudo].every(input=>input.value==='')&&!modal.innerHTML&&modal.hidden;

        const escapeCheck=await open('键盘关闭清理检查');
        const escapePassword=modal.querySelector('#remoteAdminPassword');
        escapePassword.value='escape-secret';
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
        const escapeResult=await escapeCheck.promise;
        pending=null;
        const escapeClearsSecrets=escapeResult===null&&escapePassword.value===''&&!modal.innerHTML&&modal.hidden;
        return {viewportFit,noHorizontalOverflow,controlsFit,passwordEyeToggle,initialPasswordMode,sameSudoMode,passwordSeparateSudo,keyMode,sudoNone,agentMode,reusePolicyOptions:reusePolicyOptions.join(','),separatePayload,submitClearsSecrets,cancelClearsSecrets,backdropIgnored,backdropPreservesSecrets,backdropCancelClearsSecrets,escapeClearsSecrets};
      } catch (error) {
        return {error:error?.stack||error?.message||String(error)};
      } finally {
        await clearPending();
        api=previousApi;
        if (connection) connection.has_password=previousHasPassword;
      }
    };
  })()`);
  try {
    window.setContentSize(900,640);
    await new Promise(resolve=>setTimeout(resolve,100));
    remoteAdminUi.desktop=await window.webContents.executeJavaScript("window.__runRemoteAdminModalSmoke('desktop')");
    window.setContentSize(390,640);
    await new Promise(resolve=>setTimeout(resolve,100));
    remoteAdminUi.mobile=await window.webContents.executeJavaScript("window.__runRemoteAdminModalSmoke('mobile')");
  } finally {
    window.setContentSize(...remoteAdminOriginalContentSize);
    await new Promise(resolve=>setTimeout(resolve,100));
    await window.webContents.executeJavaScript("delete window.__runRemoteAdminModalSmoke");
  }
  console.log("[ui-smoke] Linux desktop toolbar geometry");
  let linuxDesktopToolbarUi = {desktop:{error:"not run"},narrow:{error:"not run"}};
  await window.webContents.executeJavaScript(`(() => {
    window.__runLinuxDesktopToolbarSmoke = () => {
      const view=document.getElementById('view-linux-desktop');
      const previousState=linuxDesktopManagerState;
      const previousHtml=view?.innerHTML||'';
      const previousHidden=Boolean(view?.hidden);
      const fixture=document.createElement('div');
      try {
        if (!view) return {error:'Linux desktop view missing'};
        linuxDesktopManagerState={connectionId:Number(connections?.[0]?.id||1),diagnostics:null,sshX11:null,error:null,loading:true,taskId:'',task:null,logs:[]};
        renderLinuxDesktopManager();
        const rendered=view.querySelector('.linux-desktop-manager-toolbar');
        if (!rendered) return {error:'Linux desktop toolbar missing'};
        fixture.style.cssText='position:fixed;left:16px;top:16px;width:calc(100vw - 32px);visibility:hidden;pointer-events:none;z-index:-1';
        fixture.appendChild(rendered.cloneNode(true));
        document.body.appendChild(fixture);
        const toolbar=fixture.querySelector('.linux-desktop-manager-toolbar');
        const select=toolbar.querySelector('select');
        const button=toolbar.querySelector('button');
        const toolbarRect=toolbar.getBoundingClientRect();
        const selectRect=select.getBoundingClientRect();
        const buttonRect=button.getBoundingClientRect();
        const loadingState=view.querySelector('.remote-probe-loading');
        const columns=getComputedStyle(toolbar).gridTemplateColumns.trim().split(/\\s+/).filter(Boolean);
        const insideToolbar=elementRect => elementRect.left>=toolbarRect.left-1&&elementRect.right<=toolbarRect.right+1;
        return {
          found:Boolean(select&&button),
          viewportWidth:innerWidth,
          columnCount:columns.length,
          sameHeight:Math.abs(selectRect.height-buttonRect.height)<=0.75,
          topAligned:Math.abs(selectRect.top-buttonRect.top)<=0.75,
          bottomAligned:Math.abs(selectRect.bottom-buttonRect.bottom)<=0.75,
          stacked:buttonRect.top>=selectRect.bottom+4,
          fullWidth:Math.abs(selectRect.width-buttonRect.width)<=1,
          loadingVisible:Boolean(loadingState?.textContent.includes('正在探测')&&loadingState.querySelector('svg')&&select.disabled&&button.disabled&&button.textContent.includes('探测中')),
          noOverflow:toolbar.scrollWidth<=toolbar.clientWidth+1&&insideToolbar(selectRect)&&insideToolbar(buttonRect)
        };
      } catch (error) {
        return {error:error?.stack||error?.message||String(error)};
      } finally {
        fixture.remove();
        linuxDesktopManagerState=previousState;
        if (view) {
          view.innerHTML=previousHtml;
          view.hidden=previousHidden;
        }
      }
    };
  })()`);
  const linuxDesktopToolbarOriginalSize=window.getContentSize();
  try {
    window.setContentSize(900,640);
    await new Promise(resolve=>setTimeout(resolve,100));
    linuxDesktopToolbarUi.desktop=await window.webContents.executeJavaScript("window.__runLinuxDesktopToolbarSmoke()");
  } finally {
    window.setContentSize(...linuxDesktopToolbarOriginalSize);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  await window.webContents.executeJavaScript("document.documentElement.dataset.uiSmokeStage='clipboard-and-themes'");
  console.log("[ui-smoke] clipboard and themes");
  const previousClipboard = clipboard.readText();
  window.setAlwaysOnTop(true);
  window.show();
  window.focus();
  window.webContents.focus();
  await new Promise(resolve => setTimeout(resolve, 120));
  const clipboardExpected = `Terma clipboard smoke ${Date.now()}`;
  const clipboardFixture = JSON.stringify(clipboardExpected);
  let clipboardUi = {ok:false,error:"clipboard smoke did not run",attempts:0};
  try {
    for (let attempt=1; attempt<=2; attempt+=1) {
      try {
        clipboardUi = await window.webContents.executeJavaScript(`(async()=>{
          return Promise.race([
            (async()=>{
              try {
                const expected = ${clipboardFixture};
                await writeClipboardText(expected);
                const key='ui-smoke-terminal-image';
                const connection={id:987654,name:'Clipboard smoke',x11_mode:'trusted'};
                const previous={api,sendTerminalData,sendTerminalPasteText,uploadSftpFilesToDirectory,notify,focusTerminalSession};
                const terminalWrites=[];
                const pathWrites=[];
                const uploads=[];
                let directReady=true;
                terminalSessions.set(key,{
                  connected:true,
                  connection,
                  currentDirectoryKnown:true,
                  currentDirectory:'/home/smoke',
                  effectiveX11Mode:'trusted'
                });
                try {
                  api=async(path,options)=>{
                    if (!String(path).includes('/terminal-clipboard/image')) return previous.api(path,options);
                    return directReady ? {ready:true,available:true} : {ready:false,available:false,reason:'xclip'};
                  };
                  sendTerminalData=(_key,value)=>{ terminalWrites.push(value); return true; };
                  sendTerminalPasteText=async(_key,value)=>{ pathWrites.push(value); return true; };
                  uploadSftpFilesToDirectory=async(files,connectionId,directory,options)=>{ uploads.push({files,connectionId,directory,options}); };
                  notify=()=>{};
                  focusTerminalSession=()=>{};
                  const image=new File([Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3,4])],'clipboard.png',{type:'image/png'});
                  const directResult=await handleTerminalClipboardImagePaste(key,connection.id,image);
                  const directCtrlV=terminalWrites.length===1&&terminalWrites[0]==='\\x16';
                  const directSkippedUpload=uploads.length===0&&pathWrites.length===0;
                  directReady=false;
                  const fallbackResult=await handleTerminalClipboardImagePaste(key,connection.id,image);
                  const fallbackPrivate=uploads.length===1&&uploads[0].connectionId===connection.id&&uploads[0].directory==='/tmp'&&uploads[0].options?.private===true;
                  const fallbackPath=pathWrites.length===1&&pathWrites[0].startsWith('/tmp/terma-clipboard-')&&pathWrites[0].endsWith('.png');
                  return {
                    ok:Boolean(directResult&&directCtrlV&&directSkippedUpload&&fallbackResult&&fallbackPrivate&&fallbackPath),
                    directResult,directCtrlV,directSkippedUpload,fallbackResult,fallbackPrivate,fallbackPath
                  };
                } finally {
                  api=previous.api;
                  sendTerminalData=previous.sendTerminalData;
                  sendTerminalPasteText=previous.sendTerminalPasteText;
                  uploadSftpFilesToDirectory=previous.uploadSftpFilesToDirectory;
                  notify=previous.notify;
                  focusTerminalSession=previous.focusTerminalSession;
                  terminalSessions.delete(key);
                }
              } catch (error) {
                return {ok:false,error:error?.stack||error?.message||String(error)};
              }
            })(),
            new Promise(resolve=>setTimeout(()=>resolve({ok:false,error:'clipboard timeout'}),3000))
          ]);
        })()`);
        clipboardUi.attempts=attempt;
        clipboardUi.copied=clipboard.readText()===clipboardExpected;
        clipboardUi.ok=Boolean(clipboardUi.ok&&clipboardUi.copied);
        if (clipboardUi.ok) break;
      } catch (error) {
        clipboardUi={ok:false,error:error?.stack||error?.message||String(error),attempts:attempt,executeFailed:true};
      }
      window.focus();
      window.webContents.focus();
      await new Promise(resolve=>setTimeout(resolve,180));
    }
  } finally {
    clipboard.writeText(previousClipboard);
  }
  if (notificationScreenshotEnabled) {
    window.setContentSize(1180, 760);
    window.show();
    await window.webContents.executeJavaScript(`(() => {
      const connectionId = Number(connections?.[0]?.id || 1);
      updateSftpTaskCenter([{
        id:'notification-screenshot-job',
        status:'running',
        type:'upload',
        phase:'uploading',
        label:'上传 Terma-notification-check.bin',
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
    fs.writeFileSync(path.join(diagnosticsDirectory, "ui-smoke-notifications.png"), notificationImage.toPNG());
    await window.webContents.executeJavaScript("dismissToast(); updateSftpTaskCenter([]); closeSftpTaskCenter()");
  }
  await window.webContents.executeJavaScript("document.documentElement.dataset.uiSmokeStage='productivity-and-visual-regression'");
  const productivityUi = await window.webContents.executeJavaScript(`(async () => {
    ensureTermaActions();
    const panel=ensureQuickPanel();
    panel.hidden=false;
    renderQuickPanel('工作区');
    const quickVisible=!panel.hidden&&Boolean(panel.querySelector('.quick-result'));
    const actionCount=listAppActions({surface:'quick-panel'}).length;
    renderQuickPanel(connections[0]?.name || '');
    const connectionIndex=productivityState.quickItems.findIndex(item=>item.kind==='connection');
    const connectionRow=panel.querySelector('.quick-result[data-index="'+connectionIndex+'"]');
    const connectionActions=connectionRow?.querySelector('.quick-result-actions');
    const connectionRowBounds=connectionRow?.getBoundingClientRect();
    const connectionActionBounds=connectionActions?.getBoundingClientRect();
    const quickConnectionActionsInline=Boolean(connectionActions&&connectionActions.parentElement===connectionRow&&connectionRow.tagName!=='BUTTON'&&Math.abs((connectionRowBounds.top+connectionRowBounds.bottom)-(connectionActionBounds.top+connectionActionBounds.bottom))<2&&connectionActionBounds.right<=connectionRowBounds.right);
    renderQuickPanel('tester@198.51.100.25:2200');
    const quickPanelDirect=productivityState.quickItems[0]?.kind==='quick-ssh'
      &&productivityState.quickItems.some(item=>item.kind==='quick-ssh-new')
      &&panel.querySelector('.quick-result')?.textContent.includes('tester@198.51.100.25:2200');
    const previousWorkspaces=productivityState.workspaces;
    productivityState.workspaces=[...previousWorkspaces,{id:-987654,name:'test',description:'UI smoke workspace',layout:{tabs:[{kind:'terminal'}]}}];
    renderQuickPanel('test');
    const workspaceSearchable=productivityState.quickItems.some(item=>item.kind==='workspace'&&item.title==='test');
    const workspaceIndex=productivityState.quickItems.findIndex(item=>item.kind==='workspace'&&item.title==='test');
    runQuickPanelItem(workspaceIndex);
    const workspacePreviewOpens=!document.getElementById('modal').hidden&&document.getElementById('modal').textContent.includes('打开 test');
    closeModal();
    productivityState.workspaces=previousWorkspaces;
    const quickButton=document.getElementById('quickPanelButton');
    const quickButtonPlacement=quickButton?.parentElement?.id==='workspaceQuickActions';
    const quickButtonLightning=Boolean(quickButton?.querySelector('.lucide-zap'));
    await refreshXServerQuickAction();
    const xServerQuickButton=document.getElementById('xServerQuickButton');
    const xServerQuickIcon=xServerQuickButton?.querySelector('.xserver-x-icon');
    const xServerQuickButtonRect=xServerQuickButton?.getBoundingClientRect();
    const xServerQuickIconRect=xServerQuickIcon?.getBoundingClientRect();
    const xServerQuickUsesX11=Boolean(
      xServerQuickIcon?.querySelector('ellipse')
      && xServerQuickButton.querySelectorAll('.xserver-x-icon path').length===1
      && !xServerQuickButton.querySelector('.lucide-monitor')
      && !xServerQuickButton.textContent.trim()
      && xServerQuickIconRect?.width>=20
      && xServerQuickIconRect?.width<=22
      && xServerQuickIconRect?.height>=20
      && xServerQuickIconRect?.height<=22
      && xServerQuickIconRect.left>=xServerQuickButtonRect.left-1
      && xServerQuickIconRect.right<=xServerQuickButtonRect.right+1
    );
    const originalProductivityApi=api;
    api=async (path,options={}) => String(path)==='/api/xserver'
      ? {available:true,running:true,authorization_required:true,display:':0.0'}
      : originalProductivityApi(path,options);
    await refreshXServerQuickAction();
    const xServerUnauthorizedWarning=xServerQuickButton.classList.contains('warning')
      && !xServerQuickButton.classList.contains('ready')
      && xServerQuickButton.title.includes('当前浏览器未授权')
      && xServerQuickButton.title.includes('点击申请授权');
    api=async (path,options={}) => String(path)==='/api/xserver'
      ? {available:true,running:true,authorization_required:false,authorization_kind:'local-direct',display:':0.0'}
      : originalProductivityApi(path,options);
    await refreshXServerQuickAction();
    const xServerLocalDirectReady=xServerQuickButton.classList.contains('ready')
      && !xServerQuickButton.classList.contains('warning')
      && xServerQuickButton.title.includes('本机直连自动授权');
    api=originalProductivityApi;
    await refreshXServerQuickAction();
    const previousBroadcastTargets=productivityState.broadcastTargets;
    const previousBroadcastPaused=productivityState.broadcastPaused;
    const broadcastKeys=['__smoke-broadcast-a','__smoke-broadcast-b'];
    const broadcastSentA=[];
    const broadcastSentB=[];
    tabs.push(...broadcastKeys.map((key,index)=>({key,kind:'terminal',title:'Broadcast '+index})));
    terminalSessions.set(broadcastKeys[0],{socket:{readyState:WebSocket.OPEN,send:value=>broadcastSentA.push(value)},sensitiveInput:false});
    terminalSessions.set(broadcastKeys[1],{socket:{readyState:WebSocket.OPEN,send:value=>broadcastSentB.push(value)},sensitiveInput:false});
    productivityState.broadcastTargets=new Set(broadcastKeys);
    const previousWorkspaceVisiblePanes=workspaceVisiblePanes;
    workspaceVisiblePanes=()=>[{activeTabKey:broadcastKeys[0]},{activeTabKey:broadcastKeys[1]}];
    updateTerminalSmartState(broadcastKeys[1],'visible split output');
    const visibleSplitHasNoActivity=!tabs.find(tab=>tab.key===broadcastKeys[1]).activityState;
    const splitTab=tabs.find(tab=>tab.key===broadcastKeys[0]);
    splitTab.activityState='output';
    const visibleSplitHtml=workspaceTabHtml(splitTab,{activeTabKey:broadcastKeys[0]});
    const visibleSplitClearsPriorActivity=!splitTab.activityState&&!visibleSplitHtml.includes('activity-output');
    const hiddenBinaryKey='__smoke-hidden-binary-output';
    tabs.push({key:hiddenBinaryKey,kind:'terminal',title:'Hidden tail output'});
    terminalSessions.set(hiddenBinaryKey,{smartHadOutput:false,smartOutputTail:''});
    workspaceVisiblePanes=()=>[{activeTabKey:broadcastKeys[0]}];
    updateTerminalSmartState(hiddenBinaryKey,new Uint8Array([116,97,105,108,32,111,117,116,112,117,116,10]));
    const hiddenBinarySession=terminalSessions.get(hiddenBinaryKey);
    const hiddenBinaryOutputMarked=tabs.find(tab=>tab.key===hiddenBinaryKey).activityState==='output'
      && hiddenBinarySession.smartHadOutput===true
      && hiddenBinarySession.smartOutputTail.includes('tail output');
    workspaceVisiblePanes=previousWorkspaceVisiblePanes;
    const broadcastFromEither=handleTerminalBroadcastInput(broadcastKeys[0],'A','A')&&handleTerminalBroadcastInput(broadcastKeys[1],'B','B')&&broadcastSentA.join('')==='AB'&&broadcastSentB.join('')==='AB';
    const broadcastTabMarked=workspaceTabHtml(tabs.find(tab=>tab.key===broadcastKeys[0]),{activeTabKey:broadcastKeys[0]}).includes('broadcast-selected');
    updateTerminalBroadcastBar();
    const broadcastBar=document.getElementById('terminalBroadcastBar');
    const broadcastHeaderGrouped=broadcastBar?.nextElementSibling?.id==='workspaceQuickActions';
    const broadcastExit=broadcastBar?.querySelector('.terminal-broadcast-exit');
    const broadcastExitRect=broadcastExit?.getBoundingClientRect();
    const broadcastExitCompact=Boolean(broadcastExit&&broadcastExit.querySelector('.lucide-x')&&!broadcastExit.textContent.trim()&&broadcastExit.getAttribute('aria-label')==='退出终端同步'&&broadcastExitRect.width<=25&&broadcastExitRect.height<=25);
    broadcastBar?.remove();
    document.body.classList.remove('terminal-broadcast-active');
    tabs.splice(tabs.findIndex(tab=>tab.key===hiddenBinaryKey),1);
    tabs.splice(tabs.findIndex(tab=>tab.key===broadcastKeys[0]),2);
    terminalSessions.delete(broadcastKeys[0]);
    terminalSessions.delete(broadcastKeys[1]);
    terminalSessions.delete(hiddenBinaryKey);
    productivityState.broadcastTargets=previousBroadcastTargets;
    productivityState.broadcastPaused=previousBroadcastPaused;
    closeQuickPanel();
    renderSftpSyncPlan(Number(connections[0].id),{
      id:'visual-sync-plan',local_path:'C:/project',remote_path:'/srv/project',
      totals:{upload:1,download:1,conflict:1},
      actions:[
        {index:0,relative:'src/app.js',action:'upload',reason:'本地文件较新',selected:true,local_size:10,remote_size:8},
        {index:1,relative:'config.yml',action:'download',reason:'远程文件较新',selected:true,local_size:12,remote_size:14},
        {index:2,relative:'.env',action:'conflict',reason:'两端内容不同',selected:false,local_size:4,remote_size:4}
      ]
    },activeTabKey);
    const syncRows=document.querySelectorAll('.sftp-sync-plan-row').length;
    const conflictSafe=Boolean(document.querySelector('.sftp-sync-plan-row.conflict input:disabled')&&!document.querySelector('.sftp-sync-plan-row.conflict input:checked'));
    const namedWorkspaceTools=typeof importNamedWorkspaceData==='function'&&typeof exportNamedWorkspace==='function'&&typeof repairNamedWorkspace==='function';
    const terminalTools=typeof toggleTabNotifications==='function'&&typeof openTerminalPathInSftp==='function';
    const quickCommandUi=await (async()=>{
    let previousQuickSnippets;
    let previousQuickVisible;
    let previousQuickHeight;
    let quickFixture;
    let quickKey='';
    let originalQuickApi=api;
    try {
    previousQuickSnippets=productivityState.snippets;
    previousQuickVisible=localStorage.getItem(terminalQuickCommandStorage.visible);
    previousQuickHeight=localStorage.getItem(terminalQuickCommandStorage.height);
    localStorage.setItem(terminalQuickCommandStorage.visible,'1');
    localStorage.setItem(terminalQuickCommandStorage.height,'108');
    applyTermaAppearanceSettings();
    productivityState.snippets=[
      {id:-998,name:'查服务',group_name:'测试',command:'printf quick-command',description:'',tags:'',favorite:1,quick_visible:1,quick_action:'execute',quick_badge:'',quick_color:'green',quick_sort_order:0,created_at:1},
      {id:-997,name:'查看非常非常长的服务运行状态',group_name:'测试',command:'systemctl status sshd',description:'',tags:'',favorite:0,quick_visible:1,quick_action:'insert',quick_badge:'查',quick_color:'blue',quick_sort_order:0,created_at:2}
    ];
    quickFixture=document.createElement('div');
    quickFixture.className='workspace-header-tools';
    quickFixture.style.cssText='position:fixed;left:-10000px;top:0;width:640px;height:240px;display:flex;flex-direction:column;';
    quickKey='__smoke-quick-command';
    quickFixture.innerHTML=terminalQuickCommandToolbarButton(quickKey)+renderTerminalQuickCommandBar(quickKey);
    document.body.appendChild(quickFixture);
    const quickSent=[];
    terminalSessions.set(quickKey,{id:connections[0]?.id,connection:connections[0],socket:{readyState:WebSocket.OPEN,send:value=>quickSent.push(value)},term:{focus(){}},connected:true});
    originalQuickApi=api;
    api=async (path,options={}) => {
      if (String(path)==='/api/command-snippets' && !options.method) return productivityState.snippets;
      if (String(path).includes('/command-snippets/')) return {};
      return originalQuickApi(path,options);
    };
    mountTerminalQuickCommandBar(quickKey,quickFixture);
    const quickBar=quickFixture.querySelector('[data-terminal-quick-command-bar]');
    const quickToolbarIcon=quickFixture.querySelector('[data-terminal-quick-command-toggle] svg');
    const quickToolbarIconVisible=Boolean(quickToolbarIcon&&quickToolbarIcon.getBoundingClientRect().width>0);
    const initialQuickButtons=[...quickFixture.querySelectorAll('[data-terminal-quick-command-id]')];
    const quickCompactWidths=initialQuickButtons.length===2
      &&initialQuickButtons[0].getBoundingClientRect().width<initialQuickButtons[1].getBoundingClientRect().width
      &&initialQuickButtons[1].getBoundingClientRect().width<=191
      &&initialQuickButtons[0].classList.contains('no-badge')
      &&!initialQuickButtons[0].querySelector('.terminal-quick-command-badge');
    const quickItem=quickFixture.querySelector('[data-terminal-quick-command-id]');
    quickItem.click();
    await new Promise(resolve=>setTimeout(resolve,30));
    const quickCommandExecutes=quickSent.join('')==='printf quick-command\\r';
    quickItem.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:40,clientY:40}));
    const quickContextLabels=[...document.querySelectorAll('#actionMenu > button:not(.action-menu-close) > span')].map(node=>node.textContent.trim());
    const quickContextExpected=[
      tr('terminal:quick_commands.execute_now'),
      tr('terminal:quick_commands.insert_only'),
      tr('terminal:quick_commands.edit'),
      tr('terminal:quick_commands.remove'),
      tr('terminal:quick_commands.delete')
    ];
    const quickContextMenu=JSON.stringify(quickContextLabels)===JSON.stringify(quickContextExpected);
    hideActionMenu();
    quickFixture.querySelector('[data-terminal-quick-command-list]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));
    const quickDoubleClickCreates=!document.getElementById('modal').hidden
      &&Boolean(document.getElementById('snippetQuickVisible')?.checked)
      &&document.getElementById('snippetQuickBadge')?.value==='';
    document.querySelector('[data-snippet-back]')?.click();
    await new Promise(resolve=>setTimeout(resolve,20));
    const quickEditorBackCloses=document.getElementById('modal').hidden;
    await openCommandSnippetManager();
    const quickManager=document.querySelector('.command-snippet-manager');
    const quickManagerRows=[...document.querySelectorAll('.command-snippet-row')];
    const quickManagerHead=quickManager?.querySelector('.productivity-manager-head');
    const quickManagerToolbar=quickManager?.querySelector('.command-snippet-toolbar');
    const quickManagerCode=quickManagerRows[0]?.querySelector('.command-snippet-copy code');
    const quickManagerRect=quickManager?.getBoundingClientRect();
    const quickManagerHeadRect=quickManagerHead?.getBoundingClientRect();
    const quickManagerCodeRect=quickManagerCode?.getBoundingClientRect();
    const quickManagerMetrics={
      width:quickManagerRect?.width||0,
      right:quickManagerRect?.right||0,
      bottom:quickManagerRect?.bottom||0,
      headHeight:quickManagerHeadRect?.height||0,
      toolbarDisplay:quickManagerToolbar?getComputedStyle(quickManagerToolbar).display:'',
      toolbarDirection:quickManagerToolbar?getComputedStyle(quickManagerToolbar).flexDirection:'',
      toolbarButtons:quickManagerToolbar?.querySelectorAll('button').length||0,
      codeWidth:quickManagerCodeRect?.width||0,
      codeHeight:quickManagerCodeRect?.height||0,
      codeColor:quickManagerCode?getComputedStyle(quickManagerCode).color:'',
      codeBackground:quickManagerCode?getComputedStyle(quickManagerCode).backgroundColor:'',
      rowAlign:quickManagerRows[0]?getComputedStyle(quickManagerRows[0]).alignItems:''
    };
    const quickManagerPolished=Boolean(quickManager
      &&quickManagerRows.length===2
      &&quickManagerRect.width>=700
      &&quickManagerRect.right<=innerWidth+1&&quickManagerRect.bottom<=innerHeight+1
      &&quickManagerHead?.getBoundingClientRect().height<=70
      &&getComputedStyle(quickManagerToolbar).display==='flex'
      &&getComputedStyle(quickManagerToolbar).flexDirection==='row'
      &&quickManagerToolbar.querySelectorAll('button').length===3
      &&quickManagerCode?.textContent.trim().length>0
      &&quickManagerCodeRect.width>100&&quickManagerCodeRect.height>0
      &&getComputedStyle(quickManagerCode).color!==getComputedStyle(quickManagerCode).backgroundColor
      &&quickManagerRows.every(row=>row.querySelector('.command-snippet-copy code')&&row.querySelector('.command-snippet-actions'))
      &&getComputedStyle(quickManagerRows[0]).alignItems==='center');
    closeModal();
    const dragButtons=[...quickFixture.querySelectorAll('[data-terminal-quick-command-id]')];
    const dragHandle=dragButtons[0]?.querySelector('[data-terminal-quick-command-drag]');
    const dragStart=dragHandle?.getBoundingClientRect();
    const dragTarget=dragButtons[1]?.getBoundingClientRect();
    dragHandle?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:41,pointerType:'mouse',button:0,clientX:dragStart.left+4,clientY:dragStart.top+4}));
    window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:41,pointerType:'mouse',button:0,clientX:dragTarget.right-2,clientY:dragTarget.top+dragTarget.height/2}));
    window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:41,pointerType:'mouse',button:0,clientX:dragTarget.right-2,clientY:dragTarget.top+dragTarget.height/2}));
    await new Promise(resolve=>setTimeout(resolve,80));
    const quickOrderIds=[...quickFixture.querySelectorAll('[data-terminal-quick-command-id]')].map(button=>Number(button.dataset.terminalQuickCommandId));
    const quickOrderPersists=JSON.stringify(quickOrderIds)===JSON.stringify([-997,-998])
      &&productivityState.snippets.find(item=>item.id===-997)?.quick_sort_order===1
      &&productivityState.snippets.find(item=>item.id===-998)?.quick_sort_order===2;
    setTerminalQuickCommandHeight(156);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const quickHeightAdjustable=Math.abs(quickBar.getBoundingClientRect().height-156)<1;
    const quickToggle=quickFixture.querySelector('[data-terminal-quick-command-toggle]');
    const quickActiveStyle={
      color:getComputedStyle(quickToggle).color,
      background:getComputedStyle(quickToggle).backgroundColor,
      border:getComputedStyle(quickToggle).borderColor,
      shadow:getComputedStyle(quickToggle).boxShadow
    };
    quickToggle.click();
    const quickInactiveStyle={
      color:getComputedStyle(quickToggle).color,
      background:getComputedStyle(quickToggle).backgroundColor,
      border:getComputedStyle(quickToggle).borderColor,
      shadow:getComputedStyle(quickToggle).boxShadow
    };
    const quickToggleHides=quickBar.classList.contains('hidden')&&quickToggle.getAttribute('aria-pressed')==='false';
    quickToggle.click();
    const quickToggleStyleDifferences=['color','background','border','shadow']
      .filter(property=>quickActiveStyle[property]!==quickInactiveStyle[property]);
    const quickToggleStateVisible=quickToggle.getAttribute('aria-pressed')==='true'
      &&quickToggle.classList.contains('active')
      &&quickToggleStyleDifferences.includes('background')
      &&quickToggleStyleDifferences.includes('border');
    quickFixture.style.width='180px';
    setTerminalQuickCommandHeight(32);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const compactQuickList=quickFixture.querySelector('[data-terminal-quick-command-list]');
    compactQuickList.scrollLeft=0;
    compactQuickList.dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true}));
    const quickWheelScrolls=compactQuickList.scrollLeft>0;
    setTerminalQuickCommandHeight(156);
    quickFixture.style.width='320px';
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const quickList=quickFixture.querySelector('[data-terminal-quick-command-list]');
    const currentQuickItem=quickFixture.querySelector('[data-terminal-quick-command-id]');
    const quickResponsive=quickList.scrollWidth<=quickList.clientWidth+1&&currentQuickItem.getBoundingClientRect().right<=quickList.getBoundingClientRect().right+1;
    return {quickToolbarIconVisible,quickToggleStateVisible,quickToggleStyleDifferences,quickCompactWidths,quickCommandExecutes,quickContextMenu,quickDoubleClickCreates,quickEditorBackCloses,quickManagerPolished,quickManagerMetrics,quickOrderPersists,quickHeightAdjustable,quickToggleHides,quickWheelScrolls,quickResponsive,error:''};
    } catch(error) {
      return {quickToolbarIconVisible:false,quickToggleStateVisible:false,quickCompactWidths:false,quickCommandExecutes:false,quickContextMenu:false,quickDoubleClickCreates:false,quickEditorBackCloses:false,quickManagerPolished:false,quickOrderPersists:false,quickHeightAdjustable:false,quickToggleHides:false,quickWheelScrolls:false,quickResponsive:false,error:String(error?.stack||error)};
    } finally {
      closeModal();
      api=originalQuickApi;
      if(quickKey) terminalSessions.delete(quickKey);
      quickFixture?.remove();
      if(previousQuickSnippets!==undefined) productivityState.snippets=previousQuickSnippets;
      if(previousQuickVisible!==undefined) {
        if(previousQuickVisible===null) localStorage.removeItem(terminalQuickCommandStorage.visible); else localStorage.setItem(terminalQuickCommandStorage.visible,previousQuickVisible);
      }
      if(previousQuickHeight!==undefined) {
        if(previousQuickHeight===null) localStorage.removeItem(terminalQuickCommandStorage.height); else localStorage.setItem(terminalQuickCommandStorage.height,previousQuickHeight);
      }
      applyTermaAppearanceSettings();
    } })();
    closeModal();
    return {quickVisible,actionCount,quickConnectionActionsInline,quickPanelDirect,workspaceSearchable,workspacePreviewOpens,quickButtonPlacement,quickButtonLightning,xServerQuickUsesX11,xServerUnauthorizedWarning,xServerLocalDirectReady,broadcastFromEither,broadcastTabMarked,broadcastHeaderGrouped,broadcastExitCompact,visibleSplitHasNoActivity,visibleSplitClearsPriorActivity,hiddenBinaryOutputMarked,syncRows,conflictSafe,namedWorkspaceTools,terminalTools,...quickCommandUi};
  })()`);
  console.log("[ui-smoke] quick commands", JSON.stringify({
    quickToolbarIconVisible:productivityUi.quickToolbarIconVisible,
    quickToggleStateVisible:productivityUi.quickToggleStateVisible,
    quickToggleStyleDifferences:productivityUi.quickToggleStyleDifferences,
    quickCompactWidths:productivityUi.quickCompactWidths,
    quickCommandExecutes:productivityUi.quickCommandExecutes,
    quickContextMenu:productivityUi.quickContextMenu,
    quickDoubleClickCreates:productivityUi.quickDoubleClickCreates,
    quickEditorBackCloses:productivityUi.quickEditorBackCloses,
    quickManagerPolished:productivityUi.quickManagerPolished,
    quickManagerMetrics:productivityUi.quickManagerMetrics,
    quickOrderPersists:productivityUi.quickOrderPersists,
    quickHeightAdjustable:productivityUi.quickHeightAdjustable,
    quickToggleHides:productivityUi.quickToggleHides,
    quickWheelScrolls:productivityUi.quickWheelScrolls,
    quickResponsive:productivityUi.quickResponsive,
    error:productivityUi.error
  }));
  await window.webContents.executeJavaScript("document.documentElement.dataset.uiSmokeStage='remote-access'");
  const remoteAccessUi = await window.webContents.executeJavaScript(`(async () => {
    const previousProfiles=remoteProfiles;
    const previousConnections=connections;
    const previousSelected=selectedRemoteProfileId;
    const previousPrimaryView=primaryView;
    const previousRemoteSearch=remoteConnectionSearch;
    const previousRemoteDesktopQuickOpen=remoteDesktopQuickOpen;
    const previousEditHtml=document.getElementById('view-edit').innerHTML;
    const previousOperationWidth=operationPaneWidth;
    const previousApi=api;
    try {
      const macSsh={...connections[0],id:900002,name:'macOS SSH fixture',ssh_host:'198.51.100.109',terminal_program_platform:'darwin'};
      connections=[...connections,macSsh];
      const vnc={id:910001,name:'VNC fixture',group_name:'UI Smoke',protocol:'vnc',host:connections[0].ssh_host,port:5900,username:'',tags:'',has_password:false,options:{client_mode:'system',quality:7,shared:true,view_only:false}};
      const xdmcp={id:910002,name:'XDMCP fixture',group_name:'UI Smoke',protocol:'xdmcp',host:connections[0].ssh_host,port:177,username:'',tags:'desktop',has_password:false,options:{mode:'indirect',window_mode:'windowed',width:1600,height:900,local_address:'192.0.2.111',ssh_connection_id:Number(connections[0].id)}};
      const derived={id:910003,name:connections[0].name+' · RDP',group_name:'UI Smoke',protocol:'rdp',host:connections[0].ssh_host,port:3389,username:'',tags:'',has_password:false,options:{source_ssh_connection_id:Number(connections[0].id)}};
      const macVnc={id:910004,name:'macOS VNC fixture',group_name:'UI Smoke',protocol:'vnc',host:macSsh.ssh_host,port:5900,username:'fixture',tags:'macos',has_password:false,options:{client_mode:'system',source_ssh_connection_id:Number(macSsh.id)}};
      const isolatedVnc={id:910005,name:'Isolated VNC fixture',group_name:'UI Smoke',protocol:'vnc',host:'198.51.100.88',port:5900,username:'fixture',tags:'isolated',has_password:false,options:{client_mode:'system'}};
      const standaloneRdp={id:910006,name:'Standalone Windows RDP',group_name:'UI Smoke',protocol:'rdp',host:'198.51.100.89',port:3389,username:'Administrator',tags:'windows',has_password:false,options:{}};
      const standaloneXdmcp={id:910007,name:'Standalone XDMCP',group_name:'UI Smoke',protocol:'xdmcp',host:'198.51.100.90',port:177,username:'',tags:'isolated',has_password:false,options:{mode:'query'}};
      const withRemoteSmokeTimeout=(promise,label,timeoutMs=10000)=>new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Remote UI smoke timed out: '+label)),timeoutMs);
        Promise.resolve(promise).then(
          value=>{clearTimeout(timer);resolve(value);},
          error=>{clearTimeout(timer);reject(error);}
        );
      });
      const openRemoteDesktopForSmoke=(profileId,updateTab,label)=>{
        document.documentElement.dataset.uiSmokeStage='remote-access-'+label;
        return withRemoteSmokeTimeout(openRemoteDesktop(profileId,updateTab),'open '+label);
      };
      const renderingCommands=[
        {id:'java2d',label:'Java2D',command:'java -Dsun.java2d.xrender=false -Dsun.java2d.opengl=false -jar app.jar'},
        {id:'java2d-safe',label:'Java2D safe',command:'NO_J2D_MITSHM=true java -Dsun.java2d.xrender=false -Dsun.java2d.opengl=false -Dsun.java2d.pmoffscreen=false -jar app.jar'},
        {id:'javafx',label:'JavaFX',command:'java -Dprism.order=sw -jar app.jar'}
      ];
      const graphicsRendering={
        rdp:{visible:true,state:'software',protocol:'rdp',backend:'xorgxrdp',display:':10',drm_device:'/dev/dri/renderD128',drm_device_available:false,software_rendering:true,java_gui_risk:true,summary:'Java GUI white-screen risk',detail:'XRDP is using software rendering.',compatibility_commands:renderingCommands},
        vnc:{visible:true,state:'software',protocol:'vnc',backend:'x11vnc -> xorgxrdp',source_display:':10.0',drm_device:'/dev/dri/renderD128',drm_device_available:false,software_rendering:true,java_gui_risk:true,summary:'Java GUI white-screen risk',detail:'VNC inherits the source XRDP rendering path.',compatibility_commands:renderingCommands},
        xdmcp:{visible:true,state:'remote-x11',protocol:'xdmcp',backend:'remote X11',display:':20',drm_device:'',drm_device_available:false,software_rendering:true,java_gui_risk:true,summary:'Java GUI white-screen risk',detail:'XDMCP direct GPU rendering is limited.',compatibility_commands:renderingCommands}
      };
      remoteProfiles=[vnc,xdmcp,derived,macVnc,isolatedVnc,standaloneRdp,standaloneXdmcp];
      remoteDesktopQuickOpen=false;
      remoteConnectionSearch='';
      remoteGroupOpen.add('UI Smoke');
      remoteProfiles.forEach(profile=>remoteHostOpen.add(remoteHostKey(profile)));
      primaryView='remote';
      renderExplorerTools();
      renderConnections();
      const remoteTree=document.getElementById('connectionGroups');
      const remoteOuterHeader=remoteTree?.querySelector('.connection-group-head-row');
      const remoteHostHeader=remoteTree?.querySelector('.remote-host-head-row');
      const remoteOuterStyle=remoteOuterHeader?getComputedStyle(remoteOuterHeader):null;
      const remoteHostStyle=remoteHostHeader?getComputedStyle(remoteHostHeader):null;
      const remoteHostStickyStyle=Boolean(
        remoteOuterStyle?.position==='sticky'
        && parseFloat(remoteOuterStyle.top)===0
        && remoteHostStyle?.position==='sticky'
        && Math.abs(parseFloat(remoteHostStyle.top)-remoteOuterHeader.getBoundingClientRect().height)<=1
        && remoteHostStyle.backgroundColor!=='rgba(0, 0, 0, 0)'
        && remoteHostStyle.boxShadow!=='none'
      );
      const remoteTreeInlineStyle=remoteTree?.getAttribute('style');
      if(remoteTree){
        remoteTree.style.height='112px';
        remoteTree.style.flex='0 0 112px';
        remoteTree.style.overflowY='auto';
        remoteTree.scrollTop=42;
      }
      await new Promise(resolve=>setTimeout(resolve,0));
      const remoteTreeRect=remoteTree?.getBoundingClientRect();
      const remoteOuterRect=remoteOuterHeader?.getBoundingClientRect();
      const remoteHostRect=remoteHostHeader?.getBoundingClientRect();
      const remoteHostStickyFollowsOuter=Boolean(
        remoteTree
        && remoteTree.scrollHeight>remoteTree.clientHeight
        && remoteTree.scrollTop>0
        && remoteTreeRect
        && remoteOuterRect
        && remoteHostRect
        && Math.abs(remoteOuterRect.top-remoteTreeRect.top)<=1
        && Math.abs(remoteHostRect.top-remoteOuterRect.bottom)<=1.5
      );
      if(remoteTree){
        remoteTree.scrollTop=0;
        if(remoteTreeInlineStyle===null) remoteTree.removeAttribute('style');
        else remoteTree.setAttribute('style',remoteTreeInlineStyle);
      }
      const remoteNames=[...document.querySelectorAll('.remote-profile-row .conn-name')].map(node=>node.textContent);
      const remoteActivityChecks={
        vnc:remoteNames.includes('VNC fixture'),
        xdmcp:remoteNames.includes('XDMCP fixture'),
        excludesSsh:document.querySelectorAll('#connectionGroups .conn-row:not(.remote-profile-row)').length===0,
        nav:Boolean(document.getElementById('navRemote'))
      };
      const remoteActivitySeparated=Object.values(remoteActivityChecks).every(Boolean);
      const derivedRow=document.querySelector('[data-remote-profile-id="910003"]');
      const derivedSourcePresentation=Boolean(
        derivedRow?.querySelector('.conn-name')?.textContent===connections[0].name
        && derivedRow?.querySelector('.protocol-badge')?.textContent.includes('RDP')
        && derivedRow?.querySelector('.remote-source-badge')?.title==='来源：'+connections[0].name
      );
      const originalOpenRemoteDesktopForDoubleClick=openRemoteDesktop;
      let doubleClickedRemoteId=0;
      openRemoteDesktop=id=>{ doubleClickedRemoteId=Number(id); };
      derivedRow?.querySelector('.conn-name')?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0}));
      openRemoteDesktop=originalOpenRemoteDesktopForDoubleClick;
      const remoteNameDoubleClickOpens=doubleClickedRemoteId===derived.id;
      const remoteDesktopSwitchAvailable=remoteDesktopSwitchProfiles(derived.id).length===2
        && remoteWorkspaceJumpButtonsHtml(derived).includes('remote-desktop-switch-button');
      const remoteDesktopSingleDisabled=remoteDesktopSwitchProfiles(isolatedVnc.id).length===0
        && /remote-desktop-switch-button[^>]*disabled/.test(remoteWorkspaceJumpButtonsHtml(isolatedVnc));
      openRemoteDesktopSwitchMenu(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:220,clientY:120}),derived.id);
      const remoteDesktopSwitchMenu=[...document.querySelectorAll('#actionMenu button span')].filter(node=>!node.classList.contains('composite-icon')).map(node=>node.textContent.trim());
      const remoteDesktopSwitchMenuComplete=remoteDesktopSwitchMenu.length===2
        && remoteDesktopSwitchMenu.some(label=>label.includes('XDMCP fixture'))
        && remoteDesktopSwitchMenu.some(label=>label.includes('VNC fixture'))
        && !remoteDesktopSwitchMenu.some(label=>label.includes('macOS VNC fixture'));
      hideActionMenu();
      primaryView='connections';
      renderExplorerTools();
      renderConnections();
      const sshActivitySeparated=document.getElementById('connectionGroups')?.textContent.includes(connections[0].name)&&!document.getElementById('connectionGroups')?.textContent.includes('VNC fixture')&&document.querySelector('#explorerTools .explorer-main-action')?.textContent.includes('添加 SSH');
      renderRemoteProfileForm(derived);
      const rdpDisplayForm=Boolean(
        document.getElementById('remote_rdp_display_mode')?.value==='dynamic'
        && document.getElementById('remote_rdp_resolution_preset')?.value==='1440x900'
        && document.getElementById('remote_rdp_resolution_options')?.hidden
        && !document.getElementById('remotePasswordField')?.hidden
        && document.getElementById('remote_password')
        && !document.getElementById('remoteRdpPasswordTransferField')?.hidden
        && !document.getElementById('remote_rdp_password_transfer')?.checked
        && document.getElementById('remoteRdpPasswordTransferField')?.textContent.includes('我了解风险')
        && document.getElementById('remoteDesktopCredentialNote')?.textContent.includes('标准输入')
        && document.getElementById('remoteDesktopCredentialNote')?.textContent.includes('Windows 使用临时凭据')
        && document.getElementById('remoteProtocolOptions')?.textContent.includes('自动跟随窗口')
      );
      renderRemoteProfileForm(vnc);
      const vncModePersisted=Boolean(
        document.getElementById('remote_vnc_client_mode')?.value==='system'
        && document.getElementById('remote_vnc_display_mode')?.value==='scale'
        && document.getElementById('remote_quality')?.type==='range'
        && document.getElementById('remote_quality_value')?.textContent==='7'
        && document.getElementById('remote_vnc_auto_sync_images')?.checked===true
      );
      renderRemoteProfileForm({...vnc,options:{...vnc.options,auto_sync_images:false}});
      const vncImageSyncOptOut=document.getElementById('remote_vnc_auto_sync_images')?.checked===false;
      renderRemoteProfileForm({...vnc,id:0,name:'',has_password:false});
      const vncPasswordForm=Boolean(
        !document.getElementById('remotePasswordField')?.hidden
        && document.getElementById('remote_password')
        && document.querySelector('#remoteProfileForm button[data-clear-after-save="1"]')
        && document.getElementById('remoteDesktopCredentialNote')?.textContent.includes('可选保存并加密存储')
      );
      const credentialPromise=requestVncCredentials({...vnc,has_password:true},['password'],{failureReason:'VNC 密码错误',updateByDefault:true});
      const vncRetryPrompt=Boolean(
        document.querySelector('.vnc-credentials-modal .connection-test-status.error')?.textContent.includes('密码错误')
        && document.getElementById('vncCredentialSave')?.checked
        && document.querySelector('.vnc-credentials-modal')?.textContent.includes('更新保存密码')
      );
      document.getElementById('vncCredentialPassword').value='replacement';
      document.querySelector('.vnc-credentials-modal').requestSubmit();
      const credentialResult=await credentialPromise;
      const vncRetryValue=credentialResult?.credentials?.password==='replacement'&&credentialResult?.update_saved_password===true;
      const noPasswordPromise=requestVncCredentials({...vnc,has_password:false},['password'],{allowNoPassword:true,updateByDefault:true,title:'VNC no-password fixture'});
      const noPasswordInput=document.getElementById('vncCredentialNoPassword');
      const noPasswordPrompt=Boolean(noPasswordInput&&document.getElementById('vncCredentialPassword')?.required===true);
      if(noPasswordInput){
        noPasswordInput.checked=true;
        noPasswordInput.dispatchEvent(new Event('change',{bubbles:true}));
      }
      const noPasswordModeUi=Boolean(
        noPasswordInput?.checked===true
        && document.getElementById('vncCredentialPassword')?.disabled===true
        && document.getElementById('vncCredentialSave')?.disabled===true
      );
      document.querySelector('.vnc-credentials-modal')?.requestSubmit();
      const noPasswordResult=await noPasswordPromise;
      const vncNoPassword=Boolean(noPasswordPrompt&&noPasswordModeUi&&noPasswordResult?.allow_no_password===true&&noPasswordResult?.credentials?.password===''&&noPasswordResult?.update_saved_password===false);
      const credentialApi=api;
      api=async (path,options)=>String(path)==='/api/identity-files'
        ? [{path:'managed-key',label:'Managed key',permission_ok:true}]
        : credentialApi(path,options);
      const sshCredentialPromise=promptSshCredentialRepair({...connections[0],auth_type:'password'}, {
        context:'UI smoke SSH 认证失败',
        onTemporary:async()=>{}
      });
      await new Promise(resolve=>setTimeout(resolve,0));
      const sshCredentialRepairUi=Boolean(
        document.querySelector('.ssh-credential-repair-modal')
        && document.getElementById('sshCredentialUser')?.value===connections[0].ssh_user
        && Number(document.getElementById('sshCredentialPort')?.value)===Number(connections[0].ssh_port||22)
        && document.getElementById('sshCredentialPassword')?.type==='password'
        && document.getElementById('sshCredentialKeyUpload')?.type==='file'
        && document.getElementById('sshCredentialSave')?.checked
        && !document.getElementById('sshCredentialSave')?.disabled
      );
      document.querySelector('[data-credential-close]')?.click();
      await sshCredentialPromise;
      const quickCredentialPromise=startQuickSshConnection({user:'root',host:'192.0.2.44',port:22},{repair:true,authType:'password'});
      await new Promise(resolve=>setTimeout(resolve,0));
      const quickTerminalCredentialRepairUi=Boolean(
        document.getElementById('modal')?.dataset.quickSshAuth==='1'
        && document.querySelector('.quick-ssh-auth-modal')?.textContent.includes('修复临时 SSH 凭据')
        && document.querySelector('.quick-ssh-auth-modal')?.textContent.includes('上次认证失败')
      );
      document.querySelector('[data-action="quick-ssh-close"]')?.click();
      await quickCredentialPromise;
      api=credentialApi;
      const originalRequireEncryptionUnlocked=requireConfigEncryptionUnlocked;
      requireConfigEncryptionUnlocked=()=>true;
      const ftpCredentialPromise=promptRemoteProfileCredentialRepair({
        id:910099,
        protocol:'ftp',
        name:'FTP credential fixture',
        host:'192.0.2.99',
        port:2121,
        username:'ftp-user',
        options:{base_path:'/'}
      }, {context:'UI smoke FTP 认证失败'});
      const ftpCredentialRepairUi=Boolean(
        document.getElementById('remoteCredentialUser')?.value==='ftp-user'
        && Number(document.getElementById('remoteCredentialPort')?.value)===2121
        && document.getElementById('remoteCredentialPassword')?.type==='password'
        && document.getElementById('remoteCredentialSave')?.checked
        && document.getElementById('remoteCredentialSave')?.disabled
      );
      document.querySelector('[data-remote-credential-close]')?.click();
      await ftpCredentialPromise;
      requireConfigEncryptionUnlocked=originalRequireEncryptionUnlocked;
      renderRemoteProfileForm(xdmcp);
      const xdmcpForm=Boolean(
        document.getElementById('remote_protocol')?.value==='xdmcp'
        && document.getElementById('remote_xdmcp_mode')?.value==='indirect'
        && document.getElementById('remote_xdmcp_window_mode')?.value==='fixed'
        && document.getElementById('remote_xdmcp_resolution_preset')?.value==='1600x900'
        && document.getElementById('remote_xdmcp_width')?.value==='1600'
        && document.getElementById('remote_xdmcp_local_address')?.value==='192.0.2.111'
        && document.getElementById('remote_xdmcp_ssh_connection')?.value===String(connections[0].id)
        && document.querySelector('.xdmcp-session-auto')
        && document.getElementById('remoteCredentialFields')?.hidden
        && document.getElementById('remoteProtocolOptions')?.textContent.includes('私钥、SSH Agent 或密码')
      );
      const xdmcpMenuAvailable=Boolean(REMOTE_PROTOCOL_META.xdmcp&&REMOTE_PROTOCOL_META.xdmcp.port===177);
      vnc.options.source_ssh_connection_id=Number(connections[0].id);
      api=async (path,options) => String(path)==='/api/remote-clients/diagnostics'
        ? {rdp:{available:true,client:'UI smoke RDP client'},xdmcp:{available:true,client:'内置 X Server'},vnc:{available:true,client:'UI smoke VNC client'}}
        : String(path).endsWith('/connectivity')
          ? String(path).includes('910007')||String(path).includes('910002')
            ? {supported:true,method:'xdmcp-query',ok:true,responded:true,response:'willing',error:'',host:'198.51.100.90',port:177}
            : {supported:true,method:'tcp',ok:true,host:'198.51.100.1',port:String(path).includes('910006')?3389:5900}
        : String(path).endsWith('/rdp/server')
          ? {platform_supported:true,os_id:'ubuntu',has_desktop:true,desktops:[{id:'xfce',name:'XFCE'}],xrdp_installed:true,xrdp_active:true,xrdp_listening:true,xrdp_enabled:true,connection:{id:Number(connections[0].id),name:connections[0].name},graphics_rendering:graphicsRendering.rdp}
        : String(path).endsWith('/vnc/server')
          ? String(path).includes('/910004/')
            ? {platform:'macos',diagnostics_available:true,status:'ready',installed:true,listening:true,port:5900,service_unit:'',service_state:'active',ssh_connection:{id:Number(macSsh.id),name:macSsh.name},graphics_rendering:{visible:true,state:'shared',protocol:'vnc',backend:'macOS Screen Sharing'}}
            : {platform:'linux',diagnostics_available:true,status:'ready',installed:true,listening:true,port:5900,service_unit:'',service_state:'active',server_session_configurable:true,server_session_selection:{requested_mode:'shared',mode:'shared',display:':10',source:{kind:'xrdp',display:':10',user:'root',desktop:'XFCE'},source_available:true,requires_selection:false},server_session_selection_matches_running:true,session_sources:[{kind:'physical',display:':0',user:'root',desktop:'XFCE',state:'active'},{kind:'xrdp',display:':10',user:'root',desktop:'XFCE',state:'active'}],xrdp_software_rendering:true,graphics_rendering:graphicsRendering.vnc}
        : String(path).endsWith('/xdmcp/server')
          ? {manager:'lightdm',manager_label:'LightDM',supported:true,replacement_available:false,enabled:true,listening:true,action:'ready',ready_for_login:true,session_needs_repair:false,session_conflict:false,firewall:'none',firewall_managed:false,config_file:'/etc/lightdm/lightdm.conf.d/90-tunneldesk-xdmcp.conf',preferred_session:{id:'plasma',name:'Plasma (X11)'},saved_session:'lightdm-xsession',resolved_saved_session_label:'lightdm-xsession -> Plasma (X11)',sessions:[{id:'lightdm-xsession',name:'Default XSession'},{id:'plasma',name:'Plasma (X11)'}],ssh_connection:{name:connections[0].name},warning:'XDMCP 不加密，只应在可信局域网使用。',graphics_rendering:graphicsRendering.xdmcp}
          : String(path).endsWith('/linux-desktop')
            ? {platform_supported:false,os_id:'macos',has_desktop:false,desktops:[]}
          : String(path).endsWith('/x11-applications')
            ? {discovery:{ok:true,platform:'Linux',xauth_available:true,warnings:[],applications:[{id:'xterm',label:'XTerm',command:'xterm',path:'/usr/bin/xterm',category:'terminal',category_label:'终端',kind:'tool',mode:'untrusted'},{id:'konsole',label:'Konsole',command:'konsole',path:'/usr/bin/konsole',category:'terminal',category_label:'终端',kind:'tool',mode:'untrusted'}]}}
            : previousApi(path,options);
      const renderingUi={};
      const captureRenderingUi=protocol => {
        const panel=document.querySelector('#view-remote-desktop .remote-rendering-state.warning');
        const buttons=[...(panel?.querySelectorAll('.remote-rendering-actions button')||[])];
        const panelRect=panel?.getBoundingClientRect();
        const expectedSummary=String(remoteGraphicsRenderingCopy(graphicsRendering[protocol]).summary||'').replaceAll('TigerVNC/Xvnc','TigerVNC');
        return {
          warning:Boolean(panel&&panel.textContent.includes(expectedSummary)&&panelRect?.width>0&&panelRect?.height>0),
          copyButtons:buttons.length===3&&buttons.every(button=>button.getAttribute('onclick')?.includes('copyRemoteGraphicsCommand')),
          noHorizontalOverflow:Boolean(panel&&panel.scrollWidth<=panel.clientWidth+1&&buttons.every(button=>{
            const rect=button.getBoundingClientRect();
            return rect.left>=panelRect.left-1&&rect.right<=panelRect.right+1;
          })),
          protocol
        };
      };
      document.documentElement.dataset.uiSmokeStage='remote-access-open-profiles';
      await openRemoteDesktopForSmoke(derived.id,false,'derived-rdp');
      renderingUi.rdp=captureRenderingUi('rdp');
      await openRemoteDesktopForSmoke(vnc.id,false,'linked-vnc');
      renderingUi.vnc=captureRenderingUi('vnc');
      const vncSourceSelect=document.querySelector('#vnc_server_session_source_910001');
      const vncSourceSelection=Boolean(vncSourceSelect&&['auto','shared|:0','shared|:10','virtual'].every(value=>[...vncSourceSelect.options].some(option=>option.value===value))&&vncSourceSelect.value==='shared|:10');
      const vncSourceContainer=vncSourceSelect?.closest('#vncServerState');
      const vncSourceApi=api;
      const vncSourceDiagnostics=await api('/api/remote-profiles/'+vnc.id+'/vnc/server');
      let vncSourcePutOptions=null;
      let vncSourceRefreshCount=0;
      try {
        api=async (path,options={}) => {
          if(String(path)==='/api/remote-profiles/'+vnc.id&&options.method==='PUT'){
            vncSourcePutOptions=JSON.parse(options.body||'{}').options||null;
            return {...vnc,options:{...(vnc.options||{}),...(vncSourcePutOptions||{})}};
          }
          if(String(path)==='/api/remote-profiles/'+vnc.id+'/vnc/server'){
            vncSourceRefreshCount+=1;
            return {
              ...vncSourceDiagnostics,
              server_session_selection:{requested_mode:'virtual',mode:'virtual',display:':1',source:null,source_available:true,requires_selection:false},
              server_session_selection_matches_running:false
            };
          }
          return vncSourceApi(path,options);
        };
        if(vncSourceSelect){
          vncSourceSelect.value='virtual';
          await saveVncServerSessionSource(vnc.id,vncSourceSelect,'remote-desktop-'+vnc.id);
        }
      } finally {
        api=vncSourceApi;
      }
      const refreshedVncSourceSelect=vncSourceContainer?.querySelector('#vnc_server_session_source_'+vnc.id);
      const vncSourceRefreshInPlace=Boolean(
        vncSourceContainer?.isConnected
        && refreshedVncSourceSelect?.value==='virtual'
        && vncSourcePutOptions?.server_session_mode==='virtual'
        && vncSourcePutOptions?.server_display===''
        && vncSourceRefreshCount===1
      );
      await openRemoteDesktopForSmoke(xdmcp.id,false,'linked-xdmcp');
      renderingUi.xdmcp=captureRenderingUi('xdmcp');
      const xdmcpWorkspaceText=document.getElementById('view-remote-desktop')?.textContent||'';
      const xdmcpSessionSemantics=Boolean(
        xdmcpWorkspaceText.includes(tr('remote:actions.new_graphical_login'))
        && xdmcpWorkspaceText.includes(tr('remote:auto.shared_vnc'))
        && xdmcpWorkspaceText.includes(tr('remote:auto.xdmcp_launch_help'))
        && xdmcpWorkspaceText.includes('lightdm-xsession')
        && xdmcpWorkspaceText.includes('Plasma')
        && !xdmcpWorkspaceText.includes(tr('remote:xdmcp_status.repair_default_desktop'))
      );
      const xdmcpAuthorizationHost=document.getElementById('remoteDesktopAuthorization');
      if(xdmcpAuthorizationHost){
        xdmcpAuthorizationHost.innerHTML=desktopIntegrationAuthorizationMarkup({
          desktop_backend_available:true,
          can_request_authorization:true,
          web_session_authenticated:true,
          scopes:[]
        },['remote-client','xserver'],{refreshTarget:'remote-profile',remoteProfileId:xdmcp.id});
        refreshIcons();
      }
      await new Promise(resolve=>setTimeout(resolve,0));
      const xdmcpAuthorizationPanel=xdmcpAuthorizationHost?.querySelector('.desktop-integration-authorization');
      const xdmcpState=document.getElementById('xdmcpServerState');
      const xdmcpAuthorizationRect=xdmcpAuthorizationPanel?.getBoundingClientRect();
      const xdmcpStateRect=xdmcpState?.getBoundingClientRect();
      const xdmcpDurationSelect=xdmcpAuthorizationPanel?.querySelector('[data-role="desktop-integration-duration"]');
      const xdmcpCustomDuration=xdmcpAuthorizationPanel?.querySelector('.desktop-integration-custom-duration');
      if(xdmcpDurationSelect){
        xdmcpDurationSelect.value='custom';
        xdmcpDurationSelect.dispatchEvent(new Event('change',{bubbles:true}));
      }
      const customDurationVisible=Boolean(xdmcpCustomDuration&&!xdmcpCustomDuration.hidden&&xdmcpCustomDuration.querySelector('input')?.max==='480');
      if(xdmcpDurationSelect){
        xdmcpDurationSelect.value='browser-session';
        xdmcpDurationSelect.dispatchEvent(new Event('change',{bubbles:true}));
      }
      const xdmcpAuthorizationLayout=Boolean(
        xdmcpAuthorizationRect&&xdmcpStateRect
        && Math.abs(xdmcpAuthorizationRect.left-xdmcpStateRect.left)<=1
        && Math.abs(xdmcpAuthorizationRect.width-xdmcpStateRect.width)<=1
        && xdmcpAuthorizationPanel.scrollWidth<=xdmcpAuthorizationPanel.clientWidth+1
        && xdmcpDurationSelect?.querySelector('option[value="browser-session"]')?.textContent.includes('最长 12 小时')
        && xdmcpAuthorizationPanel.querySelector('[data-action="desktop-integration-authorize"]')?.textContent.includes('申请授权')
        && customDurationVisible
        && xdmcpCustomDuration.hidden
      );
      const renderingCopyInteraction={success:false,failure:false};
      const renderingCopyButton=document.querySelector('#view-remote-desktop .remote-rendering-actions button');
      const previousWriteClipboardText=writeClipboardText;
      const previousNotify=notify;
      try {
        let clipboardValue='';
        let notices=[];
        writeClipboardText=async value=>{clipboardValue=String(value)};
        notify=(message,type)=>notices.push({message:String(message),type:String(type||'')});
        await copyRemoteGraphicsCommand(encodeURIComponent(renderingCommands[0].command),renderingCommands[0].label,renderingCopyButton);
        renderingCopyInteraction.success=clipboardValue===renderingCommands[0].command&&notices.length===1&&notices[0].type==='success'&&notices[0].message.includes('Java2D');
        notices=[];
        writeClipboardText=async ()=>{throw new Error('fixture clipboard failure')};
        await copyRemoteGraphicsCommand(encodeURIComponent(renderingCommands[0].command),renderingCommands[0].label,renderingCopyButton);
        renderingCopyInteraction.failure=notices.length===1&&notices[0].type==='error'&&notices[0].message.includes('fixture clipboard failure');
      } finally {
        writeClipboardText=previousWriteClipboardText;
        notify=previousNotify;
      }
      window.__runRemoteRenderingNarrowSmoke=async () => {
        const host=document.createElement('div');
        host.style.cssText='position:fixed;left:8px;top:8px;width:calc(100vw - 16px);opacity:0;pointer-events:none;z-index:99999;display:grid;gap:8px';
        host.innerHTML=Object.values(graphicsRendering).map(item=>remoteGraphicsRenderingMarkup({graphics_rendering:item})).join('')+remoteDiagnosticStatusMarkup('SSH 认证失败，请更新管理凭据后重新探测。',{tone:'error',icon:'circle-alert',title:'SSH 深度探测不可用',actions:'<button type="button"><span>修复 SSH 管理凭据</span></button>'});
        document.body.appendChild(host);
        refreshIcons();
        await new Promise(resolve=>setTimeout(resolve,0));
        const panels=[...host.querySelectorAll('.remote-rendering-state.warning')];
        const diagnostic=host.querySelector('.remote-diagnostic-status');
        const diagnosticRect=diagnostic?.getBoundingClientRect();
        const diagnosticIconRect=diagnostic?.querySelector('.remote-diagnostic-icon')?.getBoundingClientRect();
        const diagnosticCopyRect=diagnostic?.querySelector('.remote-diagnostic-copy')?.getBoundingClientRect();
        const diagnosticActionsRect=diagnostic?.querySelector('.remote-diagnostic-actions')?.getBoundingClientRect();
        const result={
          panels:panels.length,
          copyButtons:panels.every(panel=>panel.querySelectorAll('.remote-rendering-actions button').length===3),
          noHorizontalOverflow:panels.every(panel=>{
            const panelRect=panel.getBoundingClientRect();
            const buttons=[...panel.querySelectorAll('.remote-rendering-actions button')];
            return panel.scrollWidth<=panel.clientWidth+1&&buttons.every(button=>{
              const rect=button.getBoundingClientRect();
              return rect.left>=panelRect.left-1&&rect.right<=panelRect.right+1;
            });
          }),
          diagnosticAligned:Boolean(diagnosticRect&&diagnosticIconRect&&diagnosticCopyRect&&diagnosticActionsRect
            && diagnosticIconRect.left>=diagnosticRect.left-1
            && diagnosticCopyRect.left>diagnosticIconRect.right
            && diagnosticActionsRect.top>=diagnosticCopyRect.bottom-1
            && diagnosticActionsRect.left>=diagnosticRect.left-1
            && diagnosticActionsRect.right<=diagnosticRect.right+1
            && diagnostic.scrollWidth<=diagnostic.clientWidth+1)
        };
        host.remove();
        return {...result,ok:result.panels===3&&result.copyButtons&&result.noHorizontalOverflow&&result.diagnosticAligned};
      };
      const remoteLayoutUi={};
      const measureRemoteLayout=async (protocol, profileId, height) => {
        await openRemoteDesktopForSmoke(profileId,false,'layout-'+protocol);
        const view=document.getElementById('view-remote-desktop');
        const launch=view?.querySelector('.remote-desktop-launch');
        if(!view||!launch) return {protocol,height,ok:false,reason:'remote launch view missing'};
        const previousViewStyle=view.getAttribute('style');
        const previousLaunchStyle=launch.getAttribute('style');
        view.style.setProperty('flex','0 0 '+height+'px');
        view.style.setProperty('height',height+'px');
        launch.style.setProperty('flex','1 1 auto');
        launch.style.setProperty('min-height','0');
        await new Promise(resolve=>setTimeout(resolve,0));
        const launchRect=launch.getBoundingClientRect();
        const topNode=launch.querySelector('h2');
        const actionNode=launch.querySelector('.actions');
        launch.scrollTop=0;
        const topRect=topNode?.getBoundingClientRect();
        const topReachable=Boolean(topRect&&topRect.top>=launchRect.top-1&&topRect.bottom<=launchRect.bottom+1);
        const scrollable=launch.scrollHeight>launch.clientHeight&&getComputedStyle(launch).overflowY==='auto';
        launch.scrollTop=launch.scrollHeight;
        await new Promise(resolve=>setTimeout(resolve,0));
        const bottomRect=actionNode?.getBoundingClientRect();
        const bottomReachable=Boolean(bottomRect&&bottomRect.top>=launchRect.top-1&&bottomRect.bottom<=launchRect.bottom+1);
        const noHorizontalOverflow=launch.scrollWidth<=launch.clientWidth+1&&view.scrollWidth<=view.clientWidth+1;
        const result={protocol,height,scrollable,topReachable,bottomReachable,noHorizontalOverflow,scrollTop:launch.scrollTop,scrollHeight:launch.scrollHeight,clientHeight:launch.clientHeight,ok:Boolean(scrollable&&topReachable&&bottomReachable&&noHorizontalOverflow)};
        if(previousViewStyle===null) view.removeAttribute('style'); else view.setAttribute('style',previousViewStyle);
        if(previousLaunchStyle===null) launch.removeAttribute('style'); else launch.setAttribute('style',previousLaunchStyle);
        return result;
      };
      remoteLayoutUi.rdp=await measureRemoteLayout('rdp',derived.id,320);
      remoteLayoutUi.vnc=await measureRemoteLayout('vnc',vnc.id,320);
      remoteLayoutUi.xdmcp=await measureRemoteLayout('xdmcp',xdmcp.id,320);
      const failureHost=document.createElement('div');
      failureHost.id='vncFailureFixture';
      document.body.appendChild(failureHost);
      const readyFixture={platform:'linux',diagnostics_available:true,status:'ready',installed:true,listening:true,port:5900,service_unit:'tunneldesk-x11vnc.service',service_state:'active',server_mode:'shared-x11',source_display:':10',vnc_process:'123 x11vnc -display :10',server_session_configurable:true,server_session_selection:{requested_mode:'shared',mode:'shared',display:':10',source:{kind:'xrdp',display:':10',user:'root',desktop:'XFCE'},source_available:true,requires_selection:false,component:'x11vnc',install_required:false,component_state:{key:'x11vnc',component:'x11vnc',label:'x11vnc 共享桌面',installed:true,install_required:false,automatic_manageable:true,listening:true,running:true,status:'ready'}},selected_component:{key:'x11vnc',component:'x11vnc',label:'x11vnc 共享桌面',installed:true,install_required:false,automatic_manageable:true,listening:true,running:true,status:'ready'},server_session_selection_matches_running:true,session_sources:[{kind:'xrdp',display:':10',user:'root',desktop:'XFCE',state:'active'}],commands:['x11vnc','vncpasswd'],start_plan:{kind:'x11vnc-session',supports_no_password:true},install_plan:{online:{available:true,command:'apt-get install x11vnc'},offline:{available:true,command:'apt-get --no-download install x11vnc'},local_offline:{available:true,package_names:['x11vnc']}},ssh_connection:{id:Number(connections[0].id),name:connections[0].name}};
      renderVncServerState(readyFixture,vnc.id,'remote-desktop-'+vnc.id,failureHost);
      renderVncServerState({error:'fixture operation failed'},vnc.id,'remote-desktop-'+vnc.id,failureHost);
      const failureText=failureHost.textContent||'';
      const failureSelector=failureHost.querySelector('#vnc_server_session_source_910001');
      const failureActions=[...failureHost.querySelectorAll('.remote-service-actions button')];
      const vncFailureRecovery=Boolean(failureText.includes('fixture operation failed')&&failureSelector&&failureActions.some(button=>button.textContent.includes('卸载服务'))&&failureHost.querySelector('.vnc-server-source'));
      failureHost.remove();
      const componentHost=document.createElement('div');
      componentHost.id='vncComponentFixture';
      document.body.appendChild(componentHost);
      const missingTigerComponent={key:'tigervnc',component:'tigervnc',label:'TigerVNC 独立虚拟桌面',installed:false,wrapper_available:false,raw_server_available:false,install_required:true,automatic_manageable:false,manual_only:false,listening:false,running:false,status:'not-installed',reason:'未检测到 vncserver/tigervncserver 包装器，需要先安装 TigerVNC。'};
      const missingTigerFixture={...readyFixture,server_session_selection:{requested_mode:'virtual',mode:'virtual',display:':1',source:null,source_available:true,requires_selection:false,component:'tigervnc',install_required:true,automatic_manageable:false,manual_only:false,reason:missingTigerComponent.reason,component_state:missingTigerComponent},selected_component:missingTigerComponent,running_component:readyFixture.selected_component,server_session_selection_matches_running:false,source_xrdp:true,start_plan:null,start_plan_reason:missingTigerComponent.reason,install_plan:{package_name:'tigervnc',online:{available:true,command:'apt-get install tigervnc-standalone-server'},offline:{available:true,command:'apt-get --no-download install tigervnc-standalone-server'},local_offline:{available:true,package_names:['tigervnc-standalone-server','tigervnc-common']}}};
      renderVncServerState(missingTigerFixture,vnc.id,'remote-desktop-'+vnc.id,componentHost);
      const missingTigerText=componentHost.textContent||'';
      const missingTigerSource=componentHost.querySelector('.vnc-server-source');
      const missingTigerSelect=componentHost.querySelector('#vnc_server_session_source_910001');
      const missingTigerButtons=[...componentHost.querySelectorAll('.remote-service-actions button')].map(button=>button.textContent.trim());
      const tigerComponentLabel=tr('remote:vnc_status.component_tigervnc');
      const missingTigerUi=Boolean(
        missingTigerText.includes(tr('remote:vnc_status.component_not_installed',{component:tigerComponentLabel}))
        && [tr('remote:install.online'),tr('remote:install.local_offline'),tr('remote:install.remote_cache'),tr('remote:install.manual')].every(label=>missingTigerText.includes(label))
        && missingTigerSource?.textContent.includes(tr('remote:vnc_status.current_running_source'))
        && missingTigerSource?.querySelector('strong')?.textContent.includes('共享 :10')
        && missingTigerSource?.textContent.includes(tr('remote:vnc_status.target_desktop_source'))
        && missingTigerSelect?.value==='virtual'
        && !missingTigerButtons.some(label=>label.includes(tr('remote:vnc_status.start_service'))||label.includes(tr('remote:vnc_status.configure_tigervnc'))||label.includes(tr('remote:vnc_status.apply_source_restart')))
      );
      const rawTigerComponent={...missingTigerComponent,installed:true,raw_server_available:true,manual_only:true,running:true,status:'manual-only',reason:'仅检测到 Xtigervnc/Xvnc 原始 X 服务器，缺少 vncserver/tigervncserver 包装器，Terma 不能自动管理。'};
      const rawTigerFixture={...missingTigerFixture,status:'not-listening',listening:false,service_unit:'',service_state:'manual',server_mode:'virtual',source_display:':1',vnc_process:'654 operator Xtigervnc :1 -rfbport 5900',server_session_selection:{...missingTigerFixture.server_session_selection,install_required:true,manual_only:true,reason:rawTigerComponent.reason,component_state:rawTigerComponent},selected_component:rawTigerComponent,running_component:rawTigerComponent,server_session_selection_matches_running:true,commands:['Xtigervnc','vncpasswd'],start_plan:null,start_plan_reason:rawTigerComponent.reason};
      renderVncServerState(rawTigerFixture,vnc.id,'remote-desktop-'+vnc.id,componentHost);
      const rawTigerText=componentHost.textContent||'';
      const rawTigerSelect=componentHost.querySelector('#vnc_server_session_source_910001');
      const rawTigerButtons=[...componentHost.querySelectorAll('.remote-service-actions button')].map(button=>button.textContent.trim());
      const rawTigerUi=Boolean(
        rawTigerText.includes(tr('remote:vnc_status.component_manual_only',{component:tigerComponentLabel}))
        && rawTigerText.includes(tr('remote:auto.manual_install'))
        && rawTigerText.includes(tr('remote:vnc_status.uninstall_service'))
        && rawTigerSelect?.value==='virtual'
        && !rawTigerButtons.some(label=>label.includes(tr('remote:vnc_status.start_service'))||label.includes(tr('remote:vnc_status.configure_tigervnc')))
      );
      const vncComponentManagementUi=missingTigerUi&&rawTigerUi;
      componentHost.remove();
      document.documentElement.dataset.uiSmokeStage='remote-access-standalone-profiles';
      const vncActionButton=document.createElement('button');
      vncActionButton.innerHTML='<span>停止服务</span>';
      document.body.appendChild(vncActionButton);
      const previousRunVncServerActionImpl=runVncServerActionImpl;
      let vncActionCalls=0;
      let releaseVncAction;
      try {
        runVncServerActionImpl=async()=>{
          vncActionCalls+=1;
          return new Promise(resolve=>{releaseVncAction=resolve});
        };
        const firstVncAction=runVncServerAction(vnc.id,'remote-desktop-'+vnc.id,'stop',vncActionButton);
        const secondVncAction=runVncServerAction(vnc.id,'remote-desktop-'+vnc.id,'uninstall',vncActionButton);
        await new Promise(resolve=>setTimeout(resolve,0));
        const duplicateBlocked=vncActionCalls===1&&vncActionButton.disabled&&vncActionButton.getAttribute('aria-busy')==='true';
        releaseVncAction?.({ok:true});
        await withRemoteSmokeTimeout(Promise.all([firstVncAction,secondVncAction]),'VNC duplicate action');
        var vncServiceActionDebounced=Boolean(duplicateBlocked&&!vncActionButton.disabled&&!vncActionButton.hasAttribute('aria-busy'));
      } finally {
        runVncServerActionImpl=previousRunVncServerActionImpl;
        vncActionButton.remove();
      }
      await openRemoteDesktopForSmoke(macVnc.id,false,'mac-vnc');
      const macVncWorkspace=document.getElementById('view-remote-desktop');
      const macVncWorkspaceText=macVncWorkspace?.textContent||'';
      const macVncBypassesLinuxDesktop=Boolean(
        ['macOS','VNC','fixture'].every(token=>macVncWorkspaceText.includes(token))
        && !macVncWorkspace?.querySelector('.linux-desktop-missing-notice')
        && !macVncWorkspaceText.includes(tr('remote:diagnostics.open_linux_desktop_manager'))
      );
      await openRemoteDesktopForSmoke(standaloneRdp.id,true,'standalone-rdp');
      const standaloneRdpWorkspace=document.getElementById('view-remote-desktop');
      const standaloneRdpKey='remote-desktop-'+standaloneRdp.id;
      const standaloneRdpTab=tabs.find(tab=>tab.key===standaloneRdpKey);
      const standaloneRdpTabNode=document.querySelector('.tab[data-tab-key="'+standaloneRdpKey+'"]');
      const standaloneRdpStatusHidden=Boolean(
        standaloneRdpTab?.protocol==='rdp'
        && standaloneRdpTab.connectionStatus===undefined
        && standaloneRdpTabNode
        && !standaloneRdpTabNode.querySelector('.tab-connection-dot')
      );
      const standaloneRdpLaunch=standaloneRdpWorkspace?.querySelector('#remoteDesktopLaunchButton');
      const standaloneRdpText=standaloneRdpWorkspace?.textContent||'';
      const standaloneRdpDisabled=Boolean(standaloneRdpLaunch?.disabled);
      const standaloneRdpFallback=Boolean(
        standaloneRdpText.includes('RDP 端口可达')
        && standaloneRdpText.includes('未关联 SSH 管理连接')
        && standaloneRdpText.includes('新建 SSH 管理连接')
        && standaloneRdpText.includes('Windows')
        && !standaloneRdpText.includes('XDMCP 设置')
        && !standaloneRdpWorkspace.querySelector('.linux-desktop-missing-notice')
        && standaloneRdpLaunch&&!standaloneRdpDisabled
      );
      const diagnosticPanel=[...standaloneRdpWorkspace.querySelectorAll('.remote-diagnostic-status')].find(panel=>panel.querySelector('.remote-diagnostic-actions'));
      const diagnosticRect=diagnosticPanel?.getBoundingClientRect();
      const diagnosticIconRect=diagnosticPanel?.querySelector('.remote-diagnostic-icon')?.getBoundingClientRect();
      const diagnosticCopyRect=diagnosticPanel?.querySelector('.remote-diagnostic-copy')?.getBoundingClientRect();
      const diagnosticActionsRect=diagnosticPanel?.querySelector('.remote-diagnostic-actions')?.getBoundingClientRect();
      const remoteDiagnosticAlignment=Boolean(diagnosticRect&&diagnosticIconRect&&diagnosticCopyRect&&diagnosticActionsRect
        && Math.abs((diagnosticIconRect.top+diagnosticIconRect.height/2)-(diagnosticRect.top+diagnosticRect.height/2))<=2
        && diagnosticActionsRect.left>=diagnosticCopyRect.right-1
        && diagnosticActionsRect.right<=diagnosticRect.right+1
        && diagnosticPanel.scrollWidth<=diagnosticPanel.clientWidth+1);
      await openRemoteDesktopForSmoke(isolatedVnc.id,true,'standalone-vnc');
      const standaloneVncWorkspace=document.getElementById('view-remote-desktop');
      const standaloneVncText=standaloneVncWorkspace?.textContent||'';
      const standaloneVncDisabled=Boolean(standaloneVncWorkspace?.querySelector('#remoteDesktopLaunchButton')?.disabled);
      const standaloneVncFallback=Boolean(
        standaloneVncText.includes('VNC 端口可达')
        && standaloneVncText.includes('未关联 SSH 管理连接')
        && standaloneVncText.includes('新建 SSH 管理连接')
        && !standaloneVncDisabled
      );
      await openRemoteDesktopForSmoke(standaloneXdmcp.id,true,'standalone-xdmcp');
      const standaloneXdmcpWorkspace=document.getElementById('view-remote-desktop');
      const standaloneXdmcpKey='remote-desktop-'+standaloneXdmcp.id;
      const standaloneXdmcpTab=tabs.find(tab=>tab.key===standaloneXdmcpKey);
      const standaloneXdmcpTabNode=document.querySelector('.tab[data-tab-key="'+standaloneXdmcpKey+'"]');
      const standaloneXdmcpStatusHidden=Boolean(
        standaloneXdmcpTab?.protocol==='xdmcp'
        && standaloneXdmcpTab.connectionStatus===undefined
        && standaloneXdmcpTabNode
        && !standaloneXdmcpTabNode.querySelector('.tab-connection-dot')
      );
      const standaloneXdmcpText=standaloneXdmcpWorkspace?.textContent||'';
      const standaloneXdmcpDisabled=Boolean(standaloneXdmcpWorkspace?.querySelector('#remoteDesktopLaunchButton')?.disabled);
      const standaloneXdmcpFallback=Boolean(
        standaloneXdmcpText.includes('XDMCP 服务已响应')
        && standaloneXdmcpText.includes('WILLING')
        && standaloneXdmcpText.includes('未关联 SSH 管理连接')
        && standaloneXdmcpText.includes('新建 SSH 管理连接')
        && standaloneXdmcpText.includes('直接尝试')
        && !standaloneXdmcpDisabled
      );
      const standaloneFallbackDetails={
        rdp:{text:standaloneRdpText,disabled:standaloneRdpDisabled},
        vnc:{text:standaloneVncText,disabled:standaloneVncDisabled},
        xdmcp:{text:standaloneXdmcpText,disabled:standaloneXdmcpDisabled}
      };
      const macVncHelpHost=document.createElement('div');
      macVncHelpHost.innerHTML=vncConnectionHelpMarkup(macVnc,'macos',false,'connect ECONNREFUSED');
      const macVncSetupGuidance=Boolean(
        macVncHelpHost.textContent.includes('未检测到可用的 VNC 服务')
        && macVncHelpHost.textContent.includes('系统设置 > 通用 > 共享 > 屏幕共享')
        && macVncHelpHost.textContent.includes('远程管理')
        && macVncHelpHost.textContent.includes('允许访问')
        && macVncHelpHost.textContent.includes('VNC 观看者')
        && macVncHelpHost.querySelector('button.primary')?.textContent.includes('重新连接')
        && !macVncHelpHost.textContent.includes('Linux 桌面管理')
      );
      const linuxVncMissingHost=document.createElement('div');
      linuxVncMissingHost.innerHTML=vncConnectionHelpMarkup(vnc,'linux',false,'connect ECONNREFUSED',{platform:'linux',status:'not-installed',can_install:true,port:5900,privileged:false,ssh_connection:{id:connections[0].id,name:connections[0].name},install_plan:{online:{available:true,command:'apt-get install x11vnc'},offline:{available:true,command:'apt-get --no-download install x11vnc'},local_offline:{available:true,package_names:['x11vnc','xclip']}}},'remote-desktop-910001');
      const linuxVncStoppedHost=document.createElement('div');
      linuxVncStoppedHost.innerHTML=vncConnectionHelpMarkup(vnc,'linux',false,'',{platform:'linux',status:'stopped',installed:true,port:5900,service_unit:'x11vnc.service',service_state:'inactive',start_plan:{kind:'service',command:'systemctl start x11vnc.service'}},'remote-desktop-910001');
      const vncServiceDiagnosisUi=Boolean(
        linuxVncMissingHost.textContent.includes('未安装 VNC 服务')
        && linuxVncMissingHost.textContent.includes('在线安装')
        && linuxVncMissingHost.textContent.includes('本机下载后离线安装')
        && linuxVncMissingHost.textContent.includes('使用远端缓存')
        && linuxVncMissingHost.textContent.includes('手动安装/配置说明')
        && linuxVncMissingHost.textContent.includes('TCP 5900')
        && linuxVncStoppedHost.textContent.includes('已安装，但尚未启动')
        && linuxVncStoppedHost.textContent.includes('启动 VNC 服务')
        && linuxVncStoppedHost.textContent.includes('x11vnc.service')
      );
      document.documentElement.dataset.uiSmokeStage='remote-access-x11-and-xserver';
      openX11AppLauncher(Number(connections[0].id));
      await new Promise(resolve=>setTimeout(resolve,0));
      const x11PresetValues=[...document.querySelectorAll('#x11AppPreset option')].map(option=>option.value);
      const x11AppLauncher=Boolean(!document.getElementById('modal').hidden&&['xterm','konsole','custom'].every(value=>x11PresetValues.includes(value))&&document.getElementById('x11AppPreset')?.value==='xterm'&&document.getElementById('x11AppCommand')?.value==='/usr/bin/xterm'&&document.getElementById('x11AppDetection')?.classList.contains('success')&&document.getElementById('x11AppMode')?.value==='untrusted');
      closeX11AppLauncher();
      const x11InstalledApi=api;
      let x11InstalledDialog=false;
      let xServerRemoteUninstall=false;
      let xServerClipboardLayout=false;
      try {
        api=async (path,options) => String(path).endsWith('/x11-applications/install-plan')
          ? {discovery:{platform:'linux',xauth_available:true,applications:[{id:'xterm',label:'XTerm'}]},install_plan:{supported:true,package_manager:'apt',uninstall:{available:true,command:'apt-get purge -y xauth x11-apps xterm'},online:{available:true,command:'apt-get install -y xauth x11-apps xterm'},instructions:[]}}
          : String(path)==='/api/xserver'
            ? {integration_available:true,desktop:true,desktop_backend_available:true,authorization_required:false,platform:'win32',available:true,running:true,managed:true,mode:'bundled',server:'VcXsrv',display:':0.0',can_start:false,can_stop:true,can_install:false}
            : String(path).endsWith('/x11-forwarding')
              ? {platform:'linux',ready:true,x11_forwarding:'yes',sshd_present:true,config_file:'/etc/ssh/sshd_config',xauth_path:'/usr/bin/xauth',xauth_location:'/usr/bin/xauth',x11_display_offset:'10',can_manage:true,can_terminal_manage:true}
              : String(path).endsWith('/x11-clipboard/helper')
                ? {platform:'linux',installed:false,package_manager:'apt',install_plan:{online:{available:true,description:'使用远端 apt 安装 xclip'},offline:{available:true,description:'仅使用远端软件包缓存'},local_offline:{available:true,description:'本机下载 xclip 及依赖，通过 SFTP 上传到远端后安装',package_names:['xclip']},manual:{available:true,description:'查看 X11 转发、DISPLAY、xclip 和权限检查步骤'}},guide:{steps:[],commands:[]},reason:'远端尚未安装 xclip'}
                : x11InstalledApi(path,options);
        await openX11InstallGuide(Number(connections[0].id));
        const installedGuide=document.querySelector('.x11-install-guide');
        x11InstalledDialog=Boolean(
          installedGuide?.textContent.includes('组件安装完成')
          && installedGuide?.textContent.includes('卸载 X11 组件')
          && !installedGuide?.textContent.includes('远端没有完整识别到 xauth')
        );
        closeX11InstallGuide();
        await openXServerManager(Number(connections[0].id));
        const xServerInstalledManager=document.querySelector('.xserver-manager');
        const clipboardPanel=xServerInstalledManager?.querySelector('.xserver-clipboard-panel');
        const clipboardModes=clipboardPanel?.querySelector('.remote-install-modes');
        const clipboardModeButtons=[...clipboardModes?.querySelectorAll('.remote-install-mode')||[]];
        const firstClipboardModeRect=clipboardModeButtons[0]?.getBoundingClientRect();
        const secondClipboardModeRect=clipboardModeButtons[1]?.getBoundingClientRect();
        const thirdClipboardModeRect=clipboardModeButtons[2]?.getBoundingClientRect();
        const clipboardStatus=clipboardPanel?.querySelector(':scope > .connection-test-status');
        const clipboardStatusIconRect=clipboardStatus?.querySelector('svg')?.getBoundingClientRect();
        const clipboardStatusCopyRect=clipboardStatus?.querySelector('span')?.getBoundingClientRect();
        const clipboardStatusCenterDelta=clipboardStatusIconRect&&clipboardStatusCopyRect
          ? Math.abs((clipboardStatusIconRect.top+clipboardStatusIconRect.height/2)-(clipboardStatusCopyRect.top+clipboardStatusCopyRect.height/2))
          : Number.POSITIVE_INFINITY;
        const missingXclipMentions=(clipboardPanel?.textContent.match(/远端尚未安装 xclip/g)||[]).length;
        xServerRemoteUninstall=Boolean(xServerInstalledManager?.textContent.includes('卸载 X11 组件'));
        xServerClipboardLayout=Boolean(
          clipboardPanel
          && clipboardPanel.querySelector('.xserver-clipboard-head > button[onclick*="inspectX11ClipboardHelper"]')
          && clipboardModeButtons.length===4
          && firstClipboardModeRect
          && secondClipboardModeRect
          && thirdClipboardModeRect
          && Math.abs(firstClipboardModeRect.top-secondClipboardModeRect.top)<=1
          && thirdClipboardModeRect.top>firstClipboardModeRect.top+1
          && clipboardPanel.scrollWidth<=clipboardPanel.clientWidth+1
          && clipboardStatusCenterDelta<=1
          && missingXclipMentions===1
        );
        closeXServerManager();
      } finally {
        api=x11InstalledApi;
        closeX11InstallGuide();
        closeXServerManager();
      }
      api=previousApi;
      const xServerImmediateApi=api;
      let releaseXServerImmediate=null;
      let xServerImmediateCalls=0;
      try {
        api=async (path,options) => {
          if(String(path)==='/api/xserver'){
            xServerImmediateCalls+=1;
            return new Promise(resolve=>{
              releaseXServerImmediate=()=>resolve({integration_available:true,desktop:true,desktop_backend_available:true,authorization_required:false,platform:'win32',available:true,running:true,managed:true,mode:'bundled',server:'VcXsrv',display:':0.0',can_start:false,can_stop:true,can_install:false});
            });
          }
          return xServerImmediateApi(path,options);
        };
        const openingXServer=openXServerManager();
        await new Promise(resolve=>setTimeout(resolve,0));
        const immediateModal=document.querySelector('.xserver-manager');
        const duplicateXServerResult=await openXServerManager();
        var xServerImmediateLoading=Boolean(
          !document.getElementById('modal').hidden
          && immediateModal?.textContent.includes('正在打开 X Server 管理')
          && immediateModal.querySelector('.xserver-state.loading svg')
          && xServerManagerOpening
          && duplicateXServerResult===false
          && xServerImmediateCalls===1
        );
        releaseXServerImmediate?.();
        await openingXServer;
        closeXServerManager();
      } finally {
        releaseXServerImmediate?.();
        api=xServerImmediateApi;
        closeXServerManager();
      }
      await openXServerManager();
      const themeProbe=document.createElement('div');
      themeProbe.style.background='var(--panel)';
      document.body.appendChild(themeProbe);
      const xServerManager=Boolean(!document.getElementById('modal').hidden&&document.querySelector('.xserver-manager')&&getComputedStyle(document.querySelector('.xserver-manager')).backgroundColor===getComputedStyle(themeProbe).backgroundColor);
      themeProbe.remove();
      closeXServerManager();
      const quickX11Connection={id:-910011,name:'smoke@192.0.2.11',ssh_host:'192.0.2.11',ssh_port:22,ssh_user:'smoke',auth_type:'password',x11_mode:'off',quick_connection:true,quick_token:'ui-smoke-token'};
      quickConnectionsById.set(quickX11Connection.id,quickX11Connection);
      const quickXServerApi=api;
      const quickXServerPreviousActiveTabKey=activeTabKey;
      terminalSessions.set('quick-terminal-ui-smoke',{connection:quickX11Connection});
      activeTabKey='quick-terminal-ui-smoke';
      try {
        api=async path => String(path)==='/api/xserver'
          ? {integration_available:true,desktop:true,desktop_backend_available:true,authorization_required:false,platform:'linux',available:true,running:true,managed:true,mode:'native',server:'X11',display:':0.0',can_start:false,can_stop:false,can_install:false}
          : String(path)==='/api/connections/'+quickX11Connection.id+'/x11-forwarding'
            ? {platform:'linux',ready:true,enabled:true,x11_forwarding:'yes',sshd_present:true,config_present:true,config_file:'/etc/ssh/sshd_config',xauth_path:'/usr/bin/xauth',xauth_location:'/usr/bin/xauth',x11_display_offset:'10',can_manage:false,can_terminal_manage:true,terminal_commands:{disable:'sudo test-only-disable'}}
            : quickXServerApi(path);
        await openXServerManager();
        const quickManager=document.querySelector('.xserver-manager');
        const quickManagerText=quickManager?.textContent||'';
        var quickXServerManager=Boolean(
          quickManagerText.includes('远端 SSH X11 组件与转发 · smoke@192.0.2.11（临时）')
          && quickManagerText.includes('重新检测')
          && quickManagerText.includes('临时授权后关闭')
          && quickManagerText.includes('在终端手动关闭')
          && quickManagerText.includes('临时打开 X11 终端')
          && quickManagerText.includes('卸载 X11 组件')
          && Boolean(quickManager?.querySelector('button[onclick*="uninstallRemoteX11Components"]'))
          && quickManagerText.includes('不会保存默认 X11 配置')
          && !quickManagerText.includes('普通终端默认启用')
          && xServerManagerConnectionId===quickX11Connection.id
          && xServerManagerTerminalKey==='quick-terminal-ui-smoke'
        );
        closeXServerManager();
      } finally {
        api=quickXServerApi;
        activeTabKey=quickXServerPreviousActiveTabKey;
        terminalSessions.delete('quick-terminal-ui-smoke');
        quickConnectionsById.delete(quickX11Connection.id);
      }
      const xServerApi=api;
      try {
        api=async (path,options) => String(path)==='/api/xserver'
          ? {integration_available:false,desktop:false,desktop_backend_available:false,authorization_required:false,reason:'当前连接的是独立 Web/测试后端，无法读取运行 Terma 桌面设备上的 X Server',server_side:{platform:'win32',available:false,running:false,display:''},can_start:false,can_stop:false,can_install:false}
          : xServerApi(path,options);
        await openXServerManager();
        const unavailableManager=document.querySelector('.xserver-manager');
        const unavailableText=unavailableManager?.textContent||'';
        const unavailableActions=[...unavailableManager?.querySelectorAll('.actions button')||[]].map(button=>button.textContent.trim());
        var xServerDesktopIntegrationUnavailable=Boolean(
          unavailableText.includes('当前连接的是独立 Web/测试后端，无法读取运行 Terma 桌面设备上的 X Server')
          && unavailableText.includes('桌面集成不可用')
          && !unavailableText.includes('X Server 未启动')
          && !unavailableActions.some(label=>['启动','停止','安装 Linux 图形组件','安装 XQuartz'].includes(label))
        );
        closeXServerManager();
        api=async (path,options) => String(path)==='/api/xserver'
          ? {
              integration_available:false,
              desktop:false,
              desktop_backend_available:true,
              authorization_required:true,
              can_request_authorization:true,
              reason:'当前浏览器会话没有桌面集成权限。X Server 正在运行，但启动、停止和本机程序调用只能在 Terma 桌面端执行。',
              server_side:{platform:'win32',available:true,running:true,display:':0.0'},
              available:true,
              running:true
            }
          : xServerApi(path,options);
        await openXServerManager();
        const browserAuthorizationManager=document.querySelector('.xserver-manager');
        const browserAuthorizationText=browserAuthorizationManager?.textContent||'';
        var xServerBrowserAuthorization=Boolean(
          browserAuthorizationText.includes('等待桌面授权')
          && browserAuthorizationText.includes('当前浏览器会话没有桌面集成权限。X Server 正在运行，但启动、停止和本机程序调用只能在 Terma 桌面端执行。')
          && browserAuthorizationText.includes('申请授权')
          && browserAuthorizationManager?.querySelector('[data-role="desktop-integration-duration"] option[value="browser-session"]')?.textContent.includes('最长 12 小时')
          && browserAuthorizationManager?.querySelector('[data-role="desktop-integration-custom-minutes"][max="480"]')
          && browserAuthorizationManager?.querySelector('[data-action="desktop-integration-authorize"][data-scopes="xserver"]')
          && !browserAuthorizationText.includes('独立 Web/测试后端')
        );
        closeXServerManager();
        api=async (path,options) => String(path)==='/api/xserver'
          ? {
              integration_available:true,
              desktop:true,
              desktop_backend_available:true,
              authorization_required:false,
              authorization_kind:'local-direct',
              platform:'win32',
              available:true,
              running:true,
              managed:true,
              mode:'bundled',
              server:'VcXsrv',
              display:':0.0',
              can_start:false,
              can_stop:true,
              can_install:false
            }
          : xServerApi(path,options);
        await openXServerManager();
        const localDirectManager=document.querySelector('.xserver-manager');
        const localDirectManagerText=localDirectManager?.textContent||'';
        var xServerLocalDirectAuthorization=Boolean(
          localDirectManagerText.includes('本机直连自动授权')
          && localDirectManagerText.includes('浏览器权限')
          && !localDirectManagerText.includes('申请授权')
        );
        closeXServerManager();
      } finally {
        api=xServerApi;
      }
      const modal=document.getElementById('modal');
      modal.hidden=false;
      modal.innerHTML='<div class="modal-card xserver-manager"><div class="modal-title-row"><div><h2>Adaptive modal</h2><span>long diagnostics</span></div><button class="icon-button" type="button">'+icon('x')+'</button></div><div style="height:1200px">long body</div><div class="actions"><button>cancel</button><button>confirm</button></div></div>';
      const adaptiveCard=modal.querySelector('.modal-card');
      const adaptiveTitle=adaptiveCard.querySelector('.modal-title-row');
      const adaptiveActions=adaptiveCard.querySelector('.actions');
      adaptiveCard.scrollTop=adaptiveCard.scrollHeight;
      await new Promise(resolve=>setTimeout(resolve,0));
      const adaptiveRect=adaptiveCard.getBoundingClientRect();
      const adaptiveTitleRect=adaptiveTitle.getBoundingClientRect();
      const adaptiveActionsRect=adaptiveActions.getBoundingClientRect();
      const adaptiveCloseRect=adaptiveTitle.querySelector('.icon-button').getBoundingClientRect();
      const adaptiveStyle=getComputedStyle(adaptiveCard);
      const adaptiveModal=Boolean(
        adaptiveCard.scrollHeight>adaptiveCard.clientHeight
        && adaptiveStyle.overflowY==='auto'
        && adaptiveRect.top>=-1
        && adaptiveRect.bottom<=innerHeight+1
        && Math.abs(adaptiveTitleRect.top-adaptiveRect.top)<=2
        && adaptiveTitleRect.bottom<=adaptiveRect.bottom+1
        && adaptiveActionsRect.top>=adaptiveRect.top-1
        && Math.abs(adaptiveActionsRect.bottom-adaptiveRect.bottom)<=2
      );
      const adaptiveModalMetrics={
        scrollHeight:adaptiveCard.scrollHeight,
        clientHeight:adaptiveCard.clientHeight,
        overflowY:adaptiveStyle.overflowY,
        viewportHeight:innerHeight,
        card:{top:adaptiveRect.top,bottom:adaptiveRect.bottom},
        title:{top:adaptiveTitleRect.top,bottom:adaptiveTitleRect.bottom},
        actions:{top:adaptiveActionsRect.top,bottom:adaptiveActionsRect.bottom}
      };
      const modalHeaderControlsAligned=Boolean(
        adaptiveCloseRect.top>=adaptiveTitleRect.top
        && adaptiveCloseRect.bottom<=adaptiveTitleRect.bottom
        && adaptiveCloseRect.left>adaptiveTitleRect.left+adaptiveTitleRect.width/2
      );
      let backdropDismissed=false;
      modal.onclick=()=>{backdropDismissed=true;modal.hidden=true;};
      modal.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
      const modalBackdropLocked=!backdropDismissed&&!modal.hidden;
      modal.onclick=null;
      modal.hidden=true;
      modal.innerHTML='';
      healthResults.set(Number(connections[0].id),{ok:true,status:'正常'});
      renderConnections();
      const healthRow=[...document.querySelectorAll('.conn-row')].find(row=>row.querySelector('.conn-name')?.textContent===connections[0].name);
      const healthBadge=healthRow?.querySelector('.health-badge');
      const healthIconOnly=Boolean(healthBadge&&!healthBadge.textContent.trim()&&healthBadge.getAttribute('aria-label')?.includes('正常'));
      primaryView='connections';
      renderExplorerTools();
      applyOperationPaneWidth(OPERATION_PANE_WIDTH_DEFAULT,{fit:false});
      await new Promise(resolve=>setTimeout(resolve,0));
      const defaultAddSshButton=document.querySelector('#explorerTools .explorer-main-action');
      const defaultAddSshLabel=defaultAddSshButton?.querySelector('span');
      const defaultAddSshRect=defaultAddSshButton?.getBoundingClientRect();
      const defaultAddSshLabelRect=defaultAddSshLabel?.getBoundingClientRect();
      const defaultAddSshTextFits=Boolean(defaultAddSshButton?.textContent.includes('添加 SSH')
        && defaultAddSshRect&&defaultAddSshLabelRect
        && defaultAddSshLabelRect.right<=defaultAddSshRect.right-4
        && defaultAddSshButton.scrollWidth<=defaultAddSshButton.clientWidth+1);
      applyOperationPaneWidth(OPERATION_PANE_WIDTH_MIN,{fit:false});
      await new Promise(resolve=>setTimeout(resolve,0));
      const brand=document.querySelector('.brand');
      const brandRect=brand?.getBoundingClientRect();
      const brandButtons=[...document.querySelectorAll('.brand .side-actions button')].map(button=>button.getBoundingClientRect());
      const narrowBrandActionsFit=Boolean(brandRect&&brandButtons.length&&brandButtons.every(rect=>rect.left>=brandRect.left-.5&&rect.right<=brandRect.right+.5&&rect.top>=brandRect.top-.5&&rect.bottom<=brandRect.bottom+.5));
      const brandName=document.querySelector('.brand-name-full');
      const brandNameRect=brandName?.getBoundingClientRect();
      const expandedBrandNameVisible=Boolean(brandName?.textContent.trim()==='Terma'
        && getComputedStyle(brandName).display!=='none'
        && brandNameRect?.width>0
        && brandNameRect.right<=brandRect.right+1);
      const narrowAddSshButton=document.querySelector('#explorerTools .explorer-main-action');
      const narrowAddSshTextFits=Boolean(narrowAddSshButton?.textContent.includes('添加 SSH')
        && narrowAddSshButton.scrollWidth<=narrowAddSshButton.clientWidth+1);
      return {rdpDisplayForm,vncModePersisted,vncImageSyncOptOut,vncPasswordForm,vncRetryPrompt,vncRetryValue,vncNoPassword,sshCredentialRepairUi,quickTerminalCredentialRepairUi,ftpCredentialRepairUi,vncServiceDiagnosisUi,vncServiceActionDebounced,xdmcpForm,xdmcpMenuAvailable,xdmcpSessionSemantics,xdmcpAuthorizationLayout,standaloneRdpFallback,standaloneRdpStatusHidden,standaloneVncFallback,standaloneXdmcpFallback,standaloneXdmcpStatusHidden,standaloneFallbackDetails,remoteDiagnosticAlignment,graphicsRendering:renderingUi,renderingCopyInteraction,vncSourceSelection,vncSourceRefreshInPlace,remoteLayoutUi,vncFailureRecovery,vncComponentManagementUi,vncComponentDiagnostics:{missingTigerUi,rawTigerUi,missingTigerText,rawTigerText,missingTigerButtons,rawTigerButtons},xdmcpWorkspaceText,macVncBypassesLinuxDesktop,macVncWorkspaceText,macVncSetupGuidance,remoteActivitySeparated,remoteActivityChecks,remoteHostStickyStyle,remoteHostStickyFollowsOuter,derivedSourcePresentation,remoteNameDoubleClickOpens,remoteDesktopSwitchAvailable,remoteDesktopSwitchProfiles:remoteDesktopSwitchProfiles(derived.id).map(profile=>profile.name),remoteDesktopSingleDisabled,remoteDesktopSwitchMenuComplete,remoteDesktopSwitchMenu,sshActivitySeparated,x11AppLauncher,x11InstalledDialog,xServerRemoteUninstall,xServerClipboardLayout,xServerImmediateLoading,xServerManager,quickXServerManager,xServerDesktopIntegrationUnavailable,xServerBrowserAuthorization,xServerLocalDirectAuthorization,adaptiveModal,adaptiveModalMetrics,modalHeaderControlsAligned,modalBackdropLocked,healthIconOnly,narrowBrandActionsFit,expandedBrandNameVisible,defaultAddSshTextFits,narrowAddSshTextFits};
    } finally {
      applyOperationPaneWidth(previousOperationWidth,{fit:false});
      api=previousApi;
      connections=previousConnections;
      remoteProfiles=previousProfiles;
      remoteConnectionSearch=previousRemoteSearch;
      remoteDesktopQuickOpen=previousRemoteDesktopQuickOpen;
      selectedRemoteProfileId=previousSelected;
      primaryView=previousPrimaryView;
      document.getElementById('view-edit').innerHTML=previousEditHtml;
      closeX11AppLauncher();
      closeXServerManager();
      renderConnections();
    }
  })()`);
  window.setAlwaysOnTop(false);
  const dark = await window.webContents.executeJavaScript(`(async () => {
    const testStyle = document.createElement('style');
    testStyle.textContent = '*{transition:none!important}';
    document.head.appendChild(testStyle);
    applyTheme('dark');
    await new Promise(resolve => setTimeout(resolve, 50));
    const button = document.querySelector('button');
    const style = getComputedStyle(button);
    const root = getComputedStyle(document.documentElement);
    const glassFixture=document.createElement('div');
    glassFixture.innerHTML='<div class="toast"></div><div class="sftp-task-center-drawer"></div>';
    glassFixture.style.cssText='position:absolute;visibility:hidden;inset:0;pointer-events:none';
    document.body.appendChild(glassFixture);
    const toastStyle=getComputedStyle(glassFixture.firstElementChild);
    const drawerStyle=getComputedStyle(glassFixture.lastElementChild,'::after');
    const result = {theme:document.documentElement.dataset.theme,panel:root.getPropertyValue('--panel').trim(),buttonPanel:style.getPropertyValue('--panel').trim(),buttonBackground:style.backgroundColor,buttonColor:style.color,glass:Boolean(toastStyle.backgroundColor!=='rgba(0, 0, 0, 0)'&&drawerStyle.backgroundColor!=='rgba(0, 0, 0, 0)'&&toastStyle.color!=='rgba(0, 0, 0, 0)')};
    glassFixture.remove();
    applyTheme('light');
    testStyle.remove();
    return result;
  })()`);
  const visual = await runVisualRegression(window);
  if (screenshotEnabled) {
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(diagnosticsDirectory, "ui-smoke-desktop.png"), image.toPNG());
  }
  await window.webContents.executeJavaScript("document.documentElement.dataset.uiSmokeStage='mobile-layout'");
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
  await window.webContents.executeJavaScript("document.documentElement.dataset.uiSmokeStage='mobile-linux-desktop-toolbar'");
  linuxDesktopToolbarUi.narrow=await window.webContents.executeJavaScript("window.__runLinuxDesktopToolbarSmoke()");
  await window.webContents.executeJavaScript("delete window.__runLinuxDesktopToolbarSmoke");
  await window.webContents.executeJavaScript("document.documentElement.dataset.uiSmokeStage='mobile-remote-rendering'");
  remoteAccessUi.narrowRendering=await window.webContents.executeJavaScript("window.__runRemoteRenderingNarrowSmoke()");
  await window.webContents.executeJavaScript("delete window.__runRemoteRenderingNarrowSmoke");
  await window.webContents.executeJavaScript("document.documentElement.dataset.uiSmokeStage='mobile-scenario'");
  const mobile = await runMobileScenario(window);
  if (!screenshotEnabled) window.hide();
  if (screenshotEnabled) {
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(diagnosticsDirectory, "ui-smoke-mobile.png"), image.toPNG());
  }
  if (process.env.TERMA_UI_SMOKE_VERBOSE === "1") {
    console.log(JSON.stringify({ ...result, noVncModuleUi, languageOnboardingUi, forwardTemplateLayoutUi, cspViolations, refreshStateUi, workspaceTabDragUi, workspaceDockingUi, workspaceTabVisibilityUi, workspaceHeaderResizeUi, pages, navigationUi, aboutUi, desktopMenu, runningActions, authUi, connectionStartupUi, saveAndClearUi, notificationUi, restoreKeyUi, restoreCredentialUi, terminalUi, terminalStartupUi, logSettingsUi, sftpUi, productivityUi, remoteAdminUi, linuxDesktopToolbarUi, remoteAccessUi, clipboardUi, dark, visual, mobile, errors }, null, 2));
  }
  const operationPagesFailed = pages.some(page => page.scrollWidth > page.width || !page.toolFits || !page.layoutMode || !page.compactHeight);
  const failedOperationPages = pages.filter(page => page.scrollWidth > page.width || !page.toolFits || !page.layoutMode || !page.compactHeight);
  const overflow = pages.some(page => page.scrollWidth > page.width) || mobile.scrollWidth > mobile.width || mobile.bodyWidth > mobile.width;
  const darkFailed = dark.theme !== "dark" || dark.buttonBackground === "rgb(255, 255, 255)" || !dark.glass;
  const menuFailed = !desktopMenu.opened || !desktopMenu.duplicateConnection || !desktopMenu.simplifiedMenu || !desktopMenu.leftAligned || !desktopMenu.submenuLeftAligned || !desktopMenu.parentStaysOpen || !desktopMenu.submenu || !desktopMenu.generateAll || !desktopMenu.closedOnScroll || !mobile.menuOpened || !mobile.menuClosed;
  const refreshStateUiFailed = !refreshStateUi.found || !refreshStateUi.collapsedBeforeRefresh || !refreshStateUi.collapsedAfterRefresh || !refreshStateUi.collapsePersisted || !refreshStateUi.explicitSelectionReopens || !refreshStateUi.runningCountLive || !refreshStateUi.failureCountLive || !refreshStateUi.startupLabelsBelowNumbers || !refreshStateUi.oldStartupLabelsRemoved;
  const workspaceTabDragUiFailed = !workspaceTabDragUi.beganImmediately || !workspaceTabDragUi.activatedOnPress || !workspaceTabDragUi.dragGhostVisible || !workspaceTabDragUi.dropPositionVisible || !workspaceTabDragUi.dropPositionRemoved || !workspaceTabDragUi.dragGhostRemoved || !workspaceTabDragUi.touchReady || !workspaceTabDragUi.commonTitleFits || !workspaceTabDragUi.numberedSessionTitleFits || !workspaceTabDragUi.compactKindLabels || !workspaceTabDragUi.distinctKindIcons || !workspaceTabDragUi.remoteProtocolTitlesCompact || JSON.stringify(workspaceTabDragUi.remoteProtocolLetters) !== JSON.stringify(['R','V','X']) || !workspaceTabDragUi.remoteProtocolMonitorBadges || !workspaceTabDragUi.remoteProtocolThemeAware || !workspaceTabDragUi.activeSelectionVisible || !workspaceTabDragUi.tabFontWithinResizeRange || !workspaceTabDragUi.shortTabUsesContentWidth || !workspaceTabDragUi.fullTitleTooltip || JSON.stringify(workspaceTabDragUi.liveOrder) !== JSON.stringify(['drag-a','drag-b','drag-c']) || JSON.stringify(workspaceTabDragUi.savedOrder) !== JSON.stringify(['drag-b','drag-c','drag-a']) || JSON.stringify(workspaceTabDragUi.persistedOrder) !== JSON.stringify(['drag-b','drag-c','drag-a']) || !workspaceTabDragUi.activeFollowsDragged || !workspaceTabDragUi.clickSuppressed || !workspaceTabDragUi.cancelStarted || !workspaceTabDragUi.cancelRestored || !workspaceTabDragUi.closeDoesNotDrag || !workspaceTabDragUi.fallbackMove || !workspaceTabDragUi.scrollControlsVisible || !workspaceTabDragUi.scrollControlsHideWhenFit || !workspaceTabDragUi.nativeScrollbarHidden || !workspaceTabDragUi.wheelScrollsTabs;
  const workspaceTabCloseUiFailed = !workspaceTabCloseUi.remoteStatusDotVisible
    || !workspaceTabCloseUi.systemRemoteStatusHidden
    || !workspaceTabCloseUi.systemRemoteClosesImmediately
    || !workspaceTabCloseUi.connectedPrompt
    || !workspaceTabCloseUi.backdropIgnored
    || !workspaceTabCloseUi.escapePreservesTabs
    || !workspaceTabCloseUi.cancelPreservesTabs
    || !workspaceTabCloseUi.multiPromptListsNames
    || !workspaceTabCloseUi.confirmed
    || !workspaceTabCloseUi.disconnectedClosesImmediately
    || !workspaceTabCloseUi.withinViewport;
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
  const workspaceStartupRestoreUiFailed = !workspaceStartupRestoreUi.storageProtected
    || !workspaceStartupRestoreUi.restoredThreeTabs
    || !workspaceStartupRestoreUi.activeRestored;
  const workspaceTabVisibilityUiFailed = !workspaceTabVisibilityUi.switchKeepsActiveVisible
    || !workspaceTabVisibilityUi.resizeKeepsActiveVisible
    || !workspaceTabVisibilityUi.dragKeepsActiveVisible
    || !workspaceTabVisibilityUi.splitSourceActivePreserved
    || !workspaceTabVisibilityUi.splitSourceActiveVisible
    || !workspaceTabVisibilityUi.splitSourceDidNotJumpLast
    || !workspaceTabVisibilityUi.splitSourceScrollNearPrevious
    || !workspaceTabVisibilityUi.localSplitCreated
    || !workspaceTabVisibilityUi.splitSourceOrderPreserved
    || !workspaceTabVisibilityUi.splitSourceActiveIndexPreserved;
  const workspaceHeaderResizeUiFailed = !workspaceHeaderResizeUi.found
    || !workspaceHeaderResizeUi.classicAppearance
    || !workspaceHeaderResizeUi.accessible
    || !workspaceHeaderResizeUi.minClamped
    || !workspaceHeaderResizeUi.maxClamped
    || !workspaceHeaderResizeUi.brandAligned
    || !workspaceHeaderResizeUi.textScales
    || !workspaceHeaderResizeUi.controlsScale
    || !workspaceHeaderResizeUi.controlsUnclipped
    || !workspaceHeaderResizeUi.resizeHandlesPlaced
    || !workspaceHeaderResizeUi.resizeHandlesHitTestable
    || !workspaceHeaderResizeUi.pointerLifecycle
    || !workspaceHeaderResizeUi.heightPersisted
    || !workspaceHeaderResizeUi.keyboardControls
    || !workspaceHeaderResizeUi.doubleClickResets
    || !workspaceHeaderResizeUi.heightRestored
    || !workspaceHeaderResizeUi.tabStorageIndependent;
  const runningActionsFailed = !runningActions.found || !runningActions.fits || !runningActions.compact || !runningActions.iconOnly || !runningActions.overviewLabelsBelowNumbers;
  const authUiFailed = !authUi.found || !Object.values(authUi.passwordMode).every(Boolean) || !Object.values(authUi.keyMode).every(Boolean) || !authUi.passwordEyeToggle;
  const connectionStartupUiFailed = !Object.values(connectionStartupUi).every(value => Array.isArray(value) ? value.length > 0 : Boolean(value))
    || !connectionStartupUi.categories.includes('Shell')
    || !connectionStartupUi.categories.includes('交互式语言')
    || !connectionStartupUi.categories.includes('会话工具');
  const saveAndClearUiFailed = !Object.values(saveAndClearUi).every(Boolean);
  const notificationUiFailed = notificationUi.replayed !== 0 || !notificationUi.initialized || notificationUi.cursor !== notificationUi.stored || !notificationUi.categoryControls || !notificationUi.floatingUnderNotifications || !notificationUi.successSuppressed || !notificationUi.infoVisible || !notificationUi.progressSuppressed;
  const restoreKeyUiFailed = !restoreKeyUi.opened || restoreKeyUi.rowCount !== 12 || JSON.stringify(restoreKeyUi.originalNames) !== JSON.stringify(['old-key-a','old-key-b']) || restoreKeyUi.candidates.length !== 3 || !restoreKeyUi.candidates.some(item=>item.includes('id_ed25519_demo')) || !restoreKeyUi.candidates.some(item=>item.includes('id_rsa_project')) || !restoreKeyUi.candidateValuePreserved || !restoreKeyUi.stagesWindowsPath || !restoreKeyUi.backdropIgnored || !restoreKeyUi.continuedWithUnbound || !restoreKeyUi.continuedAllUnbound || !restoreKeyUi.configAllowsUnbound || !restoreKeyUi.configSortEditable || !restoreKeyUi.acceptsAll || !restoreKeyUi.uploadDirectory || !restoreKeyUi.actions || !restoreKeyUi.statusReady || !restoreKeyUi.cardWithinViewport || !restoreKeyUi.closed;
  const restoreCredentialUiFailed = !restoreCredentialUi.opened || !restoreCredentialUi.backdropIgnored || !restoreCredentialUi.originalLabels.some(item=>item.includes('私钥：id_old')) || !restoreCredentialUi.originalLabels.some(item=>item.includes('备份含密码')) || !restoreCredentialUi.originalLabels.some(item=>item.includes('备份未包含密码')) || !restoreCredentialUi.initialStatuses.includes('保留备份密码') || !restoreCredentialUi.stagedStatuses.some(item=>item.includes('将绑定：id_key')) || !restoreCredentialUi.stagedStatuses.includes('将使用新密码') || !restoreCredentialUi.preservesSavedPassword || !restoreCredentialUi.replacesMissingPassword || !restoreCredentialUi.bindsKey || !restoreCredentialUi.sortFields || !restoreCredentialUi.updatesSort || !restoreCredentialUi.preservesSort || !restoreCredentialUi.cardWithinViewport || !restoreCredentialUi.closed;
  const settingsSectionsFailed = navigationUi.settingsChecks.some(item=>item.visible.length!==1||item.visible[0]!==item.requested||item.active.length!==1||item.active[0]!==item.requested) || navigationUi.aboutVisible?.length!==1 || navigationUi.aboutVisible?.[0]!=='settings-about' || navigationUi.aboutActive?.length!==1 || navigationUi.aboutActive?.[0]!=='settings-about';
  const importSectionsFailed = navigationUi.importChecks.some(item=>item.visible.length!==1||item.visible[0]!==item.requested||item.active.length!==1||item.active[0]!==item.requested);
  const importSourceCheck = navigationUi.importChecks.find(item => item.requested === 'import-source');
  const runtimeUi = navigationUi.runtimeUi || {};
  const i18nUi = navigationUi.i18nUi || {};
  const thirdPartyLiveSwitch = i18nUi.thirdPartyLiveSwitch || {};
  const thirdPartyLiveSwitchFailed = thirdPartyLiveSwitch.scenario !== 'third-party-live-language-switch'
    || !thirdPartyLiveSwitch.aceSeededChinese
    || !thirdPartyLiveSwitch.zmodemSeededChinese
    || !thirdPartyLiveSwitch.aceClean
    || !thirdPartyLiveSwitch.zmodemClean
    || !thirdPartyLiveSwitch.zmodemLocalizedTitle
    || !thirdPartyLiveSwitch.zmodemUserTextPreserved;
  const sessionUi = navigationUi.sessionUi || {};
  const authPolicyUi = navigationUi.authPolicyUi || {};
  const localDirectUi = navigationUi.localDirectUi || {};
  const runtimeUiFailed = !runtimeUi.found || runtimeUi.port !== '18100' || JSON.stringify(runtimeUi.selectedHosts) !== JSON.stringify(['0.0.0.0']) || !runtimeUi.sftpSettingsAbsent || !runtimeUi.terminalLatencySettingChecked || !runtimeUi.wildcardCollapsed || runtimeUi.urlLinks.length !== 2 || !runtimeUi.urlLinks.some(url=>url.includes('192.0.2.10:18100')) || !runtimeUi.restartNotice;
  const sessionUiFailed = sessionUi.ttl !== '720' || sessionUi.max !== '1000' || sessionUi.cleanup !== '10' || !sessionUi.active || !sessionUi.save;
  const activityUiFailed = result.activity.count !== 11 || !result.activity.iconCentered || !result.activity.centersAligned || !result.activity.insideColumn || !result.activity.resizable || !result.activityUtilities;
  const appearanceEffectsUiFailed = Object.values(appearanceEffectsUi).some(value => value !== true);
  const navigationUiFailed = !navigationUi.settingsOnlySections || !navigationUi.settingsSectionMode || !navigationUi.settingsVertical || i18nUi.language !== 'en-US' || i18nUi.settingsTitle !== 'General' || i18nUi.activityTitle !== 'Switch to Simplified Chinese' || i18nUi.mobileTitle !== 'Switch to Simplified Chinese' || !i18nUi.activityOrder || !i18nUi.persisted || !i18nUi.settingsSelectorRemoved || i18nUi.visibleHan?.length || thirdPartyLiveSwitchFailed || !i18nUi.resumeButton || !i18nUi.pauseButton || !i18nUi.tasksPreserved || !i18nUi.tabsPreserved || !navigationUi.themeUi?.entryHidden || !navigationUi.themeUi?.controlsHidden || !navigationUi.themeUi?.oldConfigIgnored || !navigationUi.themeUi?.clearPreset || !navigationUi.themeUi?.noEffects || !navigationUi.themeUi?.zeroBlur || !navigationUi.cacheUi?.selected || !navigationUi.cacheUi?.panel || navigationUi.cacheUi?.categories !== 6 || !navigationUi.cacheUi?.beforeAbout || !navigationUi.cacheUi?.absentFromGeneral || !navigationUi.storageAlignmentUi?.found || !navigationUi.storageAlignmentUi?.topAligned || !navigationUi.storageAlignmentUi?.bottomAligned || !navigationUi.storageMigrationUi?.controlsFound || !navigationUi.storageMigrationUi?.threeChoices || !navigationUi.storageMigrationUi?.cancelBlockedRequest || !navigationUi.storageMigrationUi?.oneMigrationRequest || !navigationUi.storageMigrationUi?.migrationRequested || settingsSectionsFailed || runtimeUiFailed || sessionUiFailed || !authPolicyUi.redundantCheckboxRemoved || !authPolicyUi.localOnlyLabel || !authPolicyUi.alwaysLabel || !authPolicyUi.directDefinition || !localDirectUi.control || !localDirectUi.defaultOff || !localDirectUi.policyCopy || !localDirectUi.enabled || !localDirectUi.proxyBlocked || navigationUi.duplicateSettingsNav !== 0 || navigationUi.inlineUpdateDotPresent || !navigationUi.importOwnSections || !navigationUi.importSectionMode || !navigationUi.importVertical || !navigationUi.importResultsMerged || !importSourceCheck?.resultsVisible || importSectionsFailed || !navigationUi.treeHidden || navigationUi.dotsBeforeRead.some(dot=>!dot.found||dot.hidden!==false) || navigationUi.dotsAfterRead.some(dot=>!dot.found||dot.hidden!==true) || navigationUi.storedReadVersion !== '1.0.9' || !navigationUi.sameVersionStaysRead || !navigationUi.ignoredVersionHidesNotice || !navigationUi.newerAfterIgnoredShowsNotice || !navigationUi.republishedShowsNotice || !navigationUi.republishedReadMarksNotice || !navigationUi.newerVersionShowsAgain;
  const aboutUiFailed = Boolean(aboutUi.error) || !aboutUi.found || !aboutUi.aboutSelected || aboutUi.duplicateSettingsNav !== 0 || !aboutUi.versionMatches || !aboutUi.licenseMetadata || !aboutUi.sourceLink || !aboutUi.modalOpen || !aboutUi.accessible || !aboutUi.fullText || !aboutUi.textScrollable || !aboutUi.cardWithinViewport || !aboutUi.closeFocused || !aboutUi.backdropIgnored || !aboutUi.closedByEscape || !aboutUi.focusReturned || !aboutUi.followupBackdropClean || !aboutUi.followupResolved || !aboutUi.updateUi;
  const hostTrustUiFailed = !hostTrustUi.unknown?.open
    || !hostTrustUi.unknown?.fingerprint
    || JSON.stringify(hostTrustUi.unknown?.actions)!==JSON.stringify(['仅本次信任','信任并保存','取消'])
    || !hostTrustUi.unknown?.cancelFocused
    || !hostTrustUi.unknown?.backdropIgnored
    || hostTrustUi.unknown?.result!=='once'
    || !hostTrustUi.changed?.open
    || !hostTrustUi.changed?.warning
    || !hostTrustUi.changed?.oldAndNew
    || !hostTrustUi.changed?.updateDanger
    || !hostTrustUi.changed?.updateLabel
    || hostTrustUi.changed?.result!=='persist'
    || !hostTrustUi.escapeCancelled
    || !hostTrustUi.settings?.visible
    || !hostTrustUi.settings?.record
    || !hostTrustUi.settings?.removeButton;
  const expectedSettingsActions = ['通用设置','安全','通知设置','启动与运行','缓存管理','关于'];
  const mobileResizeNavigationFailed = !mobile.workspaceResizeNavigation || !Object.values(mobile.workspaceResizeNavigation).every(Boolean);
  const mobileWorkspaceChromeResizeFailed = !mobile.workspaceChromeResize?.found
    || !mobile.workspaceChromeResize?.handlesHidden
    || !mobile.workspaceChromeResize?.desktopSizingIgnored
    || !mobile.workspaceChromeResize?.interactionsIgnored
    || !mobile.workspaceChromeResize?.storageUntouched;
  const mobileNavigationFailed = mobileResizeNavigationFailed || mobileWorkspaceChromeResizeFailed || !mobile.importExplorerFirst || !mobile.importWorkspaceEntered || !mobile.filePickerViewport?.found || !mobile.filePickerViewport?.freezesDuringDialog || !mobile.filePickerViewport?.restoresAfterDialog || !mobile.filePickerViewport?.clearsShellScroll || !mobile.filePickerViewport?.preservesWorkspaceScroll || !mobile.sftp?.found || !mobile.sftp?.fits || !mobile.sftp?.encodingVisible || !mobile.sftp?.terminalJumpVisible || !mobile.sftp?.allActionsVisible || !mobile.sftp?.uniformButtons || !mobile.sftp?.wrapsCompletely || !mobile.sftp?.defaultCollapsed || !mobile.sftp?.toggleVisible || !mobile.sftp?.breadcrumbAlwaysVisible || !mobile.sftp?.expandedPersisted || !mobile.sftp?.taskCenter?.opened || !mobile.sftp?.taskCenter?.withinViewport || !mobile.sftp?.taskCenter?.contentAdaptive || !mobile.sftp?.taskCenter?.resizeHandleHidden || !mobile.sftp?.taskCenter?.nativeResizeDisabled || !mobile.workspaceFormFonts?.preventsFocusZoom || !mobile.settingsNavigation?.explorerFirst || !mobile.settingsNavigation?.workspaceEntered || !mobile.settingsNavigation?.vertical || !mobile.settingsNavigation?.selectedOnly || !mobile.settingsNavigation?.noDuplicateMenu || JSON.stringify(mobile.settingsNavigation?.labels)!==JSON.stringify(expectedSettingsActions) || mobile.mobileTabs?.count !== 8 || !mobile.mobileTabs?.labelsHidden || !mobile.mobileTabs?.iconsCentered || !mobile.mobileTabs?.fits || !mobile.groupActionVisible || !mobile.groupActionMenuOpened || !mobile.groupControlsInline || !mobile.groupDragFirst || !mobile.groupCancelDoesNotSave || !mobile.groupDragSurvivesRefresh;
  const mobileAboutFailed = !mobile.about || !mobile.about.modalOpen || !mobile.about.cardWithinViewport || !mobile.about.textWithinCard || !mobile.about.textScrollable || !mobile.about.closeVisible || !mobile.about.closed;
  const terminalLabels = ['复制选中','光标复制','会话复制','粘贴','清屏','滚动到底部','终端配置','断开连接','全局终端设置'];
  const terminalSettingsUi = terminalUi.terminalSettingsUi || {};
  const terminalDropUi = terminalSettingsUi.drop || {};
  const mobileTerminalSettingsUi = mobile.terminalGlobalSettings || {};
  const terminalStartupUiFailed = !terminalStartupUi.found || !Object.values(terminalStartupUi).every(Boolean);
  const terminalUiFailed = !terminalUi.found || !terminalUi.desktopBackHidden || !terminalUi.desktopKeysHidden || terminalUi.binaryType !== 'arraybuffer' || !terminalUi.binaryWrite || !terminalUi.stableLogId || !terminalUi.x11DefaultFallsBack || !terminalUi.x11ScopeMenu || !terminalUi.ctrlVImageIntercepted || !terminalUi.ctrlVEmptyFallsThrough || !terminalUi.enterReconnect || !terminalUi.reconnectPreservesOutput || !terminalUi.inactiveTerminalOutputContinues || !terminalUi.fontActionRestoresFocus || !terminalUi.recentCommandsRestoreFocus || !terminalUi.recentCommandSequenceVisible || !terminalUi.resourceWindowTitle || !terminalUi.numberingContinuesWithOpenTabs || !terminalUi.numberingRestartsAfterAllClosed || !terminalUi.encodingMenuOpened || !terminalUi.fontMenuOpened || !terminalUi.statusHoverShowsFull || !terminalUi.desktopStatusAvoidsDuplicate || !terminalUi.desktopToolbarInHeader || !terminalUi.connectionToggleUsesLinkAction || !terminalUi.activeToolbarReplacesPrevious || !terminalUi.narrowToolbarFits || !terminalUi.narrowToolbarLeftAligned || !terminalUi.responsiveToolbarFits || !terminalUi.terminalToolbarScrollable || !terminalUi.startupCompactIconOnly || !terminalUi.desktopActionsIconOnly || !terminalUi.terminalToolbarIconSet || !terminalUi.terminalFrameLowContrast || !terminalUi.desktopCursorCopyHintVisible || !terminalUi.desktopCursorCopyHintCleansUp || !terminalUi.terminalCtrlWheelZooms || !terminalUi.terminalCtrlWheelKeepsPosition || !terminalUi.terminalPlainWheelScrolls || !terminalUi.terminalFontChangePreservesMiddleScroll || !terminalUi.terminalFontChangeKeepsWheelContinuity || !terminalUi.terminalCjkTextDoesNotClip || !terminalUi.latencyMeasured || !terminalUi.latencyCanDisable || !terminalUi.latencyCanEnable || !terminalUi.zmodemPanelUi || !terminalSettingsUi.open || !terminalSettingsUi.globalScope || !terminalSettingsUi.controls || !terminalSettingsUi.fontInheritance || !terminalDropUi.found || !terminalDropUi.copyFeedbackVisible || !terminalDropUi.sftpCopyToCurrentDirectory || !terminalDropUi.uploadFeedbackVisible || !terminalDropUi.localUploadToCurrentDirectory || !terminalDropUi.singleActiveDropTarget || !terminalDropUi.resizeFeedbackClears || !terminalDropUi.staleFeedbackClears || !terminalDropUi.completionNoticeNotDuplicated || !terminalSettingsUi.withinViewport || !terminalSettingsUi.compact || !terminalSettingsUi.readableWidth || !terminalSettingsUi.noHorizontalOverflow || JSON.stringify(terminalSettingsUi.tabs)!==JSON.stringify(['外观','鼠标与链接','选择与粘贴']) || JSON.stringify(terminalSettingsUi.backgroundModes)!==JSON.stringify(['theme','black','white','custom']) || !terminalSettingsUi.backgroundPreview || !terminalSettingsUi.requestedDefaults || !terminalSettingsUi.editablePasteSetting || !terminalSettingsUi.appliesToAllOpenSessions || !terminalSettingsUi.readableCustomPalette || !terminalSettingsUi.followsTheme || !terminalSettingsUi.copyFormatting || !terminalSettingsUi.singleLinePaste || !terminalSettingsUi.pasteCommandHistory || !terminalSettingsUi.linkProvider || !terminalSettingsUi.editablePaste || !mobileTerminalSettingsUi.buttonHidden || !mobile.terminalLongPress?.menuOnly || !mobile.terminalLongPress?.menuOpened || !mobile.terminalLongPress?.cursorHintStarted || !mobile.terminalLongPress?.cursorStartStored || !mobile.terminalLongPress?.cursorSelectionBlue || !mobile.terminalLongPress?.cursorCopyCompleted || !mobile.terminalLongPress?.clipboardFallback || !mobile.terminalSessionText?.open || !mobile.terminalSessionText?.withinViewport || !mobile.terminalSessionText?.selectable || !mobile.terminalSessionText?.scrollable || !mobile.terminalSessionText?.fullText || !mobile.terminalSessionText?.copyAll || !mobile.terminalSessionText?.copyAllWorks || !mobile.terminalSessionText?.backdropIgnored || !mobile.terminalPasteEditor?.open || !mobile.terminalPasteEditor?.withinViewport || !mobile.terminalPasteEditor?.editable || !mobile.terminalPasteEditor?.actionsVisible || !mobile.terminalPasteEditor?.backdropIgnored || !mobile.terminalPasteEditor?.cancelled || !mobile.terminalBack?.visible || !mobile.terminalBack?.shellOwned || !mobile.terminalBack?.reservedRow || !mobile.terminalBack?.compactToolbar || !mobile.terminalBack?.sftpTextFits || !mobile.terminalBack?.globalSettingsHidden || JSON.stringify(mobile.terminalBack?.priorityOrder)!==JSON.stringify(['reconnect','keys','forward-list','forward','sftp']) || !mobile.terminalBack?.returned || !mobile.terminalFontMenu?.opened || !mobile.terminalFontMenu?.withinViewport || !mobile.terminalFontMenu?.compact || !mobile.terminalFontMenu?.scrollable || !mobile.terminalFontMenu?.closeSticky || !mobile.terminalFontMenu?.touchTargets || !terminalLabels.every(label=>terminalUi.labels.includes(label)) || terminalUi.metrics.some(item=>Math.abs(item.buttonHeight-30)>0.5||Math.abs(item.iconWidth-14)>0.5||Math.abs(item.iconHeight-14)>0.5||item.centerDelta>0.5);
  const logSettingsUiFailed = !logSettingsUi.open || !logSettingsUi.accessible || !logSettingsUi.days || !logSettingsUi.fileMb || !logSettingsUi.totalMb || !logSettingsUi.rotations || !logSettingsUi.cleanup || !logSettingsUi.save || !logSettingsUi.closed || !logSettingsUi.fullTerminalTime || !logSettingsUi.defaultsToLatest || !logSettingsUi.followsTheme;
  const productivityUiFailed = !productivityUi.quickVisible || productivityUi.actionCount < 7 || !productivityUi.quickConnectionActionsInline || !productivityUi.quickPanelDirect || !productivityUi.workspaceSearchable || !productivityUi.workspacePreviewOpens || !productivityUi.quickButtonPlacement || !productivityUi.quickButtonLightning || !productivityUi.xServerQuickUsesX11 || !productivityUi.xServerUnauthorizedWarning || !productivityUi.xServerLocalDirectReady || !productivityUi.broadcastFromEither || !productivityUi.broadcastTabMarked || !productivityUi.broadcastHeaderGrouped || !productivityUi.broadcastExitCompact || !productivityUi.visibleSplitHasNoActivity || !productivityUi.visibleSplitClearsPriorActivity || !productivityUi.hiddenBinaryOutputMarked || productivityUi.syncRows !== 3 || !productivityUi.conflictSafe || !productivityUi.namedWorkspaceTools || !productivityUi.terminalTools || !productivityUi.quickToolbarIconVisible || !productivityUi.quickToggleStateVisible || !productivityUi.quickCompactWidths || !productivityUi.quickCommandExecutes || !productivityUi.quickContextMenu || !productivityUi.quickDoubleClickCreates || !productivityUi.quickEditorBackCloses || !productivityUi.quickManagerPolished || !productivityUi.quickOrderPersists || !productivityUi.quickHeightAdjustable || !productivityUi.quickToggleHides || !productivityUi.quickWheelScrolls || !productivityUi.quickResponsive;
  const remoteAdminUiFailed = Boolean(remoteAdminUi.desktop?.error)
    || !remoteAdminUi.desktop?.viewportFit
    || !remoteAdminUi.desktop?.noHorizontalOverflow
    || !remoteAdminUi.desktop?.controlsFit
    || !remoteAdminUi.desktop?.passwordEyeToggle
    || !remoteAdminUi.desktop?.initialPasswordMode
    || !remoteAdminUi.desktop?.sameSudoMode
    || !remoteAdminUi.desktop?.passwordSeparateSudo
     || !remoteAdminUi.desktop?.keyMode
     || !remoteAdminUi.desktop?.sudoNone
     || !remoteAdminUi.desktop?.agentMode
     || remoteAdminUi.desktop?.reusePolicyOptions !== 'once,10m,30m,session'
     || !remoteAdminUi.desktop?.separatePayload
    || !remoteAdminUi.desktop?.submitClearsSecrets
    || !remoteAdminUi.desktop?.cancelClearsSecrets
    || !remoteAdminUi.desktop?.backdropIgnored
    || !remoteAdminUi.desktop?.backdropPreservesSecrets
    || !remoteAdminUi.desktop?.backdropCancelClearsSecrets
    || !remoteAdminUi.desktop?.escapeClearsSecrets
    || Boolean(remoteAdminUi.mobile?.error)
    || !remoteAdminUi.mobile?.viewportFit
    || !remoteAdminUi.mobile?.noHorizontalOverflow
    || !remoteAdminUi.mobile?.controlsFit
    || !remoteAdminUi.mobile?.singleColumn
    || !remoteAdminUi.mobile?.stickyRegions
    || !remoteAdminUi.mobile?.actionButtonsFit
    || !remoteAdminUi.mobile?.cancelled
    || !remoteAdminUi.mobile?.secretCleared;
  const linuxDesktopToolbarUiFailed = Boolean(linuxDesktopToolbarUi.desktop?.error)
    || !linuxDesktopToolbarUi.desktop?.found
    || linuxDesktopToolbarUi.desktop?.columnCount !== 2
    || !linuxDesktopToolbarUi.desktop?.sameHeight
    || !linuxDesktopToolbarUi.desktop?.topAligned
    || !linuxDesktopToolbarUi.desktop?.bottomAligned
    || !linuxDesktopToolbarUi.desktop?.loadingVisible
    || !linuxDesktopToolbarUi.desktop?.noOverflow
    || Boolean(linuxDesktopToolbarUi.narrow?.error)
    || !linuxDesktopToolbarUi.narrow?.found
    || linuxDesktopToolbarUi.narrow?.viewportWidth > 700
    || linuxDesktopToolbarUi.narrow?.columnCount !== 1
    || !linuxDesktopToolbarUi.narrow?.stacked
    || !linuxDesktopToolbarUi.narrow?.fullWidth
    || !linuxDesktopToolbarUi.narrow?.loadingVisible
    || !linuxDesktopToolbarUi.narrow?.noOverflow;
  const remoteRenderingProtocols = ['rdp','vnc','xdmcp'];
  const remoteRenderingUiFailed = remoteRenderingProtocols.some(protocol => !remoteAccessUi.graphicsRendering?.[protocol]?.warning || !remoteAccessUi.graphicsRendering?.[protocol]?.copyButtons || !remoteAccessUi.graphicsRendering?.[protocol]?.noHorizontalOverflow) || !remoteAccessUi.renderingCopyInteraction?.success || !remoteAccessUi.renderingCopyInteraction?.failure || !remoteAccessUi.narrowRendering?.ok;
  const remoteLayoutUiFailed = remoteRenderingProtocols.some(protocol => !remoteAccessUi.remoteLayoutUi?.[protocol]?.ok);
  const remoteAccessUiFailed = !remoteAccessUi.rdpDisplayForm || !remoteAccessUi.vncModePersisted || !remoteAccessUi.vncImageSyncOptOut || !remoteAccessUi.vncPasswordForm || !remoteAccessUi.vncRetryPrompt || !remoteAccessUi.vncRetryValue || !remoteAccessUi.vncNoPassword || !remoteAccessUi.sshCredentialRepairUi || !remoteAccessUi.quickTerminalCredentialRepairUi || !remoteAccessUi.ftpCredentialRepairUi || !remoteAccessUi.vncServiceDiagnosisUi || !remoteAccessUi.vncServiceActionDebounced || !remoteAccessUi.xdmcpForm || !remoteAccessUi.xdmcpMenuAvailable || !remoteAccessUi.xdmcpSessionSemantics || !remoteAccessUi.xdmcpAuthorizationLayout || !remoteAccessUi.standaloneRdpFallback || !remoteAccessUi.standaloneRdpStatusHidden || !remoteAccessUi.standaloneVncFallback || !remoteAccessUi.standaloneXdmcpFallback || !remoteAccessUi.standaloneXdmcpStatusHidden || !remoteAccessUi.remoteDiagnosticAlignment || remoteRenderingUiFailed || remoteLayoutUiFailed || !remoteAccessUi.vncSourceSelection || !remoteAccessUi.vncSourceRefreshInPlace || !remoteAccessUi.vncFailureRecovery || !remoteAccessUi.vncComponentManagementUi || !remoteAccessUi.macVncBypassesLinuxDesktop || !remoteAccessUi.macVncSetupGuidance || !remoteAccessUi.remoteActivitySeparated || !remoteAccessUi.remoteHostStickyStyle || !remoteAccessUi.remoteHostStickyFollowsOuter || !remoteAccessUi.derivedSourcePresentation || !remoteAccessUi.remoteNameDoubleClickOpens || !remoteAccessUi.remoteDesktopSwitchAvailable || !remoteAccessUi.remoteDesktopSingleDisabled || !remoteAccessUi.remoteDesktopSwitchMenuComplete || !remoteAccessUi.sshActivitySeparated || !remoteAccessUi.x11AppLauncher || !remoteAccessUi.x11InstalledDialog || !remoteAccessUi.xServerRemoteUninstall || !remoteAccessUi.xServerClipboardLayout || !remoteAccessUi.xServerImmediateLoading || !remoteAccessUi.xServerManager || !remoteAccessUi.quickXServerManager || !remoteAccessUi.xServerDesktopIntegrationUnavailable || !remoteAccessUi.xServerBrowserAuthorization || !remoteAccessUi.xServerLocalDirectAuthorization || !remoteAccessUi.adaptiveModal || !remoteAccessUi.modalHeaderControlsAligned || !remoteAccessUi.modalBackdropLocked || !remoteAccessUi.healthIconOnly || !remoteAccessUi.narrowBrandActionsFit || !remoteAccessUi.expandedBrandNameVisible || !remoteAccessUi.defaultAddSshTextFits || !remoteAccessUi.narrowAddSshTextFits;
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
  const jobUiFailed = !jobUi.found || !jobUi.singleGlobalEntry || !jobUi.noPaneTaskRegions || !jobUi.failedStatusVisible || !jobUi.totalProgressVisible || !jobUi.totalProgressIndeterminate || !jobUi.totalProgressHidesWhenIdle || !jobUi.floatingVisibleBelowHeader || !jobUi.floatingActions || !jobUi.floatingResumeAction || !jobUi.floatingProgress || !jobUi.floatingOpensTaskCenter || !jobUi.floatingCloseHidesCurrent || !jobUi.floatingNewTaskReopens || !jobUi.floatingMutePersists || !jobUi.floatingSettingRestores || !jobUi.drawerOpened || !jobUi.drawerDefaultCompact || !jobUi.currentOnly || !jobUi.currentActions || !jobUi.failedOnly || !jobUi.failedActions || !jobUi.failedClearAvailable || !jobUi.currentProgress || !jobUi.drawerResizable || !jobUi.drawerResizeAdaptive || !jobUi.drawerResizePersists || !jobUi.drawerResizeReset || !jobUi.deleteDuplicateBlocked || !jobUi.deleteKeepsDrawerOpen || !jobUi.taskLogInitialOpen || !jobUi.taskLogInitialBottom || !jobUi.taskLogRefreshKeepsOpen || !jobUi.taskLogRefreshShowsLatest || !jobUi.taskLogRefreshFollowsBottom || !jobUi.drawerFitsViewport || !jobUi.historyOnly || !jobUi.historyCounts || !jobUi.historyActions || !jobUi.outsideClickCloses || !jobUi.escapeCloses || !jobUi.runningStatusVisible || !jobUi.nativeDragTaskStopHidden || !jobUi.itemProgress || !jobUi.staleJobResponseIgnored || !jobUi.toastIconsAligned || !jobUi.toastOrderPreserved || !jobUi.toastStackedDown || !jobUi.toastAvoidsFloatingTask || !jobUi.toastExitAnimated || !jobUi.toastReflowAnimated || !jobUi.toastMovedUp;
  const textEncodingUiFailed = !textEncodingUi.opened || !textEncodingUi.aceLoaded || textEncodingUi.selected !== 'gbk' || !textEncodingUi.manualLanguage || !textEncodingUi.nonJsonFormattingHidden || !textEncodingUi.lightPaged || !textEncodingUi.lightNextPage || !textEncodingUi.jsonFormatting || !textEncodingUi.jsonHiddenAfterLanguageChange || !textEncodingUi.json5FormattingHidden || !textEncodingUi.wordWrap || !textEncodingUi.persistDefault || !textEncodingUi.backup || !['utf8','utf8bom','gb18030','gbk','big5','shift_jis','euc-kr','latin1'].every(value=>textEncodingUi.options?.includes(value)) || !['auto','json','yaml','xml','sh','batchfile','powershell','javascript','java','c_cpp','sql','markdown'].every(value=>textEncodingUi.languageOptions?.includes(value));
  const nativeDragUiFailed = !nativeDragUi.found || !nativeDragUi.webExternalDragBlocked || !nativeDragUi.linuxFallbackNoticeOnce || !nativeDragUi.linuxFallbackUsesCompatibilityMode || !nativeDragUi.streamingPreparesOnPointerDown || !nativeDragUi.streamingThresholdActivatesOnce || !nativeDragUi.streamingCaptureCancelSurvives || !nativeDragUi.pointerUpCancelsPending || !nativeDragUi.streamingSkipsStage || !nativeDragUi.streamingNativeBlocksParallelBrowserDrag || !nativeDragUi.nativeIdleHintStable || !nativeDragUi.nativeOutsideHintStaysStable || !nativeDragUi.nativeMotionTargetsSftp || !nativeDragUi.nativeTransientMissKeepsTarget || !nativeDragUi.nativeFinalTransientMissKeepsTarget || !nativeDragUi.nativeReleasedClearsStaleTarget || !nativeDragUi.nativeResultCopiesOnce || !nativeDragUi.firstDragOnlyStages || !nativeDragUi.firstDragReset || !nativeDragUi.cacheReused || !nativeDragUi.cachedUnarmedStaysInternal || !nativeDragUi.sameWindowDropDoesNotArm || !nativeDragUi.armedDragStartsSynchronously || !nativeDragUi.failureRearmed || !nativeDragUi.successClearsState || !nativeDragUi.finderRenameNoticeShown;
  const sftpUiFailed = Boolean(sftpUi.error) || !connectionSessionUi.found || !connectionSessionUi.addressIncludesPort || !connectionSessionUi.disconnectedAction || !connectionSessionUi.disconnectedBanner || !connectionSessionUi.connectedAction || !connectionSessionUi.preservedWhileDisconnected || !connectionSessionUi.automaticConnectShared || !connectionSessionUi.manualDisconnectAutoReconnect || !connectionSessionUi.disconnectedTabSwitchDoesNotReconnect || !connectionSessionUi.disconnectedFolderOperationReconnects || !connectionSessionUi.dragFeedbackVisible || !connectionSessionUi.dragTargetViewActivated || !connectionSessionUi.targetListDropPrompt || !connectionSessionUi.targetListDropPromptStable || !connectionSessionUi.crossHostListDropCopies || !connectionSessionUi.crossHostPreviewHandoffSurvives || !connectionSessionUi.crossHostDropHasNoUploadToast || !connectionSessionUi.sameHostListDropCopies || !connectionSessionUi.terminalTabPreviewActivated || !connectionSessionUi.invalidTerminalDropRestoresSource || !connectionSessionUi.invalidSftpDropRestoresSource || !connectionSessionUi.acceptedTerminalDropStays || !connectionSessionUi.ownDragUploadSuppressed || !connectionSessionUi.armedPointerCancelClearsRequest || !connectionSessionUi.armedDragAllowsExternalUpload || !connectionSessionUi.staleInternalDragAllowsExternalUpload || !connectionSessionUi.desktopUriListDragAccepted || !connectionSessionUi.releasedDragAllowsExternalUpload || !connectionSessionUi.externalFileDropDetected || !connectionSessionUi.externalFileDropCollected || !connectionSessionUi.externalDropPromptIsSingle || !connectionSessionUi.externalDropPromptAvoidsWorkspaceChrome || !connectionSessionUi.externalDropPromptListCentered || !connectionSessionUi.externalDropSurfaceFillsWorkspace || !connectionSessionUi.externalDropPromptScrollClamped || !connectionSessionUi.externalDropPromptHorizontalClamped || !connectionSessionUi.externalDropPromptClears || nativeDragUiFailed || jobUiFailed || textEncodingUiFailed || !downloadNoticeUi.oncePerMode || !downloadNoticeUi.desktopPath || !downloadNoticeUi.browserDevice || !downloadNoticeUi.batchUsesSharedNotice || !downloadNoticeUi.browserSeparateChoice || !downloadNoticeUi.browserSeparateQueued || !downloadNoticeUi.noDuplicateBatchNotice || !globalSettingsUi.found || !globalSettingsUi.globalScope || !globalSettingsUi.controls || !globalSettingsUi.floatingProgressDefaultOn || !globalSettingsUi.floatingProgressCanRestore || !globalSettingsUi.downloadBehavior || !globalSettingsUi.defaultLimit || !globalSettingsUi.backdropIgnored || !globalSettingsUi.withinViewport || !globalSettingsUi.classicSurface || !globalSettingsUi.themedField || !directorySizeUi.idleButton || !directorySizeUi.requestedOnce || !directorySizeUi.exactBytes || !directorySizeUi.formatted || !directorySizeUi.refreshable || !sftpUi.fileOpenFeedback?.busy || !sftpUi.fileOpenFeedback?.duplicateBlocked || !sftpUi.fileOpenFeedback?.restored || !sftpUi.fileOpenFeedback?.interruptedRetry || !directoryCacheBehavior.sameResponseUntouched || !directoryCacheBehavior.changedResponseRendered || !directoryCacheBehavior.permissionFailureRestored || !sftpUi.searchKeyboardUi?.opened || !sftpUi.searchKeyboardUi?.closed || !sftpUi.searchKeyboardUi?.recursive || !sftpUi.searchKeyboardUi?.feedback || !sftpUi.syncIndicatorFollowsScroll || !sftpUi.diffComparisonUi || !sftpUi.columnLayoutUi?.order || !sftpUi.columnLayoutUi?.persisted || !sftpUi.columnLayoutUi?.resized || !sftpUi.columnLayoutUi?.pointerStable || !sftpUi.columnLayoutUi?.pairOnly || !sftpUi.columnLayoutUi?.adjacentResizeStable || !sftpUi.columnLayoutUi?.dividerUniform || !sftpUi.columnLayoutUi?.localNarrowResizable || !sftpUi.columnLayoutUi?.openButtonStable || !sftpUi.columnLayoutUi?.selectionToolbarStable || !sftpUi.columnLayoutUi?.scrollbarUnified || !sftpUi.columnLayoutUi?.globalCss || !directoryActionsUi.found || directoryActionsUi.stickyPosition !== 'sticky' || !directoryActionsUi.toolbarInHeader || !directoryActionsUi.navigationBeforeFavorites || !directoryActionsUi.reusedWithoutDirectoryReload || !expectedSftpToolActions.every(action=>directoryActionsUi.actionTitles?.includes(action)) || !directoryActionsUi.searchHidden || !directoryActionsUi.pathEditorHidden || !directoryActionsUi.emptyClipboardHidden || !directoryActionsUi.copyQueueVisible || !directoryActionsUi.copyCancelled || !directoryActionsUi.moveQueueVisible || !directoryActionsUi.moveCancelled || !directoryActionsUi.crossHostCopyEnabled || !directoryActionsUi.crossHostMoveDisabled || !directoryActionsUi.crossHostClipboardConflict || !directoryActionsUi.filenameEncodingMenu || !directoryActionsUi.emptyFavoritesCompact || !directoryActionsUi.wideNavigationCompact || !directoryActionsUi.narrowNavigationCompact || !directoryActionsUi.terminalJump || !directoryActionsUi.terminalJumpFirst || !sftpUi.folderOpened || !sftpUi.fileOpened || !sftpUi.unknownAction || sftpUi.stickyPosition !== "sticky" || !sftpUi.breadcrumbScrollable || !sftpUi.singlePathPresentation || sftpUi.breadcrumbLabels?.join('/') !== '根目录/Users/demo/Public' || sftpUi.breadcrumbText.includes('//') || !sftpUi.selectionShown || !sftpUi.selectionActionsShown || !sftpUi.multiNameAddsSelection || !sftpUi.multiNameCancelsSelection || !sftpUi.singleNameReplacesSelection || !sftpUi.specialSelectionExact || sftpUi.selectedRows !== 2 || !sftpUi.dragSelectionSynchronized || !sftpUi.selectionCleared || !sftpUi.fileHasCompression || !sftpUi.permissionOwnerColumn || !sftpUi.permissionOwnerTitle || !sftpUi.symlinkUsesTargetSize || !sftpUi.symlinkExplainsBothSizes || !sftpUi.symlinkMarked || !sftpUi.wideColumnAlignment || !sftpUi.wideActionsFit || !sftpUi.compactSizeVisible || !sftpUi.compactTimeVisible || !sftpUi.compactAccessVisible || !sftpUi.compactMediumHidden || !sftpUi.compactCoreVisible || !sftpUi.compactHorizontalScroll || !sftpUi.permissionModeSync || !sftpUi.recursiveVisible || sftpUi.compactRowHeight > 48 || !sftpUi.moreMenuOpened || !sftpUi.contextMenuOpened || !sftpUi.directoryDownloadMenu || !sftpUi.narrowLayoutClass || !sftpUi.narrowCoreHidden || !sftpUi.narrowMoreVisible || !sftpUi.narrowMetaVisible || !sftpUi.narrowAccessHidden || !sftpUi.narrowHeaderNameVisible || !sftpUi.narrowHeaderSummaryVisible || !sftpUi.narrowCompactActions || !sftpUi.completedMutationDetected || !sftpUi.desktopPagerSingleRow || !sftpUi.pagerFloatsAtWorkspaceBottom || !sftpUi.pagerOpaqueAndElevated || !sftpUi.pagerDockSealsBottom || !sftpUi.pagerPinnedToViewport || !sftpUi.scrollCueVisibleAboveContent || !sftpUi.scrollCueHidesAtEnd || !sftpUi.narrowPagerWraps || sftpUi.pageRows !== 50 || !sftpUi.pagerVisible || !sftpUi.pagerText.includes('第 1/2 页') || !sftpUi.previousDisabled || !sftpUi.nextEnabled;
  const sftpToolbarRecoveryFailed = !directoryActionsUi.recoveredMissingToolbar || !directoryActionsUi.duplicateSftpToolbarsFollowActiveTab;
  const sftpTabIsolationFailed = !directoryActionsUi.sftpVisibleNumberingStable
    || !directoryActionsUi.activeShellMatchesTab
    || !directoryActionsUi.parentNavigationStaysOnOwner
    || !directoryActionsUi.duplicateDirectoryStateIsolated
    || !directoryActionsUi.duplicateHistoryIsolated
    || !directoryActionsUi.duplicateShellMatchesTab;
  const languageOnboardingFailed = !languageOnboardingUi.regionDefaults || !languageOnboardingUi.newUserDefaultsEnglish || !languageOnboardingUi.nativeChoiceCopy || !languageOnboardingUi.englishCopy || !languageOnboardingUi.selectedChineseCopy || !languageOnboardingUi.selectedEnglishCopy || !languageOnboardingUi.coldStartNativeChoice || !languageOnboardingUi.existingUserKeepsLanguage || !languageOnboardingUi.existingUserChineseCopy || !languageOnboardingUi.existingUserEnglishCopy || !languageOnboardingUi.fitsNarrowViewport || !languageOnboardingUi.saved || !languageOnboardingUi.closed;
  const forwardTemplateLayoutFailed = forwardTemplateLayoutUi.rows !== 2 || forwardTemplateLayoutUi.buttons !== 6 || !forwardTemplateLayoutUi.singleLine || !forwardTemplateLayoutUi.insideRows || !forwardTemplateLayoutUi.noOverlap;
  const code = errors.length || cspViolations.length || languageOnboardingFailed || forwardTemplateLayoutFailed || !noVncModuleUi.loaded || !noVncModuleUi.prototype || !zmodemModuleUi.loaded || !zmodemModuleUi.browser || !zmodemModuleUi.abortSequence || overflow || operationPagesFailed || darkFailed || menuFailed || refreshStateUiFailed || workspaceTabDragUiFailed || workspaceTabCloseUiFailed || workspaceDockingUiFailed || workspaceStartupRestoreUiFailed || workspaceTabVisibilityUiFailed || workspaceHeaderResizeUiFailed || runningActionsFailed || authUiFailed || connectionStartupUiFailed || saveAndClearUiFailed || notificationUiFailed || restoreKeyUiFailed || restoreCredentialUiFailed || activityUiFailed || appearanceEffectsUiFailed || navigationUiFailed || aboutUiFailed || hostTrustUiFailed || mobileNavigationFailed || mobileAboutFailed || terminalUiFailed || terminalStartupUiFailed || logSettingsUiFailed || productivityUiFailed || remoteAdminUiFailed || linuxDesktopToolbarUiFailed || remoteAccessUiFailed || sftpUiFailed || sftpToolbarRecoveryFailed || sftpTabIsolationFailed || !clipboardUi.ok || mobile.contentVisible === "none" || !result.groups || !result.icons || !result.groupRenameMenu || !result.groupActionButton || !result.stickyGroupHeaders || !result.stickyGroupHeaderSealsTop || !result.operationPaneCollapsible || !result.operationPanePinBehavior || !result.operationPaneResizable || !result.operationPaneHorizontalScrollHidden || !result.compactDesktopHeader || !result.compactOperationPane || !result.compactConnectionTools || !result.compactConnectionRows || !result.connectionHasSftpAction || !result.quickConnectionLauncher || !result.quickSshCandidates || !result.connectionNameDoubleClickOpens || !result.forwardToggleFits ? 1 : 0;
  if (code) console.error("UI smoke failure summary:", JSON.stringify({
    failedChecks:Object.entries({
      overflow,
      operationPagesFailed,
      darkFailed,
      menuFailed,
      refreshStateUiFailed,
      workspaceTabDragUiFailed,
      workspaceTabCloseUiFailed,
      workspaceDockingUiFailed,
      workspaceStartupRestoreUiFailed,
      workspaceTabVisibilityUiFailed,
      workspaceHeaderResizeUiFailed,
      runningActionsFailed,
      authUiFailed,
      connectionStartupUiFailed,
      saveAndClearUiFailed,
      notificationUiFailed,
      restoreKeyUiFailed,
      restoreCredentialUiFailed,
      activityUiFailed,
      appearanceEffectsUiFailed,
      navigationUiFailed,
      aboutUiFailed,
      hostTrustUiFailed,
      mobileNavigationFailed,
      mobileAboutFailed,
      terminalUiFailed,
      terminalStartupUiFailed,
      logSettingsUiFailed,
      productivityUiFailed,
      remoteAdminUiFailed,
      linuxDesktopToolbarUiFailed,
      remoteAccessUiFailed,
      sftpUiFailed,
      sftpToolbarRecoveryFailed,
      sftpTabIsolationFailed,
      clipboardUiFailed:!clipboardUi.ok
    }).filter(([, failed]) => Boolean(failed)).map(([name]) => name),
    workspaceTabCloseUi,
    runningActions,
    restoreKeyUi,
    activityUi:{activity:result.activity, activityUtilities:result.activityUtilities},
    aboutUi,
    terminalUiFalse:Object.entries(terminalUi).filter(([, value]) => value === false).map(([name]) => name),
    terminalUiScalars:{
      found:terminalUi.found,
      desktopBackHidden:terminalUi.desktopBackHidden,
      desktopKeysHidden:terminalUi.desktopKeysHidden,
      binaryType:terminalUi.binaryType,
      labels:terminalUi.labels,
      toolbarLabels:terminalUi.toolbarLabels
    },
    remoteAccessUiFalse:Object.entries(remoteAccessUi).filter(([, value]) => value === false).map(([name]) => name),
    remoteAccessUiDiagnostics:{xdmcpWorkspaceText:remoteAccessUi.xdmcpWorkspaceText,macVncWorkspaceText:remoteAccessUi.macVncWorkspaceText,vncComponentDiagnostics:remoteAccessUi.vncComponentDiagnostics,remoteDesktopSwitchProfiles:remoteAccessUi.remoteDesktopSwitchProfiles,remoteDesktopSwitchMenu:remoteAccessUi.remoteDesktopSwitchMenu,graphicsRendering:remoteAccessUi.graphicsRendering,renderingCopyInteraction:remoteAccessUi.renderingCopyInteraction,narrowRendering:remoteAccessUi.narrowRendering,remoteLayoutUi:remoteAccessUi.remoteLayoutUi},
    sftpUiDiagnostics:{
      error:sftpUi.error,
      topLevelFalse:Object.entries(sftpUi).filter(([, value]) => value === false).map(([name]) => name),
      searchKeyboardUi:sftpUi.searchKeyboardUi,
      syncIndicatorFollowsScroll:sftpUi.syncIndicatorFollowsScroll,
      compactScrollMetrics:sftpUi.compactScrollMetrics,
      pagerLayoutMetrics:sftpUi.pagerLayoutMetrics,
      directoryCacheBehavior:sftpUi.directoryCacheBehavior,
      componentFailures:{nativeDragUiFailed,jobUiFailed,textEncodingUiFailed},
      globalSettingsFalse:Object.entries(globalSettingsUi).filter(([, value]) => value === false).map(([name]) => name),
      directorySizeFalse:Object.entries(directorySizeUi).filter(([, value]) => value === false).map(([name]) => name),
      downloadNoticeFalse:Object.entries(downloadNoticeUi).filter(([, value]) => value === false).map(([name]) => name),
      fileOpenFeedbackFalse:Object.entries(sftpUi.fileOpenFeedback || {}).filter(([, value]) => value === false).map(([name]) => name),
      fileOpenFeedback:sftpUi.fileOpenFeedback,
      narrowMetaDiagnostics:sftpUi.narrowMetaDiagnostics,
      columnLayoutFalse:Object.entries(sftpUi.columnLayoutUi || {}).filter(([, value]) => value === false).map(([name]) => name),
      connectionSessionFalse:Object.entries(connectionSessionUi).filter(([, value]) => value === false).map(([name]) => name),
      jobUiFalse:Object.entries(jobUi).filter(([, value]) => value === false).map(([name]) => name),
      jobUiDiagnostics:{historyActionDiagnostics:jobUi.historyActionDiagnostics,stackedToastTitles:jobUi.stackedToastTitles},
      textEncodingUiFalse:Object.entries(textEncodingUi).filter(([, value]) => value === false).map(([name]) => name),
      reusedWithoutDirectoryReload:sftpUi.directoryActionsUi?.reusedWithoutDirectoryReload,
      directoryActionsFalse:Object.entries(sftpUi.directoryActionsUi || {}).filter(([, value]) => value === false).map(([name]) => name),
      emptyFavoritesMetrics:sftpUi.directoryActionsUi?.emptyFavoritesMetrics,
      scalarExpectations:{
        stickyPosition:sftpUi.stickyPosition,
        breadcrumbLabels:sftpUi.breadcrumbLabels,
        selectedRows:sftpUi.selectedRows,
        compactRowHeight:sftpUi.compactRowHeight,
        pageRows:sftpUi.pageRows,
        pagerText:sftpUi.pagerText,
        expectedActionsMissing:expectedSftpToolActions.filter(action=>!directoryActionsUi.actionTitles?.includes(action))
      }
    },
    navigationUiFailed,
    navigationUi,
    failedOperationPages,
    aboutUiFailed,
      terminalUiFailed,
      terminalSettingsUi,
      productivityUiFailed,
      appearanceEffectsUi,
      quickSshCandidates:result.quickSshCandidates,
      dark,
      mobileNavigationFailed,
      mobileNavigationDiagnostics:mobile,
      linuxDesktopToolbarUiFailed,
      linuxDesktopToolbarUi,
      overflow,
    errors,
    cspViolations
  }, null, 2));
  clearTimeout(smokeWatchdog);
  window.destroy();
  app.exit(code);
}).catch(error => {
  clearTimeout(smokeWatchdog);
  if (rendererFailure) console.error(`Renderer failure: ${JSON.stringify(rendererFailure)}`);
  console.error(error);
  app.exit(1);
});
