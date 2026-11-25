const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {runTerminalShortcutsUiScenario} = require("./terminal-shortcuts-ui-scenario");

async function checkViewport(window, width, height) {
  window.setContentSize(width, height);
  await new Promise(resolve => setTimeout(resolve, 80));
  const result = await window.webContents.executeJavaScript(`(() => {
    const fixture = document.createElement('section');
    fixture.id = 'issue-shortcuts-fixture';
    fixture.className = 'terminal-tab-surface';
    fixture.style.cssText = 'position:fixed;inset:8px;z-index:10000;padding:8px;background:var(--panel);overflow:hidden;';
    const previousVisible = terminalKeysVisible;
    terminalKeysVisible = true;
    fixture.innerHTML = '<div class="terminal-toolbar"><strong>server:~</strong></div>'
      + '<div class="terminal-main-row"><div class="terminal-box">server:~$</div></div>'
      + '<div class="terminal-mobile-composer"><input aria-label="Command"><button type="button">Send</button></div>';
    fixture.firstElementChild.after(window.termaTerminalKeysService.createHost('issue-shortcuts'));
    document.body.appendChild(fixture);
    termaTerminalKeys.mount('issue-shortcuts');
    terminalKeysVisible = previousVisible;
    const keys = fixture.querySelector('.terminal-keys');
    const terminal = fixture.querySelector('.terminal-main-row');
    const composer = fixture.querySelector('.terminal-mobile-composer');
    const keyRect = keys.getBoundingClientRect();
    const terminalRect = terminal.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    const mobile = isMobileLayout();
    const about = document.createElement('div');
    about.id = 'issue-download-fixture';
    about.className = 'terma-vue-root terma-about-root terma-about-embedded';
    about.dataset.termaAboutMount = 'all';
    about.style.cssText = mobile ? 'position:absolute;top:42px;left:8px;right:8px;' : 'position:absolute;top:42px;left:8px;width:560px;max-width:calc(100% - 16px);';
    about.style.cssText += 'padding:8px;background:var(--panel);color:var(--text);';
    const source = 'https://github.com/zmide/Terma/releases/download/v1.7.6/Terma-1.7.6-windows-x64-installer.exe';
    const routes = [
      {id:'direct',label:'direct',url:source},
      ...['ghfast.top','v6.gh-proxy.org','hk.gh-proxy.org','cdn.gh-proxy.org','edgeone.gh-proxy.org'].map(host => ({id:host,label:host,url:'https://' + host + '/' + source}))
    ];
    routes[5].label = '<b>Mirror label</b>';
    const update = {current_version:'1.7.5',latest_version:'1.7.6',update_available:true,assets:[{name:'Terma-1.7.6-windows-x64-installer.exe',url:source}],
      download_status:{download_asset_name:'Terma-1.7.6-windows-x64-installer.exe',download_links:routes.concat([{id:'unsafe',label:'Invalid protocol',url:'http://example.invalid/file.exe'}])}};
    const savedSnapshot = window.termaUpdateStatus.snapshot;
    const stale = about.cloneNode();
    stale.id = 'issue-download-stale-fixture';
    stale.hidden = true;
    fixture.append(about,stale);
    try {
      const probe = {running:false,results:routes.map((route, index) => ({id:route.id,available:index !== 2,bytes_per_second:index === 1 ? 3 * 1024 * 1024 : 1024 * 1024,elapsed_ms:index === 2 ? 8000 : 100,error:index === 2 ? '测速超时' : ''}))};
      const snapshot = {...savedSnapshot(), update, probe, fnos:false, checking:false};
      window.termaUpdateStatus.snapshot = () => snapshot;
      window.termaMountVueAbout(about,{product_name:'Terma'});
      window.termaUpdateStatus.snapshot = () => ({...snapshot,update:{...update,assets:[{name:'Terma-1.7.7-windows-x64-installer.exe',url:source.replaceAll('1.7.6','1.7.7')}]}});
      window.termaMountVueAbout(stale,{product_name:'Terma'});
    } finally { window.termaUpdateStatus.snapshot = savedSnapshot; }
    const links = about.querySelector('.update-download-links');
    if (!links) throw Error('The production About view did not render update download links');
    for(let node=links;node!==about;node=node.parentElement){
      for(const sibling of node.parentElement.children)if(sibling!==node)sibling.style.display='none';
    }
    const anchors = [...links.querySelectorAll('a')];
    return {
      width:innerWidth,
      mobile,
      fourNavigationKeys:['Home','End','PgUp','PgDn'].every(label => [...keys.querySelectorAll('button')].some(button => button.textContent === label)),
      literalKeyNames:keys.hasAttribute('data-i18n-skip') && [...keys.querySelectorAll('button')].some(button => button.textContent === 'Tab' && button.dataset.i18nSkip === 'true'),
      barPlacement:mobile ? keyRect.top >= terminalRect.bottom - 1 && keyRect.bottom <= composerRect.top + 1 : getComputedStyle(keys).display === 'none',
      terminalVisible:terminalRect.height > 100,
      noPageOverflow:document.body.scrollWidth <= innerWidth + 1,
      noLinkOverflow:links.scrollWidth <= links.clientWidth + 1,
      linkTextFits:[...links.querySelectorAll('a, button')].every(control => control.scrollWidth <= control.clientWidth + 1),
      sixLinks:anchors.length === 6,
      speedButton:!!links.querySelector('#probeUpdateDownloadLinksBtn'),
      fastestRoute:anchors[1]?.classList.contains('is-fastest') && !!anchors[1].querySelector('small'),
      failedRouteClickable:!!anchors[2]?.querySelector('.is-unavailable') && !!anchors[2]?.href,
      originalLink:anchors[0]?.href === source,
      mirrorLinks:anchors.slice(1).every((anchor, index) => anchor.href === routes[index + 1].url),
      opensNewPage:anchors.every(anchor => anchor.target === '_blank' && anchor.rel.includes('noopener')),
      literalLabel:anchors[5]?.textContent.includes('<b>Mirror label</b>') && !anchors[5]?.querySelector('b'),
      staleLinksHidden:!stale.querySelector('.update-download-links')
    };
  })()`);
  for (const [name, value] of Object.entries(result)) {
    if (typeof value === "boolean" && name !== "mobile") assert.equal(value, true, `${width}px: ${name}`);
  }
  const directory = process.env.TERMA_UI_VISUAL_DIR;
  if (directory) {
    await window.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    fs.mkdirSync(directory, {recursive:true});
    fs.writeFileSync(path.join(directory, `issues-${width}.png`), (await window.webContents.capturePage()).toPNG());
  }
  await window.webContents.executeJavaScript("(()=>{termaTerminalKeys.release('issue-shortcuts');const fixture=document.getElementById('issue-shortcuts-fixture');if(fixture){window.termaUnmountVueAbout(fixture);fixture.remove();}})()");
  return result;
}

