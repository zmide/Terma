async function runSftpCopyUiScenario({ browser, execute, check, shot }) {
  await execute(`
    const f=window.__sftpVueFixture;
    window.__sftpCopyFixture={api,notify,trackSftpMutationJob:window.termaSftpTransferLifecycle.completion.track,refreshSftpJobs:window.termaSftpTaskWorkspace.runtime.refresh,refreshView:window.termaSftpViews.refresh,clipboard:window.termaSftpFileActions.clipboard.value,run:f.options.run,refreshes:0,jobs:[],requests:[],state:'conflict'};
    const c=window.__sftpCopyFixture;c.target={key:f.key,kind:'sftp',id:7,title:'Target fixture',path:'/var/data'};
    c.source={key:f.key+'-copy-source',kind:'sftp',id:8,title:'Source fixture',path:'/source'};
    tabs.push(c.target,c.source);
    c.runtime={tabKey:f.key,connectionId:7,state:{...f.options.model.state,connectionId:7}};
    c.sourceRuntime={tabKey:c.source.key,connectionId:8,state:{path:'/source',connectionId:8,entries:[{name:'fixture.txt',type:'file',size:5}]}};
    sftpTabRuntimes.set(f.key,c.runtime);sftpTabRuntimes.set(c.source.key,c.sourceRuntime);
    c.sync=()=>{const q=window.termaSftpFileActions.clipboard.value,m=f.options.model,pending=window.termaSftpFileActions.copy.isPending(f.key);m.clipboard=q?{count:q.paths.length,moving:q.mode==='move',source:q.connectionName,matches:q.connectionId===7,pending,canPaste:(q.connectionId===7||q.mode==='copy')&&!pending}:null;window.termaSftpViews.refresh(f.key,f.options,'toolbar')};
    notify=(message,type)=>{c.lastNotice={message,type}};
    window.termaSftpViews.refresh=(key,options,part,...args)=>{
      if(key===f.key&&options!==f.options&&['toolbar','favorites'].includes(part)){if(part==='toolbar')c.sync();return true;}
      return c.refreshView(key,options,part,...args);
    };
    window.termaSftpTransferLifecycle.completion.track=job=>c.jobs.push(job);window.termaSftpTaskWorkspace.runtime.refresh=()=>{c.refreshes++};
    api=async(url,options)=>{if(![7,8].some(id=>['upload-plan','cross-copy','copy','move'].some(action=>url==='/api/connections/'+id+'/sftp/'+action)))return c.api(url,options);const body=JSON.parse(options?.body||'{}');c.requests.push({url,body});
      if(url.endsWith('/sftp/upload-plan'))return {items:[{name:'fixture.txt',exists:c.state==='conflict'}]};
      if(['cross-copy','copy','move'].some(action=>url.endsWith('/sftp/'+action))){
        if(c.state==='error')throw new Error('fixture-copy-denied');
        if(c.state==='pending')return new Promise(resolve=>{c.finish=()=>resolve({id:'fixture-copy-job'})});
        return {id:'fixture-copy-job'};
      }
      throw new Error('Unexpected fixture request: '+url);
    };
    f.options.run=(action,...args)=>action==='paste'?(c.pending=window.termaSftpFileActions.operations.paste(f.key)):action==='cancelClipboard'?window.termaSftpFileActions.cancel():c.run(action,...args);
  `);
  for (const theme of ['light','dark']) for (const language of ['zh-CN','en-US']) {
    const name=`copy-${language}-${theme}`;
    await execute(`applyTheme('${theme}');await setTermaLanguage('${language}',{render:false});const c=window.__sftpCopyFixture,f=window.__sftpVueFixture;window.termaSftpViews.refresh(f.key,f.options);c.state='conflict';window.termaSftpFileActions.copyEntry(c.source.key, '/source/fixture.txt', 'copy');`);
    await check(`${name} queue uses migrated buttons`, `(()=>{const root=document.querySelector('#sftpClipboardActions');return root.textContent.includes(tr('sftp:clipboard.copy_queue',{count:1}))&&root.querySelectorAll('[data-terma-button]').length===2&&!root.querySelector('button.primary').disabled})()`);
    await shot(`${name}-queue`);
    const point=await execute(`const button=document.querySelector('#sftpClipboardActions button:not(.primary)');button.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const r=button.getBoundingClientRect(),point={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};if(document.elementFromPoint(point.x,point.y)?.closest('button')!==button)throw new Error('Clipboard cancel button is covered');return point;`);
    for(const type of ['mouseMove','mouseDown','mouseUp'])browser.webContents.sendInputEvent({type,...point,button:'left',clickCount:1});
    await execute(`await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`);
    await check(`${name} pointer cancellation clears the queue and refreshes the toolbar`, `window.termaSftpFileActions.clipboard.value===null&&!document.querySelector('#sftpClipboardActions')?.querySelector('button')&&!document.querySelector('#sftpClipboardActions')?.textContent.trim()&&window.__sftpCopyFixture.lastNotice?.message===tr('sftp:clipboard.cancelled')`);
    await shot(`${name}-queue-cancelled`);
    await execute(`const c=window.__sftpCopyFixture;window.termaSftpFileActions.copyEntry(c.source.key, '/source/fixture.txt', 'copy');`);
    await execute(`document.querySelector('#sftpClipboardActions button.primary').click();await new Promise(resolve=>setTimeout(resolve,60));`);
    await check(`${name} conflict choice is Vue and safe`, `(()=>{const modal=document.getElementById('modal'),card=modal.querySelector('[role=dialog]')||modal.querySelector('.modal-card');return !modal.hidden&&!!card&&modal.textContent.includes('fixture.txt')&&modal.querySelectorAll('[data-terma-button]').length===3&&card.scrollWidth<=card.clientWidth+1})()`);
    await check(`${name} all conflict actions fit without clipping`, `(()=>{const card=document.querySelector('#modal .modal-card'),r=card.getBoundingClientRect();return [...card.querySelectorAll('button')].every(button=>{const b=button.getBoundingClientRect();return b.left>=r.left&&b.left>=0&&b.right<=Math.min(r.right,innerWidth)&&b.bottom<=Math.min(r.bottom,innerHeight)&&button.scrollWidth<=button.clientWidth+1})})()`);
    await shot(`${name}-conflict`);
    await execute(`const button=[...document.querySelectorAll('#modal button')].find(b=>b.textContent.includes(tr('sftp:transfer.auto_rename')));button.focus();window.__sftpCopyFixture.conflictButton=button;await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}',{render:false});const f=window.__sftpVueFixture;window.termaSftpViews.refresh(f.key,f.options);`);
    await check(`${name} open conflict updates all fixed text and focus`, `(()=>{const modal=document.getElementById('modal'),button=window.__sftpCopyFixture.conflictButton;return modal.querySelector('h2').textContent===tr('sftp:operations.target_same_name')&&button.textContent.includes(tr('sftp:transfer.auto_rename'))&&document.activeElement===button&&modal.textContent.includes(tr('sftp:transfer.overwrite_same_name'))&&modal.textContent.includes(tr('common:actions.cancel'))})()`);
    await shot(`${name}-conflict-live-language`);
    await execute(`await setTermaLanguage('${language}',{render:false});const b=[...document.querySelectorAll('#modal button')].find(b=>b.textContent.includes(tr('common:actions.cancel')));b.click();await window.__sftpCopyFixture.pending;`);
    await check(`${name} cancel retains queue without transfer`, `window.termaSftpFileActions.clipboard.value?.paths[0]==='/source/fixture.txt'&&!window.termaSftpFileActions.copy.isPending(window.__sftpVueFixture.key)`);
    await execute(`const c=window.__sftpCopyFixture;c.pending=window.termaSftpFileActions.operations.paste(c.target.key);await new Promise(resolve=>setTimeout(resolve,40));[...document.querySelectorAll('#modal button')].find(b=>b.textContent.includes(tr('sftp:transfer.auto_rename'))).click();await c.pending;`);
    await check(`${name} cross-host rename sends the captured target`, `(()=>{const c=window.__sftpCopyFixture,r=c.requests.filter(r=>r.url.endsWith('/sftp/cross-copy')).at(-1);return r?.url==='/api/connections/8/sftp/cross-copy'&&r.body.target_connection_id===7&&r.body.target==='/var/data'&&r.body.conflict==='rename'&&window.termaSftpFileActions.clipboard.value===null})()`);
    await execute(`const c=window.__sftpCopyFixture;window.termaSftpFileActions.copyEntry(c.source.key, '/source/fixture.txt', 'move');`);
    await check(`${name} cross-host move stays disabled`, `document.querySelector('#sftpClipboardActions button.primary').disabled&&document.querySelector('#sftpClipboardActions').textContent.includes(tr('sftp:clipboard.move_queue',{count:1}))`);
    await shot(`${name}-move-disabled`);
    await execute(`const c=window.__sftpCopyFixture;window.termaSftpFileActions.copyEntry(c.target.key, '/var/data/fixture.txt', 'move');await window.termaSftpFileActions.operations.paste(c.target.key);`);
    await check(`${name} same-host move retains endpoint and background job`, `(()=>{const c=window.__sftpCopyFixture,r=c.requests.at(-1);if(r.url!=='/api/connections/7/sftp/move'||r.body.target!=='/var/data'||r.body.background!==true||window.termaSftpFileActions.clipboard.value!==null)throw new Error(JSON.stringify({requests:c.requests,clipboard:window.termaSftpFileActions.clipboard.value,path:c.runtime.state.path,notice:c.lastNotice}));return true})()`);
  }
  await execute(`const c=window.__sftpCopyFixture;c.state='pending';window.termaSftpFileActions.copyEntry(c.source.key, '/source/fixture.txt', 'copy');c.pending=window.termaSftpFileActions.operations.paste(c.target.key);await new Promise(resolve=>setTimeout(resolve,50));`);
  await check('copy busy disables repeat paste', `document.querySelector('#sftpClipboardActions button.primary').disabled&&document.querySelector('#sftpClipboardActions button.primary').getAttribute('aria-busy')==='true'`);
  await shot('copy-pending');
  await execute(`const c=window.__sftpCopyFixture;c.before=c.requests.length;await window.termaSftpFileActions.operations.paste(c.target.key);window.termaSftpFileActions.copyEntry(c.source.key, '/source/next.txt', 'copy');c.finish();await c.pending;`);
  await check('copy completion preserves new queue and does not duplicate request', `window.termaSftpFileActions.clipboard.value.paths[0]==='/source/next.txt'&&window.__sftpCopyFixture.requests.length===window.__sftpCopyFixture.before`);
  await execute(`const c=window.__sftpCopyFixture;c.state='error';await window.termaSftpFileActions.operations.paste(c.target.key);`);
  await check('copy error retains queue and unlocks retry', `window.termaSftpFileActions.clipboard.value.paths[0]==='/source/next.txt'&&!window.termaSftpFileActions.copy.isPending(window.__sftpVueFixture.key)&&!document.querySelector('#sftpClipboardActions button.primary').disabled&&window.__sftpCopyFixture.lastNotice.type==='error'`);
  await shot('copy-error-retry');
  for (const change of ['directory', 'runtime', 'closed']) {
    await execute(`const c=window.__sftpCopyFixture;c.state='conflict';window.termaSftpFileActions.copyEntry(c.source.key, '/source/fixture.txt', 'copy');c.before=c.requests.filter(r=>r.url.endsWith('/sftp/cross-copy')).length;c.pending=window.termaSftpFileActions.operations.paste(c.target.key);await new Promise(resolve=>setTimeout(resolve,40));
      if('${change}'==='directory')c.runtime.state.path='/changed-during-confirmation';
      if('${change}'==='runtime')sftpTabRuntimes.set(c.target.key,{...c.runtime});
      if('${change}'==='closed')tabs.splice(tabs.indexOf(c.target),1);
      [...document.querySelectorAll('#modal button')].find(b=>b.textContent.includes(tr('sftp:transfer.auto_rename'))).click();await c.pending;`);
    await check(`copy ${change} during confirmation cancels stale destination`, `(()=>{const c=window.__sftpCopyFixture;return c.requests.filter(r=>r.url.endsWith('/sftp/cross-copy')).length===c.before&&window.termaSftpFileActions.clipboard.value.paths[0]==='/source/fixture.txt'&&!window.termaSftpFileActions.copy.isPending(c.target.key)})()`);
    await execute(`const c=window.__sftpCopyFixture;c.runtime.state.path='/var/data';sftpTabRuntimes.set(c.target.key,c.runtime);if(!tabs.includes(c.target))tabs.push(c.target);`);
  }
  await execute(`
    const c=window.__sftpCopyFixture,f=window.__sftpVueFixture;
    api=c.api;notify=c.notify;window.termaSftpTransferLifecycle.completion.track=c.trackSftpMutationJob;window.termaSftpTaskWorkspace.runtime.refresh=c.refreshSftpJobs;window.termaSftpViews.refresh=c.refreshView;window.termaSftpFileActions.clipboard.value=c.clipboard;f.options.run=c.run;
    tabs.splice(tabs.indexOf(c.target),1);tabs.splice(tabs.indexOf(c.source),1);sftpTabRuntimes.delete(c.target.key);sftpTabRuntimes.delete(c.source.key);
    f.options.model.clipboard={count:2,moving:false,source:'fixture',matches:false,canPaste:true};window.termaSftpViews.refresh(f.key,f.options,'toolbar');delete window.__sftpCopyFixture;
  `);
}
module.exports={runSftpCopyUiScenario};
