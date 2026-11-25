const fs = require('node:fs');

async function captureElectronSurface(browser, filename) {
  const {webContents} = browser;
  await webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))');
  if (process.env.TERMA_SCREENSHOT_DEBUGGER !== '1') {
    const image = await webContents.capturePage();
    fs.writeFileSync(filename, image.toPNG());
    return;
  }
  const debuggerClient = webContents.debugger;
  const attached = debuggerClient.isAttached();
  if (!attached) debuggerClient.attach('1.3');
  try {
    const result = await Promise.race([
      debuggerClient.sendCommand('Page.captureScreenshot', {format: 'png', fromSurface: true}),
      new Promise((_, reject) => setTimeout(() => reject(new Error('debugger screenshot timeout')), 10000))
    ]);
    fs.writeFileSync(filename, Buffer.from(result.data, 'base64'));
  } catch {
    const image = await webContents.capturePage();
    fs.writeFileSync(filename, image.toPNG());
  } finally {
    if (!attached) debuggerClient.detach();
  }
}

module.exports = {captureElectronSurface};
