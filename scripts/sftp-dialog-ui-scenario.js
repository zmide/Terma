const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function runSftpDialogUiScenario(browser, options = {}) {
  const directory = path.join(process.env.TERMA_UI_DIAGNOSTICS_DIR || path.join(process.cwd(), 'data'), 'sftp-dialog-visual');
  fs.mkdirSync(directory, {recursive:true});
  const viewport = options.viewport || 'desktop';
  browser.webContents.debugger.attach('1.3');
  await browser.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
  const checks = [], states = [];
  const execute = async source => {
    try { return await browser.webContents.executeJavaScript(`(async()=>{${source}})()`); }
    catch (error) { console.error('[sftp-dialog]', source, error); throw error; }
  };
  const wait = () => new Promise(resolve => setTimeout(resolve, 80));
  const check = async (name, source) => { const result = await execute(`return (${source});`); checks.push({name,result}); assert.equal(result,true,name); };
  const shot = async name => { browser.webContents.invalidate(); await wait(); fs.writeFileSync(path.join(directory, `${viewport}-${name}.png`), (await browser.webContents.capturePage()).toPNG()); states.push(`${viewport}-${name}`); };
  const click = async selector => { await execute(`document.querySelector(${JSON.stringify(selector)})?.click();`); await wait(); };
  const pointer = async selector => {
    const point = await execute(`const node=document.querySelector(${JSON.stringify(selector)});node.scrollIntoView({block:'nearest'});const r=node.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;if(!node.contains(document.elementFromPoint(x,y)))throw Error('Obscured control '+${JSON.stringify(selector)});return {x:Math.round(x),y:Math.round(y)};`);
    for (const type of ['mouseMove','mouseDown','mouseUp']) browser.webContents.sendInputEvent({type,...point,button:'left',clickCount:1}); await wait();
  };
  const field = async (selector, value) => execute(`const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw new Error('Missing ${selector}');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));`);
  const inspect = async name => {
    await check(`${name} scoped Vue controls`, `(()=>{const root=document.querySelector('[data-sftp-dialog]');return !!root&&root.classList.contains('terma-vue-root')&&root.querySelectorAll('button').length>0&&[...root.querySelectorAll('button:not(.dialog-window-resize)')].every(button=>button.hasAttribute('data-terma-button')&&!button.hasAttribute('onclick'))})()`);
    await check(`${name} dialog fits`, `(()=>{const card=document.querySelector('.sftp-vue-dialog'),r=card?.getBoundingClientRect();return !!r&&r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1&&card.scrollWidth<=card.clientWidth+2})()`);
    await check(`${name} translated DOM and attributes`, `(()=>{if(document.documentElement.lang!=='en-US')return true;const root=document.querySelector('[data-sftp-dialog]'),text=root.textContent+[...root.querySelectorAll('*')].flatMap(node=>['title','aria-label','placeholder'].map(key=>node.getAttribute(key)||'')).join(' ');return !/[\u3400-\u9fff]/.test(text)&&!text.includes('sftp:')&&!text.includes('common:')})()`);
    await check(`${name} safe text`, `!document.querySelector('[data-sftp-dialog] img, [data-sftp-dialog] script')`);
    await check(`${name} theme text contrast`, `(()=>{const root=document.querySelector('[data-sftp-dialog]'),card=root.querySelector('.modal-card'),ctx=document.createElement('canvas').getContext('2d',{willReadFrequently:true}),lum=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0)},background=lum(getComputedStyle(card).backgroundColor);return [...root.querySelectorAll('label,small,.sftp-modal-head span,.sftp-permission-note')].filter(node=>node.checkVisibility()).every(node=>{const foreground=lum(getComputedStyle(node).color),ratio=(Math.max(background,foreground)+.05)/(Math.min(background,foreground)+.05);if(ratio<4.5)console.error('SFTP contrast',node.textContent,getComputedStyle(node).color,getComputedStyle(card).backgroundColor,ratio);return ratio>=4.5})})()`);
    await shot(name);
  };
  await execute(`
    await window.termaI18nReady;closeModal();dismissToast();await new Promise(resolve=>setTimeout(resolve,260));
    const key='sftp-dialog-fixture-${viewport}',id=99991,tab={key,id,kind:'sftp',title:'Dialog fixture'};
    const f={key,id,tab,requests:[],notices:[],refreshes:0,created:[],trashMode:'normal',permissionMode:'normal',listMode:'normal',original:{api,notify,load:window.termaSftpDirectoryWorkspace.loader.load,queueSftpDirectoryRefresh: window.termaSftpTransferLifecycle.directories.enqueue,flushPendingSftpDirectoryRefresh: window.termaSftpTransferLifecycle.directories.flush,refreshSftpJobs:window.termaSftpTaskWorkspace.runtime.refresh,trackSftpMutationJob:window.termaSftpTransferLifecycle.completion.track,runtimeSettings: window.termaRuntimeSettingsModel.snapshot}};
    window.__sftpDialogFixture=f;tabs.push(tab);
    f.runtime={tabKey:key,state:{connectionId:id,path:'/data',entries:[{name:'folder',type:'dir',mode:'755',owner:'0',group:'0'},{name:'new.txt',type:'file',mode:'644',owner:'0',group:'0'}]}};sftpTabRuntimes.set(key,f.runtime);
    window.termaRuntimeSettingsModel.snapshot={...window.termaRuntimeSettingsModel.snapshot,saved:{...window.termaRuntimeSettingsModel.snapshot.saved,sftp_recycle_bin_enabled:true}};
    window.termaSftpDirectoryWorkspace.loader.load=async()=>{f.refreshes++;return true;};window.termaSftpTransferLifecycle.directories.enqueue=()=>{};window.termaSftpTransferLifecycle.directories.flush=()=>{};window.termaSftpTaskWorkspace.runtime.refresh=()=>{};window.termaSftpTransferLifecycle.completion.track=()=>{};notify=(message,type)=>f.notices.push({message,type});
    api=async(url,options={})=>{
      const value=String(url);if(!value.startsWith('/api/connections/'+id+'/sftp'))throw new Error('Unexpected fixture request '+value);
      const body=options.body?JSON.parse(options.body):null;f.requests.push({url:value,method:options.method||'GET',body});
      if(value.endsWith('/rename')){if(body.to==='/data/existing.txt')throw Object.assign(new Error(tr('errors:backend.sftp_rename_exists')),{publicCode:'sftp_rename_exists'});return {ok:true};}
      if(value.endsWith('/principals')){if(f.principalMode==='error')throw Error('account unavailable');if(f.principalMode==='pending')return new Promise(resolve=>f.finishPrincipals=resolve);return {available:true,users:[{id:'0',name:'root'},{id:'1001',name:'serviceuser'}],groups:[{id:'0',name:'wheel'},{id:'20',name:'staff'}]};}
      if(value.endsWith('/permissions')){if(f.permissionMode==='error')throw new Error('Permission denied <img src=x>');if(f.permissionMode==='pending')await new Promise(resolve=>f.finishPermission=resolve);return {};}
      if(value.includes('/trash?')){if(f.trashMode==='error')throw new Error('Recycle error <img src=x>');if(f.trashMode==='pending')await new Promise(resolve=>f.finishTrash=resolve);const page=Number(new URL('http://fixture'+value).searchParams.get('page'));return {enabled:true,page,total:f.trashMode==='empty'?0:3,total_pages:f.trashMode==='empty'?1:2,items:f.trashMode==='empty'?[]:[{id:'item-'+page,name:'notes <img src=x>.txt',original_path:'/data/notes.txt',type:'file',storage:page===2?'tunneldesk':'terma',deleted_at:'2026-10-21T01:00:00Z'}]};}
      if(value.endsWith('/trash/clear')){f.trashMode='empty';return {};}
      if(value.includes('/trash/'))return {original_path:'/data/restored.txt'};
      if(value.endsWith('/mkdir')){f.created.push(body.path);return {};}
      if(value.includes('/sftp?')){if(f.listMode==='error')throw new Error('Directory error <img src=x>');if(f.listMode==='pending')await new Promise(resolve=>f.finishList=resolve);const remote=new URL('http://fixture'+value).searchParams.get('path');return {path:remote==='.'?'/home/test':remote,entries:f.listMode==='empty'?[]:[{name:'child',type:'dir'},{name:'safe <img src=x>',type:'dir'},...f.created.filter(item=>item.startsWith(remote+'/')).map(item=>({name:item.split('/').pop(),type:'dir'}))]};}
      return {id:'fixture-job'};
    };
  `);
  try {
    for (const theme of ['light','dark']) for (const language of ['zh-CN','en-US']) {
      const name=`${language}-${theme}`;
      await execute(`applyTheme('${theme}');await setTermaLanguage('${language}',{render:false});const f=window.__sftpDialogFixture;f.requests=[];f.trashMode='normal';f.permissionMode='normal';f.listMode='normal';f.created=[];f.runtime.state.path='/data';sftpTabRuntimes.set(f.key,f.runtime);window.termaRuntimeSettingsModel.snapshot.saved.sftp_recycle_bin_enabled=true;`);
      await execute(`const f=window.__sftpDialogFixture;f.pending=window.termaSftpFileActions.operations.rename(f.key, f.id, '/data/original.txt', 'original.txt');`);
      await field('#modalInputValue','existing.txt'); await click('#modalConfirmBtn');
      await check(`${name} rename conflict retains draft and marks the input`, `document.querySelector('#modalInputValue')?.value==='existing.txt'&&document.querySelector('#modalInputValue').getAttribute('aria-invalid')==='true'&&document.querySelector('#sftpDialogError')?.textContent===tr('errors:backend.sftp_rename_exists')`);
      await inspect(`${name}-rename-conflict`);
      await execute(`const input=document.querySelector('#modalInputValue');input.setSelectionRange(1,4);await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}',{render:false});`);
      await check(`${name} rename conflict translates live and preserves selection`, `document.querySelector('#sftpDialogError').textContent===tr('errors:backend.sftp_rename_exists')&&document.querySelector('#modalInputValue').selectionStart===1&&document.querySelector('#modalInputValue').selectionEnd===4`);
      await execute(`await setTermaLanguage('${language}',{render:false});`);
      await field('#modalInputValue','renamed.txt'); await click('#modalConfirmBtn');
      await execute(`await window.__sftpDialogFixture.pending;`);
      await check(`${name} rename retry uses the new name and closes after success`, `window.termaSftpDialogs.active()===null&&window.__sftpDialogFixture.requests.at(-1).body.to==='/data/renamed.txt'`);
      await execute(`window.__sftpDialogFixture.requests=[];`);
      for (const [action,title,label] of [['mkdir','sftp:operations.new_directory','sftp:operations.directory_name'],['createFile','sftp:operations.new_file','sftp:operations.file_name']]) {
        await execute(`const f=window.__sftpDialogFixture;f.pending=window.termaSftpFileActions.operations[${JSON.stringify(action)}](f.key);`);
        await field('#modalInputValue','draft-name');
        await execute(`const input=document.querySelector('#modalInputValue');input.focus();input.setSelectionRange(2,5);await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}');`);
        await check(`${name} ${action} live language retains draft and caret`, `(()=>{const input=document.querySelector('#modalInputValue');return input.value==='draft-name'&&document.activeElement===input&&input.selectionStart===2&&input.selectionEnd===5&&document.querySelector('h2#sftpDialogTitle').textContent===tr('${title}')&&document.querySelector('label[for="modalInputValue"]').textContent===tr('${label}')})()`);
        await execute(`await setTermaLanguage('${language}');`);await inspect(`${name}-${action}`);
        await execute(`window.__sftpDialogFixture.runtime.state.path='/changed';`);
        await click('#modalConfirmBtn');await execute(`await window.__sftpDialogFixture.pending;`);
        await check(`${name} ${action} rejects a stale directory`, `window.__sftpDialogFixture.requests.length===0`);
        await execute(`window.__sftpDialogFixture.runtime.state.path='/data';`);
        await execute(`const f=window.__sftpDialogFixture;f.pending=window.termaSftpFileActions.operations[${JSON.stringify(action)}](f.key);`);
        await field('#modalInputValue','draft-name');await click('#modalConfirmBtn');await execute(`await window.__sftpDialogFixture.pending;`);
        await check(`${name} ${action} uses the confirmed directory`, `window.__sftpDialogFixture.requests.at(-1).body.path==='/data/draft-name'`);
        await execute(`window.__sftpDialogFixture.requests=[];`);
      }
      await execute(`const f=window.__sftpDialogFixture;f.pending=window.termaSftpFileActions.operations.rename(f.key, f.id, '/data/old.txt', 'old.txt');`);
      await field('#modalInputValue','../escape');await click('#modalConfirmBtn');
      await check(`${name} rename rejects traversal`, `window.termaSftpDialogs.active()==='input'&&!window.__sftpDialogFixture.requests.some(item=>item.url.endsWith('/rename'))`);
      await field('#modalInputValue','new.txt');await inspect(`${name}-rename`);await click('#modalConfirmBtn');await execute(`await window.__sftpDialogFixture.pending;`);
      for (const enabled of [true,false]) {
        await execute(`const f=window.__sftpDialogFixture;window.termaRuntimeSettingsModel.snapshot.saved.sftp_recycle_bin_enabled=${enabled};f.pending=window.termaSftpFileActions.operations.remove(f.key, f.id, ['/data/new.txt']);`);await wait();
        await inspect(`${name}-delete-${enabled?'recycle':'permanent'}`);
        await click('#sftpConfirmationCancel');await execute(`await window.__sftpDialogFixture.pending;`);
        await check(`${name} deletion cancellation sends no request`, `!window.__sftpDialogFixture.requests.some(item=>item.url.endsWith('/delete'))`);
      }
      await execute(`const f=window.__sftpDialogFixture;window.termaSftpFileActions.operations.permissions(f.key, ['/data/folder']);`);
      await check(`${name} directory permissions offer recursion`, `!!document.querySelector('#sftpPermissionRecursive')`);
      await check(`${name} recursive checkbox has transparent row and retains its square`, `(()=>{const input=document.querySelector('#sftpPermissionRecursive');return getComputedStyle(input.closest('label')).backgroundColor==='rgba(0, 0, 0, 0)'&&input.getBoundingClientRect().width>=16;})()`);
      await wait();
      await check(`${name} resolved principals display remote names with IDs`, `document.querySelector('#sftpPermissionOwner').value==='root (UID 0)'&&document.querySelector('#sftpPermissionGroup').value==='wheel (GID 0)'`);
      await pointer('#sftpPermissionOwner + button');await inspect(`${name}-owner-options`);
      await execute(`await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}');`);
      await check(`${name} open account choices translate immediately`, `document.querySelector('#sftpPermissionOwnerOptions')?.textContent.includes(tr('sftp:permissions_editor.blank_unchanged'))&&document.querySelector('#sftpPermissionOwner').value==='root (UID 0)'`);
      await inspect(`${name}-owner-options-live`);await execute(`await setTermaLanguage('${language}');`);
      await pointer('#sftpPermissionOwnerOptions [data-principal-id="1001"]');
      await pointer('#sftpPermissionGroup + button');await inspect(`${name}-group-options`);
      await pointer('#sftpPermissionGroupOptions [data-principal-id="20"]');
      await check(`${name} dropdown selects actual remote identities`, `document.querySelector('#sftpPermissionOwner').value==='serviceuser (UID 1001)'&&document.querySelector('#sftpPermissionGroup').value==='staff (GID 20)'`);
      await click('#sftpPermissionApply');
      await check(`${name} dropdown submits numeric identities`, `(()=>{const body=window.__sftpDialogFixture.requests.at(-1).body;return body.owner==='1001'&&body.group==='20'})()`);
      await execute(`const f=window.__sftpDialogFixture;f.requests=[];window.termaSftpFileActions.operations.permissions(f.key, ['/data/folder']);`);await wait();
      await click('#sftpPermissionApply');
      await check(`${name} unchanged names do not change ownership`, `(()=>{const body=window.__sftpDialogFixture.requests.at(-1).body;return body.owner===''&&body.group===''})()`);
      await execute(`const f=window.__sftpDialogFixture;f.requests=[];window.termaSftpFileActions.operations.permissions(f.key, ['/data/folder']);`);await wait();
      await inspect(`${name}-permissions-identity`);
      await field('#sftpPermissionMode','640');await field('#sftpPermissionOwner','service');
      await execute(`const f=window.__sftpDialogFixture,card=document.querySelector('.sftp-vue-dialog');card.scrollTop=card.scrollHeight;f.permissionScroll=card.scrollTop;const field=document.querySelector('#sftpPermissionOwner');field.focus({preventScroll:true});field.setSelectionRange(1,4);await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}');`);
      await check(`${name} permissions keep draft and translated labels`, `document.querySelector('#sftpPermissionMode').value==='640'&&document.querySelector('#sftpPermissionOwner').value==='service'&&document.activeElement.id==='sftpPermissionOwner'&&document.activeElement.selectionStart===1&&document.querySelector('#sftpDialogTitle').textContent===tr('sftp:menu.permissions')`);
      await execute(`await setTermaLanguage('${language}');`);
      await check(`${name} permissions retain scroll`, `Math.abs(document.querySelector('.sftp-vue-dialog').scrollTop-window.__sftpDialogFixture.permissionScroll)<=1`);
      await click('[data-permission="ownerExecute"]');
      await check(`${name} checkbox updates octal mode`, `document.querySelector('#sftpPermissionMode').value==='740'`);
      await inspect(`${name}-permissions`);
      await check(`${name} permission options stay within their groups`, `(()=>{const groups=[...document.querySelectorAll('.sftp-permission-group')];return groups.every(group=>{const bounds=group.getBoundingClientRect(),labels=[...group.querySelectorAll('label')];return labels.every((label,index)=>{const r=label.getBoundingClientRect(),text=label.querySelector('span').getBoundingClientRect();return r.left>=bounds.left&&text.right<=bounds.right&&(!index||r.top>=labels[index-1].getBoundingClientRect().bottom-1)})})})()`);
      await execute(`document.querySelector('#sftpPermissionCancel').scrollIntoView({block:'nearest'});`);
      const hover=await execute(`const r=document.querySelector('#sftpPermissionCancel').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};`);
      browser.webContents.sendInputEvent({type:'mouseMove',...hover});await wait();
      await check(`${name} pointer hover has no halo or movement`, `(()=>{const button=document.querySelector('#sftpPermissionCancel'),style=getComputedStyle(button);return button.matches(':hover')&&style.boxShadow==='none'&&style.transform==='none'})()`);
      await shot(`${name}-button-hover`);
      browser.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...hover});await wait();
      browser.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...hover});await wait();
      await execute(`window.termaSftpFileActions.operations.permissions(window.__sftpDialogFixture.key, ['/data/folder']);`);
      await execute(`document.querySelector('#sftpPermissionCancel').focus();`);
      for(const type of ['keyDown','keyUp'])browser.webContents.sendInputEvent({type,keyCode:'Tab'});await wait();
      await check(`${name} keyboard focus remains visible`, `document.activeElement.id==='sftpPermissionApply'&&document.activeElement.matches(':focus-visible')&&getComputedStyle(document.activeElement).outlineStyle!=='none'`);
      await shot(`${name}-button-keyboard`);
      await field('#sftpPermissionMode','740');await field('#sftpPermissionOwner','service');
      await click('#sftpPermissionRecursive');
      await execute(`window.__sftpDialogFixture.permissionMode='pending';`);await click('#sftpPermissionApply');await inspect(`${name}-permissions-busy`);
      await browser.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
      await check(`${name} busy mutation remains visible`, `window.termaSftpDialogs.active()==='permissions'&&document.querySelector('#sftpPermissionApply').disabled`);
      await execute(`window.__sftpDialogFixture.finishPermission();`);await wait();
      await check(`${name} permissions scope and payload`, `(()=>{const f=window.__sftpDialogFixture,r=f.requests.find(item=>item.url.endsWith('/permissions'));return window.termaSftpDialogs.active()===null&&r.body.paths[0]==='/data/folder'&&r.body.mode==='740'&&r.body.owner==='service'&&r.body.group===''&&r.body.recursive===true})()`);
      await execute(`const f=window.__sftpDialogFixture;f.permissionMode='error';window.termaSftpFileActions.operations.permissions(f.key, ['/data/folder']);`);await click('#sftpPermissionApply');await inspect(`${name}-permissions-error`);await click('#sftpPermissionCancel');
      await execute(`const f=window.__sftpDialogFixture;f.principalMode='error';window.termaSftpFileActions.operations.permissions(f.key, ['/data/folder']);`);await wait();
      await click('#sftpPermissionOwner + button');await inspect(`${name}-accounts-unavailable`);
      await check(`${name} unresolved identity remains numeric and editable`, `document.querySelector('#sftpPermissionOwner').value==='0'&&document.querySelector('.sftp-principal-empty').textContent===tr('sftp:permissions_editor.accounts_unavailable')`);
      await execute(`document.querySelector('#sftpPermissionOwner').focus();`);for(const type of ['keyDown','keyUp'])browser.webContents.sendInputEvent({type,keyCode:'Escape'});await wait();
      await check(`${name} Escape closes account choices before the dialog`, `window.termaSftpDialogs.active()==='permissions'&&!document.querySelector('[role=listbox]')`);await click('#sftpPermissionCancel');
      await execute(`const f=window.__sftpDialogFixture;f.principalMode='pending';window.termaSftpFileActions.operations.permissions(f.key, ['/data/folder']);`);await wait();await click('#sftpPermissionCancel');
      await execute(`const f=window.__sftpDialogFixture;f.principalMode='normal';window.termaSftpFileActions.operations.permissions(f.key, ['/data/folder']);`);await wait();
      await execute(`window.__sftpDialogFixture.finishPrincipals({users:[{id:'0',name:'STALE'}],groups:[]});`);await wait();
      await check(`${name} closed dialog cannot overwrite a new account list`, `document.querySelector('#sftpPermissionOwner').value==='root (UID 0)'`);await click('#sftpPermissionCancel');
      await execute(`const f=window.__sftpDialogFixture;f.principalMode='pending';window.termaSftpFileActions.operations.permissions(f.key, ['/data/folder']);`);await wait();
      await field('#sftpPermissionOwner','remote-admin');
      await execute(`const input=document.querySelector('#sftpPermissionOwner');input.focus();input.setSelectionRange(1,4);window.__sftpDialogFixture.finishPrincipals({users:[{id:'1010',name:'remote-admin'}],groups:[]});`);await wait();
      await check(`${name} late account lookup preserves typed draft and caret`, `document.querySelector('#sftpPermissionOwner').value==='remote-admin'&&document.activeElement.id==='sftpPermissionOwner'&&document.activeElement.selectionStart===1&&document.activeElement.selectionEnd===4`);
      await inspect(`${name}-accounts-draft`);await click('#sftpPermissionCancel');await execute(`window.__sftpDialogFixture.principalMode='normal';`);
      for (const mode of ['compress','download']) {
        await execute(`const f=window.__sftpDialogFixture;f.pending=window.termaSftpEntryActions.archive({mode:'${mode}',tabKey:f.key,connectionId:f.id,filename:'draft.tar.gz'});`);
        await field('#sftpArchiveFilename','');await click('#sftpArchiveConfirm');await check(`${name} ${mode} validates filename`, `!!document.querySelector('#sftpDialogError')`);
        await field('#sftpArchiveFilename','my-archive.tar.gz');
        await execute(`const input=document.querySelector('#sftpArchiveFilename');input.focus();input.setSelectionRange(3,8);await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}');`);
        await check(`${name} ${mode} live locale preserves draft and caret`, `document.querySelector('#sftpArchiveFilename').value==='my-archive.tar.gz'&&document.activeElement.id==='sftpArchiveFilename'&&document.activeElement.selectionStart===3&&document.activeElement.selectionEnd===8&&document.querySelector('label[for="sftpArchiveFilename"]').textContent===tr('sftp:dialogs.archive_name')`);
        await execute(`await setTermaLanguage('${language}');`);await inspect(`${name}-${mode}`);await click('#sftpArchiveConfirm');
        await check(`${name} ${mode} preserves result`, `(await window.__sftpDialogFixture.pending).filename==='my-archive.tar.gz'`);
      }
      await execute(`const f=window.__sftpDialogFixture;f.pending=window.termaSftpEntryActions.archive({mode:'extract',tabKey:f.key,connectionId:f.id,path:'/data/archive.zip',target:'.'});`);
      await inspect(`${name}-extract`);await click('#sftpArchiveBrowse');
      await check(`${name} directory chooser has readable roots and controls`, `document.querySelector('#sftpArchiveBrowserPath').textContent==='/home/test'&&!!document.querySelector('#sftpArchiveBrowserRoot')&&!!document.querySelector('#sftpArchiveBrowserParent')&&!!document.querySelector('#sftpArchiveBrowserRefresh')&&!!document.querySelector('#sftpArchiveBrowserNew')`);
      await click('.sftp-dialog-tree-row .icon-button');await inspect(`${name}-directory-tree`);
      await execute(`const input=document.querySelector('#sftpArchiveTarget');input.focus({preventScroll:true});input.setSelectionRange(0,1);await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}');`);
      await check(`${name} expanded directory chooser live locale keeps state`, `document.activeElement.id==='sftpArchiveTarget'&&document.activeElement.selectionEnd===1&&document.querySelectorAll('.sftp-dialog-tree-row').length===4&&document.querySelector('#sftpArchiveBrowserPath').textContent==='/home/test'&&document.querySelector('label[for="sftpArchiveTarget"]').textContent===tr('sftp:archive.target_directory')`);
      await execute(`await setTermaLanguage('${language}');`);
      await click('#sftpArchiveBrowserNew');await field('#sftpArchiveNewName','created');await click('#sftpArchiveNewConfirm');
      await check(`${name} directory creation uses current remote path`, `window.__sftpDialogFixture.created.includes('/home/test/created')`);
      await click('#sftpArchiveBrowserSelect');await click('#sftpArchiveNamedFolder');
      await check(`${name} named archive folder joins chosen target`, `document.querySelector('#sftpArchiveTarget').value==='/home/test/archive'`);
      await execute(`window.__sftpDialogFixture.listMode='error';`);await click('#sftpArchiveBrowse');await inspect(`${name}-directory-error`);
      await execute(`window.__sftpDialogFixture.listMode='empty';`);await click('#sftpArchiveBrowserRefresh');await inspect(`${name}-directory-empty`);
      await click('#sftpArchiveConfirm');await check(`${name} extraction result`, `(await window.__sftpDialogFixture.pending).target==='/home/test/archive'`);
      await execute(`const f=window.__sftpDialogFixture;f.trashMode='pending';window.termaSftpRecycle.open(f.key);`);await inspect(`${name}-recycle-loading`);
      await click('#sftpRecycleClose');await execute(`window.__sftpDialogFixture.finishTrash();`);await wait();
      await check(`${name} closing a loading dialog ignores late result`, `window.termaSftpDialogs.active()===null&&document.querySelector('#modal').hidden`);
      await execute(`const f=window.__sftpDialogFixture;f.trashMode='normal';window.termaSftpRecycle.open(f.key);`);await wait();await inspect(`${name}-recycle`);
      await check(`${name} recycle pagination stays on one row`, `(()=>{const pager=document.querySelector('.sftp-recycle-pager'),children=[...pager.children],positions=children.map(node=>node.getBoundingClientRect());return positions.every(rect=>rect.left>=pager.getBoundingClientRect().left-1&&rect.right<=pager.getBoundingClientRect().right+1)&&positions.every(rect=>Math.abs((rect.top+rect.bottom)/2-(positions[0].top+positions[0].bottom)/2)<2)&&children.every(node=>getComputedStyle(node).whiteSpace==='nowrap')})()`);
      await click('#sftpRecycleNext');await check(`${name} recycle pagination`, `window.__sftpDialogFixture.requests.at(-1).url.includes('page=2')`);
      await execute(`const f=window.__sftpDialogFixture;f.localeRequests=f.requests.length;document.querySelector('#sftpRecycleClose').focus();await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}');`);
      await check(`${name} recycle locale preserves page and focus without reload`, `window.__sftpDialogFixture.requests.length===window.__sftpDialogFixture.localeRequests&&document.activeElement.id==='sftpRecycleClose'&&document.querySelector('#sftpRecycleNext').disabled&&document.querySelector('#sftpDialogTitle').textContent===tr('sftp:recycle_bin.title')`);
      await execute(`await setTermaLanguage('${language}');`);
      await click('.sftp-recycle-item button');
      await check(`${name} recycle restore preserves legacy storage`, `window.__sftpDialogFixture.requests.some(item=>item.url.endsWith('/trash/restore')&&item.body.id==='item-2'&&item.body.storage==='tunneldesk')`);
      await click('.sftp-recycle-item button.danger');await inspect(`${name}-recycle-delete-confirm`);
      await execute(`await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}');`);
      await check(`${name} confirmation live translation`, `document.querySelector('#sftpConfirmationTitle').textContent===tr('sftp:recycle_bin.permanent_delete')`);
      await execute(`await setTermaLanguage('${language}');`);await click('#sftpConfirmationCancel');
      await check(`${name} recycle cancellation retains list`, `!!document.querySelector('#sftpRecycleList .sftp-recycle-item')&&!window.__sftpDialogFixture.requests.some(item=>item.url.endsWith('/trash/delete'))`);
      await click('.sftp-recycle-item button.danger');await click('#sftpConfirmationApply');
      await check(`${name} recycle permanent deletion`, `window.__sftpDialogFixture.requests.some(item=>item.url.endsWith('/trash/delete')&&item.body.id==='item-2')`);
      await click('#sftpRecycleClear');await inspect(`${name}-recycle-clear-confirm`);await click('#sftpConfirmationCancel');
      await check(`${name} clear cancellation is safe`, `!window.__sftpDialogFixture.requests.some(item=>item.url.endsWith('/trash/clear'))`);
      await click('#sftpRecycleClear');await click('#sftpConfirmationApply');await inspect(`${name}-recycle-empty`);await click('#sftpRecycleClose');
      await execute(`const f=window.__sftpDialogFixture;f.trashMode='error';window.termaSftpRecycle.open(f.key);`);await wait();await inspect(`${name}-recycle-error`);
      await check(`${name} failed recycle no longer announces loading`, `document.querySelector('#sftpRecycleList [role=alert]') && !document.querySelector('#modal').textContent.includes(tr('sftp:recycle_bin.loading_remote'))`);
      await execute(`window.__sftpDialogFixture.trashMode='normal';`);await click('#sftpRecycleList .ui-state button');await check(`${name} recycle retry`, `!!document.querySelector('#sftpRecycleList .sftp-recycle-item')`);await click('#sftpRecycleClose');
    }
    await execute(`const f=window.__sftpDialogFixture;f.runtime.state.path='/data';f.pending=window.termaSftpFileActions.compressEntry(f.key, f.id, '/data/source.txt');f.beforeStale=f.requests.length;f.runtime.state.path='/changed';`);
    await click('#sftpArchiveConfirm');await execute(`await window.__sftpDialogFixture.pending;`);
    await check('archive rejects confirmation after its directory changes', `window.__sftpDialogFixture.requests.length===window.__sftpDialogFixture.beforeStale`);
    await execute(`const f=window.__sftpDialogFixture;f.pending=window.termaSftpFileActions.operations.rename(f.key, f.id, '/data/old.txt', 'old.txt');f.beforeStale=f.requests.length;sftpTabRuntimes.set(f.key,{...f.runtime});`);
    await click('#modalConfirmBtn');await execute(`await window.__sftpDialogFixture.pending;`);
    await check('runtime replacement invalidates pending mutation', `window.__sftpDialogFixture.requests.length===window.__sftpDialogFixture.beforeStale&&window.termaSftpDialogs.active()===null`);
    await execute(`const f=window.__sftpDialogFixture;sftpTabRuntimes.set(f.key,f.runtime);f.pending=window.termaSftpDialogs.input({tr,titleKey:'sftp:menu.rename',labelKey:'sftp:dialogs.new_name',value:'draft'});f.choice=confirmModal('fixture','fixture');`);await wait();
    await check('dialog ownership hands over without duplicate cards', `(await window.__sftpDialogFixture.pending)===null&&document.querySelectorAll('#modal .modal-card').length===1&&window.termaSftpDialogs.active()===null`);
    await execute(`closeModal();await window.__sftpDialogFixture.choice;`);
  } finally {
    await execute(`const f=window.__sftpDialogFixture;window.termaSftpDialogs.release();sftpTabRuntimes.delete(f.key);tabs=tabs.filter(tab=>tab!==f.tab);({api,notify,load:window.termaSftpDirectoryWorkspace.loader.load,queueSftpDirectoryRefresh: window.termaSftpTransferLifecycle.directories.enqueue,flushPendingSftpDirectoryRefresh: window.termaSftpTransferLifecycle.directories.flush,refreshSftpJobs:window.termaSftpTaskWorkspace.runtime.refresh,trackSftpMutationJob:window.termaSftpTransferLifecycle.completion.track,runtimeSettings: window.termaRuntimeSettingsModel.snapshot}=f.original);delete window.__sftpDialogFixture;`);
    browser.webContents.debugger.detach();
  }
  const report={viewport,checks:checks.length,screenshots:states.length,states};
  fs.writeFileSync(path.join(directory,`${viewport}-report.json`),JSON.stringify(report,null,2));
  return report;
}
module.exports={runSftpDialogUiScenario};
