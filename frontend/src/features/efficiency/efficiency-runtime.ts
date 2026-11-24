import {forwardsServices} from '@/features/forwards/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {efficiencyServices} from '@/features/efficiency/installed-services';
import { createEfficiencyHost } from './efficiency-host';
import {createPaletteService,type PalettePort} from './palette-service';
import {ensureQuickPanel,renderQuickPanel,syncQuickPanelLocalization,type PaletteViewPort} from './PaletteView';
import {createQuickCommandService,type QuickCommandPort} from './quick-command-service';
import {paintQuickCommands,releaseQuickCommands} from './QuickCommandView';
import type { EventRegistry } from '@/shared/actions/event-registry';
import '@/styles/efficiency.css';
export interface EfficiencyPort extends Omit<PalettePort,'render'|'show'|'hide'|'frame'|'cancelFrame'>,Omit<QuickCommandPort,'paint'|'read'|'write'> {quickForwardIsActive:PaletteViewPort['quickForwardIsActive'];quickForwardAccessUrl:PaletteViewPort['quickForwardAccessUrl'];remoteProtocolAction:PaletteViewPort['remoteProtocolAction'];protocolMeta:PaletteViewPort['REMOTE_PROTOCOL_META'];refreshIcons():void;toolbar():void;edit(id:number,quick:boolean):unknown;manage():unknown;menu(event:Event,items:({label?:string;icon?:string;danger?:boolean;separator?:boolean;run?:()=>unknown})[]):void;keepKeyboard(event:Event):void;restore():unknown;broadcasting():boolean;stopBroadcast():void;retainsQuickBar(bar:HTMLElement):boolean}
const barSelector='[data-terminal-quick-command-bar]';
function createRuntime(){const port=createEfficiencyHost(),bars=new Map<HTMLElement,()=>void>();let dragOwner:HTMLElement|null=null,dragCleanup:(()=>void)|null=null,suppress={id:0,until:0},keyboard=false;
 const palette=createPaletteService({...port,render:()=>renderQuickPanel(view,palette.state.query,false),show:()=>{const panel=ensureQuickPanel(view) as HTMLElement;panel.hidden=false;const input=panel.querySelector<HTMLInputElement>('#quickPanelInput')!;input.value=palette.state.query;input.focus();},hide:()=>{const panel=document.querySelector<HTMLElement>('#quickPanel');if(panel)panel.hidden=true;},frame:run=>requestAnimationFrame(run),cancelFrame:id=>cancelAnimationFrame(id)});
 const view:PaletteViewPort={state:palette.state,tr:port.tr,scheduleQuickPanelRender:query=>palette.schedule(query),refresh:(query,reset)=>palette.refresh(query,reset),runQuickPanelItem:index=>palette.run(index),closeQuickPanel:()=>{palette.close();},quickForwardIsActive:port.quickForwardIsActive,quickForwardAccessUrl:port.quickForwardAccessUrl,remoteProtocolAction:port.remoteProtocolAction,REMOTE_PROTOCOL_META:port.protocolMeta,refreshIcons:port.refreshIcons};
 const quick=createQuickCommandService({...port,read:key=>{try{return localStorage.getItem(key)}catch{return null}},write:(key,value)=>{try{localStorage.setItem(key,value)}catch{}},paint});
 function releaseBar(bar:HTMLElement) {
  const dispose=bars.get(bar);
  bars.delete(bar);
  dispose?.();
 }
 function releaseUnusedBars() {
  for (const bar of bars.keys()) {
   if (bar.isConnected) continue;
   if (dragOwner===bar) dragCleanup?.();
   if (!port.retainsQuickBar(bar)) releaseBar(bar);
  }
 }
 function releaseSurface(surface:ParentNode) {
  const bar=surface.querySelector<HTMLElement>(barSelector);
  if (bar) releaseBar(bar);
 }
 function paint(){releaseUnusedBars();for(const bar of bars.keys())paintQuickCommands(bar,quick,port.tr);for(const button of document.querySelectorAll<HTMLElement>('[data-terminal-quick-command-toggle]')){const label=port.tr(quick.visible()?'terminal:quick_commands.hide':'terminal:quick_commands.show');button.classList.toggle('active',quick.visible());button.title=label;button.setAttribute('aria-label',label);button.setAttribute('aria-pressed',String(quick.visible()));}port.toolbar();}
 const ordered=(list:HTMLElement)=>[...list.querySelectorAll<HTMLElement>('[data-terminal-quick-command-id]')].map(n=>Number(n.dataset.terminalQuickCommandId));
 function persist(list:HTMLElement){const ids=ordered(list),bar=list.closest<HTMLElement>('[data-terminal-quick-command-bar]');if(bar)releaseQuickCommands(bar);const work=quick.reorder(ids);quick.refresh();return work;}
 function moveKeyboard(handle:HTMLElement,direction:number){const button=handle.closest<HTMLElement>('[data-terminal-quick-command-id]'),list=button?.parentElement;if(!button||!list)return;const nodes=[...list.children],target=nodes[nodes.indexOf(button)+direction];if(!target)return;list.insertBefore(direction<0?button:target,direction<0?target:button);const id=button.dataset.terminalQuickCommandId,bar=button.closest<HTMLElement>('[data-terminal-quick-command-bar]');void persist(list);requestAnimationFrame(()=>bar?.querySelector<HTMLElement>(`[data-terminal-quick-command-id="${id}"] [data-terminal-quick-command-drag]`)?.focus());}
 function beginDrag(event:PointerEvent){const handle=(event.target as Element)?.closest<HTMLElement>('[data-terminal-quick-command-drag]'),button=handle?.closest<HTMLElement>('[data-terminal-quick-command-id]'),list=button?.parentElement;if(!handle||!button||!list||event.button!==0||dragCleanup)return;event.preventDefault();event.stopPropagation();let moved=false;const pointer=event.pointerId,startX=event.clientX,startY=event.clientY;button.classList.add('dragging');try{handle.setPointerCapture(pointer)}catch{}
  const move=(e:PointerEvent)=>{if(e.pointerId!==pointer||!barCurrent())return;if(!moved&&Math.hypot(e.clientX-startX,e.clientY-startY)<4)return;moved=true;const target=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-terminal-quick-command-id]');if(!target||target===button||target.parentElement!==list)return;const r=target.getBoundingClientRect(),before=e.clientY>=r.top&&e.clientY<=r.bottom?e.clientX<r.left+r.width/2:e.clientY<r.top+r.height/2;list.insertBefore(button,before?target:target.nextSibling);};
  const barCurrent=()=>button.isConnected&&list.isConnected;const cleanup=()=>{window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',finish,true);window.removeEventListener('pointercancel',finish,true);button.classList.remove('dragging');try{handle.releasePointerCapture(pointer)}catch{}dragCleanup=null;dragOwner=null;};
  const finish=(e:PointerEvent)=>{if(e.pointerId!==pointer)return;cleanup();if(e.type==='pointercancel'){const bar=button.closest<HTMLElement>('[data-terminal-quick-command-bar]');if(bar)releaseQuickCommands(bar);quick.refresh();return;}if(moved&&barCurrent()){suppress={id:Number(button.dataset.terminalQuickCommandId),until:Date.now()+500};void persist(list);}};dragOwner=button.closest<HTMLElement>('[data-terminal-quick-command-bar]');dragCleanup=cleanup;window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',finish,true);window.addEventListener('pointercancel',finish,true);
 }
 function menu(event:Event,key:string,id:number){port.menu(event,[{label:port.tr('terminal:quick_commands.execute_now'),icon:'play',run:()=>quick.run(key,id,'execute')},{label:port.tr('terminal:quick_commands.insert_only'),icon:'text-cursor-input',run:()=>quick.run(key,id,'insert')},{separator:true},{label:port.tr('terminal:quick_commands.edit'),icon:'pencil',run:()=>port.edit(id,true)},{label:port.tr('terminal:quick_commands.remove'),icon:'panel-bottom-close',run:()=>quick.remove(id)},{label:port.tr('terminal:quick_commands.delete'),icon:'trash-2',danger:true,run:()=>quick.remove(id,true)}]);}
 function mount(key:string,root:ParentNode=document){const bar=root.querySelector<HTMLElement>(`${barSelector}[data-terminal-key="${CSS.escape(key)}"]`)||root.querySelector<HTMLElement>(barSelector);if(!bar||bars.has(bar))return;bar.dataset.mounted='1';const cleanups:(()=>void)[]=[];const on=(name:string,listener:EventListener,options?:AddEventListenerOptions)=>{bar.addEventListener(name,listener,options);cleanups.push(()=>bar.removeEventListener(name,listener,options));};
  on('click',event=>{const target=event.target as Element;if(target.closest('[data-terminal-quick-command-manage]')){port.manage();return;}if(target.closest('[data-terminal-quick-command-drag]'))return;const id=Number(target.closest<HTMLElement>('[data-terminal-quick-command-id]')?.dataset.terminalQuickCommandId||0);if(id&&!(suppress.id===id&&suppress.until>Date.now()))void quick.run(key,id);});
  on('contextmenu',event=>{const id=Number((event.target as Element).closest<HTMLElement>('[data-terminal-quick-command-id]')?.dataset.terminalQuickCommandId||0);if(id)menu(event,key,id);});on('dblclick',event=>{if(!(event.target as Element).closest('button,[data-terminal-quick-command-resizer]'))port.edit(0,true);});
  on('keydown',event=>{const e=event as KeyboardEvent,target=event.target as Element;if(target.closest('[data-terminal-quick-command-resizer]')&&['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();quick.setHeight(quick.height()+(e.key==='ArrowUp'?12:-12));}else if(target.closest('[data-terminal-quick-command-drag]')&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();moveKeyboard(target.closest<HTMLElement>('[data-terminal-quick-command-drag]')!,['ArrowUp','ArrowLeft'].includes(e.key)?-1:1);}});
  on('pointerdown',event=>{const e=event as PointerEvent,handle=(e.target as Element).closest<HTMLElement>('[data-terminal-quick-command-resizer]');if(!handle){beginDrag(e);return;}if(e.button!==0||dragCleanup)return;e.preventDefault();const start=e.clientY,base=quick.height(),pointer=e.pointerId;bar.classList.add('resizing');const move=(m:PointerEvent)=>{if(m.pointerId===pointer)quick.setHeight(base+start-m.clientY);};const cleanup=()=>{bar.classList.remove('resizing');window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',finish,true);window.removeEventListener('pointercancel',finish,true);dragCleanup=null;dragOwner=null;};const finish=(m:PointerEvent)=>{if(m.pointerId!==pointer)return;cleanup();if(m.type==='pointercancel')quick.setHeight(base);};dragOwner=bar;dragCleanup=cleanup;window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',finish,true);window.addEventListener('pointercancel',finish,true);});
  on('wheel',event=>{const e=event as WheelEvent,list=bar.querySelector<HTMLElement>('[data-terminal-quick-command-list]')!;if(!bar.classList.contains('compact')||list.scrollWidth<=list.clientWidth+1)return;const delta=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY,can=delta<0?list.scrollLeft>0:list.scrollLeft+list.clientWidth<list.scrollWidth-1;if(delta&&can){e.preventDefault();list.scrollLeft+=delta;}},{passive:false});
  bars.set(bar,()=>{if(dragOwner===bar)dragCleanup?.();cleanups.forEach(run=>run());releaseQuickCommands(bar);delete bar.dataset.mounted;});paint();
 }
 const keydown=(event:KeyboardEvent)=>{if(event.repeat||event.isComposing)return;if((event.ctrlKey||event.metaKey)&&!event.shiftKey&&event.key.toLowerCase()==='k'){event.preventDefault();palette.open();}else if((event.ctrlKey||event.metaKey)&&event.shiftKey&&event.key.toLowerCase()==='t'){event.preventDefault();port.restore();}else if(event.key==='Escape'&&port.broadcasting())port.stopBroadcast();};
 const locale=()=>{paint();if(document.querySelector('#quickPanel')){syncQuickPanelLocalization(view);if(palette.state.visible)palette.refresh(palette.state.query,false);}};
 window.addEventListener('terma:language-changed',locale);const observer=new MutationObserver(releaseUnusedBars);observer.observe(document.body,{childList:true,subtree:true});
 return {palette:Object.assign(palette,{ensureView:()=>ensureQuickPanel(view),localize:()=>syncQuickPanelLocalization(view)}),quick:Object.assign(quick,{mount,releaseSurface,paint,persist,moveKeyboard,beginDrag,menu}),keyboard(){if(!keyboard){keyboard=true;document.addEventListener('keydown',keydown);}},dispose(){observer.disconnect();window.removeEventListener('terma:language-changed',locale);document.removeEventListener('keydown',keydown);dragCleanup?.();for(const bar of bars.keys())releaseBar(bar);palette.dispose();quick.dispose();}};
}
type Palette = ReturnType<typeof createRuntime>['palette'];

function registerPaletteActions(registry: EventRegistry, palette: () => Palette) {
  registry.register('quick-panel-run', ({event, dataset}) => {
    if (event.target instanceof Element && event.target.closest('button, a')) return;
    event.stopPropagation();
    palette().run(Number(dataset.index));
  });
  const connectionActions = {
    terminal: 'connection.terminal', sftp: 'connection.sftp', forward: 'connection.forwards'
  } as const;
  for (const [action, id] of Object.entries(connectionActions)) {
    registry.register(`quick-panel-connection-${action}`, ({event, dataset}) => {
      event.stopPropagation();
      const commands = palette();
      if (!commands.close()) return;
      return commands.runAction(id, {connectionId: Number(dataset.connectionId)});
    });
  }
  registry.register('quick-panel-remote-open', ({event, dataset}) => {
    event.stopPropagation();
    palette().run(Number(dataset.index));
  });
  registry.register('quick-panel-forward-open', ({event, dataset}) => {
    event.stopPropagation();
    if (!palette().close()) return;
    forwardsServices.termaForwardWorkspace.openConnection(Number(dataset.connectionId || 0), true, Number(dataset.forwardId || 0));
  });
  registry.register('quick-panel-remote-edit', ({event, dataset}) => {
    event.stopPropagation();
    if (palette().close()) return remoteServices.termaRemoteProfiles.editor.edit(Number(dataset.remoteProfileId));
  });
  registry.register('quick-panel-stop-propagation', ({event}) => event.stopPropagation());
}

export function installEfficiency(registry: EventRegistry) {
  let feature: ReturnType<typeof createRuntime> | undefined;
  const get = () => feature ||= createRuntime();
  efficiencyServices.termaEfficiency = {
    get palette() { return get().palette; },
    get quick() { return get().quick; },
    keyboard: () => get().keyboard()
  };
  registerPaletteActions(registry, () => get().palette);
  window.addEventListener('beforeunload', () => feature?.dispose(), {once: true});
}


export interface InstalledFeaturesEfficiencyEfficiencyRuntimeServices {
  termaEfficiency:{palette:ReturnType<typeof createRuntime>['palette'];quick:ReturnType<typeof createRuntime>['quick'];keyboard():void}
}
