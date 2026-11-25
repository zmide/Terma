const fs=require('node:fs');
const path=require('node:path');
async function runWebFilesUiScenario(window) {
  const results=[],screenshots=[];
  const directory=path.join(process.env.TERMA_UI_DIAGNOSTICS_DIR||path.join(process.cwd(),'data'),'web-files-visual');fs.mkdirSync(directory,{recursive:true});
  const execute=source=>window.webContents.executeJavaScript(`(async()=>{${source}})()`);
  // Earlier fixture notifications must not cover the file page in its own screenshots.
  await execute(`dismissToast();for(let attempt=0;attempt<30&&document.querySelector('#toast .toast');attempt++)await new Promise(resolve=>setTimeout(resolve,20));if(document.querySelector('#toast .toast'))throw new Error('Previous fixture notifications still cover the file page');`);
  const shot=async name=>{
    await execute(`const root=window.termaLocalFileRuntime.root(window.__webFilesFixture.key),ctx=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
      const head=root.querySelector('.local-files-head'),columns=[...head.children].filter(node=>node.checkVisibility()).map(node=>node.getBoundingClientRect());
      if(columns.some(rect=>Math.abs(rect.top-columns[0].top)>2||Math.abs(rect.bottom-columns[0].bottom)>2))throw new Error('File header wraps a column into another row');
      const shell=root.querySelector('.web-files-shell'),search=shell.querySelector('.web-files-search input'),searchBox=search.getBoundingClientRect();
      if(getComputedStyle(shell).fontSize!=='13px'||getComputedStyle(shell.querySelector('.local-files-top')).flexDirection!=='column')throw new Error('File page owner styles are missing');
      if(getComputedStyle(search).fontSize!==(innerWidth<=760?'16px':'12px')||searchBox.width<100)throw new Error('File search responsive styles are missing');
      if($('modal').hidden&&document.elementFromPoint(searchBox.x+searchBox.width/2,searchBox.y+searchBox.height/2)!==search)throw new Error('File search is covered');
      const rgba=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
      const luminance=rgb=>rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      for(const node of root.querySelectorAll('.web-files-hint,.web-files-mode,.local-files-head,.local-files-mobile-meta,.local-files-row>span,.sftp-pagination-center')){
        if(!node.checkVisibility()||!node.textContent.trim())continue;
        let ancestor=node,background;
        while(ancestor){const color=rgba(getComputedStyle(ancestor).backgroundColor);if(color[3]>=250){background=color;break;}ancestor=ancestor.parentElement;}
        const foreground=luminance(rgba(getComputedStyle(node).color)),back=luminance(background||rgba(getComputedStyle(root).getPropertyValue('--panel'))),ratio=(Math.max(foreground,back)+.05)/(Math.min(foreground,back)+.05);
        if(ratio<4.5)throw new Error('File metadata contrast '+ratio.toFixed(2)+' '+node.className+' '+node.textContent.slice(0,30));
      }`);
    window.webContents.invalidate();await new Promise(resolve=>setTimeout(resolve,80));fs.writeFileSync(path.join(directory,name+'.png'),(await window.webContents.capturePage()).toPNG());screenshots.push(name+'.png');
  };
  const folderPrompt=async(prefix,source,language)=>{
    const point=await execute(`
      const f=window.__webFilesFixture;await setTermaLanguage(${JSON.stringify(language)});
      const state=window.termaLocalFileRuntime.files.state(f.key);f.pathSnapshot={state,path:state.path,selected:[...state.selected]};
      const button=window.termaLocalFileRuntime.root(f.key).querySelector('[data-action="web-files-path"]');button.scrollIntoView({block:'nearest',behavior:'instant'});
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const box=button.getBoundingClientRect();if(button.disabled||!box.width||!box.height||document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)?.closest('button')!==button)throw new Error('Folder prompt action is not reachable');
      return {x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)};
    `);
    window.webContents.sendInputEvent({type:'mouseMove',...point});
    window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
    window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
    await execute(`
      const f=window.__webFilesFixture;
      if(!await f.until(()=>$('modalInputValue')&&!$('modal').hidden))throw new Error('Folder action did not open its input dialog');
      const card=$('modal').querySelector('.modal-card');
      const labels={title:card.querySelector('h2').textContent,label:card.querySelector('label').textContent,expectedTitle:tr('sftp:web_files.go_to_folder'),expectedLabel:tr('sftp:web_files.'+${JSON.stringify(source==='browser'?'relative_path_hint':'path')}),language:document.documentElement.lang,source:${JSON.stringify(source)},group:${JSON.stringify(prefix)}};
      if(labels.title!==labels.expectedTitle||labels.label!==labels.expectedLabel)throw new Error('Folder prompt starts with the wrong language '+JSON.stringify(labels));
      const input=$('modalInputValue');if(input.value!==f.pathSnapshot.state.displayPath)throw new Error('Folder prompt lost its captured directory');
      f.pathInput=input;input.value='Draft folder/subfolder';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(2,9);
      const box=card.getBoundingClientRect();for(const button of card.querySelectorAll('button')){const b=button.getBoundingClientRect();if(b.left<box.left-1||b.right>box.right+1||b.right>innerWidth+1)throw new Error('Folder prompt action is clipped');}
    `);
    await shot(prefix+'-'+source+'-folder-prompt');
    await execute(`
      const f=window.__webFilesFixture;await setTermaLanguage(${JSON.stringify(language==='zh-CN'?'en-US':'zh-CN')});
      const card=$('modal').querySelector('.modal-card'),input=$('modalInputValue');
      if(card.querySelector('h2').textContent!==tr('sftp:web_files.go_to_folder')||card.querySelector('label').textContent!==tr('sftp:web_files.'+${JSON.stringify(source==='browser'?'relative_path_hint':'path')}))throw new Error('Open folder prompt did not translate');
      if(input!==f.pathInput||input.value!=='Draft folder/subfolder'||document.activeElement!==input||input.selectionStart!==2||input.selectionEnd!==9)throw new Error('Folder prompt language switch lost draft, focus or selection');
      if($('modalCancelBtn').textContent.trim()!==tr('common:actions.cancel')||$('modalConfirmBtn').textContent.trim()!==tr('common:auto.confirm'))throw new Error('Folder prompt actions did not translate');
    `);
    await shot(prefix+'-'+source+'-folder-prompt-live-language');
    await execute(`
      const f=window.__webFilesFixture;$('modalCancelBtn').click();await new Promise(resolve=>requestAnimationFrame(resolve));
      if(!$('modal').hidden||window.termaLocalFileRuntime.files.state(f.key)!==f.pathSnapshot.state||window.termaLocalFileRuntime.files.state(f.key).path!==f.pathSnapshot.path||JSON.stringify([...window.termaLocalFileRuntime.files.state(f.key).selected])!==JSON.stringify(f.pathSnapshot.selected))throw new Error('Cancelled folder prompt changed the directory or selection');
      await setTermaLanguage(${JSON.stringify(language)});
    `);
  };
  for(const width of [1200,392]) {
    window.setSize(width,850);
    for(const language of ['zh-CN','en-US'])for(const theme of ['light','dark']) {
      const prefix=width+'-'+language+'-'+theme;
      const result=await execute(`
        const previous={api,language:document.documentElement.lang,theme:document.documentElement.dataset.theme};
        const key='web-files-smoke-'+${width};
        const f={key,previous,mode:'normal',writes:[],finish:null,mutationMode:'normal',mutations:[],receives:[]};window.__webFilesFixture=f;
        f.until=async predicate=>{for(let attempt=0;attempt<100;attempt++){if(predicate())return true;await new Promise(resolve=>setTimeout(resolve,20));}return false;};
        try {
          await setTermaLanguage(${JSON.stringify(language)},{emit:false});
          document.documentElement.dataset.theme=${JSON.stringify(theme)};
          api=async(url,options={})=>{
            if(['/api/server-files/create','/api/server-files/rename','/api/server-files/delete'].includes(url)&&options.method==='POST'){
              f.mutations.push({action:url.split('/').pop(),...JSON.parse(options.body)});
              if(f.mutationMode==='pending')await new Promise(resolve=>f.finishMutation=resolve);
              if(f.mutationMode==='error')throw Object.assign(new Error(tr('errors:backend.file_name_exists')),{publicCode:'file_name_exists'});
              return {ok:true};
            }
            if(url==='/api/server-files/receive-plan'){f.receives.push(JSON.parse(options.body));return {items:[{name:'fixture.txt',exists:true,type:'file'}]};}
            if(url.startsWith('/api/server-files/text')){
              if(options.method==='POST') {f.writes.push(JSON.parse(options.body));if(f.mode==='pending')await new Promise(resolve=>f.finish=resolve);if(f.mode==='error')throw new Error('Write denied <img src=x>');return {ok:true};}
              return {content:'Fixture text'};
            }
            if(url.startsWith('/api/server-files?') && !new URL(url,'http://terma.test').searchParams.get('path'))return {path:'',kind:'computer',entries:[{name:'files',path:'/fixture',type:'drive',root_kind:'workspace',display_path:'/private/files'},{name:'files',path:'/authorized',type:'drive',root_kind:'authorized',display_path:'/volume/terma/files'}]};
            if(url.startsWith('/api/server-files'))return {path:'/fixture',display_path:'Files',kind:'directory',entries:[{name:'sample.txt',path:'/fixture/sample.txt',type:'file',size:24,mtime:1000},{name:'Folder',path:'/fixture/Folder',type:'dir',size:0,mtime:1000}]};
            return previous.api(url,options);
          };
          await window.termaLocalFileRuntime.pages.open('',true,key,'server');
          await new Promise(resolve=>requestAnimationFrame(resolve));
          let root=window.termaLocalFileRuntime.root(key);
          if(root.querySelectorAll('.web-files-root-path').length!==2)throw new Error('Root paths are missing');
          const labels=[...root.querySelectorAll('.local-files-file-name')].map(node=>node.textContent);
          if(new Set(labels).size!==labels.length)throw new Error('Root labels are ambiguous');
          if(root.querySelector('[data-action="web-files-create"]').title===tr('sftp:web_files.readonly_hint'))throw new Error('Device root shows a browser-only restriction');
          await window.termaLocalFileRuntime.files.load(key,{path:'/fixture',location:'directory'});
          if(root.querySelector('[data-action="web-files-create"]').disabled || root.querySelector('[data-action="web-files-create"]').title===tr('sftp:web_files.readonly_hint'))throw new Error('Writable folder retains a read-only tooltip');
          if(!root.querySelector('.web-files-origin').textContent.includes(window.termaLocalFileRuntime.pages.label('server')))throw new Error('Device source is not labelled '+JSON.stringify({actual:root.querySelector('.web-files-origin').textContent,expected:window.termaLocalFileRuntime.pages.label('server'),language:document.documentElement.lang}));
          const search=root.querySelector('.web-files-search input');
          if(search.getBoundingClientRect().width<100)throw new Error('Search input is collapsed');
          if(root.querySelector('.web-files-path').textContent!=='Files')throw new Error('Directory path is missing');
          for(const node of root.querySelectorAll('.web-files-navigation>*')){const box=node.getBoundingClientRect();const parent=root.getBoundingClientRect();if(box.right>parent.right+1 || box.left<parent.left-1)throw new Error('Navigation control overflows');}
          if(root.querySelectorAll('.local-files-row').length!==2)throw new Error('Device entries missing');
          if(window.termaWorkspaceState.persistableTab(workspaceTabByKey(key)).fileSource!=='server')throw new Error('Device source not persisted');
          const state=window.termaLocalFileRuntime.files.state(key);state.selected.add('/fixture/sample.txt');window.termaLocalFileRuntime.update(key);
          await setTermaLanguage(${JSON.stringify(language==='zh-CN'?'en-US':'zh-CN')},{emit:false});
          if(window.termaLocalFileRuntime.files.state(key)!==state||!state.selected.has('/fixture/sample.txt')||workspaceTabByKey(key).title!==window.termaLocalFileRuntime.pages.label('server')||workspaceTabByKey(key).subtitle!==state.displayPath)throw new Error('File page live language lost its identity, selection or heading');
          await setTermaLanguage(${JSON.stringify(language)},{emit:false});state.selected.clear();window.termaLocalFileRuntime.update(key);
          return {width:innerWidth,language:${JSON.stringify(language)},theme:${JSON.stringify(theme)},device:true};
        } catch(error) {api=previous.api;closeModal();closeTabsByKey([key]);delete window.__webFilesFixture;throw error;}
      `);
      await folderPrompt(prefix,'server',language);
      await execute(`
        const f=window.__webFilesFixture,dragState=window.termaSftpDragWorkspace.drag.state,payloadBefore=dragState.internal;
        const state=window.termaLocalFileRuntime.files.states.get(f.key),selection=[...state.selected],drag={connectionId:7,entries:[{path:'/remote/fixture.txt',name:'fixture.txt',type:'file'}]};
        try{
          state.selected.add('/fixture/sample.txt');state.selected.add('/fixture/Folder');
          const payload=window.termaLocalFileRuntime.files.payload(f.key);if(payload.sourceTabKey!==f.key||payload.paths.length!==2||payload.entries.length!==2)throw new Error('Device selection payload lost its source or entries');
          dragState.internal=drag;
          const dataTransfer=new DataTransfer(),target=window.termaLocalFileRuntime.root(f.key).querySelector('.local-files-row');
          dataTransfer.setData('application/x-terma-sftp',window.termaDragPayload.serializeDragPayload(drag.connectionId,drag.entries));
          const over=new DragEvent('dragover',{dataTransfer,bubbles:true,cancelable:true}),drop=new DragEvent('drop',{dataTransfer,bubbles:true,cancelable:true});
          target.dispatchEvent(over);target.dispatchEvent(drop);await Promise.resolve();
          const cancelDrop=()=>[...$('modal').querySelectorAll('button')].find(button=>button.textContent.trim()===tr('common:actions.cancel')); if(!await f.until(()=>!$('modal').hidden&&cancelDrop()))throw new Error('File drop did not reach the real conflict flow '+JSON.stringify({over:over.defaultPrevented,drop:drop.defaultPrevented,receives:f.receives,notice:document.querySelector('#toast')?.textContent,modal:$('modal')?.textContent.slice(0,300),tab:workspaceTabByKey(f.key),location:state.location,dragType:[...dataTransfer.types]}));
          const [received]=f.receives;
          if(!over.defaultPrevented||!drop.defaultPrevented||f.receives.length!==1||received.connection_id!==7||received.target!=='/fixture'||received.paths[0]!=='/remote/fixture.txt')throw new Error('File drop lost the source or target '+JSON.stringify(f.receives));
          cancelDrop().click();
        }finally{dragState.internal=payloadBefore;state.selected=new Set(selection);}
      `);
      await execute(`
          const f=window.__webFilesFixture,key=f.key;
          const root=window.termaLocalFileRuntime.root(key),row=root.querySelector('[data-action="web-files-select"]'),registry=window.termaEventRegistry;
          const unknown='closed-file-fixture',click=new MouseEvent('click',{bubbles:true,cancelable:true});
          for(const [action,tabKey] of [['local-files-entry-activate',key],['web-files-open',unknown]]){
            await registry.dispatch(action,{action,event:click,element:row,dataset:{tabKey,path:'/fixture/sample.txt'}});
          }
          if(!$('modal').hidden||window.termaLocalFileRuntime.files.states.has(unknown))throw new Error('Wrong-source or closed-tab action changed file state');
          const list=root.querySelector('.local-files-list');
          list.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:130,clientY:240}));
          if(!$('actionMenu')?.textContent.includes(tr('common:auto.refresh')))throw new Error('Blank-area directory menu is unbound');
          hideActionMenu();
          window.termaLocalFileRuntime.root(key).querySelector('[data-action="web-files-row-open"][data-path="/fixture/sample.txt"]').click();
          if(!await f.until(()=>$('fileTextContent')?.value==='Fixture text'))throw new Error('Editor action did not open the clicked file');
          if(!$('modal').querySelector('textarea') || $('modal').querySelector('textarea').value!=='Fixture text')throw new Error('Device editor failed');
          const hasHan=text=>Array.from(text).some(char=>{const point=char.codePointAt(0);return point>=0x3400&&point<=0x9fff;});
          if(${JSON.stringify(language)}==='en-US' && hasHan($('modal').textContent))throw new Error('Untranslated editor');
          if(!$('modal').querySelector('[data-sftp-dialog="text"]')||!$('fileTextSave')?.hasAttribute('data-terma-button'))throw new Error('Device editor bypasses the migrated Vue dialog');
          const card=$('modal').querySelector('.modal-card'),box=card.getBoundingClientRect(),textarea=$('fileTextContent'),editor=textarea.getBoundingClientRect(),style=getComputedStyle(textarea);
          if(style.whiteSpace!=='pre'||!style.fontFamily.includes('mono')||style.borderStyle==='none'||style.backgroundColor==='rgba(0, 0, 0, 0)')throw new Error('Vue editor styles do not preserve multiline themed editing');
          if(card.scrollWidth>card.clientWidth+2||box.left<-1||box.right>innerWidth+1||editor.left<box.left||editor.right>box.right+1||textarea.scrollWidth>textarea.clientWidth+2)throw new Error('Editor overflow');
          for(const button of card.querySelectorAll('button')){const b=button.getBoundingClientRect();if(b.left<box.left-1||b.right>box.right+1)throw new Error('Editor button clipped');}
      `);
      await shot(prefix+'-device-editor');
      try {
        await execute(`
          const f=window.__webFilesFixture,textarea=$('fileTextContent');f.editor=textarea;textarea.value='Unsaved draft';textarea.dispatchEvent(new Event('input',{bubbles:true}));textarea.focus();textarea.setSelectionRange(2,7);textarea.scrollTop=12;
          await setTermaLanguage(document.documentElement.lang==='zh-CN'?'en-US':'zh-CN');
          if($('fileTextContent')!==textarea||textarea.value!=='Unsaved draft'||document.activeElement!==textarea||textarea.selectionStart!==2||textarea.selectionEnd!==7)throw new Error('Language switch lost the text draft or focus');
          if($('fileTextSave').textContent.trim()!==tr('common:actions.save'))throw new Error('Open text editor did not translate');
        `);
        await shot(prefix+'-editor-live-language');
        await execute(`const f=window.__webFilesFixture;f.mode='pending';$('fileTextSave').click();$('fileTextSave').click();if(f.writes.length!==1||!$('fileTextSave').disabled||!$('fileTextContent').disabled||!$('fileTextCancel').disabled)throw new Error('Editor busy state allows duplicate actions');`);
        await shot(prefix+'-editor-save-busy');
        await execute(`const f=window.__webFilesFixture;f.mode='error';f.finish();await new Promise(resolve=>setTimeout(resolve,30));if($('fileTextContent').value!=='Unsaved draft'||$('fileTextSave').disabled||!$('sftpDialogError')?.textContent.includes('Write denied <img src=x>')||$('modal').querySelector('img'))throw new Error('Save error does not retain a safe retryable draft');`);
        await shot(prefix+'-editor-save-error');
        await execute(`const f=window.__webFilesFixture;f.mode='normal';$('fileTextSave').click();await new Promise(resolve=>setTimeout(resolve,40));if(!$('modal').hidden||f.writes.length!==2||f.writes[1].path!=='/fixture/sample.txt'||f.writes[1].content!=='Unsaved draft')throw new Error('Retry did not save the captured file and draft');`);
        await execute(`const f=window.__webFilesFixture;{const check=window.termaLocalFileRuntime.root(f.key).querySelector('[data-action="web-files-check"][data-path="/fixture/sample.txt"]');if(!check.checked)check.click();};f.mutationMode='error';window.termaLocalFileRuntime.root(f.key).querySelector('[data-action="web-files-rename"]').click();await Promise.resolve();const input=$('modalInputValue');input.value='existing.txt';input.dispatchEvent(new Event('input',{bubbles:true}));$('modalConfirmBtn').click();const retryable=await f.until(()=>$('sftpDialogError')?.textContent.includes(tr('errors:backend.file_name_exists'))&&input.isConnected&&input.value==='existing.txt'&&!$('modalConfirmBtn')?.disabled);if(!retryable)throw new Error('Rename collision lost its name or retry action '+JSON.stringify({error:$('sftpDialogError')?.textContent,expected:tr('errors:backend.file_name_exists'),language:document.documentElement.lang,translationLanguage:window.i18next.language,value:input.value,connected:input.isConnected,disabled:$('modalConfirmBtn')?.disabled,mutations:f.mutations,dialog:window.termaSftpDialogs.active()}));`);
        await shot(prefix+'-rename-conflict');
        await execute(`const f=window.__webFilesFixture;await setTermaLanguage(${JSON.stringify(language)});if($('sftpDialogError').textContent!==tr('errors:backend.file_name_exists'))throw new Error('Collision error did not translate live');f.mutationMode='pending';const input=$('modalInputValue');input.value='renamed.txt';input.dispatchEvent(new Event('input',{bubbles:true}));$('modalConfirmBtn').click();$('modalConfirmBtn').click();if(!input.disabled||f.mutations.length!==2)throw new Error('File mutation permits duplicate submissions');`);
        await shot(prefix+'-rename-busy');
        await execute(`const f=window.__webFilesFixture;f.mutationMode='normal';f.finishMutation();if(!await f.until(()=>$('modal').hidden)||!$('modal').hidden||f.mutations.at(-1).path!=='/fixture/sample.txt'||f.mutations.at(-1).new_name!=='renamed.txt')throw new Error('Rename retried with the wrong captured path');{const check=window.termaLocalFileRuntime.root(f.key).querySelector('[data-action="web-files-check"][data-path="/fixture/sample.txt"]');if(!check.checked)check.click();};window.termaLocalFileRuntime.root(f.key).querySelector('[data-action="web-files-delete"]').click();await Promise.resolve();if(!$('modal').querySelector('[data-sftp-dialog="confirm"]'))throw new Error('Delete bypasses Vue confirmation');`);
        await shot(prefix+'-delete-confirm');
        await execute(`const f=window.__webFilesFixture;$('sftpConfirmationCancel').click();await Promise.resolve();if(!$('modal').hidden||f.mutations.length!==2)throw new Error('Cancelled delete changed files');`);
        for(const variant of ['web-file','web-folder','native','upload']) {
          await execute(`
            const f=window.__webFilesFixture;await setTermaLanguage(${JSON.stringify(language)},{emit:false});
            const variant=${JSON.stringify(variant)},items=[{name:'<b>kept</b>.txt',type:variant==='web-folder'?'dir':'file',existing_type:variant==='web-folder'?'dir':'file'}];
            f.conflict=variant==='upload'?window.termaSftpTransfers.conflicts.upload(items):variant==='native'?window.termaSftpTransfers.conflicts.receive(items,'native'):window.termaSftpTransfers.conflicts.receive(items,'web');
            await new Promise(resolve=>requestAnimationFrame(resolve));
            f.conflictCard=$('modal').querySelector('.modal-card');
            if(!f.conflictCard||$('modal').hidden||!f.conflictCard.textContent.includes('<b>kept</b>.txt')||f.conflictCard.querySelector('b'))throw new Error('Conflict names are missing or interpreted as markup');
            const box=f.conflictCard.getBoundingClientRect();if(box.left<-1||box.right>innerWidth+1||f.conflictCard.scrollWidth>f.conflictCard.clientWidth+2)throw new Error('Conflict dialog overflows');
            if(f.conflictCard.querySelectorAll('[data-choice]').length!==(variant==='web-folder'?2:3))throw new Error('Conflict policy offers unsafe or missing choices');
          `);
          await shot(prefix+'-conflict-'+variant);
          await execute(`
            const f=window.__webFilesFixture;await setTermaLanguage(${JSON.stringify(language==='zh-CN'?'en-US':'zh-CN')});
            const variant=${JSON.stringify(variant)},card=$('modal').querySelector('.modal-card');
            if(card!==f.conflictCard||!card.textContent.includes('<b>kept</b>.txt'))throw new Error('Language switch replaced conflict context');
            const expectedTitle=tr(variant==='upload'?'sftp:transfer.same_name_title':'navigation:transfer.local_conflict_title');
            if(card.querySelector('h2')?.textContent!==expectedTitle)throw new Error('Open conflict title did not translate');
            const keys=variant==='upload'?['sftp:transfer.overwrite_same_name','sftp:transfer.auto_rename','sftp:transfer.cancel_upload']:[...(variant==='web-folder'?[]:['common:auto.overwrite']),'common:auto.auto_rename','common:actions.cancel'];
            const buttons=[...card.querySelectorAll('[data-choice]')];if(buttons.some((button,index)=>button.textContent.trim()!==tr(keys[index])))throw new Error('Open conflict actions did not translate');
            if(variant==='web-folder'&&!card.textContent.includes(tr('sftp:web_files.folder_conflict_hint')))throw new Error('Folder conflict hint did not translate');
            if(variant==='web-file'&&!card.textContent.includes(tr('sftp:web_files.receive_conflicts',{count:1})))throw new Error('File conflict summary did not translate');
          `);
          await shot(prefix+'-conflict-'+variant+'-live-language');
          await execute(`const f=window.__webFilesFixture;[...f.conflictCard.querySelectorAll('[data-choice]')].at(-1).click();const value=await f.conflict;if(value!==${JSON.stringify(variant==='upload'?'':'cancel')}||f.mutations.length!==2||!$('modal').hidden)throw new Error('Cancelling a conflict changed files or policy');`);
        }
        await execute(`
          const f=window.__webFilesFixture,key=f.key;let root=window.termaLocalFileRuntime.root(key);
          await setTermaLanguage(${JSON.stringify(language)});
          closeModal();
          const rectangle=root.querySelector('.web-files-shell').getBoundingClientRect();
          if(rectangle.left < -1 || rectangle.right>innerWidth+1 || rectangle.width<1)throw new Error('Device pane overflow '+JSON.stringify({left:rectangle.left,right:rectangle.right,width:innerWidth}));
          await window.termaLocalFileRuntime.pages.open('',true,key,'browser');
          const runtime=window.termaLocalFileRuntime.files.states.get(key);
          runtime.browserDirectory.name='Selected folder';
          runtime.browserDirectory.files=[new File(['browser fixture'],'local.txt')];
          Object.defineProperty(runtime.browserDirectory.files[0],'webkitRelativePath',{value:'Selected folder/local.txt'});
          await window.termaLocalFileRuntime.files.load(key,{path:'/browser',location:'directory'});
          root=window.termaLocalFileRuntime.root(key);
          // Switching source re-renders the source label and action controls.
          if(!root.querySelector('.web-files-origin').textContent.includes(window.termaLocalFileRuntime.pages.label('browser')))throw new Error('Computer source is not labelled');
          if(!root.querySelector('[data-action="web-files-choose-readonly"]'))throw new Error('Read-only folder fallback missing');
          if(root.querySelectorAll('.local-files-row').length!==1)throw new Error('Browser-selected folder missing');
          if(!root.querySelector('[data-action="web-files-create"]').disabled)throw new Error('HTTP fallback allows writes');
          if(!root.querySelector('.web-files-hint').textContent.includes(tr('sftp:web_files.readonly_hint')))throw new Error('HTTP restriction not explained');
          if(${JSON.stringify(language)}==='en-US' && Array.from(root.textContent).some(char=>{const point=char.codePointAt(0);return point>=0x3400&&point<=0x9fff;}))throw new Error('Untranslated file pane');
          const browserRect=root.querySelector('.web-files-shell').getBoundingClientRect();
          if(browserRect.right>innerWidth+1 || browserRect.left < -1)throw new Error('Browser pane overflow');
        `);
        await shot(prefix+'-browser-readonly');
        await folderPrompt(prefix,'browser',language);
        await execute(`const f=window.__webFilesFixture;window.termaLocalFileRuntime.root(f.key).querySelector('[data-action="web-files-row-open"][data-path="/browser/local.txt"]').click();await f.until(()=>$('fileTextContent'));if(!$('fileTextContent')?.readOnly||!$('fileTextSave')?.disabled||$('fileTextContent').value!=='browser fixture')throw new Error('Read-only browser editor is writable or missing');`);
        await shot(prefix+'-browser-readonly-editor');
        Object.assign(result,{browser:true,readonly:true,draft:true,busy:true,error:true,retry:true,renameCollision:true,deleteCancel:true,conflictLiveLanguage:true,folderPromptLiveLanguage:true,dropRouting:true});
      } finally {
        await execute(`const f=window.__webFilesFixture;if(f){closeModal();api=f.previous.api;closeTabsByKey([f.key]);document.documentElement.dataset.theme=f.previous.theme;await setTermaLanguage(f.previous.language||'zh-CN',{emit:false});delete window.__webFilesFixture;}`);
      }
      results.push(result);
    }
  }
  window.setSize(1200,800);
  console.log('[ui-smoke] web files',JSON.stringify(results));
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({results,screenshots:screenshots.length,states:screenshots},null,2));
  return results;
}
async function runLocalFilesToolbarUiScenario(browser) {
  const directory=path.join(process.env.TERMA_UI_DIAGNOSTICS_DIR||'data','local-files-toolbar');
  fs.mkdirSync(directory,{recursive:true});
  const execute=source=>browser.webContents.executeJavaScript(`(async()=>{${source}})()`);
  const frame='await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));';
  const shot=async name=>{
    await execute(`${frame}
      const transitions=document.getAnimations().filter(animation=>animation instanceof CSSTransition && animation.playState==='running');
      await Promise.allSettled(transitions.map(animation=>animation.finished));
      ${frame}
    `);
    browser.webContents.invalidate();
    fs.writeFileSync(path.join(directory,name+'.png'),(await browser.webContents.capturePage()).toPNG());
  };
  await execute(`
    window.termaWorkspaceRefresh.stop(); window.termaWorkspaceShell.dismissGuide(); dismissToast();
    window.__localToolbar={api,desktop:window.termaDesktop,key:'local-files-toolbar-qa',path:'C:/QA/Desktop',requests:[]};
    const f=window.__localToolbar;
    if(!window.termaDesktop)window.termaDesktop={};
    api=(url,options)=>{
      if(!url.startsWith('/api/local-files?'))return f.api(url,options);
      const requested=new URL(url,location.href).searchParams.get('path')||f.path;
      f.requests.push(requested);
      return Promise.resolve({path:requested,kind:'directory',parent:'C:/QA',entries:[
        {name:'Documents',path:requested+'/Documents',type:'dir',size:0,mtime:1795200000},
        {name:'notes.txt',path:requested+'/notes.txt',type:'file',size:1024,mtime:1795200100}
      ]});
    };
  `);
  const cases=[];
  try {
    for(const width of [1200,390])for(const locale of ['zh-CN','en-US'])for(const theme of ['light','dark']){
      browser.setContentSize(width,824);
      const geometry=await execute(`
        await setTermaLanguage('${locale}'); applyTheme('${theme}');syncResponsivePane();window.termaWorkspaceShell.setCollapsed(true);
        const f=window.__localToolbar;
        await window.termaLocalFileRuntime.pages.open(f.path,true,f.key);if(isMobileLayout())window.termaWorkspaceShell.showMobileWorkspace();
        ${frame}
        const root=window.termaLocalFileRuntime.root(f.key).querySelector('.terma-local-files-root'),top=root.querySelector('.local-files-top'),
          toolbar=top.querySelector('.local-files-toolbar'),search=top.querySelector('.local-files-search'),nav=top.querySelector('.local-files-navigation-row'),
          list=root.querySelector('.local-files-list'),head=list.querySelector('.local-files-head');
        const box=node=>node.getBoundingClientRect(),visible=node=>node.checkVisibility();
        if(!head||!visible(head)||!list.querySelector('.local-files-row'))throw Error('Native file list did not render');
        if(root.dataset.theme!=='${theme}'||document.documentElement.lang!=='${locale}')throw Error('Native file view did not adopt the selected theme and language');
        const height=box(top).height,listGap=box(list).top-box(top).bottom;
        if(listGap<0||listGap>6||(${width}===1200&&height>80))throw Error('Native header layout '+JSON.stringify({height,listGap}));
        if(search.querySelector('input').placeholder!==tr('sftp:auto.search_current')||!nav.querySelector('[aria-current="page"]')?.textContent.includes('Desktop'))throw Error('Localized search or active directory missing');
        if(${width}===1200?Math.abs(box(toolbar).top-box(search).top)>3:box(search).top<box(toolbar).bottom)throw Error('Search and navigation rows do not fit');
        for(const control of top.querySelectorAll('button,input'))if(visible(control)){
          const r=box(control),b=box(top);if(r.width===0||r.left<b.left-1||r.right>b.right+1||r.bottom>b.bottom+1)throw Error('Clipped control: '+control.getAttribute('aria-label'));
          if(control.matches('button:not(.crumb)')&&!control.getAttribute('aria-label'))throw Error('Unlabelled toolbar button');
        }
        return {height,listGap,headHeight:box(head).height};
      `);
      const name=`${width}-${locale}-${theme}`;
      await shot(name);
      const point=await execute(`
        const button=window.termaLocalFileRuntime.root(window.__localToolbar.key).querySelector('.local-files-path-edit-button'),r=button.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);
        if(!button.contains(document.elementFromPoint(x,y)))throw Error('Path edit button is covered');return {x,y};
      `);
      for(const type of ['mouseMove','mouseDown','mouseUp'])browser.webContents.sendInputEvent(type==='mouseMove'?{type,...point}:{type,...point,button:'left',clickCount:1});
      await execute(`
        ${frame}
        const root=window.termaLocalFileRuntime.root(window.__localToolbar.key),field=root.querySelector('.local-files-path-editor input');
        if(document.activeElement!==field||field.value!=='C:/QA/Desktop')throw Error('Path editor did not focus the current directory');
        field.value='C:/QA/Unsaved';field.dispatchEvent(new Event('input',{bubbles:true}));
        await setTermaLanguage('${locale==='zh-CN'?'en-US':'zh-CN'}');
        if(field.value!=='C:/QA/Unsaved'||document.activeElement!==field||field.getAttribute('aria-label')!==tr('sftp:local_files.path'))throw Error('Open path editor lost draft, focus, or translation');
        await setTermaLanguage('${locale}');
        if(field.value!=='C:/QA/Unsaved'||document.activeElement!==field)throw Error('Restoring the original language lost the draft or focus');
      `);
      await shot(name+'-path-edit');
      await execute(`
        const f=window.__localToolbar,root=window.termaLocalFileRuntime.root(f.key);
        root.querySelector('[data-action="local-files-path-cancel"]').click();
        if(!root.querySelector('.local-files-breadcrumb').checkVisibility()||window.termaLocalFileRuntime.files.state(f.key).path!==f.path)throw Error('Cancel changed the current folder');
        const search=root.querySelector('.local-files-search input');search.value='notes';search.dispatchEvent(new Event('input',{bubbles:true}));
        if(window.termaLocalFileRuntime.files.state(f.key).query!=='notes')throw Error('Search input did not update');
        root.querySelector('[data-action="local-files-search-clear"]').click();
        if(window.termaLocalFileRuntime.files.state(f.key).query)throw Error('Search clear did not update');
      `);
      cases.push({name,...geometry});
    }
  } finally {
    await execute(`const f=window.__localToolbar;closeTabsByKey([f.key]);api=f.api;if(!f.desktop)delete window.termaDesktop;delete window.__localToolbar;`);
    browser.setContentSize(1200,800);
  }
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(cases,null,2));
  console.log('[ui-smoke] local files toolbar passed',JSON.stringify(cases));
}
module.exports={runWebFilesUiScenario,runLocalFilesToolbarUiScenario};
