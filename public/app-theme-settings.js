const TERMA_APPEARANCE_STORAGE_KEY = "termaAppearanceV1";
const TERMA_APPEARANCE_PRESETS = Object.freeze({
  clear:Object.freeze({preset:"clear", frosted_strength:0, liquid_strength:0}),
  luminous:Object.freeze({preset:"luminous", frosted_strength:53, liquid_strength:39})
});
const TERMA_APPEARANCE_DEFAULTS = TERMA_APPEARANCE_PRESETS.clear;
let termaAppearanceSettings = readTermaAppearanceSettings();
const termaLiquidTrackFrames = new WeakMap();
const termaLiquidTrackTimers = new WeakMap();
const termaLiquidTrackObservers = new WeakMap();
const termaLiquidTrackMotions = new WeakMap();
const termaLiquidTrackAnimations = new WeakMap();
const termaLiquidResizeObserver = typeof ResizeObserver === "function"
  ? new ResizeObserver(entries => entries.forEach(entry => scheduleTermaLiquidTrack(entry.target)))
  : null;

function clampThemeStrength(value, fallback=0) {
  const number = Number(value);
  return Math.max(0, Math.min(100, Number.isFinite(number) ? number : fallback));
}

function matchingTermaAppearancePreset(value={}) {
  for (const [id, preset] of Object.entries(TERMA_APPEARANCE_PRESETS)) {
    if (Number(value.frosted_strength) === preset.frosted_strength && Number(value.liquid_strength) === preset.liquid_strength) return id;
  }
  return "custom";
}

function normalizeTermaAppearanceSettings(value={}) {
  const hasCurrentShape = Object.prototype.hasOwnProperty.call(value, "frosted_strength")
    || Object.prototype.hasOwnProperty.call(value, "liquid_strength");
  let frostedStrength = hasCurrentShape ? Number(value.frosted_strength) : NaN;
  let liquidStrength = hasCurrentShape ? Number(value.liquid_strength) : NaN;
  if (!hasCurrentShape && (Object.prototype.hasOwnProperty.call(value, "glass_enabled") || Object.prototype.hasOwnProperty.call(value, "opacity") || Object.prototype.hasOwnProperty.call(value, "blur"))) {
    const legacyEnabled = value.glass_enabled !== false;
    const legacyOpacity = clampThemeStrength(value.opacity, 50);
    const legacyBlur = Math.max(0, Math.min(28, Number(value.blur) || 0));
    frostedStrength = legacyEnabled ? Math.round((legacyBlur / 28) * 100) : 0;
    liquidStrength = legacyEnabled ? Math.round((100 - legacyOpacity) / .72) : 0;
  }
  if (value.preset === "luminous" && frostedStrength === 7 && liquidStrength === 73) {
    frostedStrength = TERMA_APPEARANCE_PRESETS.luminous.frosted_strength;
    liquidStrength = TERMA_APPEARANCE_PRESETS.luminous.liquid_strength;
  }
  const normalized = {
    frosted_strength:clampThemeStrength(frostedStrength, TERMA_APPEARANCE_DEFAULTS.frosted_strength),
    liquid_strength:clampThemeStrength(liquidStrength, TERMA_APPEARANCE_DEFAULTS.liquid_strength)
  };
  return {...normalized, preset:matchingTermaAppearancePreset(normalized)};
}

function readTermaAppearanceSettings() {
  try { return normalizeTermaAppearanceSettings(JSON.parse(localStorage.getItem(TERMA_APPEARANCE_STORAGE_KEY) || "{}")); }
  catch { return {...TERMA_APPEARANCE_DEFAULTS}; }
}

