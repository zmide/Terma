import {sessionEfficiencyServices} from '@/features/session-efficiency/installed-services';
import {createClosedTabService,type HistoryPort} from './closed-tab-service';
import {createPersistentSessionService,type SessionPort} from './persistent-session-service';
import {showOperationsModal} from '../operations/operations-modal';
import type {ModalBinding} from '../operations/operations-types';
import {sessionManagerView,type SessionManagerState} from './SessionManagerView';
import type {RecoverableRecord,SessionTab} from './session-model';
import {openTerminalBroadcastPicker,type TerminalBroadcastPickerPort} from './terminal-broadcast-picker';
import {createSessionEfficiencyHost} from './session-efficiency-host';
import '@/styles/session-efficiency.css';
export interface SessionEfficiencyPort extends HistoryPort,SessionPort,TerminalBroadcastPickerPort{tr(key:string,values?:Record<string,unknown>):string;label(tab:SessionTab):string;reconnect(key:string):void;menu(event:Event,items:()=>{key:string;label:string;icon:string;danger?:boolean;run():unknown}[]):void}
function createRuntime(){const port=createSessionEfficiencyHost(),history=createClosedTabService(port);let binding:ModalBinding|undefined,resolveConfirm:((value:boolean)=>void)|null=null;const state:SessionManagerState={records:[],confirmation:null};
 const paint=()=>{if(binding?.alive()){state.records=service.records();binding.paint();}};
 const service=createPersistentSessionService(port,history,paint);
 function confirm(answer:boolean){const resolve=resolveConfirm;resolveConfirm=null;state.confirmation=null;binding?.paint();resolve?.(answer);queueMicrotask(()=>document.getElementById('terminalSessionManagerDone')?.focus());}
 function close(){confirm(false);binding?.close();binding=undefined;}
 function prompt(record:RecoverableRecord){return new Promise<boolean>(resolve=>{if(!binding?.alive()){resolve(false);return;}resolveConfirm=resolve;state.confirmation=record;binding.paint();queueMicrotask(()=>document.querySelector<HTMLElement>('.session-efficiency-confirm [data-choice="1"]')?.focus());});}
 function open(){close();port.beforeOpen();state.records=service.records();binding=showOperationsModal(()=>sessionManagerView(state,{...port,busy:service.busy,close,confirm,refresh:paint,restore:record=>{if(service.restore(record))close();},terminate:record=>{void service.terminate(record,{confirm:()=>prompt(record)}).then(paint);}}),()=>{binding=undefined;confirm(false);},()=>{if(state.confirmation){confirm(false);return true;}return false;});queueMicrotask(()=>document.getElementById('terminalSessionManagerDone')?.focus());}
 function menu(event:Event,key:string){const tab=port.tabs().find(t=>t.key===key),fixed=tab&&service.prepare(tab);if(!fixed||service.busy.has(fixed.identity))return;port.menu(event,()=>[{key:'reconnect-session',label:port.tr('terminal:session.reconnect'),icon:'refresh-cw',run:()=>!service.busy.has(fixed.identity)&&fixed.lease.current()&&port.unlocked()&&port.reconnect(key)},{key:'terminate-session',label:port.tr('terminal:session.terminate_short'),icon:'x-circle',danger:true,run:()=>fixed.lease.current()&&service.terminate(fixed)}]);}
 function handle(event:Event,key:string){event.preventDefault?.();event.stopPropagation?.();const tab=port.tabs().find(t=>t.key===key);if(tab?.kind!=='terminal')return;if(tab.sessionMode!=='persistent'||!tab.persistentSessionId)return service.enable(key);menu(event,key);}
 return {history,service,state,open,close,menu,handle,openBroadcast:()=>openTerminalBroadcastPicker(port),dispose(){close();service.dispose();}};
}
export function installSessionEfficiency(){let feature:ReturnType<typeof createRuntime>|undefined;const get=()=>feature||=createRuntime();sessionEfficiencyServices.termaSessionEfficiency={get history(){return get().history;},get service(){return get().service;},open:()=>get().open(),openBroadcast:()=>get().openBroadcast(),menu:(...args)=>get().menu(...args),handle:(...args)=>get().handle(...args)};window.addEventListener('beforeunload',()=>feature?.dispose());}


export interface InstalledFeaturesSessionEfficiencySessionRuntimeServices {
  termaSessionEfficiency:{history:ReturnType<typeof createClosedTabService>;service:ReturnType<typeof createPersistentSessionService>;open():void;openBroadcast():void;menu(event:Event,key:string):void;handle(event:Event,key:string):unknown}
}
