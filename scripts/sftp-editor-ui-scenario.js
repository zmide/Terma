async function runSftpEditorUiScenario({ execute, check, shot, viewport, browser }) {
  browser.webContents.debugger.attach('1.3');
  await browser.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
  const primary = "document.querySelector('[data-editor-key=fixture-primary]')";
  const click = async id => execute(`${primary}?.querySelector('#${id}')?.click();`);
  const wait = async () => execute('await new Promise(resolve=>setTimeout(resolve,180));');
  await execute(String.raw`
    dismissToast();await new Promise(resolve=>setTimeout(resolve,260));
    window.__sftpEditorFixture={originalNotify:notify,saves:[],mode:'pending',content:'{\n  "message": "draft",\n  "enabled": true\n}'};
    notify=()=>{};
    localStorage.removeItem('sftpTextEditorFullscreen');
    window.__sftpEditorFixture.open=()=>{
      const f=window.__sftpEditorFixture;f.ready=false;
      f.pending=window.termaSftpPreviewRuntime.editor.sftpTextModal('1001001009_BAY01_3861_20260516_132700_883_fixture_<img src=x>.json',f.content,60,1024*1024,'utf8','auto',{
        editorKey:'fixture-primary',serverName:'fixture-host',sourceLabel:'/data/project/configuration/1001001009_BAY01_3861_20260516_132700_883_fixture.json',
        versions:[{id:'fixture-backup',size:20,changed_at:1780000000000}],
        loadVersion:async()=>({content:'{"message":"backup-value"}'}),
        onReady:()=>{f.ready=true},onSaved:()=>f.afterMode==='pending'?new Promise(resolve=>{f.finishAfterSave=resolve}):undefined,
        onSave:payload=>{f.saves.push(payload);if(f.mode==='error')return Promise.reject(new Error('fixture-save-failure'));return new Promise(resolve=>{f.finishSave=()=>resolve({encoding:payload.encoding})})}
      });
      document.querySelector('.sftp-editor-floating-root').style.zIndex='200';
    };
    window.__sftpEditorFixture.openSvg=()=>{
      const f=window.__sftpEditorFixture;f.ready=false;
      f.pending=window.termaSftpPreviewRuntime.editor.sftpTextModal('fixture.svg','<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120"><rect id="fixture-shape" x="20" y="20" width="100" height="60" fill="#2878d0"/><text x="30" y="105">SVG fixture</text></svg>',180,1024*1024,'utf8','xml',{
        editorKey:'fixture-svg',serverName:'fixture-host',sourceLabel:'/data/fixture.svg',svgMode:'split',
        onReady:()=>{f.ready=true},onSave:payload=>new Promise(resolve=>{f.finishSvgSave=()=>resolve({encoding:payload.encoding})})
      });
      document.querySelector('.sftp-editor-floating-root').style.zIndex='201';
    };
  `);
  for (const theme of ['light','dark']) {
    for (const language of ['zh-CN','en-US']) {
      const name = `editor-${language}-${theme}`;
      await execute(`applyTheme('${theme}');await setTermaLanguage('${language}',{render:false});window.__sftpEditorFixture.open();await new Promise(resolve=>setTimeout(resolve,250));`);
      await check(`${name} actual runtime uses Vue and Tile shell`, `(()=>{const modal=${primary},host=modal?.querySelector('.terma-sftp-editor-root');return window.__sftpEditorFixture.ready&&!!host&&host.dataset.theme==='${theme}'&&modal.querySelectorAll('[data-terma-button]').length>=10&&!!modal.querySelector('.ace_editor,textarea.code-editor')&&!modal.querySelector('h2 img')})()`);
      await check(`${name} shell fits viewport`, `(()=>{const card=${primary}?.querySelector('.sftp-editor-modal'),r=card?.getBoundingClientRect();return !!r&&r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&card.scrollWidth<=card.clientWidth+2})()`);
      const headerGeometry = `(()=>{const m=${primary},title=m.querySelector('.sftp-editor-title'),h=title.querySelector('h2'),source=title.querySelector('.sftp-editor-source'),controls=m.querySelector('.sftp-editor-controls'),buttons=m.querySelector('.sftp-editor-window-controls'),r=n=>n.getBoundingClientRect();return r(title).bottom<=r(controls).top+1&&r(h).bottom<=r(source).top+1&&(r(title).right<=r(buttons).left+1||r(title).top>=r(buttons).bottom-1)&&h.scrollWidth<=h.clientWidth+1&&source.scrollWidth<=source.clientWidth+1&&controls.scrollWidth<=controls.clientWidth+1&&[...controls.querySelectorAll('select')].every(n=>r(n).height<=${viewport==='mobile'?38:34}+1&&r(n).right<=r(controls).right+1&&r(n.parentElement.querySelector('span')).bottom<=r(n).top+1)})()`;
      await shot(`${name}-long-header`);
      await check(`${name} long filename and full path stay above compact controls`, headerGeometry);
      const readableControls = `(() => {
        const shell = ${primary};
        const ctx = document.createElement('canvas').getContext('2d');
        const headerVisible = [...shell.querySelectorAll('.sftp-editor-title h2,.sftp-editor-source')].every(node => {
          const rect = node.getBoundingClientRect();
          return node.contains(document.elementFromPoint(rect.left + 3, rect.top + 5));
        });
        return headerVisible && [...shell.querySelectorAll('.sftp-editor-controls select')].every(node => {
          const style = getComputedStyle(node);
          ctx.font = style.font;
          const textWidth = ctx.measureText(node.selectedOptions[0].textContent).width;
          return textWidth <= node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) + 1;
        });
      })()`;
      await check(`${name} filename path and selected options are readable`, readableControls);
      if (viewport === 'desktop') {
        const resizeStart=await execute(`const card=${primary}.querySelector('.sftp-editor-modal'),grip=${primary}.querySelector('.sftp-editor-resize-handle'),r=grip.getBoundingClientRect(),c=card.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),width:c.width,height:c.height};`);
        browser.webContents.sendInputEvent({type:'mouseMove',x:resizeStart.x,y:resizeStart.y});
        browser.webContents.sendInputEvent({type:'mouseDown',button:'left',x:resizeStart.x,y:resizeStart.y});
        browser.webContents.sendInputEvent({type:'mouseMove',x:resizeStart.x-88,y:resizeStart.y-68,movementX:-88,movementY:-68});
        browser.webContents.sendInputEvent({type:'mouseUp',button:'left',x:resizeStart.x-88,y:resizeStart.y-68});
        await wait();
        await check(`${name} visible resize grip changes window size`, `(()=>{const card=${primary}.querySelector('.sftp-editor-modal'),handle=${primary}.querySelector('.sftp-editor-resize-handle'),r=card.getBoundingClientRect();return !!handle&&r.width<=${Math.round(resizeStart.width)-55}&&r.height<=${Math.round(resizeStart.height)-39}&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1})()`);
        await shot(`${name}-resized`);
        await check(`${name} resized long header stays separate`, headerGeometry);
        const resizedWidth=await execute(`return ${primary}.querySelector('.sftp-editor-modal').getBoundingClientRect().width;`);
        await execute(`${primary}.querySelector('.sftp-editor-resize-handle').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));`);
        await check(`${name} keyboard resize grip works`, `Math.round(${primary}.querySelector('.sftp-editor-modal').getBoundingClientRect().width)>=${Math.round(resizedWidth)+15}`);
        await execute(`${primary}.querySelector('.sftp-editor-modal').style.removeProperty('width');${primary}.querySelector('.sftp-editor-modal').style.removeProperty('height');`);
      } else {
        const start=await execute(`const card=${primary}.querySelector('.sftp-editor-modal'),grip=card.querySelector('.sftp-editor-resize-handle'),r=grip.getBoundingClientRect(),c=card.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),width:c.width,height:c.height};`);
        const end={x:start.x-46,y:start.y-84};
        const from={x:start.x,y:start.y};
        browser.webContents.sendInputEvent({type:'mouseMove',...from});
        browser.webContents.sendInputEvent({type:'mouseDown',button:'left',...from});
        browser.webContents.sendInputEvent({type:'mouseMove',...end});
        browser.webContents.sendInputEvent({type:'mouseUp',button:'left',...end});
        await wait();
        await check(`${name} narrow editor resizes with one visible grip`, `(()=>{const card=${primary}.querySelector('.sftp-editor-modal'),r=card.getBoundingClientRect();return getComputedStyle(card).resize==='none'&&r.width<${Math.round(start.width)-25}&&r.height<${Math.round(start.height)-45}&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`);
        await check(`${name} narrow resized options stay readable`, readableControls);
        await shot(`${name}-resized`);
        await execute(`${primary}.querySelector('.sftp-editor-modal').style.removeProperty('width');${primary}.querySelector('.sftp-editor-modal').style.removeProperty('height');`);
      }
      await execute(`const node=${primary}.querySelector('#sftpTextEditor');window.__sftpEditorFixture.themeNode=node;applyTheme('${theme==='light'?'dark':'light'}');await new Promise(resolve=>setTimeout(resolve,40));`);
      await check(`${name} live theme preserves editor`, `(()=>{const node=${primary}.querySelector('#sftpTextEditor');return node===window.__sftpEditorFixture.themeNode&&${primary}.querySelector('.terma-sftp-editor-root').dataset.theme==='${theme==='light'?'dark':'light'}'&&(!node?.__termaAceEditor||node.__termaAceEditor.getTheme()==='ace/theme/${theme==='light'?'tomorrow_night':'textmate'}')})()`);
      await execute(`applyTheme('${theme}');await new Promise(resolve=>setTimeout(resolve,40));`);
      await shot(name);
      await execute(`const card=${primary}.querySelector('.sftp-editor-modal');card.scrollTop=card.scrollHeight;`);
      await shot(`${name}-bottom-actions`);
      await check(`${name} bottom actions remain reachable`, `(()=>{const card=${primary}.querySelector('.sftp-editor-modal'),r=card.getBoundingClientRect();return [...card.querySelectorAll(':scope > .actions > button')].filter(b=>!b.hidden).every(b=>{const p=b.getBoundingClientRect();return p.left>=r.left&&p.right<=r.right&&p.top>=r.top&&p.bottom<=r.bottom})})()`);
      const pointer=await execute(`const r=${primary}.querySelector('#sftpTextClose').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};`);
      browser.webContents.sendInputEvent({type:'mouseMove',...pointer});await wait();
      await check(`${name} pointer hover has no halo or movement`, `(()=>{const b=${primary}.querySelector('#sftpTextClose'),s=getComputedStyle(b);return b.matches(':hover')&&s.boxShadow==='none'&&s.transform==='none'})()`);
      await shot(`${name}-button-hover`);
      const savePointer=await execute(`const r=${primary}.querySelector('#sftpTextSave').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};`);
      browser.webContents.sendInputEvent({type:'mouseMove',...savePointer});await wait();
      await check(`${name} primary hover retains its blue color family`, `(()=>{const b=${primary}.querySelector('#sftpTextSave'),s=getComputedStyle(b);return b.matches(':hover')&&s.getPropertyValue('--primary-button-color').trim()===s.getPropertyValue('--accent2').trim()&&s.boxShadow==='none'&&s.transform==='none'})()`);
      await shot(`${name}-primary-hover`);
      await execute(`${primary}.querySelector('#sftpTextSave').focus();`);
      for(const type of ['keyDown','keyUp'])browser.webContents.sendInputEvent({type,keyCode:'Tab'});await wait();
      await check(`${name} keyboard focus remains visible`, `document.activeElement.id==='sftpTextClose'&&document.activeElement.matches(':focus-visible')&&getComputedStyle(document.activeElement).outlineStyle!=='none'`);
      await shot(`${name}-keyboard-focus`);
      await execute(`${primary}.querySelector('.sftp-editor-modal').scrollTop=0;`);
      await execute(String.raw`const m=${primary},host=m.querySelector('#sftpTextEditor'),ace=host?.__termaAceEditor,textarea=m.querySelector('textarea.code-editor');if(ace)ace.setValue(window.__sftpEditorFixture.content+'\n ',1);else{textarea.value=window.__sftpEditorFixture.content+'\n ';textarea.dispatchEvent(new Event('input',{bubbles:true}))}m.querySelector('#sftpBackupBeforeSave').checked=false;m.querySelector('#sftpEditorLanguage').value='json';`);
      await click('sftpEditorSearchToggle');
      await execute(`const f=window.__sftpEditorFixture,m=${primary},input=m.querySelector('#sftpEditorSearchInput');input.value='draft';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(1,3);f.editorNode=m.querySelector('#sftpTextEditor')||m.querySelector('textarea.code-editor');f.card=m.querySelector('.sftp-editor-modal');f.geometry=f.card.getBoundingClientRect().toJSON();await new Promise(resolve=>setTimeout(resolve,160));await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}',{render:false});`);
      await check(`${name} live language retains draft and caret`, String.raw`(()=>{const f=window.__sftpEditorFixture,m=${primary},input=m.querySelector('#sftpEditorSearchInput'),editor=m.querySelector('#sftpTextEditor')||m.querySelector('textarea.code-editor'),value=editor.__termaAceEditor?.getValue()??editor.value;return editor===f.editorNode&&value.endsWith('\n ')&&input===document.activeElement&&input.value==='draft'&&input.selectionStart===1&&input.selectionEnd===3&&!m.querySelector('#sftpBackupBeforeSave').checked&&m.querySelector('#sftpEditorLanguage').value==='json'&&m.querySelector('#sftpTextClose').textContent===tr('sftp:editor.close')})()`);
      await execute(`await setTermaLanguage('${language}',{render:false});`);
      await shot(`${name}-search`);
      await click('sftpEditorReplaceToggle');
      await check(`${name} replacement controls fit`, `(()=>{const m=${primary},bar=m.querySelector('#sftpEditorSearchBar'),r=bar.getBoundingClientRect();return !m.querySelector('#sftpEditorReplaceRow').hidden&&[...bar.querySelectorAll('button,input')].every(n=>{const b=n.getBoundingClientRect();return b.width>0&&b.left>=r.left&&b.right<=Math.min(innerWidth,r.right)+1})})()`);
      await check(`${name} replacement labels are translated`, `(()=>{const m=${primary};return m.querySelector('#sftpEditorReplaceToggle').title===tr('sftp:ace.toggle_replace')&&m.querySelector('#sftpEditorReplaceInput').placeholder==='${language==='zh-CN'?'替换为':'Replace with'}'&&m.querySelector('#sftpEditorReplaceOne').textContent==='${language==='zh-CN'?'替换':'Replace'}'&&m.querySelector('#sftpEditorReplaceAll').textContent==='${language==='zh-CN'?'全部替换':'Replace All'}'})()`);
      await shot(`${name}-replace`);
      await execute(`const m=${primary},e=m.querySelector('#sftpTextEditor').__termaAceEditor,f=window.__sftpEditorFixture;f.beforeReplace=e.getValue();e.session.insert({row:0,column:0},'draft DRAFT draft ');m.querySelector('#sftpEditorReplaceInput').value='$&';`);
      await click('sftpEditorReplaceOne');
      await check(`${name} replace one continues to the next match`, `(()=>{const m=${primary},e=m.querySelector('#sftpTextEditor').__termaAceEditor;return e.getValue().startsWith('$& DRAFT draft ')&&e.getSelectedText()==='DRAFT'})()`);
      await execute(`${primary}.querySelector('#sftpEditorReplaceInput').value='';`);
      await click('sftpEditorReplaceAll');
      await check(`${name} replace all accepts an empty literal`, `(()=>{const m=${primary},e=m.querySelector('#sftpTextEditor').__termaAceEditor;return e.getValue().startsWith('$&   ')&&!/draft/i.test(e.getValue())&&m.querySelector('#sftpEditorReplaceAll').disabled})()`);
      await execute(`const m=${primary},e=m.querySelector('#sftpTextEditor').__termaAceEditor;e.undo();`);
      await check(`${name} one undo restores the whole replace-all operation`, `${primary}.querySelector('#sftpTextEditor').__termaAceEditor.getValue().startsWith('$& DRAFT draft ')`);
      await execute(`const m=${primary},e=m.querySelector('#sftpTextEditor').__termaAceEditor,find=m.querySelector('#sftpEditorSearchInput');e.setValue('🙂 .*[] 🙂 .*[]',1);find.value='.*[]';find.dispatchEvent(new Event('input',{bubbles:true}));m.querySelector('#sftpEditorReplaceInput').value='$&🙂';`);
      await wait();
      await click('sftpEditorReplaceAll');
      await check(`${name} literal search and replacement preserve Unicode offsets`, `${primary}.querySelector('#sftpTextEditor').__termaAceEditor.getValue()==='🙂 $&🙂 🙂 $&🙂'`);
      await execute(`const m=${primary},e=m.querySelector('#sftpTextEditor').__termaAceEditor,find=m.querySelector('#sftpEditorSearchInput');e.setValue('a '.repeat(10005),1);find.value='a';find.dispatchEvent(new Event('input',{bubbles:true}));m.querySelector('#sftpEditorReplaceInput').value='b';`);
      await wait();
      await click('sftpEditorReplaceAll');
      await check(`${name} replace all is not limited by the search navigation cap`, `${primary}.querySelector('#sftpTextEditor').__termaAceEditor.getValue()==='b '.repeat(10005)`);
      await execute(`const m=${primary},e=m.querySelector('#sftpTextEditor').__termaAceEditor,find=m.querySelector('#sftpEditorSearchInput');e.setValue('a a',1);find.value='a';find.dispatchEvent(new Event('input',{bubbles:true}));m.querySelector('#sftpEditorReplaceInput').value='x'.repeat(1024*1024);`);
      await wait();
      await click('sftpEditorReplaceAll');
      await check(`${name} oversized replacement leaves the document unchanged`, `${primary}.querySelector('#sftpTextEditor').__termaAceEditor.getValue()==='a a'`);
      await execute(`const m=${primary},e=m.querySelector('#sftpTextEditor').__termaAceEditor;e.setValue(window.__sftpEditorFixture.beforeReplace,1);`);
      await click('sftpEditorSearchClose');
      await click('sftpTextDiff'); await wait();
      await check(`${name} diff uses fetched backup`, `(()=>{const m=${primary},diff=m.querySelector('#sftpDiffPreview');return !diff.hidden&&diff.textContent.includes('backup-value')&&diff.textContent.includes('draft')&&!m.querySelector('#sftpEditorSplit').hidden})()`);
      await execute(`const f=window.__sftpEditorFixture,m=${primary};f.diffNode=m.querySelector('.sftp-side-diff');m.querySelector('#sftpDiffClose').focus();await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}',{render:false});await setTermaLanguage('${language}',{render:false});`);
      await check(`${name} diff locale preserves content nodes and focus`, `${primary}.querySelector('.sftp-side-diff')===window.__sftpEditorFixture.diffNode&&document.activeElement.id==='sftpDiffClose'`);
      await check(`${name} diff header and editor never overlap`, `(()=>{const m=${primary},editor=m.querySelector('#sftpTextEditor').getBoundingClientRect(),diff=m.querySelector('#sftpDiffPreview').getBoundingClientRect(),head=m.querySelector('.sftp-diff-preview-head'),title=head.querySelector('strong'),r=title.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);const valid=editor.bottom<=diff.top+1&&r.left>=diff.left&&r.right<=diff.right&&head.contains(hit);if(!valid)throw new Error(JSON.stringify({editor:editor.toJSON(),diff:diff.toJSON(),title:r.toJSON(),hit:hit?.outerHTML?.slice(0,240),workspace:getComputedStyle(m.querySelector('#sftpEditorWorkspace')).gridTemplateRows}));return valid})()`);
      await shot(`${name}-diff`);
      if (language==='en-US') {
        await check(`${name} translated DOM and attributes`, `(()=>{const m=${primary},text=m.textContent+[...m.querySelectorAll('[title],[aria-label],[placeholder]')].flatMap(node=>['title','aria-label','placeholder'].map(key=>node.getAttribute(key)||'')).join(' ');return !/[\u3400-\u9fff]/.test(text)&&!text.includes('sftp:')})()`);
      }
      await click('sftpDiffClose');
      await execute(`window.__sftpEditorFixture.mode='pending';`);
      await click('sftpTextSave'); await wait();
      await check(`${name} save busy prevents duplicates`, `${primary}.querySelector('#sftpTextSave').disabled&&${primary}.querySelector('#sftpTextSave').classList.contains('busy')`);
      await execute(`await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}',{render:false});`);
      await check(`${name} busy survives language change`, `${primary}.querySelector('#sftpTextSave').disabled&&${primary}.querySelector('.sftp-editor-save-status').textContent===tr('sftp:editor.saving_remote')`);
      await execute(`await setTermaLanguage('${language}',{render:false});`);await shot(`${name}-saving`);
      await execute(`window.__sftpEditorFixture.finishSave();`); await wait();
      await check(`${name} original save payload preserved`, String.raw`(()=>{const f=window.__sftpEditorFixture,p=f.saves.at(-1);return p.content.endsWith('\n ')&&p.backup===false&&p.encoding==='utf8'&&p.line_ending==='lf'&&!${primary}.querySelector('#sftpTextSave').disabled})()`);
      await execute(`const f=window.__sftpEditorFixture,m=${primary};m.querySelector('#sftpLineEnding').value='crlf';m.querySelector('#sftpLineEnding').dispatchEvent(new Event('change',{bubbles:true}));f.afterMode='pending';m.querySelector('#sftpTextSave').click();await new Promise(resolve=>setTimeout(resolve,20));f.finishSave();await new Promise(resolve=>setTimeout(resolve,30));`);
      await check(`${name} post-save refresh stays inside the single save lifecycle`, `${primary}.querySelector('#sftpTextSave').disabled&&${primary}.querySelector('#sftpTextSave').classList.contains('busy')`);
      await execute(`const f=window.__sftpEditorFixture;f.afterMode='normal';f.finishAfterSave();await new Promise(resolve=>setTimeout(resolve,30));const field=${primary}.querySelector('#sftpLineEnding');field.value='lf';field.dispatchEvent(new Event('change',{bubbles:true}));`);
      await execute(`const m=${primary},node=m.querySelector('#sftpTextEditor'),a=node.__termaAceEditor,t=m.querySelector('textarea.code-editor');if(a)a.insert('new');else{t.value+='new';t.dispatchEvent(new Event('input',{bubbles:true}))}m.querySelector('#sftpTextSave').click();await new Promise(resolve=>setTimeout(resolve,20));if(a)a.insert('-after-save');else{t.value+='-after-save';t.dispatchEvent(new Event('input',{bubbles:true}))}await new Promise(resolve=>setTimeout(resolve,160));`);
      await check(`${name} edits during save keep the request single`, `${primary}.querySelector('#sftpTextSave').disabled`);
      await execute(`window.__sftpEditorFixture.finishSave();`); await wait();
      await click('sftpTextClose'); await wait();
      await check(`${name} edits after save began remain unsaved`, `!document.querySelector('#modal').hidden&&document.querySelector('#modal h2').textContent===tr('sftp:editor.discard_title')`);
      await execute(`document.querySelector('#modal .actions button:last-child').click();`); await wait();
      await execute(`const f=window.__sftpEditorFixture,m=${primary},node=m.querySelector('#sftpTextEditor')||m.querySelector('textarea.code-editor');if(node.__termaAceEditor)node.__termaAceEditor.insert(' ');else{node.value+=' ';node.dispatchEvent(new Event('input',{bubbles:true}))}f.mode='error';`);
      await click('sftpTextSave');await wait();await shot(`${name}-save-error`);
      await check(`${name} save failure retains editor`, `!${primary}.querySelector('.sftp-editor-save-status').hidden&&${primary}.querySelector('.sftp-editor-save-status').classList.contains('error')&&!${primary}.querySelector('#sftpTextSave').disabled`);
      await click('sftpTextClose');await wait();await shot(`${name}-unsaved-confirm`);
      await check(`${name} unsaved confirmation is above editor`, `(()=>{const card=document.querySelector('#modal .modal-card'),r=card.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('#modal')!==null})()`);
      await execute(`await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}',{render:false});`);
      await check(`${name} unsaved confirmation translates live`, `document.querySelector('#modal h2').textContent===tr('sftp:editor.discard_title')&&document.querySelector('#modal .actions button:last-child').textContent===tr('sftp:editor.continue_editing')`);
      await execute(`await setTermaLanguage('${language}',{render:false});`);
      await execute(`document.querySelector('#modal .actions button:last-child').click();`);await wait();
      await check(`${name} cancelling close retains draft`, `!!${primary}&&document.getElementById('modal').hidden`);
      await click('sftpEditorFullscreen');await wait();await shot(`${name}-fullscreen`);
      await check(`${name} fullscreen keeps editor`, `${primary}.querySelector('.sftp-editor-modal').classList.contains('is-fullscreen')&&!!${primary}.querySelector('.ace_editor,textarea.code-editor')`);
      if(viewport==='desktop') {
        const start=await execute(`const m=${primary},g=m.querySelector('.sftp-editor-resize-handle').getBoundingClientRect(),r=m.querySelector('.sftp-editor-modal').getBoundingClientRect();window.__sftpEditorFixture.fullscreenNode=m.querySelector('#sftpTextEditor');window.__sftpEditorFixture.fullscreenText=window.__sftpEditorFixture.fullscreenNode.__termaAceEditor?.getValue();return {x:Math.round(g.left+g.width/2),y:Math.round(g.top+g.height/2),width:r.width,height:r.height};`);
        browser.webContents.sendInputEvent({type:'mouseMove',x:start.x,y:start.y});
        browser.webContents.sendInputEvent({type:'mouseDown',button:'left',x:start.x,y:start.y});
        browser.webContents.sendInputEvent({type:'mouseUp',button:'left',x:start.x,y:start.y});
        await check(`${name} clicking the small grip does not exit fullscreen`, `${primary}.querySelector('.sftp-editor-modal').classList.contains('is-fullscreen')`);
        browser.webContents.sendInputEvent({type:'mouseDown',button:'left',x:start.x,y:start.y});
        browser.webContents.sendInputEvent({type:'mouseMove',x:start.x-104,y:start.y-84,movementX:-104,movementY:-84});
        browser.webContents.sendInputEvent({type:'mouseUp',button:'left',x:start.x-104,y:start.y-84});
        await wait();
        await check(`${name} dragging fullscreen grip exits and resizes without losing draft`, `(()=>{const m=${primary},card=m.querySelector('.sftp-editor-modal'),r=card.getBoundingClientRect(),f=window.__sftpEditorFixture,node=m.querySelector('#sftpTextEditor');return !card.classList.contains('is-fullscreen')&&r.width<${Math.round(start.width)-65}&&r.height<${Math.round(start.height)-45}&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&localStorage.getItem('sftpTextEditorFullscreen')==='0'&&m.querySelector('#sftpEditorFullscreen').title===tr('sftp:editor.fullscreen')&&node===f.fullscreenNode&&node.__termaAceEditor?.getValue()===f.fullscreenText})()`);
        await check(`${name} grip stays small and unobtrusive`, `(()=>{const g=${primary}.querySelector('.sftp-editor-resize-handle'),r=g.getBoundingClientRect(),s=getComputedStyle(g);return r.width<=18&&r.height<=18&&s.backgroundColor==='rgba(0, 0, 0, 0)'&&s.borderTopWidth==='0px'})()`);
        await shot(`${name}-fullscreen-drag-resized`);
        await click('sftpEditorFullscreen');
        await execute(`${primary}.querySelector('.sftp-editor-resize-handle').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));`);
        await check(`${name} keyboard resize also exits fullscreen`, `!${primary}.querySelector('.sftp-editor-modal').classList.contains('is-fullscreen')&&localStorage.getItem('sftpTextEditorFullscreen')==='0'`);
      } else await click('sftpEditorFullscreen');
      await click('sftpEditorMinimize');await wait();
      await check(`${name} minimized shelf restores window`, `(()=>{const m=${primary},hidden=m.querySelector('.sftp-editor-modal').hidden;document.querySelector('.sftp-editor-shelf-item')?.click();return hidden&&!m.querySelector('.sftp-editor-modal').hidden})()`);
      await execute(`const f=window.__sftpEditorFixture;f.mode='pending';${primary}.querySelector('#sftpTextSave').click();await new Promise(resolve=>setTimeout(resolve,30));f.finishSave();await new Promise(resolve=>setTimeout(resolve,50));`);
      await click('sftpTextClose');await wait();
      await check(`${name} window releases after close`, `!${primary}`);
    }
  }
  await execute(`window.__sftpEditorFixture.open();window.termaSftpPreviewRuntime.editor.sftpTextModal('second.txt','second-window',13,1024,'utf8','auto',{editorKey:'fixture-secondary'});document.querySelector('.sftp-editor-floating-root').style.zIndex='200';await new Promise(resolve=>setTimeout(resolve,150));`);
  await check('editor windows own independent Vue roots', `document.querySelectorAll('.terma-sftp-editor-root').length===2&&${primary}.querySelector('h2').textContent.includes('fixture')&&document.querySelector('[data-editor-key=fixture-secondary] h2').textContent==='second.txt'`);
  await shot('editor-two-windows');
  await execute(`document.querySelector('[data-editor-key=fixture-secondary] #sftpTextClose').click();`);
  await check('closing one editor leaves the other usable', `document.querySelectorAll('.terma-sftp-editor-root').length===1&&!!${primary}.querySelector('#sftpTextSave')`);
  await click('sftpTextClose');await wait();
  await check('all editor windows release cleanly', `!document.querySelector('.sftp-editor-floating-root')&&!document.querySelector('.terma-sftp-editor-root')`);
  await execute(`applyTheme('light');await setTermaLanguage('zh-CN',{render:false});window.__sftpEditorFixture.openSvg();await new Promise(resolve=>setTimeout(resolve,240));`);
  await check('SVG editor shell and preview controls are Vue-owned', `(()=>{const modal=document.querySelector('[data-editor-key=fixture-svg]'),root=modal?.querySelector('.terma-sftp-editor-root'),preview=modal?.querySelector('#sftpSvgEditorPreview');return !!root&&!!modal.querySelector('#sftpSvgEditorMode')&&!!preview&&!!preview.querySelector('[data-svg-preview-auto-focus]')&&preview.querySelectorAll('[data-svg-preview-zoom]').length===3&&!!modal.querySelector('#sftpSvgEditorSplit')&&root.contains(modal.querySelector('#sftpSvgEditorMode'))&&root.contains(preview)})()`);
  await check('SVG editor opens in the requested split view', `(()=>{const modal=document.querySelector('[data-editor-key=fixture-svg]'),preview=modal?.querySelector('#sftpSvgEditorPreview');return modal?.querySelector('#sftpSvgEditorMode')?.value==='split'&&modal.querySelector('#sftpEditorWorkspace')?.classList.contains('showing-svg-preview')&&!preview?.hidden&&!!preview?.querySelector('.sftp-svg-editor-preview-stage')?.shadowRoot?.querySelector('svg')})()`);
  await shot('editor-svg-vue-split');
  await execute(`const modal=document.querySelector('[data-editor-key=fixture-svg]'),host=modal.querySelector('#sftpTextEditor'),editor=host.__termaAceEditor,text=editor?.getValue()||modal.querySelector('textarea').value,next=text.replace('</svg>','<circle id="fixture-live-shape" cx="180" cy="55" r="28" fill="#09895b"/></svg>');if(editor)editor.setValue(next,1);else{const input=modal.querySelector('textarea');input.value=next;input.dispatchEvent(new Event('input',{bubbles:true}))}await new Promise(resolve=>setTimeout(resolve,300));`);
  await check('SVG source changes update the mounted preview', `!!document.querySelector('[data-editor-key=fixture-svg] .sftp-svg-editor-preview-stage')?.shadowRoot?.querySelector('#fixture-live-shape')`);
  for(const theme of ['light','dark'])for(const language of ['zh-CN','en-US']){
    await execute(`applyTheme('${theme}');await setTermaLanguage('${language}',{render:false});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`);
    await check(`SVG ${theme} ${language} labels and preview survive live changes`, `(()=>{const m=document.querySelector('[data-editor-key=fixture-svg]'),preview=m.querySelector('#sftpSvgEditorPreview'),root=m.querySelector('.terma-sftp-editor-root'),mode=m.querySelector('#sftpSvgEditorMode');return root.dataset.theme==='${theme}'&&mode.value==='split'&&mode.getAttribute('aria-label')===tr('sftp:editor.svg_mode')&&[...mode.options].every(option=>option.textContent===tr('sftp:editor.svg_mode_'+option.value))&&!!preview.querySelector('.sftp-svg-editor-preview-stage')?.shadowRoot?.querySelector('#fixture-live-shape')})()`);
    await check(`SVG ${theme} ${language} controls fit within the editor`, `(()=>{const m=document.querySelector('[data-editor-key=fixture-svg] .sftp-editor-modal'),r=m.getBoundingClientRect();return m.scrollWidth<=m.clientWidth+1&&[...m.querySelectorAll('.sftp-editor-controls select,.sftp-svg-editor-preview-toolbar button')].every(node=>{const b=node.getBoundingClientRect();return b.left>=r.left&&b.right<=r.right+1})})()`);
    await shot(`editor-svg-${language}-${theme}`);
  }
  await execute(`const modal=document.querySelector('[data-editor-key=fixture-svg]'),mode=modal.querySelector('#sftpSvgEditorMode'),preview=modal.querySelector('#sftpSvgEditorPreview'),before=preview.querySelector('[data-svg-preview-zoom-value]').textContent;preview.querySelector('[data-svg-preview-zoom="in"]').click();mode.value='edit';mode.dispatchEvent(new Event('change',{bubbles:true}));await setTermaLanguage('en-US',{render:false});`);
  await check('SVG mode switch and live translation preserve the preview shell', `(()=>{const modal=document.querySelector('[data-editor-key=fixture-svg]'),mode=modal?.querySelector('#sftpSvgEditorMode'),preview=modal?.querySelector('#sftpSvgEditorPreview');return mode?.value==='edit'&&preview.hidden&&mode.getAttribute('aria-label')===tr('sftp:editor.svg_mode')&&[...mode.options].every(option=>option.textContent===tr('sftp:editor.svg_mode_'+option.value))&&preview.querySelector('[data-svg-preview-zoom="in"]').getAttribute('aria-label')===tr('sftp:editor.zoom_in')})()`);
  await execute(`const modal=document.querySelector('[data-editor-key=fixture-svg]'),mode=modal.querySelector('#sftpSvgEditorMode');mode.value='split';mode.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`);
  await check('SVG preview survives Vue mode transitions', `(()=>{const modal=document.querySelector('[data-editor-key=fixture-svg]'),preview=modal?.querySelector('#sftpSvgEditorPreview');return !preview.hidden&&!!preview.querySelector('.sftp-svg-editor-preview-stage')?.shadowRoot?.querySelector('#fixture-shape')})()`);
  await shot('editor-svg-vue-live-language');
  await execute(`document.querySelector('[data-editor-key=fixture-svg] #sftpTextSave').click();await new Promise(resolve=>setTimeout(resolve,60));`);
  await check('SVG save remains scoped and busy', `document.querySelector('[data-editor-key=fixture-svg] #sftpTextSave').disabled&&typeof window.__sftpEditorFixture.finishSvgSave==='function'`);
  await execute(`window.__sftpEditorFixture.finishSvgSave();await new Promise(resolve=>setTimeout(resolve,60));const mode=document.querySelector('[data-editor-key=fixture-svg] #sftpSvgEditorMode');mode.value='preview';mode.dispatchEvent(new Event('change',{bubbles:true}));window.__sftpEditorFixture.svgResult=await window.__sftpEditorFixture.pending;`);
  await check('SVG preview mode hands the current source back to the existing preview runtime', `window.__sftpEditorFixture.svgResult?.action==='preview'&&window.__sftpEditorFixture.svgResult?.content.includes('fixture-live-shape')&&window.__sftpEditorFixture.svgResult?.encoding==='utf8'`);
  await check('SVG editor releases its Vue mount', `!document.querySelector('[data-editor-key=fixture-svg]')&&!document.querySelector('.terma-sftp-editor-root')`);
  for(const theme of ['light','dark']) {
    await execute(`applyTheme('${theme}');await setTermaLanguage('zh-CN',{render:false});const f=window.__sftpEditorFixture,text='needle '+' '.repeat(256*1024-10)+'needle needle';f.lightSave=null;window.termaSftpPreviewRuntime.editor.sftpTextModal('large.txt',text,text.length,512*1024,'utf8','auto',{editorKey:'fixture-light',editorKind:'light',onSave:async payload=>{f.lightSave=payload;return {}}});document.querySelector('.sftp-editor-floating-root').style.zIndex='200';await new Promise(resolve=>setTimeout(resolve,120));const node=document.querySelector('[data-editor-key=fixture-light] textarea');node.focus();node.setSelectionRange(2,5);window.__sftpEditorFixture.lightNode=node;await setTermaLanguage('en-US',{render:false});`);
    await check(`light editor ${theme} live locale preserves editor and caret`, `(()=>{const m=document.querySelector('[data-editor-key=fixture-light]'),node=m.querySelector('textarea'),text=m.textContent+[...m.querySelectorAll('[title],[aria-label],[placeholder]')].flatMap(n=>['title','aria-label','placeholder'].map(k=>n.getAttribute(k)||'')).join(' ');return node===window.__sftpEditorFixture.lightNode&&document.activeElement===node&&node.selectionStart===2&&node.selectionEnd===5&&!/[\u3400-\u9fff]/.test(text)&&m.querySelector('#sftpTextDiff').disabled})()`);
    await shot(`editor-light-${theme}`);
    await execute(`const m=document.querySelector('[data-editor-key=fixture-light]'),find=m.querySelector('#sftpEditorSearchInput');m.querySelector('#sftpEditorSearchToggle').click();find.value='needle';find.dispatchEvent(new Event('input',{bubbles:true}));m.querySelector('#sftpEditorReplaceToggle').click();m.querySelector('#sftpEditorReplaceInput').value='done';`);
    await wait();
    await execute(`const m=document.querySelector('[data-editor-key=fixture-light]');m.querySelector('#sftpEditorReplaceAll').click();`);
    await check(`light editor ${theme} replacement stays in the draft`, `window.__sftpEditorFixture.lightSave===null&&document.querySelector('[data-editor-key=fixture-light] textarea').value.startsWith('done ')`);
    await execute(`document.querySelector('[data-editor-key=fixture-light] #sftpTextSave').click();`);await wait();
    await check(`light editor ${theme} replacement crosses segment boundaries`, `window.__sftpEditorFixture.lightSave?.content==='done '+' '.repeat(256*1024-10)+'done done'`);
    await execute(`document.querySelector('[data-editor-key=fixture-light] #sftpTextClose').click();`);await wait();
  }
  await execute(`notify=window.__sftpEditorFixture.originalNotify;localStorage.removeItem('sftpTextEditorFullscreen');delete window.__sftpEditorFixture;`);
  browser.webContents.debugger.detach();
}
async function runSftpEditorBrowserScenario(browser, { viewport }) {
  const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
  const directory = path.join(process.env.TERMA_UI_DIAGNOSTICS_DIR || path.join(process.cwd(), 'data'), 'sftp-vue-visual'); fs.mkdirSync(directory, { recursive: true });
  const execute = source => browser.webContents.executeJavaScript(`(async()=>{${source}})()`);
  let checks = 0, screenshots = 0;
  const shot = async name => { await new Promise(resolve => setTimeout(resolve, 90)); browser.webContents.invalidate(); fs.writeFileSync(path.join(directory, `${viewport}-${name}.png`), (await browser.webContents.capturePage()).toPNG()); screenshots++; };
  const check = async (name, source) => {
    const result = await execute(`return (${source});`);
    if (!result) {
      await shot('editor-failure');
      console.error(name, await execute(`return [...document.querySelectorAll('.sftp-editor-head,.sftp-editor-title,.sftp-editor-title h2,.sftp-editor-source,.sftp-editor-controls,.sftp-editor-window-controls,.sftp-editor-controls select')].map(n=>({name:n.className||n.id,rect:n.getBoundingClientRect().toJSON(),clientWidth:n.clientWidth,scrollWidth:n.scrollWidth,grid:getComputedStyle(n).gridTemplateColumns,gridRow:getComputedStyle(n).gridRow}));`));
    }
    assert.equal(result, true, name); checks++;
  };
  await execute('await window.termaI18nReady;');
  await runSftpEditorUiScenario({ execute, check, shot, viewport, browser });
  await execute(`
    applyTheme('dark');
    const fixture = window.__openProgressFixture = { fetch: window.fetch, ensure: window.termaSftpConnection.ensure, pending: new Map() };
    window.termaSftpConnection.ensure = async () => true;
    window.fetch = (input, options) => {
      const url = new URL(String(input), location.href);
      return url.pathname === '/api/connections/791/sftp/open'
        ? new Promise(resolve => fixture.pending.set(url.searchParams.get('path'), resolve))
        : fixture.fetch(input, options);
    };
    fixture.toast = name => [...document.querySelectorAll('#toast .toast')].find(node => node.querySelector('.toast-copy strong')?.textContent === tr('sftp:editor.opening_file',{name}));
    fixture.errors = () => [...document.querySelectorAll('#toast .toast')].filter(node => node.textContent.includes(tr('sftp:editor.binary_content')));
    fixture.wait = async predicate => {
      for(let i=0;i<200;i++) { if(predicate()) return; await new Promise(resolve=>setTimeout(resolve,20)); }
      throw new Error('Timed out waiting for the file-open state');
    };
    fixture.finish = (name, content) => {
      const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
      fixture.pending.get('/'+name)(new Response(bytes,{headers:{'X-Terma-File-Size':String(bytes.byteLength)}}));
      fixture.pending.delete('/'+name);
    };
  `);
  try {
    for (const theme of ['light', 'dark']) for (const language of ['zh-CN', 'en-US']) {
      const binary = '.Xauthority', other = 'separate-open.txt';
      await execute(`
        const f=window.__openProgressFixture;
        applyTheme('${theme}');
        await setTermaLanguage('${language}',{render:false});
        f.otherOpening=window.termaSftpPreviewRuntime.text(791,'/${other}');
        const opening=window.termaSftpPreviewRuntime.text(791,'/${binary}');
        await f.wait(()=>f.toast('${binary}')&&f.toast('${other}')&&f.pending.size===2);
        f.finish('${binary}',new Uint8Array([0,65,66]));
        await opening;
      `);
      await check(`${language} ${theme} binary open clears only that operation and reports one error`, `(()=>{
        const f=window.__openProgressFixture, errors=f.errors();
        return !f.toast('${binary}')&&!!f.toast('${other}')&&errors.length===1
          &&errors[0].querySelector('.toast-copy strong')?.textContent===tr('sftp:editor.binary_content')
          &&!document.querySelector('.sftp-editor-floating-root .sftp-editor-modal');
      })()`);
      await execute(`
        const f=window.__openProgressFixture;
        f.toast('${other}').querySelector('.toast-progress-cancel').click();
        f.finish('${other}','cancelled');
        await f.otherOpening;
        await f.wait(()=>!f.toast('${other}'));
      `);
      await check(`${language} ${theme} only the binary error remains`, `document.querySelectorAll('#toast .toast').length===1&&window.__openProgressFixture.errors().length===1`);
      await shot(`${language}-${theme}-binary-open-error`);
      await execute(`
        const f=window.__openProgressFixture;
        f.errors().forEach(dismissToast);
        await f.wait(()=>f.errors().length===0);
      `);
    }
    for (const language of ['zh-CN', 'en-US']) {
      const text = `opening-${language}.txt`, image = `opening-${language}.svg`;
      const textName = JSON.stringify(text), imageName = JSON.stringify(image);
      await execute(`
        const f=window.__openProgressFixture;
        applyTheme('dark');
        await setTermaLanguage('${language}',{render:false});
        void window.termaSftpPreviewRuntime.text(791,'/'+${textName});
        void window.termaSftpPreviewRuntime.image(791,'/'+${imageName});
        await f.wait(()=>f.toast(${textName})&&f.toast(${imageName})&&f.pending.size>=2);
        await window.termaSftpPreviewRuntime.image(791,'/'+${imageName});
      `);
      await check(`${language} parallel files own separate progress toasts`, `Boolean(window.__openProgressFixture.toast(${textName})&&window.__openProgressFixture.toast(${imageName}))`);
      await shot(`${language}-file-opening`);
      await execute(`
        const f=window.__openProgressFixture;
        f.finish(${imageName},'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 140"><rect width="320" height="140" fill="#17547e"/><text x="28" y="75" fill="white">Preview ready</text></svg>');
        await f.wait(()=>!f.toast(${imageName})&&document.querySelector('#sftpImageStage')?.shadowRoot?.querySelector('svg'));
      `);
      await check(`${language} ready image removes only its own toast`, `!window.__openProgressFixture.toast(${imageName})&&!!window.__openProgressFixture.toast(${textName})`);
      await shot(`${language}-image-ready`);
      await execute(`
        document.querySelector('#sftpImageClose').click();
        const f=window.__openProgressFixture;
        f.finish(${textName},'The text editor is ready.\\n');
        await f.wait(()=>!f.toast(${textName})&&document.querySelector('.sftp-editor-floating-root #sftpTextClose'));
      `);
      await check(`${language} editor readiness clears the remaining opening toast`, `!window.__openProgressFixture.toast(${textName})&&!window.__openProgressFixture.toast(${imageName})`);
      await shot(`${language}-text-ready`);
      await execute(`document.querySelector('.sftp-editor-floating-root #sftpTextClose').click();window.__openProgressFixture.pending.clear();`);
    }
  } finally {
    await execute(`
      const f=window.__openProgressFixture;
      window.fetch=f.fetch;window.termaSftpConnection.ensure=f.ensure;
      delete window.__openProgressFixture;closeModal();
    `);
  }
  return { viewport, checks, screenshots };
}
module.exports = { runSftpEditorUiScenario, runSftpEditorBrowserScenario };
