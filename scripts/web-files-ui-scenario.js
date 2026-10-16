const fs=require('node:fs');
const path=require('node:path');
async function runWebFilesUiScenario(window) {
  const results=[];
  for(const width of [1200,392]) {
    window.setSize(width,850);
    for(const language of ['zh-CN','en-US'])for(const theme of ['light','dark']) {
      const result=await window.webContents.executeJavaScript(`(async()=>{
        const previous={api,language:document.documentElement.lang,theme:document.documentElement.dataset.theme};
        const key='web-files-smoke-'+${width};
        try {
          await setTermaLanguage(${JSON.stringify(language)},{emit:false});
          document.documentElement.dataset.theme=${JSON.stringify(theme)};
          api=async(url,options={})=>{
            if(url.startsWith('/api/server-files/text'))return {content:'Fixture text'};
            if(url.startsWith('/api/server-files?') && !new URL(url,'http://terma.test').searchParams.get('path'))return {path:'',kind:'computer',entries:[{name:'files',path:'/fixture',type:'drive',root_kind:'workspace',display_path:'/private/files'},{name:'files',path:'/authorized',type:'drive',root_kind:'authorized',display_path:'/volume/terma/files'}]};
            if(url.startsWith('/api/server-files'))return {path:'/fixture',display_path:'Files',kind:'directory',entries:[{name:'sample.txt',path:'/fixture/sample.txt',type:'file',size:24,mtime:1000},{name:'Folder',path:'/fixture/Folder',type:'dir',size:0,mtime:1000}]};
            return previous.api(url,options);
          };
          await openWebFiles('',true,key,'server');
          await new Promise(resolve=>requestAnimationFrame(resolve));
          let root=localFilesRoot(key);
          if(root.querySelectorAll('.web-files-root-path').length!==2)throw new Error('Root paths are missing');
          const labels=[...root.querySelectorAll('.local-files-file-name')].map(node=>node.textContent);
          if(new Set(labels).size!==labels.length)throw new Error('Root labels are ambiguous');
          if(root.querySelector('[data-action="web-files-create"]').title===webFilesTr('readonly_hint'))throw new Error('Device root shows a browser-only restriction');
          await loadWebFiles(key,'/fixture');
          if(root.querySelector('[data-action="web-files-create"]').disabled || root.querySelector('[data-action="web-files-create"]').title===webFilesTr('readonly_hint'))throw new Error('Writable folder retains a read-only tooltip');
          if(!root.querySelector('.web-files-origin').textContent.includes(webFilesSourceLabel('server')))throw new Error('Device source is not labelled');
          const search=root.querySelector('.web-files-search input');
          if(search.getBoundingClientRect().width<100)throw new Error('Search input is collapsed');
          if(root.querySelector('.web-files-path').textContent!=='Files')throw new Error('Directory path is missing');
          for(const node of root.querySelectorAll('.web-files-navigation>*')){const box=node.getBoundingClientRect();const parent=root.getBoundingClientRect();if(box.right>parent.right+1 || box.left<parent.left-1)throw new Error('Navigation control overflows');}
          if(root.querySelectorAll('.local-files-row').length!==2)throw new Error('Device entries missing');
          if(workspaceGroupPersistableTab(workspaceTabByKey(key)).fileSource!=='server')throw new Error('Device source not persisted');
          await openWebFile(key,'/fixture/sample.txt');
          if(!$('modal').querySelector('textarea') || $('modal').querySelector('textarea').value!=='Fixture text')throw new Error('Device editor failed');
          if(${JSON.stringify(language)}==='en-US' && /[\\u3400-\\u9fff]/.test($('modal').textContent))throw new Error('Untranslated editor');
          closeModal();
          const rectangle=root.querySelector('.web-files-shell').getBoundingClientRect();
          if(rectangle.left < -1 || rectangle.right>innerWidth+1 || rectangle.width<1)throw new Error('Device pane overflow '+JSON.stringify({left:rectangle.left,right:rectangle.right,width:innerWidth}));
          await openWebFiles('',true,key,'browser');
          const runtime=webFilesRuntime(key);
          runtime.browserDirectory.name='Selected folder';
          runtime.browserDirectory.files=[new File(['browser fixture'],'local.txt')];
          Object.defineProperty(runtime.browserDirectory.files[0],'webkitRelativePath',{value:'Selected folder/local.txt'});
          await loadWebFiles(key,'/browser');
          root=localFilesRoot(key);
          // Switching source re-renders the source label and action controls.
          if(!root.querySelector('.web-files-origin').textContent.includes(webFilesSourceLabel('browser')))throw new Error('Computer source is not labelled');
          if(!root.querySelector('[data-action="web-files-choose-readonly"]'))throw new Error('Read-only folder fallback missing');
          if(root.querySelectorAll('.local-files-row').length!==1)throw new Error('Browser-selected folder missing');
          if(!root.querySelector('[data-action="web-files-create"]').disabled)throw new Error('HTTP fallback allows writes');
          if(!root.querySelector('.web-files-hint').textContent.includes(webFilesTr('readonly_hint')))throw new Error('HTTP restriction not explained');
          if(${JSON.stringify(language)}==='en-US' && /[\\u3400-\\u9fff]/.test(root.textContent))throw new Error('Untranslated file pane');
          const browserRect=root.querySelector('.web-files-shell').getBoundingClientRect();
          if(browserRect.right>innerWidth+1 || browserRect.left < -1)throw new Error('Browser pane overflow');
          if(!localFilesToolbarButtonHtml(key).includes('local-files-new-tab'))throw new Error('SFTP shortcut missing');
          return {width:innerWidth,language:${JSON.stringify(language)},theme:${JSON.stringify(theme)},device:true,browser:true,readonly:true};
        } finally {
          closeModal(); api=previous.api;
          closeTabsByKey([key]);
          document.documentElement.dataset.theme=previous.theme;
          await setTermaLanguage(previous.language || 'zh-CN',{emit:false});
        }
      })()`);
      results.push(result);
    }
  }
  window.setSize(1200,800);
  console.log('[ui-smoke] web files',JSON.stringify(results));
  return results;
}
module.exports={runWebFilesUiScenario};
