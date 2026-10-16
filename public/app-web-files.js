function webFilesTr(key,values={}) { const resource='sftp:web_files.'+key; return tr(resource,values); }
function webFilesRuntime(key) { const runtime = localFileRuntimes.get(String(key)); return runtime?.fileSource ? runtime : null; }
function webFilesSourceLabel(source) { return webFilesTr(source === 'browser' ? 'browser' : 'server'); }
function webFilesRootsLabel(source) {return webFilesTr(source==='browser'?'selected_root':runtimeSettings?.distribution==='fnos'?'authorized_roots':'device_roots');}

function showWebFilesSourceMenu(event) {
  const splitLabels={left:tr('navigation:auto.new_split_left'),right:tr('navigation:auto.new_split_right'),top:tr('navigation:auto.new_split_top'),bottom:tr('navigation:auto.new_split_bottom')};
  const placements = source => [
    {label:tr('navigation:auto.new_tab'),icon:'file-plus-2',run:()=>openWebFilesPlacement(source)},
    ...(!isMobileLayout() ? ['left','right','top','bottom'].map(zone => ({label:splitLabels[zone],icon:'panels-top-left',run:()=>openWebFilesPlacement(source,zone)})) : [])
  ];
  showActionMenu(event,[{label:webFilesSourceLabel('browser'),icon:'laptop',children:()=>placements('browser')},{label:webFilesSourceLabel('server'),icon:'server',children:()=>placements('server')}]);
}

async function openWebFilesPlacement(source,zone='') {
  const pane = workspaceFindPaneForTab(activeTabKey) || workspaceFindPane(focusedPaneId);
  const sourceKey = pane?.activeTabKey;
  const key = await openWebFiles('',true,'',source);
  if (key && zone && pane) {
    applyWorkspaceTabDrop({key},{paneId:pane.id,zone});
    if (sourceKey && pane.tabs.includes(sourceKey)) {pane.activeTabKey=sourceKey; renderTabs(); renderWorkspacePaneContent(pane.id);}
  }
  return key;
}

async function openWebFiles(requestedPath='',updateTab=true,existingKey='',source='') {
  const tab = existingKey ? workspaceTabByKey(existingKey) : null;
  source = source || tab?.fileSource || 'browser';
  const key = existingKey || 'web-files-'+Date.now()+'-'+(++localFileTabSerial);
  const runtime = localFilesRuntime(key);
  Object.assign(runtime,{fileSource:source,location:'directory'});
  if (source === 'browser' && !runtime.browserDirectory) runtime.browserDirectory = new BrowserFileDirectory();
  const view = $('view-local-files');
  const mounted = view.dataset.workspaceTabKey === key && view.querySelector('.web-files-shell')?.dataset.source===source;
  view.dataset.workspaceTabKey=key;
  if (!mounted) view.innerHTML = `<div class="local-files-shell web-files-shell" data-source="${escAttr(source)}" data-tab-key="${escAttr(key)}" data-local-files-tab-key="${escAttr(key)}" data-dragover-action="web-files-drag-over" data-drop-action="web-files-drop">
    <div class="local-files-top"><div class="web-files-header"><div class="web-files-origin"><span class="web-files-source-icon">${icon(source==='browser'?'laptop':'server')}</span><div><div class="web-files-source-line"><strong>${esc(webFilesSourceLabel(source))}</strong><span class="web-files-mode"></span></div><span class="muted web-files-hint"></span></div></div>
    <div class="local-files-toolbar"><div class="local-files-toolbar-actions">${source === 'browser' ? `<button type="button" data-action="web-files-choose" data-tab-key="${escAttr(key)}">${icon('folder-open')}<span>${esc(webFilesTr('choose_folder'))}</span></button><button type="button" data-action="web-files-choose-readonly" data-tab-key="${escAttr(key)}">${esc(webFilesTr('choose_readonly'))}</button>` : ''}${[
      ['refresh','refresh-cw',tr('common:auto.refresh')],
      ['mkdir','folder-plus',tr('common:auto.new_folder')],['create','file-plus-2',tr('common:auto.new_file')],['upload','upload',webFilesTr('upload_here')],['new','plus',tr('navigation:auto.new_local_files_tab')]
    ].map(([action,glyph,label])=>`<button class="icon-button" type="button" data-action="web-files-${action}" data-tab-key="${escAttr(key)}" title="${escAttr(label)}" aria-label="${escAttr(label)}">${icon(glyph)}</button>`).join('')}</div></div></div>
    <div class="web-files-navigation">${[['back','arrow-left',webFilesTr('back')],['forward','arrow-right',webFilesTr('forward')],['parent','corner-left-up',tr('sftp:auto.parent_directory')],['roots','hard-drive',webFilesRootsLabel(source)]].map(([action,glyph,label])=>`<button class="icon-button" type="button" data-action="web-files-${action}" data-tab-key="${escAttr(key)}" title="${escAttr(label)}" aria-label="${escAttr(label)}">${icon(glyph)}</button>`).join('')}
    <div class="web-files-address"><span aria-hidden="true">${icon('folder-open')}</span><button type="button" class="web-files-path" data-action="web-files-path" data-tab-key="${escAttr(key)}" data-i18n-skip></button><button type="button" class="icon-button" data-action="web-files-copy-path" data-tab-key="${escAttr(key)}" title="${escAttr(tr('sftp:menu.copy_path'))}" aria-label="${escAttr(tr('sftp:menu.copy_path'))}">${icon('copy')}</button></div>
    <div class="web-files-search"><span aria-hidden="true">${icon('search')}</span><input data-input-action="web-files-search" data-tab-key="${escAttr(key)}" placeholder="${escAttr(tr('sftp:auto.search_current'))}" aria-label="${escAttr(tr('sftp:auto.search_current'))}"></div></div></div>
    <div class="local-files-selection web-files-selection" hidden><span></span><div class="local-files-selection-actions">${[['send','upload',tr('common:auto.upload_to_sftp')],['download','download',tr('sftp:menu.download')],['rename','pencil',tr('common:auto.rename')],['delete','trash-2',tr('common:actions.delete')]].map(([action,glyph,label])=>`<button type="button" data-action="web-files-${action}" data-tab-key="${escAttr(key)}">${icon(glyph)}<span>${esc(label)}</span></button>`).join('')}</div></div>
    <div class="local-files-list" role="region" aria-label="${escAttr(webFilesSourceLabel(source))}"></div><div class="web-files-status" role="status"></div></div>`;
  setWorkspace(webFilesSourceLabel(source),runtime.displayPath || '', 'local-files',key,updateTab,true,{kind:'local-files',fileSource:source,path:requestedPath || runtime.path || ''});
  if (!mounted || !runtime.loaded) await loadWebFiles(key,requestedPath || runtime.path || (source === 'browser' ? '/browser' : ''));
  refreshIcons();
  return key;
}

