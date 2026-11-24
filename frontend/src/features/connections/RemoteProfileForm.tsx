import { defineComponent, h, onMounted, onBeforeUnmount, ref, watch, type PropType } from 'vue';
import {createProfileEditorService, type ProfileEditorPort, type SaveAction} from '../remote/profile-service';
import {profileOptions, type ProfileDraft, type RemoteProfile} from '../remote/profile-model';
import { TermaButton } from '@/shared/ui/TermaButton';
import { SettingsPasswordField } from '../settings/SettingsPasswordField';
import { connectionIcon } from './connection-mount';

const resolutions = [
  [1024,768,'XGA · 4:3'], [1280,720,'HD · 720p'], [1280,800,'WXGA · 16:10'],
  [1366,768,'HD'], [1440,900,'WXGA+ · 16:10'], [1600,900,'HD+'],
  [1680,1050,'WSXGA+ · 16:10'], [1920,1080,'Full HD · 1080p'],
  [1920,1200,'WUXGA · 16:10'], [2048,1080,'2K DCI'], [2048,1152,'QWXGA'],
  [2560,1080,'ultrawide'], [2560,1440,'QHD · 1440p'], [2560,1600,'WQXGA · 16:10'],
  [3440,1440,'ultrawide'], [3840,1080,'dual-full-hd'], [3840,1600,'ultrawide'],
  [3840,2160,'4K UHD'], [4096,2160,'DCI 4K'], [5120,1440,'dual-qhd'], [5120,2880,'5K'],
  [7680,4320,'8K UHD']
] as const;
const encodings = [['utf8','UTF-8'],['gb18030','GB18030'],['gbk','GBK'],['big5','Big5'],['shift_jis','Shift_JIS'],['euc-kr','EUC-KR'],['latin1','ISO-8859-1']] as const;
const qualityPresets = {balanced:8,smooth:6} as const;
const rdpModeFor = (options: any) => {
  if (['dynamic','fullscreen','fixed'].includes(String(options?.display_mode))) return String(options.display_mode);
  if (Object.prototype.hasOwnProperty.call(options || {},'fullscreen')) return options.fullscreen===false?'fixed':'fullscreen';
  return 'dynamic';
};
const xdmcpModeFor = (options: any) => {
  const mode=String(options?.window_mode||'');
  if (['resizable','fullscreen','fixed'].includes(mode)) return mode;
  return mode==='windowed'?'fixed':'resizable';
};
const presetFor = (options: any) => {
  const current = `${Math.round(Number(options?.width || 1440))}x${Math.round(Number(options?.height || 900))}`;
  return resolutions.some(([width,height]) => `${width}x${height}` === current) ? current : 'custom';
};

const input = (id: string, value: unknown, attrs: Record<string, any> = {}) => h('input', {id, value: String(value ?? ''), ...attrs});
const select = (id: string, value: unknown, choices: Array<[string, string]>, attrs: Record<string, any> = {}) => h('select', {id, value: String(value ?? ''), ...attrs}, choices.map(([choice, label]) => h('option', {value: choice}, label)));
const field = (label: string, control: any, id?: string) => h('div', null, [h('label', id ? {for:id} : null, label), control]);
const check = (id: string, label: string, checked: unknown, attrs: Record<string, any> = {}) => h('label', {class:'checkline', ...attrs}, [h('input', {id,type:'checkbox',checked:Boolean(checked)}), label]);

