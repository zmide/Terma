async function runSftpPickerUiScenario({browser,execute,check,shot},name){
  await execute(`const f=window.__sftpVueFixture,c=window.__sftpTransferFixture,centerHidden=c.center.hidden;c.reset();c.center.hidden=true;
    const input=f.root.querySelector('#sftpUpload'),product=window.termaSftpView.options(c.key);c.picker={input,click:input.click,run:f.options.run,notify,path:f.options.model.state.path,toolbar:f.options.model.mobileToolbarExpanded,centerHidden};f.options.model.mobileToolbarExpanded=true;
    c.pickerClicks=0;input.click=()=>{c.pickerClicks++;};
    f.options.run=(action,...args)=>{if(['chooseUpload','cancelUpload','upload'].includes(action)){const result=product.run(action,...args);if(action==='upload')c.pickerPending=result;return result;}return c.picker.run(action,...args);};
    notify=(message,kind)=>{c.notices.push({message,kind});c.picker.notify(message,kind);};
    window.termaSftpViews.refresh(f.key,f.options);
  `);
  const pointer=async()=>{
    const point=await execute(`const node=window.__sftpVueFixture.root.querySelector('#sftpUpload').previousElementSibling;if(node?.tagName!=='BUTTON')throw Error('Missing upload chooser button');node.scrollIntoView({block:'nearest'});const r=node.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!node.contains(document.elementFromPoint(x,y)))throw Error('Obscured upload chooser');return {x:Math.round(x),y:Math.round(y)};`);
    await execute(`window.__sftpTransferFixture.pickerPending=null;`);
    for(const type of ['mouseMove','mouseDown','mouseUp'])browser.webContents.sendInputEvent({type,...point,button:'left',clickCount:1});
    await new Promise(resolve=>setTimeout(resolve,80));
    return point;
  };
  try{
    await pointer();
    await check(`${name} upload chooser captures target`, `window.__sftpTransferFixture.pickerClicks>0`);
    await execute(`const f=window.__sftpVueFixture,c=window.__sftpTransferFixture;c.runtime.state.path='/changed-after-picker';f.options.model.state.path=c.runtime.state.path;window.termaSftpViews.refresh(f.key,f.options);
      const input=c.picker.input,files=new DataTransfer();files.items.add(new File(['picker!!'],'picker.txt'));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));await c.pickerPending;`);
    await check(`${name} stale chooser creates no upload`, `(()=>{const f=window.__sftpVueFixture,c=window.__sftpTransferFixture,input=f.root.querySelector('#sftpUpload'),mutations=c.requests.filter(r=>/\\/(upload-plan|upload-job|mkdir)$/.test(r.url)),notified=c.notices.some(n=>n.message===tr('sftp:transfer.upload_target_changed')),cleared=input.files.length===0;const ok=!mutations.length&&notified&&cleared;if(!ok)console.error('Upload picker diagnostics',JSON.stringify({mutations,notices:c.notices,expected:tr('sftp:transfer.upload_target_changed'),files:input.files.length,originalFiles:c.picker.input.files.length,sameInput:input===c.picker.input,path:c.runtime.state.path,clicks:c.pickerClicks}));return ok})()`);
    await shot(`${name}-picker-target-changed`);
    await execute(`dismissToast();const f=window.__sftpVueFixture,c=window.__sftpTransferFixture;c.reset();f.options.model.state.path='/var/data';window.termaSftpViews.refresh(f.key,f.options);c.center.hidden=true;
      f.root.querySelector('#sftpUpload').previousElementSibling.click();c.picker.input.dispatchEvent(new Event('cancel'));const before=c.pickerClicks;f.root.querySelector('#sftpUpload').previousElementSibling.click();c.pickerRetried=c.pickerClicks===before+1;c.mode='ok';
      const files=new DataTransfer();files.items.add(new File(['picker!!'],'picker.txt'));c.picker.input.files=files.files;c.picker.input.dispatchEvent(new Event('change',{bubbles:true}));
      for(let i=0;i<50&&!c.bodies.length;i++)await new Promise(resolve=>setTimeout(resolve,20));`);
    await check(`${name} cancelled chooser retries on the captured folder`, `(()=>{const c=window.__sftpTransferFixture,r=c.requests.find(r=>r.url.endsWith('/upload-job'));return c.pickerRetried&&c.bodies.length===1&&r.body.path==='/var/data'&&r.body.filename==='picker.txt'})()`);
    await execute(`const c=window.__sftpTransferFixture;c.bodies[0].done();await c.pickerPending;`);
    await check(`${name} successful chooser clears only its input`, `window.__sftpTransferFixture.picker.input.files.length===0`);
    await shot(`${name}-picker-upload-completed`);
  }finally{
    await execute(`const f=window.__sftpVueFixture,c=window.__sftpTransferFixture;if(c?.picker){c.picker.input.click=c.picker.click;f.options.run=c.picker.run;notify=c.picker.notify;f.options.model.state.path=c.picker.path;f.options.model.mobileToolbarExpanded=c.picker.toolbar;c.runtime.state.path='/var/data';c.center.hidden=c.picker.centerHidden;dismissToast();window.termaSftpViews.refresh(f.key,f.options);delete c.picker;}`);
  }
}
module.exports={runSftpPickerUiScenario};
