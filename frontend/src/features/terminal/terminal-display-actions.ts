import {terminalServices} from '@/features/terminal/installed-services';
import {terminalSessions} from '@/features/terminal/terminal-session-state';
import {translate as tr} from '../../shared/i18n/runtime';
import {connectionStamp} from '../remote/management-types';
import type {TerminalPreferences} from './terminal-preferences-service';
import type {TerminalDisplayMenuAction} from './TerminalDisplayMenuView';
import {openDisplayMenu} from './terminal-controls-mount';
import {
  terminalActionConnection,terminalEncodingOptions,terminalSessionEncoding,
  localizedTerminalFontOptions,terminalFontFamilyForConnection,terminalFontOptions
} from './terminal-metadata';
import type {TerminalSurfaceSession} from './terminal-surface-service';

type Connection=NonNullable<ReturnType<typeof terminalActionConnection>>;
interface Target {connection:Connection;valid():boolean}
export interface TerminalDisplayPort {
  target(key:string,id:number):Target|null;
  encoding(key:string,connection:Connection):string;
  font(connection:Connection):string;
  fonts():readonly (readonly [string,string])[];
  apply(key:string,id:number,changes:Partial<TerminalPreferences>,message:string):Promise<unknown>;
  prompt(value:string):Promise<string|null>;
  focus(key:string):void;
  open(event:MouseEvent,actions:()=>TerminalDisplayMenuAction[]):boolean;
  text(key:string,params?:Record<string,unknown>):string;
}

export function createTerminalDisplayActions(port:TerminalDisplayPort){
  function encoding(event:MouseEvent,key:string,id:number){
    const target=port.target(key,id);if(!target)return;
    const current=port.encoding(key,target.connection);
    return port.open(event,()=>target.valid()?terminalEncodingOptions.map(([value,label])=>({
      key:`encoding-${value}`,label,icon:value===current?'check':'earth',selected:value===current,
      run:()=>target.valid()?port.apply(key,id,{terminal_encoding:value},port.text('terminal:notifications.encoding_changed',{encoding:label})):undefined
    })):[]);
  }
  function font(event:MouseEvent,key:string,id:number){
    const target=port.target(key,id);if(!target)return;
    const connection=target.connection,current=port.font(connection),height=Number(connection.terminal_line_height)||1,weight=connection.terminal_font_weight||'normal';
    const apply=(changes:Partial<TerminalPreferences>,message:string)=>target.valid()?port.apply(key,id,changes,message):undefined;
    const separator=():TerminalDisplayMenuAction=>({separator:true,label:''});
    return port.open(event,()=>target.valid()?[
      ...port.fonts().map(([value,label])=>({
        key:`font-${value}`,label,icon:value===current?'check':'type',selected:value===current,
        run:()=>apply({terminal_font_family:value,terminal_font_family_inherit:0},port.text('terminal:notifications.font_changed',{font:label}))
      })),
      separator(),
      {key:'custom-font',label:port.text('terminal:display.custom_font'),icon:'pencil',run:()=>custom(key,id,target)},
      separator(),
      ...([[1,'compact'],[1.2,'normal'],[1.4,'relaxed'],[1.6,'wide']] as const).map(([value,label])=>({
        key:`line-height-${value}`,label:port.text(`terminal:display.line_height_${label}`,{value}),
        icon:value===height?'check':'between-horizontal-start',selected:value===height,
        run:()=>apply({terminal_line_height:value},port.text('terminal:notifications.line_height_saved',{value}))
      })),
      separator(),
      ...([['normal','normal'],['500','medium'],['600','semibold'],['bold','bold']] as const).map(([value,label])=>({
        key:`font-weight-${value}`,label:port.text(`terminal:display.weight_${label}`),
        icon:value===weight?'check':'bold',selected:value===weight,
        run:()=>apply({terminal_font_weight:value},port.text('terminal:notifications.font_weight_saved',{weight:port.text(`terminal:display.weight_${label}`)}))
      })),
      separator(),
      {key:'reset-display',label:port.text('terminal:display.reset'),icon:'rotate-ccw',run:()=>reset(key,id,target)}
    ]:[]);
  }
  async function custom(key:string,id:number,target=port.target(key,id)){
    if(!target?.valid())return;
    const value=await port.prompt(target.connection.terminal_font_family||terminalFontOptions[0][0]);
    if(!target.valid())return;
    if(value)await port.apply(key,id,{terminal_font_family:value,terminal_font_family_inherit:0},port.text('terminal:notifications.custom_font_saved'));
    else port.focus(key);
  }
  async function reset(key:string,id:number,target=port.target(key,id)){
    if(target?.valid())await port.apply(key,id,{
      terminal_font_family_inherit:1,terminal_font_size_inherit:1,terminal_mobile_font_size_inherit:1,
      terminal_line_height:1,terminal_font_weight:'normal'
    },port.text('terminal:notifications.display_reset'));
  }
  return {encoding,font,custom,reset};
}
export const terminalDisplayActions=createTerminalDisplayActions({
  target:(key,id)=>{
    const connection=terminalActionConnection(key,id);if(!connection||connection.id!==id)return null;
    const session=terminalSessions.get(key),attempt=session?.connectionAttempt,socket=session?.socket,stamp=connectionStamp(connection);
    return {connection,valid:()=>{
      const current=terminalActionConnection(key,id);
      return terminalSessions.get(key)===session&&session?.connectionAttempt===attempt&&session?.socket===socket
        &&current?.id===id&&connectionStamp(current)===stamp;
    }};
  },
  encoding:terminalSessionEncoding,font:terminalFontFamilyForConnection,fonts:localizedTerminalFontOptions,
  apply:(key,id,changes,message)=>terminalServices.termaTerminalPreferences!.apply(key,id,changes,message),
  prompt:value=>terminalServices.termaTerminalViews!.promptFont({value,tr,titleKey:'terminal:display.custom_font_title',labelKey:'terminal:display.custom_font_label'}),
  focus:key=>terminalServices.termaTerminalSurface.focus(key),open:openDisplayMenu,text:tr
});