function applyTermaAppearanceSettings(settings=termaAppearanceSettings) {
  const value = normalizeTermaAppearanceSettings(settings);
  const root = document.documentElement;
  const frosted = value.frosted_strength;
  const liquid = value.liquid_strength;
  const overlayOpacity = Math.round(100 - liquid * .72);
  const contentOpacity = Math.round(100 - liquid * .92);
  const foregroundOpacity = Math.round(100 - liquid * .15);
  const foregroundAlpha = foregroundOpacity / 100;
  const frostedBlur = Math.round(frosted * .28 * 10) / 10;
  const surfaceOpacity = Math.round(100 - frosted * .18);
  const toolbarOpacity = Math.round(100 - frosted * .12);
  const saturation = Math.round((1 + liquid * .003) * 1000) / 1000;
  const frostedSaturation = Math.round((1 + frosted * .0015) * 1000) / 1000;
  const liquidSurfaceOpacity = liquid > 0 ? Math.round(72 - liquid * .12) : 100;
  const liquidIconSurfaceOpacity = Math.round(10 + liquid * .10);
  const liquidMotionAlpha = liquid > 0 ? Math.round((.04 + liquid * .00125) * 1000) / 1000 : 0;
  const liquidBorderOpacity = liquid > 0 ? Math.round(18 + liquid * .38) : 0;
  const liquidActiveOpacity = liquid > 0 ? Math.round(7 + liquid * .12) : 0;
  const liquidLensOpacity = liquid > 0 ? Math.round(18 + liquid * .26) : 0;
  const liquidRefractionAlpha = liquid > 0 ? Math.round((.08 + liquid * .0026) * 1000) / 1000 : 0;
  const modalSurfaceOpacity = Math.round(93 - frosted * .28);
  const modalBandOpacity = Math.round(90 - frosted * .25);
  root.dataset.appearancePreset = value.preset;
  root.classList.toggle("terma-glass-disabled", liquid <= 0);
  root.classList.toggle("terma-frosted-disabled", frosted <= 0);
  root.classList.toggle("terma-liquid-enabled", liquid > 0);
  root.style.setProperty("--terma-overlay-opacity", `${overlayOpacity}%`);
  root.style.setProperty("--terma-overlay-content-opacity", `${Math.max(28, contentOpacity)}%`);
  root.style.setProperty("--terma-overlay-foreground-opacity", `${Math.max(82, foregroundOpacity)}%`);
  root.style.setProperty("--terma-overlay-foreground-alpha", String(Math.max(.82, foregroundAlpha)));
  root.style.setProperty("--terma-overlay-blur", `${frostedBlur}px`);
  root.style.setProperty("--terma-overlay-saturation", String(saturation));
  root.style.setProperty("--terma-frosted-surface-opacity", `${surfaceOpacity}%`);
  root.style.setProperty("--terma-frosted-toolbar-opacity", `${toolbarOpacity}%`);
  root.style.setProperty("--terma-frosted-saturation", String(frostedSaturation));
  root.style.setProperty("--terma-frosted-backdrop-blur", `${Math.round(frostedBlur * .35 * 10) / 10}px`);
  root.style.setProperty("--terma-frosted-toolbar-blur", `${Math.round(frostedBlur * .75 * 10) / 10}px`);
  root.style.setProperty("--terma-modal-backdrop-blur", `${Math.round(frostedBlur * .68 * 10) / 10}px`);
  root.style.setProperty("--terma-liquid-highlight-opacity", `${Math.round(liquid * .22)}%`);
  root.style.setProperty("--terma-liquid-highlight-alpha", String(Math.round(liquid * .0032 * 1000) / 1000));
  root.style.setProperty("--terma-liquid-shadow-alpha", String(Math.round((.14 + liquid * .0017) * 1000) / 1000));
  root.style.setProperty("--terma-liquid-surface-opacity", `${liquidSurfaceOpacity}%`);
  root.style.setProperty("--terma-liquid-icon-surface-opacity", `${liquidIconSurfaceOpacity}%`);
  root.style.setProperty("--terma-liquid-motion-alpha", String(liquidMotionAlpha));
  root.style.setProperty("--terma-liquid-border-opacity", `${liquidBorderOpacity}%`);
  root.style.setProperty("--terma-liquid-active-opacity", `${liquidActiveOpacity}%`);
  root.style.setProperty("--terma-liquid-lens-opacity", `${liquidLensOpacity}%`);
  root.style.setProperty("--terma-liquid-compact-opacity", `${liquid > 0 ? Math.round(24 + liquid * .20) : 0}%`);
  root.style.setProperty("--terma-liquid-wide-opacity", `${liquid > 0 ? Math.round(17 + liquid * .13) : 0}%`);
  root.style.setProperty("--terma-liquid-refraction-alpha", String(liquidRefractionAlpha));
  root.style.setProperty("--terma-modal-surface-opacity", `${Math.max(74, modalSurfaceOpacity)}%`);
  root.style.setProperty("--terma-modal-band-opacity", `${Math.max(72, modalBandOpacity)}%`);
  requestAnimationFrame(syncTermaLiquidNavigation);
  return value;
}

