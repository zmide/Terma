"use strict";
// Synchronous first-paint setup for the workspace surfaces.
(() => {
    try {
        localStorage.removeItem('termaAppearanceV1');
    }
    catch {
        // Private storage can be disabled. The flat appearance still applies.
    }
    const root = document.documentElement;
    const profileId = Number(new URLSearchParams(location.search).get('termaVncWindow') || 0);
    if (Number.isInteger(profileId) && profileId > 0) {
        root.dataset.termaVncProfileId = String(profileId);
        root.classList.add('vnc-detached-window');
        document.body.classList.add('vnc-detached-window-body');
    }
    root.dataset.appearancePreset = 'clear';
    root.classList.add('terma-glass-disabled', 'terma-frosted-disabled');
    root.classList.remove('terma-liquid-enabled');
    const properties = {
        "--terma-overlay-opacity": "100%",
        "--terma-overlay-content-opacity": "100%",
        "--terma-overlay-foreground-opacity": "100%",
        "--terma-overlay-foreground-alpha": "1",
        "--terma-overlay-blur": "0px",
        "--terma-overlay-saturation": "1",
        "--terma-frosted-surface-opacity": "100%",
        "--terma-frosted-toolbar-opacity": "100%",
        "--terma-frosted-saturation": "1",
        "--terma-frosted-backdrop-blur": "0px",
        "--terma-frosted-toolbar-blur": "0px",
        "--terma-modal-backdrop-blur": "0px",
        "--terma-liquid-highlight-opacity": "0%",
        "--terma-liquid-highlight-alpha": "0",
        "--terma-liquid-shadow-alpha": "0.14",
        "--terma-liquid-surface-opacity": "100%",
        "--terma-liquid-icon-surface-opacity": "10%",
        "--terma-liquid-motion-alpha": "0",
        "--terma-liquid-border-opacity": "0%",
        "--terma-liquid-active-opacity": "0%",
        "--terma-liquid-lens-opacity": "0%",
        "--terma-liquid-compact-opacity": "0%",
        "--terma-liquid-wide-opacity": "0%",
        "--terma-liquid-refraction-alpha": "0",
        "--terma-modal-surface-opacity": "93%",
        "--terma-modal-band-opacity": "90%"
    };
    for (const [property, setting] of Object.entries(properties))
        root.style.setProperty(property, setting);
    function clearTermaLiquidTrack(track) {
        track.querySelectorAll(":scope > .terma-liquid-lens").forEach(lens => lens.remove());
        track.classList.remove("terma-liquid-track", "has-liquid-selection");
        for (const key of ["liquidKind", "liquidAxis", "liquidMoving", "liquidDirection", "liquidGeometry", "liquidReady"]) {
            delete track.dataset[key];
        }
        for (const property of [
            "--terma-liquid-lens-x", "--terma-liquid-lens-y", "--terma-liquid-lens-width",
            "--terma-liquid-lens-height", "--terma-liquid-lens-visibility", "--terma-liquid-travel",
            "--terma-liquid-radius-a", "--terma-liquid-radius-b", "--terma-liquid-radius-c",
            "--terma-liquid-radius-d", "--terma-liquid-flow-from-x", "--terma-liquid-flow-from-y",
            "--terma-liquid-flow-to-x", "--terma-liquid-flow-to-y", "--terma-liquid-motion-duration"
        ])
            track.style.removeProperty(property);
    }
    function syncTermaLiquidNavigation() {
        document.querySelectorAll(".terma-liquid-track, :has(> .terma-liquid-lens)")
            .forEach(clearTermaLiquidTrack);
    }
    syncTermaLiquidNavigation();
})();
