async function runMobileScenario(window) {
  return window.webContents.executeJavaScript(`(async()=>{
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
        const operationHandle=document.querySelector('#operationPaneResize');
        const storedHeaderBefore=localStorage.getItem('workspaceHeaderHeight');
        const storedTabBefore=localStorage.getItem('workspaceTabHeight');
        const storedActivityBefore=localStorage.getItem('activityBarWidth');
        const storedOperationBefore=localStorage.getItem('operationPaneWidth');
        const headerValueBefore=workspaceHeaderHeight;
        const tabValueBefore=workspaceTabHeight;
        const activityValueBefore=activityBarWidth;
        const operationValueBefore=operationPaneWidth;
        const nextFrame=()=>new Promise(resolve=>setTimeout(resolve,0));
        const snapshot=()=>({
          headerHeight:topbar?.getBoundingClientRect().height||0,
          headerFont:title?parseFloat(getComputedStyle(title).fontSize):0,
          tabHeight:tabShell?.getBoundingClientRect().height||0,
          tabFont:tabNode?parseFloat(getComputedStyle(tabNode).fontSize):0,
          dotSize:tabDot?Math.max(tabDot.getBoundingClientRect().width,tabDot.getBoundingClientRect().height):0,
          operationWidth:leftPane?.getBoundingClientRect().width||0
        });
        const equalMetric=(left,right)=>Math.abs(left-right)<=0.5;
        try{
          const baseline=snapshot();
          const handlesHidden=Boolean(headerHandle&&tabHandle&&activityHandle&&operationHandle
            && getComputedStyle(headerHandle).display==='none'
            && getComputedStyle(tabHandle).display==='none'
            && getComputedStyle(activityHandle).display==='none'
            && getComputedStyle(operationHandle).display==='none'
            && headerHandle.getBoundingClientRect().height===0
            && tabHandle.getBoundingClientRect().height===0
            && activityHandle.getBoundingClientRect().width===0
            && operationHandle.getBoundingClientRect().width===0);
          applyWorkspaceHeaderHeight(WORKSPACE_HEADER_HEIGHT_MAX,{fit:false});
          applyWorkspaceTabHeight(WORKSPACE_TAB_HEIGHT_MAX,{fit:false});
          applyActivityBarWidth(ACTIVITY_BAR_WIDTH_MAX,{fit:false});
          applyOperationPaneWidth(OPERATION_PANE_WIDTH_MAX,{fit:false});
          await nextFrame();
          const afterProgrammaticApply=snapshot();
          const desktopSizingIgnored=equalMetric(afterProgrammaticApply.headerHeight,baseline.headerHeight)
            && equalMetric(afterProgrammaticApply.headerFont,baseline.headerFont)
            && equalMetric(afterProgrammaticApply.tabHeight,baseline.tabHeight)
            && equalMetric(afterProgrammaticApply.tabFont,baseline.tabFont)
            && equalMetric(afterProgrammaticApply.dotSize,baseline.dotSize)
            && equalMetric(afterProgrammaticApply.operationWidth,baseline.operationWidth);
          applyWorkspaceHeaderHeight(headerValueBefore,{fit:false});
          applyWorkspaceTabHeight(tabValueBefore,{fit:false});
          applyActivityBarWidth(activityValueBefore,{fit:false});
          applyOperationPaneWidth(operationValueBefore,{fit:false});
          const dispatchHiddenDrag=(handle,pointerId,horizontal=false)=>{
            handle?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId,pointerType:'touch',button:0,clientX:0,clientY:0}));
            window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId,pointerType:'touch',button:0,clientX:horizontal?200:0,clientY:horizontal?0:200}));
            window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId,pointerType:'touch',button:0,clientX:horizontal?200:0,clientY:horizontal?0:200}));
          };
          dispatchHiddenDrag(headerHandle,201);
          dispatchHiddenDrag(tabHandle,202);
          dispatchHiddenDrag(activityHandle,203,true);
          dispatchHiddenDrag(operationHandle,204,true);
          headerHandle?.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'End'}));
          tabHandle?.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'End'}));
          activityHandle?.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'End'}));
          operationHandle?.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'End'}));
          headerHandle?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0}));
          tabHandle?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0}));
          activityHandle?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0}));
          operationHandle?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0}));
          await nextFrame();
          const afterInteractions=snapshot();
          const interactionsIgnored=workspaceHeaderHeight===headerValueBefore
            && workspaceTabHeight===tabValueBefore
            && activityBarWidth===activityValueBefore
            && operationPaneWidth===operationValueBefore
            && workspaceChromeResize===null
            && activityBarResize===null
            && operationPaneResize===null
            && !document.body.classList.contains('workspace-chrome-resizing')
            && !document.body.classList.contains('activity-bar-resizing')
            && !document.body.classList.contains('operation-pane-resizing')
            && equalMetric(afterInteractions.headerHeight,baseline.headerHeight)
            && equalMetric(afterInteractions.headerFont,baseline.headerFont)
            && equalMetric(afterInteractions.tabHeight,baseline.tabHeight)
            && equalMetric(afterInteractions.tabFont,baseline.tabFont)
            && equalMetric(afterInteractions.dotSize,baseline.dotSize)
            && equalMetric(afterInteractions.operationWidth,baseline.operationWidth);
          const storageUntouched=localStorage.getItem('workspaceHeaderHeight')===storedHeaderBefore
            && localStorage.getItem('workspaceTabHeight')===storedTabBefore
            && localStorage.getItem('activityBarWidth')===storedActivityBefore
            && localStorage.getItem('operationPaneWidth')===storedOperationBefore;
          mobileWorkspaceChromeResize={
            found:Boolean(headerHandle&&tabHandle&&activityHandle&&operationHandle&&topbar&&title&&tabShell&&tabNode&&tabDot),
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
          if(operationPaneResize)finishOperationPaneResize(null,true);
          if(storedHeaderBefore===null)localStorage.removeItem('workspaceHeaderHeight');else localStorage.setItem('workspaceHeaderHeight',storedHeaderBefore);
          if(storedTabBefore===null)localStorage.removeItem('workspaceTabHeight');else localStorage.setItem('workspaceTabHeight',storedTabBefore);
          if(storedActivityBefore===null)localStorage.removeItem('activityBarWidth');else localStorage.setItem('activityBarWidth',storedActivityBefore);
          if(storedOperationBefore===null)localStorage.removeItem('operationPaneWidth');else localStorage.setItem('operationPaneWidth',storedOperationBefore);
          applyWorkspaceHeaderHeight(headerValueBefore,{fit:false});
          applyWorkspaceTabHeight(tabValueBefore,{fit:false});
          applyActivityBarWidth(activityValueBefore,{fit:false});
          applyOperationPaneWidth(operationValueBefore,{fit:false});
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
      closeSftpTaskCenter();
      await toggleSftpTaskCenter();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const mobileTaskCenterDrawer=document.querySelector('#sftpTaskCenterDrawer');
      const mobileTaskCenterList=document.querySelector('#sftpTaskCenterList');
      const mobileTaskCenterResize=document.querySelector('#sftpTaskCenterResize');
      const mobileTaskCenterRect=mobileTaskCenterDrawer?.getBoundingClientRect();
      const mobileTaskCenterStyle=mobileTaskCenterDrawer?getComputedStyle(mobileTaskCenterDrawer):null;
      mobileSftpLayout.taskCenter={
        opened:Boolean(mobileTaskCenterDrawer&&!mobileTaskCenterDrawer.hidden),
        withinViewport:Boolean(mobileTaskCenterRect
          && mobileTaskCenterRect.left>=-0.5
          && mobileTaskCenterRect.right<=innerWidth+0.5
          && mobileTaskCenterRect.top>=-0.5
          && mobileTaskCenterRect.bottom<=innerHeight+0.5),
        contentAdaptive:Boolean(mobileTaskCenterList
          && mobileTaskCenterList.scrollWidth<=mobileTaskCenterList.clientWidth+0.5
          && mobileTaskCenterList.getBoundingClientRect().right<=mobileTaskCenterRect.right+0.5),
        resizeHandleHidden:Boolean(mobileTaskCenterResize&&getComputedStyle(mobileTaskCenterResize).display==='none'),
        nativeResizeDisabled:mobileTaskCenterStyle?.resize==='none'
      };
      closeSftpTaskCenter();
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
      openBatchCommand();
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
      document.querySelector('.conn-actions .icon-button[title="更多操作"]')?.click();
      layout.menuOpened=Boolean(document.querySelector('#actionMenu')&&document.querySelector('#actionMenuBackdrop'));
      document.querySelector('#actionMenuBackdrop')?.click();
      layout.menuClosed=!document.querySelector('#actionMenu')&&!document.querySelector('#actionMenuBackdrop');
      document.documentElement.dataset.uiSmokeStage='mobile-terminal-back';
      const terminalBackFixture=document.createElement('div');
      terminalBackFixture.className='terminal-toolbar';
      terminalBackFixture.innerHTML='<div class="terminal-title-row"><button class="terminal-mobile-back" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="backToExplorer()">'+icon('arrow-left')+'<span>返回</span></button><span class="terminal-connection-dot"></span><span class="terminal-status">root@example.invalid:22 · 已连接</span><span class="terminal-latency good">延迟 5 ms</span></div><div class="actions terminal-actions"><button class="terminal-action-sftp">'+icon('folder-open')+'<span>SFTP</span></button><button class="terminal-action-keys">'+icon('keyboard')+'<span>快捷键</span></button><button class="terminal-action-reconnect">'+icon('refresh-cw')+'<span>重连</span></button><button class="terminal-action-forward-list">'+icon('route')+'<span>转发列表</span></button><button class="terminal-action-forward">'+icon('play')+'<span>转发</span></button><button class="terminal-global-settings-button">'+icon('settings')+'</button></div>';
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
      const cursorHint=document.querySelector('.terminal-cursor-copy-hint');
      const cursorHintStarted=Boolean(terminalSessions.get(longPressKey)?.cursorCopyState&&longPressMount.classList.contains('terminal-cursor-copy-active')&&cursorHint?.textContent.includes('光标复制：拖到复制起点后松手')&&cursorHint.querySelector('.terminal-cursor-copy-cancel'));
      longPressMount.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:11,pointerType:'touch',clientX:5,clientY:10}));
      longPressMount.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:11,pointerType:'touch',clientX:5,clientY:10}));
      longPressMount.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:11,pointerType:'touch',clientX:5,clientY:10}));
      const cursorStartStored=terminalSessions.get(longPressKey)?.cursorCopyState?.phase==='end'&&document.querySelector('.terminal-cursor-copy-message')?.textContent==='已选起点，请拖到复制终点后松手';
      longPressMount.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:12,pointerType:'touch',clientX:5,clientY:10}));
      longPressMount.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:12,pointerType:'touch',clientX:115,clientY:10}));
      const cursorSelectionBlue=longPressTerm.options.theme?.selectionBackground==='#2563eb'&&longPressSelection===longPressLine;
      longPressMount.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:12,pointerType:'touch',clientX:115,clientY:10}));
      await new Promise(resolve=>setTimeout(resolve,0));
      copyText=originalCopyText;
      const cursorCopyCompleted=cursorCopied===longPressLine&&!terminalSessions.get(longPressKey)?.cursorCopyState&&!document.querySelector('.terminal-cursor-copy-hint')&&!document.querySelector('.terminal-cursor-copy-cancel');
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
        priorityOrder:[...terminalBackFixture.querySelectorAll('.terminal-action-reconnect,.terminal-action-keys,.terminal-action-forward-list,.terminal-action-forward,.terminal-action-sftp')].sort((left,right)=>Number(getComputedStyle(left).order)-Number(getComputedStyle(right).order)).map(button=>button.className.match(/terminal-action-(reconnect|keys|forward-list|forward|sftp)/)?.[1]),
        sftpTextFits:Boolean(terminalMobileSftpButton && terminalMobileSftpButton.clientWidth >= 82 && terminalMobileSftpButton.scrollWidth <= terminalMobileSftpButton.clientWidth + 1 && terminalMobileSftpButton.textContent.trim() === 'SFTP'),
        globalSettingsHidden:getComputedStyle(mobileGlobalSettingsButton).display==='none',
        returned:!document.querySelector('.left-pane')?.classList.contains('mobile-hide')&&!document.querySelector('#content')?.classList.contains('mobile-show')&&!document.body.classList.contains('mobile-terminal-active')
      };
      terminalBackFixture.remove();
      document.documentElement.dataset.uiSmokeStage='mobile-complete';
      return layout
    })()`);
}

module.exports = { runMobileScenario };
