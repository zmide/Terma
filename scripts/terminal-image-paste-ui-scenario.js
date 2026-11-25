const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function runTerminalImagePasteUiScenario(browser, {viewport} = {}) {
  const directory = path.join(process.env.TERMA_UI_DIAGNOSTICS_DIR || path.join(process.cwd(), 'data'), 'terminal-image-paste-visual');
  fs.mkdirSync(directory, {recursive:true});
  const execute = source => browser.webContents.executeJavaScript(`(async()=>{${source};return undefined})()`).catch(error => {
    console.error('[image-paste execute failed]', String(source).slice(0, 180), error);
    throw error;
  });
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const states = [], checks = [];
  await browser.webContents.executeJavaScript(`(()=>{if(!window.sendTerminalData&&window.termaTerminalInputActions)window.sendTerminalData=(...args)=>window.termaTerminalInputActions.sendTerminalData(...args);if(!window.focusTerminalSession&&window.termaTerminalPage)window.focusTerminalSession=(...args)=>window.termaTerminalPage.focusTerminalSession(...args);return null})()`);
  const shot = async name => {
    await delay(280);
    browser.webContents.invalidate();
    fs.writeFileSync(path.join(directory, `${viewport}-${name}.png`), (await browser.webContents.capturePage()).toPNG());
    states.push(`${viewport}-${name}`);
  };
  const check = async (name, expression) => {
    const result = await execute(`return (${expression});`);
    checks.push({name, result});
    if (!result) await shot('failure');
    assert.equal(result, true, name);
  };
  await execute(`
    await window.termaI18nReady;
    while(window.workspaceRestorePending)await new Promise(resolve=>setTimeout(resolve,20));
    window.termaWorkspaceRefresh.stop();window.restoringTabs=true;
    const f=window.__imagePasteFixture={original:{api,uploadSftpFilesToDirectory: window.termaSftpTransfers.controller.submit,sendTerminalData,sendPaste:window.termaTerminalClipboard.send,focusTerminalSession,desktop:window.termaDesktop},key:'clipboard-ui-fixture'};
    f.reset=()=>{
      document.querySelectorAll('.toast').forEach(node=>dismissToast(node));
      f.calls={api:[],uploads:[],data:[],paste:[],focus:0};f.direct=true;
      f.connection={id:990007,x11_mode:'trusted'};
      f.session={connected:true,connection:f.connection,connectionAttempt:1,socket:{readyState:1,send:value=>f.calls.data.push({key:f.key,value})},effectiveX11Mode:'trusted',currentDirectoryKnown:true,currentDirectory:'/home/review'};
      window.termaTerminalState.terminalSessions.set(f.key,f.session);
    };
    window.termaDesktop={readClipboardImage:async()=>({ok:false,reason:'empty'})};
    api=async(url,options={})=>{
      if(!String(url).includes('/terminal-clipboard/image')){
        if(options.method&&options.method!=='GET')throw Error('Unexpected mutation '+url);
        return f.original.api(url,options);
      }
      f.calls.api.push({url,options});return {ready:f.direct};
    };
    window.termaSftpTransfers.controller.submit=async(files,id,directory,options)=>{f.calls.uploads.push({files,id,directory,options});return {ok:true}};
    sendTerminalData=(key,value)=>{f.calls.data.push({key,value});return true};
    window.termaTerminalClipboard.send=async(key,value)=>{f.calls.paste.push({key,value});return true};
    focusTerminalSession=()=>{f.calls.focus+=1};
    f.png=()=>new File([Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3,4])],'source.png',{type:'image/png'});
  `);
  try {
    await check('production TS image service installed', `typeof window.termaTerminalImagePaste?.pasteImage==='function'`);
    for (const theme of ['light', 'dark']) {
      for (const language of ['zh-CN', 'en-US']) {
        const name = `${language}-${theme}`;
        await execute(`applyTheme(${JSON.stringify(theme)});await setTermaLanguage(${JSON.stringify(language)});`);
        for (const state of ['direct', 'fallback', 'unsupported', 'empty']) {
          const expectedKey = {direct:'imageClipboardPasted', fallback:'imagePasted', unsupported:'imageUnsupported', empty:'noImage'}[state];
          await execute(`
            const f=window.__imagePasteFixture;f.reset();f.direct=${state === 'direct'};
            const file=${state === 'empty' ? 'null' : state === 'unsupported' ? "new File(['<svg/>'],'image.svg',{type:'image/svg+xml'})" : 'f.png()'};
            f.result=await window.termaTerminalImagePaste.handleImage(f.key,990007,file);
          `);
          await delay(90);
          await check(`${name} ${state} result and notification`, `(()=>{const f=window.__imagePasteFixture,toast=[...document.querySelectorAll('.toast')].find(node=>!node.classList.contains('is-leaving'));return f.result===${['direct','fallback'].includes(state)}&&!!toast&&toast.textContent.includes(tr('terminal:clipboard.${expectedKey}'))&&toast.classList.contains('${state === 'unsupported' ? 'error' : state === 'empty' ? 'info' : 'success'}')})()`);
          await check(`${name} ${state} notification geometry and language`, `(()=>{const toast=[...document.querySelectorAll('.toast')].find(node=>!node.classList.contains('is-leaving'));if(!toast)return false;const r=toast.getBoundingClientRect(),nodes=[...toast.querySelectorAll('.toast-copy,button,svg')],chrome=[toast.textContent,...nodes.map(node=>node.getAttribute('aria-label')||node.getAttribute('title')||'')].join(' ');return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&nodes.every(node=>{const n=node.getBoundingClientRect();return n.left>=r.left-1&&n.right<=r.right+1&&n.top>=r.top-1&&n.bottom<=r.bottom+1})&&(${JSON.stringify(language)}!=='en-US'||!/[\u3400-\u9fff]/.test(chrome))})()`);
          await check(`${name} ${state} protected action routing`, `(()=>{const c=window.__imagePasteFixture.calls;return ${state === 'direct'
            ? "c.api.length===1&&c.api[0].options.headers['X-Terma-Terminal-X11-Mode']==='trusted'&&c.data.length===1&&c.data[0].value==='\\x16'&&c.uploads.length===0&&c.paste.length===0"
            : state === 'fallback' ? "c.api.length===1&&c.uploads.length===1&&c.uploads[0].id===990007&&c.uploads[0].directory==='/tmp'&&c.uploads[0].options.private===true&&c.uploads[0].options.conflict==='error'&&c.paste.length===1&&c.paste[0].value.startsWith('/tmp/terma-clipboard-')&&c.data.length===0"
            : 'c.api.length===0&&c.uploads.length===0&&c.paste.length===0&&c.data.length===0'};})()`);
          await shot(`${name}-${state}`);
        }
      }
    }
    await execute(`const f=window.__imagePasteFixture;f.reset();await window.termaTerminalImagePaste.handleCtrlV(f.key,990007);`);
    await check('empty desktop clipboard retains ordinary Ctrl+V', `(()=>{const c=window.__imagePasteFixture.calls;return c.data.length===1&&c.data[0].value==='\x16'&&c.api.length===0&&c.uploads.length===0})()`);
    await execute(`
      const f=window.__imagePasteFixture;f.reset();
      window.termaDesktop.readClipboardImage=()=>new Promise(resolve=>{f.resolve=resolve});
      f.pending=window.termaTerminalImagePaste.handleCtrlV(f.key,990007);
      window.termaTerminalState.terminalSessions.set(f.key,{...f.session});f.resolve({ok:false,reason:'empty'});
      f.result=await f.pending;
    `);
    await check('late clipboard read cannot type into replacement session', `(()=>{const f=window.__imagePasteFixture;return f.result===false&&f.calls.data.length===0&&f.calls.paste.length===0&&f.calls.focus===0})()`);
  } finally {
    await execute(`const f=window.__imagePasteFixture;Object.assign(window,{termaDesktop:f.original.desktop});api=f.original.api;window.termaSftpTransfers.controller.submit=f.original.uploadSftpFilesToDirectory;sendTerminalData=f.original.sendTerminalData;window.termaTerminalClipboard.send=f.original.sendPaste;focusTerminalSession=f.original.focusTerminalSession;window.termaTerminalState.terminalSessions.delete(f.key);delete window.__imagePasteFixture;`);
  }
  const report = {viewport, checks:checks.length, screenshots:states.length, states};
  fs.writeFileSync(path.join(directory, `${viewport}-report.json`), JSON.stringify(report,null,2));
  return report;
}

module.exports = {runTerminalImagePasteUiScenario};