async function loadWebFiles(key,value) {
  const runtime = webFilesRuntime(key), root = localFilesRoot(key);
  if (!runtime || !root) return;
  const list = root.querySelector('.local-files-list');
  const sequence = runtime.webLoadSequence = (runtime.webLoadSequence || 0) + 1;
  runtime.webRequestedPath = value || '';
  runtime.webLoading = true;
  try {
    if (runtime.fileSource === 'browser' && !runtime.browserDirectory.name) {
      runtime.entries=[]; runtime.path=''; runtime.loaded=true;
      list.innerHTML=stateView('empty',webFilesTr('choose_folder'),webFilesTr('browser_hint')); syncWebFilesControls(key); return;
    }
    const data = runtime.fileSource === 'browser' ? await runtime.browserDirectory.list(value || '/browser') : await api('/api/server-files?'+new URLSearchParams({path:value || '',page_size:'200'}));
    if (runtime.fileSource === 'server') {
      if (Number(data.total_pages || 1)>50) throw new Error(webFilesTr('entry_limit'));
      for(let page=2;page<=Number(data.total_pages || 1);page++)data.entries.push(...(await api('/api/server-files?'+new URLSearchParams({path:value || '',page_size:'200',page:String(page)}))).entries);
      if(data.kind==='computer') {
        data.entries=(data.entries || []).map(entry=>{
          const name=entry.root_kind==='workspace' ? webFilesTr('workspace_folder') : entry.name;
          return {...entry,name};
        });
      }
    }
    if (runtime.webLoadSequence !== sequence || localFileRuntimes.get(String(key)) !== runtime) return;
    Object.assign(runtime,{entries:data.entries || [],path:data.path || '',displayPath:data.display_path || '',parent:data.parent || '',platform:data.platform,location:data.kind === 'computer' ? 'computer' : 'directory',loaded:true});
    if(!runtime.webHistoryNavigation){const history=runtime.webHistory || {paths:[],index:-1};if(history.paths[history.index]!==runtime.path){history.paths=history.paths.slice(0,history.index+1);history.paths.push(runtime.path);history.index=history.paths.length-1;}runtime.webHistory=history;}
    runtime.selected = new Set();
    const tab = workspaceTabByKey(key); if (tab) {tab.path=runtime.path;tab.fileSource=runtime.fileSource;tab.subtitle=runtime.displayPath;}
    if(activeTabKey===key){const subtitle=$('workspaceSubtitle');if(subtitle)subtitle.textContent=runtime.displayPath; if(typeof syncWorkspaceDocumentTitle==='function')syncWorkspaceDocumentTitle(webFilesSourceLabel(runtime.fileSource),runtime.displayPath,'local-files',key,tab || {});}
    renderWebFiles(key); syncWebFilesControls(key);
  } catch (error) {if(runtime.webLoadSequence!==sequence || localFileRuntimes.get(String(key))!==runtime)return;list.innerHTML=stateView('error',error.message,''); if(error.publicCode==='server_files_login_required')list.insertAdjacentHTML('beforeend',`<p class="web-files-login"><a href="/login">${esc(webFilesTr('sign_in'))}</a></p>`); syncWebFilesControls(key);}
  finally {if(runtime.webLoadSequence===sequence)runtime.webLoading=false;}
}

