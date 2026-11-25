const fs = require("node:fs");
const path = require("node:path");

async function verifyLanguageOnboarding(window, options = {}) {
  const execute = code => window.webContents.executeJavaScript(code);
  const captures = [];
  if(options.proof) await execute(`window.__termaCaptureLanguage = async name => {
    window.__languageCaptureQueue.push(name);
    await new Promise(resolve => {window.__languageCaptureDone=resolve;});
  };window.__languageCaptureQueue=[];`);
  const verification = execute(`(async () => {
    const previousApi = api;
    const previousRuntimeSettings = window.termaRuntimeSettingsModel.snapshot;
    const locales = Object.getOwnPropertyDescriptor(navigator, 'languages');
    const capture = async name => {
      if (typeof window.__termaCaptureLanguage !== 'function') return;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const animations = document.querySelector('.language-onboarding')?.getAnimations({subtree:true}) || [];
      await Promise.allSettled(animations.map(animation => animation.finished));
      await window.__termaCaptureLanguage(name);
    };
    const until = async ready => {
      for (let attempt=0; attempt<100 && !ready(); attempt++) await new Promise(resolve=>setTimeout(resolve,10));
    };
    const previousLanguage = document.documentElement.lang || 'zh-CN';
    let savedPayload = null;
    try {
      dismissToast();
      Object.defineProperty(navigator, 'languages', { configurable:true, value:['en-US'] });
      await setTermaLanguage('en-US', {emit:false});
      window.i18next.removeResourceBundle('zh-CN', 'common');
      window.i18next.removeResourceBundle('zh-CN', 'settings');
      const coldStartMissingChineseResources = !window.i18next.hasResourceBundle('zh-CN', 'common')
        && !window.i18next.hasResourceBundle('zh-CN', 'settings');
      window.termaRuntimeSettingsModel.snapshot = {settings_persisted:false, saved:{language:'zh-CN', language_onboarding_version:0}};
      await window.termaLanguageSettings.ensureOnboarding();
      const newCard = document.querySelector('.language-onboarding');
      await capture('new-english');
      const newRect = newCard?.getBoundingClientRect();
      await new Promise(resolve => queueMicrotask(() => requestAnimationFrame(resolve)));
      const newUserDefaultsEnglish = document.querySelector('input[name="terma-onboarding-language"]:checked')?.value === 'en-US';
      const englishOption = document.querySelector('input[name="terma-onboarding-language"][value="en-US"]')?.closest('.language-onboarding-option');
      const chineseOption = document.querySelector('input[name="terma-onboarding-language"][value="zh-CN"]')?.closest('.language-onboarding-option');
      const nativeChoiceCopy = englishOption?.querySelector('strong')?.textContent?.trim() === 'English'
        && englishOption?.querySelector('small')?.textContent?.trim() === 'Default outside mainland China'
        && chineseOption?.querySelector('strong')?.textContent?.trim() === '简体中文'
        && chineseOption?.querySelector('small')?.textContent?.trim() === '中国大陆默认';
      const englishCopy = newCard?.querySelector('#languageOnboardingTitle')?.textContent?.trim() === 'Choose your language'
        && newCard?.querySelector('.language-onboarding-message')?.textContent?.trim() === "Terma selected a default from this device's region. You can change it before entering."
        && newCard?.querySelector('.language-onboarding-note')?.textContent?.trim() === 'You can switch languages at any time from the language button.'
        && newCard?.querySelector('button[type="submit"]')?.textContent?.trim() === 'Continue'
        && newCard?.lang === 'en-US';
      const chineseChoice = document.querySelector('input[name="terma-onboarding-language"][value="zh-CN"]');
      chineseChoice?.click();
      await new Promise(resolve => queueMicrotask(() => requestAnimationFrame(resolve)));
      await capture('new-chinese');
      const selectedChineseCopy = newCard?.querySelector('#languageOnboardingTitle')?.textContent?.trim() === '选择界面语言'
        && newCard?.querySelector('.language-onboarding-message')?.textContent?.trim() === 'Terma 已按当前设备地区预选语言，进入前可以修改。'
        && newCard?.querySelector('.language-onboarding-note')?.textContent?.trim() === '之后可随时通过语言按钮切换。'
        && newCard?.querySelector('button[type="submit"]')?.textContent?.trim() === '继续'
        && newCard?.lang === 'zh-CN'
        && chineseOption?.classList.contains('selected')
        && !englishOption?.classList.contains('selected');
      document.querySelector('input[name="terma-onboarding-language"][value="en-US"]')?.click();
      await new Promise(resolve => queueMicrotask(() => requestAnimationFrame(resolve)));
      const selectedEnglishCopy = newCard?.querySelector('#languageOnboardingTitle')?.textContent?.trim() === 'Choose your language'
        && newCard?.querySelector('button[type="submit"]')?.textContent?.trim() === 'Continue'
        && newCard?.lang === 'en-US'
        && !/[\u3400-\u9fff]/.test(newCard?.querySelector('input[name="terma-onboarding-language"][value="en-US"]')?.closest('.language-onboarding-option')?.textContent || '')
        && englishOption?.classList.contains('selected')
        && !chineseOption?.classList.contains('selected');
      const coldStartChineseResourcesLoaded = window.i18next.hasResourceBundle('zh-CN', 'common')
        && window.i18next.hasResourceBundle('zh-CN', 'settings');
      const fitsNarrowViewport = Boolean(newRect
        && newRect.left >= -0.5
        && newRect.right <= innerWidth + 0.5
        && newRect.top >= -0.5
        && newRect.bottom <= innerHeight + 0.5
        && document.documentElement.scrollWidth <= innerWidth + 1);
      if (document.querySelector('.language-onboarding')) closeModal();

      window.termaRuntimeSettingsModel.snapshot = {settings_persisted:true, saved:{language:'zh-CN', language_onboarding_version:0}};
      await setTermaLanguage('zh-CN', {emit:false});
      await window.termaLanguageSettings.ensureOnboarding();
      const existingUserKeepsLanguage = document.querySelector('input[name="terma-onboarding-language"]:checked')?.value === 'zh-CN';
      const existingUserChineseCopy = document.querySelector('#languageOnboardingTitle')?.textContent?.trim() === '选择界面语言'
        && document.querySelector('.language-onboarding-message')?.textContent?.trim() === '请选择要继续使用的 Terma 界面语言。'
        && document.querySelector('.language-onboarding-note')?.textContent?.trim() === '之后可随时通过语言按钮切换。'
        && document.querySelector('.language-onboarding button[type="submit"]')?.textContent?.trim() === '继续'
        && document.querySelector('.language-onboarding')?.lang === 'zh-CN';
      const englishChoice = document.querySelector('input[name="terma-onboarding-language"][value="en-US"]');
      englishChoice?.click();
      await Promise.resolve();
      const existingUserEnglishCopy = document.querySelector('#languageOnboardingTitle')?.textContent?.trim() === 'Choose your language'
        && document.querySelector('.language-onboarding-message')?.textContent?.trim() === 'Choose the Terma interface language to continue.'
        && document.querySelector('.language-onboarding-note')?.textContent?.trim() === 'You can switch languages at any time from the language button.'
        && document.querySelector('.language-onboarding button[type="submit"]')?.textContent?.trim() === 'Continue'
        && document.querySelector('.language-onboarding')?.lang === 'en-US';
      api = async (path, options={}) => {
        if (path !== '/api/runtime-settings' || options.method !== 'PUT') throw new Error('Unexpected language onboarding request');
        savedPayload = JSON.parse(options.body || '{}');
        return {settings_persisted:true, saved:{...window.termaRuntimeSettingsModel.snapshot.saved, ...savedPayload}};
      };
      document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
      const form = document.querySelector('.language-onboarding');
      const staysUntilSaved = Boolean(form && form !== newCard);
      const button = form.querySelector('button[type="submit"]');
      const successfulApi = api;
      let saveCalls = 0;
      let releaseFirstSave;
      const firstSave = new Promise(resolve => { releaseFirstSave = resolve; });
      api = async (...args) => {
        if (++saveCalls === 1) {
          await firstSave;
          throw Error('Fixture save failed');
        }
        return successfulApi(...args);
      };
      button.click();
      await Promise.resolve();
      const lockedWhileSaving = button.disabled && button.getAttribute('aria-busy') === 'true';
      releaseFirstSave();
      await until(() => !button.disabled);
      const retryAvailable = form.isConnected && !button.disabled && document.querySelector('input[name="terma-onboarding-language"]:checked')?.value === 'en-US';
      button.click();
      await until(() => !form.isConnected);
      const saved = saveCalls === 2 && !form.isConnected;
      const toggles = () => [...document.querySelectorAll('button[data-action="static-language-toggle"]')];
      const toggleButton = () => toggles().find(control => control.checkVisibility());
      const toggleBusy = () => toggleButton()?.getAttribute('aria-busy') === 'true';
      const toggleCalls = [];
      let releaseToggle;
      const firstToggle = new Promise(resolve => { releaseToggle = resolve; });
      api = async (path, options={}) => {
        if (path !== '/api/runtime-settings' || options.method !== 'PUT') return previousApi(path, options);
        const payload = JSON.parse(options.body || '{}');
        toggleCalls.push(payload);
        if (toggleCalls.length === 1) {
          await firstToggle;
          throw Error('Fixture toggle failed');
        }
        return {settings_persisted:true, saved:{...window.termaRuntimeSettingsModel.snapshot.saved, ...payload}};
      };
      toggleButton()?.click();
      await until(toggleBusy);
      const bothTogglesLocked = toggles().length === 2 && toggles().every(control => control.disabled);
      toggles().forEach(control => control.click());
      releaseToggle();
      await until(() => !toggleBusy());
      const failedToggleKeptLanguage = toggleCalls.length === 1 && document.documentElement.lang === 'en-US'
        && window.termaRuntimeSettingsModel.snapshot.saved.language === 'en-US' && !toggleButton()?.disabled;
      toggleButton()?.click();
      await until(() => document.documentElement.lang === 'zh-CN' && !toggleBusy());
      const toggleRetried = toggleCalls.length === 2 && toggleCalls.every(payload => Object.keys(payload).length === 1 && payload.language === 'zh-CN')
        && document.documentElement.lang === 'zh-CN' && window.termaRuntimeSettingsModel.snapshot.saved.language === 'zh-CN' && !toggleButton()?.disabled;
      dismissToast();
      return {
        staysUntilSaved,
        lockedWhileSaving,
        retryAvailable,
        newUserDefaultsEnglish,
        nativeChoiceCopy,
        englishCopy,
        selectedChineseCopy,
        selectedEnglishCopy,
        coldStartNativeChoice:Boolean(coldStartMissingChineseResources && coldStartChineseResourcesLoaded && nativeChoiceCopy),
        existingUserKeepsLanguage,
        existingUserChineseCopy,
        existingUserEnglishCopy,
        fitsNarrowViewport,
        saved:Boolean(saved && savedPayload?.language === 'en-US' && savedPayload?.language_onboarding_version === 1),
        closed:document.querySelector('.language-onboarding') === null,
        bothTogglesLocked,
        failedToggleKeptLanguage,
        toggleRetried
      };
    } finally {
      api = previousApi;
      window.termaRuntimeSettingsModel.snapshot = previousRuntimeSettings;
      if(locales)Object.defineProperty(navigator,'languages',locales);else delete navigator.languages;
      if (document.querySelector('.language-onboarding')) closeModal();
      await setTermaLanguage(previousLanguage, {emit:false});
    }
  })()`);
  if (!options.proof) return verification;
  try {
    await Promise.all([verification, captureLanguageStates(window, options.proof, captures)]);
    return await verification;
  } finally {
    await execute(`delete window.__termaCaptureLanguage;delete window.__languageCaptureQueue;delete window.__languageCaptureDone;`);
  }
}

async function captureLanguageStates(window, proof, captures) {
  for(let attempt=0;attempt<400 && captures.length<2;attempt++) {
    const name = await window.webContents.executeJavaScript('window.__languageCaptureQueue.shift()');
    if (!name) { await new Promise(resolve=>setTimeout(resolve,25)); continue; }
    fs.mkdirSync(path.dirname(proof),{recursive:true});
    await window.webContents.capturePage();
    fs.writeFileSync(proof+'-'+name+'.png',(await window.webContents.capturePage()).toPNG());
    captures.push(name);
    await window.webContents.executeJavaScript('window.__languageCaptureDone()');
  }
  if (captures.length!==2) throw Error('Language onboarding screenshots did not finish');
}
module.exports = { verifyLanguageOnboarding };
