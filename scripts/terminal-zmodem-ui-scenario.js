const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function runTerminalZmodemUiScenario(browser, options = {}) {
  const directory = path.join(process.env.TERMA_UI_DIAGNOSTICS_DIR || path.join(process.cwd(), 'data'), 'terminal-zmodem-visual');
  fs.mkdirSync(directory, { recursive: true });
  const execute = source => browser.webContents.executeJavaScript(`(async()=>{${source}})()`);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const viewport = options.viewport || (await execute('return innerWidth <= 520 ? "mobile" : "desktop"'));
  const states = [];
  const checks = [];
  const shot = async name => {
    await delay(90);
    browser.webContents.invalidate();
    fs.writeFileSync(path.join(directory, `${viewport}-${name}.png`), (await browser.webContents.capturePage()).toPNG());
    states.push(`${viewport}-${name}`);
  };
  const check = async (name, expression) => {
    const result = await execute(`return (${expression});`);
    checks.push({ name, result });
    if (result !== true) {
      const diagnostics = await execute(`return (()=>{const panel=document.querySelector('.terminal-zmodem-panel'),box=document.querySelector('.terminal-box');const rect=node=>{const r=node?.getBoundingClientRect?.();return r?{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}:null};return {adapter:typeof window.termaTerminalZmodemView,renderer:typeof window.termaTerminalZmodemView?.render,fixture:!!document.querySelector('.terminal-zmodem-fixture'),panel:rect(panel),box:rect(box),hidden:panel?.hidden,classes:panel?.className,theme:panel?.dataset.theme,children:[...panel?.querySelectorAll('button,svg')||[]].map(rect),html:panel?.innerHTML?.slice(0,600),scripts:[...document.scripts].map(script=>script.src).filter(Boolean).slice(-8)}})()`);
      console.error(JSON.stringify({failed:name, diagnostics}, null, 2));
    }
    assert.equal(result, true, name);
  };

  await execute(`
    await window.termaI18nReady;
    document.querySelectorAll('.terminal-zmodem-fixture').forEach(node => node.remove());
    const fixture=document.createElement('section');
    fixture.className='terminal-zmodem-fixture';
    fixture.style.cssText='position:fixed;inset:0;z-index:40;padding:12px;background:var(--bg);box-sizing:border-box;';
    const screenshotStyle=document.createElement('style');
    screenshotStyle.dataset.terminalZmodemFixture='';
    screenshotStyle.textContent='body.terminal-zmodem-visual-test #toast{visibility:hidden!important}';
    document.head.append(screenshotStyle);
    const box=document.createElement('div');
    box.className='terminal-box';
    box.style.cssText='height:360px;min-height:0;width:100%;';
    fixture.append(box);
    document.body.append(fixture);
    document.body.classList.add('terminal-zmodem-visual-test');
    window.__terminalZmodemFixture={fixture,box,session:{mount:box,term:{element:box},socket:{readyState:WebSocket.CLOSED}}};
  `);

  for (const theme of ['light', 'dark']) {
    for (const language of ['zh-CN', 'en-US']) {
      const name = `${language}-${theme}`;
      await execute(`
        applyTheme(${JSON.stringify(theme)});
        await setTermaLanguage(${JSON.stringify(language)}, {render:false});
        const session=window.__terminalZmodemFixture.session;
        window.termaTerminalZmodem.render(session, {
          icon:'download',
          titleKey:'terminal:zmodem.receiving_file',
          titleOptions:{name:'设置.log'},
          detail:'12 KB / 24 KB',
          showProgress:true,
          progress:50,
          primaryAction:'receive',
          primaryIcon:'download',
          primaryLabelKey:'terminal:zmodem.receive_file'
        });
      `);
      await delay(80);
      await check(`${name} visible Vue view`, `(()=>{const panel=document.querySelector('.terminal-zmodem-panel'),content=panel?.querySelector('.terma-zmodem-content');return !!panel&&!panel.hidden&&!!content&&panel.classList.contains('terma-vue-root')&&panel.dataset.theme===${JSON.stringify(theme)}})()`);
      await check(`${name} Tile actions and progress`, `(()=>{const panel=document.querySelector('.terminal-zmodem-panel'),buttons=[...panel.querySelectorAll('button[data-zmodem-action]')],bar=panel.querySelector('[role=progressbar]');return buttons.length===2&&buttons.every(button=>button.hasAttribute('data-terma-button'))&&buttons.some(button=>button.dataset.zmodemAction==='receive')&&buttons.some(button=>button.dataset.zmodemAction==='cancel')&&bar?.getAttribute('aria-valuenow')==='50'})()`);
      await check(`${name} translation and filename`, `(()=>{const text=document.querySelector('.terminal-zmodem-panel')?.textContent||'';return text.includes('设置.log')&&(${JSON.stringify(language)}==='zh-CN'?text.includes('正在接收'):text.includes('Receiving'))})()`);
      await check(`${name} panel geometry`, `(()=>{const panel=document.querySelector('.terminal-zmodem-panel'),box=document.querySelector('.terminal-box'),p=panel.getBoundingClientRect(),b=box.getBoundingClientRect(),children=[...panel.querySelectorAll('button,svg')];return p.left>=b.left-1&&p.right<=b.right+1&&p.top>=b.top-1&&p.bottom<=b.bottom+1&&children.every(node=>{const r=node.getBoundingClientRect();return r.left>=p.left-1&&r.right<=p.right+1&&r.top>=p.top-1&&r.bottom<=p.bottom+1})})()`);
      await shot(`${name}-panel`);

      await execute(`await setTermaLanguage(${JSON.stringify(language==='zh-CN'?'en-US':'zh-CN')});`);
      await check(`${name} live language switch`, `(()=>{const text=document.querySelector('.terminal-zmodem-panel')?.textContent||'';const target=${JSON.stringify(language==='zh-CN'?'en-US':'zh-CN')};return text.includes('设置.log')&& (target==='zh-CN'?text.includes('正在接收'):text.includes('Receiving'))})()`);
      await shot(`${name}-live-language`);
    }
  }

  await execute(`window.termaTerminalZmodem.render(window.__terminalZmodemFixture.session,{hidden:true});`);
  await check('hidden state removes Vue content', `(()=>{const panel=document.querySelector('.terminal-zmodem-panel');return !!panel&&panel.hidden&&!panel.querySelector('.terma-zmodem-content')})()`);
  await shot('hidden');
  await execute(`window.termaTerminalZmodem.close(window.__terminalZmodemFixture.session);window.__terminalZmodemFixture.fixture.remove();document.body.classList.remove('terminal-zmodem-visual-test');document.querySelector('style[data-terminal-zmodem-fixture]')?.remove();`);
  await check('release removes fixture panel', `!document.querySelector('.terminal-zmodem-fixture .terminal-zmodem-panel')`);
  return { viewport, screenshots: states.length, states, checks: checks.length };
}

module.exports = { runTerminalZmodemUiScenario };
