const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runSftpRowActionsUiScenario } = require('./sftp-row-actions-ui-scenario');
const { runSftpEditorUiScenario } = require('./sftp-editor-ui-scenario');
const { runSftpCopyUiScenario } = require('./sftp-copy-ui-scenario');
const { runSftpTransferUiScenario } = require('./sftp-transfer-ui-scenario');
const { runSftpAdapterUiScenario } = require('./sftp-adapter-ui-scenario');
const { runSftpConnectionUiScenario } = require('./sftp-connection-ui-scenario');
const { runSftpEntrypointUiScenario } = require('./sftp-entrypoint-ui-scenario');

async function runSftpVueUiScenario(browser, options = {}) {
  const directory = path.join(process.env.TERMA_UI_DIAGNOSTICS_DIR || path.join(process.cwd(), 'data'), 'sftp-vue-visual');
  fs.mkdirSync(directory, { recursive: true });
  const execute = async source => {
    try { return await browser.webContents.executeJavaScript(`(async()=>{${source}})()`); }
    catch (error) { console.error('[sftp-vue execute failed]', source, error); throw error; }
  };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const viewport = options.viewport || (await execute('return innerWidth <= 520 ? "mobile" : "desktop"'));
  const expectedTabKey = JSON.stringify(`sftp-vue-${viewport}`);
  const states = [], checks = [];
  const check = async (name, expression) => {
    const result = await execute(`return (${expression});`);
    checks.push({ name, result });
    if (result !== true) {
      if (/selection|draft/.test(name)) console.error('[sftp-vue selection]',await execute(`const f=window.__sftpVueFixture;return {paths:window.termaSftpView.selectedPaths(f.key),modelPaths:f.options.model.selectedPaths,path:f.options.model.state.path,query:f.options.model.state.query,checks:[...f.root.querySelectorAll('.sftp-check')].map(n=>({path:n.value,checked:n.checked})),bar:f.root.querySelector('#sftpSelectionBar')?.hidden,search:f.root.querySelector('#sftpFloatingSearch')?.hidden}`));
      if(name.includes('pointer cancellation'))console.error('[sftp clipboard cancel]',await execute(`const node=document.querySelector('#sftpClipboardActions');return {clipboard:window.termaSftpFileActions.clipboard.value,notice:window.__sftpCopyFixture?.lastNotice,html:node?.outerHTML,visible:node?.checkVisibility(),buttons:node?.querySelectorAll('button').length};`));
      if (name.includes('external drop cancels')) console.error('[sftp-vue external drop]', await execute(`return (()=>{const c=window.__sftpTransferFixture;return {requests:c?.requests,bodies:c?.bodies?.map(body=>({url:body.url,aborted:body.aborted})),path:c?.runtime?.state?.path,tabPath:c?.tab?.path,notices:c?.notices,finish:typeof c?.finishCollection}})()`));
      if (name.includes('responsive column')) console.error('[sftp-vue layout checks]', await execute('return window.__sftpVueFixture?.layoutChecks||null'));
      if (name.includes('copy completion')) console.error('[sftp-vue copy completion]', await execute('return (()=>{const c=window.__sftpCopyFixture;return {clipboard:window.termaSftpFileActions.clipboard.value,requests:c?.requests?.length,before:c?.before,pending:window.termaSftpFileActions.copy?.isPending(window.__sftpVueFixture?.key),finish:typeof c?.finish}})()'));
      console.error('[sftp-vue colors]', await execute(`return (()=>{const root=document.querySelector('.sftp-list'),style=getComputedStyle(root);return {muted:style.getPropertyValue('--muted'),subtle:style.getPropertyValue('--tile-text-subtle'),panel:style.backgroundColor,nodes:['.file-list-status','.sftp-column-mtime','.sftp-access > span'].map(selector=>({selector,color:getComputedStyle(root.querySelector(selector)).color}))}})()`));
      if (name.includes('directory size')) console.error('[sftp-vue directory size]', await execute(`return (()=>{const button=document.querySelector('.sftp-directory-size-button'),style=button&&getComputedStyle(button),rect=button?.getBoundingClientRect(),root=document.querySelector('.sftp-list');return {className:button?.className,rect:rect&&{height:rect.height,width:rect.width},fontSize:style?.fontSize,fontFamily:style?.fontFamily,color:style?.color,accent2:getComputedStyle(root).getPropertyValue('--accent2').trim(),boxShadow:style?.boxShadow,background:style?.backgroundColor,border:style?.borderColor}})()`));
      if (name.includes('task card is visible')) console.error('[sftp-vue task card]', await execute(`return (()=>{const drawer=document.getElementById('sftpTaskCenterDrawer'),card=drawer?.querySelector('.sftp-job'),d=drawer?.getBoundingClientRect(),c=card?.getBoundingClientRect(),point=c&&{x:c.left+Math.min(c.width/2,30),y:c.top+Math.min(c.height/2,20)},hit=point&&document.elementFromPoint(point.x,point.y),rect=r=>r&&{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};return {viewport:{width:innerWidth,height:innerHeight},drawer:rect(d),card:rect(c),drawerVisible:drawer?.checkVisibility(),cardVisible:card?.checkVisibility(),point,hit:hit&&{tag:hit.tagName,id:hit.id,className:String(hit.className),text:hit.textContent?.slice(0,80)},contained:!!hit&&drawer?.contains(hit),html:card?.outerHTML?.slice(0,500)}})()`));
      const diagnostics = await execute(`return (()=>{const root=document.querySelector('.sftp-vue-fixture'),shell=root?.querySelector('.sftp-shell'),toolbar=root?.querySelector('.sftp-toolbar'),list=root?.querySelector('.sftp-list'),rect=node=>{const r=node?.getBoundingClientRect?.();return r?{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth}:null};return {adapter:typeof window.termaSftpViews,fixture:rect(root),shell:rect(shell),toolbar:rect(toolbar),list:rect(list),overflow:[...shell.querySelectorAll('*')].map(node=>({tag:node.tagName,id:node.id,className:String(node.className).slice(0,100),...rect(node)})).filter(item=>item.right>shell.getBoundingClientRect().right+2).slice(0,12),theme:{toolbar:toolbar?.dataset.theme,list:list?.dataset.theme},rows:list?.querySelectorAll('.sftp-row').length,columns:list?.querySelectorAll('.sftp-head-cell').length,firstName:list?.querySelector('.sftp-file-name')?.textContent,html:shell?.innerHTML?.slice(0,800)}})()`);
      console.error(JSON.stringify({ failed: name, diagnostics }, null, 2));
    }
    assert.equal(result, true, name);
  };
  const shot = async name => {
    await delay(90);
    browser.webContents.invalidate();
    fs.writeFileSync(path.join(directory, `${viewport}-${name}.png`), (await browser.webContents.capturePage()).toPNG());
    states.push(`${viewport}-${name}`);
  };
  const clickSelection = async index => {
    const before = await execute(`const input=document.querySelectorAll('.sftp-vue-fixture .sftp-check')[${index}];input.scrollIntoView({block:'nearest'});return input.checked;`);
    const point = await execute(`const input=document.querySelectorAll('.sftp-vue-fixture .sftp-check')[${index}];const r=input.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};`);
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) browser.webContents.sendInputEvent({type,...point,button:'left',clickCount:1});
    await delay(40);
    const pointerResult = await execute(`return (()=>{const input=document.querySelectorAll('.sftp-vue-fixture .sftp-check')[${index}],r=input?.getBoundingClientRect(),hit=r&&document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {checked:input?.checked,hitInput:hit===input};})()`);
    if (!pointerResult.hitInput || pointerResult.checked === before) await execute(`document.querySelectorAll('.sftp-vue-fixture .sftp-check')[${index}]?.click();`);
    await execute(`window.termaSftpViews.updateSelection(window.__sftpVueFixture.key);`);
  };

  await execute(`
    await window.termaI18nReady;
    document.querySelectorAll('.sftp-vue-fixture').forEach(node=>node.remove());
    document.querySelector('style[data-sftp-vue-fixture]')?.remove();
    const css=document.createElement('style');css.dataset.sftpVueFixture='';css.textContent='body.sftp-vue-visual-test #toast{visibility:hidden!important}.sftp-vue-fixture{position:fixed;inset:0;z-index:60;padding:10px;box-sizing:border-box;background:var(--bg);overflow:auto}.sftp-vue-fixture .sftp-shell{height:calc(100vh - 20px);min-height:0;padding:12px;box-sizing:border-box;border:1px solid var(--border);border-radius:8px;overflow:hidden}.sftp-vue-fixture .sftp-list{min-height:0;overflow:auto}';document.head.append(css);
    const fixture=document.createElement('section');fixture.id='view-sftp';fixture.className='workspace sftp-vue-fixture';document.body.append(fixture);document.body.classList.add('sftp-vue-visual-test');
  `);

  const model = {
      key: `sftp-vue-${viewport}`, connectionId: 7, quick: false, desktop: false, mobile: viewport === 'mobile', encoding: 'UTF-8',
      status: 'connected', error: '', selectedPaths: [], columns: ['name', 'size', 'mtime', 'access'], favorite: false,
      favorites: [{ name: '收藏目录', path: '/var/data' }], clipboard: { count: 2, moving: false, source: '备份节点', matches: false, canPaste: true },
      hasRemoteJump: true, hasLocalFiles: true, historyBack: true, historyForward: false, mobileToolbarExpanded: true,
      state: { path: '/var/data', entries: [
        { name: '子目录', type: 'dir', size: 0, mtime: 1780000000, mode: 'drwxr-xr-x', owner: '0', group: '0', metadata_known: true },
        { name: '配置 <img src=x onerror=alert(1)>.json', type: 'file', size: 2048, mtime: 1780000000, mode: '-rw-r--r--', owner: 'root', group: 'root', metadata_known: true },
        { name: '预览.svg', type: 'file', size: 4096, mtime: 1780000000, mode: '-rw-r--r--', owner: 'root', group: 'root', metadata_known: true },
        { name: '归档.zip', type: 'file', size: 8192, mtime: 1780000000, mode: '-rw-r--r--', owner: 'root', group: 'root', metadata_known: true, path_bytes_b64: 'eA==' }
      ], selected: null, query: '', recursiveSearch: false, recursiveSearchTruncated: false, sort: 'name', dir: 'asc', page: 1, pageSize: 50, total: 4, totalPages: 1, unfilteredTotal: 4, loading: false }
    };

  await execute(`
    const options={model:${JSON.stringify(model)},text:(key,params)=>tr(key,params),bytes:window.termaSftpTaskWorkspace.presentation.bytes,time:()=>"2026-10-21 12:30:00",kind:window.termaSftpFileKind,path:name=>"/var/data/"+name,isArchive:window.termaSftpFileActions.isArchive,isImage:window.termaSftpPreviewRuntime.editor.isSftpImageName,directorySize:()=>({...window.termaSftpDirectoryWorkspace.cache.presentation(null),key:"test"}),opening:()=>false,run:(action,...args)=>{const f=window.__sftpVueFixture;f.actions.push(action);f.lastAction={action,args};if(action==='mobileToolbar'){f.options.model.mobileToolbarExpanded=!f.options.model.mobileToolbarExpanded;window.termaSftpViews.refresh(f.key,f.options,'navigation');}return true}};
    window.__sftpVueFixture={options,actions:[],key:options.model.key,root:document.querySelector('.sftp-vue-fixture')};
    const f=window.__sftpVueFixture;
    f.previousToolbarPlace=window.termaWorkspaceToolbar.place;
    f.previousToolbarSync=window.termaWorkspaceToolbar.sync;
    const inline=(toolbar,mount)=>{
      if(!toolbar||!mount)return;
      if(toolbar.parentElement!==mount)mount.append(toolbar);
      toolbar.hidden=false;toolbar.classList.remove('sftp-toolbar-header');
    };
    window.termaWorkspaceToolbar.place=(kind,key,toolbar,mount)=>{
      const visible=f.previousToolbarPlace(kind,key,toolbar,mount);
      if(key!==options.model.key||!mount)return visible;
      inline(toolbar,mount);return true;
    };
    // This fixture is deliberately outside the dock; keep its toolbar inline during application-wide repaints.
    window.termaWorkspaceToolbar.sync=(options)=>{
      const result=f.previousToolbarSync(options);
      const mount=f.root.querySelector('#sftpToolbarMount');inline(mount?.querySelector('.sftp-toolbar'),mount);
      return result;
    };
    window.termaSftpViews.mount(window.__sftpVueFixture.root,options);
    window.termaSftpViews.refresh(options.model.key,options,'list');
    window.__sftpVueFixture.removeLanguageRenderer=registerTermaI18nRenderer(()=>{const f=window.__sftpVueFixture;if(f&&window.termaSftpViews.isMounted(f.key)){window.termaSftpViews.refresh(f.key,f.options);window.termaSftpColumns.syncSftpListLayout(document.querySelector('#sftpList'));}});
    window.termaSftpColumns.syncSftpListLayout(document.querySelector('#sftpList'));
  `);

  await execute(`document.querySelectorAll('.sftp-vue-fixture .sftp-check')[1].click();`);
  await check('Vue single selection retains metadata and row actions without the multi-selection bar', `(()=>{const f=window.__sftpVueFixture,entries=window.termaSftpView.selectedEntries(f.key),bar=document.querySelector('.sftp-vue-fixture .sftp-selection-bar'),row=document.querySelector('.sftp-row.is-selected');return f.options.model.selectedPaths.length===1&&entries.length===1&&entries[0].name==='配置 <img src=x onerror=alert(1)>.json'&&entries[0].size===2048&&bar.hidden&&document.querySelectorAll('.sftp-row.is-selected').length===1&&!!row?.querySelector('.sftp-row-action-more')})()`);
  await shot('selection-single');
  await execute(`window.__sftpVueFixture.root.querySelector('#sftpSelectAll').click();`);
  await check('Vue multiple selection shows the action bar with metadata snapshots', `(()=>{const f=window.__sftpVueFixture;return window.termaSftpView.selectedPaths(f.key).length===4&&window.termaSftpView.selectedEntries(f.key).length===4&&!document.querySelector('#sftpSelectionBar').hidden&&document.querySelector('#sftpSelectAll').checked&&!document.querySelector('#sftpSelectAll').indeterminate})()`);
  await shot('selection-all');
  await execute(`const f=window.__sftpVueFixture;window.termaSftpView.clearSelection(f.key);`);
  await check('Vue selection clear releases toolbar and row state', `(()=>{const f=window.__sftpVueFixture;return window.termaSftpView.selectedPaths(f.key).length===0&&document.querySelector('.sftp-vue-fixture .sftp-selection-bar').hidden&&document.querySelectorAll('.sftp-row.is-selected').length===0})()`);

  await execute(`(()=>{const list=document.querySelector('.sftp-vue-fixture .sftp-list'),mobile=innerWidth<=520;window.termaSftpColumns.syncSftpListLayout(list,500);const narrow=list.classList.contains('sftp-actions-more-only')&&list.classList.contains('sftp-actions-minimal');window.termaSftpColumns.syncSftpListLayout(list,800);const compact=list.classList.contains('sftp-actions-compact')&&!list.classList.contains('sftp-actions-minimal')&&list.classList.contains('sftp-actions-more-only')===mobile;window.termaSftpColumns.syncSftpListLayout(list,1100);const medium=list.classList.contains('sftp-actions-medium')&&!list.classList.contains('sftp-actions-compact');Object.defineProperty(list,'scrollHeight',{configurable:true,value:200});Object.defineProperty(list,'clientHeight',{configurable:true,value:100});Object.defineProperty(list,'scrollTop',{configurable:true,value:0});window.termaSftpColumns.syncSftpListScrollCue(list);const scrollCue=list.classList.contains('has-scroll-below');Object.defineProperty(list,'scrollTop',{configurable:true,value:100});window.termaSftpColumns.syncSftpListScrollCue(list);const scrollCueClears=!list.classList.contains('has-scroll-below');delete list.scrollHeight;delete list.clientHeight;delete list.scrollTop;window.termaSftpColumns.syncSftpListLayout(list);window.__sftpVueFixture.layoutChecks={narrow,compact,medium,scrollCue,scrollCueClears};})();`);
  await check('responsive column breakpoints and scroll cue', `(()=>{const result=window.__sftpVueFixture.layoutChecks;return result?.narrow&&result?.compact&&result?.medium&&result?.scrollCue&&result?.scrollCueClears})()`);

  for (const theme of ['light', 'dark']) {
    for (const language of ['zh-CN', 'en-US']) {
      const name = `${language}-${theme}`;
      await execute(`applyTheme(${JSON.stringify(theme)});await setTermaLanguage(${JSON.stringify(language)},{render:false});const f=window.__sftpVueFixture;window.termaSftpViews.refresh(f.key,f.options);window.termaSftpColumns.syncSftpListLayout(document.querySelector('#sftpList'));`);
      await check(`${name} path and favorites share a row on desktop and fit on mobile`, `(()=>{
        const root=window.__sftpVueFixture.root,bar=root.querySelector('.sftp-location-bar');
        const path=bar.querySelector('.sftp-navigation-row').getBoundingClientRect();
        const favorites=bar.querySelector('#sftpFavorites').getBoundingClientRect();
        const bounds=bar.getBoundingClientRect(),list=root.querySelector('.sftp-list').getBoundingClientRect();
        const placement=${JSON.stringify(viewport)}==='mobile' ? favorites.top>=path.bottom-1
          : favorites.left>=path.right-1 && Math.abs((path.top+path.bottom)-(favorites.top+favorites.bottom))<2;
        return placement&&path.width>0&&favorites.width>0&&favorites.right<=bounds.right+1&&
          list.top>=bounds.bottom-1&&root.scrollWidth<=root.clientWidth+1;
      })()`);
      await execute(`window.__sftpVueFixture.root.querySelector('#sftpFavorites button').click();`);
      await check(`${name} favorite opens its original path`, `(()=>{const {action,args}=window.__sftpVueFixture.lastAction;return action==='navigate'&&args[0]==='/var/data'})()`);
      await shot(`${name}-compact-location`);
      await runSftpRowActionsUiScenario({ execute, check, shot, browser, viewport, name });
      await execute(`window.termaSftpView.clearSelection(window.__sftpVueFixture.key);`);
      await clickSelection(1);
      await check(`${name} single selection keeps the bulk bar hidden`, `window.termaSftpView.selectedPaths(window.__sftpVueFixture.key).length===1&&document.querySelector('#sftpSelectionBar').hidden&&document.querySelectorAll('.sftp-row.is-selected').length===1`);
      await shot(`${name}-selection-one`);
      await clickSelection(2);
      await check(`${name} second selection shows the bulk bar`, `window.termaSftpView.selectedPaths(window.__sftpVueFixture.key).length===2&&!document.querySelector('#sftpSelectionBar').hidden&&document.querySelectorAll('.sftp-row.is-selected').length===2`);
      await shot(`${name}-selection-two`);
      await clickSelection(2);
      await execute(`const f=window.__sftpVueFixture,item=f.options.model.state.entries[0];window.termaSftpView.clearSelection(f.key);window.termaSftpViews.select(f.key,f.options.model.connectionId,{}, {path:f.options.path(item.name),name:item.name,type:item.type});await setTermaLanguage(${JSON.stringify(language==='zh-CN'?'en-US':'zh-CN')});`);
      await check(`${name} returning to one selection hides the bar across a live language change`, `window.termaSftpView.selectedPaths(window.__sftpVueFixture.key).length===1&&document.querySelector('#sftpSelectionBar').hidden&&document.querySelectorAll('.sftp-row.is-selected').length===1&&document.querySelector('.sftp-row.is-selected .sftp-row-action-more')?.checkVisibility()`);
      await shot(`${name}-selection-back-to-one`);
      await execute(`window.termaSftpView.clearSelection(window.__sftpVueFixture.key);await setTermaLanguage(${JSON.stringify(language)});`);
      await check(`${name} readable secondary text`, `(()=>{const root=document.querySelector('.sftp-list'),style=getComputedStyle(root),canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true}),luminance=color=>{context.fillStyle=color;context.fillRect(0,0,1,1);const rgb=[...context.getImageData(0,0,1,1).data].slice(0,3).map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722},background=luminance(style.backgroundColor);return ['.file-list-status','.sftp-column-mtime','.sftp-access > span'].every(selector=>{const foreground=luminance(getComputedStyle(root.querySelector(selector)).color);return (Math.max(background,foreground)+.05)/(Math.min(background,foreground)+.05)>=4.5})})()`);
      await check(`${name} Vue SFTP structure`, `(()=>{const root=document.querySelector('.sftp-vue-fixture'),shell=root?.querySelector('.sftp-shell'),toolbar=shell?.querySelector('.sftp-toolbar'),list=shell?.querySelector('.sftp-list');return !!shell&&toolbar?.dataset.theme===${JSON.stringify(theme)}&&list?.dataset.theme===${JSON.stringify(theme)}&&toolbar?.classList.contains('terma-vue-root')&&list?.classList.contains('terma-vue-root')&&list.querySelectorAll('.sftp-row').length===4&&list.querySelectorAll('.sftp-head-cell').length===4})()`);
      await check(`${name} numeric SFTP principals show their UID and GID meaning`, `(()=>{const access=document.querySelector('.sftp-vue-fixture .sftp-row .sftp-access');return access?.textContent.includes(tr('sftp:auto.owner_uid',{id:'0'}))&&access.title.includes(tr('sftp:auto.group_gid',{id:'0'}))})()`);
      await check(`${name} row actions and safe names`, `(()=>{const list=document.querySelector('.sftp-vue-fixture .sftp-list'),names=[...list?.querySelectorAll('.sftp-file-name')||[]].map(node=>node.textContent);return Boolean(names.includes('配置 <img src=x onerror=alert(1)>.json')&&!list.querySelector('.sftp-file-name img')&&list.querySelectorAll('.sftp-row-action-core').length>=4&&list.querySelector('.sftp-row-action-wide.danger')&&list.querySelector('.sftp-row-action-more')&&list.querySelector('[data-sftp-column-resize]'))})()`);
      await execute(`const f=window.__sftpVueFixture;Object.assign(f.options.model.state.entries[0],{owner_name:'remote-admin',owner_id:'0',group_name:'wheel',group_id:'0'});window.termaSftpViews.refresh(f.key,f.options);`);
      await check(`${name} file list defaults to resolved names with ID tooltip`, `(()=>{const access=document.querySelector('.sftp-vue-fixture .sftp-row .sftp-access');return access.textContent.includes('remote-admin')&&!access.textContent.includes('UID')&&access.title.includes('remote-admin (UID 0)')&&access.title.includes('wheel (GID 0)')})()`);
      await shot(`${name}-principal-alias`);
      await execute(`const f=window.__sftpVueFixture;Object.assign(f.options.model.state.entries[0],{owner_name:'',owner_id:'',group_name:'',group_id:''});window.termaSftpViews.refresh(f.key,f.options);`);
      await check(`${name} directory size action matches compact control styling`, `(()=>{const button=document.querySelector('.sftp-directory-size-button'),style=button&&getComputedStyle(button),rect=button?.getBoundingClientRect(),root=document.querySelector('.sftp-list'),rowAction=root?.querySelector('.sftp-row-action'),mobile=window.__sftpVueFixture.options.model.mobile,geometry=mobile?(rect.width===0||rect.height===0):Math.abs(rect.height-24)<=1;return !!button&&button.classList.contains('is-idle')&&geometry&&style.fontSize==='10px'&&style.fontFamily.includes('monospace')&&style.color===getComputedStyle(rowAction).color&&style.boxShadow==='none'})()`);
      await check(`${name} translation`, `(()=>{const text=document.querySelector('.sftp-vue-fixture .sftp-shell')?.textContent||'';return ${JSON.stringify(language)}==='zh-CN'?text.includes('根目录')&&text.includes('UTF-8'):text.includes('Root')&&text.includes('UTF-8')})()`);
      await check(`${name} fixed action scope`, `(()=>{const root=document.querySelector('.sftp-vue-fixture'),buttons=[...root.querySelectorAll('.sftp-toolbar button')];return buttons.length>=10&&buttons.every(button=>button.hasAttribute('data-terma-button')||button.dataset.action==='local-files-new-tab')&&root.querySelector('[data-action="local-files-new-tab"]')?.dataset.tabKey===${expectedTabKey}})()`);
      await check(`${name} local files uses flat toolbar chrome`, `(()=>{const button=document.querySelector('.sftp-vue-fixture .local-files-open-button'),style=getComputedStyle(button);return button.hasAttribute('data-terma-button')&&style.borderTopColor==='rgba(0, 0, 0, 0)'&&style.backgroundColor==='rgba(0, 0, 0, 0)';})()`);
      await check(`${name} active inline toolbar visible`, `(()=>{const toolbar=document.querySelector('.sftp-vue-fixture .sftp-toolbar');return !!toolbar&&toolbar.checkVisibility()&&toolbar.getBoundingClientRect().height>=30})()`);
      await check(`${name} no shell overflow`, `(()=>{const shell=document.querySelector('.sftp-vue-fixture .sftp-shell');return !!shell&&shell.scrollWidth<=shell.clientWidth+2})()`);
      await shot(name);
      await execute(`const f=window.__sftpVueFixture;document.querySelector('#sftpPathEditButton').click();const input=document.querySelector('#sftpPathInput');input.value='/tmp/draft <path>';input.dispatchEvent(new Event('input',{bubbles:true}));input.setSelectionRange(5,10);await setTermaLanguage(${JSON.stringify(language==='zh-CN'?'en-US':'zh-CN')});`);
      await check(`${name} path draft, caret and focus survive live translation`, `(()=>{const input=document.querySelector('#sftpPathInput');return !document.querySelector('#sftpPathEditor').hidden&&document.querySelector('#sftpBreadcrumb').hidden&&input.value==='/tmp/draft <path>'&&document.activeElement===input&&input.selectionStart===5&&input.selectionEnd===10})()`);
      await shot(`${name}-path-draft-language`);
      await execute(`const f=window.__sftpVueFixture;document.querySelector('#sftpPathEditor').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));`);
      await check(`${name} submitting path keeps the owning tab action`, `(()=>{const f=window.__sftpVueFixture;return f.lastAction.action==='navigate'&&f.lastAction.args[0]==='/tmp/draft <path>'&&document.querySelector('#sftpPathEditor').hidden&&!document.querySelector('#sftpBreadcrumb').hidden})()`);
      await execute(`const f=window.__sftpVueFixture;window.termaSftpViews.pathEditor(f.key,true);const input=document.querySelector('#sftpPathInput');input.value='/unsaved';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await setTermaLanguage(${JSON.stringify(language)});`);
      await check(`${name} Escape cancels path draft and restores edit button focus`, `document.querySelector('#sftpPathEditor').hidden&&document.activeElement===document.querySelector('#sftpPathEditButton')`);
      await execute(`const f=window.__sftpVueFixture;window.termaSftpViews.search(f.key,'close');window.termaSftpViews.search(f.key,'toggle');const input=document.querySelector('#sftpSearch');input.value='new search';input.dispatchEvent(new Event('input',{bubbles:true}));window.termaSftpViews.searchBusy(f.key,true);`);
      await check(`${name} search value dispatch and busy feedback`, `(()=>{const f=window.__sftpVueFixture;return f.lastAction.action==='searchValue'&&f.lastAction.args[0]==='new search'&&!document.querySelector('#sftpFloatingSearch').hidden&&document.querySelector('#sftpFloatingSearch').getAttribute('aria-busy')==='true'})()`);
      await execute(`const f=window.__sftpVueFixture;f.options.model.state.totalPages=2;window.termaSftpViews.refresh(f.key,f.options,'list');document.querySelector('#sftpList').scrollTop=1e6;`);
      await check(`${name} search stays above continuous list with compact status`, `(()=>{const search=document.querySelector('#sftpFloatingSearch'),a=search.getBoundingClientRect(),list=document.querySelector('#sftpList').getBoundingClientRect(),status=document.querySelector('.file-list-status').getBoundingClientRect(),recursive=search.querySelector('.sftp-search-recursive'),wide=innerWidth>700;return getComputedStyle(search).position==='static'&&a.bottom<=list.top+1&&list.height>100&&status.top>=list.top-1&&status.bottom<=innerHeight&&status.height<=25&&!document.querySelector('.sftp-pager')&&document.querySelector('#sftpSearchToggle').getAttribute('aria-expanded')==='true'&&(!wide||(a.left<=list.left+1&&a.right>=list.right-1&&a.width>=Math.min(800,innerWidth*.75)&&a.height<=70&&getComputedStyle(recursive).gridColumnStart!=='1'))})()`);
      await shot(`${name}-search-busy`);
      await execute(`const f=window.__sftpVueFixture;f.options.model.state.totalPages=1;window.termaSftpViews.refresh(f.key,f.options,'list');document.querySelector('#sftpSearch').focus();`);
      browser.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});await delay(40);
      await check(`${name} Escape returns search focus to its toolbar action`, `document.querySelector('#sftpFloatingSearch').hidden&&document.activeElement.id==='sftpSearchToggle'&&document.activeElement.getAttribute('aria-expanded')==='false'`);
      await execute(`window.termaSftpViews.search(window.__sftpVueFixture.key,'toggle');`);
      await execute(`const f=window.__sftpVueFixture;window.termaSftpViews.searchBusy(f.key,false);document.querySelector('#sftpFloatingSearch button').click();window.termaSftpViews.refresh(f.key,f.options);`);
      await check(`${name} clearing search updates state and stays closed on repaint`, `(()=>{const f=window.__sftpVueFixture;return f.lastAction.action==='searchValue'&&f.lastAction.args[0]===''&&document.querySelector('#sftpSearch').value===''&&document.querySelector('#sftpFloatingSearch').hidden})()`);
      if(viewport==='mobile') {
        await execute(`document.querySelector('#sftpMobileToolbarToggle').click();`);
        await check(`${name} mobile actions collapse consistently`, `document.querySelector('#sftpToolbarMount').hidden&&document.querySelector('#sftpMobileToolbarToggle').getAttribute('aria-expanded')==='false'`);
        await shot(`${name}-toolbar-collapsed`);
        await execute(`document.querySelector('#sftpMobileToolbarToggle').click();`);
        await check(`${name} mobile actions expand consistently`, `!document.querySelector('#sftpToolbarMount').hidden&&document.querySelector('#sftpMobileToolbarToggle').getAttribute('aria-expanded')==='true'`);
      }
      await execute(`
        const f=window.__sftpVueFixture;f.originalRun=f.options.run;
        const update=()=>{const state=f.history.historyState(f.key);f.options.model.historyBack=state.index>0;f.options.model.historyForward=state.index>=0&&state.index<state.paths.length-1;window.termaSftpViews.refresh(f.key,f.options);};
        const directory=window.termaSftpDirectoryWorkspace;
        f.history=directory.navigation; f.historyLoader=directory.loader.load;
        f.historyTab={key:f.key,id:7,kind:'sftp'}; tabs.push(f.historyTab);
        directory.loader.load=async options=>{
          if(options.tabKey!==f.key)return f.historyLoader(options);
          if(f.failNavigation)return false;
          f.options.model.state.path=options.path;
          f.history.remember(f.key,options.path,!!options.historyNavigation);
          return true;
        };
        for(const path of ['/','/var','/var/data'])f.history.remember(f.key,path);
        f.options.run=(action,...args)=>{if(action==='history')return f.navigationPending=f.history.navigateHistory(f.key,args[0]).then(result=>{update();return result;});return f.originalRun(action,...args);};
        update();document.querySelector('#sftpHistoryBack').click();await f.navigationPending;
      `);
      await check(`${name} history back updates path and both buttons`, `(()=>{const f=window.__sftpVueFixture;return f.options.model.state.path==='/var'&&!document.querySelector('#sftpHistoryBack').disabled&&!document.querySelector('#sftpHistoryForward').disabled&&document.querySelector('#sftpBreadcrumb').textContent.includes('var')})()`);
      await shot(`${name}-history-back`);
      await execute(`const f=window.__sftpVueFixture;f.failNavigation=true;document.querySelector('#sftpHistoryBack').click();await f.navigationPending;`);
      await check(`${name} failed history keeps rendered path and cursor`, `(()=>{const f=window.__sftpVueFixture;return f.options.model.state.path==='/var'&&f.history.historyState(f.key).index===1&&!document.querySelector('#sftpHistoryBack').disabled&&!document.querySelector('#sftpHistoryForward').disabled})()`);
      await shot(`${name}-history-failure`);
      await execute(`const f=window.__sftpVueFixture;f.failNavigation=false;document.querySelector('#sftpHistoryForward').click();await f.navigationPending;`);
      await check(`${name} history forward restores directory and disables at end`, `window.__sftpVueFixture.options.model.state.path==='/var/data'&&!document.querySelector('#sftpHistoryBack').disabled&&document.querySelector('#sftpHistoryForward').disabled`);
      await shot(`${name}-history-forward`);
      // History restoration creates a workspace runtime. Release that fixture-owned record so the
      // application language renderer cannot repaint this independent view with a different path.
      await execute(`const f=window.__sftpVueFixture;f.options.run=f.originalRun;f.history.release(f.key);window.termaSftpDirectoryWorkspace.loader.load=f.historyLoader;tabs=tabs.filter(tab=>tab!==f.historyTab);sftpTabRuntimes.delete(f.key);delete f.historyTab;delete f.historyLoader;delete f.history;delete f.originalRun;delete f.navigationPending;`);
      await runSftpConnectionUiScenario({execute,check,shot,name,language});
      await execute(`window.__sftpVueMenuActions=[];window.termaSftpMenus.show({clientX:36,clientY:42,preventDefault(){},stopPropagation(){}},()=>[{label:tr('sftp:menu.refresh',{defaultValue:'Refresh'}),icon:'refresh-cw',run:()=>window.__sftpVueMenuActions.push('refresh')},{label:tr('sftp:menu.send_peer',{defaultValue:'Send to other pane'}),icon:'send',children:[{label:tr('sftp:menu.copy_path',{defaultValue:'Copy path'}),icon:'clipboard',run:()=>window.__sftpVueMenuActions.push('peer-copy')}]}]);`);
      await execute(`await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`);
      await check(`${name} SFTP menu labels and left alignment`, `(()=>{const menu=document.querySelector('#actionMenu.sftp-vue-menu-root'),buttons=[...menu?.querySelectorAll(':scope > .sftp-vue-menu-panel > .sftp-vue-menu-entry > button')||[]],icons=buttons.map(button=>button.querySelector('svg')?.getBoundingClientRect().left),labels=buttons.map(button=>button.querySelector('span')?.getBoundingClientRect().left),spread=values=>Math.max(...values)-Math.min(...values),expected=${JSON.stringify(language==='zh-CN'?'刷新':'Refresh')},rect=menu?.getBoundingClientRect();return buttons.length===2&&buttons[0].textContent.includes(expected)&&menu.getAttribute('aria-label')===(${JSON.stringify(language)}==='zh-CN'?'SFTP 操作':'SFTP actions')&&icons.every(Number.isFinite)&&labels.every(Number.isFinite)&&spread(icons)<1&&spread(labels)<1&&icons.every((value,index)=>value<labels[index])&&buttons.every(button=>getComputedStyle(button).justifyContent==='flex-start')&&rect.left>=-1&&rect.right<=innerWidth+1&&rect.top>=-1&&rect.bottom<=innerHeight+1})()`);
      await shot(`${name}-context-menu`);
      await execute(`document.querySelector('#actionMenu .has-submenu')?.click();`);
      await check(`${name} SFTP submenu opens`, `(()=>{const submenu=document.querySelector('#actionMenu .sftp-vue-menu-submenu'),button=submenu?.querySelector('button'),icon=button?.querySelector('svg'),label=button?.querySelector('span'),rect=submenu?.getBoundingClientRect();return !!submenu&&button?.textContent.includes(${JSON.stringify(language==='zh-CN'?'复制路径':'Copy path')})&&icon?.getBoundingClientRect().left<label?.getBoundingClientRect().left&&getComputedStyle(button).justifyContent==='flex-start'&&rect.left>=-1&&rect.right<=innerWidth+1})()`);
      await check(`${name} context menu and nested menu are rounded`, `[...document.querySelectorAll('#actionMenu,#actionMenu .sftp-vue-menu-submenu')].every(menu=>getComputedStyle(menu).borderTopLeftRadius==='8px'&&getComputedStyle(menu).borderTopWidth==='1px')`);
      await shot(`${name}-context-submenu`);
      await execute(`document.querySelector('#actionMenu .sftp-vue-menu-submenu button')?.click();`);
      await check(`${name} SFTP menu action dispatch`, `window.__sftpVueMenuActions.at(-1)==='peer-copy'&&!document.querySelector('#actionMenu')`);
      await execute(`window.termaSftpMenus.show({clientX:36,clientY:42,preventDefault(){},stopPropagation(){}},()=>[{label:tr('sftp:menu.refresh',{defaultValue:'Refresh'}),icon:'refresh-cw',run:()=>{} }]);document.querySelector('#actionMenu [data-menu-path="0"]')?.focus();await setTermaLanguage(${JSON.stringify(language==='zh-CN'?'en-US':'zh-CN')});`);
      await check(`${name} open menu translates and restores focus`, `(()=>{const button=document.querySelector('#actionMenu [data-menu-path="0"]'),expected=${JSON.stringify(language==='zh-CN'?'Refresh':'刷新')};return button?.textContent.includes(expected)&&document.activeElement===button&&document.querySelector('#actionMenu').getAttribute('aria-label')===(${JSON.stringify(language==='zh-CN'?'en-US':'zh-CN')}==='zh-CN'?'SFTP 操作':'SFTP actions')})()`);
      await execute(`window.termaSftpMenus.release();await setTermaLanguage(${JSON.stringify(language)},{render:false});`);
      await execute(`const shared=Array.from({length:20},(_,index)=>'unchanged '+index),oldText=['before',...shared,'old <img src=x onerror=alert(1)>','after'].join('\\n'),newText=['before',...shared,'new <img src=x onerror=alert(1)>','after'].join('\\n');window.__sftpVueComparePromise=window.termaSftpComparisonViews.show({status:'conflict',remote_path:'/var/data/release.txt'},{remote_path:'/var/data/release.txt',remote_changed_at:1780000000000,local_changed_at:1780000300000,old_size:240,new_size:238,old_text:oldText,new_text:newText});`);
      await check(`${name} conflict comparison is bounded and safe`, `(()=>{const host=document.querySelector('.terma-sftp-comparison-root'),dialog=host?.querySelector('[role="dialog"]'),body=dialog?.querySelector('.sftp-comparison-body'),primary=dialog?.querySelector('.sftp-comparison-actions .danger'),rect=dialog?.getBoundingClientRect();return !!dialog&&dialog.getAttribute('aria-modal')==='true'&&primary?.textContent.includes(${JSON.stringify(language==='zh-CN'?'覆盖并备份远端':'Overwrite and back up remote')})&&body?.textContent.includes('old <img src=x onerror=alert(1)>')&&!body.querySelector('img')&&body.querySelector('.sftp-diff-row.changed')&&body.querySelector('.sftp-diff-collapsed')&&rect.left>=-1&&rect.right<=innerWidth+1&&rect.top>=-1&&rect.bottom<=innerHeight+1})()`);
      await shot(`${name}-comparison-conflict`);
      await execute(`const button=document.querySelector('.sftp-comparison-actions .danger');button.focus();await setTermaLanguage(${JSON.stringify(language==='zh-CN'?'en-US':'zh-CN')});`);
      await check(`${name} open comparison translates and restores focus`, `(()=>{const dialog=document.querySelector('.terma-sftp-comparison-root [role="dialog"]'),button=dialog?.querySelector('.sftp-comparison-actions .danger'),expected=${JSON.stringify(language==='zh-CN'?'Overwrite and back up remote':'覆盖并备份远端')};return button?.textContent.includes(expected)&&document.activeElement===button&&dialog.querySelector('.sftp-comparison-head span')?.textContent.includes(${JSON.stringify(language==='zh-CN'?'Review the changes':'覆盖前请确认')})})()`);
      await execute(`document.querySelector('.sftp-comparison-actions .danger')?.click();`);
      await check(`${name} overwrite choice resolves`, `window.__sftpVueComparePromise.then(choice=>choice==='overwrite')`);
      await shot(`${name}-comparison-closed`);
      await execute(`await setTermaLanguage(${JSON.stringify(language)},{render:false});window.__sftpVueComparePromise=window.termaSftpComparisonViews.show({status:'editing',remote_path:'/var/data/same.txt'},{remote_path:'/var/data/same.txt',old_size:5,new_size:5,old_text:'same content',new_text:'same content'});`);
      await check(`${name} same-content comparison state`, `document.querySelector('.terma-sftp-comparison-root .sftp-diff-unavailable')?.textContent.includes(${JSON.stringify(language==='zh-CN'?'两个版本内容相同':'The two versions are identical')})`);
      await shot(`${name}-comparison-same-content`);
      await execute(`document.querySelector('.sftp-comparison-actions .primary')?.click();`);
      await check(`${name} save choice resolves`, `window.__sftpVueComparePromise.then(choice=>choice==='save')`);
      await execute(`window.__sftpVueComparePromise=window.termaSftpComparisonViews.show({status:'editing',remote_path:'/var/data/large.txt'},{remote_path:'/var/data/large.txt',old_text:'x'.repeat(2*1024*1024+1),new_text:''});`);
      await check(`${name} oversized comparison avoids expensive diff`, `document.querySelector('.terma-sftp-comparison-root .sftp-diff-unavailable')?.textContent.includes(${JSON.stringify(language==='zh-CN'?'文件差异过大':'text exceeds')})||document.querySelector('.terma-sftp-comparison-root .sftp-diff-unavailable')?.textContent.includes(${JSON.stringify(language==='zh-CN'?'超过':'too large')})`);
      await shot(`${name}-comparison-too-large`);
      await execute(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await window.__sftpVueComparePromise;`);
      await check(`${name} comparison Escape closes`, `!document.querySelector('.terma-sftp-comparison-root')`);
      await execute(`const f=window.__sftpVueFixture,items=f.options.model.state.entries.slice(0,2);window.termaSftpViews.restore(f.key,{selectedPaths:items.map(item=>f.options.path(item.name)),activePath:f.options.path(items[0].name),scrollTop:0});window.termaSftpViews.search(f.key,'close');window.termaSftpViews.search(f.key,'toggle');const input=document.querySelector('#sftpSearch');input.value='draft-search';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus({preventScroll:true});input.setSelectionRange(6,12);await setTermaLanguage(${JSON.stringify(language === 'zh-CN' ? 'en-US' : 'zh-CN')});`);
      await check(`${name} selection and search visible`, `document.querySelector('#sftpSelectionBar').hidden===false&&document.querySelectorAll('.sftp-check:checked').length===2&&document.querySelector('#sftpFloatingSearch').hidden===false`);
      await check(`${name} live language keeps draft, focus and caret`, `(()=>{const input=document.querySelector('#sftpSearch'),bar=document.querySelector('#sftpSelectionBar'),text=bar?.textContent||'',expected=${JSON.stringify(language === 'zh-CN' ? 'en-US' : 'zh-CN')};return input?.value==='draft-search'&&document.activeElement===input&&input.selectionStart===6&&input.selectionEnd===12&&(expected==='zh-CN'?text.includes('复制'):text.includes('Copy'))&&document.querySelectorAll('.sftp-check:checked').length===2})()`);
      await check(`${name} selection buttons do not overlap`, `(()=>{const buttons=[...document.querySelectorAll('#sftpSelectionBar .sftp-selection-actions > button:not([hidden])')],rects=buttons.map(button=>button.getBoundingClientRect());return buttons.length>=5&&buttons.every((button,index)=>rects[index].width>=button.scrollWidth-1&&rects[index].width>=24)&&rects.every((a,index)=>rects.slice(index+1).every(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)<1||Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<1))})()`);
      await execute(`await setTermaLanguage(${JSON.stringify(language)});`);
      await shot(`${name}-selection-search`);
      await execute(`const f=window.__sftpVueFixture;window.termaSftpViews.clearSelection(f.key);window.termaSftpViews.search(f.key,'close');f.options.model.status='disconnected';f.options.model.error='SFTP offline';window.termaSftpViews.refresh(f.key,f.options,'banner');`);
      await check(`${name} disconnect banner`, `document.querySelector('#sftpConnectionBanner').hidden===false`);
      await check(`${name} reconnect button fits and keeps its text`, `(()=>{const banner=document.querySelector('#sftpConnectionBanner'),button=banner.querySelector('button'),a=banner.getBoundingClientRect(),b=button.getBoundingClientRect();return b.left>=a.left&&b.right<=a.right+1&&button.scrollWidth<=button.clientWidth+1&&!button.classList.contains('icon-button')})()`);
      await shot(`${name}-disconnected`);
      await execute(`const f=window.__sftpVueFixture;f.options.model.status='connected';window.termaSftpViews.refresh(f.key,f.options,'banner');window.termaSftpViews.refresh(f.key,f.options,'list',{kind:'loading'});`);
      await check(`${name} loading state`, `document.querySelector('#sftpList .ui-state.loading')!==null`);
      await shot(`${name}-loading`);
      await execute(`const f=window.__sftpVueFixture;window.termaSftpViews.refresh(f.key,f.options,'list',{kind:'error',detail:'SFTP error <img src=x onerror=alert(1)>'});`);
      await check(`${name} safe error state`, `document.querySelector('#sftpList .ui-state.error')!==null&&!document.querySelector('#sftpList img')`);
      await check(`${name} retry button keeps its text`, `(()=>{const button=document.querySelector('#sftpList .ui-state.error button');return !!button&&!button.classList.contains('icon-button')&&button.scrollWidth<=button.clientWidth+1})()`);
      await shot(`${name}-error`);
      await execute(`const f=window.__sftpVueFixture;const detail=window.termaPublicErrors.message({code:'SFTP_SUBSYSTEM_UNAVAILABLE',error_code:'sftp_subsystem_unavailable'},'fallback');window.termaSftpViews.refresh(f.key,f.options,'list',{kind:'error',detail});`);
      await check(`${name} SFTP startup failure shows localized guidance`, `(()=>{const state=document.querySelector('#sftpList .ui-state.error'),expected=${JSON.stringify(language==='zh-CN'?'SSH 已连接，但远端无法启动 SFTP':'SSH connected, but the server could not start SFTP')};return state?.textContent.includes(expected)&&!!state.querySelector('button')&&state.scrollWidth<=state.clientWidth+1})()`);
      await shot(`${name}-subsystem-unavailable`);
      await execute(`const f=window.__sftpVueFixture;f.savedEntries=f.options.model.state.entries;f.savedTotal=f.options.model.state.total;f.options.model.state.entries=[];f.options.model.state.total=0;window.termaSftpViews.refresh(f.key,f.options,'list');`);
      await check(`${name} empty state`, `document.querySelector('#sftpList .ui-state.empty')!==null`);
      await shot(`${name}-empty`);
      await execute(`const f=window.__sftpVueFixture;f.options.model.state.entries=f.savedEntries;f.options.model.state.total=f.savedTotal;delete f.savedEntries;delete f.savedTotal;window.termaSftpViews.refresh(f.key,f.options,'list');window.termaSftpColumns.syncSftpListLayout(document.querySelector('#sftpList'));`);
    }
  }

  await execute(`
    const f=window.__sftpVueFixture, options=f.options, input=document.querySelector('#sftpPathInput'),form=document.querySelector('#sftpPathEditor'),breadcrumb=document.querySelector('#sftpBreadcrumb');
    window.termaSftpViews.pathEditor(f.key,true);input.value='/tmp/draft path';input.dispatchEvent(new Event('input',{bubbles:true}));window.termaSftpViews.refresh(f.key,options,'navigation');
    const checkbox=document.querySelector('.sftp-check');window.termaSftpViews.restore(f.key,{selectedPaths:[checkbox.value],activePath:checkbox.value,scrollTop:0});window.termaSftpViews.refresh(f.key,options,'list');
  `);
  await check('path editing draft retained on refresh', `document.querySelector('#sftpPathInput')?.value==='/tmp/draft path'&&document.querySelector('#sftpPathEditor')?.hidden===false`);
  await check('selection retained on list refresh', `document.querySelector('.sftp-check')?.checked===true&&document.querySelector('.sftp-row')?.classList.contains('is-selected')`);
  await execute(`
    const f=window.__sftpVueFixture,item=f.options.model.state.entries[1],path=f.options.path(item.name),nameButton=document.querySelectorAll('.sftp-row .sftp-name')[1];
    applyTheme('light');f.options.model.selectedPaths=[];f.options.model.state.selected=null;window.termaSftpViews.refresh(f.key,f.options,'list');
    nameButton?.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    await new Promise(resolve=>setTimeout(resolve,420));
    f.options.model.selectedPaths=[path];f.options.model.state.selected={path};window.termaSftpViews.refresh(f.key,f.options,'list');
    const selectedNameButton=document.querySelectorAll('.sftp-row .sftp-name')[1];selectedNameButton?.focus();
  `);
  if (viewport === 'desktop') {
    await check('one click only selects and does not rename', `!document.querySelector('.sftp-inline-rename-input')`);
    await execute(`document.querySelectorAll('.sftp-row .sftp-name')[1]?.dispatchEvent(new MouseEvent('click',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,420));`);
    await check('a separated second click opens inline rename', `(()=>{const input=document.querySelector('.sftp-inline-rename-input');return !!input&&input.value==='配置 <img src=x onerror=alert(1)>.json'})()`);
    await shot('inline-rename-second-click-light');
    await execute(`document.querySelector('.sftp-inline-rename-input')?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));const name=document.querySelectorAll('.sftp-row .sftp-name')[1];name?.dispatchEvent(new MouseEvent('click',{bubbles:true}));name?.dispatchEvent(new MouseEvent('click',{bubbles:true}));name?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,420));`);
    await check('double click cancels rename and opens the file', `!document.querySelector('.sftp-inline-rename-input')&&window.__sftpVueFixture.actions.at(-1)==='activateFile'`);
    await execute(`document.querySelectorAll('.sftp-row .sftp-name')[1]?.focus()`);
    await execute(`document.querySelectorAll('.sftp-row .sftp-name')[1]?.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true}));`);
    await check('F2 on the selected file opens inline rename', `(()=>{const input=document.querySelector('.sftp-inline-rename-input');return !!input&&input.value==='配置 <img src=x onerror=alert(1)>.json'&&input.selectionStart===0&&input.selectionEnd===input.value.lastIndexOf('.')})()`);
    await check('desktop inline rename keeps row geometry', `(()=>{const input=document.querySelector('.sftp-inline-rename-input'),row=input?.closest('.sftp-row'),rect=input?.getBoundingClientRect(),rowRect=row?.getBoundingClientRect(),style=input&&getComputedStyle(input);return !!input&&!!row&&style.boxSizing==='border-box'&&style.borderRadius==='3px'&&getComputedStyle(row).position==='relative'&&rect.left>=rowRect.left&&rect.right<=rowRect.right+1&&rect.top>=rowRect.top&&rect.bottom<=rowRect.bottom+1})()`);
    await shot('inline-rename-f2-light');
    for (const theme of ['light','dark']) for (const language of ['zh-CN','en-US']) {
      await execute(`applyTheme('${theme}');await setTermaLanguage('${language}',{render:false});const f=window.__sftpVueFixture;f.originalRun=f.originalRun||f.options.run;f.options.run=(action,...args)=>action==='inlineRename'?Promise.reject(Object.assign(new Error(tr('errors:backend.sftp_rename_exists')),{publicCode:'sftp_rename_exists'})):f.originalRun(action,...args);const input=document.querySelector('.sftp-inline-rename-input');input.value='existing.txt';input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await new Promise(resolve=>setTimeout(resolve,80));`);
      await check(`inline rename conflict ${language}-${theme} keeps draft and visible error`, `(()=>{const input=document.querySelector('.sftp-inline-rename-input'),error=document.querySelector('.sftp-inline-rename-error'),r=error?.getBoundingClientRect();return input?.value==='existing.txt'&&!input.disabled&&input.getAttribute('aria-invalid')==='true'&&error?.textContent===tr('errors:backend.sftp_rename_exists')&&error.checkVisibility()&&r.bottom<=innerHeight&&input.getBoundingClientRect().bottom<=r.top+1})()`);
      await shot(`inline-rename-conflict-${language}-${theme}`);
      await execute(`await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}',{render:false});`);
      await check(`inline rename conflict ${language}-${theme} translates live`, `document.querySelector('.sftp-inline-rename-error').textContent===tr('errors:backend.sftp_rename_exists')`);
    }
    await execute(`window.__sftpVueFixture.options.run=window.__sftpVueFixture.originalRun;applyTheme('light');await setTermaLanguage('zh-CN',{render:false});`);
    await execute(`document.querySelector('.sftp-inline-rename-input')?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
    await check('Escape cancels inline rename', `!document.querySelector('.sftp-inline-rename-input')`);
    await execute(`applyTheme('dark');document.querySelectorAll('.sftp-row .sftp-name')[1]?.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true}));`);
    await check('dark desktop F2 opens inline rename', `!!document.querySelector('.sftp-inline-rename-input')`);
    await shot('inline-rename-f2-dark');
    await execute(`document.querySelector('.sftp-inline-rename-input')?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
  } else {
    await check('mobile keeps inline rename disabled', `!document.querySelector('.sftp-inline-rename-input')`);
  }
  await execute(`
    const modal=document.getElementById('modal')||(()=>{const node=document.createElement('div');node.id='modal';document.body.append(node);return node})();
    const labels={close:tr('sftp:editor.close',{defaultValue:'关闭'}),zoomOut:tr('sftp:editor.zoom_out',{defaultValue:'缩小'}),zoomReset:tr('sftp:editor.zoom_reset',{defaultValue:'适应窗口'}),zoomIn:tr('sftp:editor.zoom_in',{defaultValue:'放大'}),invert:tr('sftp:editor.invert_colors',{defaultValue:'反色'}),originalColors:tr('sftp:editor.color_mode_original',{defaultValue:'正色'}),monochromeInvert:tr('sftp:editor.color_mode_invert_mono',{defaultValue:'黑白反转'}),blackWhiteMode:tr('sftp:editor.color_mode_invert_bw',{defaultValue:'黑白模式'}),colorInvert:tr('sftp:editor.color_mode_invert_color',{defaultValue:'全局反转'}),svgMode:tr('sftp:editor.svg_mode',{defaultValue:'SVG 模式'}),svgPreview:tr('sftp:editor.svg_mode_preview',{defaultValue:'仅预览'}),svgEdit:tr('sftp:editor.svg_mode_edit',{defaultValue:'仅编辑'}),svgSplit:tr('sftp:editor.svg_mode_split',{defaultValue:'分栏预览'}),search:tr('sftp:editor.svg_search',{defaultValue:'搜索 SVG 属性或文本'}),searchPrevious:tr('sftp:editor.search_previous',{defaultValue:'上一个匹配'}),searchNext:tr('sftp:editor.search_next',{defaultValue:'下一个匹配'}),exportPdf:tr('sftp:editor.export_pdf',{defaultValue:'导出 PDF'}),download:tr('sftp:menu.download',{defaultValue:'下载'})};
    window.__sftpPreviewLabels=labels;window.termaSftpPreviewViews.mountImage(modal,{title:'预览.svg',size:'4 KB',isSvg:true,labels});
  `);
  await check('Vue SFTP SVG preview shell keeps legacy hooks', `(()=>{const root=document.querySelector('.terma-sftp-preview-root'),card=root?.querySelector('.sftp-image-modal'),ids=['sftpImageZoomOut','sftpImageZoomReset','sftpImageZoomIn','sftpImageColorMode','sftpImageViewMode','sftpSvgSearch','sftpSvgSearchPrevious','sftpSvgSearchNext','sftpImageClose','sftpImageViewport','sftpImageStage','sftpImageExportPdf','sftpImageDownload','sftpImageCloseBottom'];return !!root&&!!card&&ids.every(id=>!!document.getElementById(id))&&card.getAttribute('role')==='dialog'&&card.textContent.includes('预览.svg')})()`);
  await check('Vue SFTP preview shell fits viewport', `(()=>{const card=document.querySelector('.sftp-image-modal'),rect=card?.getBoundingClientRect();return !!rect&&rect.left>=-1&&rect.right<=innerWidth+1&&rect.top>=-1&&rect.bottom<=innerHeight+1})()`);
  await shot('preview-shell-svg');
  await execute(`window.termaSftpPreviewViews.mountImage(document.getElementById('modal'),{title:'photo.png',size:'2 KB',isSvg:false,labels:window.__sftpPreviewLabels||{close:'关闭',zoomOut:'缩小',zoomReset:'适应窗口',zoomIn:'放大',invert:'反色',originalColors:'正色',monochromeInvert:'黑白反转',blackWhiteMode:'黑白模式',colorInvert:'全局反转',svgMode:'SVG 模式',svgPreview:'仅预览',svgEdit:'仅编辑',svgSplit:'分栏预览',search:'搜索',searchPrevious:'上一个匹配',searchNext:'下一个匹配',exportPdf:'导出 PDF',download:'下载'}});`);
  await check('Vue SFTP image preview omits SVG-only controls', `(()=>{const card=document.querySelector('.sftp-image-modal');return !!card&&!!document.getElementById('sftpImageDownload')&&!document.getElementById('sftpImageColorMode')&&!document.getElementById('sftpImageExportPdf')})()`);
  await shot('preview-shell-image');
  await execute(`window.termaSftpPreviewViews.release();document.getElementById('modal')?.replaceChildren();document.getElementById('modal')&&(document.getElementById('modal').hidden=true);`);
  await check('Vue SFTP preview shell releases cleanly', `!document.querySelector('.terma-sftp-preview-root')`);
  await runSftpEditorUiScenario({ execute, check, shot, viewport, browser });
  await runSftpCopyUiScenario({ browser, execute, check, shot });
  await runSftpTransferUiScenario({ browser, execute, check, shot });
  await runSftpAdapterUiScenario({ execute, check, shot });
  await execute(`document.querySelector('.sftp-row-action-more')?.click();`);
  await check('row action stays in active tab context', `window.__sftpVueFixture.options.model.key===${expectedTabKey}`);
  const fired = await execute('return window.__sftpVueFixture.actions.at(-1)');
  if (fired !== 'entryMenu') throw new Error(`SFTP row action dispatch failed: ${String(fired)}`);
  await runSftpEntrypointUiScenario({execute,check,shot});
  await execute(`window.__sftpVueFixture.removeLanguageRenderer?.();`);
  await shot('draft-and-selection-retained');
  await execute(`window.__sftpVueFixture.root.remove();`);
  await check('inactive detached tab keeps its mount', `window.termaSftpViews.isMounted(window.__sftpVueFixture.key)&&window.termaSftpViews.refresh(window.__sftpVueFixture.key,window.__sftpVueFixture.options,'list')`);
  await execute(`const f=window.__sftpVueFixture;document.body.append(f.root);f.root.replaceChildren();`);
  await check('replaced shell releases stale mount', `!window.termaSftpViews.isMounted(window.__sftpVueFixture.key)&&!window.termaSftpViews.refresh(window.__sftpVueFixture.key,window.__sftpVueFixture.options,'list')`);
  await execute(`const f=window.__sftpVueFixture;window.termaSftpViews.mount(f.root,f.options);window.termaSftpViews.refresh(f.key,f.options,'list');`);
  await check('replaced shell can mount again', `window.termaSftpViews.isMounted(window.__sftpVueFixture.key)&&document.querySelectorAll('.sftp-vue-fixture .sftp-row').length===4`);
  await execute(`const f=window.__sftpVueFixture;f.otherRoot=document.createElement('div');document.body.append(f.otherRoot);window.termaSftpViews.mount(f.otherRoot,f.options);window.termaSftpViews.refresh(f.key,f.options,'list');`);
  await check('moving a Vue SFTP mount removes its old empty shell', `!window.__sftpVueFixture.root.querySelector('.sftp-shell')&&window.__sftpVueFixture.otherRoot.querySelectorAll(':scope > .sftp-shell').length===1`);
  await execute(`const f=window.__sftpVueFixture;window.termaSftpViews.mount(f.root,f.options);window.termaSftpViews.refresh(f.key,f.options,'list');`);
  await check('returning a Vue SFTP mount leaves a single populated shell', `window.__sftpVueFixture.root.querySelectorAll(':scope > .sftp-shell').length===1&&window.__sftpVueFixture.root.querySelectorAll('.sftp-row').length===4&&!window.__sftpVueFixture.otherRoot.querySelector('.sftp-shell')`);
  await execute(`window.__sftpVueFixture.otherRoot.remove();`);
  await execute(`window.termaWorkspaceToolbar.place=window.__sftpVueFixture.previousToolbarPlace;window.termaWorkspaceToolbar.sync=window.__sftpVueFixture.previousToolbarSync;window.termaSftpViews.release(window.__sftpVueFixture.key);document.querySelector('.sftp-vue-fixture').remove();document.body.classList.remove('sftp-vue-visual-test');document.querySelector('style[data-sftp-vue-fixture]')?.remove();delete window.__sftpVueFixture;`);
  await check('release unmounts Vue fixture', `!document.querySelector('.sftp-vue-fixture .sftp-shell')`);
  const report = { viewport, screenshots: states.length, states, checks: checks.length };
  fs.writeFileSync(path.join(directory, `${viewport}-report.json`), JSON.stringify(report, null, 2));
  return report;
}

module.exports = { runSftpVueUiScenario };
