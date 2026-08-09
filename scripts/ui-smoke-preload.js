const { ipcRenderer } = require("electron");

window.addEventListener("securitypolicyviolation", event => {
  ipcRenderer.send("terma-ui-smoke:csp-violation", {
    blockedURI:String(event.blockedURI || ""),
    disposition:String(event.disposition || ""),
    documentURI:String(event.documentURI || ""),
    effectiveDirective:String(event.effectiveDirective || ""),
    lineNumber:Number(event.lineNumber || 0),
    sourceFile:String(event.sourceFile || ""),
    violatedDirective:String(event.violatedDirective || "")
  });
}, true);
