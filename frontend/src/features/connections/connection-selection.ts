import {connectionsServices} from '@/features/connections/installed-services';
import type {ApplicationConnection} from '../../shared/application-state';
export function currentConnection(id?:number|null){return connectionsServices.termaConnectionController!.current(id??undefined) as ApplicationConnection|undefined;}
export function selectConnection(id:number,options:Parameters<NonNullable<(typeof connectionsServices)['termaConnectionController']>['select']>[1]={}){return connectionsServices.termaConnectionController!.select(id,options) as ApplicationConnection|undefined;}
export function noteConnectionUsage(id:number,action='open'){return connectionsServices.termaConnectionList!.noteUsage(id,action);}
