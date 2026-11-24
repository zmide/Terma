import type {Terminal,ITerminalOptions} from '@xterm/xterm';
import type {FitAddon} from '@xterm/addon-fit';
import {translate as tr} from '../../shared/i18n/runtime';
import {loadRuntimeScript} from '../../shared/runtime-script-loader';

type TerminalConstructor=typeof import('@xterm/xterm').Terminal;
type FitConstructor=typeof import('@xterm/addon-fit').FitAddon;
type Libraries={Terminal:TerminalConstructor;FitAddon:FitConstructor};
type RuntimeGlobals={Terminal?:TerminalConstructor;FitAddon?:FitConstructor|{FitAddon?:FitConstructor}};
export interface TerminalLibraryPort {
  load(source:string):Promise<unknown>;
  globals():RuntimeGlobals;
  modules():Promise<Partial<Libraries>>;
  messages(type:TerminalConstructor):void;
}
export function createTerminalLibraries(port:TerminalLibraryPort) {
  let libraries:Libraries|undefined,pending:Promise<void>|undefined;
  async function initialize() {
    const errors:string[]=[];
    let terminal:TerminalConstructor|undefined,fit:FitConstructor|undefined;
    try {
      await port.load('/vendor/xterm/xterm.js');
      await port.load('/vendor/xterm/addon-fit.js');
      const source=port.globals();
      terminal=source.Terminal;
      fit=typeof source.FitAddon==='function'?source.FitAddon:source.FitAddon?.FitAddon;
    } catch(cause) {errors.push(cause instanceof Error?cause.message:String(cause));}
    if(!terminal||!fit) {
      try {const source=await port.modules();terminal=source.Terminal;fit=source.FitAddon;}
      catch(cause) {errors.push(cause instanceof Error?cause.message:String(cause));}
    }
    if(!terminal||!fit)throw new Error(tr('terminal:components.xterm_load_failed',{error:errors.join('; ')||tr('terminal:components.runtime_missing')}));
    libraries={Terminal:terminal,FitAddon:fit};
    port.messages(terminal);
  }
  async function ensure() {
    if(libraries){port.messages(libraries.Terminal);return;}
    if(!pending)pending=initialize().catch(cause=>{pending=undefined;throw cause;});
    return pending;
  }
  function current() {
    if(!libraries)throw new Error(tr('terminal:components.runtime_missing'));
    return libraries;
  }
  return {
    ensure,
    terminal:(options:ITerminalOptions):Terminal=>new (current().Terminal)(options),
    fit:():FitAddon=>new (current().FitAddon)(),
    sync:()=>{if(libraries)port.messages(libraries.Terminal);}
  };
}
function componentMessages(type:TerminalConstructor) {
  const promptLabel=tr('terminal:a11y.prompt_label'),tooMuchOutput=tr('terminal:a11y.too_much_output');
  if(type.strings){type.strings.promptLabel=promptLabel;type.strings.tooMuchOutput=tooMuchOutput;}
  document.querySelectorAll('.xterm-helper-textarea').forEach(element=>element.setAttribute('aria-label',promptLabel));
}
export const terminalLibraries=createTerminalLibraries({
  load:loadRuntimeScript,
  globals:()=>globalThis as typeof globalThis&RuntimeGlobals,
  modules:async()=>{
    const terminalSource='/vendor/xterm/xterm.mjs',fitSource='/vendor/xterm/addon-fit.mjs';
    const terminal=await import(/* @vite-ignore */ terminalSource) as Pick<Libraries,'Terminal'>;
    const fit=await import(/* @vite-ignore */ fitSource) as Pick<Libraries,'FitAddon'>;
    return {Terminal:terminal.Terminal,FitAddon:fit.FitAddon};
  },
  messages:componentMessages
});
export function installTerminalLibraryMessages() {
  window.addEventListener('terma:language-changed',()=>terminalLibraries.sync());
}


