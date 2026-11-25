const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {captureElectronSurface} = require('./electron-surface-screenshot');

async function runSystemNotificationUiScenario(browser) {
  const directory = process.env.TERMA_SYSTEM_NOTIFICATION_VISUAL_DIR || path.join(process.cwd(), 'data', 'system-notification-visual');
  fs.mkdirSync(directory, {recursive: true});
  const execute = source => browser.webContents.executeJavaScript(source);
  const evaluate = (callback, ...args) => execute(`(${callback.toString()})(...${JSON.stringify(args)})`);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const ownsDebugger = !browser.webContents.debugger.isAttached();
  if (ownsDebugger) browser.webContents.debugger.attach('1.3');
  await browser.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {enabled: true});
  const groups = [], screenshots = [];
  let checks = 0;
  const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
  const settle = async () => {
    await execute('(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()');
    await delay(120);
  };
  const shot = async name => {
    await settle();
    const file = name + '.png';
    browser.webContents.invalidate();
    await captureElectronSurface(browser, path.join(directory, file));
    screenshots.push(file);
  };
  const point = selector => evaluate(selector => {
    const element = document.querySelector(selector);
    element?.scrollIntoView({block: 'center'});
    const box = element?.getBoundingClientRect();
    if (!box || !element.checkVisibility()) throw Error('Hidden system notification control ' + selector);
    const position = {x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2)};
    if (!element.contains(document.elementFromPoint(position.x, position.y))) throw Error('Covered system notification control ' + selector);
    return position;
  }, selector);
  const click = async selector => {
    const position = await point(selector);
    for (const type of ['mouseMove','mouseDown','mouseUp']) browser.webContents.sendInputEvent({type, ...position, button: 'left', clickCount: 1});
    await settle();
  };
  const key = async keyCode => {
    browser.webContents.focus();
    for (const type of ['keyDown','keyUp']) browser.webContents.sendInputEvent({type, keyCode});
    await settle();
  };
  const inspect = () => evaluate(() => {
    const root = document.getElementById('settings-notifications'), han = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) if (/[\u3400-\u9fff]/.test(walker.currentNode.textContent)) han.push(walker.currentNode.textContent.trim());
    for (const element of root.querySelectorAll('*')) for (const attribute of ['title','aria-label','placeholder']) {
      if (/[\u3400-\u9fff]/.test(element.getAttribute(attribute) || '')) han.push(element.getAttribute(attribute));
    }
    const buttons = [...root.querySelectorAll('button')].filter(button => button.checkVisibility());
    return {
      han, overflow: document.documentElement.scrollWidth > innerWidth + 1,
      fit: buttons.every(button => {
        const box = button.getBoundingClientRect(), parent = button.closest('.actions').getBoundingClientRect();
        return box.left >= parent.left - 1 && box.left >= -1 && box.right <= parent.right + 1 && box.right <= innerWidth + 1;
      }),
      boxes: buttons.map(button => ({id: button.id, box: button.getBoundingClientRect().toJSON()})),
      status: document.getElementById('desktopNotificationStatus').textContent,
      label: document.getElementById('desktopNotificationToggleBtn').textContent
    };
  });
  await execute(`(async()=>{
    await window.termaI18nReady; await window.termaWorkspaceRefresh.stop(); window.termaSftpTransferLifecycle.polling.stop(); closeModal();
    window.termaNotificationToasts.dispose();
    window.__systemOriginal={api,notification:window.Notification,desktop:window.termaDesktop,focus:window.focus,
      openSftp:window.termaSftpPage.open,handleEvent:window.termaNotificationEvents.handle};
    window.__systemFixture={permission:'default',permissionMode:'grant',requests:0,writes:[],notices:[],actions:[],events:[],subscriptions:0,listeners:new Map(),saveFailure:false};
    const fixture=window.__systemFixture;
    class FixtureNotification {
      static get permission(){return fixture.permission;}
      static requestPermission(){
        fixture.requests++;
        if(fixture.permissionMode==='pending')return new Promise(resolve=>{fixture.resolvePermission=value=>{fixture.permission=value;resolve(value);};});
        fixture.permission='granted';return Promise.resolve('granted');
      }
      constructor(title,options){this.title=title;this.options=options;fixture.notices.push(this);}
      close(){this.closed=true;this.onclose?.();}
    }
    fixture.constructorType=FixtureNotification;window.Notification=FixtureNotification;
    api=async (url,options={})=>{
      if(url==='/api/runtime-settings'&&options.method==='PUT'){
        const body=JSON.parse(options.body);fixture.writes.push(body);
        if(fixture.saveFailure)throw Error(tr('settings:auto.notification_save_failed'));
        return {...window.termaRuntimeSettingsModel.snapshot,saved:{...window.termaRuntimeSettingsModel.snapshot.saved,...body}};
      }
      return window.__systemOriginal.api(url,options);
    };
    const subscribe=kind=>callback=>{fixture.subscriptions++;fixture.listeners.set(kind,callback);return()=>fixture.listeners.delete(kind);};
    window.termaDesktop={...window.termaDesktop,onNotification:subscribe('event'),onNotificationAction:subscribe('action')};
    window.focus=()=>fixture.actions.push(['focus']);
    window.termaSftpPage.open=value=>fixture.actions.push(['sftp',value]);
    window.termaNotificationEvents.handle=async (...value)=>{fixture.events.push(value);};
    window.termaSystemNotifications.dispose();window.termaSystemNotifications.resume();
    window.termaWorkspaceShell.showPrimary('settings');await window.termaSettingsViews.open();
  })()`);
  try {
    for (const width of [1200,390]) for (const theme of ['light','dark']) for (const language of ['zh-CN','en-US']) {
      browser.setSize(width, 900);
      const prefix = `${width}-${theme}-${language}`;
      await evaluate(async (theme, language) => {
        applyTheme(theme);await setTermaLanguage(language, {persist:false});
        window.termaNotificationToasts.dispose();
        const fixture=window.__systemFixture;
        fixture.permission='default';fixture.permissionMode='grant';fixture.saveFailure=false;
        fixture.requests=0;fixture.writes=[];fixture.notices=[];fixture.actions=[];
        window.termaRuntimeSettingsModel.snapshot.saved.desktop_notifications_enabled=false;
        window.termaSettingsNavigation.show('settings-notifications');
        window.termaRefreshVueSettings($('view-settings'));
      }, theme, language);
      await settle();
      await point('#desktopNotificationToggleBtn');
      const initial = await inspect();
      equal(initial.overflow, false, 'notification settings fit the viewport');
      equal(initial.fit, true, 'each notification action stays within its container');
      if (language === 'en-US') equal(initial.han, [], 'English scans hidden notification settings and attributes');
      await shot(prefix + '-default');
      await evaluate(() => {window.Notification=undefined;window.termaRefreshVueSettings($('view-settings'));});
      await click('#desktopNotificationToggleBtn');
      equal(await evaluate(() => window.__systemFixture.writes.length), 0, 'unsupported permission never writes settings');
      await shot(prefix + '-unsupported');
      await execute('void(window.Notification=window.__systemFixture.constructorType);');
      await evaluate(() => {window.__systemFixture.permission='denied';window.termaRefreshVueSettings($('view-settings'));});
      await click('#desktopNotificationToggleBtn');
      equal(await evaluate(() => window.__systemFixture.requests), 0, 'denied permission never prompts again');
      await shot(prefix + '-denied');
      await evaluate(() => {
        const fixture=window.__systemFixture;
        fixture.permission='default';fixture.permissionMode='pending';
        window.termaNotificationToasts.dispose();window.termaRefreshVueSettings($('view-settings'));
      });
      await click('#desktopNotificationToggleBtn');
      equal(await evaluate(() => document.getElementById('desktopNotificationToggleBtn').disabled), true, 'permission wait disables the Vue action');
      await evaluate(() => {document.getElementById('desktopNotificationToggleBtn').click();});
      equal(await evaluate(() => window.__systemFixture.requests), 1, 'repeated pending action shares one permission request');
      await shot(prefix + '-pending');
      const switched = language === 'en-US' ? 'zh-CN' : 'en-US';
      const livePrefix = `${prefix}-to-${switched}`;
      await evaluate(async language => {
        const field=document.getElementById('notificationSuccessDuration');
        document.querySelector('.workspace').scrollTop=10;
        field.value='7.3';field.dispatchEvent(new Event('input',{bubbles:true}));field.focus({preventScroll:true});
        window.__systemDraft={node:field,scroll:document.querySelector('.workspace').scrollTop};
        await setTermaLanguage(language,{persist:false});
      }, switched);
      await settle();
      const retained = await evaluate(() => {
        const field=document.getElementById('notificationSuccessDuration');
        return {sameNode:field===window.__systemDraft.node,value:field.value,active:document.activeElement.id,
          scroll:document.querySelector('.workspace').scrollTop,before:window.__systemDraft.scroll};
      });
      fs.writeFileSync(path.join(directory,prefix+'-retained.json'),JSON.stringify(retained,null,2));
      equal(retained.sameNode&&retained.value==='7.3'&&retained.active==='notificationSuccessDuration'&&Math.abs(retained.scroll-retained.before)<2, true, 'live language retains notification draft focus and scroll');
      equal(await evaluate(() => document.getElementById('desktopNotificationToggleBtn').textContent.trim()===tr('settings:auto.saving')), true, 'pending permission label translates live');
      if (switched === 'en-US') equal((await inspect()).han, [], 'live English scans hidden notification settings and attributes');
      await evaluate(() => document.getElementById('desktopNotificationToggleBtn').scrollIntoView({block:'center'}));
      await shot(livePrefix + '-pending-live');
      await evaluate(() => window.__systemFixture.resolvePermission('granted'));
      await settle();
      equal(await evaluate(() => window.__systemFixture.writes), [{desktop_notifications_enabled:true}], 'grant saves through the existing settings API');
      equal(await evaluate(() => window.termaSystemNotifications.enabled()), true);
      await shot(livePrefix + '-enabled');
      await evaluate(() => {
        const fixture=window.__systemFixture;
        window.termaSystemNotifications.show({id:77,title:'Fixture notification',message:'Fixture body',action:{view:'sftp',connection_id:123}});
        fixture.notices.at(-1).onclick();
      });
      equal(await evaluate(() => window.__systemFixture.actions.slice(-2)), [['focus'],['sftp',123]], 'browser notification click routes the captured action');
      equal(await evaluate(() => window.__systemFixture.notices.at(-1).closed), true);
      const position = await point('#desktopNotificationToggleBtn');
      browser.webContents.sendInputEvent({type:'mouseMove', ...position});
      equal(await evaluate(() => {
        const style=getComputedStyle(document.getElementById('desktopNotificationToggleBtn'));
        return style.transform==='none'&&style.boxShadow==='none';
      }), true, 'pointer hover keeps the notification action flat');
      await evaluate(() => document.getElementById('notificationSaveBtn').focus({preventScroll:true}));
      await key('Tab');
      equal(await evaluate(() => document.activeElement.id), 'desktopNotificationToggleBtn', 'Tab reaches the notification action');
      equal(await evaluate(() => document.activeElement.matches(':focus-visible')&&parseFloat(getComputedStyle(document.activeElement).outlineWidth)>0), true, 'keyboard focus remains visible');
      await key('Space');
      equal(await evaluate(() => window.termaSystemNotifications.enabled()), false, 'keyboard activation disables desktop notifications');
      await shot(livePrefix + '-disabled-keyboard');
      await evaluate(() => {window.__systemFixture.saveFailure=true;window.termaNotificationToasts.dispose();});
      await click('#desktopNotificationToggleBtn');
      equal(await evaluate(() => window.termaSystemNotifications.enabled()), false, 'failed settings save preserves the disabled preference');
      equal(await evaluate(() => !document.getElementById('desktopNotificationToggleBtn').disabled), true, 'save failure releases busy state');
      await shot(livePrefix + '-save-error');
      groups.push({width,theme,language,switched,initial,final:await inspect()});
      console.log('[system-notification] passed ' + prefix);
    }
    equal(await evaluate(() => {
      const service=window.termaSystemNotifications,fixture=window.__systemFixture;
      const before=fixture.subscriptions;service.bindDesktop();service.bindDesktop();
      return fixture.subscriptions===before&&fixture.listeners.size===2;
    }), true, 'native notification subscriptions are idempotent');
    equal(await evaluate(async () => {
      const fixture=window.__systemFixture, service=window.termaSystemNotifications;
      const stale=fixture.listeners.get('action'), events=fixture.listeners.get('event');
      events({event:{id:81},display:false});await Promise.resolve();
      const native=fixture.events.at(-1);
      service.dispose();const before=fixture.actions.length;stale({view:'sftp',connection_id:123});
      const cleaned=fixture.listeners.size===0&&fixture.actions.length===before;
      service.resume();
      return native[1].fromDesktop===true&&native[1].display===false&&cleaned&&fixture.listeners.size===2;
    }), true, 'native bridge preserves display policy and releases stale callbacks');
    return {groups:groups.length,checks,screenshots:screenshots.length};
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify({groups,checks,screenshots},null,2));
    await execute(`window.termaSystemNotifications.dispose();api=window.__systemOriginal.api;window.Notification=window.__systemOriginal.notification;window.termaDesktop=window.__systemOriginal.desktop;window.focus=window.__systemOriginal.focus;window.termaSftpPage.open=window.__systemOriginal.openSftp;window.termaNotificationEvents.handle=window.__systemOriginal.handleEvent;window.termaNotificationToasts.dispose();delete window.__systemFixture;delete window.__systemDraft;delete window.__systemOriginal;`);
    if (ownsDebugger) browser.webContents.debugger.detach();
  }
}

module.exports = {runSystemNotificationUiScenario};