function syncWebFilesControls(key) {
  const runtime=webFilesRuntime(key), root=localFilesRoot(key); if (!runtime || !root) return;
  const writable=runtime.fileSource === 'server' || runtime.browserDirectory?.writable;
  const choosing=runtime.fileSource==='browser' && !runtime.browserDirectory?.name;
  root.querySelector('.web-files-hint').textContent=webFilesTr(runtime.fileSource === 'server' ? (runtimeSettings?.distribution==='fnos'?'server_hint':'server_standard_hint') : choosing ? 'choose_hint' : writable ? 'browser_hint' : 'readonly_hint');
  const pathNode=root.querySelector('.web-files-path');pathNode.textContent=runtime.displayPath || (runtime.fileSource==='browser'?webFilesTr('choose_folder'):webFilesRootsLabel(runtime.fileSource));
  pathNode.title=runtime.displayPath || pathNode.textContent;pathNode.disabled=!runtime.path;
  root.querySelector('[data-action="web-files-copy-path"]').disabled=!runtime.path;
  const badge=root.querySelector('.web-files-mode');badge.textContent=webFilesTr(choosing?'not_selected':writable?'read_write':'read_only');badge.dataset.writable=String(Boolean(writable));
  for (const action of ['mkdir','create','upload','rename','delete']) for (const button of root.querySelectorAll(`[data-action="web-files-${action}"]`)) {
    button.disabled=!writable || runtime.location==='computer' || !runtime.path;
    button.title=button.disabled ? webFilesTr(runtime.fileSource==='server' ? 'open_authorized_folder' : choosing ? 'choose_folder' : 'readonly_hint') : button.getAttribute('aria-label') || button.textContent.trim();
  }
  root.querySelector('[data-action="web-files-parent"]').disabled=!runtime.path || runtime.path==='/browser';
  root.querySelector('[data-action="web-files-back"]').disabled=!(runtime.webHistory?.index>0);
  root.querySelector('[data-action="web-files-forward"]').disabled=!runtime.webHistory || runtime.webHistory.index>=runtime.webHistory.paths.length-1;
  const selected=runtime.selected || new Set(), bar=root.querySelector('.web-files-selection');
  bar.hidden=!selected.size;bar.querySelector('span').textContent=webFilesTr('selected',{count:selected.size});
}

