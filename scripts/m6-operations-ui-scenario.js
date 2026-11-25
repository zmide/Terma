const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createExternalEditBrowserFixture}=require('./external-edit-browser-fixture');

// Real Chromium, production entry points and Vue views. All native operations
// and writes are isolated fixtures; this is development QA, not device acceptance.
async function runM6OperationsUiScenario(browser,{viewport='desktop'}={}){
  const directory=path.join(process.env.TERMA_M6_VISUAL_DIR||path.join(process.cwd(),'data/m6-operations-visual'),viewport);fs.mkdirSync(directory,{recursive:true});
  const execute=source=>browser.webContents.executeJavaScript(`(async()=>{${source}})()`);
  const reports=[];let screenshots=0,checks=0;const watchedFiles=createExternalEditBrowserFixture();
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const check=async(name,expression)=>{const result=await execute(`return !!(${expression});`);reports.push({name,result});assert.equal(result,true,viewport+' '+name);checks++;};
  const wait=async expression=>{for(let i=0;i<440;i++){if(await execute(`return !!(${expression});`))return;await delay(25);}throw Error('M6 UI wait: '+expression);};
  const shot=async name=>{
    await execute('await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));');await delay(60);browser.webContents.invalidate();
    fs.writeFileSync(path.join(directory,name+'.png'),(await browser.webContents.capturePage()).toPNG());screenshots++;
    await check(name+' modal fits viewport',`(()=>{const node=document.querySelector('#modal .modal-card');if(!node)return false;const r=node.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1&&node.scrollWidth<=node.clientWidth+1;})()`);
    await check(name+' text is escaped',`!document.querySelector('#modal img[src=x],#modal [onerror]')`);
    await check(name+' controls stay visible',`[...document.querySelectorAll('#modal button')].filter(n=>n.checkVisibility()).every(n=>{const r=n.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})`);
    await check(name+' modal centered and flat',`(()=>{const node=document.querySelector('#modal .modal-card'),r=node.getBoundingClientRect(),style=getComputedStyle(node);return Math.abs((r.left+r.right)/2-innerWidth/2)<=2&&style.boxShadow==='none'&&style.backgroundImage==='none';})()`);
  };
  const click=async selector=>{
    const point=await execute(`const node=document.querySelector(${JSON.stringify(selector)});if(!node?.checkVisibility()||node.disabled)throw Error('Unavailable M6 control: '+${JSON.stringify(selector)});node.scrollIntoView({block:'nearest',inline:'nearest'});await new Promise(resolve=>requestAnimationFrame(resolve));const r=node.getBoundingClientRect(),point={x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};if(!node.contains(document.elementFromPoint(point.x,point.y)))throw Error('Covered M6 control: '+${JSON.stringify(selector)});return point;`);
    browser.webContents.sendInputEvent({type:'mouseMove',...point});browser.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});browser.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});await delay(70);
  };
  await execute(`await window.termaI18nReady;while(window.workspaceRestorePending)await new Promise(resolve=>setTimeout(resolve,20));closeModal();window.termaWorkspaceRefresh.stop();window.termaEfficiency.palette.close();window.termaSftpTaskWorkspace.runtime.close();
    const tasks=window.termaSftpTaskWorkspace.runtime;
    window.__m6={api,desktop:window.termaDesktop,requests:[],sessions:[],listMode:'pending',executeMode:'error',tasks:0,taskOpen:tasks.open};
    const f=window.__m6;
    tasks.open=(...args)=>{f.tasks++;return f.taskOpen(...args);};
    const syncTab={key:'fixture-tab',kind:'sftp',id:7,path:'/review'};
    tabs.push(syncTab);f.syncTab=syncTab;
    const style=document.createElement('style');style.id='m6-fixture-notices';style.textContent='#toast,#notice{display:none!important}';document.head.append(style);
    window.termaDesktop={...(window.termaDesktop||{})};
    f.plan={id:'fixture-plan',local_path:'C:/Review/folder <img src=x>',remote_path:'/review/directory <img src=x>',totals:{upload:1,download:1,conflict:1},actions:[
      {index:0,action:'upload',relative:'nested/long-name <img src=x>.txt',reason:'远程缺少文件',selected:true,local_size:1024,remote_size:null},
      {index:1,action:'download',relative:'remote.txt',reason:'本地缺少文件',selected:true,local_size:null,remote_size:2048},
      {index:2,action:'conflict',relative:'changed.txt',reason:'两端内容不同',selected:true,local_size:4096,remote_size:5120}]};
    api=async(url,options)=>{f.requests.push({url,body:options?.body});
      if(url==='/api/sftp/sync/choose-directory')return {path:f.plan.local_path};
      if(url==='/api/connections/7/sftp/sync/plan'){
        await new Promise(resolve=>f.finishPlan=resolve);return {id:'scan',status:'completed',plan_result:f.plan};
      }
      if(url==='/api/connections/7/sftp/sync/execute'){
        if(f.executeMode==='error')throw Error('Review execute error <img src=x>');
        await new Promise(resolve=>f.finishExecute=resolve);return {id:'execute',status:'running',total:3};
      }
      if(url==='/api/connections/7/sftp/external-edit')return {...f.watched};
      if(f.watched&&url==='/api/sftp/external-edits/'+encodeURIComponent(f.watched.id)){
        f.watchPolls++;return {...f.watched};
      }
      if(f.watched&&url==='/api/sftp/external-edits/'+encodeURIComponent(f.watched.id)+'/resolve'){
        f.watchResolves++;f.watched.status='watching';return {...f.watched};
      }
      if(url==='/api/sftp/external-edits'){if(f.listMode==='pending')await new Promise(resolve=>f.finishList=resolve);if(f.listMode==='error')throw Error('Review list error <img src=x>');return f.sessions;}
      if(url.startsWith('/api/sftp/external-edits/')){if(options?.method==='DELETE'){if(f.stopMode==='pending')await new Promise(resolve=>f.finishStop=resolve);if(f.stopMode==='error')throw Error('Review stop error <img src=x>');f.sessions=[];return{};}if(url.endsWith('/comparison'))return {old_text:'Original line\\nRemote content <img src=x>\\n',new_text:'Edited line\\nLocal content <img src=x>\\n',old_size:64,new_size:65,remote_path:'/review/notes.txt'};return {id:'edit-fixture',status:'modified',connection_id:7,connection_name:'Review host',remote_path:'/review/notes.txt',local_path:'C:/Review/notes.txt',can_compare:true};}
      return f.api(url,options);
    };
    f.sync=window.termaSftpWorkflow.sync;
    f.beginWatch=async session=>{
      f.watched=session;f.watchPolls=0;f.watchResolves=0;
      // Deliberately use the real browser timers, not the injectable unit clock.
      f.watchService=window.termaSftpWorkflow.externalEdit();
      f.watchOpened=await f.watchService.open(7,f.watched.remote_path);
      f.watchService.start(session.id); // Replacing a scheduled timer also exercises clearTimeout.
    };
  `);
  try{
    for(const theme of ['light','dark'])for(const language of ['zh-CN','en-US']){
      const name=language+'-'+theme,opposite=language==='zh-CN'?'en-US':'zh-CN';
      const watchedSession=await watchedFiles.open();
      await execute(`closeModal();applyTheme('${theme}');await setTermaLanguage('${language}',{render:false});await window.__m6.beginWatch(${JSON.stringify(watchedSession)});`);
      await check(name+' native timer launch succeeds',`window.__m6.watchOpened&&$('modal').hidden`);
      watchedFiles.save(watchedSession.id,'first external save\n');
      await execute(`window.__m6.watched=${JSON.stringify(await watchedFiles.modified(watchedSession.id))};`);
      await wait(`document.querySelector('#modal [data-choice="3"]')`);
      await check(name+' native polling discovers external save',`window.__m6.watchPolls>0&&document.querySelector('#modal h2').textContent===tr('sftp:external_edit.modified_title')`);
      await shot(name+'-external-polled-save');await click('#modal [data-choice="3"]');await wait(`window.__m6.watchResolves===1`);
      await execute(`window.__m6.watched=${JSON.stringify(await watchedFiles.postpone(watchedSession.id))};window.__m6.holding=inputModal('Review draft','Draft','retain this input');`);
      watchedFiles.save(watchedSession.id,'second external save\n');
      await execute(`window.__m6.watched=${JSON.stringify(await watchedFiles.modified(watchedSession.id))};`);
      await wait(`window.__m6.watchService.pending()===1`);
      await check(name+' polled save retains another modal draft',`document.querySelector('#modalInputValue')?.value==='retain this input'`);
      await click('#modalCancelBtn');await wait(`document.querySelector('#modal [data-choice="3"]')`);await shot(name+'-external-deferred-save');
      await click('#modal [data-choice="3"]');await wait(`window.__m6.watchResolves===2`);
      await execute(`window.__m6.watchService.stopPolling(window.__m6.watched.id);window.__m6.stoppedWatchPolls=window.__m6.watchPolls;`);
      await watchedFiles.postpone(watchedSession.id);assert.equal(watchedFiles.writes(),0,'No remote upload before confirmation');checks++;
      await execute(`closeModal();applyTheme('${theme}');await setTermaLanguage('${opposite}',{render:false});window.__m6.listMode='pending';window.__m6.sessions=[];window.__m6.manager=window.termaSftpWorkflow.externalManager();`);
      await execute(`await setTermaLanguage('${language}',{render:false});`);
      await shot(name+'-manager-loading');
      await check(name+' manager live language',`document.querySelector('.operations-head h2').textContent===tr('sftp:external_edit.manager_title')`);
      await execute(`window.__m6.listMode='error';window.__m6.finishList();await window.__m6.manager;`);await shot(name+'-manager-error');
      await execute(`window.__m6.listMode='normal';`);await click('.operations-toolbar button');await shot(name+'-manager-empty');
      await execute(`window.__m6.sessions=[{id:'edit-fixture',status:'modified',connection_id:7,connection_name:'Review host',remote_path:'/review/a very long file name <img src=x>.txt',local_path:'C:/Review/a very long file name <img src=x>.txt'}];window.__m6.stopMode='error';`);
      await click('.operations-toolbar button');await shot(name+'-manager-session');
      await click('.operations-session .primary');await wait(`document.querySelector('#modal [data-choice="0"]')`);await shot(name+'-external-modified');
      await click('#modal [data-choice="0"]');await wait(`document.querySelector('#sftpVueCompareTitle')`);
      await execute(`await setTermaLanguage('${opposite}',{render:false});await setTermaLanguage('${language}',{render:false});`);await shot(name+'-external-comparison');
      await click('#modal [data-focus-key="save-as"]');await wait(`document.querySelector('#modalInputValue')`);
      await execute(`const input=document.querySelector('#modalInputValue');input.value='/review/renamed draft.txt';input.dispatchEvent(new Event('input',{bubbles:true}));await setTermaLanguage('${opposite}',{render:false});await setTermaLanguage('${language}',{render:false});`);
      await check(name+' save-as draft survives language',`document.querySelector('#modalInputValue').value==='/review/renamed draft.txt'`);await shot(name+'-external-save-as');await click('#modalCancelBtn');
      await execute(`await window.termaSftpWorkflow.externalManager();`);await click('.operations-session .danger');await shot(name+'-manager-stop-error');
      await execute(`window.__m6.stopMode='pending';`);await click('.operations-session .danger');await shot(name+'-manager-stopping');
      await check(name+' stop is busy',`document.querySelector('.operations-session .danger').disabled`);
      await execute(`window.__m6.stopMode='normal';window.__m6.finishStop();`);await wait(`!document.querySelector('.operations-session')`);
      await execute(`closeModal();await setTermaLanguage('${opposite}',{render:false});await window.__m6.sync.open(7,'/review','fixture-tab');`);
      await click('#sftpSyncExcludes');browser.webContents.insertText('draft/**/*.log');await delay(30);
      await execute(`document.querySelector('#sftpSyncExcludes').setSelectionRange(2,7);await setTermaLanguage('${language}',{render:false});`);
      await check(name+' sync live draft and caret',`document.querySelector('#sftpSyncExcludes').value==='draft/**/*.log'&&document.activeElement.id==='sftpSyncExcludes'&&document.activeElement.selectionStart===2&&document.activeElement.selectionEnd===7`);
      await check(name+' sync live language',`document.querySelector('.operations-head h2').textContent===tr('sftp:sync.title')`);
      await shot(name+'-sync-options');await click('#sftpSyncCompare');await shot(name+'-sync-scanning');
      await execute(`window.__m6.finishPlan();`);await wait(`document.querySelector('#sftpSyncExecute')`);
      await check(name+' conflict starts unselected',`document.querySelectorAll('.sftp-sync-plan-check')[2].disabled&&!document.querySelectorAll('.sftp-sync-plan-check')[2].checked`);
      await execute(`const node=document.querySelector('.sftp-sync-conflict-direction');node.value='download';node.dispatchEvent(new Event('change',{bubbles:true}));`);
      await shot(name+'-sync-plan');await click('#sftpSyncExecute');await shot(name+'-sync-execute-error');
      await check(name+' execute error keeps selections',`window.__m6.sync.model().selected.size===3&&window.__m6.sync.model().overrides.get(2)==='download'&&!window.__m6.sync.model().busy`);
      await execute(`window.__m6.executeMode='pending';`);await click('#sftpSyncExecute');await shot(name+'-sync-starting');
      await check(name+' execute is busy',`document.querySelector('#sftpSyncExecute').disabled`);
      await execute(`closeModal();window.__m6.replacement=inputModal(()=>tr('common:actions.rename'),()=>tr('sftp:sync.remote_directory'),'keep this draft');window.__m6.finishExecute();`);
      await wait(`document.querySelector('#modalInputValue')`);await check(name+' late execution retains new modal',`document.querySelector('#modalInputValue').value==='keep this draft'&&!window.__m6.tasks`);
      await click('#modalCancelBtn');
      await execute(`const s={id:'edit-prompt-${theme}-${language}',status:'conflict',connection_id:7,connection_name:'Review host',remote_path:'/review/notes.txt',local_path:'C:/Review/notes.txt',can_compare:true};window.__m6.prompt=window.termaSftpWorkflow.externalEdit().prompt(s,true);`);
      await shot(name+'-external-conflict');
      await check(name+' conflict dialog live language',`document.querySelector('#modal h2').textContent===tr('sftp:external_edit.conflict_title')`);
      await execute(`closeModal();await window.__m6.prompt;window.__m6.executeMode='error';`);
      await check(name+' flat operations surface',`getComputedStyle(document.querySelector('.workspace')||document.body).backgroundImage==='none'`);
      await check(name+' stopping cancels native polling',`window.__m6.watchPolls===window.__m6.stoppedWatchPolls`);
    }
  }finally{
    watchedFiles.dispose();
    fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(reports,null,2));
    await execute(`const f=window.__m6;
      if(f.watched)f.watchService?.stopPolling(f.watched.id);
      tabs=tabs.filter(tab=>tab!==f.syncTab);closeModal();api=f.api;window.termaDesktop=f.desktop;
      window.termaSftpTaskWorkspace.runtime.open=f.taskOpen;
      document.getElementById('m6-fixture-notices')?.remove();delete window.__m6;`);
  }
  return {scenario:'m6-operations',viewport,checks,screenshots,directory};
}
module.exports={runM6OperationsUiScenario};
