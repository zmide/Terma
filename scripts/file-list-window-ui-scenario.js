"use strict";
async function runLocalFileWindowMatrix({execute,wait,check,shot,prefix}) {
  await execute(`const f=window.__panelFixture;f.fileApi=api;f.fileRequests=[];f.localKey='local-window-review';
    api=async(url,options={})=>{
      if(!url.startsWith('/api/local-files?'))return f.fileApi(url,options);
      const p=new URL(url,location.origin).searchParams,path=p.get('path'),page=Number(p.get('page')),size=Number(p.get('page_size'));
      f.fileRequests.push({path,page,size});const total=path==='/large'?50000:2;
      return {path,kind:'directory',parent:'/',parent_kind:'directory',page,page_size:size,total,total_pages:Math.ceil(total/size),
        entries:Array.from({length:Math.max(0,Math.min(size,total-(page-1)*size))},(_,i)=>{const name='file-'+String((page-1)*size+i).padStart(5,'0')+'.txt';
          return {name,path:path+'/'+name,type:'file',size:128,mtime:1700000000};})};
    };
    const host=document.createElement('section');host.id='fileWindowReview';host.style.cssText='position:fixed;display:flex;flex-direction:column;container-type:inline-size;container-name:local-files-view;inset:80px 4px 4px;z-index:90;background:var(--bg);min-width:0;overflow:hidden';
    document.body.append(host);const r=window.termaLocalFileRuntime;
    window.termaLocalFileViews.mount(host,r.viewOptions(f.localKey));
    await r.files.load(f.localKey,{path:'/large',page:1});
  `);
  try {
    await wait("document.querySelector('#fileWindowReview .local-files-row[data-path=\"/large/file-00000.txt\"]')");
    await check(prefix+' local continuous fixed rows and flat compact footer',`(()=>{
      const root=document.querySelector('#fileWindowReview'),list=root.querySelector('.local-files-list'),row=root.querySelector('.local-files-row');
      return !root.querySelector('.local-files-pagination')&&root.querySelector('.file-list-status').getBoundingClientRect().height<=25&&
        Math.abs(row.getBoundingClientRect().height-parseFloat(getComputedStyle(list).getPropertyValue('--file-row-height')))<1;
    })()`);
    await execute(`const f=window.__panelFixture;window.termaLocalFileRuntime.files.select(f.localKey,'/large/file-00000.txt',{},true)`);
    await shot(prefix+'-local-files-first');
    await execute(`const n=document.querySelector('#fileWindowReview .local-files-list');
      n.scrollTop=25000*parseFloat(getComputedStyle(n).getPropertyValue('--file-row-height'));n.dispatchEvent(new Event('scroll'))`);
    await wait("document.querySelector('#fileWindowReview .local-files-row[data-path=\"/large/file-25000.txt\"]')");
    await check(prefix+' local middle request bounds and offscreen selection',`(()=>{
      const f=window.__panelFixture;return document.querySelectorAll('#fileWindowReview .local-files-row').length<55&&
        window.termaLocalFileRuntime.files.selected(f.localKey).some(e=>e.path==='/large/file-00000.txt')&&
        f.fileRequests.every(r=>r.size<=200)&&f.fileRequests.length<8;
    })()`);
    await shot(prefix+'-local-files-middle');
    await execute(`const n=document.querySelector('#fileWindowReview .local-files-list');n.scrollTop=n.scrollHeight;n.dispatchEvent(new Event('scroll'))`);
    await wait("document.querySelector('#fileWindowReview .local-files-row[data-path=\"/large/file-49999.txt\"]')");
    await shot(prefix+'-local-files-last');
    await execute(`const f=window.__panelFixture;await window.termaLocalFileRuntime.files.load(f.localKey,{path:'/other',page:1})`);
    await wait("document.querySelector('#fileWindowReview .local-files-list').scrollTop===0&&document.querySelectorAll('#fileWindowReview .local-files-row').length===2");
    await check(prefix+' local navigation clears stale selection', "window.termaLocalFileRuntime.files.selected(window.__panelFixture.localKey).length===0");
    await check(prefix+' local English DOM and attributes',`document.documentElement.lang!=='en-US'||(()=>{
      const root=document.querySelector('#fileWindowReview');
      return !/[\\u3400-\\u9fff]/.test(root.textContent)&&[...root.querySelectorAll('*')].every(n=>
        ['title','aria-label','placeholder'].every(k=>!/[\\u3400-\\u9fff]/.test(n.getAttribute(k)||'')));
    })()`);
    await check(prefix+' local viewport bounds',`(()=>{
      const root=document.querySelector('#fileWindowReview'),r=root.getBoundingClientRect();
      return [...root.querySelectorAll('button,input')].filter(n=>n.checkVisibility()).every(n=>{
        const b=n.getBoundingClientRect();return b.left>=r.left-1&&b.right<=r.right+1;
      });
    })()`);
  } finally {
    await execute(`const f=window.__panelFixture;window.termaLocalFileViews.release(f.localKey);
      window.termaLocalFileRuntime.files.dispose(f.localKey);document.querySelector('#fileWindowReview')?.remove();api=f.fileApi`);
  }
}
module.exports={runLocalFileWindowMatrix};
