const assert=require('node:assert/strict');
// Extends the shared management browser fixture with every RDP/XDMCP confirmation.
async function protocolStates({id,protocol,prefix,language,execute,evaluate,wait,click,capture,inspect,assertions}){
 let checks=0;const check=async(name,expression)=>{const value=await evaluate(expression);assert.equal(value,true,name);checks++;assertions.push({name,value});};
 const actions=protocol==='rdp'?[['install','online'],['install','offline'],['install','local-offline'],['start'],['stop'],['restart'],['uninstall']]:[['install-lightdm','online'],['install-lightdm','offline'],['install-lightdm','local-offline'],['install-xfce'],['install-rdp'],['enable'],['disable'],['repair-session'],['repair-xrdp'],['cleanup-sessions'],['uninstall-lightdm']];
 const start=(action,mode='online')=>execute(`window.__protocolDone=false;void window.termaRemoteManagement.protocol.operate(${id},'${protocol}','${action}','${mode}').then(value=>{window.__protocolResult=value;window.__protocolDone=true;})`);
 for(const [action,mode] of actions){
  await execute('window.__managementMode="ready"');const before=await evaluate('window.__managementRequests.filter(c=>c.method==="POST"&&c.route.endsWith("/server")).length');
  await start(action,mode);await wait("document.querySelector('#modal .forward-question')");
  await inspect('#modal .forward-question',`${prefix} ${protocol} ${action} ${mode||'online'} confirm`);await capture(`${prefix}-${protocol}-${action}-${mode||'online'}-confirm`);
  if(action==='uninstall'||action==='uninstall-lightdm'){
   await execute(`await setTermaLanguage('${language==='en-US'?'zh-CN':'en-US'}')`);await inspect('#modal .forward-question',`${prefix} ${protocol} confirmation live language`);await capture(`${prefix}-${protocol}-confirm-language`);await execute(`await setTermaLanguage('${language}')`);
  }
  await click('#modal .forward-question button:last-child');await wait('window.__protocolDone');
  await check(`${prefix} ${protocol} ${action} cancel preserves service`,`window.__protocolResult===null&&window.__managementRequests.filter(c=>c.method==='POST'&&c.route.endsWith('/server')).length===${before}`);
 }
 await execute('window.__managementPostMode="task";window.__managementTaskStatus="running"');
 await start(protocol==='rdp'?'install':'install-lightdm','local-offline');await wait("document.querySelector('#modal .forward-question')");await click('#modal .forward-question button:first-child');await wait("document.querySelector('#remoteAdminMethod')");
 await execute("const input=document.querySelector('#remoteAdminMethod');input.value='agent';input.dispatchEvent(new Event('change',{bubbles:true}))");
 await inspect('#modal .remote-admin-modal',`${prefix} ${protocol} exact scope authorization`);await capture(`${prefix}-${protocol}-authorization`);await click('#modal .remote-admin-modal button[type=submit]');
 await wait(`document.querySelector('#${protocol}ServerState .remote-component-progress-head')`);
 await execute(`document.querySelector('#${protocol}ServerState .remote-component-progress-head').scrollIntoView({block:'center'})`);
 await check(`${prefix} ${protocol} task visible in viewport`,`(()=>{const node=document.querySelector('#${protocol}ServerState .remote-component-progress-head');if(!node?.checkVisibility())return false;const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return r.top>=0&&r.bottom<=innerHeight&&node.contains(hit);})()`);
 await inspect(`#${protocol}ServerState`,`${prefix} ${protocol} real task progress`);await capture(`${prefix}-${protocol}-task-running`);
 const scope=protocol==='rdp'?'rdp.server.install-local-offline':'xdmcp.install-lightdm-local-offline';
 await check(`${prefix} ${protocol} fixed authorization scope`,`window.__managementRequests.filter(c=>c.route==='/api/admin-grants').at(-1)?.body&&JSON.parse(window.__managementRequests.filter(c=>c.route==='/api/admin-grants').at(-1).body).scope==='${scope}'`);
 await execute("window.__managementTaskStatus='done'");await wait('window.__protocolDone');await wait(`!document.querySelector('#${protocol}ServerState .remote-component-progress-head')`);
 await inspect(`#${protocol}ServerState`,`${prefix} ${protocol} completion redetected`);await capture(`${prefix}-${protocol}-task-complete`);
 await check(`${prefix} ${protocol} completed lock released`,`!isUiActionInFlight('${protocol}-server:${id}')`);
 await execute('window.__managementPostMode="delayed-error";window.__managementPrivileged=true');
 await start(protocol==='rdp'?'start':'enable');await wait("document.querySelector('#modal .forward-question')");await click('#modal .forward-question button:first-child');
 await wait('!!window.__managementRejectPost');await execute(`document.querySelector('#${protocol}ServerState').scrollIntoView({block:'center'})`);
 await inspect(`#${protocol}ServerState`,`${prefix} ${protocol} request pending`);await capture(`${prefix}-${protocol}-request-pending`);
 await execute(`await setTermaLanguage('${language==='en-US'?'zh-CN':'en-US'}')`);await inspect(`#${protocol}ServerState`,`${prefix} ${protocol} pending language`);await capture(`${prefix}-${protocol}-pending-language`);await execute(`await setTermaLanguage('${language}');window.__managementRejectPost();window.__managementRejectPost=null`);
 await wait('window.__protocolDone');await check(`${prefix} ${protocol} error restores controls`,`window.__protocolResult===null&&!isUiActionInFlight('${protocol}-server:${id}')`);
 await inspect(`#${protocol}ServerState`,`${prefix} ${protocol} request error`);await capture(`${prefix}-${protocol}-request-error`);
 await execute('window.__managementPostMode="result"');await start(protocol==='rdp'?'start':'enable');await wait("document.querySelector('#modal .forward-question')");await click('#modal .forward-question button:first-child');await wait('window.__protocolDone');
 await inspect(`#${protocol}ServerState`,`${prefix} ${protocol} retry`);await capture(`${prefix}-${protocol}-retry`);
 await execute(`window.__managementPostMode="";window.__managementPrivileged=false;window.__protocolConnections=connections;connections=[];await window.termaRemoteManagement.protocol.inspect(${id},'${protocol}')`);
 await inspect(`#${protocol}ServerState`,`${prefix} ${protocol} no SSH management`);await capture(`${prefix}-${protocol}-unlinked`);
 await execute(`await setTermaLanguage('${language==='en-US'?'zh-CN':'en-US'}')`);await inspect(`#${protocol}ServerState`,`${prefix} ${protocol} unlinked language`);await capture(`${prefix}-${protocol}-unlinked-language`);
 await execute(`await setTermaLanguage('${language}');connections=window.__protocolConnections;await window.termaRemoteManagement.protocol.inspect(${id},'${protocol}')`);return checks;
}
module.exports={protocolStates};
