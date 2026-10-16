const fs = require('node:fs');
const path = require('node:path');

// Uses the harness's real temporary filesystem and HTTP routes, without API mocks.
async function runWebFilesRealUiScenario(window) {
  await new Promise(resolve=>setTimeout(resolve,2200));
  for (const language of ['en-US', 'zh-CN']) {
    await window.webContents.executeJavaScript(`(async()=>{
      await setTermaLanguage(${JSON.stringify(language)},{emit:false});
      dismissOperationPanePinGuide();setOperationPaneCollapsed(true);
      const key=await openWebFiles('',true,'','server');
      const runtime=webFilesRuntime(key);
      const workspace=runtime.entries.find(entry=>entry.root_kind==='workspace');
      if(!workspace)throw new Error('Missing isolated device root');
      await loadWebFiles(key,workspace.path+'/Documentation');
      if(runtime.entries.length!==2)throw new Error('Real device files did not load');
      const entry=runtime.entries.find(entry=>entry.name==='README.md');
      await openWebFile(key,entry.path);
      if(!$('modal').querySelector('textarea')?.value.includes('Terma'))throw new Error('Real text content did not load');
      closeModal();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      for(const button of document.querySelectorAll('.toast .toast-head>button'))button.click();
      const root=localFilesRoot(key),search=root.querySelector('.web-files-search input');
      if(search.getBoundingClientRect().width<120)throw new Error('Real search layout is collapsed');
      const button=root.querySelector('[data-action="web-files-new"]');
      const rect=button.getBoundingClientRect();
      showWebFilesSourceMenu(new MouseEvent('click',{clientX:rect.left,clientY:rect.bottom+4}));
      if(!$('actionMenu')?.textContent.includes(webFilesSourceLabel('browser')) || !$('actionMenu')?.textContent.includes(webFilesSourceLabel('server')))throw new Error('Real source menu is missing');
    })()`);
    await new Promise(resolve=>setTimeout(resolve,120));
    const image=await window.webContents.capturePage();
    const output=path.join(process.cwd(),'.github','assets','screenshots',language,'browser-files.png');
    fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,image.toPNG());
    await window.webContents.executeJavaScript("hideActionMenu();closeTabsByKey(tabs.filter(tab=>tab.fileSource).map(tab=>tab.key))");
  }
  console.log('[ui-smoke] real device files passed: HTTP listing, text read, source menu and search layout');
}
module.exports={runWebFilesRealUiScenario};
