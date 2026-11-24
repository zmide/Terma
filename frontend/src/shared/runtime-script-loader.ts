import {translate} from './i18n/runtime';

export function createRuntimeScriptLoader(document:Document) {
  const sources=new Set(['/vendor/xterm/xterm.js','/vendor/xterm/addon-fit.js','/vendor/zmodem.js']);
  const pending=new Map<string,Promise<void>>();
  return function loadScript(source:string):Promise<void> {
    const url=new URL(source,document.baseURI);
    if(url.origin!==new URL(document.baseURI).origin||!sources.has(url.pathname)||url.search||url.hash) {
      return Promise.reject(new Error(translate('terminal:components.script_load_failed',{source})));
    }
    const key=url.pathname,previous=pending.get(key);
    if(previous)return previous;
    const found=[...document.scripts].find(script=>script.src===url.href);
    if(found?.dataset.loaded==='1')return Promise.resolve();
    const task=new Promise<void>((resolve,reject)=>{
      const script=found||document.createElement('script');
      const release=()=>{script.removeEventListener('load',loaded);script.removeEventListener('error',failed);};
      const loaded=()=>{script.dataset.loaded='1';release();resolve();};
      const failed=()=>{release();script.remove();reject(new Error(translate('terminal:components.script_load_failed',{source:key})));};
      script.addEventListener('load',loaded,{once:true});
      script.addEventListener('error',failed,{once:true});
      if(!found){script.src=key;script.async=false;document.head.appendChild(script);}
    });
    const tracked=task.catch(cause=>{pending.delete(key);throw cause;});
    pending.set(key,tracked);
    return tracked;
  };
}

let loader:ReturnType<typeof createRuntimeScriptLoader>|undefined;
export const loadRuntimeScript=(source:string)=>(loader||=createRuntimeScriptLoader(document))(source);
