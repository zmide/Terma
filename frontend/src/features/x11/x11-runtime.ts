import {x11Services} from '@/features/x11/installed-services';
import {terminalAuthentication} from '@/features/terminal/terminal-authentication-workspace';
import {h} from 'vue';
import {TermaButton} from '@/shared/ui/TermaButton';
import {paintQuickView,quickIcon} from '../quick/quick-mount';
import {forwardDialog} from '../forwards/ForwardForms';
import {showOperationsModal} from '../operations/operations-modal';
import type {ModalBinding} from '../operations/operations-types';
import {createXServerService} from './local-service';
import {createX11RemoteService} from './remote-service';
import {createX11TerminalService,type X11Launch} from './terminal-service';
import {createX11TerminalMenuService} from './terminal-menu-service';
import {createX11Host, x11MenuHost} from './x11-host';
import {x11Presentation} from './presentation-service';
import {createX11Launcher} from './launcher-service';
import {launcherView} from './LauncherView';
import {openX11Manual} from './manual-terminal';
import {createX11Surfaces} from './x11-surfaces';
import type {X11Port} from './x11-types';
import '@/styles/x11.css';
function createRuntime(){
 const port: X11Port = {
  ...createX11Host({ask: value => question.ask(value), owner: captureOwner, restore, manual, managerKey: () => manager.state.terminalKey}),
  ...createX11Surfaces(errorView)
 };
 const question=forwardDialog(port),manager=createXServerService(port),terminal=createX11TerminalService(port,manager),remote=createX11RemoteService(port,manager);
 let generation=0,surface='',changing=false,binding:ModalBinding|undefined;
 function paintLauncher(){const own=launcher.state;if(!own){binding?.close();binding=undefined;return;}if(surface!=='launcher'||changing)return;
  if(binding?.alive()){binding.paint();return;}if(!document.getElementById('modal')?.hidden)return;
  binding=showOperationsModal(()=>launcher.state?launcherView(launcher.state,port,{close:closeLauncher,detect:()=>void launcher.detect(),select:launcher.select,change:launcher.change,submit:()=>void launcher.submit(),guide:()=>void openGuide(own.id),label:x11Presentation.applicationLabel,category:x11Presentation.categoryLabel,warning:x11Presentation.discoveryWarning}):null,()=>{binding=undefined;if(!changing&&!manager.state.suspended)closeLauncher();});
 }
 const launcher=createX11Launcher(port,terminal,paintLauncher);
 function begin(kind:string){changing=true;generation++;manager.close(true);remote.closeGuide();launcher.close();binding?.close();binding=undefined;port.beforeOpen();surface=kind;changing=false;}
 let managerOpening = false;
 async function openManager(id = 0, key = '', kind: 'manager' | 'settings' = 'manager') {
  const fromWorkspace = kind === 'manager';
  const visible = fromWorkspace ? port.manager.visible() : port.manager.settingsVisible();
  if (fromWorkspace && managerOpening || visible && surface === kind) return false;
  if (fromWorkspace) managerOpening = true;
  try {
   begin(kind);
   return await manager.open(id, key, kind);
  } finally {
   if (fromWorkspace) managerOpening = false;
  }
 }
 function closeManager(){if(manager.state.suspended)return;generation++;surface='';manager.close(true);}
 function closeLauncher(){if(manager.state.suspended)return;generation++;surface='';launcher.close();}
 function closeGuide(){if(manager.state.suspended)return;generation++;surface='';remote.closeGuide();}
 function openGuide(id:number){begin('guide');return remote.guide(id);}
 function errorView(message:string,retry:()=>void){const modal=document.getElementById('modal');if(!modal)return;const t=port.tr;
  paintQuickView(modal,h('section',{class:'modal-card xserver-manager',role:'dialog','aria-modal':'true'},[h('div',{class:'modal-title-row'},[h('h2',null,t('common:x11.local_xserver_title')),h(TermaButton,{class:'icon-button',title:t('common:actions.close'),'aria-label':t('common:actions.close'),onClick:closeManager},()=>quickIcon('x'))]),h('div',{class:'connection-test-status remote-diagnostic-status error'},[h('span',{class:'remote-diagnostic-icon'},quickIcon('circle-alert')),h('span',{class:'remote-diagnostic-copy'},port.localize(message)),h('span',{class:'remote-diagnostic-actions'},[h(TermaButton,{onClick:retry},()=>[quickIcon('refresh-cw'),port.tr('common:actions.retry')])])])]));modal.dataset.xServerManager='1';modal.hidden=false;
 }
 function restore(source:string,id:number){if(source==='linux-desktop')return true;if(source==='install-guide'){if(port.guide.visible(id))return true;if(port.manager.canRestore())return remote.restoreGuide(id);return false;}if(manager.state.suspended)return false;return manager.restore();}
 async function inspectClipboard(id:number){if(manager.state.connectionId!==id)return null;return manager.refresh();}
 async function changeDefault(id:number,value:string,button:HTMLElement|null){port.busy(button,true,()=>port.tr('common:auto.saving'));try{const result=await terminal.change(id,value);if(manager.state.connectionId===id&&port.manager.visible())await manager.refresh();return result;}finally{port.busy(button,false);}}
 async function repair(id:number,source='xserver'){const c=port.connection(id);if(!c||id<1||c.quick_connection)return false;const own=generation,scope=port.scope(),host=c.ssh_host;const result=await manager.hold(()=>port.repair(id));if(own!==generation||!scope()||port.connection(id)?.ssh_host!==host)return false;if(source==='linux-desktop')await port.refreshLinux();else if(port.manager.canRestore()){manager.restore();await manager.refresh();}return result||false;}
 function repairTemporary(id: number) {
  const key = manager.state.terminalKey;
  const session = key ? port.session(key) : undefined;
  const authentication = terminalAuthentication;
  if (manager.state.connectionId !== id || !session?.connection.quick_connection || session.connection.id !== id || !authentication) return false;
  closeManager();
  return authentication.repair(session.connection, key, session, () => port.session(key));
 }
 function openTerminalFromManager(id:number){closeManager();return terminal.temporary(id,'untrusted');}
 function captureOwner() {
  const own = generation;
  return () => own === generation;
 }
 function manual(id: number, command: string, kind: 'install' | 'configure' | 'guide', action = '', quartz = false) {
  closeGuide();
  closeManager();
  return openX11Manual(port, id, command, kind, action, quartz) || undefined;
 }
 const repaint=()=>{if(port.manager.visible()){const snapshot=manager.state.snapshot;if(snapshot)port.manager.paint(snapshot);}if(port.guide.visible(remote.guideState?.id||0)&&remote.guideState)remote.restoreGuide(remote.guideState.id);paintLauncher();};
 window.addEventListener('terma:language-changed',repaint);const theme=new MutationObserver(repaint);theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
 const keydown=(event:KeyboardEvent)=>{if(event.key==='Escape'&&port.manager.visible()){event.preventDefault();closeManager();}};document.addEventListener('keydown',keydown);
 return {manager,remote,terminal,launcher,ask:question.ask,openManager,closeManager,openLauncher(id:number){begin('launcher');return launcher.open(id);},closeLauncher,openGuide,closeGuide,inspectClipboard,changeDefault,repair,repairTemporary,openTerminalFromManager,restore,captureOwner,manual,launch:(id:number,values:X11Launch)=>terminal.launch(id,values),repaint,dispose(){manager.dispose();remote.dispose();terminal.dispose();launcher.dispose();theme.disconnect();document.removeEventListener('keydown',keydown);window.removeEventListener('terma:language-changed',repaint);}};
}
export function installX11() {
 const feature = createRuntime();
 x11Services.termaX11 = feature;
 x11Services.termaX11TerminalMenu = createX11TerminalMenuService({
  ...x11MenuHost,
  launch: feature.openLauncher,
  temporary: feature.terminal.temporary,
  quick: feature.terminal.quick,
  manager: feature.openManager,
  current: (id, mode, key) => feature.terminal.change(id, mode, 'current', key),
  nextTerminal: (id, mode) => feature.terminal.change(id, mode, 'new'),
  nextStart: (id, mode) => feature.terminal.change(id, mode, 'next')
 });
 window.addEventListener('beforeunload', feature.dispose, {once: true});
}


export interface InstalledFeaturesX11X11RuntimeServices {
  termaX11:ReturnType<typeof createRuntime>
}
