const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

async function runApplicationLifecycleUiScenario(browser) {
  const directory = process.env.TERMA_APPLICATION_LIFECYCLE_VISUAL_DIR || path.join(process.cwd(), 'data', 'application-lifecycle-visual');
  fs.mkdirSync(directory, {recursive: true});
  const execute = source => browser.webContents.executeJavaScript(`(async()=>{${source}})()`);
  const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const groups = [], screenshots = [];
  let checks = 0;
  const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
  const settle = async () => { await delay(250); await execute('await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); };
  const capture = async name => {
    await settle();
    const file = name + '.png';
    fs.writeFileSync(path.join(directory, file), (await browser.webContents.capturePage()).toPNG());
    screenshots.push(file);
  };
  const pointer = async selector => {
    const point = await execute(`
      const element=document.querySelector(${JSON.stringify(selector)});
      element?.scrollIntoView({block:'center'});const box=element?.getBoundingClientRect();
      if(!box||!element.checkVisibility())throw Error('Hidden lifecycle control');
      const point={x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)};
      if(!element.contains(document.elementFromPoint(point.x,point.y)))throw Error('Covered lifecycle control');
      return point;`);
    for (const type of ['mouseMove','mouseDown','mouseUp']) browser.webContents.sendInputEvent({type,...point,button:'left',clickCount:1});
    await settle();
  };
  const key = async keyCode => {
    browser.webContents.focus();
    for (const type of ['keyDown','keyUp']) browser.webContents.sendInputEvent({type,keyCode});
    await settle();
  };
  const inspect = () => execute(`
    const root=document.getElementById('settings-notifications'),han=[];
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    while(walker.nextNode())if(/[\\u3400-\\u9fff]/.test(walker.currentNode.textContent))han.push(walker.currentNode.textContent.trim());
    for(const element of root.querySelectorAll('*'))for(const name of ['title','aria-label','placeholder'])
      if(/[\\u3400-\\u9fff]/.test(element.getAttribute(name)||''))han.push(element.getAttribute(name));
    const buttons=[...root.querySelectorAll('button')].filter(button=>button.checkVisibility());
    return {han,overflow:document.documentElement.scrollWidth>innerWidth+1,buttons:buttons.map(button=>{
      const box=button.getBoundingClientRect(),parent=button.closest('.actions').getBoundingClientRect();
      return {id:button.id,box:box.toJSON(),fits:box.left>=parent.left-1&&box.left>=-1&&box.right<=parent.right+1&&box.right<=innerWidth+1};
    }),status:window.termaApplicationLifecycle.status()};`);
  const ownsDebugger = !browser.webContents.debugger.isAttached();
  if (ownsDebugger) browser.webContents.debugger.attach('1.3');
  await browser.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
  try {
    await execute(`
      await window.termaI18nReady;
      while(window.workspaceRestorePending)await new Promise(r=>setTimeout(r,20));
      await window.termaWorkspaceRefresh.stop();window.termaSftpTransferLifecycle.polling.stop();closeModal();window.termaNotificationToasts.dispose();
      window.termaWorkspaceShell.showPrimary('settings');await window.termaSettingsViews.open();
      window.__lifecycleOriginal={desktop:window.termaDesktop, profiles:window.termaRemoteProfiles,
        topLevelOutput:window.termaTerminalOutputFlow.resumeSessions, vncFocus:window.termaVncRuntime.syncImagesAfterFocus};
      window.__lifecycleFixture={calls:[],listeners:new Map(),writes:[]};
      const f=window.__lifecycleFixture;
      f.originalApi=api;api=(route,options={})=>{
        if(options.method&&options.method!=='GET'){f.writes.push(route);throw Error('Unexpected lifecycle write');}
        return f.originalApi(route,options);
      };
      f.productionStatus=window.termaApplicationLifecycle.status();
      window.termaApplicationLifecycle.dispose();
      const subscribe=name=>callback=>{f.listeners.set(name,callback);return()=>f.listeners.delete(name);};
      window.termaDesktop={...window.termaDesktop,onSftpDragError:subscribe('drag'),onRemoteProfileSettings:subscribe('profile')};
      window.termaTerminalOutputFlow.resumeSessions=()=>{f.calls.push(['terminal']);};
      window.termaVncRuntime.syncImagesAfterFocus=()=>{f.calls.push(['clipboard']);};
      const profiles=window.termaRemoteProfiles;
      f.profiles={...profiles,editor:{...profiles.editor,edit:id=>{f.calls.push(['profile',id]);}}};
      window.termaRemoteProfiles=f.profiles;
      window.termaApplicationLifecycle.start();
    `);
    equal(await execute('return window.__lifecycleFixture.productionStatus.bound'),true,'production shell starts the installed owner');
    for (const width of [1200,390]) for (const theme of ['light','dark']) for (const language of ['zh-CN','en-US']) {
      const prefix = `${width}-${theme}-${language}`;
      browser.setContentSize(width,844);
      await execute(`applyTheme('${theme}');await setTermaLanguage('${language}',{persist:false});window.termaSettingsNavigation.show('settings-notifications');window.termaNotificationToasts.dispose();`);
      await settle();
      await pointer('#notificationSuccessDuration');
      equal(await execute("return document.activeElement.id"),'notificationSuccessDuration','real pointer focuses the existing field');
      await execute(`
        const field=document.getElementById('notificationSuccessDuration');field.value='7.3';field.dispatchEvent(new Event('input',{bubbles:true}));
        document.querySelector('.workspace').scrollTop=10;
        window.__lifecycleDraft={node:field,scroll:document.querySelector('.workspace').scrollTop};
        window.__lifecycleFixture.calls.length=0;
        for(let index=0;index<4;index++)window.dispatchEvent(new Event('focus'));`);
      await settle();
      equal(await execute("return window.__lifecycleFixture.calls.filter(call=>call[0]==='terminal').length"),2,'focus bursts preserve two terminal refresh phases');
      equal(await execute("return window.__lifecycleFixture.calls.filter(call=>call[0]==='clipboard').length"),1,'focus bursts coalesce VNC synchronization');
      let state = await inspect();
      equal(state.overflow,false,'notification surface fits the viewport');
      equal(state.buttons.every(button=>button.fits),true,'each action fits its actual container');
      if (language === 'en-US') equal(state.han,[],'English scans hidden text and attributes');
      await capture(prefix+'-focused');
      const switched = language === 'zh-CN' ? 'en-US' : 'zh-CN';
      await execute(`await setTermaLanguage('${switched}',{persist:false});`);
      await settle();
      const retained = await execute(`
        const field=document.getElementById('notificationSuccessDuration'),saved=window.__lifecycleDraft;
        return {same:field===saved.node,value:field.value,focus:document.activeElement.id,
          scroll:document.querySelector('.workspace').scrollTop,before:saved.scroll};`);
      equal(retained.same&&retained.value==='7.3'&&retained.focus==='notificationSuccessDuration'&&Math.abs(retained.scroll-retained.before)<2,true,'live language retains draft focus and scroll');
      if (switched === 'en-US') equal((await inspect()).han,[],'live English scans hidden text and attributes');
      await capture(prefix+'-live-language');
      await execute(`
        const f=window.__lifecycleFixture;f.calls.length=0;window.termaRemoteProfiles=undefined;
        f.staleProfile=f.listeners.get('profile');f.staleDrag=f.listeners.get('drag');
        f.staleProfile(91);f.staleProfile('91');f.staleProfile(92);`);
      equal(await execute('return window.termaApplicationLifecycle.status().pendingProfiles'),2,'pending native profile IDs merge');
      await execute(`
        const s=window.termaApplicationLifecycle;s.scheduleResume();s.suspend();
        window.__lifecycleFixture.staleProfile(93);window.__lifecycleFixture.staleDrag('Late native message');`);
      await settle();
      const suspended = await execute('return {status:window.termaApplicationLifecycle.status(),listeners:window.__lifecycleFixture.listeners.size,calls:window.__lifecycleFixture.calls}');
      equal(suspended.status.active,false);
      equal(suspended.status.timers,0,'suspension cancels timers');
      equal(suspended.status.framePending,false,'suspension cancels animation work');
      equal(suspended.listeners,0,'suspension releases native subscriptions');
      equal(suspended.calls,[],'stale native callbacks cannot open views or show errors');
      await capture(prefix+'-suspended');
      await execute(`
        const f=window.__lifecycleFixture;window.termaRemoteProfiles=f.profiles;window.termaApplicationLifecycle.resume();window.termaApplicationLifecycle.start();
        f.listeners.get('profile')(94);f.listeners.get('drag')('');
      `);
      await settle();
      equal(await execute("return window.__lifecycleFixture.calls.filter(call=>call[0]==='profile')"),[['profile',94]],'resumed profile event reaches its existing port once');
      equal(await execute('return window.__lifecycleFixture.listeners.size'),2,'resume restores exactly two native subscriptions');
      equal(await execute("return document.querySelector('.toast').textContent.includes(tr('sftp:drag.native_start_failed'))"),true,'native drag fallback uses the current language');
      await capture(prefix+'-drag-error');
      await execute("window.termaNotificationToasts.dispose();document.getElementById('notificationSaveBtn').focus({preventScroll:true});");
      await key('Tab');
      equal(await execute("return document.activeElement.id==='desktopNotificationToggleBtn'&&document.activeElement.matches(':focus-visible')&&parseFloat(getComputedStyle(document.activeElement).outlineWidth)>0"),true,'Tab retains visible keyboard focus');
      await capture(prefix+'-keyboard');
      state = await inspect();
      equal(state.status.timers,0);
      equal(await execute('return window.__lifecycleFixture.writes'),[],'lifecycle verification performs no API writes');
      groups.push({width,theme,language,switched,retained,initial:state,suspended});
      console.log('[application-lifecycle] passed '+prefix);
    }
    return {groups:groups.length,checks,screenshots:screenshots.length};
  } catch (error) {
    await capture('failure');
    throw error;
  } finally {
    fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({groups,checks,screenshots},null,2));
    await execute(`
      window.termaApplicationLifecycle.dispose();window.termaNotificationToasts.dispose();
      const original=window.__lifecycleOriginal;
      if (original) {
        window.termaDesktop=original.desktop;window.termaRemoteProfiles=original.profiles;
        window.termaTerminalOutputFlow.resumeSessions=original.topLevelOutput;
        window.termaVncRuntime.syncImagesAfterFocus=original.vncFocus;
        api=window.__lifecycleFixture.originalApi;
      }
      delete window.__lifecycleOriginal;delete window.__lifecycleFixture;delete window.__lifecycleDraft;`);
    if (ownsDebugger) browser.webContents.debugger.detach();
  }
}

module.exports = {runApplicationLifecycleUiScenario};
