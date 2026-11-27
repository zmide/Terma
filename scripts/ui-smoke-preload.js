const { ipcRenderer,contextBridge } = require("electron");
if(process.env.TERMA_UI_SCENARIO==="terminal-panel")contextBridge.exposeInMainWorld("termaLocalTerminalTest",{
  capabilities:{platform:process.platform},
  localTerminalProfiles:()=>ipcRenderer.invoke("terma:local-terminal-profiles"),
  startLocalTerminal:options=>ipcRenderer.invoke("terma:local-terminal-start",options),
  writeLocalTerminal:(id,data)=>ipcRenderer.invoke("terma:local-terminal-write",{id,data}),
  resizeLocalTerminal:(id,cols,rows)=>ipcRenderer.invoke("terma:local-terminal-resize",{id,cols,rows}),
  closeLocalTerminal:id=>ipcRenderer.invoke("terma:local-terminal-close",{id}),
  onLocalTerminal:callback=>{
    const handler=(_event,value)=>callback(value);ipcRenderer.on("terma:local-terminal-event",handler);
    return ()=>ipcRenderer.removeListener("terma:local-terminal-event",handler);
  }
});

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
