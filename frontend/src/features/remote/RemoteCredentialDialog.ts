import { h, render } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { SettingsPasswordField } from '@/features/settings/SettingsPasswordField';
import { settingsIcon as icon } from '@/features/settings/settings-icon';

export interface RemoteCredentialOptions {
  host: string;
  context: string;
  username: string;
  port: string;
  password: string;
  busy: boolean;
  phase: 'idle' | 'verifying' | 'saving' | 'error';
  error: string;
  labels: { title: string; close: string; cancel: string; hostHint: string; username: string; port: string; password: string; showPassword: string; hidePassword: string; save: string; hint: string; verifying: string; saving: string; submit: string; busy: string };
  change(field: 'username' | 'port' | 'password', value: string): void;
  submit(): void;
  cancel(): void;
}

export function remoteCredentialsView(options: RemoteCredentialOptions) {
  const field = (name: 'username' | 'port' | 'password', id: string, label: string) => {
    const attrs = {
      id,
      min:name === 'port' ? 1 : undefined, max:name === 'port' ? 65535 : undefined,
      required:true, disabled:options.busy, autocomplete:name === 'password' ? 'current-password' : name === 'username' ? 'username' : 'off',
      value:options[name], onInput:(event: Event)=>options.change(name,(event.target as HTMLInputElement).value)
    };
    const input = name === 'password'
      ? h(SettingsPasswordField, {...attrs, showLabel:options.labels.showPassword, hideLabel:options.labels.hidePassword})
      : h('input', {...attrs, type:name === 'port' ? 'number' : 'text'});
    return h('div', null, [h('label', {for:id}, label), input]);
  };
  return h('form', {class:'modal-card ssh-credential-repair-modal',role:'dialog','aria-modal':'true','aria-labelledby':'remoteCredentialRepairTitle',
    'aria-busy':options.busy, onSubmit:(event: Event)=>{event.preventDefault();options.submit();},
    onKeydown:(event: KeyboardEvent)=>{
      if(event.key === 'Escape') {event.preventDefault();if(!options.busy) options.cancel();}
      if(event.key === 'Tab') {
        const fields=Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)'));
        if(event.shiftKey && document.activeElement===fields[0]) {event.preventDefault();fields.at(-1)?.focus();}
        else if(!event.shiftKey && document.activeElement===fields.at(-1)) {event.preventDefault();fields[0]?.focus();}
      }
    }
  },[
    h('div',{class:'modal-title-row'},[
      h('div',null,[h('h2',{id:'remoteCredentialRepairTitle'},options.labels.title),h('span',{class:'muted'},options.context)]),
      h(TermaButton,{class:'icon-button',type:'button',disabled:options.busy,title:options.labels.close,'aria-label':options.labels.close,onClick:options.cancel},()=>icon('x'))
    ]),
    h('div',{class:'ssh-credential-target'},[h('span',null,[icon('server')]),h('div',null,[h('strong',null,options.host),h('small',null,options.labels.hostHint)])]),
    h('div',{class:'grid'},[field('username','remoteCredentialUser',options.labels.username),field('port','remoteCredentialPort',options.labels.port)]),
    field('password','remoteCredentialPassword',options.labels.password),
    h('label',{class:'checkline ssh-credential-save'},[h('input',{id:'remoteCredentialSave',type:'checkbox',checked:true,disabled:true}),h('span',null,options.labels.save)]),
    h('div',{id:'remoteCredentialStatus',class:['connection-test-status',options.busy ? 'busy' : options.phase === 'error' ? 'error' : ''],'aria-live':'polite'},options.phase === 'error' ? options.error : options.phase === 'saving' ? options.labels.saving : options.busy ? options.labels.verifying : options.labels.hint),
    h('div',{class:'actions'},[
      h(TermaButton,{type:'button',disabled:options.busy,onClick:options.cancel},()=>options.labels.cancel),
      h(TermaButton,{id:'remoteCredentialConnect',class:'primary',type:'submit',disabled:options.busy},()=>[icon('link-2'),h('span',null,options.busy ? options.labels.busy : options.labels.submit)])
    ])
  ]);
}
export function renderRemoteCredentials(target: HTMLElement, options: RemoteCredentialOptions) {render(remoteCredentialsView(options), target);}
