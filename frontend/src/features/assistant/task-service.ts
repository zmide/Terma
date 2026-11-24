import type {AssistantState} from './assistant-model';

export type TaskStatus='pending'|'running'|'success'|'completed'|'failed'|'skipped'|'waiting'|'needs-confirmation'|'stopped';
export interface TaskPlanItem {id:string;label:string;status:TaskStatus}
export interface TaskStep {id:string;kind:string;label:string;command:string;status:TaskStatus;startedAt:number;endedAt:number;checkpointId:string;error:string;risk:string}
export interface TaskCheckpoint {id:string;createdAt:number;reason:string;command:string;risk:string;blockCount:number;stepCount:number;outputHash:string;verified:boolean;backupCommand:string;rollbackCommand:string;backupStatus:string;rollbackStatus:string;backupNote:string;[key:string]:unknown}
export interface TaskRecord {id:string;title:string;prompt:string;status:TaskStatus;startedAt:number;updatedAt:number;activeStartedAt:number;durationMs:number;plan:TaskPlanItem[];planSource:'fallback'|'model';steps:TaskStep[];checkpoints:TaskCheckpoint[];contextSources:{source:string;title:string}[];error:string;resultSummary:string;[key:string]:unknown}
export interface TaskPort {
  state(key:string):AssistantState;
  id():string;
  now():number;
  tr(key:string,params?:Record<string,unknown>):string;
  persist(key:string,state:AssistantState):void;
  changed(key:string):void;
  strip(value:string):string;
  command(value:string):string;
  render(key:string):void;
}
const MAX_TASKS=20,MAX_STEPS=40,MAX_CHECKPOINTS=16,MAX_PLAN=20;
const statuses:TaskStatus[]=['pending','running','success','completed','failed','skipped','waiting','needs-confirmation','stopped'];
const status=(value:unknown):TaskStatus=>statuses.includes(String(value) as TaskStatus)?String(value) as TaskStatus:'pending';
const text=(value:unknown,max=100000)=>String(value||'').slice(0,max);
const hash=(value:string)=>{let result=2166136261;for(const ch of value){result^=ch.charCodeAt(0);result=Math.imul(result,16777619);}return(result>>>0).toString(16).padStart(8,'0');};
export function fallbackPlan(port:Pick<TaskPort,'tr'>,prompt:string):TaskPlanItem[]{const changing=/(deploy|install|fix|configure|restart|update|remove|删除|安装|修复|配置|重启|更新|卸载)/i.test(prompt);return[
  {id:'understand',label:port.tr('terminal:ai.task_plan_understand',{defaultValue:'理解任务并确认检查范围'}),status:'running'},
  {id:'inspect',label:port.tr('terminal:ai.task_plan_inspect',{defaultValue:'收集真实终端信息'}),status:'pending'},
  {id:'act',label:port.tr('terminal:ai.task_plan_act',{defaultValue:'执行必要的处理步骤'}),status:'pending'},
  {id:'verify',label:changing?port.tr('terminal:ai.task_plan_verify_change',{defaultValue:'验证变更结果并确认服务状态'}):port.tr('terminal:ai.task_plan_verify',{defaultValue:'核对结果并给出结论'}),status:'pending'}
]}
function normalizeTask(task:unknown,port:TaskPort):TaskRecord|null{if(!task||typeof task!=='object')return null;const value=task as Record<string,unknown>;const id=text(value.id,200);if(!id)return null;return{
  ...value,id,title:port.strip(text(value.title,240)),prompt:port.strip(text(value.prompt,6000)),status:status(value.status || 'completed'),startedAt:Number(value.startedAt)||0,updatedAt:Number(value.updatedAt)||0,activeStartedAt:Number(value.activeStartedAt)||0,durationMs:Math.max(0,Number(value.durationMs)||0),
  plan:Array.isArray(value.plan)?value.plan.slice(0,MAX_PLAN).map((item:any)=>({id:text(item?.id,80),label:port.strip(text(item?.label,240)),status:status(item?.status)})):[],planSource:value.planSource==='model'?'model':'fallback',
  steps:Array.isArray(value.steps)?value.steps.slice(-MAX_STEPS).map((item:any)=>({id:text(item?.id,200),kind:text(item?.kind,40)||'action',label:port.strip(text(item?.label||item?.command,240)),command:port.command(item?.command),status:status(item?.status),startedAt:Number(item?.startedAt)||0,endedAt:Number(item?.endedAt)||0,checkpointId:text(item?.checkpointId,200),error:port.strip(text(item?.error,400)),risk:port.strip(text(item?.risk,240))})):[],
  checkpoints:Array.isArray(value.checkpoints)?value.checkpoints.slice(0,MAX_CHECKPOINTS).map((item:any)=>({id:text(item?.id,200),createdAt:Number(item?.createdAt)||0,reason:port.strip(text(item?.reason,160)),command:port.command(item?.command),risk:port.strip(text(item?.risk,240)),blockCount:Number(item?.blockCount)||0,stepCount:Number(item?.stepCount)||0,outputHash:text(item?.outputHash,32),verified:item?.verified===true,backupCommand:port.command(item?.backupCommand),rollbackCommand:port.command(item?.rollbackCommand),backupStatus:text(item?.backupStatus,32)||'none',rollbackStatus:text(item?.rollbackStatus,32)||'none',backupNote:port.strip(text(item?.backupNote,240))})):[],
  contextSources:Array.isArray(value.contextSources)?value.contextSources.slice(0,8).map((item:any)=>({source:text(item?.source,40),title:port.strip(text(item?.title,120))})):[],error:port.strip(text(value.error,500)),resultSummary:port.strip(text(value.resultSummary,360))
}}
export function createTaskService(port:TaskPort){
  const normalized=new WeakMap<AssistantState,unknown[]>();
  function ensureState(state: AssistantState) {
    if (normalized.get(state) === state.agentTasks) return state;
    const rows = normalize(state.agentTasks);
    state.agentTasks = rows;
    normalized.set(state, rows);
    return state;
  }
  const stateTasks = (key: string) => ensureState(port.state(key));
  const forState=(state:AssistantState,id:string)=>(ensureState(state).agentTasks as TaskRecord[]).find(item=>String(item.id)===String(id))||null;
  const task=(key:string,id:string)=>forState(stateTasks(key),id);
  const persist=(key:string,state:AssistantState)=>{port.persist(key,state);port.changed(key);if(state.open)port.render(key);};
  function begin(key:string,prompt:string,contexts:unknown[]=[],existingId=''){const state=stateTasks(key);const now=port.now();const existing=existingId?task(key,existingId):null;if(existing){existing.status='running';existing.error='';existing.updatedAt=now;existing.resumedAt=now;existing.activeStartedAt=now;existing.endedAt=0;for(const item of existing.plan)if(['failed','stopped','waiting','needs-confirmation'].includes(item.status))item.status='pending';const next=existing.plan.find(item=>item.status==='pending');if(next)next.status='running';state.activeTaskId=existing.id;persist(key,state);return existing;}
    const record:TaskRecord={id:port.id(),title:port.strip(prompt).replace(/\s+/g,' ').trim().slice(0,72)||port.tr('terminal:ai.new_session',{defaultValue:'新会话'}),prompt:port.strip(prompt).slice(0,6000),status:'running',startedAt:now,updatedAt:now,activeStartedAt:now,durationMs:0,plan:fallbackPlan(port,prompt),planSource:'fallback',steps:[],checkpoints:[],contextSources:(Array.isArray(contexts)?contexts:[]).slice(0,8).map((item:any)=>({source:text(item?.source,40),title:port.strip(text(item?.title,120))})),error:'',resultSummary:''};const rows=state.agentTasks as TaskRecord[];rows.unshift(record);for(let index=rows.length-1;index>=MAX_TASKS;index--)rows.splice(index,1);state.activeTaskId=record.id;persist(key,state);return record;}
  function addStep(key:string,taskId:string,input:Partial<TaskStep>={}){const state=stateTasks(key),record=task(key,taskId);if(!record)return null;const step:TaskStep={id:port.id(),kind:text(input.kind,40)||'action',label:port.strip(text(input.label||input.command,240)),command:port.command(input.command||''),status:status(input.status),startedAt:0,endedAt:0,checkpointId:text(input.checkpointId,200),error:port.strip(text(input.error,400)),risk:port.strip(text(input.risk,240))};record.steps=[...record.steps,step].slice(-MAX_STEPS);record.updatedAt=port.now();if(step.kind==='command'){const inspect=record.plan.find(item=>item.id==='inspect'),understand=record.plan.find(item=>item.id==='understand');if(understand?.status==='running')understand.status='success';if(inspect?.status==='pending')inspect.status='running';}persist(key,state);return step;}
  function updateStep(key:string,taskId:string,stepId:string,patch:Partial<TaskStep>){const state=stateTasks(key),record=task(key,taskId),step=record?.steps.find(item=>item.id===stepId);if(!record||!step)return null;Object.assign(step,patch);if(patch.status==='running'&&!step.startedAt)step.startedAt=port.now();if(patch.status&&['success','completed','failed','stopped','skipped','waiting','needs-confirmation'].includes(patch.status))step.endedAt=port.now();record.updatedAt=port.now();if(step.kind==='command'){const inspect=record.plan.find(item=>item.id==='inspect'),act=record.plan.find(item=>item.id==='act');if(['success','completed'].includes(patch.status||'')){if(inspect?.status==='running')inspect.status='success';if(act?.status==='pending')act.status='running';}if(patch.status==='failed'&&act&&(act.status==='pending'||act.status==='running'))act.status='failed';if(['waiting','needs-confirmation'].includes(patch.status||'')&&act&&(act.status==='pending'||act.status==='running'))act.status='waiting';}persist(key,state);return step;}
  function prepareAction(key:string,taskId:string,input:Partial<TaskStep>={}){const step=addStep(key,taskId,input);if(!step)return null;updateStep(key,taskId,step.id,{status:'running'});return step;}
  function completeAction(key:string,taskId:string,step:TaskStep|null,next:TaskStatus,error=''){if(step)updateStep(key,taskId,step.id,{status:next,error});}
  function checkpoint(key:string,taskId:string,command:string,risk:Partial<TaskCheckpoint>={}){const state=stateTasks(key),record=task(key,taskId);if(!record)return null;const blocks=Array.isArray(state.blocks)?state.blocks.slice(-8):[];const item:TaskCheckpoint={id:port.id(),createdAt:port.now(),reason:port.strip(text(risk.reason,160))||port.tr('terminal:ai.task_checkpoint_before_change',{defaultValue:'高风险操作前'}),command:port.command(command),risk:port.strip(text(risk.risk,240)),blockCount:state.blocks.length,stepCount:record.steps.length,outputHash:hash(JSON.stringify(blocks.map((b:any)=>({id:b?.id,command:b?.command,output:hash(port.strip(b?.output||''))})))),verified:false,backupCommand:port.command(risk.backupCommand||''),rollbackCommand:port.command(risk.rollbackCommand||''),backupStatus:text(risk.backupStatus,32)||'pending',rollbackStatus:text(risk.rollbackStatus,32)||'none',backupNote:port.strip(text(risk.backupNote,240))};record.checkpoints=[item,...record.checkpoints].slice(0,MAX_CHECKPOINTS);record.updatedAt=port.now();persist(key,state);return item;}
  function recordAnswer(key:string,taskId:string,answer:string){const state=stateTasks(key),record=task(key,taskId);if(!record)return;const source=port.strip(answer).split('```')[0].slice(0,1800);const body=source.match(/(?:计划|执行计划|步骤|plan|steps)\s*[:：]?([\s\S]*)/i)?.[1]||source;const labels=body.split(/\r?\n/).map(line=>(line.match(/^(?:\d+[.)]|[-*])\s+(.+)$/)||[])[1]||'').map(item=>item.replace(/[_*]/g,'').replace(/\s+/g,' ').trim().slice(0,180)).filter(item=>item.length>=4).slice(0,MAX_PLAN);if(labels.length>=2&&record.planSource==='fallback'){record.plan=labels.map((label,index)=>({id:'model-'+(index+1),label,status:index===0?'running':'pending'}));record.planSource='model';}record.updatedAt=port.now();persist(key,state);}
  function summarizeAnswer(answer: string) {
    const source = port.strip(answer).replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim();
    const fragments = source.match(/[^。！？.!?]+(?:[。！？]|[.!?](?=\s|$)|$)/g) || [source];
    const last = fragments.slice().reverse().find(item => !/^(?:计划|执行计划|步骤|plan|steps)\b/i.test(item.trim()));
    return (last || fragments.at(-1) || '').replace(/^[#>*\-\d.)\s]+/, '').trim().slice(0, 360);
  }

  function settleTime(record: TaskRecord, now: number) {
    if (record.activeStartedAt) {
      record.durationMs += Math.max(0, now - record.activeStartedAt);
      record.activeStartedAt = 0;
    }
    record.updatedAt = now;
    record.endedAt = now;
  }

  function finish(key: string, taskId: string, error = '') {
    const state = stateTasks(key);
    const record = task(key, taskId);
    if (!record) return;
    const waiting = state.agentWaitingForInput as {taskId?: string; blockId?: string} | null;
    if (error) {
      record.status = 'failed';
      record.error = port.strip(error).slice(0, 500);
    } else if (waiting && (waiting.taskId === record.id || (waiting.blockId && waiting.blockId === state.blocks.at(-1)?.id))) {
      record.status = 'waiting';
    } else if (!['stopped', 'failed', 'waiting'].includes(record.status)) {
      record.status = 'completed';
      record.error = '';
    }
    if (record.status === 'completed') {
      const turn = state.turns.slice().reverse().find(item => item.taskId === record.id && item.answer?.trim());
      if (turn) record.resultSummary = summarizeAnswer(turn.answer);
      for (const item of record.plan) {
        if (item.status === 'running') item.status = 'success';
        else if (item.status === 'pending') item.status = 'skipped';
      }
      const last = record.plan.at(-1);
      if (last) last.status = 'success';
      const step = record.steps.at(-1);
      if (step && ['pending', 'running'].includes(step.status)) step.status = 'success';
    } else {
      record.resultSummary = '';
      if (record.status === 'failed') {
        const active = record.plan.find(item => ['running', 'pending'].includes(item.status));
        if (active) active.status = 'failed';
      }
    }
    settleTime(record, port.now());
    persist(key, state);
  }

  function stop(key: string) {
    const state = stateTasks(key);
    const record = state.activeTaskId ? task(key, state.activeTaskId) : null;
    if (!record || record.status !== 'running') return;
    const now = port.now();
    record.status = 'stopped';
    record.error = port.tr('terminal:ai.task_stopped_detail', {defaultValue:'任务被用户停止，已保留已执行步骤和检查点。'});
    for (const item of record.plan) if (['pending', 'running'].includes(item.status)) item.status = 'stopped';
    const current = record.steps.find(item => ['pending', 'running'].includes(item.status));
    if (current) {
      current.status = 'stopped';
      current.endedAt = now;
    }
    settleTime(record, now);
    persist(key, state);
  }
  function attemptedForState(state:AssistantState,taskId:string){const record=forState(state,taskId);return new Set((record?.steps||[]).filter(item=>item.kind==='command'&&item.command).map(item=>item.command.trim()));}
  const attempted=(key:string,taskId:string)=>attemptedForState(stateTasks(key),taskId);
  function normalize(value: unknown): TaskRecord[] {
    const rows: TaskRecord[] = [];
    for (const item of Array.isArray(value) ? value : []) {
      const record = normalizeTask(item, port);
      if (record) rows.push(record);
      if (rows.length === MAX_TASKS) break;
    }
    return rows;
  }
  return {ensureState,forState,attemptedForState,begin,task,addStep,updateStep,prepareAction,completeAction,checkpoint,recordAnswer,finish,stop,attempted,normalize,serialize(value:unknown){return normalize(value).map(item=>({...item,activeStartedAt:0,steps:item.steps.map(step=>({...step,command:port.command(step.command)})),checkpoints:item.checkpoints.map(item=>({...item,command:port.command(item.command),backupCommand:port.command(item.backupCommand),rollbackCommand:port.command(item.rollbackCommand)}))}));}};
}