function renderWebFiles(key) {
  const runtime=webFilesRuntime(key), root=localFilesRoot(key);if(!runtime || !root)return;
  const entries=runtime.entries.filter(entry=>!runtime.query || entry.name.toLocaleLowerCase().includes(runtime.query.toLocaleLowerCase())).sort((a,b)=>(a.type==='file')-(b.type==='file') || a.name.localeCompare(b.name,undefined,{numeric:true}));
  const pageSize=100, pages=Math.max(1,Math.ceil(entries.length/pageSize)); runtime.page=Math.max(1,Math.min(runtime.page || 1,pages));
  const header=`<div class="local-files-head"><label><input type="checkbox" data-change-action="web-files-select-all" data-tab-key="${escAttr(key)}" aria-label="${escAttr(tr('sftp:auto.select_page'))}"></label><span>${esc(tr('sftp:auto.name'))}</span><span>${esc(tr('sftp:auto.size'))}</span><span>${esc(tr('sftp:auto.modified'))}</span></div>`;
  const rows=entries.slice((runtime.page-1)*pageSize,runtime.page*pageSize).map(entry=>`<div class="local-files-row" data-i18n-skip data-path="${escAttr(entry.path)}" data-tab-key="${escAttr(key)}" data-entry-type="${entry.type}" draggable="${entry.type==='drive' ? 'false' : 'true'}" data-action="web-files-select" data-dblclick-action="web-files-open" data-contextmenu-action="web-files-menu" data-dragstart-action="web-files-drag-start" data-dragend-action="local-files-entry-drag-end">
    <input class="local-files-check" type="checkbox" value="${escAttr(entry.path)}" data-path="${escAttr(entry.path)}" data-name="${escAttr(entry.name)}" data-type="${entry.type}" data-size="${entry.size}" data-tab-key="${escAttr(key)}" data-action="web-files-check" ${runtime.selected?.has(entry.path)?'checked':''} ${entry.type==='drive'?'disabled':''} aria-label="${escAttr(tr('common:local_files.select_entry',{name:entry.name}))}">
    <button class="local-files-name" type="button" data-action="web-files-row-open" data-path="${escAttr(entry.path)}" data-tab-key="${escAttr(key)}"><span class="sftp-icon">${entry.type==='drive'?icon('hard-drive'):sftpIcon(entry.name,entry.type==='dir')}</span><span class="local-files-name-copy"><span class="local-files-file-name" data-i18n-skip>${esc(entry.name)}</span><span class="local-files-mobile-meta ${entry.type==='drive'?'web-files-root-path':''}" data-i18n-skip>${entry.type==='drive'?esc(entry.display_path || entry.name):entry.type==='file'?esc(formatBytes(entry.size)):esc(tr('sftp:auto.directory'))}</span></span></button><span class="local-files-size">${entry.type==='file'?esc(formatBytes(entry.size)):'--'}</span><span class="local-files-time">${entry.mtime?esc(formatSftpTime(entry.mtime)):'--'}</span></div>`).join('');
  root.querySelector('.local-files-list').innerHTML=header+(rows || stateView('empty',tr('sftp:auto.empty_directory')))+`<div class="pager"><button data-action="web-files-page" data-page="${runtime.page-1}" data-tab-key="${escAttr(key)}" ${runtime.page<=1?'disabled':''}>${esc(tr('sftp:auto.previous_page'))}</button><span>${runtime.page} / ${pages}</span><button data-action="web-files-page" data-page="${runtime.page+1}" data-tab-key="${escAttr(key)}" ${runtime.page>=pages?'disabled':''}>${esc(tr('sftp:auto.next_page'))}</button></div>`;
  refreshIcons();syncWebFilesControls(key);
}

function selectWebFile(key,value,checked) {
  const runtime=webFilesRuntime(key);if(!runtime)return;
  if (!runtime.selected) runtime.selected=new Set();
  if (checked===undefined) {runtime.selected.clear();runtime.selected.add(value);} else if(checked)runtime.selected.add(value);else runtime.selected.delete(value);
  for(const check of localFilesRoot(key).querySelectorAll('.local-files-check'))check.checked=runtime.selected.has(check.value);
  syncWebFilesControls(key);
}

async function mutateWebFiles(key,action,data) {
  const runtime=webFilesRuntime(key);
  if (runtime.fileSource==='browser') await runtime.browserDirectory.mutate(action,data);
  else await api('/api/server-files/'+action,{method:'POST',body:JSON.stringify(data)});
  await loadWebFiles(key,runtime.path);
}

async function createWebFile(key,type) {
  const runtime=webFilesRuntime(key);
  const name=await inputModal(tr(type==='dir'?'common:auto.new_folder':'common:auto.new_file'),webFilesTr('name'));
  if(name)await mutateWebFiles(key,'create',{directory:runtime.path,name,type});
}

async function navigateWebFilesPath(key) {
  const runtime=webFilesRuntime(key);
  const value=await inputModal(webFilesTr('go_to_folder'),webFilesTr(runtime.fileSource==='browser'?'relative_path_hint':'path'),runtime.displayPath || '');
  if(!value)return;
  if(runtime.fileSource==='server') {
    const resolved=await api('/api/server-files/resolve?'+new URLSearchParams({path:value}));
    return loadWebFiles(key,resolved.path);
  }
  const name=runtime.browserDirectory.name;
  if(value!==name && !value.startsWith(name+'/'))throw new Error(webFilesTr('invalid_path'));
  const virtual='/browser'+value.slice(name.length);runtime.browserDirectory.parts(virtual);
  return loadWebFiles(key,virtual);
}

