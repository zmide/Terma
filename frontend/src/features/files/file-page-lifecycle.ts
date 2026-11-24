import {BrowserFileDirectory} from './browser-directory';
import {LOCAL_COMPUTER_PATH,type LocalFileState,type LoadOptions} from './local-file-service';
import {deliveryPathKey} from './file-delivery-refresh';
import type {SftpMenuEvent,SftpMenuAction} from './sftp/SftpMenuViews';
type Source='native'|'browser'|'server';type Zone=''|'left'|'right'|'top'|'bottom';
interface Tab {key:string;kind?:string;title?:string;subtitle?:string;fileSource?:'browser'|'server';path?:string;localLocation?:string}
interface Pane {id:string;activeTabKey:string;tabs:string[]}
export interface FilePageLifecyclePort {
  native():boolean;mobile():boolean;active():string;tab(key:string):Tab|undefined;next(source:Source):string;
  state(key:string):LocalFileState;view(key:string):HTMLElement|null;mount(view:HTMLElement,key:string):void;update(key:string):void;
  workspace(key:string,title:string,subtitle:string,update:boolean,options:{kind:'local-files';fileSource?:'browser'|'server';path:string;localLocation?:string}):void;
  load(key:string,options:LoadOptions):Promise<unknown>;
  pane():Pane|undefined;findPane(id:string):Pane|undefined;scroll(id:string,value?:number):number;
  split(key:string,pane:string,zone:Zone):void;restore(pane:Pane,key:string,scroll:number):void;
  text(key:string):string;show(event:SftpMenuEvent,actions:()=>SftpMenuAction[]):void;
  tabs():readonly Tab[];peek(key:string):LocalFileState|undefined;mounted(key:string):boolean;
  heading(subtitle:string):void;renderTabs():void;persist():void;release(key:string):void;
}
export function createFilePageLifecycle(port:FilePageLifecyclePort){
  const label=(source:Source)=>port.text(source==='native'?'sftp:local_files.title':`sftp:web_files.${source}`);
  async function open(requested='',update=true,existing='',source?:Source){
    const tab=existing?port.tab(existing):undefined;
    source=source||tab?.fileSource||(port.native()?'native':'browser');if(source==='native'&&!port.native())source='browser';
    const key=existing||port.next(source),state=port.state(key),view=port.view(key);if(!view)return '';
    if(source!=='native'){
      state.fileSource=source;state.location='directory';
      if(source==='browser'&&!state.browserDirectory)state.browserDirectory=new BrowserFileDirectory(name=>port.text(`sftp:web_files.${name}`));
      const mounted=view.dataset.workspaceTabKey===key&&view.querySelector<HTMLElement>('.web-files-shell')?.dataset.source===source;
      view.dataset.workspaceTabKey=key;if(!mounted||!view.querySelector('.terma-local-files-root'))port.mount(view,key);
      port.workspace(key,label(source),state.displayPath||'',update,{kind:'local-files',fileSource:source,path:requested||state.path||''});
      if(!mounted||!state.loaded)await port.load(key,{path:requested||state.path||(source==='browser'?'/browser':''),location:'directory'});else port.update(key);
    }else{
      const stored=requested||tab?.path||state.path||'',computer=stored===LOCAL_COMPUTER_PATH||tab?.localLocation==='computer'||state.location==='computer',path=computer?'':stored;
      const shell=view.dataset.workspaceTabKey===key?view.querySelector('.local-files-shell'):null;
      const matches=computer?state.location==='computer':state.location==='directory'&&deliveryPathKey(state.path)===deliveryPathKey(path);
      view.dataset.workspaceTabKey=key;if(!shell?.classList.contains('terma-local-files-root'))port.mount(view,key);
      port.workspace(key,label(source),state.displayPath||(computer?port.text('sftp:local_files.this_computer'):path||port.text('sftp:local_files.system_desktop')),update,{kind:'local-files',path:computer?LOCAL_COMPUTER_PATH:path,localLocation:computer?'computer':'directory'});
      if(!state.loaded||!matches)await port.load(key,{path,location:computer?'computer':'directory',page:state.page});else port.update(key);
    }
    return key;
  }
  function committed(key:string,state:LocalFileState){
    const tab=port.tab(key),subtitle=state.displayPath||state.path;
    if(tab){
      tab.path=!state.fileSource&&state.location==='computer'?LOCAL_COMPUTER_PATH:state.path;
      tab.localLocation=state.location;tab.fileSource=state.fileSource;tab.subtitle=subtitle;
    }
    port.persist();
    if(key===port.active())port.heading(subtitle);
    port.update(key);
  }
  async function placement(source:Source,zone:Zone=''){
    const pane=port.pane(),sourceKey=pane?.activeTabKey||port.active(),scroll=pane?port.scroll(pane.id):0;
    const key=await open('',true,'',source);
    if(key&&zone&&pane){port.split(key,pane.id,zone);const remaining=port.findPane(pane.id);if(remaining?.tabs.includes(sourceKey))port.restore(remaining,sourceKey,scroll);}
    return key;
  }
  function menu(event:SftpMenuEvent,native=port.native()){
    const placements=(source:Source):SftpMenuAction[]=>[
      {label:port.text('navigation:auto.new_tab'),icon:'file-plus-2',run:()=>placement(source)},
      ...(!port.mobile()?(['left','right','top','bottom'] as const).map(zone=>({label:port.text(`navigation:auto.new_split_${zone}`),icon:`panel-${zone}`,run:()=>placement(source,zone)})):[])
    ];
    port.show(event,()=>native?placements('native'):[{label:label('browser'),icon:'laptop',children:placements('browser')},{label:label('server'),icon:'server',children:placements('server')}]);
  }
  function language(){
    for(const tab of port.tabs()){
      if(tab.kind!=='local-files')continue;
      const state=port.peek(tab.key),source=state?.fileSource||tab.fileSource||'native';
      tab.title=label(source);
      if(!state)continue;
      if(source==='native'&&state.location==='computer')state.displayPath=port.text('sftp:local_files.this_computer');
      tab.subtitle=state.displayPath||state.path||'';
      if(port.mounted(tab.key))port.update(tab.key);
      if(tab.key===port.active())port.heading(tab.subtitle);
    }
    port.renderTabs();
  }
  function release(keys:readonly string[]){
    for(const key of new Set(keys))if(port.tab(key)?.kind==='local-files')port.release(key);
  }
  return {open,committed,placement,menu,language,release,label};
}