function termaLiquidTrackTarget(track) {
  if (track.id === "explorerTools" && !track.classList.contains("section-mode")) return null;
  return [...track.children].find(child => child.matches?.("button.active:not([hidden])")) || null;
}

function termaLiquidTargetVisible(target) {
  if (!target?.isConnected) return false;
  const style = getComputedStyle(target);
  const rect = target.getBoundingClientRect();
  return style.display !== "none"
    && style.visibility !== "hidden"
    && rect.width > 0
    && rect.height > 0;
}

function resetTermaLiquidTrackMotion(track) {
  clearTimeout(termaLiquidTrackTimers.get(track));
  termaLiquidTrackTimers.delete(track);
  const animation = termaLiquidTrackAnimations.get(track);
  if (animation) {
    animation.cancel();
    termaLiquidTrackAnimations.delete(track);
  }
  delete track.dataset.liquidAxis;
  delete track.dataset.liquidMoving;
  delete track.dataset.liquidDirection;
  track.style.removeProperty("--terma-liquid-travel");
  track.style.removeProperty("--terma-liquid-radius-a");
  track.style.removeProperty("--terma-liquid-radius-b");
  track.style.removeProperty("--terma-liquid-radius-c");
  track.style.removeProperty("--terma-liquid-radius-d");
  track.style.removeProperty("--terma-liquid-flow-from-x");
  track.style.removeProperty("--terma-liquid-flow-from-y");
  track.style.removeProperty("--terma-liquid-flow-to-x");
  track.style.removeProperty("--terma-liquid-flow-to-y");
  track.style.removeProperty("--terma-liquid-motion-duration");
}

function settleTermaLiquidTrackMotion(track) {
  track.style.setProperty("--terma-liquid-travel", "0");
  const restingRadius = track.dataset.liquidKind === "activity"
    ? "50%"
    : (track.dataset.liquidKind === "compact" ? "9px" : "8px");
  track.style.setProperty("--terma-liquid-radius-a", restingRadius);
  track.style.setProperty("--terma-liquid-radius-b", restingRadius);
  track.style.setProperty("--terma-liquid-radius-c", restingRadius);
  track.style.setProperty("--terma-liquid-radius-d", restingRadius);
  const lens = track.querySelector(":scope > .terma-liquid-lens");
  const geometry = String(track.dataset.liquidGeometry || "").split(",").map(Number);
  if (lens && geometry.length === 4 && geometry.every(Number.isFinite)) {
    const [x, y, width, height] = geometry;
    lens.style.transition = "none";
    lens.style.width = `${width}px`;
    lens.style.height = `${height}px`;
    lens.style.transform = `translate3d(${x}px,${y}px,0)`;
    lens.getBoundingClientRect();
    lens.style.removeProperty("transition");
  }
  delete track.dataset.liquidMoving;
}

