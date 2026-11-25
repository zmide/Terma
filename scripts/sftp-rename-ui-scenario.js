async function runSftpRenameUiScenario(browser) {
  const result=await browser.webContents.executeJavaScript(`(async()=>{
    const previous={api,load:window.termaSftpDirectoryWorkspace.loader.load};
    const key='rename-ui',id=99992,tab={key,id,kind:'sftp',title:'Rename fixture'};
    const fixture=document.createElement('section');fixture.id='view-sftp';fixture.className='workspace';
    fixture.style.cssText='position:fixed;inset:60px 20px 20px;z-index:1000;background:var(--panel)';
    document.body.append(fixture);tabs.push(tab);
    const runtime={tabKey:key,connectionId:id,status:'connected',state:{connectionId:id,path:'/fixture',entries:[{name:'sample.txt',type:'file',size:1},{name:'folder',type:'dir',size:0}],selected:null}};
    sftpTabRuntimes.set(key,runtime);let request=null;
    const options={model:{key,connectionId:id,quick:false,desktop:false,mobile:false,encoding:'UTF-8',status:'connected',error:'',state:{...runtime.state,query:'',recursiveSearch:false,recursiveSearchTruncated:false,sort:'name',dir:'asc',page:1,pageSize:50,total:2,totalPages:1,unfilteredTotal:2,loading:false},selectedPaths:[],columns:['name','size','mtime','access'],favorite:false,favorites:[],clipboard:null,hasRemoteJump:false,hasLocalFiles:false,historyBack:false,historyForward:false},
      text:(key,params)=>tr(key,params),bytes:window.termaSftpTaskWorkspace.presentation.bytes,time:String,path:name=>'/fixture/'+name,isArchive:window.termaSftpFileActions.isArchive,isImage:window.termaSftpPreviewRuntime.editor.isSftpImageName,directorySize:()=>({...window.termaSftpDirectoryWorkspace.cache.presentation(null),key:'rename'}),opening:()=>false,
      run:(action,...args)=>action==='inlineRename'?window.termaSftpFileActions.operations.inlineRename(key,id,args[0].path,args[1]):null};
    const begin=index=>{const label=fixture.querySelectorAll('.sftp-row .sftp-name')[index];label.click();label.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true}));return fixture.querySelector('.sftp-inline-rename-input');};
    try {
      window.termaSftpDirectoryWorkspace.loader.load=async()=>{};api=async(url,options)=>{request={url,data:JSON.parse(options.body)};return {ok:true};};
      window.termaSftpViews.mount(fixture,options);window.termaSftpViews.refresh(key,options,'list');
      let field=begin(0);if(!field||field.selectionStart!==0||field.selectionEnd!==6)throw new Error('Filename stem is not selected');
      field.value='cancelled.txt';field.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      if(fixture.querySelector('.sftp-inline-rename-input')||request)throw new Error('Escape saved a rename');
      field=begin(0);field.value='renamed.txt';field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await new Promise(resolve=>setTimeout(resolve,30));
      if(request?.data?.from!=='/fixture/sample.txt'||request?.data?.to!=='/fixture/renamed.txt'||fixture.querySelector('.sftp-inline-rename-input'))throw new Error('Enter rename failed');
      request=null;field=begin(1);if(field?.selectionEnd!==6)throw new Error('Folder name is not fully selected');
      field.value='new-folder';field.dispatchEvent(new FocusEvent('blur'));await new Promise(resolve=>setTimeout(resolve,30));
      if(request?.data?.to!=='/fixture/new-folder')throw new Error('Folder blur rename failed');
      return {escape:true,enter:true,blur:true,file:true,directory:true,vue:true};
    } finally {window.termaSftpViews.release(key);sftpTabRuntimes.delete(key);tabs.splice(tabs.indexOf(tab),1);fixture.remove();api=previous.api;window.termaSftpDirectoryWorkspace.loader.load=previous.load;}
  })()`);
  console.log('[ui-smoke] inline rename',JSON.stringify(result));
}
module.exports={runSftpRenameUiScenario};
