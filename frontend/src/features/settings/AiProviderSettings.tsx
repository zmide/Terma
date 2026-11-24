import {notify} from '@/features/efficiency/notification-actions';
import { defineComponent, h, nextTick, ref, type PropType } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon } from './settings-icon';
import { SettingsPasswordField } from './SettingsPasswordField';
import type { SettingsViewPort } from './settings-port';
import { aiApiType, aiDefaultEndpoint, aiDefaultProviderName } from './ai-settings-model';
import { aiProviderDraft, aiSettingsBusy, removeAiProvider, runAiSettingsAction, selectAiProvider, syncAiProviderDraft } from './ai-settings-actions';
const input = (event: Event) => event.currentTarget as HTMLInputElement;

export const AiProviderSettings = defineComponent({
  props: { scope: { type: Object as PropType<SettingsViewPort>, required: true } },
  setup(props) {
    const nameInput = ref<HTMLInputElement>();
    const customInput = ref<HTMLInputElement>();
    const {state,active,edit} = aiProviderDraft;
    const tr = (key: string, options?: Record<string, unknown>) => props.scope.tr(`settings:ai.${key}`, options);
    function add() {
      if (!aiProviderDraft.add(props.scope.tr)) return notify(tr('provider_limit'), 'error');
      void nextTick(() => nameInput.value?.focus());
    }
    function modelChange(event: Event) {
      const model = input(event).value;
      state.custom = model === '__custom__';
      if (state.custom) void nextTick(() => customInput.value?.focus());
      else edit({model});
    }
    return () => {
      syncAiProviderDraft(props.scope);
      const provider = active();
      if (!provider) return null;
      const models = [...new Set([provider.model, ...state.models].filter(Boolean))];
      const providerName = (item: typeof provider, index: number) => item.default_name ? aiDefaultProviderName(index + 1, props.scope.tr) : item.name;
      const disabled = aiSettingsBusy.save;
      return <>
        <div class="terminal-ai-provider-toolbar" data-terma-managed-fields="">
          <div class="terminal-ai-provider-picker">
            <label for="terminalAiProviderSelect">{tr('provider')}</label>
            <select id="terminalAiProviderSelect" value={provider.id} disabled={disabled} onChange={event => selectAiProvider(input(event).value)}>
              {state.providers.map((item,index) => <option key={item.id} value={item.id}>{providerName(item,index)}{item.api_key_configured ? ` · ${tr('provider_key_configured')}` : ''}</option>)}
            </select>
          </div>
          <div class="terminal-ai-provider-actions">
            <TermaButton disabled={disabled} onClick={add} title={tr('provider_add')}>{settingsIcon('plus')}<span>{tr('provider_add')}</span></TermaButton>
            <TermaButton class="icon-button danger" disabled={disabled} onClick={() => {
              if (!removeAiProvider()) notify(tr('provider_last'), 'error');
            }} title={tr('provider_remove')} aria-label={tr('provider_remove')}>{settingsIcon('trash-2')}</TermaButton>
          </div>
        </div>
        <div class="terminal-ai-provider-meta" data-terma-managed-fields="">
          <label for="terminalAiProviderName">{tr('provider_name')}</label>
          <input id="terminalAiProviderName" ref={nameInput} value={providerName(provider,state.providers.indexOf(provider))} maxlength="120" spellcheck="false"
            disabled={disabled} onInput={event => edit({name:input(event).value})} />
          <small class="muted">{tr('provider_type_hint')}</small>
        </div>
        <div class="grid terminal-ai-settings-grid" data-terma-managed-fields="">
          <div>
            <label for="terminalAiEndpoint">{tr('endpoint')}</label>
            <input id="terminalAiEndpoint" value={provider.endpoint} maxlength="2048" spellcheck="false" placeholder={aiDefaultEndpoint}
              disabled={disabled} onInput={event => { edit({endpoint: input(event).value}); state.models = []; }} />
          </div>
          <div>
            <label for="terminalAiModel">{tr('model')}</label>
            <div class="terminal-ai-model-row">
              <select id="terminalAiModel" value={state.custom ? '__custom__' : provider.model} disabled={disabled} onChange={modelChange}>
                <option value="">{tr('model_select')}</option>
                {models.map(model => <option key={model} value={model}>{model}</option>)}
                <option value="__custom__">{tr('model_custom')}</option>
              </select>
              <TermaButton id="terminalAiModelsBtn" disabled={disabled||aiSettingsBusy.models} loading={aiSettingsBusy.models} title={tr('fetch_models')}
                onClick={event => runAiSettingsAction('models', event, props.scope.tr)}>{settingsIcon('refresh-cw')}<span>{tr('fetch_models_short')}</span></TermaButton>
            </div>
            <input id="terminalAiModelCustom" class="terminal-ai-model-custom" ref={customInput} value={state.custom ? provider.model : ''} maxlength="200"
              spellcheck="false" placeholder={tr('model_custom_placeholder')} hidden={!state.custom} disabled={disabled||!state.custom}
              onInput={event => edit({model:input(event).value})} />
          </div>
        </div>
        <div class="grid terminal-ai-settings-grid" data-terma-managed-fields="">
          <div>
            <label for="terminalAiApiType">{tr('api_type')}</label>
            <select id="terminalAiApiType" value={provider.api_type} disabled={disabled} onChange={event => edit({api_type:aiApiType(input(event).value)})}>
              <option value="responses">{tr('responses')}</option><option value="completions">{tr('completions')}</option>
            </select>
          </div>
          <div>
            <label for="terminalAiApiKey">{tr('api_key')}</label>
            {h(SettingsPasswordField,{key:provider.id,id:'terminalAiApiKey',autocomplete:'new-password',spellcheck:'false',value:provider.api_key||'',
              disabled,placeholder:tr(provider.api_key_configured ? 'key_keep_placeholder' : 'key_placeholder'),
              showLabel:props.scope.tr('common:auto.show_password'),hideLabel:props.scope.tr('common:auto.hide_password'),
              onInput:(event:Event)=>edit({api_key:input(event).value})})}
            <label class="check-row compact"><input id="terminalAiClearKey" type="checkbox" checked={provider.clear_api_key === true}
              disabled={disabled} onChange={event => edit({clear_api_key:input(event).checked})} /> {tr('clear_key')}</label>
            <small class="muted">{tr(provider.api_key_configured ? 'key_configured' : 'key_not_configured')}</small>
          </div>
        </div>
      </>;
    };
  }
});
