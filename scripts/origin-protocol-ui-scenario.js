"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {BrowserWindow,nativeTheme} = require("electron");

async function settingsScenario(options) {
  await window.termaI18nReady;
  while(window.workspaceRestorePending) await new Promise(resolve=>setTimeout(resolve,20));
  const previous={api,runtimeSettings,securitySettings};
  let saves=0;
  try {
    runtimeSettings={...runtimeSettings,distribution:options.distribution,saved:{...runtimeSettings?.saved,language:options.language}};
    const initial=await api('/api/security');
    securitySettings={...initial,auth_mode:options.distribution==='fnos'?'always':initial.auth_mode};
    api=async(url,request={})=>{
      if(url==='/api/runtime-settings'&&!request.method)return runtimeSettings;
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
    await openSettingsSection('settings-security');showMobileWorkspace();
    const control=$('securityOriginProtocolCheck');
    if(!control)throw new Error('Protocol checkbox missing');
    const defaultEnabled=control.checked&&!control.disabled;
    control.click();await saveSecurityOptions();
    const persistedOff=(await previous.api('/api/security')).origin_protocol_check_enabled===false;
    renderSettings();refreshIcons();
    const restoredChoice=$('securityOriginProtocolCheck').checked===false;
    $('securityOriginProtocolCheck').click();await saveSecurityOptions();
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
    api=previous.api;runtimeSettings=previous.runtimeSettings;securitySettings=previous.securitySettings;dismissToast();
  }
}

async function runOriginProtocolUiScenario(window) {
  const results=[];
  const themeSource=nativeTheme.themeSource;
  try {
    for(const width of [390,1200])for(const language of ['zh-CN','en-US'])for(const theme of ['light','dark']) {
      nativeTheme.themeSource=theme;
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
      try {
        page.webContents.session.webRequest.onBeforeSendHeaders((details,callback)=>{
          const headers={...details.requestHeaders,'X-Forwarded-Proto':'http'};
          if(new URL(details.url).pathname==='/api/auth/login')headers.Origin=details.url.replace(/^http:/,'https:').replace(/\/api\/auth\/login$/,'');
          callback({requestHeaders:headers});
        });
        await page.loadURL(new URL('/login',window.webContents.getURL()).href);
        const metrics=await page.webContents.executeJavaScript(`(async()=>{
          await loadLoginLanguage(${JSON.stringify(language)});
          document.getElementById('password').value='Protocol-Error-Test-Only';
          await login();
          const box=document.getElementById('err');
          const text=box.textContent;
          const rect=box.getBoundingClientRect();
          const correctError=text===loginTr('protocol_mismatch');
          const notPasswordError=!text.includes(loginTr('invalid'));
          // The fixed language-switch glyph intentionally contains a Chinese character.
          const allText=document.body.textContent.replace(document.getElementById('languageToggle').textContent,'')+[...document.querySelectorAll('*')].flatMap(node=>['title','aria-label','placeholder'].map(key=>node.getAttribute(key)||'')).join('');
          const translated=${JSON.stringify(language)}!=='en-US'||!/[\\u3400-\\u9fff]/.test(allText);
          const fits=document.documentElement.scrollWidth<=innerWidth+1&&rect.left>=0&&rect.right<=innerWidth;
          const dark=matchMedia('(prefers-color-scheme:dark)').matches===${theme==='dark'};
          lastLoginError={error:'Forbidden'};applyLoginLanguage();
          const legacyHint=box.textContent===loginTr('origin_forbidden');
          lastLoginError={error_code:'request_origin_protocol_mismatch'};applyLoginLanguage();
          return {correctError,notPasswordError,translated,fits,dark,legacyHint};
        })()`);
        for(const [name,value]of Object.entries(metrics))assert.equal(value,true,`login ${width}/${language}/${theme} ${name}: ${JSON.stringify(metrics)}`);
        if(process.env.TERMA_UI_ORIGIN_PROOF_DIR){
          fs.mkdirSync(process.env.TERMA_UI_ORIGIN_PROOF_DIR,{recursive:true});
          fs.writeFileSync(path.join(process.env.TERMA_UI_ORIGIN_PROOF_DIR,`login-${width}-${language}-${theme}.png`),(await page.webContents.capturePage()).toPNG());
        }
        results.push({page:'login',width,language,theme,...metrics});
      } finally {page.destroy();}
    }
  } finally {nativeTheme.themeSource=themeSource;}
  console.log('Origin protocol UI passed',JSON.stringify(results));
}
module.exports={runOriginProtocolUiScenario};
