export interface TaskLogState {expanded:boolean;openedOnce:boolean;follow:boolean;scrollTop:number}
export function taskLogAtBottom(log:HTMLElement|null){return !log||log.scrollHeight-log.scrollTop-log.clientHeight<=12;}
export function restoreTaskLogScroll(log:HTMLElement|null,state:TaskLogState){
  if(!log)return;
  log.scrollTop=state.follow?log.scrollHeight:Math.min(state.scrollTop,Math.max(0,log.scrollHeight-log.clientHeight));
  state.scrollTop=log.scrollTop;
}
/** Retains task log reading position while Vue updates the task list. */
export function createTaskLogView(){
  const states=new Map<string,TaskLogState>();
  let bindings:(()=>void)[]=[];
  function ensure(id:unknown){
    const key=String(id||'');let state=states.get(key);
    if(!state){state={expanded:false,openedOnce:false,follow:true,scrollTop:0};states.set(key,state);}return state;
  }
  function capture(root:HTMLElement|null){
    root?.querySelectorAll<HTMLDetailsElement>('.global-task-log[data-task-id]').forEach(details=>{
      const state=ensure(details.dataset.taskId),log=details.querySelector('pre');state.expanded=details.open;
      if(!log||!details.open)return;
      state.follow=!state.openedOnce||taskLogAtBottom(log);state.openedOnce=true;
      if(state.follow)log.scrollTop=log.scrollHeight;state.scrollTop=log.scrollTop;
    });
  }
  function unbind(){for(const release of bindings)release();bindings=[];}
  function bind(root:HTMLElement|null){
    unbind();
    root?.querySelectorAll<HTMLDetailsElement>('.global-task-log[data-task-id]').forEach(details=>{
      const state=ensure(details.dataset.taskId),log=details.querySelector('pre');details.open=state.expanded;
      const toggle=()=>{
        const first=details.open&&!state.openedOnce;state.expanded=details.open;
        if(!details.open||!log)return;
        if(first){state.openedOnce=true;state.follow=true;}restoreTaskLogScroll(log,state);
      };
      const scroll=()=>{if(log){state.follow=taskLogAtBottom(log);state.scrollTop=log.scrollTop;}};
      details.addEventListener('toggle',toggle);log?.addEventListener('scroll',scroll,{passive:true});
      bindings.push(()=>{details.removeEventListener?.('toggle',toggle);log?.removeEventListener?.('scroll',scroll);});
      if(details.open&&log){state.openedOnce=true;restoreTaskLogScroll(log,state);}
    });
  }
  return {ensure,capture,bind,atBottom:taskLogAtBottom,restore:restoreTaskLogScroll,dispose(){unbind();states.clear();}};
}