function ensureTermaLiquidLens(track) {
  const lenses = [...track.children].filter(child => child.classList?.contains("terma-liquid-lens"));
  let lens = lenses.shift() || null;
  lenses.forEach(duplicate => duplicate.remove());
  if (lens) return {lens, created:false, restored:false};
  const restored = track.dataset.liquidReady === "1" && Boolean(track.dataset.liquidGeometry);
  resetTermaLiquidTrackMotion(track);
  if (!restored) {
    delete track.dataset.liquidGeometry;
    delete track.dataset.liquidReady;
  }
  lens = document.createElement("span");
  lens.className = "terma-liquid-lens";
  lens.setAttribute("aria-hidden", "true");
  track.prepend(lens);
  return {lens, created:true, restored};
}

function positionTermaLiquidTrack(track) {
  const target = termaLiquidTrackTarget(track);
  if (!termaLiquidTargetVisible(target)) {
    termaLiquidTrackMotions.set(track, (termaLiquidTrackMotions.get(track) || 0) + 1);
    resetTermaLiquidTrackMotion(track);
    track.querySelector(":scope > .terma-liquid-lens")?.classList.remove("is-positioning");
    track.classList.remove("has-liquid-selection");
    track.style.setProperty("--terma-liquid-lens-visibility", "0");
    delete track.dataset.liquidGeometry;
    delete track.dataset.liquidReady;
    return;
  }
  const {lens, created, restored} = ensureTermaLiquidLens(track);
  const activity = track.classList.contains("activity-top");
  const mobile = track.classList.contains("mobile-tabs");
  const insetX = mobile ? 4 : 4;
  const insetY = mobile ? 5 : 3;
  const width = activity
    ? Math.min(32, Math.max(0, target.offsetWidth - 8))
    : Math.max(0, target.offsetWidth - insetX * 2);
  const height = activity
    ? Math.min(32, Math.max(0, target.offsetHeight - 8))
    : Math.max(0, target.offsetHeight - insetY * 2);
  if (width <= 0 || height <= 0) {
    termaLiquidTrackMotions.set(track, (termaLiquidTrackMotions.get(track) || 0) + 1);
    resetTermaLiquidTrackMotion(track);
    lens.classList.remove("is-positioning");
    track.classList.remove("has-liquid-selection");
    track.style.setProperty("--terma-liquid-lens-visibility", "0");
    delete track.dataset.liquidGeometry;
    delete track.dataset.liquidReady;
    return;
  }
  const x = activity ? target.offsetLeft + (target.offsetWidth - width) / 2 : target.offsetLeft + insetX;
  const y = activity ? target.offsetTop + (target.offsetHeight - height) / 2 : target.offsetTop + insetY;
  const previous = track.dataset.liquidGeometry || "";
  const next = `${x},${y},${width},${height}`;
  const firstLayout = track.dataset.liquidReady !== "1";
  const previousGeometry = previous.split(",").map(Number);
  const trackRect = track.getBoundingClientRect();
  const currentLensRect = lens.getBoundingClientRect();
  const currentCenterX = currentLensRect.width > 0
    ? currentLensRect.left - trackRect.left + currentLensRect.width / 2
    : (previousGeometry[0] || 0) + (previousGeometry[2] || 0) / 2;
  const currentCenterY = currentLensRect.height > 0
    ? currentLensRect.top - trackRect.top + currentLensRect.height / 2
    : (previousGeometry[1] || 0) + (previousGeometry[3] || 0) / 2;
  const nextCenterX = x + width / 2;
  const nextCenterY = y + height / 2;
  if (firstLayout) lens.classList.add("is-positioning");
  else {
    lens.classList.remove("is-positioning");
    if (created && restored) lens.getBoundingClientRect();
  }
  track.style.setProperty("--terma-liquid-lens-x", `${x}px`);
  track.style.setProperty("--terma-liquid-lens-y", `${y}px`);
  track.style.setProperty("--terma-liquid-lens-width", `${width}px`);
  track.style.setProperty("--terma-liquid-lens-height", `${height}px`);
  track.style.setProperty("--terma-liquid-lens-visibility", "1");
  track.classList.add("has-liquid-selection");
  track.dataset.liquidGeometry = next;
  track.dataset.liquidReady = "1";
  if (firstLayout) {
    lens.style.width = `${width}px`;
    lens.style.height = `${height}px`;
    lens.style.transform = `translate3d(${x}px,${y}px,0)`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (track.isConnected && lens.isConnected) lens.classList.remove("is-positioning");
    }));
    return;
  }
  if (previous === next) {
    if (!track.dataset.liquidMoving) {
      lens.style.width = `${width}px`;
      lens.style.height = `${height}px`;
      lens.style.transform = `translate3d(${x}px,${y}px,0)`;
    }
    return;
  }
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    resetTermaLiquidTrackMotion(track);
    lens.style.width = `${width}px`;
    lens.style.height = `${height}px`;
    lens.style.transform = `translate3d(${x}px,${y}px,0)`;
    return;
  }
  const deltaX = nextCenterX - currentCenterX;
  const deltaY = nextCenterY - currentCenterY;
  const horizontal = Math.abs(deltaX) > Math.abs(deltaY);
  const travel = Math.hypot(deltaX, deltaY);
  const referenceSize = Math.max(horizontal ? width : height, 1);
  const travelRatio = Math.min(1, travel / (referenceSize * 5));
  const wideTrack = track.dataset.liquidKind === "wide";
  const primaryStretch = (wideTrack ? .05 : .08) + travelRatio * (wideTrack ? .09 : .12);
  const crossCompression = (wideTrack ? .02 : .03) + travelRatio * (wideTrack ? .045 : .065);
  const forward = horizontal ? deltaX >= 0 : deltaY >= 0;
  const radiusShift = Math.round(travelRatio * (wideTrack ? 5 : 9));
  const motionDuration = Math.round(300 + travelRatio * 110);
  const motion = (termaLiquidTrackMotions.get(track) || 0) + 1;
  termaLiquidTrackMotions.set(track, motion);
  track.dataset.liquidAxis = horizontal ? "x" : "y";
  track.dataset.liquidDirection = forward ? "forward" : "backward";
  track.style.setProperty("--terma-liquid-travel", String(Math.round(travelRatio * 1000) / 1000));
  if (wideTrack) {
    track.style.setProperty("--terma-liquid-radius-a", `${10 - radiusShift * .45}px`);
    track.style.setProperty("--terma-liquid-radius-b", `${10 + radiusShift * 1.05}px`);
    track.style.setProperty("--terma-liquid-radius-c", `${10 - radiusShift * .25}px`);
    track.style.setProperty("--terma-liquid-radius-d", `${10 + radiusShift * .62}px`);
  } else {
    track.style.setProperty("--terma-liquid-radius-a", `${50 - radiusShift}%`);
    track.style.setProperty("--terma-liquid-radius-b", `${50 + radiusShift}%`);
    track.style.setProperty("--terma-liquid-radius-c", `${50 - Math.round(radiusShift * .58)}%`);
    track.style.setProperty("--terma-liquid-radius-d", `${50 + Math.round(radiusShift * .58)}%`);
  }
  track.style.setProperty("--terma-liquid-flow-from-x", horizontal ? (forward ? "-46%" : "46%") : "0%");
  track.style.setProperty("--terma-liquid-flow-from-y", horizontal ? "0%" : (forward ? "-46%" : "46%"));
  track.style.setProperty("--terma-liquid-flow-to-x", horizontal ? (forward ? "46%" : "-46%") : "0%");
  track.style.setProperty("--terma-liquid-flow-to-y", horizontal ? "0%" : (forward ? "46%" : "-46%"));
  track.style.setProperty("--terma-liquid-motion-duration", `${motionDuration}ms`);
  const currentWidth = Math.max(1, currentLensRect.width || previousGeometry[2] || width);
  const currentHeight = Math.max(1, currentLensRect.height || previousGeometry[3] || height);
  const currentX = currentCenterX - currentWidth / 2;
  const currentY = currentCenterY - currentHeight / 2;
  const scaleX = horizontal ? 1 + primaryStretch : 1 - crossCompression;
  const scaleY = horizontal ? 1 - crossCompression : 1 + primaryStretch;
  const movingWidth = width * scaleX;
  const movingHeight = height * scaleY;
  const stretchStartX = currentCenterX - movingWidth / 2;
  const stretchStartY = currentCenterY - movingHeight / 2;
  const destinationX = x - (movingWidth - width) / 2;
  const destinationY = y - (movingHeight - height) / 2;
  const movingRadius = wideTrack
    ? `${10 - radiusShift * .45}px ${10 + radiusShift * 1.05}px ${10 - radiusShift * .25}px ${10 + radiusShift * .62}px`
    : `${50 - radiusShift}% ${50 + radiusShift}% ${50 - Math.round(radiusShift * .58)}% ${50 + Math.round(radiusShift * .58)}%`;
  const restingRadius = track.dataset.liquidKind === "activity"
    ? "50%"
    : (track.dataset.liquidKind === "compact" ? "9px" : "8px");
  const currentRadius = getComputedStyle(lens).borderRadius || restingRadius;
  const previousAnimation = termaLiquidTrackAnimations.get(track);
  if (previousAnimation) {
    previousAnimation.cancel();
    termaLiquidTrackAnimations.delete(track);
  }
  clearTimeout(termaLiquidTrackTimers.get(track));
  termaLiquidTrackTimers.delete(track);
  lens.style.transition = "none";
  lens.style.width = `${currentWidth}px`;
  lens.style.height = `${currentHeight}px`;
  lens.style.transform = `translate3d(${currentX}px,${currentY}px,0)`;
  lens.style.borderRadius = currentRadius;
  lens.getBoundingClientRect();
  track.dataset.liquidMoving = "1";
  const animation = lens.animate([
    {
      width:`${currentWidth}px`,
      height:`${currentHeight}px`,
      transform:`translate3d(${currentX}px,${currentY}px,0)`,
      borderRadius:currentRadius,
      offset:0
    },
    {
      width:`${movingWidth}px`,
      height:`${movingHeight}px`,
      transform:`translate3d(${stretchStartX}px,${stretchStartY}px,0)`,
      borderRadius:movingRadius,
      offset:.16
    },
    {
      width:`${movingWidth}px`,
      height:`${movingHeight}px`,
      transform:`translate3d(${destinationX}px,${destinationY}px,0)`,
      borderRadius:movingRadius,
      offset:.76
    },
    {
      width:`${width}px`,
      height:`${height}px`,
      transform:`translate3d(${x}px,${y}px,0)`,
      borderRadius:restingRadius,
      offset:1
    }
  ], {
    duration:motionDuration,
    easing:"cubic-bezier(.22,1,.36,1)",
    fill:"forwards"
  });
  termaLiquidTrackAnimations.set(track, animation);
  animation.finished.then(() => {
    if (termaLiquidTrackMotions.get(track) !== motion || termaLiquidTrackAnimations.get(track) !== animation) return;
    termaLiquidTrackAnimations.delete(track);
    animation.cancel();
    lens.style.removeProperty("border-radius");
    settleTermaLiquidTrackMotion(track);
    resetTermaLiquidTrackMotion(track);
  }).catch(() => {});
}

