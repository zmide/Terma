export interface PlatformPort {userAgent():string;platform():string;tr(key:string,params?:Record<string,unknown>):string}
export function createPlatformService(port:PlatformPort){
  function label(){const source=`${port.platform()} ${port.userAgent()}`;return /windows/i.test(source)?'Windows':/macintosh|mac os/i.test(source)?'macOS':/linux|android/i.test(source)?'Linux':'未知平台';}
  function context(){const value=label();return {source:'client-platform',title:port.tr('terminal:ai.agent_platform_title',{defaultValue:'Terma 客户端平台'}),text:port.tr('terminal:ai.agent_platform_context',{platform:value,defaultValue:`Terma 客户端平台：${value}。终端命令必须以远端 shell 实际输出为准，无法确认 shell 时先探测，不要假设 bash、zsh 或 PowerShell。`})};}
  return {label,context};
}
