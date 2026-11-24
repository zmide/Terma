import {batchServices} from '@/features/batch/installed-services';
import {createBatchViews} from './BatchViews';
import {dangerousCommand} from './batch-model';
import type {BatchPort} from './batch-model';
let feature:ReturnType<typeof createBatchViews>|null=null;
type BatchWorkspace = { open(update?:boolean):void; renderExplorer(options?:{reload?:boolean}):Promise<unknown> };
export function installBatchViews(port:BatchPort, workspace:BatchWorkspace){const current=()=>feature||(feature=createBatchViews(port));batchServices.termaBatch={...workspace,mountPage:target=>current().mountPage(target),mountList:target=>current().mountList(target),mountTools:target=>current().mountTools(target),service:key=>current().service(key),templates:()=>current().templates,templateEditor:id=>current().templateEditor(current().templates.model.items.find(v=>v.id===String(id))),refresh:()=>feature?.refresh(),dispose:key=>feature?.dispose(key),context:event=>current().context(event,current().service()),hideContext:()=>feature?.clearMenu(),release:()=>feature?.release(),dangerous:dangerousCommand};}


export interface InstalledFeaturesBatchBatchMountServices {
  termaBatch:BatchWorkspace & {mountPage:ReturnType<typeof createBatchViews>['mountPage'];mountList:ReturnType<typeof createBatchViews>['mountList'];mountTools:ReturnType<typeof createBatchViews>['mountTools'];service:ReturnType<typeof createBatchViews>['service'];templates():ReturnType<typeof createBatchViews>['templates'];templateEditor(id?:string):void;refresh():void;dispose(key:string):void;context(event:MouseEvent):void;hideContext():void;release():void;dangerous:typeof dangerousCommand}
}
