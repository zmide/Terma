"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {BrowserWindow,nativeTheme} = require("electron");
const {startFallbackFixture} = require("./static-content-fallback-fixture");
const {createHarness} = require("./desktop-startup-check");

async function inspectStartup(language, theme, directory) {
  const desktopSettings = {startMinimizedToTray:false, interfaceLanguage:language};
  const {api} = createHarness({settings:desktopSettings});
  const startup = api.createStartupWindow(desktopSettings);
  assert.ok(startup?.loadedUrl.startsWith('data:text/html;charset=utf-8,'));
  assert.equal(startup.options.width, 360);
  assert.equal(startup.options.height, 156);
  assert.equal(startup.options.show, false);
  assert.equal(startup.options.webPreferences.contextIsolation, true);
  assert.equal(startup.options.webPreferences.nodeIntegration, false);
  const page = new BrowserWindow({
    ...startup.options,
    webPreferences:{...startup.options.webPreferences, offscreen:true, backgroundThrottling:false}
  });
  try {
    await page.loadURL(startup.loadedUrl);
    const metrics = await page.webContents.executeJavaScript(`(() => {
      const content = [...document.querySelectorAll('.mark,.copy strong,.copy span,.line')];
      const body = document.body;
      return {
        title:content[1]?.textContent,
        message:content[2]?.textContent,
        dark:matchMedia('(prefers-color-scheme: dark)').matches,
        fits:content.length===4 && content.every(node=>{
          const rect=node.getBoundingClientRect();
          return rect.width>0 && rect.height>0 && rect.left>=0 && rect.right<=innerWidth && rect.top>=0 && rect.bottom<=innerHeight;
        }) && body.scrollHeight<=innerHeight && body.scrollWidth<=innerWidth,
        standalone:!document.querySelector('script,link') && typeof require === 'undefined'
      };
    })()`);
    assert.match(metrics.title, language === 'en-US' ? /^Terma is starting$/ : /^Terma 正在启动$/);
    assert.match(metrics.message, language === 'en-US' ? /^Preparing services and workspace/ : /^正在准备服务与工作区/);
    assert.equal(metrics.dark, theme === 'dark');
    assert.ok(metrics.fits && metrics.standalone);
    await captureBoundary(page, directory, `startup-${language}-${theme}`);
    return {page:'startup', language, theme, ...metrics};
  } finally {
    page.destroy();
  }
}

async function captureBoundary(page, directory, name) {
  page.webContents.invalidate();
  await page.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  fs.writeFileSync(path.join(directory, `${name}.png`), (await page.webContents.capturePage()).toPNG());
}

async function inspectHostRejection(baseUrl, width, language, theme, directory) {
  const rejectedHost = 'terma-entry-fixture.invalid';
  const page = new BrowserWindow({show:false, width, height:844, webPreferences:{
    contextIsolation:true, backgroundThrottling:false, offscreen:true,
    partition:`host-rejection-${width}-${language}-${theme}-${Date.now()}`
  }});
  const session = page.webContents.session;
  const statusCodes = [];
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = {...details.requestHeaders};
    if (details.resourceType === 'mainFrame') requestHeaders.Host = rejectedHost;
    callback({requestHeaders});
  });
  session.webRequest.onCompleted(details => {
    if (details.resourceType === 'mainFrame') statusCodes.push(details.statusCode);
  });
  try {
    const pageUrl = new URL('/', baseUrl);
    pageUrl.searchParams.set('terma_access_language', language);
    await page.loadURL(pageUrl.href);
    const metrics = await page.webContents.executeJavaScript(`(() => {
      const card=document.querySelector('main.card'), nav=document.querySelector('nav.languages');
      return {
        language:document.documentElement.lang,
        host:card?.querySelector('code')?.textContent,
        title:card?.querySelector('h1')?.textContent,
        dark:matchMedia('(prefers-color-scheme: dark)').matches,
        standalone:!document.querySelector('script,link') && !window.termaBootstrapRuntime,
        fits:document.documentElement.scrollWidth<=innerWidth && card?.getBoundingClientRect().right<=innerWidth &&
          nav?.querySelectorAll('a[lang]').length===2 && nav.getBoundingClientRect().bottom<=innerHeight
      };
    })()`);
    assert.equal(metrics.language, language);
    assert.equal(metrics.host, rejectedHost);
    const locale = JSON.parse(fs.readFileSync(path.join(__dirname,'..','public','locales',language,'errors.json'),'utf8'));
    assert.equal(metrics.title, locale.access_page.title);
    assert.equal(metrics.dark, theme === 'dark');
    assert.ok(metrics.standalone && metrics.fits);
    await captureBoundary(page, directory, `host-rejection-${width}-${language}-${theme}`);
    const alternate = language === 'en-US' ? 'zh-CN' : 'en-US';
    const loaded = new Promise(resolve => page.webContents.once('did-finish-load', resolve));
    await page.webContents.executeJavaScript(`document.querySelector('nav a[lang="${alternate}"]').click()`);
    await loaded;
    assert.equal(await page.webContents.executeJavaScript('document.documentElement.lang'), alternate);
    assert.deepEqual(statusCodes, [421,421]);
    return {page:'host-rejection', width, theme, ...metrics, statusCodes};
  } finally {
    page.destroy();
  }
}