export const RemoteProfileForm = defineComponent({
  name:'RemoteProfileForm',
  props:{
    language:{type:String,required:true},
    servicePort:{type:Object as PropType<ProfileEditorPort>,required:true},
    scope:{type:Object,required:true},
    profile:{type:Object,required:true},
    onCreateGroup:{type:Function as PropType<(apply:(name:string)=>boolean)=>void>,required:true},

    onTest:{type:Function,required:true},
    onClose:{type:Function,required:true},
    defaultGroup:{type:String,required:true}
  },
  setup(props) {
    const tr = (key: string, options: Record<string, any> = {}) => props.scope.tr(`remote:auto.${key}`, options);
    const initialProtocol = () => String(props.profile.protocol || 'rdp');
    const makeDraft = (profile: any) => {
      const protocol=String(profile.protocol||'rdp'), options=profile.options||{};
      return {
        remote_id:String(Number(profile.id||0)||''),remote_source_ssh_connection_id:String(Number(options.source_ssh_connection_id||0)),
        remote_protocol:protocol,remote_name:String(profile.name||''),remote_group:String(profile.group_name||props.defaultGroup),
        remote_host:String(profile.host||''),remote_port:String(Number(profile.port||props.scope.REMOTE_PROTOCOL_META[protocol]?.port||0)||''),
        remote_username:String(profile.username||(protocol==='ftp'?'anonymous':'')),remote_password:'',remote_clear_password:false,
        remote_rdp_password_transfer:Boolean(options.allow_password_transfer),remote_tags:String(profile.tags||''),
        remote_rdp_display_mode:rdpModeFor(options),remote_audio:options.audio==='remote'?'remote':options.audio==='off'?'off':'local',
        remote_rdp_resolution_preset:presetFor(options),remote_rdp_width:String(options.width||1440),remote_rdp_height:String(options.height||900),
        remote_domain:String(options.domain||''),remote_clipboard:options.clipboard!==false,remote_admin_session:Boolean(options.admin_session),
        remote_vnc_client_mode:['auto','bundled','embedded','system'].includes(options.client_mode)?options.client_mode:'embedded',
        remote_vnc_display_mode:['scale','original','resize'].includes(options.display_mode)?options.display_mode:'scale',
        remote_vnc_cursor_mode:['show','hide'].includes(options.cursor_mode)?options.cursor_mode:'auto',
        remote_vnc_performance_preset:Number(options.quality??8)===6?'smooth':Number(options.quality??8)===8?'balanced':'custom',
        remote_quality:String(options.quality??8),remote_shared:options.shared!==false,remote_view_only:Boolean(options.view_only),
        remote_vnc_auto_sync_images:options.auto_sync_images!==false,remote_vnc_ssh_connection:String(options.source_ssh_connection_id||0),
        remote_xdmcp_mode:options.mode==='indirect'?'indirect':options.mode==='broadcast'?'broadcast':'query',
        remote_xdmcp_window_mode:xdmcpModeFor(options),remote_xdmcp_resolution_preset:presetFor(options),
        remote_xdmcp_width:String(options.width||1440),remote_xdmcp_height:String(options.height||900),
        remote_xdmcp_ssh_connection:String(options.ssh_connection_id||0),remote_xdmcp_local_address:String(options.local_address||''),
        remote_ftp_secure:options.secure==='explicit'?'explicit':options.secure==='implicit'?'implicit':'none',
        remote_base_path:String(options.base_path||'/'),remote_reject_unauthorized:options.reject_unauthorized!==false,
        remote_terminal_type:String(options.terminal_type||'xterm-256color'),remote_encoding:String(options.encoding||'utf8'),
        remote_serial_path:String(options.path||''),remote_baud_rate:String(options.baud_rate||115200),
        remote_data_bits:String(options.data_bits||8),remote_stop_bits:String(options.stop_bits||1),remote_parity:String(options.parity||'none'),
        remote_rts_cts:Boolean(options.rts_cts),remote_xon:Boolean(options.xon),remote_xoff:Boolean(options.xoff)
      } as ProfileDraft;
    };
    const draft=ref(makeDraft(props.profile));
    const input=(id:string,value:unknown,attrs:Record<string,any>={})=>h('input',{...attrs,id,value:draft.value[id]??String(value??''),onInput:(event:Event)=>{draft.value[id]=(event.target as HTMLInputElement).value;(attrs as any).onInput?.(event);}});
    const select=(id:string,value:unknown,choices:Array<[string,string]>,attrs:Record<string,any>={})=>h('select',{id,value:draft.value[id]??String(value??''),...Object.fromEntries(Object.entries(attrs).filter(([key])=>key!=='onChange')),onChange:(event:Event)=>{const previous=draft.value[id];draft.value[id]=(event.target as HTMLSelectElement).value;(attrs as any).onChange?.(event,previous);}},choices.map(([choice,label])=>h('option',{value:choice},label)));
    const check=(id:string,label:string,checked:unknown,attrs:Record<string,any>={})=>{
      const {disabled,hidden,...labelAttrs}=attrs;
      return h('label',{class:'checkline',hidden,...labelAttrs},[h('input',{id,type:'checkbox',checked:draft.value[id]??Boolean(checked),disabled,onChange:(event:Event)=>{draft.value[id]=(event.target as HTMLInputElement).checked;(attrs as any).onChange?.(event);}}),label]);
    };
    const protocol = ref(initialProtocol());
    const rdpMode = ref(rdpModeFor(props.profile.options));
    const xdmcpMode = ref(xdmcpModeFor(props.profile.options));
    const rdpPreset = ref(presetFor(props.profile.options));
    const xdmcpPreset = ref(presetFor(props.profile.options));
    const quality = ref(Number(props.profile.options?.quality ?? 8));
    const qualityPreset = ref(quality.value === 6 ? 'smooth' : quality.value === 8 ? 'balanced' : 'custom');
    const revision=ref(0);
    const service=createProfileEditorService(props.profile as RemoteProfile,()=>draft.value,props.servicePort,()=>revision.value++);
    const scanSerialPorts=()=>service.scan();
    let formElement:HTMLFormElement|null=null;
    const changeGroup = (event: Event, previous: string) => {
      const control = event.target as HTMLSelectElement;
      if (control.value !== '__new_group__') return;
      draft.value.remote_group = previous || props.defaultGroup;
      control.value = String(draft.value.remote_group);
      const owner = formElement;
      props.onCreateGroup(name => {
        if (!owner?.isConnected || formElement !== owner || !control.isConnected || owner.checkVisibility?.() === false) return false;
        draft.value.remote_group = name;
        return true;
      });
    };
    onBeforeUnmount(()=>{const password=formElement?.querySelector<HTMLInputElement>('#remote_password');if(password)password.value='';service.dispose();});
    const save=async(event:SubmitEvent)=>{
      event.preventDefault();const button=event.submitter as HTMLButtonElement|null;
      const action=(button?.dataset.clearAfterSave==='1'?'clear':button?.dataset.saveAction||'save') as SaveAction;
      if(await service.save(action)&&action==='clear'&&!props.profile.id){draft.value=makeDraft({protocol:protocol.value,group_name:draft.value.remote_group,options:{}});}
    }; 
    const formOptions=(kind:string)=>profileOptions({...draft.value,remote_protocol:kind},props.profile as RemoteProfile);
    onMounted(() => {
      if(initialProtocol()==='serial') scanSerialPorts().catch(()=>{});
    });
    watch(() => props.profile, () => {
      draft.value=makeDraft(props.profile);
      protocol.value = initialProtocol();
      rdpMode.value = rdpModeFor(props.profile.options);
      xdmcpMode.value = xdmcpModeFor(props.profile.options);
      rdpPreset.value = presetFor(props.profile.options);
      xdmcpPreset.value = presetFor(props.profile.options);
      quality.value = Number(props.profile.options?.quality ?? 8);
      qualityPreset.value = quality.value === 6 ? 'smooth' : quality.value === 8 ? 'balanced' : 'custom';
    });

    const protocolTitle = (value: string) => props.scope.remoteProtocolLabel(value);
    const allProtocols = () => Object.entries(props.scope.REMOTE_PROTOCOL_META).map(([value]: [string, any]) => [value, protocolTitle(value)] as [string,string]);
    const connectionChoices = (selected: unknown) => [
      ['0', tr('match_same_host', {defaultValue:'自动匹配同主机'})],
      ...props.scope.connections.map((connection: any) => [String(connection.id), `${connection.name} · ${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port || 22}`] as [string,string])
    ];
    const currentOptions = () => protocol.value === initialProtocol() ? (props.profile.options || {}) : {};
    const resolutionChoices = (width: unknown, height: unknown) => {
      const listed = resolutions.map(([w,h,label]) => {
        const resolution = `${w} × ${h}`;
        const display = label === 'ultrawide'
          ? tr('ultrawide_resolution', {resolution, defaultValue:`${resolution} · 超宽屏`})
          : label === 'dual-full-hd'
            ? tr('dual_full_hd_resolution', {resolution, defaultValue:`${resolution} · 双 Full HD`})
            : label === 'dual-qhd'
              ? tr('dual_qhd_resolution', {resolution, defaultValue:`${resolution} · 双 QHD`})
              : `${resolution} · ${label}`;
        return [`${w}x${h}`,display] as [string,string];
      });
      return [...listed, ['custom',tr('custom_dimensions',{defaultValue:'自定义宽高'})] as [string,string]];
    };
    const resolutionFields = (prefix: string, options: any, visible: boolean, preset: any, change: (value: string) => void) => {
      const width = Number(options.width || 1440), height = Number(options.height || 900);
      const current = `${Math.round(width)}x${Math.round(height)}`;
      const isPreset = resolutions.some(([w,h]) => `${w}x${h}` === current);
      const selected = isPreset ? current : 'custom';
      return h('div', {id:`${prefix}_resolution_options`,class:'remote-resolution-options',hidden:!visible}, [
        h('label', {for:`${prefix}_resolution_preset`}, tr('fixed_resolution', {defaultValue:'固定分辨率'})),
        select(`${prefix}_resolution_preset`, preset.value || selected, resolutionChoices(width,height), {
          onChange:(event: Event) => {
            const value=(event.target as HTMLSelectElement).value;change(value);
            if(value!=='custom') {const [w,h]=value.split('x');draft.value[`${prefix}_width`]=w;draft.value[`${prefix}_height`]=h;}
          }
        }),
        h('div',{id:`${prefix}_custom_resolution`,class:'grid remote-resolution-custom',hidden:!visible || (preset.value || selected)!=='custom'},[
          field(tr('width',{defaultValue:'宽度'}),input(`${prefix}_width`,width,{type:'number',min:640,max:8192}),`${prefix}_width`),
          field(tr('height',{defaultValue:'高度'}),input(`${prefix}_height`,height,{type:'number',min:480,max:8192}),`${prefix}_height`)
        ])
      ]);
    };
    const desktopGuide = (kind: string) => {
      if(kind==='rdp') {
        return h('div',{class:'remote-protocol-guide'},[
          h('span',{class:'remote-protocol-guide-icon'},[connectionIcon('badge-check')]),
          h('div',null,[h('span',{class:'remote-protocol-guide-tag'},tr('recommended',{defaultValue:'推荐'})),
            h('strong',null,tr('xrdp_xorg',{defaultValue:'xrdp 使用 Xorg/xorgxrdp'})),
            h('small',null,tr('xrdp_xorg_hint',{defaultValue:'默认优先选择 Xorg；登录器里的 Xvnc 是兼容后端，仅在 Xorg 后端不可用时使用。'})),
            h('small',null,tr('rdp_login_hint',{defaultValue:'XRDP 登录使用远端 Linux 桌面账号，不是临时管理员授权的 root 密码、VNC 密码或 Windows 当前账号。'}))])
        ]);
      }
      if(kind==='vnc') return h('div',{class:'remote-protocol-guide'},[
        h('span',{class:'remote-protocol-guide-icon'},[connectionIcon('panels-top-left')]),
        h('div',null,[h('span',{class:'remote-protocol-guide-tag'},tr('desktop_relation',{defaultValue:'桌面关系'})),
          h('strong',null,tr('vnc_source_summary',{defaultValue:'共享来源用 x11vnc，独立来源用 TigerVNC'})),
          h('small',null,tr('vnc_source_detail',{defaultValue:'物理桌面和 XRDP 会话由 x11vnc 镜像；TigerVNC 创建新的独立 X11 桌面。日志中的 Xtigervnc/Xvnc 是底层进程名，不是另一套需要单独部署的产品。'})),
          h('small',{class:'remote-protocol-guide-risk'},tr('vnc_source_risk',{defaultValue:'RDP、VNC、XDMCP 的端口互不冲突；同一 Linux 用户并跑 XRDP 与 TigerVNC 可能争用 HOME、DBus 或桌面单实例，独立 VNC 推荐使用单独的普通用户。'}))])
      ]);
      return h('div',{class:'remote-protocol-guide'},[
        h('span',{class:'remote-protocol-guide-icon'},[connectionIcon('monitor-up')]),
        h('div',null,[h('span',{class:'remote-protocol-guide-tag'},tr('local_requirement',{defaultValue:'本机要求'})),
          h('strong',null,tr('xdmcp_local_xserver_required',{defaultValue:'运行 Terma 的设备必须有可用的本机 X Server'})),
          h('small',null,tr('xdmcp_local_xserver_hint',{defaultValue:'Linux 常用 Xephyr，macOS 使用 XQuartz，Windows 需要已安装并启动的 X Server；XDMCP 不依赖 SSH X11 转发，后者也不是 XDMCP 客户端。'}))])
      ]);
    };
    const protocolOptions = () => {
      const options=currentOptions();
      if(protocol.value==='rdp') {
        const displayMode=String(draft.value.remote_rdp_display_mode||rdpMode.value);
        const fixed=displayMode==='fixed';
        return [
          h('div',{class:'grid'},[
            field(tr('display_mode',{defaultValue:'显示方式'}),select('remote_rdp_display_mode',displayMode,[['dynamic',tr('rdp_dynamic',{defaultValue:'自动跟随窗口（推荐）'})],['fullscreen',tr('fullscreen',{defaultValue:'全屏'})],['fixed',tr('fixed_resolution',{defaultValue:'固定分辨率'})]],{onChange:(event:Event)=>rdpMode.value=(event.target as HTMLSelectElement).value}),'remote_rdp_display_mode'),
            field(tr('sound',{defaultValue:'声音'}),select('remote_audio',options.audio==='remote'?'remote':options.audio==='off'?'off':'local',[['local',tr('play_local',{defaultValue:'在本机播放'})],['remote',tr('play_remote',{defaultValue:'在远端播放'})],['off',tr('off',{defaultValue:'关闭'})]]),'remote_audio')
          ]),
          resolutionFields('remote_rdp',options,fixed,rdpPreset,(value:string)=>rdpPreset.value=value),
          h('div',{class:'remote-display-help'},tr('rdp_display_hint',{defaultValue:'自动模式会让 RDP 桌面随客户端窗口变化；固定模式可选常用、超宽、2K、4K、5K、8K 或自定义尺寸。'})),
          h('div',{class:'grid'},[
            field(tr('domain',{defaultValue:'域'}),input('remote_domain',options.domain||'',{placeholder:tr('optional',{defaultValue:'可选'})}),'remote_domain'),
            h('div',{class:'check-grid'},[check('remote_clipboard',tr('shared_clipboard',{defaultValue:'共享剪贴板'}),options.clipboard!==false),check('remote_admin_session',tr('admin_session',{defaultValue:'管理会话'}),options.admin_session)])
          ]),desktopGuide('rdp')
        ];
      }
      if(protocol.value==='vnc') {
        const mode=['scale','original','resize'].includes(String(options.display_mode))?String(options.display_mode):'scale';
        const client=['auto','bundled','embedded','system'].includes(String(draft.value.remote_vnc_client_mode))?String(draft.value.remote_vnc_client_mode):'embedded';
        const clipboardHint=['auto','bundled'].includes(client)
          ? tr('bundled_clipboard_hint',{defaultValue:'内置 TigerVNC Viewer 使用 VNC 原生文本剪贴板；共享物理桌面的 x11vnc/wayvnc 可能把中文作为 \\uXXXX 或乱码传输，Viewer 参数无法修复。需要可靠中文复制，请使用独立 TigerVNC 虚拟桌面，或在 Terma 内置 noVNC 中关联 SSH 剪贴板辅助。'})
          : tr('auto_sync_images_hint',{defaultValue:'默认开启；仅在剪贴板自动同步开启、Terma 位于前台且 SSH 辅助支持图片时生效。'});
        return [
          h('div',{class:'grid3 remote-display-grid'},[
            field(tr('open_method',{defaultValue:'打开方式'}),select('remote_vnc_client_mode',client,[['auto',tr('auto_vnc_clients',{defaultValue:'自动（TigerVNC Viewer → 系统）'})],['bundled',tr('bundled_tigervnc',{defaultValue:'内置 TigerVNC Viewer'})],['embedded',tr('terma_novnc',{defaultValue:'Terma 内置 noVNC'})],['system',tr('system_client',{defaultValue:'系统客户端'})]]),'remote_vnc_client_mode'),
            field(tr('display_mode',{defaultValue:'显示方式'}),select('remote_vnc_display_mode',mode,[['scale',tr('fit_window',{defaultValue:'适应窗口（推荐）'})],['original',tr('original_pixels',{defaultValue:'原始像素'})],['resize',tr('follow_window',{defaultValue:'跟随窗口（服务器支持时）'})]]),'remote_vnc_display_mode'),
            field(tr('mouse_mode',{defaultValue:'鼠标模式'}),select('remote_vnc_cursor_mode',['show','hide'].includes(options.cursor_mode)?options.cursor_mode:'auto',[['auto',tr('mouse_auto',{defaultValue:'自动（按远端平台）'})],['show',tr('mouse_show',{defaultValue:'手动显示本地光标'})],['hide',tr('mouse_hide',{defaultValue:'手动隐藏本地光标'})]]),'remote_vnc_cursor_mode')
          ]),
          h('div',{class:'grid remote-vnc-performance-setting'},[
            field(tr('performance_preset',{defaultValue:'性能预设'}),select('remote_vnc_performance_preset',qualityPreset.value,[['balanced',tr('performance_balanced',{defaultValue:'平衡（画质 8）'})],['smooth',tr('performance_smooth',{defaultValue:'流畅优先（画质 6）'})],['custom',tr('performance_custom',{defaultValue:'自定义'})]],{onChange:(event:Event)=>{const value=(event.target as HTMLSelectElement).value;qualityPreset.value=value;if(value==='balanced'||value==='smooth'){quality.value=qualityPresets[value as keyof typeof qualityPresets];draft.value.remote_quality=String(quality.value);}}}),'remote_vnc_performance_preset'),
            h('div',{class:'remote-display-help'},tr('performance_preset_hint',{defaultValue:'流畅优先会把 JPEG 画质降到 6，减少带宽和解码压力；不会关闭剪贴板，也不会修改远端分辨率。'}))
          ]),
          h('div',{class:'remote-quality-setting'},[
            h('div',{class:'remote-quality-heading'},[h('label',{for:'remote_quality'},tr('quality',{defaultValue:'画质'})),h('output',{id:'remote_quality_value',for:'remote_quality'},String(quality.value))]),
            input('remote_quality',quality.value,{type:'range',min:0,max:9,step:1,onInput:(event:Event)=>{quality.value=Number((event.target as HTMLInputElement).value);qualityPreset.value=quality.value===6?'smooth':quality.value===8?'balanced':'custom';draft.value.remote_vnc_performance_preset=qualityPreset.value;}}),
            h('div',{class:'remote-quality-scale'},[h('span',null,tr('quality_low',{defaultValue:'0 · 更省流量'})),h('span',null,tr('quality_high',{defaultValue:'9 · 更清晰'}))])
          ]),
          h('div',{class:'remote-display-help'},tr('vnc_quality_hint',{defaultValue:'画质控制 JPEG 压缩质量，与分辨率不是同一项；两者越高通常越占带宽。内置 noVNC 可以在本机缩放画面；TigerVNC 没有客户端缩放，只能请求服务器动态调整分辨率，服务器不支持时会保留滚动条。'})),
          h('div',{class:'check-grid'},[check('remote_shared',tr('shared_session',{defaultValue:'共享会话'}),options.shared!==false),check('remote_view_only',tr('view_only',{defaultValue:'仅查看'}),options.view_only),check('remote_vnc_auto_sync_images',tr('auto_sync_images',{defaultValue:'自动双向同步图片'}),options.auto_sync_images!==false,{disabled:['auto','bundled'].includes(client)})]),
          h('div',{class:'remote-display-help'},clipboardHint),desktopGuide('vnc'),
          h('div',{class:'grid remote-vnc-helper-grid'},[
            field(tr('ssh_clipboard_helper',{defaultValue:'SSH 剪贴板辅助'}),select('remote_vnc_ssh_connection',options.source_ssh_connection_id||'0',connectionChoices(options.source_ssh_connection_id)),'remote_vnc_ssh_connection'),
            h('div',{class:'connection-test-status remote-vnc-helper-note'},tr('ssh_clipboard_hint',{defaultValue:'用于可靠传输中文剪贴板；Linux 还需 xclip/xsel 或 wl-clipboard。'}))
          ])
        ];
      }
      if(protocol.value==='xdmcp') {
        const mode=String(draft.value.remote_xdmcp_window_mode||xdmcpMode.value);
        const visible=mode==='fixed';
        return [
          h('div',{class:'grid3 remote-display-grid'},[
            field(tr('connection_mode',{defaultValue:'连接方式'}),select('remote_xdmcp_mode',options.mode==='indirect'?'indirect':options.mode==='broadcast'?'broadcast':'query',[['query',tr('xdmcp_query',{defaultValue:'直接查询'})],['indirect',tr('xdmcp_indirect',{defaultValue:'间接查询'})],['broadcast',tr('xdmcp_broadcast',{defaultValue:'局域网广播'})]]),'remote_xdmcp_mode'),
            field(tr('display_mode',{defaultValue:'显示方式'}),select('remote_xdmcp_window_mode',mode,[['resizable',tr('xdmcp_resizable',{defaultValue:'可调整窗口（支持时）'})],['fullscreen',tr('fullscreen',{defaultValue:'全屏'})],['fixed',tr('fixed_resolution',{defaultValue:'固定分辨率'})]],{onChange:(event:Event)=>xdmcpMode.value=(event.target as HTMLSelectElement).value}),'remote_xdmcp_window_mode'),
            field(props.scope.tr('remote:linux_desktop.management_connection',{defaultValue:'SSH 管理连接'}),select('remote_xdmcp_ssh_connection',options.ssh_connection_id||'0',connectionChoices(options.ssh_connection_id)),'remote_xdmcp_ssh_connection')
          ]),
          resolutionFields('remote_xdmcp',options,visible,xdmcpPreset,(value:string)=>xdmcpPreset.value=value),
          h('div',{class:'grid'},[
            field(tr('local_address',{defaultValue:'本地地址'}),input('remote_xdmcp_local_address',options.local_address||'',{placeholder:tr('automatic_select',{defaultValue:'自动选择'})}),'remote_xdmcp_local_address'),
            h('div',{class:'remote-display-help'},tr('xdmcp_resize_hint',{defaultValue:'Linux 和 macOS 的 Xephyr 可随窗口调整；Windows 会使用所选初始尺寸打开，不能可靠动态调整。XDMCP/X11 没有通用帧率限制。'}))
          ]),
          h('div',{class:'xdmcp-session-auto'},[connectionIcon('sparkles'),h('span',null,tr('xdmcp_session_auto',{defaultValue:'桌面会话由远端登录界面自动提供'}))]),desktopGuide('xdmcp'),
          h('div',{class:'connection-test-status'},tr('xdmcp_management_hint',{defaultValue:'SSH 管理连接可使用私钥、SSH Agent 或密码完成探测和配置；XDMCP 图形登录由远端显示管理器验证，通常仍需输入桌面账号和密码。'})),
          h('div',{class:'connection-test-status warning'},tr('xdmcp_security_warning',{defaultValue:'XDMCP 不加密，只应在可信局域网使用；跨公网请使用 SSH X11、RDP 或 VNC。'}))
        ];
      }
      if(protocol.value==='ftp') return [
        h('div',{class:'grid'},[
          field(tr('transfer_security',{defaultValue:'传输安全'}),select('remote_ftp_secure',options.secure==='explicit'?'explicit':options.secure==='implicit'?'implicit':'none',[['none',tr('ftp_plain',{defaultValue:'FTP（不加密）'})],['explicit',tr('ftps_explicit',{defaultValue:'显式 FTPS'})],['implicit',tr('ftps_implicit',{defaultValue:'隐式 FTPS'})]]),'remote_ftp_secure'),
          field(tr('default_directory',{defaultValue:'默认目录'}),input('remote_base_path',options.base_path||'/',{placeholder:'/'}),'remote_base_path')
        ]),
        h('div',{class:'check-grid'},[h('span',{class:'protocol-mode-note'},tr('ftp_passive_hint',{defaultValue:'FTP 固定使用被动模式，兼容常见 NAT 和防火墙环境。'})),check('remote_reject_unauthorized',tr('verify_tls',{defaultValue:'验证 TLS 证书'}),options.reject_unauthorized!==false)])
      ];
      if(protocol.value==='telnet') return [
        h('div',{class:'grid'},[
          field(tr('terminal_type',{defaultValue:'终端类型'}),input('remote_terminal_type',options.terminal_type||'xterm-256color'),'remote_terminal_type'),
          field(tr('encoding',{defaultValue:'字符编码'}),select('remote_encoding',options.encoding||'utf8',encodings.map(([value,label])=>[value,label])),'remote_encoding')
        ]),h('div',{class:'connection-test-status warning'},tr('telnet_warning',{defaultValue:'Telnet 不加密用户名、密码和终端内容，只应在可信内网或加密隧道中使用。'}))
      ];
      return [
        h('div',{class:'grid'},[
          field(tr('serial_device',{defaultValue:'串口设备'}),h('div',{class:'upload-line serial-device-controls'},[
            h('div',{class:'field-dropdown'},[
              input('remote_serial_path',options.path||'',{list:service.state.ports.length?'remoteSerialPorts':undefined,placeholder:tr('serial_device_placeholder',{defaultValue:'COM3 或 /dev/ttyUSB0'})}),
              service.state.ports.length?connectionIcon('chevron-down'):null
            ]),
            h('datalist',{id:'remoteSerialPorts'},service.state.ports.map(port=>h('option',{value:port.path},port.manufacturer||port.friendly_name||port.path))),
            h(TermaButton,{type:'button',disabled:service.state.scanning,onClick:()=>void scanSerialPorts()},()=>[connectionIcon('refresh-cw'),h('span',null,tr('scan',{defaultValue:'扫描'}))])
          ]),'remote_serial_path'),
          field(tr('baud_rate',{defaultValue:'波特率'}),input('remote_baud_rate',options.baud_rate||115200,{type:'number',min:50,max:4000000}),'remote_baud_rate')
        ]),
        h('div',{class:'grid3'},[
          field(tr('data_bits',{defaultValue:'数据位'}),select('remote_data_bits',options.data_bits||8,[['8','8'],['7','7'],['6','6'],['5','5']]),'remote_data_bits'),
          field(tr('stop_bits',{defaultValue:'停止位'}),select('remote_stop_bits',options.stop_bits||1,[['1','1'],['1.5','1.5'],['2','2']]),'remote_stop_bits'),
          field(tr('parity',{defaultValue:'校验位'}),select('remote_parity',options.parity||'none',[['none',tr('parity_none',{defaultValue:'无'})],['even',tr('parity_even',{defaultValue:'偶'})],['odd',tr('parity_odd',{defaultValue:'奇'})],['mark','Mark'],['space','Space']]),'remote_parity')
        ]),
        h('div',{class:'grid'},[
          field(tr('encoding',{defaultValue:'字符编码'}),select('remote_encoding',options.encoding||'utf8',encodings.map(([value,label])=>[value,label])),'remote_encoding'),
          h('div',{class:'check-grid'},[check('remote_rts_cts','RTS/CTS',options.rts_cts),check('remote_xon','XON',options.xon),check('remote_xoff','XOFF',options.xoff)])
        ])
      ];
    };

    return () => {
      revision.value;
      const profile=props.profile as any;
      const activeProtocol=protocol.value;
      const protocolInfo=props.scope.REMOTE_PROTOCOL_META[activeProtocol];
      const title=protocolTitle(activeProtocol);
      const selectedGroup=String(draft.value.remote_group||props.defaultGroup);
      const credentialsHidden=['telnet','serial','xdmcp'].includes(activeProtocol);
      const desktopNote=activeProtocol==='rdp'
        ? tr('rdp_password_hint',{defaultValue:'RDP 用户名和密码都可留空。默认由客户端询问；勾选警告后，Windows 使用临时凭据、FreeRDP 使用标准输入。macOS Windows App 不提供密码接口，Terma 会改用已安装的 FreeRDP。'})
        : tr('vnc_password_hint',{defaultValue:'VNC 密码可选加密保存；保存后 Terma 会自动传给内置 TigerVNC Viewer 或 noVNC，留空时才会在连接时询问。默认使用内置 noVNC；自动模式优先 TigerVNC Viewer，再回退到系统客户端。TigerVNC 原生剪贴板主要传输文本，图片同步请使用 Terma 内置 noVNC。'});
      const defaultValue=profile.id ? tr('edit_protocol',{protocol:title,defaultValue:`编辑 ${title} 连接`}) : tr('add_protocol',{protocol:title,defaultValue:`添加 ${title} 连接`});
      const groups=props.scope.groupNames(selectedGroup,'remote');
      const groupLabel=(name:string)=>name===props.defaultGroup?tr('default_group',{defaultValue:'默认分组'}):name;
      const passwordHint=profile.has_password?tr('keep_password',{defaultValue:'留空表示保持已保存密码'}):tr('optional',{defaultValue:'可选'});
      return h('div',{class:'panel remote-profile-editor'},[
        h('form',{id:'remoteProfileForm',ref:(element:unknown)=>{formElement=element as HTMLFormElement|null;if(element){const form=element as HTMLFormElement & {remoteOptions?:typeof formOptions;remoteScan?:typeof scanSerialPorts};form.remoteOptions=formOptions;form.remoteScan=scanSerialPorts;}},'aria-busy':service.state.saving,onSubmit:save},[
          input('remote_id',Number(profile.id||0)||'',{type:'hidden'}),
          input('remote_source_ssh_connection_id',Number(profile.options?.source_ssh_connection_id||0),{type:'hidden'}),
          h('div',{class:'workspace-head'},[
            h('div',null,[h('h2',null,defaultValue),h('div',{class:'subtitle'},tr('form_hint',{defaultValue:'协议配置只显示实际需要的字段。'}))]),
            h('span',{class:`protocol-badge protocol-${activeProtocol}`},[connectionIcon(protocolInfo.icon),' ',title])
          ]),
          h('div',{class:'grid3'},[
            field(tr('protocol',{defaultValue:'协议'}),select('remote_protocol',activeProtocol,allProtocols(),{onChange:(event:Event)=>{
              const next=(event.target as HTMLSelectElement).value;protocol.value=next;
              if(next!=='serial')draft.value.remote_port=String(props.scope.REMOTE_PROTOCOL_META[next]?.port||'');
              if(next==='ftp'&&!draft.value.remote_username)draft.value.remote_username='anonymous';
              rdpMode.value=next==='rdp'&&initialProtocol()==='rdp'?rdpModeFor(profile.options):'dynamic';
              xdmcpMode.value=next==='xdmcp'&&initialProtocol()==='xdmcp'?xdmcpModeFor(profile.options):'resizable';
              rdpPreset.value=presetFor(next==='rdp'&&initialProtocol()==='rdp'?profile.options:{});
              xdmcpPreset.value=presetFor(next==='xdmcp'&&initialProtocol()==='xdmcp'?profile.options:{});
              if(next==='vnc') {quality.value=Number(initialProtocol()==='vnc'?profile.options?.quality??8:8);qualityPreset.value=quality.value===6?'smooth':quality.value===8?'balanced':'custom';}
              if(next==='serial')scanSerialPorts().catch(()=>{});
            }}),'remote_protocol'),
            field(tr('name',{defaultValue:'名称'}),input('remote_name',profile.name||'',{required:true,placeholder:tr('protocol_connection',{protocol:title,defaultValue:`${title} 连接`})}),'remote_name'),
            field(tr('group',{defaultValue:'分组'}),select('remote_group',selectedGroup,[...groups.map((name:string)=>[name,groupLabel(name)] as [string,string]),['__new_group__',tr('new_group',{defaultValue:'新增分组...'})]],{onChange:changeGroup}),'remote_group')
          ]),
          h('div',{id:'remoteNetworkFields',class:'grid',hidden:activeProtocol==='serial'},[
            field(tr('target_host',{defaultValue:'目标主机'}),input('remote_host',profile.host||'',{placeholder:'example.com'}),'remote_host'),
            field(tr('port',{defaultValue:'端口'}),input('remote_port',Number(profile.port||protocolInfo.port||0)||'',{type:'number',min:1,max:65535}),'remote_port')
          ]),
          h('div',{id:'remoteCredentialFields',class:'grid',hidden:credentialsHidden},[
            field(tr('username_optional',{defaultValue:'用户名（可选）'}),input('remote_username',profile.username||(activeProtocol==='ftp'?'anonymous':''),{autocomplete:'username'}),'remote_username'),
            h('div',{id:'remotePasswordField',hidden:credentialsHidden},[
              h('label',{for:'remote_password'},tr('password_optional',{defaultValue:'密码（可选）'})),
              h(SettingsPasswordField,{id:'remote_password',autocomplete:'new-password',value:String(draft.value.remote_password),onInput:(event:Event)=>draft.value.remote_password=(event.target as HTMLInputElement).value,placeholder:passwordHint,showLabel:props.scope.tr('common:auto.show_password'),hideLabel:props.scope.tr('common:auto.hide_password')}),
              h('label',{class:'checkline',hidden:!profile.has_password},[h('input',{id:'remote_clear_password',type:'checkbox',checked:Boolean(draft.value.remote_clear_password),onChange:(event:Event)=>draft.value.remote_clear_password=(event.target as HTMLInputElement).checked}),tr('clear_password',{defaultValue:'清除已保存密码'})]),
              h('label',{id:'remoteRdpPasswordTransferField',class:'checkline remote-password-transfer-warning',hidden:activeProtocol!=='rdp'},[
                h('input',{id:'remote_rdp_password_transfer',type:'checkbox',checked:Boolean(draft.value.remote_rdp_password_transfer),onChange:(event:Event)=>draft.value.remote_rdp_password_transfer=(event.target as HTMLInputElement).checked}),
                h('span',null,tr('rdp_password_consent',{defaultValue:'我了解风险，允许 Terma 把已保存密码交给 RDP 客户端'}))
              ])
            ])
          ]),
          h('div',{id:'remoteDesktopCredentialNote',class:'connection-test-status',hidden:!['rdp','vnc'].includes(activeProtocol)},desktopNote),
          h('label',{for:'remote_tags'},tr('tags',{defaultValue:'标签'})),
          input('remote_tags',profile.tags||'',{placeholder:tr('tags_example',{defaultValue:'例如：办公 内网 图形桌面'})}),
          h('fieldset',null,[h('legend',null,tr('protocol_options',{protocol:title,defaultValue:`${title} 选项`})),h('div',{id:'remoteProtocolOptions'},protocolOptions())]),
          service.state.error?h('div',{class:'connection-test-status error',role:'alert'},service.state.errorKey?props.servicePort.tr(service.state.errorKey):props.servicePort.localize(service.state.error)):null,
          h('div',{class:'actions'},[
            ...(profile.id ? [
              h(TermaButton,{disabled:service.state.saving,type:'submit','data-save-action':'save'},()=>[connectionIcon('save'),h('span',null,tr('save_only',{defaultValue:'仅保存'}))]),
              h(TermaButton,{class:'primary',disabled:service.state.saving,type:'submit','data-save-action':'close'},()=>[connectionIcon('save'),h('span',null,tr('save_close',{defaultValue:'保存并关闭'}))]),
              h(TermaButton,{disabled:service.state.saving,type:'submit','data-save-action':'open'},()=>[connectionIcon('external-link'),h('span',null,tr('save_open',{defaultValue:'保存并打开'}))]),
              h(TermaButton,{type:'button',onClick:(event:MouseEvent)=>props.onTest(profile.id,event.currentTarget)},()=>[connectionIcon('activity'),h('span',null,tr('test_connection',{defaultValue:'测试连接'}))])
            ] : [
              h(TermaButton,{class:'primary',disabled:service.state.saving,type:'submit'},()=>[connectionIcon('save'),h('span',null,tr('save_connection',{defaultValue:'保存连接'}))]),
              h(TermaButton,{disabled:service.state.saving,type:'submit','data-clear-after-save':'1'},()=>[connectionIcon('save-all'),h('span',null,tr('save_clear',{defaultValue:'保存并清空'}))])
            ]),
            h(TermaButton,{type:'button',onClick:()=>props.onClose()},()=>[props.scope.tr('common:actions.close',{defaultValue:'关闭'})])
          ])
        ])
      ]);
    };
  }
});
