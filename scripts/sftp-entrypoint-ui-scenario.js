const {runSftpDragFeedbackUiScenario}=require('./sftp-drag-feedback-ui-scenario');
async function runSftpEntrypointUiScenario({execute,check,shot}) {
  await execute(`
    const f=window.__sftpVueFixture,key='sftp-entrypoint-check',id=99773;
    f.entrypoint={key,id,api,activeTabKey,activeView,requests:[],mode:'success',favorites:localStorage.getItem('sftpFavorites'),encodings:[]};
    const e=f.entrypoint;e.root=document.createElement('section');e.root.id='view-sftp';e.root.className='workspace sftp-vue-fixture';e.root.dataset.sftpTabKey=key;document.body.append(e.root);f.root.hidden=true;
    e.tab={kind:'sftp',key,id,path:'/entry',title:'Entry test'};tabs.push(e.tab);
    e.connection={id,name:'Entry test',ssh_user:'test',ssh_host:'fixture.invalid',ssh_port:22,sftp_filename_encoding:'utf8'};connections.push(e.connection);
    e.runtime=window.termaSftpTabs.runtime.ensure(key,id,'/entry',e.root);e.runtime.vueStatus='connected';e.runtime.state={...e.runtime.state,path:'/entry',entries:[],requestSeq:0};
    activeTabKey=key;activeView='sftp';
    api=async(url,options)=>{
      if(String(url).startsWith('/api/connections/'+id+'/sftp/session'))return {connected:true};
      if(url==='/api/connections/'+id+'/sftp-filename-encoding'){const value=JSON.parse(options.body).encoding;e.encodings.push(value);return {sftp_filename_encoding:value};}
      if(String(url).startsWith('/api/connections/'+id+'/sftp?')) {
        const params=new URL(String(url),location.origin).searchParams;e.requests.push(Object.fromEntries(params));
        if(e.mode==='error'){const error=new Error('Directory denied');error.code='SFTP_DIRECTORY_PERMISSION_DENIED';throw error;}
        const entries=[{name:'entry.txt',type:'file',size:7,mtime:1}];
        if(e.mode==='activation')entries.push({name:'folder',type:'dir',size:0},{name:'photo.png',type:'file',size:2});
        const size=Number(params.get('page_size'))||50,page=Number(params.get('page'))||1,total=e.mode==='continuous'?size*3:entries.length;
        if(e.mode==='continuous')entries.splice(0,entries.length,...Array.from({length:size},(_,index)=>({name:'entry-'+((page-1)*size+index)+'.txt',type:'file',size:7,mtime:1})));
        return {path:params.get('path'),entries,page,page_size:size,total,total_pages:Math.ceil(total/size),unfiltered_total:total};
      }
      return e.api(url,options);
    };
    window.termaSftpView.render(key);await window.termaSftpDirectoryWorkspace.loader.load({connectionId:id,path:'/entry',tabKey:key});
  `);
  await check('formal SFTP entry paints the Vue list', `(()=>{const e=window.__sftpVueFixture.entrypoint;return window.termaSftpViews.isMounted(e.key)&&e.root.querySelectorAll('.sftp-row').length===1&&e.root.querySelector('.sftp-file-name').textContent==='entry.txt'&&e.root.querySelector('#sftpBreadcrumb').textContent.includes('entry')})()`);
  await shot('formal-entry-list');
  const openEntryMenu = `const e=window.__sftpVueFixture.entrypoint; e.root.querySelector('.sftp-row').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:140,clientY:140}));`;
  await execute(openEntryMenu);
  await check('formal context menu opens on the selected directory entry', `(()=>{const e=window.__sftpVueFixture.entrypoint;return window.termaSftpView.selectedPaths(e.key).join()==='/entry/entry.txt'&&document.querySelector('#actionMenu [role=menuitem]')?.textContent===tr('sftp:menu.open_as_text')})()`);
  await shot('formal-entry-context-menu');
  await execute(`
    const e=window.__sftpVueFixture.entrypoint, preview=window.termaSftpPreviewRuntime, original=preview.text;
    e.menuOpens=[]; preview.text=(id,path)=>e.menuOpens.push({id,path});
    try {
      const action=()=>document.querySelector('#actionMenu [role=menuitem]').click();
      e.runtime.state.path='/moved'; action(); e.runtime.state.path='/entry';
      {${openEntryMenu}} action();
    } finally { preview.text=original; }
  `);
  await check('formal context menu blocks stale paths and uses the current entry', `(()=>{const e=window.__sftpVueFixture.entrypoint;return e.menuOpens.length===1&&e.menuOpens[0].id===e.id&&e.menuOpens[0].path==='/entry/entry.txt'&&!document.querySelector('#actionMenu')})()`);
  await execute(`
    const e=window.__sftpVueFixture.entrypoint,page=window.termaSftpPage,original=page.open,calls=[];
    try{page.open=(...args)=>{calls.push(args);return Promise.resolve(true);};const copied=await window.termaSftpPage.duplicate(e.key);
      const request=calls[0];if(!copied||calls.length!==1||request[0]!==e.id||request[1]!==e.runtime.state.path||request[2]!==true||!request[3]||request[3]===e.key)throw new Error('SFTP duplicate adapter lost its source, path or independent key');
    }finally{page.open=original;}
  `);
  await runSftpDragFeedbackUiScenario({execute,check,shot});
  await execute(`const e=window.__sftpVueFixture.entrypoint;window.termaSftpView.element('sftpFavoriteToggle',e.key).click();await Promise.resolve();const input=$('modalInputValue');input.value='Entry favorite';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();await setTermaLanguage(document.documentElement.lang==='zh-CN'?'en-US':'zh-CN');if($('modalInputValue')!==input||input.value!=='Entry favorite'||document.activeElement!==input)throw new Error('Favorite prompt lost its draft during translation');`);
  await check('favorite prompt translates through the formal Vue entry', `$('modal').querySelector('[data-sftp-dialog="input"]')&&$('modal').textContent.includes(tr('sftp:auto.favorite_dialog_title'))`);
  await shot('formal-favorite-dialog');
  await execute(`$('modalConfirmBtn').click();await new Promise(resolve=>setTimeout(resolve,30));`);
  await check('favorite submit updates the same live Vue toolbar', `(()=>{const e=window.__sftpVueFixture.entrypoint;return window.termaSftpView.element('sftpFavoriteToggle',e.key)?.classList.contains('is-active')&&e.root.querySelector('#sftpFavorites').textContent.includes('Entry favorite')})()`);
  await shot('formal-favorite-saved');
  await execute(`const e=window.__sftpVueFixture.entrypoint;await window.termaSftpPreferences.encoding(e.id,'gb18030');`);
  await check('encoding apply uses the allowlisted preference owner', `(()=>{const e=window.__sftpVueFixture.entrypoint;return e.encodings.length===1&&e.encodings[0]==='gb18030'&&window.termaSftpView.element('sftpFilenameEncodingButton',e.key)?.textContent.includes('GB18030')})()`);
  await execute(`const e=window.__sftpVueFixture.entrypoint;e.root.querySelector('[data-sftp-column-sort="size"]').click();await new Promise(resolve=>setTimeout(resolve,40));`);
  await check('formal column sort reaches its typed directory request', `(()=>{const e=window.__sftpVueFixture.entrypoint,r=e.requests.at(-1);return r.sort==='size'&&r.dir==='asc'&&r.page==='1'&&e.root.querySelector('[data-sftp-column-sort="size"]').textContent.includes('↑')})()`);
  await execute(`const e=window.__sftpVueFixture.entrypoint;const toolbar=window.termaSftpView.element('sftpUpload',e.key).closest('.sftp-toolbar');toolbar.querySelector('button[title="'+tr('sftp:auto.search_current')+'"]').click();const input=e.root.querySelector('#sftpSearch');input.value='entry';input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,260));`);
  await check('formal search input sends a filtered request without a legacy function', `(()=>{const e=window.__sftpVueFixture.entrypoint;return e.requests.at(-1).query==='entry'&&e.runtime.state.query==='entry'&&e.root.querySelector('#sftpSearch').value==='entry'&&e.root.querySelectorAll('.sftp-row').length===1})()`);
  await execute(`const e=window.__sftpVueFixture.entrypoint;const checkbox=e.root.querySelector('.sftp-search-recursive input');checkbox.checked=true;checkbox.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,260));`);
  await check('formal recursive search updates the same request scope', `window.__sftpVueFixture.entrypoint.requests.at(-1).recursive==='1'`);
  await shot('formal-entry-search');
  await execute(`const e=window.__sftpVueFixture.entrypoint;e.root.querySelector('#sftpFloatingSearch button').click();await new Promise(resolve=>setTimeout(resolve,260));e.root.querySelector('#sftpPathEditButton').click();const input=e.root.querySelector('#sftpPathInput');input.value='/next';input.dispatchEvent(new Event('input',{bubbles:true}));e.root.querySelector('#sftpPathEditor').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await new Promise(resolve=>setTimeout(resolve,60));`);
  await check('formal path submit refreshes breadcrumb and entries', `(()=>{const e=window.__sftpVueFixture.entrypoint;return e.requests.at(-1).path==='/next'&&e.requests.at(-1).query===''&&e.runtime.state.path==='/next'&&e.root.querySelector('#sftpBreadcrumb').textContent.includes('next')&&e.root.querySelector('#sftpPathEditor').hidden})()`);
  await execute(`
    const e=window.__sftpVueFixture.entrypoint; e.mode='activation'; e.opens=[];
    await window.termaSftpDirectoryWorkspace.loader.load({path:'/next',tabKey:e.key,refresh:true});
    const [textRow,dirRow,imageRow]=e.root.querySelectorAll('.sftp-row');
    const dbl=node=>node.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));
    const old={previewSftpText:window.termaSftpPreviewRuntime.text,previewSftpImage:window.termaSftpPreviewRuntime.image,openEditor:window.termaSftpWorkflow.openEditor,runtimeSettings: window.termaRuntimeSettingsModel.snapshot};
    try {
      window.termaSftpPreviewRuntime.text=(id,path)=>e.opens.push({id,path,type:'text'});
      window.termaSftpPreviewRuntime.image=(id,path)=>e.opens.push({id,path,type:'image'});
      window.termaSftpWorkflow.openEditor=(id,path)=>e.opens.push({id,path,type:'external'});
      window.termaRuntimeSettingsModel.snapshot={sftp_double_click_file_action:'internal'};
      const check=textRow.querySelector('.sftp-check');check.click();dbl(check);
      if(e.opens.length||window.termaSftpView.selectedPaths(e.key).join()!=='/next/entry.txt')throw new Error('Checkbox fed row activation or lost selection');
      window.termaSftpViews.select(e.key,e.id+1,{forceSingle:true},{path:'/next/photo.png',name:'photo.png',type:'file'});
      if(window.termaSftpView.selectedPaths(e.key).join()!=='/next/entry.txt')throw new Error('Mismatched connection changed selection');
      dbl(textRow.querySelector('.sftp-name'));dbl(imageRow);
      if(window.termaDesktop){window.termaRuntimeSettingsModel.snapshot={sftp_double_click_file_action:'external'};dbl(textRow);}
      dbl(dirRow.querySelector('.sftp-name'));await new Promise(resolve=>setTimeout(resolve,60));
    } finally {({previewSftpText:window.termaSftpPreviewRuntime.text,previewSftpImage:window.termaSftpPreviewRuntime.image,openEditor:window.termaSftpWorkflow.openEditor,runtimeSettings: window.termaRuntimeSettingsModel.snapshot}=old);}
  `);
  await check('formal row activation preserves checkbox, text, image, desktop preference and directory routing', `(()=>{const e=window.__sftpVueFixture.entrypoint;return e.opens.map(x=>x.type).join()===('text,image'+(window.termaDesktop?',external':''))&&e.opens.every(x=>x.id===e.id)&&e.opens[0].path==='/next/entry.txt'&&e.opens[1].path==='/next/photo.png'&&e.requests.at(-1).path==='/next/folder'})()`);
  await execute(`const e=window.__sftpVueFixture.entrypoint;e.mode='continuous';await window.termaSftpDirectoryWorkspace.loader.load({path:'/next/folder',tabKey:e.key,page:1,refresh:true});const list=e.root.querySelector('.sftp-list'),height=parseFloat(getComputedStyle(list).getPropertyValue('--file-row-height'))||36;list.scrollTop=height*110;list.dispatchEvent(new Event('scroll'));await new Promise(resolve=>setTimeout(resolve,160));`);
  await check('formal continuous scrolling stays in the current directory and bounds the DOM', `(()=>{const e=window.__sftpVueFixture.entrypoint;return e.requests.at(-1).path==='/next/folder'&&e.requests.at(-1).page==='3'&&e.runtime.state.page===3&&e.root.querySelectorAll('.sftp-row').length<50&&e.root.querySelector('.file-list-status')&&!e.root.querySelector('.sftp-page-jump')})()`);
  await shot('formal-entry-continuous-scroll');
  await execute(`const e=window.__sftpVueFixture.entrypoint;e.mode='error';e.runtime.state.entries=[];window.termaSftpViews.release(e.key);window.termaSftpView.mount(e.root,e.key);await window.termaSftpDirectoryWorkspace.loader.load({connectionId:e.id,path:'/denied',tabKey:e.key,keepContents:false});await setTermaLanguage(document.documentElement.lang==='zh-CN'?'en-US':'zh-CN');`);
  await check('formal first-load failure keeps the Vue error on language refresh', `(()=>{const e=window.__sftpVueFixture.entrypoint;return e.root.querySelector('.ui-state.error')?.textContent.includes('Directory denied')&&e.runtime.vueListState?.kind==='error'})()`);
  await shot('formal-entry-error');
  await execute(`
    const f=window.__sftpVueFixture,e=f.entrypoint;
    api=e.api;window.termaSftpTabs.runtime.dispose(e.key);tabs.splice(tabs.indexOf(e.tab),1);e.root.remove();
    connections.splice(connections.indexOf(e.connection),1);if(e.favorites===null)localStorage.removeItem('sftpFavorites');else localStorage.setItem('sftpFavorites',e.favorites);window.termaSftpPreferences.reload();
    activeTabKey=e.activeTabKey;activeView=e.activeView;
    f.root.hidden=false;delete f.entrypoint;
  `);
}
module.exports={runSftpEntrypointUiScenario};
