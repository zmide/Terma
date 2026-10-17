const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function runMobileWorkspaceUiScenario(window) {
  window.setSize(390, 844);
  const prepared = await window.webContents.executeJavaScript(`(async () => { try {
    await window.termaI18nReady;
    while (window.workspaceRestorePending) await new Promise(resolve => setTimeout(resolve, 20));
    window.restoringTabs = true;
    for (const [key,title] of [['mobile-ui-one','Alpha <file>'],['mobile-ui-two','Beta']]) {
      // Generic fixture tabs exercise real activation without starting an SSH connection.
      setWorkspace(title,'','terminal',key,true,true,{kind:'mobile-ui-fixture'});
    }
    const view = document.createElement('div');
    view.style.cssText='position:fixed;left:6px;right:6px;top:100px';
    document.body.appendChild(view);
    view.innerHTML = '<div class="terminal-toolbar"><div class="terminal-title-row">Terminal</div><div class="actions terminal-actions">'
      + '<button class="terminal-action-sftp">'+icon('folder-sync')+'<span>SFTP</span></button>'
      + '<button aria-label="smoke-x11">'+icon('x11')+'<span>X11</span></button>'
      + '<button class="terminal-action-font" aria-label="smoke-minus">'+icon('minus')+'</button>'
      + '<output class="terminal-font-size-readout">16px</output>'
      + '<button class="terminal-action-font" aria-label="smoke-plus">'+icon('plus')+'</button>'
      + Array.from({length:12},()=>'<button>'+icon('settings')+'<span>Settings</span></button>').join('')
      + '</div></div>';
    bindTerminalToolbarScroll(view.querySelector('.terminal-toolbar'));
    syncResponsivePane();
    showMobileWorkspace();
    return true;
  } catch(error) { return {error:String(error),stack:error.stack}; } })()`);
  assert.equal(prepared,true,JSON.stringify(prepared));
  const results = [];
  for (const language of ["zh-CN", "en-US"]) {
    for (const theme of ["light", "dark"]) {
      await window.webContents.executeJavaScript(`(async () => {
        await setTermaLanguage(${JSON.stringify(language)}, {emit:false});
        applyTheme(${JSON.stringify(theme)});
        renderMobileWorkspaceTabs();
      })()`);
      await new Promise(resolve => setTimeout(resolve, 60));
      const metrics = await window.webContents.executeJavaScript(`(() => {
        const list=document.getElementById('mobileWorkspaceTabs');
        const back=document.getElementById('mobileBack').getBoundingClientRect();
        const nav=list.getBoundingClientRect();
        const count=tabs.length;
        const sessions=terminalSessions.size;
        list.querySelector('[data-tab-key="mobile-ui-one"]').click();
        const switched=activeTabKey==='mobile-ui-one'&&document.querySelector('#content').classList.contains('mobile-show');
        document.getElementById('mobileBack').click();
        const explorer=document.getElementById('mobileExplorerTabs');
        const explorerVisible=explorer.getBoundingClientRect().width>0&&!document.querySelector('.left-pane').classList.contains('mobile-hide');
        explorer.querySelector('[data-tab-key="mobile-ui-two"]').click();
        const reopened=activeTabKey==='mobile-ui-two'&&document.querySelector('#content').classList.contains('mobile-show');
        const actions=document.querySelector('.terminal-toolbar .terminal-actions');
        actions.scrollLeft=0;
        terminalToolbarScrollState(actions);
        const buttons=[...actions.querySelectorAll('button')].filter(button=>getComputedStyle(button).display!=='none');
        const rects=buttons.map(button=>button.getBoundingClientRect());
        const minus=actions.querySelector('[aria-label="smoke-minus"]').getBoundingClientRect();
        const readout=actions.querySelector('output').getBoundingClientRect();
        const plus=actions.querySelector('[aria-label="smoke-plus"]').getBoundingClientRect();
        const right=document.querySelector('.terminal-actions-scroll-right');
        const left=document.querySelector('.terminal-actions-scroll-left').getBoundingClientRect();
        const arrow=right.getBoundingClientRect();
        const x11=actions.querySelector('.x11-icon');
        const closeButtons=[...list.querySelectorAll('.mobile-workspace-tab-close')];
        const before=actions.scrollLeft;
        right.click();
        return {sameRow:Math.abs((back.top+back.height/2)-(nav.top+nav.height/2))<1&&nav.left>=back.right,
          switched,explorerVisible,reopened,noNewSessions:tabs.length===count&&terminalSessions.size===sessions,
          escaped:!list.querySelector('file')&&list.textContent.includes('Alpha <file>'),
          compact:rects.every(rect=>Math.abs(rect.width-30)<1&&Math.abs(rect.height-30)<1),
          aligned:rects.every(rect=>Math.abs(rect.top-left.top)<1&&Math.abs(rect.bottom-arrow.bottom)<1),
          coordinates:{arrows:[left.top,left.height,arrow.top,arrow.height],buttons:rects.map(rect=>[rect.top,rect.height])},
          x11Visible:[x11,x11.querySelector('svg'),x11.querySelector('b')].every(node=>node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0),
          closeVisible:closeButtons.length===2&&closeButtons.every(button=>button.tagName==='BUTTON'&&button.getBoundingClientRect().width>=24&&button.getBoundingClientRect().right<=button.parentElement.getBoundingClientRect().right&&!button.parentElement.closest('button')),
          fontOrder:minus.right<=readout.left&&readout.right<=plus.left&&Math.abs(minus.top-readout.top)<1,
          toolbarScroll:actions.scrollLeft>before,withinViewport:document.documentElement.scrollWidth<=innerWidth,
          label:list.getAttribute('aria-label')};
      })()`);
      for (const [key,value] of Object.entries(metrics)) if (!["label","coordinates"].includes(key)) assert.equal(value,true,`${language}/${theme} ${key}: ${JSON.stringify(metrics)}`);
      assert.equal(metrics.label, language === "zh-CN" ? "已打开的标签" : "Open tabs");
      const {coordinates,...summary}=metrics;
      results.push({language,theme,...summary});
      if (process.env.TERMA_UI_MOBILE_PROOF_DIR) {
        fs.mkdirSync(process.env.TERMA_UI_MOBILE_PROOF_DIR,{recursive:true});
        fs.writeFileSync(path.join(process.env.TERMA_UI_MOBILE_PROOF_DIR,`mobile-${language}-${theme}.png`),(await window.webContents.capturePage()).toPNG());
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