function scheduleTermaLiquidTrack(track) {
  if (!track?.isConnected || termaLiquidTrackFrames.has(track)) return;
  const frame = requestAnimationFrame(() => {
    termaLiquidTrackFrames.delete(track);
    if (!track.isConnected) return;
    try { positionTermaLiquidTrack(track); }
    catch (error) {
      console.warn("Terma liquid track layout failed", error);
      resetTermaLiquidTrackMotion(track);
      track.querySelector(":scope > .terma-liquid-lens")?.classList.remove("is-positioning");
      track.classList.remove("has-liquid-selection");
      track.style.setProperty("--terma-liquid-lens-visibility", "0");
      delete track.dataset.liquidGeometry;
      delete track.dataset.liquidReady;
    }
  });
  termaLiquidTrackFrames.set(track, frame);
}

function termaLiquidMutationAffectsTrack(track, records) {
  return records.some(record => {
    if (record.type === "attributes") return !record.target.classList?.contains("terma-liquid-lens");
    const changed = [...record.addedNodes, ...record.removedNodes];
    if (changed.some(node => node.nodeType !== Node.ELEMENT_NODE || !node.classList?.contains("terma-liquid-lens"))) return true;
    return record.removedNodes.length > 0
      && ![...track.children].some(child => child.classList?.contains("terma-liquid-lens"));
  });
}

