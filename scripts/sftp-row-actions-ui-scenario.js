async function runSftpRowActionsUiScenario({ execute, check, shot, browser, viewport, name }) {
  const fits = `(()=>{const bars=[...document.querySelectorAll('.sftp-vue-fixture .sftp-row-actions')];return bars.length===4&&bars.every(bar=>{const r=bar.getBoundingClientRect(),buttons=[...bar.querySelectorAll('button')].filter(button=>button.checkVisibility()),more=bar.querySelector('.sftp-row-action-more');return more.checkVisibility()&&buttons.every(button=>{const b=button.getBoundingClientRect();return b.left>=r.left-1&&b.right<=r.right+1&&b.width>0&&button.scrollWidth<=button.clientWidth+1})})})()`;
  await check(`${name} translated actions fit their actual columns`, fits);
  await check(`${name} clipboard toolbar keeps translated buttons readable`, `(()=>{const bar=document.querySelector('.sftp-vue-fixture .sftp-clipboard-actions'),r=bar.getBoundingClientRect();return [...bar.querySelectorAll('button')].every(button=>{const b=button.getBoundingClientRect(),span=button.querySelector('span');if(b.left<r.left-1||b.right>r.right+1||b.right>innerWidth+1||button.scrollWidth>button.clientWidth+1)return false;if(!span)return true;const range=document.createRange();range.selectNodeContents(span);const text=range.getBoundingClientRect();return text.left>=b.left&&text.right<=b.right})})()`);
  await shot(`${name}-actions-adaptive`);
  await execute(`const f=window.__sftpVueFixture;f.actionLayout=localStorage.getItem('termaSftpColumnLayoutV1');window.termaSftpColumns.bindSftpColumnControls(document.querySelector('.sftp-vue-fixture .sftp-list'),f.key);`);
  if (viewport === 'desktop') {
    const drag = await execute(`const list=document.querySelector('.sftp-vue-fixture .sftp-list'),handle=list.querySelector('[data-sftp-column-resize="access"]'),r=handle.getBoundingClientRect(),bar=list.querySelector('.sftp-row-actions').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),to:Math.round(r.left+r.width/2+bar.width-24)};`);
    browser.webContents.sendInputEvent({type:'mouseMove',x:drag.x,y:drag.y});
    browser.webContents.sendInputEvent({type:'mouseDown',x:drag.x,y:drag.y,button:'left',clickCount:1});
    await new Promise(resolve => setTimeout(resolve, 40));
    await check(`${name} column separator receives the real pointer`, `document.querySelector('.sftp-vue-fixture .sftp-list').classList.contains('sftp-column-resizing')`);
    browser.webContents.sendInputEvent({type:'mouseMove',x:drag.to,y:drag.y,button:'left'});
    await new Promise(resolve => setTimeout(resolve, 40));
    browser.webContents.sendInputEvent({type:'mouseUp',x:drag.to,y:drag.y,button:'left',clickCount:1});
    await new Promise(resolve => setTimeout(resolve, 70));
    await check(`${name} pointer-resized action column keeps More accessible`, `${fits}&&document.querySelector('.sftp-vue-fixture .sftp-row-actions').clientWidth<=30&&document.querySelector('.sftp-vue-fixture [data-sftp-action-hidden]')!==null`);
    await shot(`${name}-actions-resized`);
  }
  const point = await execute(`window.__sftpVueFixture.lastAction=null;const button=document.querySelector('.sftp-vue-fixture .sftp-row-action-more'),r=button.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};`);
  for (const type of ['mouseMove','mouseDown','mouseUp']) browser.webContents.sendInputEvent({type,...point,button:'left',clickCount:1});
  await new Promise(resolve => setTimeout(resolve, 40));
  await check(`${name} fitted More dispatches the owning file action`, `window.__sftpVueFixture.lastAction.action==='entryMenu'`);
  await shot(`${name}-actions-hover`);
  await execute(`const list=document.querySelector('.sftp-vue-fixture .sftp-list'),f=window.__sftpVueFixture;if(f.actionLayout===null)localStorage.removeItem('termaSftpColumnLayoutV1');else localStorage.setItem('termaSftpColumnLayoutV1',f.actionLayout);window.termaSftpColumns.releaseSftpPixelColumnLayout(list);window.termaSftpColumns.syncSftpListLayout(list);`);
  await check(`${name} wider action column restores fitting buttons`, fits);
  if (viewport === 'desktop') {
    await execute(`const root=window.__sftpVueFixture.root;root.style.width='620px';root.style.right='auto';window.termaSftpColumns.syncSftpListLayout(root.querySelector('.sftp-list'));`);
    await check(`${name} narrow pane within a wide viewport never clips actions`, fits);
    await shot(`${name}-actions-narrow-pane`);
    await execute(`const root=window.__sftpVueFixture.root;root.style.removeProperty('width');root.style.removeProperty('right');window.termaSftpColumns.syncSftpListLayout(root.querySelector('.sftp-list'));`);
  }
}
module.exports = { runSftpRowActionsUiScenario };
