'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {captureElectronSurface} = require('./electron-surface-screenshot');
const toolbarCopy = {
  'en-US': require('../public/locales/en-US/common.json'),
  'zh-CN': require('../public/locales/zh-CN/common.json')
};

async function runSftpGlobalSettingsUiScenario(window, options = {}) {
  const viewport = options.viewport || (window.getSize ? (window.getSize()[0] <= 520 ? 'mobile' : 'desktop') : 'desktop');
  const directory = path.join(process.env.TERMA_UI_DIAGNOSTICS_DIR || path.join(process.cwd(), 'data'), 'sftp-global-settings-visual');
  fs.mkdirSync(directory, { recursive: true });
  const execute = source => window.webContents.executeJavaScript(`(async()=>{${source}})()`);
  const capture = async name => {
    window.webContents.invalidate();
    await new Promise(resolve => setTimeout(resolve, 80));
    await captureElectronSurface(window, path.join(directory, `${viewport}-${name}.png`));
  };
  const waitFor = async (expression, timeout = 4000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await execute(`return Boolean(${expression})`)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for ${expression}`);
  };

  await waitFor('window.termaSftpGlobalSettings?.open && window.setTermaLanguage');
  const checkToolbarCopy = async () => {
    const {language, search, add} = await execute(`return {language:document.documentElement.lang,search:document.querySelector('#connectionSearch')?.placeholder,add:document.querySelector('#explorerTools .explorer-main-action')?.textContent.trim()}`);
    const copy = toolbarCopy[language];
    assert.deepEqual({search,add}, {search:copy.workspace.search_ssh_connections,add:copy.auto.add_ssh});
  };
  await checkToolbarCopy();
  await execute(`
    window.__sftpGlobalSettingsWrites=[];
    window.__sftpGlobalSettingsApi=async (url, options={})=>{
      const method=options.method||'GET';
      if(method!=='GET'){
        window.__sftpGlobalSettingsWrites.push({url,method,body:typeof options.body==='string'?JSON.parse(options.body):options.body});
        return {saved:{sftp_max_open_file_size_mb:64,sftp_download_concurrency:4,sftp_upload_concurrency:4}};
      }
      if(url==='/api/sftp/download-settings') return {delivery_mode:'${viewport === 'mobile' ? 'browser' : 'desktop'}',configured_directory:'D:/Downloads',effective_directory:'D:/Downloads',default_directory:'C:/Users/fixture/Downloads'};
      return {saved:{sftp_recycle_bin_enabled:false,sftp_max_open_file_size_mb:50,sftp_text_editor_mode:'ace',sftp_double_click_file_action:'internal',sftp_light_editor_threshold_mb:10,sftp_download_concurrency:3,sftp_upload_concurrency:3,sftp_external_edit_save_rule:'prompt',sftp_external_edit_backup_enabled:true}};
    };
    window.__sftpGlobalSettingsNotify=(message,kind)=>{window.__sftpGlobalSettingsLastNotice={message,kind};};
    window.termaNotificationToasts.dispose();
    applyTheme('dark');
    await setTermaLanguage('zh-CN',{render:false});
    await window.termaSftpGlobalSettings.open({api:window.__sftpGlobalSettingsApi,tr,notify:window.__sftpGlobalSettingsNotify,desktop:${viewport === 'desktop'},runtimeSettings:{saved:{sftp_max_open_file_size_mb:50}}});
  `);
  await waitFor('document.querySelector("#sftpGlobalSettingsTitle")');
  const zh = await execute(`return ({title:document.querySelector('#sftpGlobalSettingsTitle')?.textContent,tabs:[...document.querySelectorAll('#modal [role="tab"]')].map(node=>node.textContent.trim()),save:document.querySelector('#modal .actions button.primary')?.textContent.trim(),visible:document.querySelector('#modal [role="dialog"]')?.checkVisibility()===true})`);
  assert.equal(zh.title, 'SFTP 全局设置');
  assert.deepEqual(zh.tabs, ['常规', '编辑器', '传输']);
  assert.equal(zh.visible, true);
  for (const theme of ['light', 'dark']) for (const language of ['en-US', 'zh-CN']) {
    await execute(`applyTheme('${theme}');await setTermaLanguage('${language}');`);
    await checkToolbarCopy();
    const surface = await execute(`
      const dialog=document.querySelector('#modal [role="dialog"]'),style=getComputedStyle(dialog),r=dialog.getBoundingClientRect();
      const mobileSurface=matchMedia('(max-width:760px), (hover:none) and (pointer:coarse)').matches;
      return {visible:dialog.checkVisibility(),topRadius:style.borderTopLeftRadius,bottomRadius:style.borderBottomLeftRadius,border:style.borderTopWidth,
        bottomRule:dialog.matches('html.flat-ui .modal :is(.modal-card,[role="dialog"],[role="alertdialog"]):not(.is-fullscreen)'),
        mobileSurface, modalClass:document.querySelector('#modal').className,
        fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,translated:dialog.querySelector('h2').textContent===tr('sftp:settings.title')};
    `);
    assert.equal(surface.visible, true, `${viewport}-${language}-${theme} dialog is visible`);
    assert.equal(surface.topRadius, '8px', `${viewport}-${language}-${theme} has rounded upper corners`);
    assert.equal(surface.bottomRadius, surface.mobileSurface ? '0px' : '8px', `${viewport}-${language}-${theme} follows the responsive sheet shape`);
    assert.ok(Number.parseFloat(surface.border) > 0 && Number.parseFloat(surface.border) <= 1.1, `${viewport}-${language}-${theme} outline is thin`);
    assert.equal(surface.bottomRule, true);
    assert.equal(surface.mobileSurface, viewport === 'mobile', `${viewport}-${language}-${theme} uses its expected responsive surface`);
    assert.equal(surface.modalClass, 'modal');
    assert.equal(surface.fits, true);
    assert.equal(surface.translated, true);
    await capture(`${language}-${theme}-rounded-dialog`);
  }
  const presentation = await execute(`
    const dialog=document.querySelector('#modal [role="dialog"]'),active=dialog.querySelector('[aria-selected="true"]'),warning=dialog.querySelector('.warning-with-icon');
    const tab=getComputedStyle(active),body=getComputedStyle(dialog),notice=getComputedStyle(warning);
    const topBorder=Number.parseFloat(tab.borderTopWidth),warningBorder=Number.parseFloat(notice.borderInlineStartWidth);
    return {joined:tab.backgroundColor===body.backgroundColor,topThin:topBorder>0&&topBorder<=1.1,bottom:tab.borderBottomWidth,
      warningColor:notice.color===body.color,warningBorderThin:warningBorder>0&&warningBorder<=2.1,
      warningIcon:!!warning.querySelector('svg'),overflow:document.documentElement.scrollWidth>innerWidth+1};
  `);
  assert.deepEqual(presentation,{joined:true,topThin:true,bottom:'0px',warningColor:true,warningBorderThin:true,warningIcon:true,overflow:false});
  await capture('zh-general');

  await execute(`document.querySelectorAll('#modal [role="tab"]')[1]?.click();`);
  const editor = await execute(`return ({tab:document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim(),external:document.querySelector('#sftpExternalEditorMode')?.id,saveRule:document.querySelector('#sftpExternalEditSaveRule')?.id})`);
  assert.equal(editor.tab, '编辑器');
  if (viewport === 'desktop') assert.equal(editor.external, 'sftpExternalEditorMode');
  else assert.equal(editor.external, undefined);
  assert.equal(editor.saveRule, viewport === 'desktop' ? 'sftpExternalEditSaveRule' : undefined);
  await capture('zh-editor');

  await execute(`document.querySelectorAll('#modal [role="tab"]')[2]?.click();`);
  const transfer = await execute(`return ({tab:document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim(),download:document.querySelector('#sftpDownloadConcurrency')?.id,upload:document.querySelector('#sftpUploadConcurrency')?.id,path:document.querySelector('#sftpDownloadDirectory')?.id||''})`);
  assert.equal(transfer.tab, '传输');
  assert.equal(transfer.download, 'sftpDownloadConcurrency');
  assert.equal(transfer.upload, 'sftpUploadConcurrency');
  await capture('zh-transfer');

  await execute(`applyTheme('light');await setTermaLanguage('en-US');`);
  const en = await execute(`return ({title:document.querySelector('#sftpGlobalSettingsTitle')?.textContent,tabs:[...document.querySelectorAll('#modal [role="tab"]')].map(node=>node.textContent.trim()),save:document.querySelector('#modal .actions button.primary')?.textContent.trim()})`);
  assert.equal(en.title, 'SFTP Settings');
  assert.deepEqual(en.tabs, ['General', 'Editor', 'Transfers']);
  assert.match(en.save, /Save SFTP settings/);
  await capture('en-transfer');

  await execute(`document.querySelector('#modal [role="tab"]')?.click();`);
  await execute(`document.querySelector('#sftpMaxOpenFileSizeMb').value='64';document.querySelector('#sftpMaxOpenFileSizeMb').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#modal .actions button.primary')?.click();`);
  await waitFor('window.__sftpGlobalSettingsWrites.length===1');
  const save = await execute(`return ({url:window.__sftpGlobalSettingsWrites[0]?.url,method:window.__sftpGlobalSettingsWrites[0]?.method,limit:window.__sftpGlobalSettingsWrites[0]?.body?.sftp_max_open_file_size_mb,notice:window.__sftpGlobalSettingsLastNotice?.kind})`);
  assert.equal(save.url, '/api/runtime-settings');
  assert.equal(save.method, 'PUT');
  assert.equal(save.limit, 64);
  assert.equal(save.notice, 'success');
  await capture('en-saved');

  await execute(`window.termaSftpGlobalSettings.close();await setTermaLanguage('zh-CN',{render:false});`);
  const closed = await execute(`return document.querySelector('#modal')?.hidden===true || !document.querySelector('#modal [role="dialog"]')`);
  assert.equal(closed, true);
  const ownership = await execute(`
    const originalApi=api, modal=document.getElementById('modal');
    const startPending=async()=>{
      let finish;
      api=(url,options)=>url==='/api/sftp/download-settings' ? new Promise(resolve=>{finish=resolve;}) : originalApi(url,options);
      const open=window.termaSftpGlobalSettings.open();
      for(let retries=0;!finish&&retries<100;retries++) await new Promise(resolve=>setTimeout(resolve,10));
      if(!finish)throw new Error("SFTP settings request did not start");
      return {open,finish:()=>finish({delivery_mode:'browser'})};
    };
    try {
      const dismissed=await startPending();closeModal();dismissed.finish();await dismissed.open;
      const cancelled=modal.hidden&&!modal.querySelector('.sftp-global-settings-modal');
      const replaced=await startPending();const other=document.createElement('div');other.textContent='Another dialog';modal.replaceChildren(other);modal.hidden=false;
      replaced.finish();await replaced.open;
      return {cancelled,preserved:modal.firstElementChild===other&&!modal.hidden};
    } finally {
      api=originalApi;closeModal();
    }
  `);
  assert.deepEqual(ownership, {cancelled:true,preserved:true});
  for (const [shortLocale, locale] of [['zh','zh-CN'],['en','en-US']]) {
    for (const theme of ['light','dark']) {
      await execute(`
        const originalApi=api;
        api=window.__sftpGlobalSettingsApi;
        try {await setTermaLanguage('${locale}');applyTheme('${theme}');await window.termaSftpGlobalSettings.open();}
        finally {api=originalApi;}
        document.querySelectorAll('#modal .sftp-global-settings-modal [role="tab"]')[1]?.click();
      `);
      const view = await execute(`
        const dialog=document.querySelector('#modal .sftp-global-settings-modal');
        const subtitle=dialog.querySelector('.terminal-settings-head span');
        const close=dialog.querySelector('.terminal-settings-head button');
        const save=dialog.querySelector('.terminal-settings-actions .primary');
        const saveStyle=getComputedStyle(save);
        const canvas=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
        const luminance=color=>{
          canvas.clearRect(0,0,1,1);
          canvas.fillStyle=color;
          canvas.fillRect(0,0,1,1);
          const [r,g,b]=Array.from(canvas.getImageData(0,0,1,1).data).slice(0,3).map(value=>{
            const channel=value/255;
            return channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4;
          });
          return 0.2126*r+0.7152*g+0.0722*b;
        };
        const foreground=luminance(getComputedStyle(save.querySelector('span')).color);
        const background=luminance(saveStyle.backgroundColor);
        const probe=document.createElement('span');
        probe.style.color='var(--tile-text-subtle)';
        subtitle.append(probe);
        const expectedColor=getComputedStyle(probe).color;
        probe.remove();
        return {
          visible:dialog.checkVisibility() && document.querySelector('#sftpTextEditorMode').checkVisibility(),
          vueEvents:!dialog.querySelector('[onclick]'),
          subtitleColor:getComputedStyle(subtitle).color,
          expectedColor,
          closeLabel:close.getAttribute('aria-label'),
          closeText:close.textContent.trim(),
          saveEnabled:!save.disabled,
          saveContrast:(Math.max(foreground,background)+0.05)/(Math.min(foreground,background)+0.05)
        };
      `);
      const variant = `${viewport}-${shortLocale}-${theme}`;
      assert.equal(view.visible, true, `${variant} shows the editor settings`);
      assert.equal(view.vueEvents, true, `${variant} uses Vue event handlers`);
      assert.equal(view.subtitleColor, view.expectedColor, `${variant} uses the theme's secondary text`);
      assert.ok(view.closeLabel, `${variant} close icon has an accessible label`);
      assert.equal(view.closeText, '', `${variant} close icon fits its button`);
      assert.equal(view.saveEnabled, true, `${variant} enables saving`);
      assert.ok(view.saveContrast >= 4.5, `${variant} save text contrast ${view.saveContrast}`);
      await capture(`${shortLocale}-${theme}-editor`);
      await execute(`window.termaSftpGlobalSettings.close();`);
    }
  }
  return {viewport, checks: 44, screenshots: 9, languageSwitch: true, save: true};
}

module.exports = { runSftpGlobalSettingsUiScenario };