async function renameWebFile(key) {
  const runtime=webFilesRuntime(key),items=runtime.entries.filter(item=>runtime.selected?.has(item.path));
  if(items.length!==1)return notify(webFilesTr('select_one'),'info');
  if(items[0].type==='dir' && runtime.fileSource==='browser')return notify(webFilesTr('directory_rename_unavailable'),'info');
  const name=await inputModal(tr('common:auto.rename'),webFilesTr('name'),items[0].name);
  if(name && name!==items[0].name)await mutateWebFiles(key,'rename',{path:items[0].path,new_name:name});
}

async function deleteWebFiles(key) {
  const runtime=webFilesRuntime(key),paths=[...(runtime.selected || [])];if(!paths.length)return;
  if(await confirmModal(webFilesTr('delete_confirm',{count:paths.length}),tr('common:actions.delete'),tr('common:actions.delete'),tr('common:actions.cancel'),true))await mutateWebFiles(key,'delete',{paths});
}

async function openWebFile(key,value) {
  const runtime=webFilesRuntime(key),entry=runtime.entries.find(item=>item.path===value);if(!entry)return;
  if(entry.type!=='file')return loadWebFiles(key,value);
  let content;
  try {
    if(runtime.fileSource==='server') content=(await api('/api/server-files/text?'+new URLSearchParams({path:value}))).content;
    else {const file=await runtime.browserDirectory.file(value);if(file.size>1024*1024)throw new Error(webFilesTr('text_limit'));content=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());if(content.includes('\0'))throw new Error(webFilesTr('text_limit'));}
  } catch(error) {return notify(error.message || webFilesTr('text_limit'),'error');}
  const modal=$('modal');modal.hidden=false;modal.innerHTML=`<div class="modal-card wide web-files-editor"><h2 data-i18n-skip>${esc(entry.name)}</h2><textarea data-i18n-skip aria-label="${escAttr(webFilesTr('content'))}"></textarea><div class="actions"><button type="button" class="primary" data-web-save>${esc(tr('common:actions.save'))}</button><button type="button" data-web-close>${esc(tr('common:actions.cancel'))}</button></div></div>`;
  modal.querySelector('textarea').value=content;
  modal.querySelector('[data-web-close]').addEventListener('click',closeModal);
  const save=modal.querySelector('[data-web-save]');save.disabled=runtime.fileSource==='browser'&&!runtime.browserDirectory.writable;
  save.addEventListener('click',async()=>{save.disabled=true;try{const text=modal.querySelector('textarea').value;if(new TextEncoder().encode(text).length>1024*1024)throw new Error(webFilesTr('text_limit'));if(runtime.fileSource==='browser')await runtime.browserDirectory.write(value,text);else await api('/api/server-files/text',{method:'POST',body:JSON.stringify({path:value,content:text})});closeModal();await loadWebFiles(key,runtime.path);}catch(error){notify(error.message,'error');save.disabled=false;}});
}

function webFilesPayload(key) {const runtime=webFilesRuntime(key);const entries=runtime.entries.filter(item=>runtime.selected?.has(item.path)&&item.type!=='drive');return {sourceTabKey:key,paths:entries.map(item=>item.path),entries};}

async function uploadWebFilesToSftp(payload,target) {
  const runtime=webFilesRuntime(payload.sourceTabKey);if(!runtime)return;
  const directory=sftpTabRuntimes.get(String(target.key || ''))?.state?.path || target.path || '.';
  if(runtime.fileSource==='browser'){const files=await runtime.browserDirectory.collect(payload.entries);return uploadSftpFilesToDirectory(files,Number(target.id),directory,{tabKey:target.key || '',directories:files.directories});}
  const conflict=await sftpConflictChoice(Number(target.id),directory,payload.entries);
  if(conflict==='cancel')return;
  const result=await api('/api/server-files/upload',{method:'POST',body:JSON.stringify({connection_id:Number(target.id),paths:payload.paths,target:directory,conflict})});
  for(const job of result.jobs || [])trackSftpMutationJob(job);await refreshSftpJobs();startSftpJobsTimer();
}

function showWebFilesSendMenu(event,key) {
  const payload=webFilesPayload(key);if(!payload.paths.length)return;
  showActionMenu(event,(connections || []).map(connection=>({label:connection.name || connection.ssh_host,icon:'server',run:()=>uploadWebFilesToSftp(payload,tabs.find(tab=>tab.kind==='sftp'&&Number(tab.id)===Number(connection.id)) || {kind:'sftp',id:connection.id,path:'.'})})));
}

