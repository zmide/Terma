import type {AutomationActions,AutomationModel} from './automation-types';

export function automationSort(model:AutomationModel,actions:AutomationActions){
  let cancel:(()=>void)|null=null;
  const ids=()=>model.items.map(item=>item.id);
  function keyboard(event:KeyboardEvent,id:number){
    if(model.sortBusy||model.busy.size||!['ArrowUp','ArrowDown'].includes(event.key))return;
    const order=ids(),index=order.indexOf(id),target=index+(event.key==='ArrowUp'?-1:1);
    if(index<0||target<0||target>=order.length)return;event.preventDefault();
    [order[index],order[target]]=[order[target],order[index]];
    const handle=event.currentTarget as HTMLElement;void actions.reorder(order).then(()=>{if(handle.isConnected)handle.focus({preventScroll:true});});
  }
  function begin(event:PointerEvent){
    const handle=event.currentTarget as HTMLElement,row=handle.closest<HTMLElement>('[data-sftp-automation-id]'),list=row?.parentElement;
    if(!row||!list||event.button!==0||cancel||model.sortBusy||model.busy.size)return;
    event.preventDefault();handle.focus({preventScroll:true});const original=ids(),pointer=event.pointerId,start=event.clientY;let moved=false;
    actions.sorting(true);row.classList.add('dragging');list.classList.add('sorting');
    const restore=()=>{const rows=new Map([...list.children].map(child=>[Number((child as HTMLElement).dataset.sftpAutomationId),child]));original.forEach(id=>{const node=rows.get(id);if(node)list.append(node);});};
    const move=(next:PointerEvent)=>{
      if(next.pointerId!==pointer||!row.isConnected)return;if(!moved&&Math.abs(next.clientY-start)<4)return;moved=true;
      const target=[...list.querySelectorAll<HTMLElement>(':scope > [data-sftp-automation-id]')].find(node=>{const rect=node.getBoundingClientRect();return node!==row&&next.clientY>=rect.top&&next.clientY<=rect.bottom;});
      if(target){const rect=target.getBoundingClientRect();list.insertBefore(row,next.clientY<rect.top+rect.height/2?target:target.nextSibling);}
      const bounds=list.getBoundingClientRect();if(next.clientY<bounds.top+36)list.scrollTop-=24;else if(next.clientY>bounds.bottom-36)list.scrollTop+=24;
    };
    const cleanup=()=>{window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',finish,true);window.removeEventListener('pointercancel',finish,true);row.classList.remove('dragging');list.classList.remove('sorting');cancel=null;};
    const finish=(next:PointerEvent)=>{if(next.pointerId!==pointer)return;const order=[...list.children].map(node=>Number((node as HTMLElement).dataset.sftpAutomationId));cleanup();if(moved)restore();actions.sorting(false);if(next.type!=='pointercancel'&&moved)void actions.reorder(order).then(()=>{if(handle.isConnected)handle.focus({preventScroll:true});});else if(handle.isConnected)handle.focus({preventScroll:true});};
    cancel=()=>{cleanup();restore();actions.sorting(false);};window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',finish,true);window.addEventListener('pointercancel',finish,true);
  }
  return {begin,keyboard,dispose(){cancel?.();}};
}
