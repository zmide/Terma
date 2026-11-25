async function runSftpDragFeedbackUiScenario({execute,check,shot}){
  const previous=await execute(`return {theme:document.documentElement.dataset.theme,language:document.documentElement.lang}`);
  for(const theme of ['light','dark'])for(const language of ['zh-CN','en-US']){
    const name=`drag-feedback-${language}-${theme}`;
    await execute(`
      const e=window.__sftpVueFixture.entrypoint;
      applyTheme(${JSON.stringify(theme)});await setTermaLanguage(${JSON.stringify(language)});
      window.termaSftpDragWorkspace.dropFeedback.external(true,{tabKey:e.key,path:'/entry'});
      window.termaSftpDragWorkspace.drag.feedbackView.showPreview([{name:'drag <img src=x>.txt',path:'/entry/drag.txt',type:'file'},{name:'second.txt',path:'/entry/second.txt',type:'file'}],48,180);
      window.termaSftpDragWorkspace.drag.feedback.activity();
    `);
    await check(`${name} Vue hint and preview render safely within the pane`, `(()=>{
      const e=window.__sftpVueFixture.entrypoint,hint=$('sftpDragHint'),preview=$('sftpDragPreview'),overlay=window.termaSftpView.element('sftpDropOverlay',e.key),rect=hint?.getBoundingClientRect(),p=preview?.getBoundingClientRect(),o=overlay?.getBoundingClientRect(),list=window.termaSftpView.element('sftpList',e.key)?.getBoundingClientRect();
      return !!hint?.querySelector('svg')&&hint.textContent===tr('sftp:transfer.drop_upload_to',{target:'/entry'})&&preview?.textContent.includes('drag <img src=x>.txt')&&!preview.querySelector('img')&&rect.left>=-1&&rect.right<=innerWidth+1&&p.left>=-1&&p.right<=innerWidth+1&&!overlay.hidden&&o.left>=list.left-1&&o.right<=list.right+1&&o.bottom<=innerHeight+1;
    })()`);
    await shot(name);
    await execute(`await setTermaLanguage(${JSON.stringify(language==='zh-CN'?'en-US':'zh-CN')});window.termaSftpDragWorkspace.drag.feedback.activity();`);
    await check(`${name} open feedback translates without replacing the file name`, `$('sftpDragHint')?.textContent===tr('sftp:transfer.drop_upload_to',{target:'/entry'})&&$('sftpDragPreview')?.querySelector('strong')?.textContent==='drag <img src=x>.txt'&&$('sftpDragPreview')?.querySelector('small')?.textContent===tr('sftp:auto.item_count',{count:2})`);
    await shot(`${name}-live-language`);
    await execute(`window.termaSftpDragWorkspace.drag.feedbackView.movePreview(-1,-1);`);
    await check(`${name} pointer preview hides outside the window`, `$('sftpDragPreview')?.hidden===true`);
    await execute(`
      const e=window.__sftpVueFixture.entrypoint;e.releaseMismatch=window.termaSftpDragWorkspace.dropFeedback.release('sftp','different-pane');
      window.termaSftpDragWorkspace.dropFeedback.focus('terminal','terminal-feedback-check',{key:'terminal-feedback-check',terminalDropDepth:0});
    `);
    await check(`${name} terminal ownership clears the file target only`, `window.__sftpVueFixture.entrypoint.releaseMismatch===false&&!$('sftpDragHint')&&window.termaSftpView.element('sftpDropOverlay',window.__sftpVueFixture.entrypoint.key).hidden&&window.termaSftpDragWorkspace.dropFeedback.release('terminal','terminal-feedback-check')===true`);
    await execute(`
      const e=window.__sftpVueFixture.entrypoint;
      window.dispatchEvent(new Event('resize'));
      window.termaSftpDragWorkspace.dropFeedback.external(true,{tabKey:e.key,path:'/entry'});window.termaSftpDragWorkspace.drag.feedback.activity();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    `);
    await check(`${name} late resize retains the next drop destination`, `!!$('sftpDragHint')&&!window.termaSftpView.element('sftpDropOverlay',window.__sftpVueFixture.entrypoint.key).hidden`);
    await shot(`${name}-after-resize`);
    await execute(`
      const e=window.__sftpVueFixture.entrypoint;e.feedbackRow=e.root.querySelector('.sftp-row');
      e.feedbackRow.classList.add('is-dragging','is-preparing-drag');document.body.classList.add('sftp-item-drag-active');
      window.termaSftpDragWorkspace.drag.feedbackView.showPreview([{name:'cleanup.txt',type:'file'}],48,180);
      window.termaSftpDragWorkspace.drag.visuals.clear();
    `);
    await check(`${name} cleanup removes orphan row and all transient feedback`, `(()=>{const e=window.__sftpVueFixture.entrypoint;return !window.termaSftpDragWorkspace.drag.visuals.visible()&&!e.feedbackRow.classList.contains('is-dragging')&&!e.feedbackRow.classList.contains('is-preparing-drag')&&window.termaSftpView.element('sftpDropOverlay',e.key).hidden&&e.root.querySelectorAll('.sftp-row').length===1})()`);
    await shot(`${name}-cleared`);
  }
  await execute(`window.termaSftpDragWorkspace.drag.feedback.clear();applyTheme(${JSON.stringify(previous.theme||'light')});await setTermaLanguage(${JSON.stringify(previous.language)});`);
}
module.exports={runSftpDragFeedbackUiScenario};
