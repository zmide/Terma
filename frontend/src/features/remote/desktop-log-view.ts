import type {DesktopTask} from './desktop-service';
export function createDesktopLogView(){
 let state={taskId:'',expanded:false,follow:true,scrollTop:0};const bound=new WeakSet<HTMLElement>();
 const reset=(id='')=>state={taskId:id,expanded:false,follow:true,scrollTop:0};
 const ensure=(task:DesktopTask)=>{if(state.taskId!==task.id)reset(task.id);return state;};
 const bottom=(node:HTMLElement)=>node.scrollHeight-node.scrollTop-node.clientHeight<=12;
 function capture(node:HTMLElement|null){if(!node)return;const id=node.dataset.taskId||'';if(state.taskId!==id)reset(id);state.expanded=node.classList.contains('expanded');state.follow=bottom(node);state.scrollTop=node.scrollTop;}
 function restore(node:HTMLElement|null,task:DesktopTask){if(!node)return;const current=ensure(task);node.classList.toggle('expanded',current.expanded);node.scrollTop=current.follow?node.scrollHeight:Math.min(current.scrollTop,Math.max(0,node.scrollHeight-node.clientHeight));current.scrollTop=node.scrollTop;
  if(bound.has(node))return;bound.add(node);node.addEventListener('scroll',()=>{if(state.taskId!==node.dataset.taskId)return;state.follow=bottom(node);state.scrollTop=node.scrollTop;},{passive:true});
 }
 function toggle(node:HTMLElement|null){if(!node)return;capture(node);state.expanded=!state.expanded;node.classList.toggle('expanded',state.expanded);if(state.follow){node.scrollTop=node.scrollHeight;state.scrollTop=node.scrollTop;}}
 return {reset,ensure,capture,restore,toggle};
}