function bindTermaLiquidTrack(track) {
  if (!track || termaLiquidTrackObservers.has(track)) return;
  track.classList.add("terma-liquid-track");
  track.dataset.liquidKind = track.classList.contains("activity-top")
    ? "activity"
    : (track.classList.contains("mobile-tabs") ? "compact" : "wide");
  const observer = new MutationObserver(records => {
    if (termaLiquidMutationAffectsTrack(track, records)) scheduleTermaLiquidTrack(track);
  });
  observer.observe(track, {attributes:true, childList:true, subtree:true, attributeFilter:["class", "hidden"]});
  termaLiquidTrackObservers.set(track, observer);
  termaLiquidResizeObserver?.observe(track);
  scheduleTermaLiquidTrack(track);
}

function syncTermaLiquidNavigation() {
  [document.querySelector(".activity-top"), document.getElementById("explorerTools"), document.querySelector(".side-nav"), document.querySelector(".mobile-tabs")]
    .filter(Boolean)
    .forEach(bindTermaLiquidTrack);
  document.querySelectorAll(".terma-liquid-track").forEach(scheduleTermaLiquidTrack);
}

function themeAppearancePanelHtml() {
  const value = normalizeTermaAppearanceSettings(termaAppearanceSettings);
  return `<section class="theme-appearance-panel" id="themeAppearancePanel">
    <h3>界面效果</h3>
    <div class="theme-preset-control" role="radiogroup" aria-label="主题效果预设">
      <button type="button" class="theme-preset-button ${value.preset === "clear" ? "active" : ""}" data-theme-preset="clear" role="radio" aria-checked="${value.preset === "clear"}">${icon("sun")}<span><b>经典清晰</b><small>实色界面</small></span></button>
      <button type="button" class="theme-preset-button ${value.preset === "luminous" ? "active" : ""}" data-theme-preset="luminous" role="radio" aria-checked="${value.preset === "luminous"}">${icon("sparkles")}<span><b>流光玻璃</b><small>毛玻璃底座与流动高光</small></span></button>
    </div>
    <div class="theme-effect-scope"><span>${icon("panel-top")}<b>毛玻璃</b><small>弹窗、菜单、SFTP 外壳；调大更柔和</small></span><span>${icon("bell")}<b>流光玻璃</b><small>活动栏、操作区、顶部导航和通知；调大流动感更明显</small></span></div>
    <div class="theme-appearance-control"><label for="themeFrostedStrength">毛玻璃强度</label><input id="themeFrostedStrength" type="range" min="0" max="100" step="1" value="${value.frosted_strength}"><output id="themeFrostedStrengthValue">${value.frosted_strength}%</output></div>
    <p class="theme-control-help">控制背景模糊和表面分离度。强度越高，弹窗和工具层越柔和；强度越低，背景细节越清楚，低性能设备也更轻。</p>
    <div class="theme-appearance-control"><label for="themeLiquidStrength">流光玻璃强度</label><input id="themeLiquidStrength" type="range" min="0" max="100" step="1" value="${value.liquid_strength}"><output id="themeLiquidStrengthValue">${value.liquid_strength}%</output></div>
    <p class="theme-control-help">控制透明度、饱和度、边缘高光、阴影和缓慢移动的反射带。强度越高，材质越通透、层次越明显；强度越低，界面越接近稳定的半透明面板。</p>
    <div class="theme-appearance-warning" role="note">${icon("info")}<span>流光玻璃仍在持续适配。终端正文、文本编辑器、差异内容和部分系统控件会保持实色，以保证清晰度与兼容性。</span></div>
    <div class="theme-appearance-preview" aria-hidden="true"><div class="theme-preview-toolbar"><i></i><i></i><i></i><span></span></div><div class="theme-preview-card"><b></b><small></small><small></small></div><span class="theme-preview-notification">${icon("bell")}<b>通知</b></span><span class="theme-preview-task">${icon("list-checks")}<b>任务中心</b></span></div>
    <div class="actions"><button class="primary" id="saveThemeAppearance" type="button">${icon("save")}<span>保存主题配置</span></button><button id="resetThemeAppearance" type="button">恢复默认</button></div>
  </section>`;
}

