async function runManagedKeysUiScenario(window) {
  const results = [];
  for (const width of [1200, 392]) {
    window.setSize(width, 850);
    results.push(await window.webContents.executeJavaScript(`(async () => {
      const previous = {api, securitySettings, runtimeSettings, language:document.documentElement.lang, theme:document.documentElement.dataset.theme};
      const result = [];
      const fixture = {name:'acceptance_key',path:'/fixture/ssh/acceptance_key',scope:'project',type:'Ed25519',bits:256,comment:'Acceptance key',has_passphrase:false};
      try {
        const restoreCheck = {unresolved_identities:[{connection_id:1},{connection_id:2}]};
        if (databaseRestoreUnboundCount(restoreCheck,[{connection_id:1,auth_type:'key',identity_path:'/fixture/key'}]) !== 1
          || databaseRestoreUnboundCount(restoreCheck,[{connection_id:1,auth_type:'key',identity_path:'/fixture/key'},{connection_id:2,auth_type:'password'}]) !== 0
          || databaseRestoreUnboundCount(restoreCheck,[]) !== 2) throw new Error('Database restore warning ignores staged credentials');
        runtimeSettings = {...runtimeSettings,distribution:'fnos'};
        securitySettings = {...securitySettings,manage_user_ssh_keys_enabled:false};
        setWorkspace('Settings','', 'settings','settings',true,true,{kind:'settings'});
        api = async (path, options = {}) => {
          if (path === '/api/runtime-settings') return {...previous.runtimeSettings,distribution:'fnos'};
          if (path === '/api/security') return {...previous.securitySettings,manage_user_ssh_keys_enabled:false};
          if (path === '/api/managed-keys') return {items:[fixture]};
          if (path === '/api/managed-keys/properties') return options.method === 'PUT' ? {ok:true,item:fixture} : fixture;
          return previous.api(path, options);
        };
        for (const language of ['zh-CN','en-US']) {
          await setTermaLanguage(language,{emit:false});
          runtimeSettings = {...runtimeSettings,distribution:'fnos'};
          for (const theme of ['light','dark']) {
            document.documentElement.dataset.theme = theme;
            renderSettings();
            const storageHtml = storageSettingsPanelHtml();
            if (/<(?:input|button|select)\\b/i.test(storageHtml)) throw new Error('fnOS storage settings expose locked actions');
            showSettingsSection('settings-key-management');
            await loadManagedKeys();
            await new Promise(resolve=>requestAnimationFrame(resolve));
            const panel = document.getElementById('sshKeyManagementPanel');
            const row = panel.querySelector('.ssh-managed-key-row');
            const rectangle = row.getBoundingClientRect();
            if (!document.getElementById('manageUserSshKeysEnabled').disabled) throw new Error('fnOS user scope toggle is enabled');
            if (rectangle.width < 1 || rectangle.left < -1 || rectangle.right > innerWidth + 1) throw new Error('Managed key row overflows: '+JSON.stringify({viewport:innerWidth,left:rectangle.left,right:rectangle.right,width:rectangle.width}));
            if (language === 'en-US' && /[\\u3400-\\u9fff]/.test(panel.textContent)) throw new Error('Chinese text remains in English key management');
            await managedKeyAction('properties',{dataset:{path:fixture.path,scope:'project'}});
            if (!document.getElementById('managedKeyComment')) throw new Error('Key properties did not open');
            const modal = document.querySelector('.ssh-key-properties-modal');
            if (language === 'en-US' && /[\\u3400-\\u9fff]/.test(modal.textContent)) throw new Error('Chinese text remains in English key properties');
            closeModal();
            result.push({language,theme,width:innerWidth});
          }
        }
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
          await importManagedKeyUi();
          await uploadPromise;
          if(!uploadOptions?.rawBody || !(uploadOptions.body instanceof FormData) || !uploadOptions.body.get('key')) throw new Error('Private-key upload is missing multipart handling');
          api = async () => {throw new Error('Fixture upload error');};
          await importManagedKeyUi();
          await uploadPromise;
          if(!document.getElementById('toast').textContent.includes('Fixture upload error')) throw new Error('Upload error was not shown');
        } finally {HTMLInputElement.prototype.click = realClick;}
        return result;
      } finally {
        closeModal(); api = previous.api; securitySettings = previous.securitySettings; runtimeSettings = previous.runtimeSettings;
        document.documentElement.dataset.theme = previous.theme;
        await setTermaLanguage(previous.language || 'zh-CN',{emit:false});
        renderSettings();
      }
    })()`));
  }
  console.log('[ui-smoke] managed keys', JSON.stringify(results.flat()));
  window.setSize(1200,800);
  return results.flat();
}

module.exports = {runManagedKeysUiScenario};
