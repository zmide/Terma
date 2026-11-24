import { reactive } from 'vue';
import { aiApiType, aiDefaultEndpoint, aiDefaultProviderName, normalizeAiSettingsResponse } from './ai-settings-model';

type AiSettings = ReturnType<typeof normalizeAiSettingsResponse>;
type Provider = AiSettings['providers'][number] & {clear_api_key?: boolean};
type Translate = NonNullable<Parameters<typeof normalizeAiSettingsResponse>[1]>;

export function createAiProviderDraft() {
  const state = reactive({ providers: [] as Provider[], activeId: '', dirty: false, custom: false, models: [] as string[] });
  let nextId = 0;

  function reset(ai: AiSettings) {
    state.providers = ai.providers.map(({api_key: _ignored, ...provider}) => provider);
    state.activeId = ai.active_provider_id;
    state.dirty = false;
    state.custom = false;
    state.models = [];
  }

  function active() { return state.providers.find(provider => provider.id === state.activeId) ?? state.providers[0]; }

  function select(id: string) {
    if (id === state.activeId || !state.providers.some(provider => provider.id === id)) return;
    state.activeId = id;
    state.custom = false;
    state.models = [];
    state.dirty = true;
  }

  function add(translate: Translate) {
    if (state.providers.length >= 12) return false;
    const id = `provider-${Date.now().toString(36)}-${(++nextId).toString(36)}`;
    state.providers.push({id,name: aiDefaultProviderName(state.providers.length + 1, translate), provider:'openai-compatible',
      endpoint:aiDefaultEndpoint, model:'', api_type:'responses', api_key_configured:false, default_name:true});
    select(id);
    return true;
  }

  function remove() {
    const index = state.providers.findIndex(provider => provider.id === state.activeId);
    if (state.providers.length <= 1 || index < 0) return false;
    state.providers.splice(index, 1);
    select(state.providers[Math.max(0, index - 1)].id);
    return true;
  }

  function edit(change: Partial<Pick<Provider, 'name'|'endpoint'|'model'|'api_key'|'api_type'|'clear_api_key'>>) {
    const provider = active();
    if (!provider) return;
    if (change.name !== undefined) provider.default_name = false;
    Object.assign(provider, change);
    state.dirty = true;
  }

  function payload() {
    return state.providers.map(item => ({id:item.id, name:item.name.trim(), default_name:item.default_name === true,
      provider:'openai-compatible', endpoint:item.endpoint.trim(), model:item.model.trim(), api_type:aiApiType(item.api_type),
      ...(item.api_key?.trim() ? {api_key:item.api_key.trim()} : {}), ...(item.clear_api_key ? {clear_api_key:true} : {})}));
  }

  return { state, active, select, add, remove, edit, reset, payload };
}
