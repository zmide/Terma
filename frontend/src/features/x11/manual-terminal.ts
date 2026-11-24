import type {X11Port} from './x11-types';
const quote=(value:string)=>`'${value.replace(/'/g,`'"'"'`)}'`;
export function openX11Manual(port:X11Port,id:number,command:string,kind:'install'|'configure'|'guide',action='',remoteXQuartz=false){
 const c=port.connection(id),t=port.tr;if(!c||!port.unlocked(t('common:x11.manager')))return;
 if(c.quick_connection){const key=port.sessionKey(id),session=port.session(key);if(!session?.connected)return port.notify(t('common:x11.quick_terminal_not_connected'),'error');port.activate(key);if(command){if(!port.send(key,command))return port.notify(t('common:x11.quick_terminal_write_failed'),'error');port.notify(t(kind==='configure'?'common:x11.config_command_sent':'common:x11.install_command_sent'),'info');}else{port.focus(key);port.notify(t('common:x11.returned_to_quick_terminal'),'info');}return key;}
 const label=t(kind==='configure'?(action==='enable'?'common:x11.enable_ssh_forwarding':'common:x11.disable_ssh_forwarding'):kind==='guide'?'common:x11.install_guide':remoteXQuartz?'common:x11.remote_xquartz_install':'common:x11.component_install');
 const finished=t(kind==='configure'?'common:x11.config_terminal_finished':'common:x11.install_terminal_finished',{action:label}),prompt=t('common:x11.manual_install_terminal_prompt'),marker=finished.indexOf('%s');
 const completion=kind==='configure'&&marker>=0?`terma_status=$?; printf '\\n\\n%s%s%s\\n' ${quote(finished.slice(0,marker))} "$terma_status" ${quote(finished.slice(marker+2))}`:`printf '\\n\\n%s\\n' ${quote(finished)}`;
 const script=command?`${command}; ${completion}; exec "${'${SHELL:-/bin/sh}'}"`:`printf '%s\\n' ${quote(prompt)}; exec "${'${SHELL:-/bin/sh}'}"`;
 const key=port.next(id);port.override(key,{terminal_startup_mode:'program',terminal_profile_name:label,terminal_profile_kind:'tool',terminal_program_path:'/bin/sh',terminal_program_args:`-lc ${JSON.stringify(script)}`,terminal_working_directory:'',terminal_program_platform:'posix',x11_mode:kind==='configure'?'off':c.x11_mode==='trusted'?'trusted':'untrusted'});return port.openTerminal(id,key,`${c.name} · ${label}`);
}
