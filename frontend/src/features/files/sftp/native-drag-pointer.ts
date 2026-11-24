import type {DragEntry} from './drag-payload';
interface PointerState {
  pointerId:number;startX:number;startY:number;lastX?:number;lastY?:number;row:HTMLElement|null;
  sourceTabKey:string;connectionId:number;path:string;name:string;type:string;entries:DragEntry[];
  originalDraggable:string|null;timer:ReturnType<typeof setTimeout>|0;nativeRequestId:string;
  nativeReady:boolean;nativeStarted:boolean;activated:boolean;
}
interface PointerPort {
  mobile():boolean;mode():'streaming'|'staged'|false;timing():string;
  entries(path:string,name:string,type:string,key:string,select:boolean):DragEntry[];
  start(row:HTMLElement|null,id:number,entries:DragEntry[],key:string):string;
  activated(id:string):void;cancel(id:string):void;activate(id:string):void;
  stage(id:number,entries:DragEntry[]):Promise<unknown>;clear(row:HTMLElement|null):void;
  hint(key:string):void;preview(entries:DragEntry[],x:number,y:number):void;error(error:unknown):void;
}
interface PointerInput {pointerId:number;clientX:number;clientY:number;button:number;target:EventTarget|null;currentTarget:EventTarget|null}
export function createNativeDragPointer(port:PointerPort){
  let pointer:PointerState|null=null;
  function clear(options:{cancel?:boolean}={}){
    const current=pointer;if(!current)return;
    if(current.timer)clearTimeout(current.timer);
    document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',up,true);document.removeEventListener('pointercancel',cancel,true);
    if(current.originalDraggable===null)current.row?.removeAttribute('draggable');else current.row?.setAttribute('draggable',current.originalDraggable);
    pointer=null;
    if(options.cancel!==false&&current.nativeRequestId&&!current.nativeStarted){port.cancel(current.nativeRequestId);port.clear(current.row);}
  }
  function up(event:PointerEvent){if(pointer?.pointerId===event.pointerId&&!(pointer.activated&&pointer.nativeStarted))clear();}
  function cancel(event:PointerEvent){if(pointer?.pointerId===event.pointerId&&!(pointer.activated&&pointer.nativeRequestId))clear();}
  function activate(){
    const current=pointer;if(!current?.nativeRequestId||current.activated)return;
    current.activated=true;current.entries=port.entries(current.path,current.name,current.type,current.sourceTabKey,true);port.activated(current.nativeRequestId);
    current.row?.classList.remove('is-preparing-drag');current.row?.classList.add('is-dragging');document.body.classList.add('sftp-item-drag-active');
    port.hint(current.sourceTabKey);port.preview(current.entries,current.lastX??current.startX,current.lastY??current.startY);port.activate(current.nativeRequestId);
  }
  function move(event:PointerEvent){
    const current=pointer;if(!current||current.pointerId!==event.pointerId||current.activated)return;
    current.lastX=Number(event.clientX);current.lastY=Number(event.clientY);
    if(Number.isFinite(event.buttons)&&(event.buttons&1)===0){clear();return;}
    if(Math.hypot(event.clientX-current.startX,event.clientY-current.startY)<5)return;
    document.removeEventListener('pointermove',move,true);activate();
  }
  function prime(event:PointerInput,id:number,path:string,name:string,type:string,key:string){
    const target=event.target as HTMLElement|null,mode=port.mode();
    if(port.mobile()||event.button!==0||target?.closest?.('.sftp-check,.sftp-row-actions'))return;
    clear();const row=event.currentTarget as HTMLElement|null;
    const current:PointerState={pointerId:event.pointerId,startX:Number(event.clientX),startY:Number(event.clientY),row,sourceTabKey:key,connectionId:id,path,name,type,entries:port.entries(path,name,type,key,false),originalDraggable:row?.getAttribute('draggable')??null,timer:0,nativeRequestId:'',nativeReady:false,nativeStarted:false,activated:false};
    if(mode==='streaming'&&port.timing()==='pointerdown'){
      row?.setAttribute('draggable','false');pointer=current;
      document.addEventListener('pointermove',move,true);document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',cancel,true);
      current.nativeRequestId=port.start(row,id,current.entries,key)||'';
      if(!current.nativeRequestId)clear({cancel:false});return;
    }
    if(mode!=='staged')return;
    current.timer=setTimeout(()=>{
      if(pointer!==current)return;row?.classList.add('is-preparing-drag');
      void port.stage(id,current.entries).catch(port.error).finally(()=>row?.classList.remove('is-preparing-drag'));
    },180);
    pointer=current;document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',cancel,true);
  }
  return {prime,clear,up,cancel,move,activate,current:()=>pointer,
    ready(id:string){if(pointer?.nativeRequestId===id)pointer.nativeReady=true;},
    started(id:string){if(pointer?.nativeRequestId===id){pointer.nativeStarted=true;clear({cancel:false});}},
    release(id:string){if(pointer?.nativeRequestId===id)clear({cancel:false});},dispose:clear};
}
