export interface FileScrollState {scrollTop:number;scrollAtBottom:boolean}
export interface FileScrollPosition {top:number;atBottom:boolean;anchorPath?:string;anchorOffset?:number}
export function fileScrollCue(list:HTMLElement|null){if(list)list.classList.toggle('has-scroll-below',list.scrollHeight-list.scrollTop-list.clientHeight>2);}
export function captureFileScroll(state:FileScrollState,list:HTMLElement|null,anchor=false):FileScrollPosition{
  if(!list)return {top:state.scrollTop||0,atBottom:!!state.scrollAtBottom};
  const maximum=Math.max(0,list.scrollHeight-list.clientHeight),top=Math.max(0,Math.min(maximum,list.scrollTop));
  state.scrollTop=top;state.scrollAtBottom=maximum-top<=2;
  const position:FileScrollPosition={top,atBottom:state.scrollAtBottom};
  if(anchor){const listTop=list.getBoundingClientRect().top,row=[...list.querySelectorAll<HTMLElement>('.local-files-row[data-path]')].find(item=>item.getBoundingClientRect().bottom>listTop+1);if(row){position.anchorPath=row.dataset.path;position.anchorOffset=row.getBoundingClientRect().top-listTop;}}
  return position;
}
export function restoreFileScroll(state:FileScrollState,list:HTMLElement|null,position:FileScrollPosition|null){
  if(!list||!position)return;
  const anchor=position.anchorPath?[...list.querySelectorAll<HTMLElement>('.local-files-row[data-path]')].find(row=>row.dataset.path===position.anchorPath):null;
  if(anchor)list.scrollTop=Math.max(0,list.scrollTop+anchor.getBoundingClientRect().top-list.getBoundingClientRect().top-(position.anchorOffset||0));
  else list.scrollTop=Math.max(0,Math.min(Math.max(0,list.scrollHeight-list.clientHeight),position.top||0));
  captureFileScroll(state,list);fileScrollCue(list);
}
export function bindFileScroll(host:HTMLElement,state:()=>FileScrollState){
  const list=host.querySelector<HTMLElement>('.local-files-list');if(!list)return ()=>{};
  const scroll=()=>{captureFileScroll(state(),list);fileScrollCue(list);},resize=()=>fileScrollCue(list);
  list.addEventListener('scroll',scroll,{passive:true});const observer=new ResizeObserver(resize),mutation=new MutationObserver(resize);
  observer.observe(list);mutation.observe(list,{childList:true,subtree:true});fileScrollCue(list);
  return ()=>{list.removeEventListener('scroll',scroll);observer.disconnect();mutation.disconnect();};
}
