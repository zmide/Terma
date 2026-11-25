const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

function backgroundChannels(element){
  const color=getComputedStyle(element).backgroundColor;
  const channels=[...color.matchAll(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)].map(match=>Number(match[0])).slice(0,3);
  return color.startsWith('color(srgb ')?channels.map(value=>value*255):channels;
}

async function runM6AutomationsUiScenario(browser,{viewport='desktop'}={}){
  const directory=path.join(process.env.TERMA_AUTOMATIONS_VISUAL_DIR||path.join(process.cwd(),'data/m6-automations-ui'),viewport);fs.mkdirSync(directory,{recursive:true});
  const execute=source=>browser.webContents.executeJavaScript(`(async()=>{${source}})()`),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const reports=[];let checks=0,screenshots=0;
  const check=async(name,expression)=>{
    const passed=await execute(`return !!(${expression});`);reports.push({name,passed});
    if(!passed&&name.includes('invalid date'))console.error('[automation invalid-date diagnostic]',await execute(`const f=window.__automationFixture,s=window.termaSftpWorkflow.automation.model();return {before:f.dateRequests,after:f.requests.length,requests:f.requests.slice(f.dateRequests),error:s.error,alert:document.querySelector('#modal [role="alert"]')?.textContent,expected:tr('sftp:automation.invalid_start'),draft:s.draft,active:document.activeElement?.id};`));
    assert.equal(passed,true,viewport+' '+name);checks++;
  };
  const wait=async expression=>{for(let i=0;i<250;i++){if(await execute(`return !!(${expression});`))return;await delay(30);}throw Error('Automation UI wait: '+expression);};
  const click=async selector=>{
    const point=await execute(`const node=document.querySelector(${JSON.stringify(selector)});if(!node?.checkVisibility()||node.disabled||node.closest('[inert]'))throw Error('Unavailable control '+${JSON.stringify(selector)});node.scrollIntoView({block:'nearest',inline:'nearest'});await new Promise(resolve=>requestAnimationFrame(resolve));const r=node.getBoundingClientRect(),p={x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};if(!node.contains(document.elementFromPoint(p.x,p.y)))throw Error('Covered control '+${JSON.stringify(selector)});return p;`);
    for(const type of ['mouseMove','mouseDown','mouseUp'])browser.webContents.sendInputEvent({type,button:'left',clickCount:1,...point});await delay(65);
  };
  const shot=async name=>{
    await execute('await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));');await delay(40);browser.webContents.invalidate();fs.writeFileSync(path.join(directory,name+'.png'),(await browser.webContents.capturePage()).toPNG());screenshots++;
    await check(name+' viewport and flat surface',`(()=>{const node=document.querySelector('#modal .automation-modal');if(!node)return false;const r=node.getBoundingClientRect(),s=getComputedStyle(node);return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&node.scrollWidth<=node.clientWidth+1&&s.boxShadow==='none'&&s.backgroundImage==='none'&&Math.abs((r.left+r.right)/2-innerWidth/2)<2;})()`);
    await check(name+' no markup injection',`!document.querySelector('#modal img[src=x],#modal [onerror]')&&!document.querySelector('#modal').textContent.includes('[object Object]')`);
    await check(name+' visible button bounds',`[...document.querySelectorAll('#modal button')].filter(node=>{if(!node.checkVisibility()||node.closest('[inert]'))return false;const r=node.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight)return false;for(let p=node.parentElement;p&&p.id!=='modal';p=p.parentElement){const s=getComputedStyle(p);if(['auto','hidden','scroll'].includes(s.overflowY)){const q=p.getBoundingClientRect();if(r.top<q.top||r.bottom>q.bottom)return false;}}return true;}).every(node=>{const r=node.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1;})`);
    await check(name+' translated attributes and hidden DOM',`document.documentElement.lang!=='en-US'||(()=>{const host=document.querySelector('#modal'),nodes=[host,...host.querySelectorAll('*')],walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT);while(walker.nextNode())if(/[\u3400-\u9fff]/.test(walker.currentNode.textContent))return false;return nodes.every(node=>['title','aria-label','placeholder'].every(key=>!/[\u3400-\u9fff]/.test(node.getAttribute(key)||'')));})()`);
  };
  await execute(`await window.termaI18nReady;while(window.workspaceRestorePending||window.termaWorkspaceRefresh.loading)await new Promise(resolve=>setTimeout(resolve,20));window.termaWorkspaceRefresh.stop();closeModal();window.termaEfficiency.palette.close();window.termaSftpTaskWorkspace.runtime.close();
    window.__automationFixture={api,desktop:window.termaDesktop,requests:[],listMode:'normal',writeMode:'normal',directoryMode:'normal',historyMode:'normal',polls:0};const f=window.__automationFixture;
    const style=document.createElement('style');style.id='automation-fixture-notice';style.textContent='#toast,#notice,#sftpTaskFloat{display:none!important}';document.head.append(style);
    f.items=[{id:1,name:'Review sync <img src=x>',connection_id:7,connection_name:'Review host',local_path:'C:/Review/long folder name <img src=x>',remote_path:'/review/long folder name <img src=x>',direction:'bidirectional',enabled:true,kind:'sync',trigger_mode:'continuous',last_status:'running',last_run_at:1792840000,next_run_at:1792841000,schedule:{frequency:'realtime',interval:1},options:{notify:false,history_limit:300}},{id:2,name:'Review backup',connection_id:7,connection_name:'Review host',local_path:'C:/Review/backup',remote_path:'/review/backup',direction:'download',enabled:false,last_status:'paused',schedule:{frequency:'daily',interval:1},options:{}}];
    f.seedItems=structuredClone(f.items);
    f.runs=[{id:11,automation_id:1,status:'done',reason:'schedule',started_at:1792840000,finished_at:1792840010,summary:{transferred:2,deleted:1,skipped:1,conflicts:1,failed:1,details:[{action:'uploaded',path:'folder/a <img src=x>.txt'},{action:'downloaded',path:'folder/b.txt'},{action:'deleted_remote',path:'folder/c.txt'},{action:'skipped',path:'folder/d.txt',reason:'same_content'},{action:'conflict',path:'folder/e.txt',reason:'both_changed'},{action:'failed',path:'folder/f.txt',reason:'Review permission error'}]}},{id:12,automation_id:1,status:'failed',reason:'manual',started_at:1792841000,error:'Review history error <img src=x>',summary:{details:[]}}];
    api=async(url,options={})=>{f.requests.push({url,method:options.method||'GET',body:options.body});
      if(url==='/api/connections')return [{id:7,name:'Review host',group_name:'Review',ssh_host:'review.invalid',ssh_user:'review',ssh_port:22}];
      if(url==='/api/sftp/automations/context')return {default_path:'C:/Review'};
      if(url==='/api/sftp/automations'&&!options.method){f.polls++;if(f.listMode==='pending')await new Promise(resolve=>f.finishList=resolve);if(f.listMode==='error')throw Error('Review list error <img src=x>');return structuredClone(f.items);}
      if(url==='/api/sftp/automations/cron-preview'){if(f.cronMode==='pending')await new Promise(resolve=>f.finishCron=resolve);return {valid:options.body.includes('*/5'),next_runs:options.body.includes('*/5')?[Date.now()+60000,Date.now()+120000,Date.now()+180000]:[]};}
      if(url.includes('/runs')&&!options.method){if(f.historyMode==='error')throw Error('Review history load error');return {items:f.historyMode==='empty'?[]:structuredClone(f.runs),total:4,page:Number(new URL('http://review'+url).searchParams.get('page'))||1,total_pages:2,history_limit:300};}
      if(url.startsWith('/api/connections/7/sftp?')){if(f.directoryMode==='pending')await new Promise(resolve=>f.finishDirectory=resolve);if(f.directoryMode==='error')throw Error('Review directory error');const p=new URL('http://review'+url).searchParams.get('path');return {entries:p==='.'||p==='/'?[{name:'review <img src=x>',type:'dir'}]:[{name:'nested folder',type:'dir'}]};}
      if(url.startsWith('/api/server-files?')){if(f.directoryMode==='error')throw Error('Review server directory error');const p=new URL('http://review'+url).searchParams.get('path');return p?{path:p,display_path:'C:/Review'+(p.includes('/child')?'/child':''),parent:p.includes('/child')?'/authorized-root':'',entries:p.includes('/child')?[]:[{name:'child',type:'dir',path:'/authorized-root/child'}]}:{path:'',entries:[{name:'Review workspace',type:'drive',path:'/authorized-root'}]};}
      if(url.startsWith('/api/server-files/resolve'))return {path:'/authorized-root'};
      if(url.endsWith('/local-directory'))return {path:'/authorized-root'};
      if(options.method){if(f.writeMode==='pending')await new Promise(resolve=>f.finishWrite=resolve);if(f.writeMode==='error')throw Error('Review write error <img src=x>');if(url.endsWith('/run'))f.items[0].last_status='running';if(url.endsWith('/pause')){f.items[0].enabled=false;f.items[0].last_status='paused';}if(url.endsWith('/enable')){f.items[0].enabled=true;f.items[0].last_status='idle';}if(url==='/api/sftp/automations/reorder'){const ids=JSON.parse(options.body).ids;f.items=ids.map(id=>f.items.find(item=>item.id===id));}return {ok:true};}
      throw Error('Unexpected automation fixture request '+url);
    };window.termaDesktop=undefined;
  `);
  try{
    if(process.env.TERMA_AUTOMATIONS_SORT_PROBE==='1'){
      await execute(`await window.termaSftpWorkflow.automation.manager();document.addEventListener('keydown',event=>window.__automationFixture.key={key:event.key,target:event.target.tagName},true);`);
      await click('.automation-drag');const before=await execute(`return {active:document.activeElement.tagName,className:document.activeElement.className,sort:window.termaSftpWorkflow.automation.model().sortBusy,items:window.termaSftpWorkflow.automation.model().items.map(item=>item.id)};`);
      browser.webContents.sendInputEvent({type:'keyDown',keyCode:'DOWN'});await delay(200);
      return JSON.stringify({before,after:await execute(`return {active:document.activeElement.tagName,sort:window.termaSftpWorkflow.automation.model().sortBusy,key:window.__automationFixture.key,items:window.termaSftpWorkflow.automation.model().items.map(item=>item.id),requests:window.__automationFixture.requests};`)});
    }
    for(const theme of ['light','dark'])for(const language of ['zh-CN','en-US']){
      const prefix=language+'-'+theme,other=language==='zh-CN'?'en-US':'zh-CN';
      await execute(`closeModal();applyTheme('${theme}');await setTermaLanguage('${language}',{persist:false});const f=window.__automationFixture;f.items=structuredClone(f.seedItems);f.listMode='pending';f.writeMode='normal';f.directoryMode='normal';f.historyMode='normal';f.opening=window.termaSftpWorkflow.automation.manager();`);await shot(prefix+'-manager-loading');
      await execute(`window.__automationFixture.listMode='error';window.__automationFixture.finishList();await window.__automationFixture.opening;`);await shot(prefix+'-manager-error');
      await execute(`window.__automationFixture.listMode='normal';window.__automationFixture.savedItems=window.__automationFixture.items;window.__automationFixture.items=[];`);await click('#automationRefresh');await shot(prefix+'-manager-empty');
      await execute(`window.__automationFixture.items=window.__automationFixture.savedItems;`);await click('#automationRefresh');await shot(prefix+'-manager-rows');
      await check(prefix+' normal language entry updates workspace',`(()=>{const titles=[...document.querySelectorAll('[data-tab-key="welcome"] .tab-title,[data-tab-key="welcome"] .mobile-workspace-tab-title')];return titles.length>0&&titles.every(node=>node.textContent===tr('common:workspace.welcome_title',{defaultValue:'开始使用'}))&&!document.querySelector('#connectionGroups')?.textContent.includes('undefined');})()`);
      if(theme==='dark')await check(prefix+' neutral global and component surfaces',`(()=>{const rgb=node=>${backgroundChannels.toString()}(node);return [document.body,document.querySelector('.left-pane'),document.querySelector('.automation-modal')].every(node=>{const a=rgb(node);return Math.max(...a)-Math.min(...a)<=2;});})()`);
      await check(prefix+' native polling runs',`window.__automationFixture.polls>2`);
      await execute(`window.termaSftpWorkflow.automation.stopRefresh();window.__automationFixture.items[0].last_status='idle';await window.termaSftpWorkflow.automation.manager();`);
      const run='.automation-row:first-child .primary';await click(run);await shot(prefix+'-manager-running');
      await check(prefix+' running action disabled',`document.querySelector('.automation-row:first-child .primary').disabled`);
      await click('.automation-row:first-child .automation-actions button:nth-child(2)');await shot(prefix+'-manager-paused');
      await execute(`window.__automationFixture.writeMode='error';`);await click('.automation-row:first-child .automation-actions button:nth-child(2)');await shot(prefix+'-command-error');
      await click('.automation-row:first-child .danger');await shot(prefix+'-delete-confirm');await click('#automationConfirm');await shot(prefix+'-delete-error');
      browser.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});await delay(50);await check(prefix+' escape preserves manager',`!document.querySelector('[data-automation-layer]')&&document.querySelector('.automation-list')`);
      await execute(`window.__automationFixture.writeMode='normal';await window.termaSftpWorkflow.automation.edit(1);`);await shot(prefix+'-form-initial');
      if(theme==='dark')await check(prefix+' input surface is neutral and distinct',`(()=>{const channels=node=>getComputedStyle(node).backgroundColor.match(/[0-9.]+/g)?.slice(0,3).map(Number)||[];const field=channels(document.querySelector('#sftpAutomationName')),panel=channels(document.querySelector('.automation-modal'));return field.length===3&&panel.length===3&&Math.max(...field)-Math.min(...field)<=2&&field.reduce((a,b)=>a+b,0)>panel.reduce((a,b)=>a+b,0)+18;})()`);
      await click('#sftpAutomationName');browser.webContents.insertText(' draft');
      await execute(`window.__automationFixture.expectedName=document.querySelector('#sftpAutomationName').value;document.querySelector('#sftpAutomationName').setSelectionRange(2,6);const form=document.querySelector('.automation-form');form.scrollTop=20;window.__automationFixture.formScroll=form.scrollTop;await setTermaLanguage('${other}',{render:false});await setTermaLanguage('${language}',{render:false});`);
      await check(prefix+' language preserves draft caret focus and scroll',`document.querySelector('#sftpAutomationName').value===window.__automationFixture.expectedName&&document.activeElement.id==='sftpAutomationName'&&document.activeElement.selectionStart===2&&document.activeElement.selectionEnd===6&&document.querySelector('.automation-form').scrollTop===window.__automationFixture.formScroll`);
      await click('#sftpAutomationStartAt');
      await check(prefix+' empty date uses the application language format',`document.querySelector('#sftpAutomationStartAt').type==='text'&&document.querySelector('#sftpAutomationStartAt').placeholder===tr('sftp:automation.start_time_format')&&document.querySelector('#sftpAutomationStartAt').value===''`);
      await shot(prefix+'-date-empty');
      await execute(`const f=window.__automationFixture,picker=document.querySelector('#sftpAutomationStartAtPicker');f.nativeShowPicker=picker.showPicker;picker.showPicker=function(){f.pickerActivation=navigator.userActivation.isActive;f.nativeShowPicker.call(this);};`);
      await click('#sftpAutomationStartAtChoose');await delay(120);browser.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});browser.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await delay(80);
      if(!await execute(`return window.__automationFixture.pickerActivation===true&&!!document.querySelector('#sftpAutomationStartAt');`))console.error('Calendar diagnostic',await execute(`return {activation:window.__automationFixture.pickerActivation,view:window.termaSftpWorkflow.automation.model()?.view,active:document.activeElement?.outerHTML?.slice(0,500),modal:document.querySelector('#modal')?.innerHTML?.slice(0,500)};`));
      await check(prefix+' real calendar action retains the form and user activation',`window.__automationFixture.pickerActivation===true&&!!document.querySelector('#sftpAutomationStartAt')`);
      await execute(`delete document.querySelector('#sftpAutomationStartAtPicker').showPicker;`);
      await click('#sftpAutomationStartAt');
      browser.webContents.insertText('2026-12-01 09:30');await delay(40);
      await execute(`const f=window.__automationFixture;f.dateNode=document.querySelector('#sftpAutomationStartAt');f.dateNode.setSelectionRange(11,13);await setTermaLanguage('${other}',{render:false});`);
      await check(prefix+' date draft node focus and caret survive language switch',`document.querySelector('#sftpAutomationStartAt')===window.__automationFixture.dateNode&&document.activeElement===window.__automationFixture.dateNode&&document.activeElement.value==='2026-12-01 09:30'&&document.activeElement.selectionStart===11&&document.activeElement.selectionEnd===13&&document.activeElement.placeholder===tr('sftp:automation.start_time_format')&&window.termaSftpWorkflow.automation.model().draft.startAt==='2026-12-01T09:30'`);
      await shot(prefix+'-date-live-language');await execute(`await setTermaLanguage('${language}',{render:false});`);
      await execute(`const f=window.__automationFixture;f.dateRequests=f.requests.length;window.termaSftpWorkflow.automation.actions().change('startAt','2026-02-30T09:30');`);
      await click('#automationSave');
      await wait(`window.termaSftpWorkflow.automation.model().error===tr('sftp:automation.invalid_start')&&document.querySelector('#modal [role="alert"]')?.textContent===tr('sftp:automation.invalid_start')`);
      await check(prefix+' invalid date is rejected without an automation request',`window.__automationFixture.requests.slice(window.__automationFixture.dateRequests).every(request=>!request.url.startsWith('/api/sftp/automations'))&&document.querySelector('#modal [role="alert"]').textContent===tr('sftp:automation.invalid_start')`);
      await click('#sftpAutomationStartAt');await shot(prefix+'-date-invalid');
      await execute(`const s=window.termaSftpWorkflow.automation;s.model().error='';s.actions().change('startAt','');`);
      for(const frequency of ['once','every_second','every_minute','every_hour','daily','weekly','monthly','yearly','specified_time','countdown','half_hour','cron','realtime']){
        await execute(`const s=window.termaSftpWorkflow.automation;s.actions().change('frequency','${frequency}');document.querySelector('.automation-form').scrollTop=0;`);await shot(prefix+'-schedule-'+frequency);
      }
      await execute(`window.termaSftpWorkflow.automation.actions().change('frequency','cron');`);await click('#sftpAutomationCron');browser.webContents.insertText('bad expression');await wait(`window.termaSftpWorkflow.automation.model().draft.cronState==='invalid'`);await shot(prefix+'-cron-invalid');
      await execute(`window.termaSftpWorkflow.automation.actions().change('cron','*/5 * * * *');`);await wait(`window.termaSftpWorkflow.automation.model().draft.cronState==='valid'`);await shot(prefix+'-cron-valid');
      await execute(`document.querySelector('.automation-form').scrollTop=1e6;`);await shot(prefix+'-form-bottom');
      await execute(`window.__automationFixture.writeMode='error';`);await click('#automationSave');await shot(prefix+'-save-error');
      await execute(`window.__automationFixture.writeMode='pending';`);await click('#automationSave');await shot(prefix+'-saving');await check(prefix+' save busy prevents duplicates',`document.querySelector('#automationSave').disabled`);
      await execute(`window.__automationFixture.writeMode='normal';window.__automationFixture.finishWrite();`);await wait(`window.termaSftpWorkflow.automation.model().view==='manager'`);
      await execute(`await window.termaSftpWorkflow.automation.edit(1);window.__automationFixture.directoryMode='pending';`);await click('#automationBrowse');await shot(prefix+'-remote-loading');
      await execute(`window.__automationFixture.directoryMode='error';window.__automationFixture.finishDirectory();`);await wait(`!window.termaSftpWorkflow.automation.model().picker.loading`);await shot(prefix+'-remote-error');
      await execute(`window.__automationFixture.directoryMode='normal';await window.termaSftpWorkflow.automation.actions().directory('.');`);await shot(prefix+'-remote-home');
      await check(prefix+' picker hides internal home placeholder',`document.querySelector('#automationPickerPath').value==='~'`);
      await execute(`await window.termaSftpWorkflow.automation.actions().directory('/');`);await shot(prefix+'-remote-root');
      await execute(`await window.termaSftpWorkflow.automation.actions().toggleDirectory('/review <img src=x>');await setTermaLanguage('${other}',{render:false});await setTermaLanguage('${language}',{render:false});`);await shot(prefix+'-remote-tree');
      await check(prefix+' directory controls align left',`[...document.querySelectorAll('.automation-tree-entry')].every(node=>{const a=node.getBoundingClientRect(),b=node.querySelector('svg').getBoundingClientRect();return b.left-a.left<160&&b.left-a.left>=0;})`);
      await click('#automationMkdir');await click('#automationFolderName');browser.webContents.insertText('../invalid');await click('.automation-create .primary');await shot(prefix+'-folder-invalid');
      await execute(`window.termaSftpWorkflow.automation.actions().pickerEdit('name','new folder');window.__automationFixture.writeMode='pending';`);await click('.automation-create .primary');await shot(prefix+'-folder-creating');
      await execute(`window.__automationFixture.writeMode='normal';window.__automationFixture.finishWrite();`);await wait(`!window.termaSftpWorkflow.automation.model().picker.loading`);await shot(prefix+'-folder-created');await click('#automationSelectDirectory');
      await check(prefix+' directory selection updates draft',`window.termaSftpWorkflow.automation.model().draft.remotePath==='/review <img src=x>'`);
      await click('#automationChoose');await shot(prefix+'-server-picker');await check(prefix+' server input uses real display path',`document.querySelector('#automationPickerPath').value==='C:/Review'`);
      await execute(`await window.termaSftpWorkflow.automation.actions().toggleDirectory('/authorized-root/child');`);await shot(prefix+'-server-child');
      await execute(`await window.termaSftpWorkflow.automation.actions().toggleDirectory('/authorized-root');`);await shot(prefix+'-server-collapse');await check(prefix+' collapse keeps server display path',`document.querySelector('#automationPickerPath').value==='C:/Review'`);
      await click('#automationSelectDirectory');await execute(`await window.termaSftpWorkflow.automation.history(1);`);await shot(prefix+'-history');await click('.automation-run:first-child summary');await shot(prefix+'-history-expanded');
      await click('.automation-run:first-child .automation-run-filters button:nth-child(5)');await shot(prefix+'-history-filter');await check(prefix+' filter retains only conflicts',`document.querySelectorAll('.automation-run:first-child .automation-run-file').length===1`);
      await execute(`await setTermaLanguage('${other}',{render:false});await setTermaLanguage('${language}',{render:false});`);await check(prefix+' history expansion survives language',`document.querySelector('.automation-run:first-child').open`);
      await click('#automationClear');await shot(prefix+'-history-clear-confirm');await execute(`window.__automationFixture.writeMode='error';`);await click('#automationConfirm');await shot(prefix+'-history-clear-error');
      await execute(`window.__automationFixture.writeMode='normal';`);await click('#automationConfirm');await wait(`!window.termaSftpWorkflow.automation.model().confirm`);
      await execute(`window.__automationFixture.historyMode='empty';await window.termaSftpWorkflow.automation.history(1,2);`);await shot(prefix+'-history-empty-page');
      await execute(`window.__automationFixture.historyMode='error';await window.termaSftpWorkflow.automation.history(1);`);await shot(prefix+'-history-load-error');
      await execute(`window.__automationFixture.historyMode='normal';await window.termaSftpWorkflow.automation.manager();window.termaSftpWorkflow.automation.stopRefresh();`);
      const first=await execute(`return window.termaSftpWorkflow.automation.model().items[0].id;`);await click('.automation-drag');browser.webContents.sendInputEvent({type:'keyDown',keyCode:'DOWN'});await delay(100);
      await check(prefix+' keyboard reorders',`window.termaSftpWorkflow.automation.model().items[0].id!==${first}`);await shot(prefix+'-keyboard-order');
      const points=await execute(`const rows=[...document.querySelectorAll('.automation-row')];rows[0].scrollIntoView({block:'nearest'});const a=rows[0].querySelector('.automation-drag').getBoundingClientRect(),b=rows[1].getBoundingClientRect();return {a:{x:Math.round(a.left+a.width/2),y:Math.round(a.top+a.height/2)},b:{x:Math.round(a.left+a.width/2),y:Math.round(b.top+b.height-8)}};`);
      browser.webContents.sendInputEvent({type:'mouseMove',...points.a});browser.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...points.a});browser.webContents.sendInputEvent({type:'mouseMove',...points.b});browser.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...points.b});await delay(100);
      await check(prefix+' real pointer reorders',`window.termaSftpWorkflow.automation.model().items[0].id===${first}`);await shot(prefix+'-pointer-order');
      await execute(`window.termaSftpWorkflow.automation.startRefresh();window.__automationFixture.pollStart=window.__automationFixture.polls;`);await wait(`window.__automationFixture.polls>window.__automationFixture.pollStart`);
      await execute(`closeModal();window.__automationFixture.pollStop=window.__automationFixture.polls;`);await delay(await execute('return document.hidden?5200:3300;'));await check(prefix+' close stops real native polling',`window.__automationFixture.polls===window.__automationFixture.pollStop`);
    }
    fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({viewport,checks,screenshots,reports},null,2));return `M6 自动化 ${viewport}：${checks} 项检查、${screenshots} 张截图`;
  }finally{await execute(`closeModal();window.termaSftpWorkflow.automation.stopRefresh();api=window.__automationFixture.api;window.termaDesktop=window.__automationFixture.desktop;document.getElementById('automation-fixture-notice')?.remove();delete window.__automationFixture;`);}
}
module.exports={runM6AutomationsUiScenario};
