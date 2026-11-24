import {workspaceServices} from '@/features/workspace/installed-services';
import { Fragment, h, render } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon as icon } from '@/features/settings/settings-icon';

export interface ShellSnapshot {
  primary: string;
  pinned: boolean;
  collapsed: boolean;
  guide: boolean;
  update: boolean;
  subtitle: string;
  theme: string;
}
export interface ShellPort { snapshot: () => ShellSnapshot; tr: (key: string) => string }

const navigation = [
  ['Connections','connections','server','navigation:auto.connections','connections:title'],
  ['Remote','remote','plug-zap','navigation:auto.remote','common:auto.other'],
  ['Running','running','route','navigation:auto.running','navigation:auto.running'],
  ['Command','command','square-terminal','navigation:auto.batch','navigation:auto.batch_short'],
  ['Import','import','arrow-left-right','navigation:auto.import_export','navigation:auto.import'],
  ['Logs','logs','scroll-text','navigation:auto.logs','navigation:auto.logs'],
  ['Settings','settings','settings','settings:title','settings:title']
] as const;

function github(mobile=false) {
  return <a class={mobile?'mobile-github-link':'github-link'} href="https://github.com/zmide/Terma" target="_blank" rel="noopener" title="GitHub" aria-label="GitHub"><svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.2.8-.6v-2c-3.3.7-4-1.4-4-1.4-.5-1.3-1.2-1.6-1.2-1.6-1-.7.1-.7.1-.7 1.1.1 1.7 1.2 1.7 1.2 1 .1.6 2.1 3.4 1.5.1-.7.4-1.2.7-1.5-2.6-.3-5.4-1.3-5.4-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.4 11.4 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.4 5.9.4.4.8 1.1.8 2.2v3.3c0 .4.2.7.8.6A12 12 0 0 0 12 .5Z" /></svg></a>;
}

const mounts = new Map<HTMLElement, { view: () => unknown; tr: ShellPort['tr'] }>();
export function refreshShellViews() {
  for(const [target,{view,tr}] of mounts) {
    target.dataset.theme=document.documentElement.dataset.theme==='dark'?'dark':'light';
    const labelKey=target.dataset.i18nAriaLabel;
    if(labelKey)target.setAttribute('aria-label',tr(labelKey));
    render(h(Fragment,null,view() as []),target);
  }
}

export function installShellViews(port: ShellPort) {
  const tr=port.tr;
  const button=(id:string,classes:string,glyph:string,key:string,action:string,attrs:Record<string,unknown>={},children?:unknown[])=>h(TermaButton,{id:id||undefined,class:classes,title:tr(key),'aria-label':tr(key),'data-action':action,...attrs},()=>children||[icon(glyph)]);
  const settingsDot=(mobile:boolean)=> <span id={mobile?'mobileSettingsUpdateDot':'navSettingsUpdateDot'} class="nav-update-dot" hidden={!port.snapshot().update} aria-label={tr('common:auto.new_version')} />;
  const nav=(mobile:boolean)=>navigation.map(([id,name,glyph,key,short])=>button(`${mobile?'mobile':'nav'}${id}`,port.snapshot().primary===name?'active':'',glyph,key,'static-primary',{'data-primary':name,...(!mobile?{'data-explorer':'true','aria-expanded':port.snapshot().primary===name?String(!port.snapshot().collapsed):undefined}:{})},[icon(glyph),mobile?<span class="mobile-tab-label">{tr(short)}</span>:null,name==='settings'?settingsDot(mobile):null]));
  const language=(mobile=false)=>button(mobile?'mobileLanguageToggle':'languageToggle',`${mobile?'mobile-brand-action ':''}language-toggle${mobile?' icon-button':''}`,'languages','login:switch_language','static-language-toggle');
  const theme=(mobile=false)=>button(mobile?'':'themeToggle',`${mobile?'mobile-brand-action ':''}theme-toggle${mobile?' icon-button':''}`,port.snapshot().theme==='dark'?'sun':'moon',port.snapshot().theme==='dark'?'common:auto.switch_to_light':'common:auto.switch_to_dark','static-theme-toggle');
  const mount=(selector:string,view:()=>unknown)=>{
    const target=document.querySelector<HTMLElement>(selector);
    if(!target)return;
    target.replaceChildren();target.classList.add('terma-vue-root','terma-shell-root');target.dataset.termaShellOwned='';target.setAttribute('data-i18n-skip','');mounts.set(target,{view,tr});
  };
  mount('.brand',()=>[
    <h1 aria-label="Terma"><img class="brand-mark" src="/assets/terma-icon.png" alt="" aria-hidden="true" /><span class="brand-name-full" aria-hidden="true">Terma</span></h1>,
    button('operationPaneExpand','operation-pane-expand icon-button','','common:auto.expand_operation_pane','static-operation-expand',{},[<img class="brand-mark" src="/assets/terma-icon.png" alt="" aria-hidden="true" />]),
    <div class="side-actions">{button('operationPanePin',`operation-pane-pin icon-button${port.snapshot().pinned?' is-pinned':''}`,port.snapshot().pinned?'pin':'pin-off',port.snapshot().pinned?'common:auto.operation_pane_pinned':'common:workspace.operation_pane_auto_collapse','static-operation-pin',{'aria-pressed':String(port.snapshot().pinned),'data-icon':port.snapshot().pinned?'pin':'pin-off'})}{button('operationPaneCollapse','operation-pane-collapse icon-button','panel-left-close','common:auto.collapse_operation_pane','static-operation-collapse')}{language(true)}{theme(true)}{button('','mobile-brand-action icon-button','refresh-cw','common:auto.refresh_data','static-refresh')}</div>,
    <div id="operationPanePinGuide" class="operation-pane-pin-guide" role="region" aria-label={tr('common:auto.operation_pane_guide')} aria-live="polite" hidden={!port.snapshot().guide}><div><strong>{tr('common:auto.pin_operation_pane')}</strong><span>{tr('common:auto.operation_pane_guide_text')}</span></div>{button('','icon-button','x','common:auto.close_hint','static-operation-guide-dismiss')}</div>
  ]);
  mount('.activity',()=>[<div class="activity-top">{nav(false)}</div>,<div class="activity-bottom">{language()}{theme()}{button('activityRefresh','','refresh-cw','common:auto.refresh_data','static-refresh')}{github()}</div>,<div id="activityBarResize" class="activity-bar-resizer" role="separator" aria-orientation="vertical" aria-label={tr('common:auto.adjust_activity_bar')} tabindex="0" title={tr('common:auto.adjust_activity_bar_hint')} />]);
  mount('.mobile-tabs',()=>[...nav(true),github(true)]);
  mount('.workspace-heading',()=>[<div class="workspace-heading-title"><strong id="workspaceTitle">{tr('navigation:auto.workspace')}</strong>{button('','icon-button workspace-quick-connect-button','server','common:auto.quick_open','quick-connect-open')}</div>,<div id="workspaceSubtitle" class="cmd">{port.snapshot().subtitle}</div>]);
  refreshShellViews();
  const activityResize = document.getElementById('activityBarResize');
  if (activityResize) workspaceServices.termaWorkspaceChrome?.bind(activityResize, 'activity');
  window.addEventListener('terma:language-changed',refreshShellViews);
}
