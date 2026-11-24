import {workspaceServices} from '@/features/workspace/installed-services';
export const $=(id:string):HTMLElement|null=>{
 const scope=workspaceServices.termaWorkspacePaneScope?.currentWorkspaceDomScope();
 return scope?.querySelector<HTMLElement>('#'+CSS.escape(id))||document.getElementById(id);
};
