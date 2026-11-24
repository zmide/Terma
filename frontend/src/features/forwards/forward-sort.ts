/** A drag owns its listeners and timer until pointer-up, cancellation or view disposal. */
export function forwardSort(){
  let cancel=()=>{},sorting=false;
  function begin(event:PointerEvent,handle:HTMLElement,save:(values:string[])=>Promise<unknown>,done:()=>void){
    if(event.button!==0||sorting)return;cancel();const node=handle.closest<HTMLElement>('[data-forward-sort-key]'),container=node?.parentElement;if(!node||!container)return;
    const original=[...container.children],pointer=event.pointerId;let active=false;
    const timer=setTimeout(()=>{active=true;sorting=true;node.classList.add('is-dragging');try{handle.setPointerCapture(pointer);}catch{/* A detached handle is cancelled below. */}},220);
    const move=(e:PointerEvent)=>{if(e.pointerId!==pointer)return;if(!active&&Math.hypot(e.clientX-event.clientX,e.clientY-event.clientY)>8){cancel();return;}if(!active)return;e.preventDefault();const target=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-forward-sort-key]');if(target&&target!==node&&target.parentElement===container){const rect=target.getBoundingClientRect();container.insertBefore(node,e.clientY<rect.top+rect.height/2?target:target.nextSibling);}const workspace=node.closest<HTMLElement>('.workspace');const rect=workspace?.getBoundingClientRect();if(workspace&&rect){if(e.clientY<rect.top+48)workspace.scrollBy({top:-18});else if(e.clientY>rect.bottom-48)workspace.scrollBy({top:18});}};
    const cleanup=()=>{clearTimeout(timer);document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',abort);node.classList.remove('is-dragging');try{if(handle.hasPointerCapture(pointer))handle.releasePointerCapture(pointer);}catch{/* Detached capture. */}sorting=false;cancel=()=>{};};
    const up=(e:PointerEvent)=>{if(e.pointerId!==pointer)return;const values=[...container.children].map(n=>(n as HTMLElement).dataset.forwardSortKey||'');cleanup();if(active){original.forEach(n=>container.appendChild(n));void save(values).finally(()=>{done();if(handle.isConnected)handle.focus({preventScroll:true});});}else done();};
    const abort=(e:PointerEvent)=>{if(e.pointerId===pointer)cancel();};
    cancel=()=>{cleanup();if(active)original.forEach(n=>container.appendChild(n));done();};
    document.addEventListener('pointermove',move,{passive:false});document.addEventListener('pointerup',up);document.addEventListener('pointercancel',abort);
  }
  return {begin,active:()=>sorting,dispose:()=>cancel()};
}
