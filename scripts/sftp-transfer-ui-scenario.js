const {runSftpPickerUiScenario}=require('./sftp-picker-ui-scenario');
async function runSftpTransferUiScenario({ browser, execute, check, shot }) {
  await execute(`
    const f=window.__sftpVueFixture;
    const polling=Boolean(window.termaSftpTransferLifecycle.polling.running);window.termaSftpTransferLifecycle.polling.stop();
    await window.termaSftpTaskWorkspace.runtime.refresh();window.termaSftpTransferLifecycle.polling.stop();
    const c=window.__sftpTransferFixture={original:{api,notify,trackSftpMutationJob:window.termaSftpTransferLifecycle.completion.track,refreshSftpJobs:window.termaSftpTaskWorkspace.runtime.refresh,refreshSftpJobsIfStale: window.termaSftpTaskWorkspace.runtime.stale,startPolling:window.termaSftpTransferLifecycle.polling.start,polling,selectedEntries:window.termaSftpViews.selectedEntries,selectedPaths:window.termaSftpViews.selectedPaths,desktop:window.termaFileTransferRuntime.desktop,clearSelection:window.termaSftpViews.clearSelection,xhr:window.XMLHttpRequest,jobs:window.termaSftpTaskWorkspace.state.jobs,view:window.termaSftpTaskWorkspace.state.view},requests:[],bodies:[],jobs:[],notices:[],selected:[{path:'/var/data/fixture.txt',type:'file'}],mode:'conflict'};
    c.key=f.key;c.tab={key:f.key,kind:'sftp',id:7,title:'Transfer fixture',path:'/var/data'};
    c.center=document.getElementById('sftpTaskCenter');c.centerParent=c.center.parentNode;c.centerNext=c.center.nextSibling;c.centerStyle=c.center.getAttribute('style');
    document.body.append(c.center);Object.assign(c.center.style,{position:'fixed',top:'12px',right:'12px',height:'38px',zIndex:'90'});
    f.root.dataset.sftpTabKey=f.key;c.runtime={tabKey:f.key,root:f.root,connectionId:7,state:{...f.options.model.state,connectionId:7,path:'/var/data'}};
    tabs.push(c.tab);sftpTabRuntimes.set(c.key,c.runtime);
    c.notice=localStorage.getItem('sftpBrowserDownloadNoticeV1');c.desktopNotice=localStorage.getItem('sftpDesktopDownloadNoticeV1');localStorage.removeItem('sftpBrowserDownloadNoticeV1');
    c.upsert=job=>{const i=c.jobs.findIndex(j=>j.id===job.id);if(i<0)c.jobs.push(job);else Object.assign(c.jobs[i],job);window.termaSftpTaskWorkspace.state.jobs=c.jobs;window.termaSftpTaskWorkspace.state.paint(c.jobs)};
    notify=(message,type)=>c.notices.push({message,type});window.termaSftpTransferLifecycle.completion.track=c.upsert;
    window.termaSftpTransferLifecycle.polling.start=()=>{};window.termaSftpTaskWorkspace.runtime.refresh=async()=>{window.termaSftpTaskWorkspace.state.jobs=c.jobs;window.termaSftpTaskWorkspace.state.paint(c.jobs);return c.jobs};
    window.termaSftpTaskWorkspace.runtime.stale=()=>window.termaSftpTaskWorkspace.runtime.refresh();
    window.termaSftpViews.selectedEntries=()=>c.selected.map(item=>({...item}));window.termaSftpViews.selectedPaths=()=>c.selected.map(item=>item.path);window.termaSftpViews.clearSelection=()=>{c.cleared=(c.cleared||0)+1};
    window.termaFileTransferRuntime.desktop=async(id,paths)=>{c.desktopDelivery={id,paths};await new Promise(resolve=>c.finishDelivery=resolve);};
    api=async(url,options={})=>{
      // Background notification/settings requests do not belong to this transfer fixture.
      if(url!=='/api/sftp/download-settings'&&!url.startsWith('/api/connections/7/sftp/')&&!url.startsWith('/api/sftp/jobs/'))return c.original.api(url,options);
      c.requests.push({url,body:JSON.parse(options.body||'{}')});
      if(url==='/api/sftp/download-settings')return {delivery_mode:c.deliveryMode||'browser',effective_directory:'C:/Downloads/Transfer fixture'};
      if(url.endsWith('/upload-plan'))return {items:[{name:'fixture.txt',exists:c.mode==='conflict'}]};
      if(url.endsWith('/mkdir'))return {ok:true};
      if(url.endsWith('/upload-job'))return {id:'transfer-upload-'+c.requests.length,type:'upload',connection_id:7,connection_name:'Transfer fixture',remote_path:'/var/data/fixture.txt',status:'running',phase:'receiving',size:8,transferred:0,can_cancel:true};
      if(url.endsWith('/download')||url.endsWith('/download-batch'))return {id:'transfer-download-'+c.requests.length,type:'download',connection_id:7,connection_name:'Transfer fixture',remote_path:'/var/data/fixture.txt',status:'running',phase:'downloading',resume_supported:true,can_pause:true,size:16,transferred:4,delivery_mode:'browser'};
      const action=url.split('/').pop(),job=c.jobs.find(j=>url.includes(encodeURIComponent(j.id)));
      if(['cancel','pause','resume'].includes(action)&&job){
        if(action==='cancel'&&c.mode==='reject')return {ok:false,status:job.status,message:'fixture-cancel-rejected'};
        if(action==='cancel'&&c.mode==='offline')throw new Error('fixture-network-offline');
        if(c.mode==='slow')await new Promise(resolve=>c.release=resolve);
        Object.assign(job,{status:action==='cancel'?'cancelled':action==='pause'?'paused':'running',phase:action==='pause'?'paused':'downloading',can_resume:action==='pause',can_pause:action==='resume'});
        return {ok:true,status:job.status};
      }
      throw new Error('Unexpected transfer fixture request: '+url);
    };
    window.XMLHttpRequest=class {
      constructor(){this.upload={};this.status=200;this.responseText='{}'}
      open(method,url){this.url=url}setRequestHeader(){}
      send(file){this.file=file;c.bodies.push(this);this.upload.onprogress?.({lengthComputable:true,loaded:4,total:8})}
      abort(){this.aborted=true;this.onabort?.()}
      done(){const job=c.jobs.find(j=>this.url.includes(j.id));this.responseText=JSON.stringify({...job,status:'done',phase:'done',transferred:8,finished_at:Date.now()});this.onload?.()}
    };
    c.reset=()=>{c.requests=[];c.bodies=[];c.jobs=[];window.termaSftpTaskWorkspace.state.jobs=c.jobs;c.mode='conflict';c.deliveryMode='browser';c.runtime.state.path='/var/data';c.selected=[{path:'/var/data/fixture.txt',type:'file'}];window.termaSftpTaskWorkspace.state.paint();};
    c.beginUpload=()=>{c.pending=window.termaSftpTransfers.controller.submit([{file:new File(['fixture!'],'fixture.txt',{lastModified:1}),relativePath:'fixture.txt'}],7,'/var/data',{tabKey:c.key})};
  `);
  const choose = key => execute(`[...document.querySelectorAll('#modal button')].find(button=>button.textContent.includes(tr('${key}'))).click();await new Promise(resolve=>setTimeout(resolve,40));`);
  const taskShot = async name => {
    await check(`${name} task card is visible and unobstructed`, `(()=>{const drawer=document.getElementById('sftpTaskCenterDrawer'),card=drawer?.querySelector('.sftp-job'),r=drawer?.getBoundingClientRect(),q=card?.getBoundingClientRect();return !!card&&drawer.checkVisibility()&&card.checkVisibility()&&r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&q.height>0&&drawer.contains(document.elementFromPoint(q.left+Math.min(q.width/2,30),q.top+Math.min(q.height/2,20)))})()`);
    await shot(name);
  };
  for (const theme of ['light', 'dark']) for (const language of ['zh-CN', 'en-US']) {
    const name = `transfer-${language}-${theme}`;
    await execute(`applyTheme('${theme}');await setTermaLanguage('${language}',{render:false});`);
    await runSftpPickerUiScenario({browser,execute,check,shot},name);
    await execute(`applyTheme('${theme}');await setTermaLanguage('${language}',{render:false});const f=window.__sftpVueFixture,c=window.__sftpTransferFixture;window.termaSftpViews.refresh(f.key,f.options);c.reset();c.beginUpload();await new Promise(resolve=>setTimeout(resolve,40));`);
    await check(`${name} upload conflict translated and bounded`, `(()=>{const card=document.querySelector('#modal .modal-card'),r=card?.getBoundingClientRect();return !!card&&card.textContent.includes(tr('sftp:transfer.choose_upload_behavior'))&&[...card.querySelectorAll('button')].every(b=>{const q=b.getBoundingClientRect();return q.left>=0&&q.right<=innerWidth&&b.scrollWidth<=b.clientWidth+1})})()`);
    await shot(`${name}-upload-conflict`);
    await execute(`document.querySelector('#modal button').focus();window.__sftpTransferFixture.focus=document.activeElement;await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}',{render:false});`);
    await check(`${name} opened upload choice translates in place`, `document.activeElement===window.__sftpTransferFixture.focus&&document.querySelector('#modal h2').textContent===tr('sftp:transfer.same_name_title')&&document.querySelector('#modal').textContent.includes(tr('sftp:transfer.choose_upload_behavior'))`);
    await shot(`${name}-upload-live-language`);
    await execute(`await setTermaLanguage('${language}',{render:false});`);
    await choose('sftp:transfer.auto_rename');
    await check(`${name} upload receives body through migrated transport`, `(()=>{const c=window.__sftpTransferFixture,j=c.jobs[0];return c.bodies.length===1&&window.termaSftpTaskWorkspace.state.uploads.has(j.id)&&j.phase==='receiving'&&j.transferred===4&&j.progress===25&&c.requests.find(r=>r.url.endsWith('/upload-job')).body.conflict==='rename'})()`);
    await execute(`window.termaSftpTaskWorkspace.state.view='current';document.getElementById('sftpTaskCenterDrawer').hidden=false;window.termaSftpTaskWorkspace.state.paint();`);
    await taskShot(`${name}-upload-receiving`);
    await execute(`const c=window.__sftpTransferFixture;c.mode='reject';await window.termaTaskActions.current.single(c.jobs[0].id,'cancel');`);
    await check(`${name} rejected cancel preserves active body`, `!window.__sftpTransferFixture.bodies[0].aborted&&window.termaSftpTaskWorkspace.state.uploads.get(window.__sftpTransferFixture.jobs[0].id)?.cancelled===false`);
    await taskShot(`${name}-cancel-rejected`);
    await execute(`const c=window.__sftpTransferFixture;c.mode='ok';await window.termaTaskActions.current.single(c.jobs[0].id,'cancel');await c.pending;`);
    await check(`${name} accepted cancel releases active body`, `window.__sftpTransferFixture.bodies[0].aborted&&!window.termaSftpTaskWorkspace.state.uploads.has(window.__sftpTransferFixture.jobs[0].id)&&window.__sftpTransferFixture.jobs[0].status==='cancelled'`);
    await execute(`window.termaSftpTaskWorkspace.runtime.close();const c=window.__sftpTransferFixture;c.reset();localStorage.removeItem('sftpBrowserDownloadNoticeV1');c.pending=window.termaSftpTransfers.controller.download(7,'/var/data/fixture.txt');await new Promise(resolve=>setTimeout(resolve,40));`);
    await check(`${name} browser first-download notice is migrated`, `document.querySelector('#modal h2').textContent===tr('sftp:transfer.first_download_title')&&document.querySelector('#modal').textContent.includes(tr('sftp:transfer.continue_download'))`);
    await shot(`${name}-download-notice`);
    await execute(`await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}',{render:false});`);
    await check(`${name} first-download notice translates while open`, `document.querySelector('#modal h2').textContent===tr('sftp:transfer.first_download_title')&&document.querySelector('#modal').textContent.includes(tr('sftp:transfer.continue_download'))`);
    await execute(`await setTermaLanguage('${language}',{render:false});`);
    await choose('sftp:transfer.continue_download');
    await execute(`const c=window.__sftpTransferFixture;await c.pending;window.termaSftpTaskWorkspace.state.view='current';document.getElementById('sftpTaskCenterDrawer').hidden=false;window.termaSftpTaskWorkspace.state.paint();`);
    await check(`${name} download task keeps browser delivery registration`, `window.termaSftpTaskWorkspace.state.pendingDownloads.has(window.__sftpTransferFixture.jobs[0].id)`);
    await execute(`const c=window.__sftpTransferFixture;await window.termaTaskActions.current.single(c.jobs[0].id,'pause');`);
    await check(`${name} download can pause and resume`, `window.__sftpTransferFixture.jobs[0].status==='paused'&&window.termaSftpTasks.canResume(window.__sftpTransferFixture.jobs[0])`);
    await taskShot(`${name}-download-paused`);
    await execute(`const c=window.__sftpTransferFixture;await window.termaTaskActions.current.single(c.jobs[0].id,'resume');`);
    await check(`${name} download resumes existing job`, `window.__sftpTransferFixture.jobs[0].status==='running'&&window.__sftpTransferFixture.requests.filter(r=>r.url.endsWith('/resume')).length===1`);
    await taskShot(`${name}-download-resumed`);
    await execute(`const c=window.__sftpTransferFixture;Object.assign(c.jobs[0],{status:'failed',can_resume:true,error:'fixture-network-offline'});window.termaSftpTaskWorkspace.state.view='failed';window.termaSftpTaskWorkspace.state.paint();`);
    await taskShot(`${name}-download-failed`);
    await execute(`const c=window.__sftpTransferFixture;await window.termaTaskActions.current.single(c.jobs[0].id,'resume');window.termaSftpTaskWorkspace.state.view='current';window.termaSftpTaskWorkspace.state.paint();`);
    await check(`${name} failed transfer retries through existing resume endpoint`, `window.__sftpTransferFixture.jobs[0].status==='running'`);
    await execute(`window.termaSftpTaskWorkspace.runtime.close();const c=window.__sftpTransferFixture;c.pending=window.termaSftpTransfers.controller.selection(c.key);await new Promise(resolve=>setTimeout(resolve,40));`);
    await check(`${name} batch download choice fits`, `(()=>{const card=document.querySelector('#modal .modal-card');return card.textContent.includes(tr('sftp:transfer.download_archive'))&&[...card.querySelectorAll('button')].every(b=>{const r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&b.scrollWidth<=b.clientWidth+1})})()`);
    await shot(`${name}-batch-choice`);
    await execute(`const c=window.__sftpTransferFixture;c.runtime.state.path='/changed';`);
    await choose('sftp:transfer.download_separately');
    await execute(`await window.__sftpTransferFixture.pending;`);
    await check(`${name} stale download target cancels before API submit`, `window.__sftpTransferFixture.requests.filter(r=>r.url.endsWith('/download')).length===1`);
    await execute(`const c=window.__sftpTransferFixture;c.reset();c.deliveryMode='desktop';localStorage.removeItem('sftpDesktopDownloadNoticeV1');c.pending=window.termaSftpTransfers.controller.download(7,'/var/data/desktop.txt');await new Promise(resolve=>setTimeout(resolve,40));`);
    await check(`${name} desktop download notice shows captured directory and bounded buttons`, `(()=>{const card=document.querySelector('#modal .modal-card');return card.textContent.includes('C:/Downloads/Transfer fixture')&&[...card.querySelectorAll('button')].every(b=>{const r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&b.scrollWidth<=b.clientWidth+1})})()`);
    await shot(`${name}-desktop-download-notice`);
    await execute(`document.querySelector('#modal button').focus();window.__sftpTransferFixture.focus=document.activeElement;await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}',{render:false});`);
    await check(`${name} desktop download notice translates without losing focus or path`, `document.activeElement===window.__sftpTransferFixture.focus&&document.querySelector('#modal h2').textContent===tr('sftp:transfer.first_download_title')&&document.querySelector('#modal').textContent.includes('C:/Downloads/Transfer fixture')`);
    await shot(`${name}-desktop-download-live-language`);
    await choose('common:actions.cancel');
    await execute(`await window.__sftpTransferFixture.pending;await setTermaLanguage('${language}',{render:false});`);
    await check(`${name} cancelled desktop notice does not queue or remember download`, `window.__sftpTransferFixture.requests.filter(r=>r.url.endsWith('/download')).length===0&&localStorage.getItem('sftpDesktopDownloadNoticeV1')!=='1'`);
    await execute(`const c=window.__sftpTransferFixture;c.pending=window.termaSftpTransfers.controller.download(7,'/var/data/desktop.txt');await new Promise(resolve=>setTimeout(resolve,40));`);
    await choose('sftp:transfer.continue_download');
    await execute(`await window.__sftpTransferFixture.pending;const c=window.__sftpTransferFixture;c.reset();await window.termaSftpTransfers.directories(7,'/var/data',[{file:new File(['fixture!'],'leaf.txt'),relativePath:'parent/nested/leaf.txt'}],['parent/empty'],window.termaSftpTransfers.target(c.key,7,'/var/data'));`);
    await check(`${name} upload directory preparation uses deduplicated parent-first TS service`, `JSON.stringify(window.__sftpTransferFixture.requests.filter(r=>r.url.endsWith('/mkdir')).map(r=>r.body.path))===JSON.stringify(['/var/data/parent','/var/data/parent/nested','/var/data/parent/empty'])`);
    await execute(`const c=window.__sftpTransferFixture;c.reset();c.clearBefore=c.cleared||0;c.pending=window.termaSftpTransfers.controller.desktop(c.key);await new Promise(resolve=>setTimeout(resolve,10));c.selected=[{path:'/var/data/new-selection.txt',type:'file'}];c.finishDelivery();await c.pending;`);
    await check(`${name} native delivery preserves a later selection`, `(()=>{const c=window.__sftpTransferFixture;return c.desktopDelivery.id===7&&c.desktopDelivery.paths[0]==='/var/data/fixture.txt'&&(c.cleared||0)===c.clearBefore})()`);
  }
  await execute(`const c=window.__sftpTransferFixture;c.reset();c.mode='ok';c.beginUpload();await new Promise(resolve=>setTimeout(resolve,40));c.bodies[0].done();await c.pending;`);
  await check('successful upload releases transport and tracks completion', `(()=>{const c=window.__sftpTransferFixture;return !window.termaSftpTaskWorkspace.state.uploads.has(c.jobs[0].id)&&c.jobs[0].status==='done'})()`);
  await execute(`const c=window.__sftpTransferFixture;c.reset();c.mode='ok';const entry={name:'late.txt',isFile:true,file:resolve=>{c.finishCollection=()=>resolve(new File(['late'],'late.txt'))}};c.pending=window.termaSftpDragWorkspace.events.drop({dataTransfer:{types:['Files'],items:[{kind:'file',webkitGetAsEntry:()=>entry}]},preventDefault(){},stopPropagation(){}},c.key);await new Promise(resolve=>setTimeout(resolve,10));c.runtime.state.path='/changed-during-collection';c.finishCollection();await c.pending;`);
  await check('external drop cancels when the original directory changes during file collection',`window.__sftpTransferFixture.requests.length===0&&window.__sftpTransferFixture.bodies.length===0`);
  await execute(`
    const c=window.__sftpTransferFixture;closeModal();window.termaSftpTaskWorkspace.runtime.close();
    for(const job of c.jobs)window.termaSftpTaskWorkspace.state.pendingDownloads.delete(job.id);
    api=c.original.api;notify=c.original.notify;window.termaSftpTransferLifecycle.completion.track=c.original.trackSftpMutationJob;window.termaSftpTaskWorkspace.runtime.refresh=c.original.refreshSftpJobs;window.termaSftpTaskWorkspace.runtime.stale=c.original.refreshSftpJobsIfStale;window.termaSftpTransferLifecycle.polling.start=c.original.startPolling;
    window.termaSftpViews.selectedEntries=c.original.selectedEntries;window.termaSftpViews.selectedPaths=c.original.selectedPaths;window.termaFileTransferRuntime.desktop=c.original.desktop;window.termaSftpViews.clearSelection=c.original.clearSelection;window.XMLHttpRequest=c.original.xhr;window.termaSftpTaskWorkspace.state.jobs=c.original.jobs;window.termaSftpTaskWorkspace.state.view=c.original.view;
    if(c.notice===null)localStorage.removeItem('sftpBrowserDownloadNoticeV1');else localStorage.setItem('sftpBrowserDownloadNoticeV1',c.notice);
    if(c.desktopNotice===null)localStorage.removeItem('sftpDesktopDownloadNoticeV1');else localStorage.setItem('sftpDesktopDownloadNoticeV1',c.desktopNotice);
    c.centerParent.insertBefore(c.center,c.centerNext);if(c.centerStyle===null)c.center.removeAttribute('style');else c.center.setAttribute('style',c.centerStyle);
    tabs.splice(tabs.indexOf(c.tab),1);sftpTabRuntimes.delete(c.key);window.termaSftpTaskWorkspace.state.paint();if(c.original.polling)window.termaSftpTransferLifecycle.polling.start();delete window.__sftpTransferFixture;
  `);
}
module.exports = { runSftpTransferUiScenario };
