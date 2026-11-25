const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function runI18nResourcesUiScenario(window) {
  const directory = path.join(process.env.TERMA_UI_DIAGNOSTICS_DIR || path.join(process.cwd(), 'data'), 'i18n-resources');
  fs.mkdirSync(directory, {recursive:true});
  const execute = source => window.webContents.executeJavaScript(source);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const reports = [];

  await execute(`(async()=>{
    await window.termaI18nReady;
    while(window.workspaceRestorePending)await new Promise(resolve=>setTimeout(resolve,20));
    window.termaWorkspaceShell.showPrimary('connections');
    window.termaNotificationToasts?.dismiss();
  })()`);
  await delay(280);
  const bundledAssets = await execute(`(async()=>{
    const logo = document.querySelector('.brand h1 img');
    await logo.decode();
    const font = await new FontFace('TermaBundledFontCheck', 'url(/fonts/NotoSansSC-Regular.ttf)').load();
    const license = await fetch('/fonts/OFL.txt');
    return {logo:logo.naturalWidth>0, font:font.status,
      license:license.ok&&(await license.text()).includes('SIL OPEN FONT LICENSE Version 1.1')};
  })()`);
  assert.deepEqual(bundledAssets, {logo:true, font:'loaded', license:true});
  fs.writeFileSync(path.join(directory, 'bundled-assets.json'), JSON.stringify(bundledAssets, null, 2));

  for (const language of ['zh-CN', 'en-US']) {
    for (const theme of ['light', 'dark']) {
      for (const width of [1200, 390]) {
        window.setContentSize(width, 844);
        await delay(90);
        const loaded = await execute(`(async()=>{
          window.i18next.removeResourceBundle('${language}', 'settings');
          if(window.i18next.hasResourceBundle('${language}', 'settings'))throw new Error('settings bundle was not evicted');
          const restored=await ensureTermaI18nResourceBundles(['${language}'], ['settings']);
          if(!restored||!window.i18next.hasResourceBundle('${language}', 'settings'))throw new Error('missing settings bundle was not reloaded');
          await setTermaLanguage('${language}', {emit:false});
          applyTheme('${theme}');
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const expected='${language}'==='en-US'?'Settings':'设置';
          const button=document.querySelector('#navSettings');
          const title=window.i18next.t('settings:title');
          if(title!==expected||button?.getAttribute('aria-label')!==expected)throw new Error('reloaded locale bundle was not applied to the visible settings navigation');
          document.querySelector('#observer-fixture')?.remove();
          const fixture=document.createElement('div');
          fixture.id='observer-fixture';
          fixture.style.cssText='position:fixed;inset:auto 16px 24px auto;z-index:99;max-width:calc(100vw - 32px);padding:12px 16px;border:1px solid var(--border);background:var(--panel);color:var(--text)';
          fixture.style.bottom=innerWidth<=760?'88px':'24px';
          const counterText='${language}'==='en-US'?'设置':'Settings';
          const heading=document.createElement('strong');
          const text=document.createTextNode(counterText);
          heading.append(text);
          const phrase=document.createElement('span');
          phrase.id='observer-template';
          phrase.style.display='block';
          phrase.textContent='目标目录已存在同名项目：秘密文件';
          const raw=document.createElement('code');
          raw.dataset.i18nSkip='';
          raw.style.display='block';
          raw.textContent='设置.log';
          fixture.append(heading,phrase,raw);
          document.body.appendChild(fixture);
          const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          await paint();
          const tabs=document.querySelector('.mobile-tabs');
          const initialTabsRect=tabs?.getBoundingClientRect();
          const tabsVisible=!!tabs&&initialTabsRect.height>0&&getComputedStyle(tabs).display!=='none';
          if(innerWidth<=760&&tabsVisible)fixture.style.bottom=String(Math.ceil(innerHeight-initialTabsRect.top+12))+'px';
          await paint();
          const added=text.data;
          text.data='${language}'==='en-US'?'取消':'Cancel';
          heading.title=counterText;
          heading.setAttribute('aria-label',counterText);
          await paint();
          const mutationText=text.data;
          text.data=counterText;
          await paint();
          const r=fixture.getBoundingClientRect();
          const tabsTop=tabsVisible?tabs.getBoundingClientRect().top:innerHeight;
          const brand=document.querySelector('.brand h1 img');
          return {brand:brand.complete&&brand.naturalWidth>0,language:document.documentElement.lang,theme:'${theme}',width:innerWidth,title,ariaLabel:button.getAttribute('aria-label'),restored,
            observed:{added,mutationText,text:text.data,title:heading.title,aria:heading.getAttribute('aria-label'),raw:raw.textContent,
              phrase:phrase.textContent,fits:r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,clearsNavigation:r.bottom<=tabsTop-4,
              geometry:{fixtureBottom:r.bottom,navigationTop:tabsTop,viewportHeight:innerHeight}}};
        })()`);
        assert.equal(loaded.brand, true, "localized shell renders the bundled brand image");
        assert.equal(loaded.language, language);
        assert.equal(loaded.theme, theme);
        assert.equal(loaded.title, language === 'en-US' ? 'Settings' : '设置');
        assert.deepEqual(loaded.observed, {
          added:loaded.title, mutationText:language === 'en-US' ? 'Cancel' : '取消',
          text:loaded.title, title:loaded.title, aria:loaded.title, raw:'设置.log',
          phrase:language==='en-US'?'The target directory already contains an item with the same name: 秘密文件':'目标目录已存在同名项目：秘密文件',
          fits:true,clearsNavigation:true,geometry:loaded.observed.geometry
        },JSON.stringify({language,theme,width,observed:loaded.observed}));

        const image = await window.webContents.capturePage();
        const filename = `${language}-${theme}-${width}.png`;
        fs.writeFileSync(path.join(directory, filename), image.toPNG());
        reports.push(loaded);
      }
    }
  }
  const lifecycle = await execute(`(async()=>{
    const heading=document.querySelector('#observer-fixture strong');
    const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
    heading.firstChild.data='设置';
    await paint();
    const whileHidden=heading.textContent;
    window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
    await paint();
    const restored=heading.textContent;
    heading.firstChild.data='取消';
    await paint();
    const resumed=heading.textContent;
    document.querySelector('#observer-fixture').remove();
    return {whileHidden,restored,resumed};
  })()`);
  assert.deepEqual(lifecycle,{whileHidden:'设置',restored:'Settings',resumed:'Cancel'});
  fs.writeFileSync(path.join(directory, 'matrix.json'), JSON.stringify(reports, null, 2));
  fs.writeFileSync(path.join(directory, 'lifecycle.json'), JSON.stringify(lifecycle, null, 2));
  console.log(`i18n browser matrix passed: ${reports.length} locale/theme/viewport states with bundle reload, live text and attribute translation, raw text preservation and page transition recovery.`);
  return reports;
}

module.exports = {runI18nResourcesUiScenario};