async function runFallbackLoginScenario() {
  const fixture = await startFallbackFixture();
  const results = [];
  try {
    for (const width of [390,1200]) for (const language of ['zh-CN','en-US']) for (const theme of ['light','dark']) {
      nativeTheme.themeSource = theme;
      const page = new BrowserWindow({show:false,width,height:844,webPreferences:{
        contextIsolation:true,backgroundThrottling:false,
        partition:`fallback-login-${width}-${language}-${theme}-${Date.now()}`
      }});
      try {
        await page.loadURL(fixture.url+'/login');
        const metrics = await page.webContents.executeJavaScript(`(async()=>{
          await loadLoginLanguage(${JSON.stringify(language)});
          passwordInput.value='Fixture-only-draft';
          passwordInput.setSelectionRange(2,7);
          passwordToggle.click();
          const selection=passwordInput.selectionStart===2&&passwordInput.selectionEnd===7;
          loginButton.click();
          for(let attempt=0;attempt<150&&(!errorBox.textContent||loginButton.disabled);attempt++)
            await new Promise(resolve=>setTimeout(resolve,20));
          const firstError=errorBox.textContent===loginTr('invalid');
          await loadLoginLanguage('${language==='en-US'?'zh-CN':'en-US'}');
          const languageRetained=passwordInput.value==='Fixture-only-draft'&&passwordInput.type==='text'&&errorBox.textContent===loginTr('invalid');
          await loadLoginLanguage(${JSON.stringify(language)});
          const controls=[passwordInput,passwordToggle,loginButton,languageToggle,errorBox];
          return {selection,firstError,languageRetained,
            externalAssets:!!document.querySelector('script[src="/login.js"]')&&!document.querySelector('.terma-login-root'),
            fits:document.documentElement.scrollWidth<=innerWidth+1&&controls.every(node=>{
              const rect=node.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight;
            }),
            themeMatches:matchMedia('(prefers-color-scheme:dark)').matches===${theme==='dark'},
            languageMatches:document.documentElement.lang===${JSON.stringify(language)}
          };
        })()`);
        for (const [name,value] of Object.entries(metrics)) assert.equal(value,true,`fallback ${width}/${language}/${theme} ${name}`);
        if (process.env.TERMA_UI_ORIGIN_PROOF_DIR) {
          fs.mkdirSync(process.env.TERMA_UI_ORIGIN_PROOF_DIR,{recursive:true});
          await new Promise(resolve=>setTimeout(resolve,160));
          fs.writeFileSync(path.join(process.env.TERMA_UI_ORIGIN_PROOF_DIR,`fallback-${width}-${language}-${theme}.png`),(await page.webContents.capturePage()).toPNG());
        }
        results.push({width,language,theme,...metrics});
      } finally {page.destroy();}
    }
  } finally {await fixture.stop();}
  console.log('Unbuilt login fallback UI passed',JSON.stringify(results));
}

