const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
async function runImagePreviewUiScenario(browser) {
  const directory=path.join(process.env.TERMA_UI_DIAGNOSTICS_DIR||path.join(process.cwd(),'data'),'image-preview-visual');
  fs.mkdirSync(directory,{recursive:true});
  const execute=source=>browser.webContents.executeJavaScript(`(async()=>{${source}})()`);
  const frames=`await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));`;
  const results=[],screenshots=[];
  const shot=async name=>{await execute(frames);browser.webContents.invalidate();fs.writeFileSync(path.join(directory,name+'.png'),(await browser.webContents.capturePage()).toPNG());screenshots.push(name+'.png');};
  await execute(`window.__previewErrors=[];window.__previewErrorListener=event=>window.__previewErrors.push(event.message);window.addEventListener('error',window.__previewErrorListener);window.__previewSource='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 320"><rect width="640" height="320" fill="#1473e6"/><text x="32" y="72" fill="white" font-size="32">Preview fixture</text></svg>';`);
  try {
    for(const width of [1200,392])for(const language of ['zh-CN','en-US'])for(const theme of ['light','dark']) {
      browser.setSize(width,850);const prefix=width+'-'+language+'-'+theme;
      await execute(`closeModal();await setTermaLanguage(${JSON.stringify(language)});applyTheme(${JSON.stringify(theme)});await window.termaSftpPreviewRuntime.image(0,'preview.svg',{content:window.__previewSource});`);
      await shot(prefix+'-open');
      await execute(`$('sftpImageFullscreen').click();$('sftpImageZoomIn').click();const color=$('sftpImageColorMode');color.value='invert-color';color.dispatchEvent(new Event('change',{bubbles:true}));$('sftpImageClose').click();${frames}if(!$('modal').hidden||$('sftpImageZoomValue'))throw Error('Closed preview retained its shell');`);
      await shot(prefix+'-closed');
      await execute(`await window.termaSftpPreviewRuntime.image(0,'replaced.svg',{content:window.__previewSource});$('sftpImageFullscreen').click();closeModal();const replacement=document.createElement('section');replacement.id='previewReplacement';replacement.textContent='Replacement dialog';$('modal').appendChild(replacement);$('modal').hidden=false;${frames}if($('modal').hidden||!replacement.isConnected)throw Error('Released preview closed a replacement dialog');`);
      await shot(prefix+'-replacement');
      await execute(`closeModal();await window.termaSftpPreviewRuntime.image(0,'next.svg',{content:window.__previewSource});${frames}const card=$('modal').querySelector('.sftp-image-modal'),r=card.getBoundingClientRect();if(!card.checkVisibility()||r.left<-1||r.right>innerWidth+1||!$('sftpImageZoomValue').textContent.endsWith('%'))throw Error('Replacement preview failed to render');if(window.__previewErrors.length)throw Error(window.__previewErrors.join('; '));`);
      await shot(prefix+'-reopened');
      results.push({width,language,theme,closed:true,replaced:true,reopened:true});
    }
    assert.equal((await execute('return window.__previewErrors;')).length,0);
  } finally {await execute(`closeModal();window.removeEventListener('error',window.__previewErrorListener);delete window.__previewErrorListener;delete window.__previewErrors;delete window.__previewSource;`);}
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({results,screenshots},null,2));
  console.log('Image preview lifecycle passed:',results.length,'matrices,',screenshots.length,'screenshots');
}
module.exports={runImagePreviewUiScenario};