async function downloadWebFiles(key) {
  const runtime=webFilesRuntime(key),items=webFilesPayload(key).entries;
  for(const entry of items) {
    if(entry.type==='dir') {notify(webFilesTr('download_file_only'),'info');continue;}
    const anchor=document.createElement('a');anchor.download=entry.name;
    const blob=runtime.fileSource==='browser'?await runtime.browserDirectory.file(entry.path):null;
    anchor.href=blob?URL.createObjectURL(blob):'/api/server-files/download?'+new URLSearchParams({path:entry.path});
    anchor.click();if(blob)setTimeout(()=>URL.revokeObjectURL(anchor.href),60000);
  }
}

async function uploadIntoWebFiles(key) {
  const runtime=webFilesRuntime(key);if(runtime.fileSource==='browser')return notify(webFilesTr('use_sftp_drop'),'info');
  const input=document.createElement('input');input.type='file';input.multiple=true;
  input.addEventListener('change',async()=>{try{for(const file of input.files){const response=await fetch('/api/server-files/upload-content?'+new URLSearchParams({path:runtime.path,name:file.name}),{method:'POST',body:file,credentials:'same-origin'});if(!response.ok)throw await apiErrorFromResponse(response);}await loadWebFiles(key,runtime.path);}catch(error){notify(error.message,'error');}});input.click();
}

