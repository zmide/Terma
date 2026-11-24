import {snippetsServices} from '@/features/snippets/installed-services';
import { createSnippetHost } from './snippet-host';
import {showOperationsModal} from '../operations/operations-modal';
import {h} from 'vue';
import {TermaButton} from '@/shared/ui/TermaButton';
import type {ModalBinding} from '../operations/operations-types';
import * as model from './snippet-model';
import {createSnippetService} from './snippet-service';
import {snippetView} from './SnippetViews';
function createRuntime(){const port=createSnippetHost(open, id => service.state.items.some(row => row.id === id));let binding:ModalBinding|undefined,passwords:HTMLInputElement[]=[];const clear=()=>{passwords.forEach(n=>n.value='');passwords=[];};const service=createSnippetService(port,()=>{binding?.paint();passwords.forEach(n=>{if(!n.isConnected)n.value='';});passwords=[...document.querySelectorAll<HTMLInputElement>('.snippet-feature input[type=password]')];});
 function open(kind:'manager'|'editor'|'execute',id=0,options:Record<string,unknown>={}){clear();binding?.close();binding=undefined;port.beforeOpen();service.open(kind,id,options);binding=showOperationsModal(()=>snippetView(service,port),()=>{clear();binding=undefined;service.close();},()=>{if(service.state.confirmation){service.cancelConfirm();return true;}return false;});passwords=[...document.querySelectorAll<HTMLInputElement>('.snippet-feature input[type=password]')];}
 function prompt(name:string,initial:string,secret:boolean):Promise<string|null>{return new Promise(resolve=>{let value=initial,done=false;clear();binding?.close();port.beforeOpen();const finish=(answer:string|null)=>{if(done)return;done=true;value='';clear();binding?.close();binding=undefined;resolve(answer);};binding=showOperationsModal(()=>h('section',{class:'modal-card snippet-feature'},[h('h2',null,port.tr('terminal:snippets.variable_title')),h('label',{class:'snippet-field'},[h('span',null,name),h('input',{id:'snippetVariableValue',type:secret?'password':'text',value,autocomplete:'off',onInput:(event:Event)=>value=(event.target as HTMLInputElement).value})]),h('div',{class:'actions'},[h(TermaButton,{onClick:()=>finish(value)},()=>port.tr('common:actions.confirm')),h(TermaButton,{onClick:()=>finish(null)},()=>port.tr('common:actions.cancel'))])]),()=>finish(null));passwords=[...document.querySelectorAll<HTMLInputElement>('.snippet-feature input[type=password]')];});}
 async function expand(snippet:model.Snippet,connection:{ssh_host?:string;ssh_user?:string}|null=null,values:Record<string,string>|null=null,steps=true){const fixed=model.clean(snippet),w=model.workflow(fixed.workflow_json);const params=model.parameters(fixed.command,w),resolved=values?{...values}:Object.create(null) as Record<string,string>;const owner=port.scope();if(!values)for(const p of params){const value=await prompt(p.name,p.default,p.secret);if(value===null||!owner()||!port.unlocked())throw Error(port.tr('terminal:snippets.use_cancelled'));resolved[p.name]=value;}if(!steps)fixed.workflow_json=JSON.stringify({...w,steps:[]});return model.expand(fixed,connection,resolved,port.tr);}
 return {service,model,open,expand,navigate:port.navigate,dispose(){binding?.close();service.dispose();}};
}
export function installSnippets(){let feature:ReturnType<typeof createRuntime>|undefined;const get=()=>feature||=createRuntime();snippetsServices.termaSnippets={get service(){return get().service;},model,open:(...args)=>get().open(...args),navigate:(...args)=>get().navigate(...args),expand:(...args)=>get().expand(...args)};window.addEventListener('beforeunload',()=>feature?.dispose());}


export interface InstalledFeaturesSnippetsSnippetRuntimeServices {
  termaSnippets:{service:ReturnType<typeof createSnippetService>;model:typeof model;navigate:ReturnType<typeof createRuntime>['navigate'];open:ReturnType<typeof createRuntime>['open'];expand:ReturnType<typeof createRuntime>['expand']}
}
