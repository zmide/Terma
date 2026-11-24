import type {PreviewDrag} from './drag-preview';

interface FeedbackDrag extends PreviewDrag {nativeStarted?:boolean;row?:HTMLElement|null}
interface FeedbackPort {
  drag():FeedbackDrag|null;
  visible():boolean;
  nativeActive():boolean;
  clearVisuals(row?:HTMLElement):void;
  restore(drag?:FeedbackDrag|null):void;
  reset(row?:EventTarget|null):void;
}
const STALE=900;
const VISIBLE_FEEDBACK='.sftp-drop-overlay:not([hidden]), .terminal-drop-overlay:not([hidden]), .local-files-drop-overlay:not([hidden]), #sftpDragHint, #sftpDragPreview, .tab.sftp-drop-target';
interface DragVisualPort {
  cancelLeave():void;clearTabPreview():void;resetDropDepth():void;
  clearExternalDrop():void;removePointerPreview():void;clearTerminals():void;
}
/** Clears transient renderer surfaces without cancelling native requests or file jobs. */
export function createDragVisuals(port:DragVisualPort){
  function visible(){return Boolean(document.body?.classList.contains('sftp-item-drag-active')||document.querySelector(VISIBLE_FEEDBACK));}
  function clear(row?:HTMLElement|null){
    port.cancelLeave();
    row?.classList.remove('is-dragging','is-preparing-drag');
    document.querySelectorAll('.sftp-row.is-dragging, .sftp-row.is-preparing-drag').forEach(item=>item.classList.remove('is-dragging','is-preparing-drag'));
    document.body?.classList.remove('sftp-item-drag-active');
    document.querySelectorAll('.tab.sftp-drop-target').forEach(tab=>tab.classList.remove('sftp-drop-target'));
    port.clearTabPreview();port.resetDropDepth();port.clearExternalDrop();port.removePointerPreview();
    document.querySelectorAll<HTMLElement>('.local-files-drop-overlay').forEach(overlay=>{overlay.hidden=true;});
    port.clearTerminals();
  }
  return {visible,clear};
}
/** Renderer feedback expires independently from native drag and transfer jobs. */
export function createDragFeedback(port:FeedbackPort){
  let watchdog:ReturnType<typeof setTimeout>|0=0,lastActivity=0,bound=false,disposed=false,generation=0;
  const deferred=new Set<ReturnType<typeof setTimeout>>();
  const frames=new Set<number>();
  function clear(){generation++;if(watchdog)clearTimeout(watchdog);watchdog=0;lastActivity=0;port.clearVisuals();}
  function check(){
    watchdog=0;if(disposed||!port.visible())return;
    const age=Date.now()-lastActivity;
    if(age<STALE){watchdog=setTimeout(check,STALE-age+80);return;}
    port.restore(port.drag());clear();
  }
  function activity(){if(disposed)return;generation++;lastActivity=Date.now();if(!watchdog)watchdog=setTimeout(check,STALE+80);}
  function later(callback:()=>void){const timer=setTimeout(()=>{deferred.delete(timer);if(!disposed)callback();},0);deferred.add(timer);}
  function finish(event:Event){
    const drag=port.drag();
    if(drag&&!drag.nativeStarted){if(!drag.dropAccepted)port.restore(drag);port.reset(event.target||drag.row);}
    else port.restore();
    const expected=generation;
    later(()=>{if(expected===generation&&(!port.drag()||port.drag()===drag))clear();});
  }
  function drop(){
    const previous=port.drag(),expected=generation;
    later(()=>{
      const drag=port.drag();if(expected!==generation||drag&&drag!==previous)return;
      if(drag&&!drag.nativeStarted&&!drag.dropAccepted){port.restore(drag);port.reset(drag.row);}
      else if(!drag)port.restore();
      clear();
    });
  }
  function visibility(){if(document.hidden){port.restore(port.drag());clear();}}
  function blur(){if(port.nativeActive())activity();else{port.restore(port.drag());clear();}}
  function resize(){if(port.visible()){const expected=generation;const frame=requestAnimationFrame(()=>{frames.delete(frame);if(!disposed&&expected===generation)clear();});frames.add(frame);}}
  function bind(){
    if(bound||disposed)return;bound=true;
    document.addEventListener('dragend',finish,true);window.addEventListener('dragend',finish,true);
    document.addEventListener('drop',drop,true);document.addEventListener('visibilitychange',visibility);
    window.addEventListener('blur',blur);window.addEventListener('resize',resize);
  }
  function dispose(){
    disposed=true;if(bound){
      document.removeEventListener('dragend',finish,true);window.removeEventListener('dragend',finish,true);
      document.removeEventListener('drop',drop,true);document.removeEventListener('visibilitychange',visibility);
      window.removeEventListener('blur',blur);window.removeEventListener('resize',resize);
    }
    for(const timer of deferred)clearTimeout(timer);deferred.clear();
    for(const frame of frames)cancelAnimationFrame(frame);frames.clear();bound=false;clear();
  }
  return {activity,clear,check,bind,dispose};
}