function themeAppearanceFormValue() {
  return normalizeTermaAppearanceSettings({
    frosted_strength:Number($("themeFrostedStrength")?.value ?? termaAppearanceSettings.frosted_strength),
    liquid_strength:Number($("themeLiquidStrength")?.value ?? termaAppearanceSettings.liquid_strength)
  });
}

function syncThemeAppearanceControls(value=themeAppearanceFormValue()) {
  if ($("themeFrostedStrengthValue")) $("themeFrostedStrengthValue").textContent = `${value.frosted_strength}%`;
  if ($("themeLiquidStrengthValue")) $("themeLiquidStrengthValue").textContent = `${value.liquid_strength}%`;
  document.querySelectorAll("#themeAppearancePanel [data-theme-preset]").forEach(button => {
    const active = button.dataset.themePreset === value.preset;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
}

function previewThemeAppearanceSettings() {
  const value = themeAppearanceFormValue();
  syncThemeAppearanceControls(value);
  applyTermaAppearanceSettings(value);
}

function selectThemeAppearancePreset(id) {
  const preset = TERMA_APPEARANCE_PRESETS[String(id || "")];
  if (!preset) return;
  if ($("themeFrostedStrength")) $("themeFrostedStrength").value = String(preset.frosted_strength);
  if ($("themeLiquidStrength")) $("themeLiquidStrength").value = String(preset.liquid_strength);
  previewThemeAppearanceSettings();
}

function bindThemeAppearancePanel() {
  const panel = $("themeAppearancePanel");
  if (!panel || panel.dataset.bound === "1") return;
  panel.dataset.bound = "1";
  panel.querySelectorAll("[data-theme-preset]").forEach(button => {
    button.addEventListener("click", () => selectThemeAppearancePreset(button.dataset.themePreset));
  });
  $("themeFrostedStrength")?.addEventListener("input", previewThemeAppearanceSettings);
  $("themeLiquidStrength")?.addEventListener("input", previewThemeAppearanceSettings);
  $("saveThemeAppearance")?.addEventListener("click", saveThemeAppearanceSettings);
  $("resetThemeAppearance")?.addEventListener("click", resetThemeAppearanceSettings);
  syncThemeAppearanceControls();
}

function saveThemeAppearanceSettings() {
  termaAppearanceSettings = themeAppearanceFormValue();
  localStorage.setItem(TERMA_APPEARANCE_STORAGE_KEY, JSON.stringify(termaAppearanceSettings));
  applyTermaAppearanceSettings();
  notify("主题配置已保存", "success");
}

function resetThemeAppearanceSettings() {
  termaAppearanceSettings = {...TERMA_APPEARANCE_DEFAULTS};
  localStorage.setItem(TERMA_APPEARANCE_STORAGE_KEY, JSON.stringify(termaAppearanceSettings));
  applyTermaAppearanceSettings();
  if (activeView === "settings") renderSettings();
  notify("主题配置已恢复默认", "success");
}

applyTermaAppearanceSettings();
syncTermaLiquidNavigation();
