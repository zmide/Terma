const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript-legacy');

// Exercise the service against an isolated view without installing a second renderer global.
const serviceFile = path.join(__dirname, '../frontend/src/features/files/sftp/connection-service.ts');
const serviceSource = ts.transpileModule(fs.readFileSync(serviceFile, 'utf8'), {
  compilerOptions: {module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022}
}).outputText;

async function runSftpConnectionUiScenario({execute,check,shot,name,language}) {
  await execute(`
    const f=window.__sftpVueFixture,m=f.options.model,original=f.options.run;
    f.connectionFixture={original,manual:false,requests:[],errors:[],loads:[],mode:'success'};
    const c=f.connectionFixture;
    const getService=()=>{const exports={}; ${serviceSource}; return exports.createSftpConnectionService;};
    c.service=getService()({active:()=>f.key,tab:key=>key===f.key?{id:7,kind:'sftp',connectionStatus:m.status}:null,keys:id=>id===7?[f.key]:[],ids:()=>[7],runtime:()=>({connectionId:7,requestController:null,state:m.state}),
      status:()=>m.status,isDisconnected:()=>c.manual,disconnected:(_key,value)=>c.manual=value,remember(){},
      changed:(_id,status,error='')=>{m.status=status;m.error=error;window.termaSftpViews.refresh(f.key,f.options);},
      request:async(_id,method)=>{c.requests.push(method);if(method==='POST'&&c.mode==='pending')return new Promise(resolve=>c.finish=resolve);if(method==='POST'&&c.mode==='error')throw new Error(tr('sftp:auto.connection_timeout'));return {connected:true};},
      authenticationFailure:()=>false,repair:async()=>false,load:async options=>c.loads.push(options),dispose(){},releaseQuick(){},clearCache(){},tr,error:message=>c.errors.push(message)});
    f.options.run=(action,...args)=>action==='connection'?(c.pending=c.service.toggle(7,f.key)):action==='reconnect'?(c.pending=c.service.reconnect(7,{tabKey:f.key})):original(action,...args);
    document.querySelector('#sftpConnectionToggle').click();await c.pending;
  `);
  await check(`${name} disconnect button preserves files and shows translated retry`, `(()=>{const f=window.__sftpVueFixture,c=f.connectionFixture,banner=document.querySelector('.sftp-connection-banner');return f.options.model.status==='disconnected'&&c.manual&&c.requests.join(',')==='DELETE'&&banner?.checkVisibility()&&banner.textContent.includes(tr('sftp:auto.connection_disconnected'))&&document.querySelectorAll('.sftp-row').length===4&&document.querySelector('#sftpConnectionToggle').dataset.status==='disconnected'})()`);
  await shot(`${name}-connection-disconnected`);
  await check(`${name} disconnected explanation remains inside banner`, `(()=>{const banner=document.querySelector('.sftp-connection-banner'),text=banner.querySelector('small'),b=banner.getBoundingClientRect(),r=text.getBoundingClientRect();return r.left>=b.left&&r.right<=b.right+1&&text.scrollWidth<=text.clientWidth+1&&text.scrollHeight<=text.clientHeight+1})()`);
  await execute(`const f=window.__sftpVueFixture,c=f.connectionFixture;c.mode='pending';document.querySelector('.sftp-connection-banner button').click();await Promise.resolve();`);
  await check(`${name} connecting button is busy and cannot double submit`, `(()=>{const f=window.__sftpVueFixture,c=f.connectionFixture,b=document.querySelector('#sftpConnectionToggle');b.click();return b.disabled&&b.dataset.status==='connecting'&&c.requests.filter(method=>method==='POST').length===1&&document.querySelectorAll('.sftp-row').length===4})()`);
  await shot(`${name}-connection-connecting`);
  await execute(`const c=window.__sftpVueFixture.connectionFixture;c.finish({connected:true});await c.pending;`);
  await check(`${name} reconnect restores state and refreshes pinned directory`, `(()=>{const f=window.__sftpVueFixture,c=f.connectionFixture;return f.options.model.status==='connected'&&!c.manual&&!document.querySelector('.sftp-connection-banner').checkVisibility()&&c.loads.length===1&&c.loads[0].tabKey===f.key&&c.loads[0].path==='/var/data'&&c.loads[0].preserveView===true&&!document.querySelector('#sftpConnectionToggle').disabled})()`);
  await shot(`${name}-connection-restored`);
  await execute(`const c=window.__sftpVueFixture.connectionFixture;document.querySelector('#sftpConnectionToggle').click();await c.pending;c.mode='error';document.querySelector('.sftp-connection-banner button').click();await c.pending;`);
  await check(`${name} reconnect failure keeps retry and useful error`, `(()=>{const f=window.__sftpVueFixture,c=f.connectionFixture,banner=document.querySelector('.sftp-connection-banner');return f.options.model.status==='disconnected'&&banner.checkVisibility()&&banner.textContent.includes(tr('sftp:auto.connection_timeout'))&&c.errors.length===1&&!document.querySelector('#sftpConnectionToggle').disabled&&c.loads.length===1})()`);
  await shot(`${name}-connection-error`);
  await execute(`await setTermaLanguage(${JSON.stringify(language==='zh-CN'?'en-US':'zh-CN')});`);
  await check(`${name} open disconnected controls translate immediately`, `document.querySelector('.sftp-connection-banner strong')?.textContent===tr('sftp:auto.connection_disconnected')&&document.querySelector('#sftpConnectionToggle').getAttribute('aria-label')===tr('sftp:auto.reconnect_sftp')`);
  await shot(`${name}-connection-language-switched`);
  await execute(`const f=window.__sftpVueFixture,c=f.connectionFixture;await setTermaLanguage(${JSON.stringify(language)});c.mode='success';document.querySelector('.sftp-connection-banner button').click();await c.pending;f.options.run=c.original;delete f.connectionFixture;`);
}
module.exports={runSftpConnectionUiScenario};
