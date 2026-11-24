export type ExternalToolKind='ssh'|'sftp';
export interface ExternalConnection {id?:number;name?:string;ssh_user?:string;ssh_host?:string;ssh_port?:number;identity_file?:string;jump_connection_id?:number}
export interface ExternalToolsPort {connection(id:number):ExternalConnection|null;connectionForJump(id:number):ExternalConnection|null;request(path:string,options:Record<string,unknown>):Promise<unknown>;copy(value:string):Promise<void>;notify(message:string,level:'success'|'error'):void;tr(key:string,params?:Record<string,unknown>):string}
function quote(value:unknown){const text=String(value??'');return /[\s"']/u.test(text)?`"${text.replace(/(["\\])/g,'\\$1')}"`:text;}
export function createExternalToolsService(port:ExternalToolsPort){
  function command(connection:ExternalConnection|null,kind:ExternalToolKind='ssh'){
    if(!connection)return '';
    const args:string[]=[];if(kind==='ssh')args.push('ssh','-p',String(connection.ssh_port||22));else args.push('sftp','-P',String(connection.ssh_port||22));
    if(connection.identity_file)args.push('-i',quote(connection.identity_file));
    const jump=connection.jump_connection_id?port.connectionForJump(Number(connection.jump_connection_id)):null;
    if(jump)args.push('-J',`${jump.ssh_user}@${jump.ssh_host}:${jump.ssh_port||22}`);
    args.push(`${connection.ssh_user}@${connection.ssh_host}`);return args.join(' ');
  }
  async function copy(id:number,kind:ExternalToolKind='ssh'){const connection=port.connection(Number(id));if(!connection)return false;const value=command(connection,kind);if(!value)return false;await port.copy(value);port.notify(kind==='sftp'?port.tr('common:notifications.exact.sftp_command_copied',{defaultValue:'已复制 SFTP 命令（不含密码和私钥口令）'}):port.tr('common:notifications.exact.ssh_command_copied',{defaultValue:'已复制 SSH 命令（不含密码和私钥口令）'}),'success');return true;}
  async function openVsCode(id:number,remotePath=''){const connection=port.connection(Number(id));if(!connection)return false;await port.request(`/api/connections/${Number(id)}/external-tools/vscode`,{method:'POST',body:JSON.stringify({path:String(remotePath||'').slice(0,10000)})});port.notify(port.tr('common:notifications.opened_vscode_ssh',{defaultValue:'已交给 VS Code Remote SSH 打开'}),'success');return true;}
  return {command,copy,openVsCode};
}
