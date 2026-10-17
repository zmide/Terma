const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {renderFnosDescription}=require('./fnos-description');

async function runFnosDescriptionUiScenario(window) {
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'terma-fnos-description-'));
  const file=path.join(temporary,'introduction.html');
  try {
    const description=renderFnosDescription(path.resolve(__dirname,'../packaging/fnos'));
    for(const width of [620,1080])for(const theme of ['light','dark']) {
      const color=theme==='dark'?'#e5eaf0':'#263445';
      const background=theme==='dark'?'#19212c':'#fff';
      fs.writeFileSync(file,`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>body{font:15px/1.7 system-ui,sans-serif;margin:24px;color:${color};background:${background}}p{margin:12px 0}img{display:block;height:auto}hr{border:0;border-top:1px solid currentColor;opacity:.15;margin:24px 0}small{opacity:.8}h3{font-size:20px}</style>${description}</html>`);
      window.setContentSize(width,900);
      await window.loadFile(file);
      const metrics=await window.webContents.executeJavaScript(`(async()=>{
        const images=[...document.images];
        await Promise.all(images.map(image=>image.decode()));
        const headings=[...document.querySelectorAll('h3')];
        const phones=images.slice(2).map(image=>image.getBoundingClientRect());
        return {images:images.length,loaded:images.every(image=>image.naturalWidth>0),
          noOverflow:document.documentElement.scrollWidth<=innerWidth,
          sections:headings.length===5&&headings.every(heading=>parseFloat(getComputedStyle(heading).marginTop)>=24),
          paired:Math.abs(phones[0].top-phones[1].top)<1&&phones[0].right<phones[1].left,
          readable:phones.every(rect=>rect.width>=240&&rect.width<=430),
          safe:!document.querySelector('script,iframe,object,embed')&&images.every(image=>image.src.startsWith('data:image/jpeg,'))};
      })()`);
      assert.equal(metrics.images,4);
      for(const [key,value]of Object.entries(metrics))if(key!=='images')assert.equal(value,true,`${width}/${theme} ${key}: ${JSON.stringify(metrics)}`);
      if(process.env.TERMA_UI_FNOS_DESCRIPTION_PROOF_DIR){
        fs.mkdirSync(process.env.TERMA_UI_FNOS_DESCRIPTION_PROOF_DIR,{recursive:true});
        fs.writeFileSync(path.join(process.env.TERMA_UI_FNOS_DESCRIPTION_PROOF_DIR,`description-${width}-${theme}.png`),(await window.webContents.capturePage()).toPNG());
        if(width===1080&&theme==='light'){
          await window.webContents.executeJavaScript("document.querySelectorAll('h3')[2].scrollIntoView()");
          fs.writeFileSync(path.join(process.env.TERMA_UI_FNOS_DESCRIPTION_PROOF_DIR,'description-mobile-gallery.png'),(await window.webContents.capturePage()).toPNG());
        }
      }
    }
    console.log('fnOS introduction UI passed: four offline images, paired mobile screenshots, both themes and widths');
  } finally {
    if(path.dirname(temporary)!==fs.realpathSync(os.tmpdir())||!path.basename(temporary).startsWith('terma-fnos-description-'))throw new Error('Invalid introduction preview workspace');
    fs.rmSync(temporary,{recursive:true,force:true});
  }
}
module.exports={runFnosDescriptionUiScenario};