async function settingsScenario(options) {
  await window.termaI18nReady;
  while(window.workspaceRestorePending) await new Promise(resolve=>setTimeout(resolve,20));
  const previous={api,runtimeSettings: window.termaRuntimeSettingsModel.snapshot,securitySettings};
  let saves=0;
  try {
    window.termaRuntimeSettingsModel.snapshot={...window.termaRuntimeSettingsModel.snapshot,distribution:options.distribution,saved:{...window.termaRuntimeSettingsModel.snapshot?.saved,language:options.language}};
    const initial=await api('/api/security');
    securitySettings={...initial,auth_mode:options.distribution==='fnos'?'always':initial.auth_mode};
    api=async(url,request={})=>{
      if(url==='/api/runtime-settings'&&!request.method)return window.termaRuntimeSettingsModel.snapshot;
      if(url==='/api/security'&&request.method==='PUT') {
        const data=JSON.parse(request.body);
        if(typeof data.origin_protocol_check_enabled!=='boolean')throw new Error('Missing protocol choice in settings save');
        saves++;
        await previous.api(url,{method:'PUT',body:JSON.stringify({origin_protocol_check_enabled:data.origin_protocol_check_enabled})});
        return {...securitySettings,origin_protocol_check_enabled:data.origin_protocol_check_enabled};
      }
      return previous.api(url,request);
    };
    await setTermaLanguage(options.language,{render:false,emit:false});applyTheme(options.theme);
    await window.termaSettingsNavigation.open('settings-security');window.termaWorkspaceShell.showMobileWorkspace();
    const control=$('securityOriginProtocolCheck');
    if(!control)throw new Error('Protocol checkbox missing');
    const defaultEnabled=control.checked&&!control.disabled;
    const savePolicy=async()=>{
      const button=control.closest('#view-settings').querySelector('[data-security-action="policy"]');
      const expected=saves+1;
      button.click();
      for(let attempt=0;attempt<100&&(saves<expected||button.disabled);attempt++)await new Promise(resolve=>setTimeout(resolve,20));
      if(saves!==expected||button.disabled)throw new Error('Security policy save did not complete');
    };
    control.click();await savePolicy();
    const persistedOff=(await previous.api('/api/security')).origin_protocol_check_enabled===false;
    window.termaSettingsViews.render();refreshIcons();
    const restoredChoice=$('securityOriginProtocolCheck').checked===false;
    $('securityOriginProtocolCheck').click();await savePolicy();
    const persistedOn=(await previous.api('/api/security')).origin_protocol_check_enabled===true;
    const label=$('securityOriginProtocolCheck').closest('label');
    const hint=label.nextElementSibling;
    const text=label.textContent+hint.textContent;
    const bounds=[label,hint].map(node=>node.getBoundingClientRect());
    return {defaultEnabled,persistedOff,restoredChoice,persistedOn,savedTwice:saves===2,
      translated:options.language!=='en-US'||!/[\u3400-\u9fff]/.test(text),
      correctCopy:label.textContent.includes(tr('settings:auto.origin_protocol_check'))&&hint.textContent.includes(tr('settings:auto.origin_protocol_check_hint')),
      fits:document.documentElement.scrollWidth<=innerWidth+1&&bounds.every(rect=>rect.left>=-1&&rect.right<=innerWidth+1),
      noOverlap:bounds[1].top>=bounds[0].bottom-1};
  } finally {
    await previous.api('/api/security',{method:'PUT',body:JSON.stringify({origin_protocol_check_enabled:true})});
    api=previous.api;window.termaRuntimeSettingsModel.snapshot=previous.runtimeSettings;securitySettings=previous.securitySettings;dismissToast();
  }
}

