async function runSftpRenameUiScenario(window) {
  const result=await window.webContents.executeJavaScript(`(async()=>{
    const previous={api,refreshSftp,isMobileLayout};
    const fixture=document.createElement('div');
    fixture.style.cssText='position:fixed;left:30px;top:80px;width:500px;z-index:1000;background:var(--panel)';
    fixture.innerHTML='<div class="sftp-row"><input class="sftp-check" type="checkbox" checked><span class="sftp-file-name">sample.txt</span></div>';
    document.body.appendChild(fixture);
    const label=fixture.querySelector('.sftp-file-name');let request=null;
    try {
      isMobileLayout=()=>false;refreshSftp=async()=>{};
      api=async(url,options)=>{request={url,data:JSON.parse(options.body)};return {ok:true};};
      beginSftpInlineRename(label,'rename-ui',7,'/fixture/sample.txt','sample.txt','file');
      let field=fixture.querySelector('input.sftp-inline-rename-input');
      if(!field || field.selectionStart!==0 || field.selectionEnd!==6)throw new Error('Filename stem is not selected');
      field.value='cancelled.txt';field.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      if(fixture.querySelector('.sftp-inline-rename-input') || request)throw new Error('Escape saved a rename');
      beginSftpInlineRename(label,'rename-ui',7,'/fixture/sample.txt','sample.txt','file');
      field=fixture.querySelector('.sftp-inline-rename-input');field.value='renamed.txt';field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      await new Promise(resolve=>setTimeout(resolve,20));
      if(request?.data?.from!=='/fixture/sample.txt' || request?.data?.to!=='/fixture/renamed.txt' || fixture.querySelector('.sftp-inline-rename-input'))throw new Error('Enter rename failed');
      request=null;
      beginSftpInlineRename(label,'rename-ui',7,'/fixture/folder','folder','dir');
      field=fixture.querySelector('.sftp-inline-rename-input');
      if(field.selectionEnd!==6)throw new Error('Folder name is not fully selected');
      field.value='new-folder';field.dispatchEvent(new FocusEvent('blur'));
      await new Promise(resolve=>setTimeout(resolve,20));
      if(request?.data?.to!=='/fixture/new-folder')throw new Error('Folder blur rename failed');
      return {escape:true,enter:true,blur:true,file:true,directory:true};
    } finally {sftpInlineRenameEditor?.cancel();cancelSftpInlineRename();fixture.remove();api=previous.api;refreshSftp=previous.refreshSftp;isMobileLayout=previous.isMobileLayout;}
  })()`);
  console.log('[ui-smoke] inline rename',JSON.stringify(result));
}
module.exports={runSftpRenameUiScenario};
