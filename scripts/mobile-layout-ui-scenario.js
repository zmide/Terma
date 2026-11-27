const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function runMobileLayoutUiScenario(browser) {
  const directory = process.env.TERMA_UI_MOBILE_LAYOUT_DIR || path.join(process.cwd(), 'data', 'mobile-layout-visual');
  fs.mkdirSync(directory, {recursive:true});
  const execute = source => browser.webContents.executeJavaScript(source);
  const evaluate = (callback, ...args) => execute(`(${callback.toString()})(...${JSON.stringify(args)})`);
  const settle = () => execute('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const reports = [];
  browser.webContents.debugger.attach('1.3');
  await browser.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
  let checks = 0;
  const check = (value, label) => { assert.equal(value, true, label); checks++; };
  const capture = async name => {
    await settle();
    browser.webContents.invalidate();
    fs.writeFileSync(path.join(directory, name + '.png'), (await browser.webContents.capturePage()).toPNG());
  };
  const click = async selector => {
    const point = await evaluate(selector => {
      const button = document.querySelector(selector), box = button?.getBoundingClientRect();
      if (!box || !button.checkVisibility() || box.top < 0 || box.bottom > innerHeight) throw Error('Unreachable ' + selector);
      const point = {x:Math.round(box.left + box.width / 2), y:Math.round(box.top + box.height / 2)};
      if (!button.contains(document.elementFromPoint(point.x, point.y))) throw Error('Covered ' + selector);
      return point;
    }, selector);
    for (const type of ['mouseMove','mouseDown','mouseUp']) browser.webContents.sendInputEvent({type,...point,button:'left',clickCount:1});
    await settle();
  };
  await execute(`(async()=>{
    await window.termaI18nReady;
    while(workspaceRestorePending) await new Promise(resolve=>setTimeout(resolve,20));
    await window.termaWorkspaceRefresh.stop();
    window.termaNotificationToasts.dispose();
    window.restoringTabs=true;
    for(const key of ['mobile-layout-a','mobile-layout-b']) setWorkspace(key,'','terminal',key,true,true,{kind:'mobile-ui-fixture'});
    window.termaWorkspaceShell.showMobileWorkspace();
    window.__mobileLayoutOriginalViewport=window.visualViewport;
  })()`);
  try {
    for (const width of [1200,390,320]) for (const language of ['zh-CN','en-US']) for (const theme of ['light','dark']) {
      browser.setContentSize(width, 844);
      await evaluate(async (language,theme) => {
        await setTermaLanguage(language); applyTheme(theme);
        await window.termaSettingsNavigation.open('settings-security');
        window.termaWorkspaceShell.showMobileWorkspace();
      },language,theme);
      await settle();
      const header = await evaluate(() => {
        const buttons=[...document.querySelectorAll('#workspaceQuickActions > button,#sftpTaskCenterButton')];
        const boxes=buttons.map(node=>node.getBoundingClientRect());
        const cy=box=>box.top+box.height/2;
        return {
          flat:buttons.length===5&&buttons.every(node=>{const style=getComputedStyle(node);return style.borderTopWidth==='0px'&&style.borderRadius==='0px'&&style.boxShadow==='none';}),
          aligned:boxes.every(box=>box.width===34&&box.height===34&&Math.abs(cy(box)-cy(boxes[0]))<1),
          fits:boxes.every(box=>box.left>=0&&box.right<=innerWidth&&box.top>=0),
          singleWorkspaceHidden:document.getElementById('workspaceGroupBar').hidden,
          noOverflow:document.documentElement.scrollWidth<=innerWidth,
          geometry:boxes.map(box=>[box.left,box.top,box.width,box.height]),
          translated:document.documentElement.lang!=='en-US'||buttons.every(node=>!/[\u3400-\u9fff]/.test(node.title+' '+node.getAttribute('aria-label')))
        };
      });
      await capture(`${width}-${language}-${theme}-header`);
      for (const [key,value] of Object.entries(header)) if(key!=='geometry') check(value,`${width}/${language}/${theme} header ${key}: ${JSON.stringify(header)}`);
      await evaluate(() => {
        window.__mobileLayoutRequests=0;
        window.__mobileLayoutCredentialResult='pending';
        void window.termaConnectionCredentials.prompt({id:990911,name:'Mobile fixture',ssh_host:'fixture.example',ssh_user:'fixture',ssh_port:22,auth_type:'password'},
          {context:tr('connections:credentials.reconnect'),onTemporary:()=>{}}, {
            api:async url=>{if(url==='/api/identity-files')return [];window.__mobileLayoutRequests++;throw Error(tr('connections:credentials.verification_failed'));},
            tr,notify:()=>{}
          }).then(result=>window.__mobileLayoutCredentialResult=result);
      });
      await settle();
      await evaluate(async (language) => {
        const field=document.getElementById('sshCredentialPassword');
        field.value='Synthetic-draft-only';field.dispatchEvent(new Event('input',{bubbles:true}));
        field.focus();field.setSelectionRange(2,7);
        window.__mobileLayoutPassword=field;
        await setTermaLanguage(language==='zh-CN'?'en-US':'zh-CN');
      },language);
      const draft = await evaluate(() => {
        const field=document.getElementById('sshCredentialPassword');
        return {same:field===window.__mobileLayoutPassword,value:field.value,focused:document.activeElement===field,selection:[field.selectionStart,field.selectionEnd]};
      });
      check(draft.same&&draft.value==='Synthetic-draft-only'&&draft.focused&&draft.selection[0]===2&&draft.selection[1]===7,`${width}/${language}/${theme} live language retains credential draft and focus: ${JSON.stringify(draft)}`);
      await evaluate(async language=>{await setTermaLanguage(language);},language);
      for (const visibleHeight of width===1200 ? [844] : [844,430,300]) {
        await evaluate((height,width) => {
          // Simulate browser chrome/keyboard changing only the visual viewport,
          // keeping the layout viewport tall as on a physical phone.
          if(width<760) {
            const viewport=new EventTarget();Object.assign(viewport,{height,width,offsetTop:height===844?0:24,offsetLeft:0});
            Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});
          }
          window.termaViewport.sync({force:true});
          const card=document.querySelector('.ssh-credential-repair-modal');card.scrollTop=Math.floor(card.scrollHeight/2);
        },visibleHeight,width);
        await settle();
        const metrics = await evaluate(() => {
          const card=document.querySelector('.ssh-credential-repair-modal');
          const footer=card.querySelector('.actions'), box=card.getBoundingClientRect();
          const viewport=window.visualViewport, top=viewport?.offsetTop||0, bottom=top+(viewport?.height||innerHeight);
          const buttons=[...footer.querySelectorAll('button')];
          return {
            bounded:box.top>=top-1&&box.bottom<=bottom+1&&box.left>=0&&box.right<=innerWidth,
            sticky:getComputedStyle(footer).position==='sticky',
            geometry:{card:box.toJSON(),buttons:buttons.map(button=>{const rect=button.getBoundingClientRect();return {rect:rect.toJSON(),coveredBy:document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)?.outerHTML.slice(0,180)};})},
            buttonsReachable:buttons.length===2&&buttons.every(button=>{
              const rect=button.getBoundingClientRect();
              return rect.top>=top&&rect.bottom<=bottom&&rect.left>=0&&rect.right<=innerWidth&&button.contains(document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2));
            }),
            noOverflow:document.documentElement.scrollWidth<=innerWidth,
            translated:document.documentElement.lang!=='en-US'||!/[\u3400-\u9fff]/.test(card.textContent+[...card.querySelectorAll('*')].map(node=>node.title+' '+(node.getAttribute('aria-label')||'')).join(''))
          };
        });
        await capture(`${width}-${language}-${theme}-${visibleHeight}-credentials`);
        for(const [key,value] of Object.entries(metrics))if(key!=='geometry')check(value,`${width}/${language}/${theme}/${visibleHeight} credentials ${key}: ${JSON.stringify(metrics)}`);
        reports.push({width,language,theme,visibleHeight,...metrics});
      }
      await click('#sshCredentialConnect');
      check(await evaluate(()=>window.__mobileLayoutRequests===1),`${width}/${language}/${theme} visible submit receives a real pointer click`);
      await click('[data-credential-close]');
      await evaluate(() => {
        void inputModal(tr('common:auto.confirm'),tr('connections:auto.name'),'Synthetic draft').then(value=>window.__mobileLayoutInput=value);
      });
      await settle();
      await click('#modalConfirmBtn');
      check(await evaluate(()=>window.__mobileLayoutInput==='Synthetic draft'),`${width}/${language}/${theme} shared input confirm is reachable`);
      await capture(`${width}-${language}-${theme}-finished`);
      await evaluate(()=>window.termaEfficiency.palette.open());
      await settle();
      check(await evaluate(()=>{
        const panel=document.querySelector('#quickPanel .quick-panel-dialog'),box=panel.getBoundingClientRect();
        const viewport=window.visualViewport,top=viewport?.offsetTop||0,bottom=top+(viewport?.height||innerHeight);
        return box.top>=top&&box.bottom<=bottom&&box.left>=0&&box.right<=innerWidth&&document.activeElement?.id==='quickPanelInput';
      }),`${width}/${language}/${theme} command palette fits visible viewport and focuses search`);
      await capture(`${width}-${language}-${theme}-palette`);
      await evaluate(()=>{
        window.termaEfficiency.palette.close();
        Object.defineProperty(window,'visualViewport',{configurable:true,value:window.__mobileLayoutOriginalViewport});
        window.termaViewport.sync({force:true});
      });
    }
  } finally {
    await evaluate(()=>{closeModal();Object.defineProperty(window,'visualViewport',{configurable:true,value:window.__mobileLayoutOriginalViewport});window.termaViewport.sync({force:true});});
    browser.webContents.debugger.detach();
  }
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({checks,reports},null,2));
  console.log(`Mobile layout passed ${checks} checks across headers, live language, shared input and credential dialogs, including emulated keyboard heights`);
}

module.exports={runMobileLayoutUiScenario};