async function runIssueUiScenario(window) {
  const size = window.getContentSize();
  try {
    const navigation = await window.webContents.executeJavaScript(`(async () => {
      const fixture = document.createElement('div');
      fixture.innerHTML = '<div class="sftp-shell" data-sftp-tab-key="issue-left"><span>left</span></div><div class="sftp-shell" data-sftp-tab-key="issue-right"><span>right</span></div><div class="local-files-shell" data-tab-key="issue-local"><span>local</span></div>';
      document.body.appendChild(fixture);
      const modal = document.getElementById('modal');
      const saved = {tabs, remote:window.termaSftpDirectoryWorkspace.navigation.navigateHistory, local:window.termaLocalFileRuntime.files.historyMove, hidden:modal.hidden};
      const calls = [];
      tabs = [...tabs, ...['issue-left','issue-right','issue-local'].map(key => ({key,kind:key === 'issue-local' ? 'local-files' : 'sftp'}))];
      window.termaSftpDirectoryWorkspace.navigation.navigateHistory = async (key, direction) => { calls.push({direction,key}); return true; };
      window.termaLocalFileRuntime.files.historyMove = async (key, direction) => { calls.push({direction,key}); return true; };
      modal.hidden = true;
      try {
        const right = fixture.querySelector('[data-sftp-tab-key="issue-right"] span');
        const local = fixture.querySelector('[data-tab-key="issue-local"] span');
        const click = (node, button) => ['mousedown','mouseup','auxclick'].map(type => {
          const event = new MouseEvent(type,{button,bubbles:true,cancelable:true});
          node.dispatchEvent(event);
          return event.defaultPrevented;
        });
        const consumed = click(right, 3).every(Boolean);
        await new Promise(resolve => setTimeout(resolve, 0));
        click(right, 4);
        await new Promise(resolve => setTimeout(resolve, 0));
        click(local, 3);
        await new Promise(resolve => setTimeout(resolve, 0));
        return {consumed, calls};
      } finally {
        tabs = saved.tabs;
        window.termaSftpDirectoryWorkspace.navigation.navigateHistory = saved.remote;
        window.termaLocalFileRuntime.files.historyMove = saved.local;
        modal.hidden = saved.hidden;
        fixture.remove();
      }
    })()`);
    assert.equal(navigation.consumed, true);
    assert.deepEqual(navigation.calls, [{direction:-1,key:"issue-right"},{direction:1,key:"issue-right"},{direction:-1,key:"issue-local"}]);
    const shortcuts = await runTerminalShortcutsUiScenario(window);
    const desktop = await checkViewport(window, 1200, 800);
    const mobile = await checkViewport(window, 390, 844);
    console.log("[ui-smoke] issue navigation, shortcut placement, and download links passed");
    return {navigation, shortcuts, desktop, mobile};
  } finally {
    await window.webContents.executeJavaScript("(()=>{const root=document.getElementById('issue-shortcuts-fixture');if(root){window.termaUnmountVueAbout(root);root.remove();}})()");
    window.setContentSize(...size);
    await new Promise(resolve => setTimeout(resolve, 80));
  }
}

module.exports = {runIssueUiScenario};