async function receiveSftpInWebFiles(drag,target) {
  const runtime=webFilesRuntime(target.key);if(!runtime || !runtime.path)throw new Error(webFilesTr('choose_folder'));
  if(runtime.fileSource==='server') {
    const destination=runtime.path;
    const plan=await api('/api/server-files/receive-plan',{method:'POST',body:JSON.stringify({connection_id:Number(drag.connectionId),paths:drag.entries.map(item=>item.path),target:destination})});
    const conflict=await chooseWebFilesReceiveConflict((plan.items || []).map((item,index)=>({...item,type:drag.entries[index]?.type,existing_type:item.type})).filter(item=>item.exists));
    if(conflict==='cancel')return;
    const job=await api('/api/server-files/receive',{method:'POST',body:JSON.stringify({connection_id:Number(drag.connectionId),paths:drag.entries.map(item=>item.path),target:destination,conflict})});
    trackLocalDeliveryJobTarget(job,target.key,destination);trackSftpMutationJob(job);await refreshSftpJobs();startSftpJobsTimer();return;
  }
  if(!runtime.browserDirectory.writable) {for(const entry of drag.entries)await downloadSftp(Number(drag.connectionId),entry.path,entry.type);return;}
  runtime.webAbort?.abort();const controller=new AbortController();runtime.webAbort=controller;
  let count=0;
  let conflict='rename';
  const renamed=[];
  const status=localFilesRoot(target.key).querySelector('.web-files-status');
  const save=async(entry,parent,relative='')=>{
    if(++count>1000)throw new Error(webFilesTr('transfer_limit'));
    const name=runtime.browserDirectory.receiveName(entry.name);
    if(entry.type==='dir') {
      let directoryName=name;
      for(let n=1;await webFilesHandleExists(parent,directoryName);n++)directoryName=name+' ('+n+')';
      if(directoryName!==entry.name)renamed.push({source:relative+entry.name,target:relative+directoryName});
      const directory=await parent.getDirectoryHandle(directoryName,{create:true});
      for(let page=1;;page++) {
        const listing=await api(`/api/connections/${Number(drag.connectionId)}/sftp?`+new URLSearchParams({path:entry.path,page:String(page),page_size:'200'}));
        for(const child of listing.entries || []) {if(!['dir','file'].includes(child.type))throw new Error(webFilesTr('invalid_path'));await save({...child,path:child.path || joinRemotePath(entry.path,child.name)},directory,relative+directoryName+'/');}
        if(page>=Number(listing.total_pages || 1))break;
      }
    } else {
      let filename=name;
      if(conflict!=='overwrite')for(let n=1;await webFilesHandleExists(parent,filename);n++)filename=runtime.browserDirectory.numberedName(name,n);
      const existing=await webFilesHandleExists(parent,filename);
      if(filename!==entry.name)renamed.push({source:relative+entry.name,target:relative+filename});
      const response=await fetch(`/api/connections/${Number(drag.connectionId)}/sftp/download?`+new URLSearchParams({path:entry.path}),{signal:controller.signal});
      if(!response.ok)throw await apiErrorFromResponse(response,webFilesTr('transfer_failed'));
      const handle=await parent.getFileHandle(filename,{create:true}),writer=await handle.createWritable();
      try {await response.body.pipeTo(writer,{signal:controller.signal});}catch(error){await writer.abort().catch(()=>{});if(!existing)await parent.removeEntry(filename).catch(()=>{});throw error;}
    }
    status.textContent=webFilesTr(renamed.length?'received_renamed':'received',{count,renamed:renamed.length});
  };
  await runtime.browserDirectory.writeAllowed();
  const directory=await runtime.browserDirectory.directory(runtime.path);
  const conflicts=[];
  for(const entry of drag.entries){const existing_type=await webFilesHandleKind(directory,runtime.browserDirectory.receiveName(entry.name));if(existing_type)conflicts.push({...entry,existing_type});}
  const destination=runtime.path;
  try{conflict=await chooseWebFilesReceiveConflict(conflicts);if(conflict==='cancel')return;for(const entry of drag.entries){if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');await save(entry,directory);}if(runtime.path===destination)await loadWebFiles(target.key,destination);if(renamed.length){const message=webFilesTr('received_renamed',{count,renamed:renamed.length})+'\n'+renamed.slice(0,6).map(item=>tr('tasks:notifications.file_renamed',item)).join('\n');status.textContent=message;notify(message,'info');}else notify(webFilesTr('received',{count}),'success');}finally{if(runtime.webAbort===controller)runtime.webAbort=null;}
}

async function chooseWebFilesReceiveConflict(items) {
  if(!items.length)return 'rename';
  const names=items.slice(0,6).map(item=>item.name).join('\n');
  const filesOnly=items.every(item=>item.type==='file' && item.existing_type==='file');
  return chooseModal(tr('navigation:transfer.local_conflict_title'),webFilesTr('receive_conflicts',{count:items.length})+'\n'+names+(filesOnly?'':'\n'+webFilesTr('folder_conflict_hint')),[
    ...(filesOnly?[{label:tr('common:auto.overwrite'),value:'overwrite',className:'danger'}]:[]),
    {label:tr('common:auto.auto_rename'),value:'rename',className:'primary'},
    {label:tr('common:actions.cancel'),value:'cancel'}
  ]);
}

async function webFilesHandleExists(directory,name) {
  return Boolean(await webFilesHandleKind(directory,name));
}

async function webFilesHandleKind(directory,name) {
  for(const [method,kind] of [['getFileHandle','file'],['getDirectoryHandle','dir']])try{await directory[method](name);return kind;}catch(error){if(error.name!=='NotFoundError'&&error.name!=='TypeMismatchError')throw error;}
  return '';
}

function webFilesAction(handler) {return async context=>{try{return await handler(context);}catch(error){if(error.name!=='AbortError')notify(error.message || webFilesTr('transfer_failed'),'error');}};}
for(const [action,handler] of Object.entries({
  choose:async({element})=>{const runtime=webFilesRuntime(element.dataset.tabKey);await runtime.browserDirectory.choose();await loadWebFiles(element.dataset.tabKey,'/browser');},
  'choose-readonly':async({element})=>{const runtime=webFilesRuntime(element.dataset.tabKey);await runtime.browserDirectory.choose('readonly');await loadWebFiles(element.dataset.tabKey,'/browser');},
  parent:({element})=>{const runtime=webFilesRuntime(element.dataset.tabKey);return loadWebFiles(element.dataset.tabKey,runtime.parent);},
  back:({element})=>navigateWebFilesHistory(-1,element.dataset.tabKey),forward:({element})=>navigateWebFilesHistory(1,element.dataset.tabKey),
  path:({element})=>navigateWebFilesPath(element.dataset.tabKey),
  'copy-path':({element})=>copyText(webFilesRuntime(element.dataset.tabKey).displayPath),
  roots:({element})=>loadWebFiles(element.dataset.tabKey,webFilesRuntime(element.dataset.tabKey).fileSource==='browser'?'/browser':''),
  refresh:({element})=>loadWebFiles(element.dataset.tabKey,webFilesRuntime(element.dataset.tabKey).path),
  mkdir:({element})=>createWebFile(element.dataset.tabKey,'dir'),create:({element})=>createWebFile(element.dataset.tabKey,'file'),
  rename:({element})=>renameWebFile(element.dataset.tabKey),delete:({element})=>deleteWebFiles(element.dataset.tabKey),
  upload:({element})=>uploadIntoWebFiles(element.dataset.tabKey),download:({element})=>downloadWebFiles(element.dataset.tabKey),
  send:({event,element})=>showWebFilesSendMenu(event,element.dataset.tabKey),new:({event})=>showWebFilesSourceMenu(event),
  select:({event,element})=>{if(!event.target.closest('button,input'))selectWebFile(element.dataset.tabKey,element.dataset.path);},
  check:({event,element})=>{event.stopPropagation();selectWebFile(element.dataset.tabKey,element.dataset.path,element.checked);},
  'row-open':({event,element})=>{event.stopPropagation();return openWebFile(element.dataset.tabKey,element.dataset.path);},
  open:({element})=>openWebFile(element.dataset.tabKey,element.dataset.path),
  menu:({event,element})=>{event.preventDefault();selectWebFile(element.dataset.tabKey,element.dataset.path);showActionMenu(event,[{label:tr('common:auto.open'),icon:'folder-open',run:()=>openWebFile(element.dataset.tabKey,element.dataset.path)},{label:tr('common:auto.upload_to_sftp'),icon:'upload',children:()=>(connections || []).map(connection=>({label:connection.name,run:()=>uploadWebFilesToSftp(webFilesPayload(element.dataset.tabKey),{id:connection.id,path:'.'})}))},{label:tr('common:actions.delete'),icon:'trash-2',danger:true,run:()=>deleteWebFiles(element.dataset.tabKey)}]);},
  page:({element})=>{const runtime=webFilesRuntime(element.dataset.tabKey);runtime.page=Number(element.dataset.page);renderWebFiles(element.dataset.tabKey);},
  search:({element})=>{const runtime=webFilesRuntime(element.dataset.tabKey);runtime.query=element.value;runtime.page=1;renderWebFiles(element.dataset.tabKey);},
  'select-all':({element})=>{const runtime=webFilesRuntime(element.dataset.tabKey);for(const check of localFilesRoot(element.dataset.tabKey).querySelectorAll('.local-files-check:not(:disabled)')){check.checked=element.checked;if(element.checked)runtime.selected.add(check.value);else runtime.selected.delete(check.value);}syncWebFilesControls(element.dataset.tabKey);},
  'drag-start':({event,element})=>{selectWebFile(element.dataset.tabKey,element.dataset.path,true);const payload=webFilesPayload(element.dataset.tabKey);localFileInternalDrag=payload;event.dataTransfer.effectAllowed='copy';event.dataTransfer.setData(LOCAL_FILES_DRAG_MIME,JSON.stringify(payload));},
  'drag-over':({event})=>{if(activeSftpDragPayload(event.dataTransfer)){event.preventDefault();event.dataTransfer.dropEffect='copy';}},
  drop:({event,element})=>{const drag=activeSftpDragPayload(event.dataTransfer);if(!drag)return;event.preventDefault();return receiveSftpInWebFiles(drag,{key:element.dataset.tabKey});}
}))registerTermaAction('web-files-'+action,webFilesAction(handler));

const refreshWebFilesForJobBase=refreshLocalFilesForDeliveryJob;
refreshLocalFilesForDeliveryJob=function(job){
  const target=localDeliveryJobTargets.get(String(job?.id || ''));
  refreshWebFilesForJobBase(job);
  if(job?.status!=='done')return;
  const directory=localDeliveryJobDirectory(job);
  for(const [key,runtime] of localFileRuntimes){
    if(runtime.fileSource!=='server' || !runtime.path || (runtime.webLoading && runtime.webRequestedPath!==runtime.path))continue;
    const registered=target?.tabKey===key && target.directory===runtime.path;
    if(registered || (directory && localDeliveryPathKey(runtime.displayPath)===localDeliveryPathKey(directory)))void loadWebFiles(key,runtime.path);
  }
};

function navigateWebFilesHistory(direction,key){
  const runtime=webFilesRuntime(key),history=runtime?.webHistory;const index=(history?.index ?? -1)+Number(direction);
  if(!history || index<0 || index>=history.paths.length)return;
  history.index=index;runtime.webHistoryNavigation=true;
  return loadWebFiles(key,history.paths[index]).finally(()=>{runtime.webHistoryNavigation=false;});
}

const closeWebFilesTabsBase=closeTabsByKey;
closeTabsByKey=function(keys,anchorKey=''){for(const key of keys || [])webFilesRuntime(key)?.webAbort?.abort();return closeWebFilesTabsBase(keys,anchorKey);};

if(typeof registerTermaI18nRenderer==='function')registerTermaI18nRenderer(()=>{
  for(const tab of tabs || []) {
    if(!tab.fileSource)continue;
    tab.title=webFilesSourceLabel(tab.fileSource);
    const root=localFilesRoot(tab.key),pane=workspaceFindPaneForTab(tab.key);
    if(root?.querySelector('.web-files-shell') && pane)runInWorkspacePane(pane.id,()=>{root.querySelector('.web-files-shell').remove();void openWebFiles(tab.path || '',false,tab.key,tab.fileSource);});
  }
});