async function loginScenario(options) {
  const waitFor = async predicate => {
    for(let attempt=0;attempt<150;attempt++) {
      if(predicate())return;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    throw new Error('Vue login did not settle');
  };
  await waitFor(()=>document.querySelector('.terma-login-root'));
  const root=document.querySelector('.terma-login-root');
  if(root.dataset.language!==options.language) {
    document.querySelector('.login-language-toggle').click();
    await waitFor(()=>root.dataset.language===options.language);
  }
  const input=document.getElementById('login-password');
  input.value='Protocol-Error-Test-Only';
  input.dispatchEvent(new Event('input',{bubbles:true}));
  const button=document.querySelector('.login-submit');
  await waitFor(()=>!button.disabled);
  button.click();
  await new Promise(resolve=>setTimeout(resolve,20));
  const box=document.querySelector('.login-error');
  await waitFor(()=>box.textContent&&!button.disabled);
  const text=box.textContent;
  if(text!==options.expected)throw new Error(`Login error copy differs: ${JSON.stringify({actual:text,expected:options.expected})}`);
  const rect=box.getBoundingClientRect();
  // The fixed language-switch glyph intentionally contains a Chinese character.
  const allText=document.body.textContent.replace(document.querySelector('.login-language-toggle').textContent,'')+[...document.querySelectorAll('*')].flatMap(node=>['title','aria-label','placeholder'].map(key=>node.getAttribute(key)||'')).join('');
  return {
    correctError:text===options.expected,
    notPasswordError:!text.includes(options.invalid),
    translated:options.language!=='en-US'||!/[\u3400-\u9fff]/.test(allText),
    fits:document.documentElement.scrollWidth<=innerWidth+1&&rect.left>=0&&rect.right<=innerWidth,
    dark:matchMedia('(prefers-color-scheme:dark)').matches===(options.theme==='dark')
  };
}

async function runOriginProtocolUiScenario(window) {
  const results=[];
  const boundaryDirectory = process.env.TERMA_UI_DIAGNOSTICS_DIR && path.join(process.env.TERMA_UI_DIAGNOSTICS_DIR,'origin-boundaries');
  const themeSource=nativeTheme.themeSource;
  try {
    if (boundaryDirectory) fs.mkdirSync(boundaryDirectory,{recursive:true});
    for(const width of [390,1200])for(const language of ['zh-CN','en-US'])for(const theme of ['light','dark']) {
      nativeTheme.themeSource=theme;
      if (boundaryDirectory) {
        if (width === 390) results.push(await inspectStartup(language, theme, boundaryDirectory));
        results.push(await inspectHostRejection(window.webContents.getURL(), width, language, theme, boundaryDirectory));
      }
      for(const distribution of ['standard','fnos']) {
        const options={width,language,theme,distribution};
        const page=new BrowserWindow({show:false,width,height:844,webPreferences:{contextIsolation:true,backgroundThrottling:false,
          partition:`origin-settings-${JSON.stringify(options)}-${Date.now()}`,preload:path.join(__dirname,'ui-smoke-preload.js')}});
        try {
          await page.loadURL(window.webContents.getURL());
          const metrics=await page.webContents.executeJavaScript(`(${settingsScenario.toString()})(${JSON.stringify(options)})`);
          for(const [name,value]of Object.entries(metrics))assert.equal(value,true,`${JSON.stringify(options)} ${name}: ${JSON.stringify(metrics)}`);
          results.push({...options,...metrics});
        } finally {page.destroy();}
      }
      const page=new BrowserWindow({show:false,width,height:844,webPreferences:{contextIsolation:true,backgroundThrottling:false,
        partition:`origin-login-${width}-${language}-${theme}-${Date.now()}`}});
      const loginDiagnostics=[];
      page.webContents.on('console-message',details=>{if(['warning','error'].includes(details.level))loginDiagnostics.push(details.message);});
      try {
        let requestMode='protocol';
        page.webContents.session.webRequest.onBeforeSendHeaders((details,callback)=>{
          const headers={...details.requestHeaders,'X-Forwarded-Proto':'http'};
          if(new URL(details.url).pathname==='/api/auth/login')headers.Origin=requestMode==='protocol'?details.url.replace(/^http:/,'https:').replace(/\/api\/auth\/login$/,''):'http://forbidden.invalid';
          callback({requestHeaders:headers});
        });
        await page.loadURL(new URL('/login',window.webContents.getURL()).href);
        const copy=JSON.parse(fs.readFileSync(path.join(__dirname,'..','public','locales',language,'login.json'),'utf8'));
        const options={language,theme,expected:copy.protocol_mismatch,invalid:copy.invalid};
        const metrics=await page.webContents.executeJavaScript(`(${loginScenario.toString()})(${JSON.stringify(options)})`);
        for(const [name,value]of Object.entries(metrics))assert.equal(value,true,`login ${width}/${language}/${theme} ${name}: ${JSON.stringify(metrics)}`);
        requestMode='origin';
        const forbidden=await page.webContents.executeJavaScript(`(${loginScenario.toString()})(${JSON.stringify({...options,expected:copy.origin_forbidden})})`);
        for(const [name,value]of Object.entries(forbidden))assert.equal(value,true,`login origin ${width}/${language}/${theme} ${name}: ${JSON.stringify(forbidden)}`);
        if(process.env.TERMA_UI_ORIGIN_PROOF_DIR){
          fs.mkdirSync(process.env.TERMA_UI_ORIGIN_PROOF_DIR,{recursive:true});
          await new Promise(resolve=>setTimeout(resolve,200));
          await page.webContents.capturePage();
          await new Promise(resolve=>setTimeout(resolve,100));
          fs.writeFileSync(path.join(process.env.TERMA_UI_ORIGIN_PROOF_DIR,`login-${width}-${language}-${theme}.png`),(await page.webContents.capturePage()).toPNG());
        }
        results.push({page:'login',width,language,theme,...metrics});
      } catch(error) {
        if(loginDiagnostics.length)console.error(loginDiagnostics.join('\n'));
        throw error;
      } finally {page.destroy();}
    }
    await runFallbackLoginScenario();
  } finally {nativeTheme.themeSource=themeSource;}
  console.log('Origin protocol UI passed',JSON.stringify(results));
}
module.exports={runOriginProtocolUiScenario};
