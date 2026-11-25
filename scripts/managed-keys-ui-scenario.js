const fs = require('node:fs');
const path = require('node:path');

async function runManagedKeysUiScenario(window) {
  const directory = path.join(process.env.TERMA_UI_DIAGNOSTICS_DIR || 'data', 'managed-keys-visual');
  fs.mkdirSync(directory, {recursive:true});
  const execute = source => window.webContents.executeJavaScript(source);
  const results = [];
  for (const width of [1200, 392]) {
    window.setSize(width, 850);
    results.push(await execute(`(async () => {
      const requestPort = window.termaWorkspaceRequestPort;
      const previous = {api, requestFetch:requestPort.fetch, securitySettings, runtimeSettings: window.termaRuntimeSettingsModel.snapshot, connections, language:document.documentElement.lang, theme:document.documentElement.dataset.theme};
      const result = [];
      const wait = async (ready, label) => {
        for(let i=0;i<100&&!ready();i++) await new Promise(resolve=>setTimeout(resolve,15));
        if(!ready()) throw new Error('Managed key UI did not settle: '+label);
      };
      const click = action => document.querySelector('#sshKeyManagementPanel [data-managed-action="'+action+'"]').click();
      const fixture = {name:'acceptance_key',path:'/fixture/ssh/acceptance_key',scope:'project',type:'Ed25519',bits:256,comment:'Acceptance key',has_passphrase:false};
      try {
        window.termaRuntimeSettingsModel.snapshot = {...window.termaRuntimeSettingsModel.snapshot,distribution:'fnos'};
        securitySettings = {...securitySettings,manage_user_ssh_keys_enabled:false};
        api = async (path, options = {}) => {
          if (path === '/api/runtime-settings') return {...previous.runtimeSettings,distribution:'fnos'};
          if (path === '/api/security') return {...previous.securitySettings,manage_user_ssh_keys_enabled:false};
          if (path === '/api/managed-keys') return {items:[fixture]};
          if (path === '/api/managed-keys/properties') return options.method === 'PUT' ? {ok:true,item:fixture} : fixture;
          return previous.api(path, options);
        };
        requestPort.fetch = async (pathname, options={}) => {
          if(!pathname.startsWith('/api/managed-keys')&&pathname!=='/api/connections/123/ssh-key/deploy') return previous.requestFetch(pathname,options);
          return Response.json(await api(pathname,options));
        };
        await window.termaSettingsViews.open();
        for (const language of ['zh-CN','en-US']) {
          await setTermaLanguage(language,{emit:false});
          for (const theme of ['light','dark']) {
            window.termaRuntimeSettingsModel.snapshot = {...window.termaRuntimeSettingsModel.snapshot,distribution:'fnos'};
            document.documentElement.dataset.theme = theme;
            window.termaSettingsViews.render();
            const storagePanel = document.querySelector('#settings-general .storage-settings-section');
            if (!storagePanel || storagePanel.querySelector('input,button,select')) throw new Error('fnOS storage settings expose locked actions');
            window.termaSettingsNavigation.show('settings-key-management');
            await wait(()=>document.querySelector('#managedKeysList .ssh-managed-key-row'),'list');
            await new Promise(resolve=>requestAnimationFrame(resolve));
            const panel = document.getElementById('sshKeyManagementPanel');
            const row = panel.querySelector('.ssh-managed-key-row');
            if (!row) throw new Error('Managed key row is missing: '+panel.textContent);
            const rectangle = row.getBoundingClientRect();
            if (!document.getElementById('manageUserSshKeysEnabled').disabled) throw new Error('fnOS user scope toggle is enabled');
            if (rectangle.width < 1 || rectangle.left < -1 || rectangle.right > innerWidth + 1) throw new Error('Managed key row overflows: '+JSON.stringify({viewport:innerWidth,left:rectangle.left,right:rectangle.right,width:rectangle.width}));
            if (language === 'en-US' && /[\\u3400-\\u9fff]/.test(panel.textContent)) throw new Error('Chinese text remains in English key management');
            click('properties');await wait(()=>document.getElementById('managedKeyComment'),'properties');
            if (!document.getElementById('managedKeyComment')) throw new Error('Key properties did not open');
            const modal = document.querySelector('.ssh-key-properties-modal');
            if (language === 'en-US' && /[\\u3400-\\u9fff]/.test(modal.textContent)) throw new Error('Chinese text remains in English key properties');
            closeModal();
            result.push({language,theme,width:innerWidth});
          }
        }
        let finishRead;
        let finishSave;
        let saveBody;
        const keysApi = api;
        api = async (pathname, options = {}) => {
          if (pathname.startsWith('/api/managed-keys/public?')) {
            const query = new URL(pathname, location.origin).searchParams;
            if (query.get('scope') !== 'project' || query.get('path') !== fixture.path) throw new Error('Key query changed');
            return {public_key:'ssh-ed25519 AAAATEST fixture'};
          }
          if (pathname === '/api/managed-keys/properties') {
            if (options.method === 'POST') return new Promise(resolve => {finishRead = resolve;});
            saveBody = JSON.parse(options.body);
            return new Promise(resolve => {finishSave = resolve;});
          }
          return keysApi(pathname, options);
        };
        click('properties');await wait(()=>finishRead,'first properties request');
        click('public');await wait(()=>document.querySelector('#managedPublicKeyText'),'public key');
        finishRead(fixture);
        await new Promise(resolve=>setTimeout(resolve,50));
        if (!document.querySelector('#managedPublicKeyText') || document.querySelector('#managedKeyComment')) {
          throw new Error('A stale properties response replaced the public key');
        }
        closeModal();
        finishRead=null;
        click('properties');await wait(()=>finishRead,'abandoned properties request');
        window.termaSettingsNavigation.show('settings-general');
        finishRead(fixture);
        await new Promise(resolve=>setTimeout(resolve,50));
        if (!document.getElementById('modal').hidden) throw new Error('A stale read reopened settings');
        window.termaSettingsNavigation.show('settings-key-management');
        finishRead=null;
        click('properties');await wait(()=>finishRead,'third properties request');finishRead(fixture);
        await wait(()=>document.getElementById('managedKeyComment'),'editable properties');
        document.querySelector('#managedKeyComment').value = 'Edited fixture key';
        document.querySelector('[data-managed-properties-save]').click();
        await wait(()=>finishSave,'properties save');
        if (saveBody?.comment !== 'Edited fixture key' || saveBody.path !== fixture.path || saveBody.change_passphrase) {
          throw new Error('Key property payload changed');
        }
        click('public');await wait(()=>document.querySelector('#managedPublicKeyText'),'replacement public key');
        finishSave({ok:true, item:fixture});
        await new Promise(resolve=>setTimeout(resolve,50));
        if (!document.querySelector('#managedPublicKeyText')) throw new Error('A stale save closed the replacement dialog');
        closeModal();

        const writes=[];
        connections=[{id:123,name:'Fixture SSH',ssh_host:'fixture.example',ssh_user:'test',ssh_port:22}];
        api=async (pathname,options={})=>{
          if(pathname==='/api/connections/123/ssh-key/deploy'||(pathname==='/api/managed-keys'&&options.method==='DELETE')) {
            writes.push({pathname,body:JSON.parse(options.body)});return {ok:true};
          }
          return keysApi(pathname,options);
        };
        click('deploy');await wait(()=>document.querySelector('#managedDeployConnection'),'deploy dialog');
        const deploy=document.querySelector('[data-managed-deploy-confirm]');
        deploy.click();await wait(()=>!deploy.disabled&&!deploy.dataset.uiActionBusy,'missing target validation');
        if(writes.length)throw new Error('Deployment without a selected connection made a request');
        document.querySelector('#managedDeployConnection').value='123';deploy.click();
        await wait(()=>document.getElementById('modal').hidden,'deployment completion, selected: '+document.querySelector('#managedDeployConnection')?.value);
        if(writes.length!==1||writes[0].body.public_path!==fixture.path+'.pub')throw new Error('Deployment request changed');
        const choice=index=>document.querySelector('#modal:not([hidden]) [data-choice="'+index+'"]');
        click('delete');await wait(()=>choice(1),'delete confirmation');choice(1).click();
        await wait(()=>!document.querySelector('[data-managed-action="delete"]').disabled,'cancelled delete');
        if(writes.length!==1)throw new Error('Cancelled delete made a request');
        click('delete');await wait(()=>choice(0),'retry delete confirmation');choice(0).click();
        await wait(()=>writes.length===2,'confirmed delete');
        if(JSON.stringify(writes[1].body)!==JSON.stringify({path:fixture.path,scope:fixture.scope}))throw new Error('Delete endpoint must receive only the selected path and scope');

        window.termaRuntimeSettingsModel.snapshot={...window.termaRuntimeSettingsModel.snapshot,distribution:'standard'};window.termaSettingsViews.render();
        const toggle=()=>document.getElementById('manageUserSshKeysEnabled');
        let scopeWrites=0;
        api=async (pathname,options={})=>{
          if(pathname!=='/api/security'||options.method!=='PUT')return keysApi(pathname,options);
          scopeWrites++;
          const body=JSON.parse(options.body);
          if(body.manage_user_ssh_keys_enabled!==true)throw new Error('Scope selection changed');
          if(scopeWrites===1)throw new Error('Fixture rejected scope');
          return {...securitySettings,...body};
        };
        toggle().click();await wait(()=>scopeWrites===1&&!toggle().disabled,'rejected user scope');
        if(toggle().checked||securitySettings.manage_user_ssh_keys_enabled)throw new Error('Failed scope switch did not roll back');
        toggle().click();await wait(()=>scopeWrites===2&&!toggle().disabled,'enabled user scope');
        if(!toggle().checked||securitySettings.manage_user_ssh_keys_enabled!==true)throw new Error('Saved scope disagrees with the switch');
        window.termaRuntimeSettingsModel.snapshot={...window.termaRuntimeSettingsModel.snapshot,distribution:'fnos'};window.termaSettingsViews.render();
        if(!toggle().disabled||toggle().checked)throw new Error('fnOS exposed user keys after a standard runtime transition');

        const realClick = HTMLInputElement.prototype.click;
        let uploadPromise;
        let uploadOptions;
        HTMLInputElement.prototype.click = function() {
          if(this.type !== 'file') return realClick.call(this);
          Object.defineProperty(this,'files',{value:[new File(['test-only-key'],'acceptance_key')]});
          uploadPromise = this.onchange();
        };
        try {
          api = async (path, options = {}) => {
            if(String(path).startsWith('/api/managed-keys/import')) {uploadOptions = options; return {ok:true};}
            if(path === '/api/managed-keys') return {items:[fixture]};
            return previous.api(path,options);
          };
          click('import');
          await uploadPromise;
          if(uploadOptions?.headers?.has("content-type") || !(uploadOptions?.body instanceof FormData) || !uploadOptions.body.get('key')) throw new Error('Private-key upload is missing multipart handling');
          api = async () => {throw new Error('Fixture upload error');};
          click('import');
          await uploadPromise;
          if(!document.getElementById('toast').textContent.includes('Fixture upload error')) throw new Error('Upload error was not shown');
        } finally {HTMLInputElement.prototype.click = realClick;}
        return result;
      } finally {
        closeModal(); api = previous.api; requestPort.fetch = previous.requestFetch; securitySettings = previous.securitySettings; window.termaRuntimeSettingsModel.snapshot = previous.runtimeSettings;connections=previous.connections;
        document.documentElement.dataset.theme = previous.theme;
        await setTermaLanguage(previous.language || 'zh-CN',{emit:false});
        window.termaSettingsViews.render();
      }
    })()`));
    await execute(`void (window.__restoreManagedKeysAppearance = (() => {
      const requestPort = window.termaWorkspaceRequestPort;
      const original = {fetch:requestPort.fetch, language:document.documentElement.lang, theme:document.documentElement.dataset.theme};
      window.__managedKeyVisual = {
        name:'acceptance_key', path:'/fixture/ssh/acceptance_key', scope:'project',
        type:'Ed25519', bits:256, comment:'Acceptance key', has_passphrase:true, fingerprint:'SHA256:FIXTURE'
      };
      requestPort.fetch = (pathname, options) => {
        if (pathname === '/api/managed-keys') return Promise.resolve(Response.json({items:[window.__managedKeyVisual]}));
        if (pathname === '/api/managed-keys/properties') return Promise.resolve(Response.json(window.__managedKeyVisual));
        return original.fetch(pathname, options);
      };
      return async () => {
        closeModal();
        requestPort.fetch = original.fetch;
        document.documentElement.dataset.theme = original.theme;
        await setTermaLanguage(original.language || 'zh-CN', {emit:false});
        delete window.__managedKeyVisual;
        delete window.__restoreManagedKeysAppearance;
      };
    })())`);
    try {
      for (const language of ['zh-CN', 'en-US']) {
        for (const theme of ['light', 'dark']) {
          await execute(`(async () => {
            await setTermaLanguage(${JSON.stringify(language)}, {emit:false});
            document.documentElement.dataset.theme = ${JSON.stringify(theme)};
            window.termaSettingsNavigation.show('settings-key-management');
            for(let i=0;i<60&&!document.querySelector('#managedKeysList [data-managed-action="properties"]');i++)await new Promise(resolve=>setTimeout(resolve,25));
            document.querySelector('#managedKeysList [data-managed-action="properties"]').click();
            for(let i=0;i<60&&!document.querySelector('#managedKeyComment');i++)await new Promise(resolve=>setTimeout(resolve,25));
            if(!document.querySelector('#managedKeyComment'))throw new Error('Properties screenshot fixture did not open');
            dismissToast();
            for (let attempt = 0; attempt < 20 && document.querySelector('#toast .toast'); attempt++) {
              await new Promise(resolve=>setTimeout(resolve,40));
            }
            if (document.querySelector('#toast .toast')) throw new Error('A fixture notification still covers key properties');
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          })()`);
          const image = await window.webContents.capturePage();
          fs.writeFileSync(path.join(directory, `${language}-${theme}-${width}-properties.png`), image.toPNG());
          await execute('closeModal()');
        }
      }
    } finally {
      await execute('window.__restoreManagedKeysAppearance()');
    }
  }
  console.log('[ui-smoke] managed keys', JSON.stringify(results.flat()));
  window.setSize(1200,800);
  return results.flat();
}

module.exports = {runManagedKeysUiScenario};
