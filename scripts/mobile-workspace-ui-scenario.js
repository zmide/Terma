const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function runMobileWorkspaceUiScenario(window) {
  window.setSize(390, 844);
  const prepared = await window.webContents.executeJavaScript(`(async () => { try {
    await window.termaI18nReady;
    while (window.workspaceRestorePending) await new Promise(resolve => setTimeout(resolve, 20));
    window.termaNotificationToasts?.dispose();
    window.restoringTabs = true;
    for (const [key,title] of [['mobile-ui-one','Alpha <file>'],['mobile-ui-two','Beta']]) {
      // Generic fixture tabs exercise real activation without starting an SSH connection.
      setWorkspace(title,'','terminal',key,true,true,{kind:'mobile-ui-fixture'});
    }
    const view = document.createElement('div');
    // This standalone fixture owns its inline toolbar, as remote terminal views do.
    view.id = 'view-remote-terminal';
    view.style.cssText='position:fixed;left:6px;right:6px;top:100px';
    document.body.appendChild(view);
    const key='mobile-toolbar-fixture';
    const connection={id:-990040,quick_connection:true,ssh_host:'review.example',ssh_user:'review',terminal_font_size:16};
    window.termaTerminalState.terminalSessions.set(key,{connection,connected:true,socket:{readyState:WebSocket.OPEN},term:{options:{fontSize:16}}});
    view.innerHTML='<div class="terminal-toolbar" data-workspace-tab-key="'+key+'" data-terminal-tab-key="'+key+'"></div>';
    window.termaTerminalToolbar.mount(key);
    syncResponsivePane();
    window.termaWorkspaceShell.showMobileWorkspace();
    return true;
  } catch(error) { return {error:String(error),stack:error.stack}; } })()`);
  assert.equal(prepared,true,JSON.stringify(prepared));
  const proofDirectory = process.env.TERMA_UI_MOBILE_PROOF_DIR;
  if (proofDirectory) fs.mkdirSync(proofDirectory, {recursive:true});
  async function capture(name) {
    window.webContents.invalidate();
    await window.webContents.capturePage();
    await new Promise(resolve => setTimeout(resolve, 70));
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(proofDirectory, `${name}.png`), image.toPNG());
  }

  const results = [];
  for (const language of ["zh-CN", "en-US"]) {
    for (const theme of ["light", "dark"]) {
      await window.webContents.executeJavaScript(`(async () => {
        await setTermaLanguage(${JSON.stringify(language)}, {emit:false});
        applyTheme(${JSON.stringify(theme)});
        window.termaWorkspaceMobile.render();
      })()`);
      await new Promise(resolve => setTimeout(resolve, 60));
      const metrics = await window.webContents.executeJavaScript(`(async () => {
        const list=document.getElementById('mobileWorkspaceTabs');
        const back=document.getElementById('mobileBack').getBoundingClientRect();
        const nav=list.getBoundingClientRect();
        const count=tabs.length;
        const sessions=window.termaTerminalState.terminalSessions.size;
        list.querySelector('[data-tab-key="mobile-ui-one"]').click();
        const switched=activeTabKey==='mobile-ui-one'&&document.querySelector('#content').classList.contains('mobile-show');
        document.getElementById('mobileBack').click();
        const explorer=document.getElementById('mobileExplorerTabs');
        const explorerBounds=explorer.getBoundingClientRect();
        const explorerActive=explorer.querySelector('[aria-selected="true"]')?.getBoundingClientRect();
        const explorerVisible=explorerBounds.width>0&&!document.querySelector('.left-pane').classList.contains('mobile-hide');
        const explorerGeometry=getComputedStyle(explorer).display==='flex'&&Math.abs(explorerBounds.height-54)<1
          &&explorerActive?.width>0&&explorerActive.left>=explorerBounds.left&&explorerActive.right<=explorerBounds.right;
        explorer.querySelector('[data-tab-key="mobile-ui-two"]').click();
        const reopened=activeTabKey==='mobile-ui-two'&&document.querySelector('#content').classList.contains('mobile-show');
        const actions=document.querySelector('.terminal-toolbar .terminal-actions');
        actions.scrollLeft=0;
        window.termaTerminalToolbarScroll.state(actions);
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const buttons=[...actions.querySelectorAll('button')].filter(button=>getComputedStyle(button).display!=='none');
        const rects=buttons.map(button=>button.getBoundingClientRect());
        const minus=actions.querySelector('.terminal-action-font').getBoundingClientRect();
        const readout=actions.querySelector('output').getBoundingClientRect();
        const plus=actions.querySelectorAll('.terminal-action-font')[1].getBoundingClientRect();
        const right=document.querySelector('.terminal-actions-scroll-right');
        const left=document.querySelector('.terminal-actions-scroll-left').getBoundingClientRect();
        const arrow=right.getBoundingClientRect();
        const x11=actions.querySelector('.x11-icon');
        const focusPreserved=['mobile-workspace-tab-main','mobile-workspace-tab-close'].every(className=>{
          const target=list.querySelector('.'+className+'[data-tab-key="mobile-ui-one"]');
          target.focus();
          const tab=tabs.find(tab=>tab.key==='mobile-ui-one');
          tab.connectionStatus=tab.connectionStatus==='connected'?'connecting':'connected';
          window.termaWorkspaceMobile.render();
          return document.activeElement===list.querySelector('.'+className+'[data-tab-key="mobile-ui-one"]');
        });
        const closeTargets=[...list.querySelectorAll('.mobile-workspace-tab-close')];
        const tabFrames=[...list.querySelectorAll('.mobile-workspace-tab')].map(node=>node.getBoundingClientRect());
        const before=actions.scrollLeft;
        right.click();
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        return {sameRow:Math.abs((back.top+back.height/2)-(nav.top+nav.height/2))<1&&nav.left>=back.right,
          tabHeightMatchesBack:tabFrames.every(rect=>Math.abs(rect.height-back.height)<1&&Math.abs(rect.top-back.top)<1),
          switched,explorerVisible,explorerGeometry,reopened,noNewSessions:tabs.length===count&&window.termaTerminalState.terminalSessions.size===sessions,
          escaped:!list.querySelector('file')&&list.textContent.includes('Alpha <file>'),
          compact:rects.every(rect=>Math.abs(rect.width-30)<1&&Math.abs(rect.height-30)<1),
          aligned:rects.every(rect=>Math.abs((rect.top+rect.height/2)-(left.top+left.height/2))<1&&Math.abs((rect.top+rect.height/2)-(arrow.top+arrow.height/2))<1&&rect.top>=left.top&&rect.bottom<=arrow.bottom),
          coordinates:{back:[back.top,back.height],tabs:tabFrames.map(rect=>[rect.top,rect.height]),arrows:[left.top,left.height,arrow.top,arrow.height],buttons:rects.map(rect=>[rect.top,rect.height])},
          x11Visible:[x11,x11.querySelector('svg'),x11.querySelector('b')].every(node=>node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0),
          closeVisible:closeTargets.length===2&&closeTargets.every(button=>{const rect=button.getBoundingClientRect();const main=button.parentElement.querySelector('.mobile-workspace-tab-main').getBoundingClientRect();return button.tagName==='BUTTON'&&rect.width>=44&&rect.height>=44&&main.right<=rect.left&&rect.right<=button.parentElement.getBoundingClientRect().right&&!button.parentElement.closest('button');}),
          focusPreserved,
          fontOrder:minus.right<=readout.left&&readout.right<=plus.left&&Math.abs(minus.top-readout.top)<1,
          toolbarScroll:actions.scrollLeft>before,withinViewport:document.documentElement.scrollWidth<=innerWidth,
          label:list.getAttribute('aria-label')};
      })()`);
      for (const [key,value] of Object.entries(metrics)) if (!["label","coordinates"].includes(key)) assert.equal(value,true,`${language}/${theme} ${key}: ${JSON.stringify(metrics)}`);
      assert.equal(metrics.label, language === "zh-CN" ? "已打开的标签" : "Open tabs");
      const {coordinates,...summary}=metrics;
      results.push({language,theme,...summary});
      if (proofDirectory) {
        await capture(`mobile-${language}-${theme}`);
        const searchExposed = await window.webContents.executeJavaScript(`(async () => {
          document.getElementById('mobileBack').click();
          document.querySelector('[data-terminal-tab-key="mobile-toolbar-fixture"]').parentElement.hidden = true;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const search = document.getElementById('connectionSearch');
          if (!search?.checkVisibility()) return false;
          const bounds = search.getBoundingClientRect();
          return document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2) === search;
        })()`);
        assert.equal(searchExposed, true, `${language}/${theme} explorer search is unobstructed`);
        await capture(`explorer-${language}-${theme}`);
        await window.webContents.executeJavaScript(`(() => {
          document.querySelector('#mobileExplorerTabs [data-tab-key="mobile-ui-two"]').click();
          document.querySelector('[data-terminal-tab-key="mobile-toolbar-fixture"]').parentElement.hidden = false;
        })()`);
      }
    }
  }
  assert.equal(await window.webContents.executeJavaScript(`(() => {
    const before=tabs.length;
    document.querySelector('#mobileWorkspaceTabs .mobile-workspace-tab-main[data-tab-key="mobile-ui-one"]').click();
    document.querySelector('#mobileWorkspaceTabs .mobile-workspace-tab-close[data-tab-key="mobile-ui-two"]').click();
    return tabs.length===before-1&&!tabs.some(tab=>tab.key==='mobile-ui-two')&&activeTabKey==='mobile-ui-one';
  })()`),true,"Mobile tab close preserves the other open session");
  window.setSize(1200, 800);
  for (let attempt=0;attempt<40;attempt+=1) {
    if (await window.webContents.executeJavaScript("innerWidth>760&&!isMobileLayout()")) break;
    await new Promise(resolve => setTimeout(resolve,25));
  }
  assert.equal(await window.webContents.executeJavaScript("document.getElementById('mobileWorkspaceTabs').getBoundingClientRect().width===0&&document.getElementById('mobileExplorerTabs').getBoundingClientRect().width===0"),true,"Mobile navigation stays hidden on desktop");
  console.log("Mobile workspace navigation and compact toolbar passed",JSON.stringify(results));
}

module.exports = {runMobileWorkspaceUiScenario};
