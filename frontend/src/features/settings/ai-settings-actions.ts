import {assistantServices} from '@/features/assistant/installed-services';
import {settingsServices} from '@/features/settings/installed-services';
import {api} from '@/shared/api/workspace-request';
import {notify} from '@/features/efficiency/notification-actions';
import { reactive } from 'vue';
import type { SharedApiBridge } from '@/shared/api/bridge';
import { errorMessage } from '../operations/operations-types';
import { aiReasoningEfforts, normalizeAiSettingsResponse } from './ai-settings-model';
import { createAiProviderDraft } from './ai-provider-draft';
import { aiPermissionSkills, loadAiPermissionSkills } from './ai-permission-skills-draft';
import { loadMcpDraft, mcpDraft } from './ai-mcp-draft';
import { runtimePreferences, normalizeRuntimeSettingsResponse } from './runtime-settings-model';

type Runtime = ReturnType<typeof normalizeRuntimeSettingsResponse>;
type AiSettings = ReturnType<typeof normalizeAiSettingsResponse>;
type Translate = NonNullable<Parameters<typeof normalizeAiSettingsResponse>[1]>;

export const aiProviderDraft = createAiProviderDraft();
export const aiSettingsBusy = reactive({save:false, models:false, test:false});
export const aiTestResult = reactive({visible:false, text:''});
let source: unknown;
let permissionsSource: unknown = Symbol();
let mcpSource: unknown = Symbol();
const modelsByProvider = new Map<string, {endpoint:string; models:string[]}>();

export function syncAiSettingsDetails(value: unknown, ai: AiSettings) {
  if (permissionsSource !== value && !aiPermissionSkills.dirty && !aiPermissionSkills.confirming) {
    permissionsSource = value;
    loadAiPermissionSkills(ai);
  }
  if (mcpSource !== value && !mcpDraft.dirty && !mcpDraft.busy) {
    mcpSource = value;
    loadMcpDraft(ai.mcp_servers);
  }
}

export function syncAiProviderDraft(scope: {runtimeSettings: Runtime | null; tr: Translate}) {
  const value = scope.runtimeSettings?.saved?.ai || scope.runtimeSettings?.ai;
  if (!aiProviderDraft.state.providers.length || (!aiProviderDraft.state.dirty && source !== value)) {
    source = value;
    aiProviderDraft.reset(normalizeAiSettingsResponse(value, scope.tr));
    const active = aiProviderDraft.active();
    if (active) aiProviderDraft.state.models = modelsForProvider(active.id, active.endpoint);
  }
}

function modelsForProvider(id: string, endpoint: string) {
  const cached = modelsByProvider.get(id);
  return cached && cached.endpoint === String(endpoint || '').trim() ? [...cached.models] : [];
}

export function configuredAiModels() {
  const saved = runtimePreferences.snapshot?.saved?.ai;
  return saved ? modelsForProvider(saved.active_provider_id, saved.endpoint) : [];
}

export function selectAiProvider(id: string) {
  aiProviderDraft.select(id);
  const active = aiProviderDraft.active();
  if (active) aiProviderDraft.state.models = modelsForProvider(active.id, active.endpoint);
}

export function removeAiProvider() {
  const id = aiProviderDraft.state.activeId;
  if (!aiProviderDraft.remove()) return false;
  modelsByProvider.delete(id);
  const active = aiProviderDraft.active();
  if (active) aiProviderDraft.state.models = modelsForProvider(active.id, active.endpoint);
  return true;
}

function formPayload(root: HTMLElement, tr: Translate, requireModel = false) {
  const control = (id: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
  const value = (id: string) => control(id)?.value;
  const checked = (id: string) => (control(id) as HTMLInputElement | null)?.checked === true;
  const current = aiProviderDraft.active();
  const endpoint = current?.endpoint.trim() || '';
  const model = current?.model.trim() || '';
  const timeout = Number(value('terminalAiTimeout') || 60);
  const budget = Number(value('terminalAiContextValue') || 1);
  const tokens = Math.round(budget * (value('terminalAiContextUnit') === 'K' ? 1000 : 1000000));
  if (!endpoint) throw Error(tr('settings:ai.endpoint_required'));
  if (requireModel && !model) throw Error(tr('settings:ai.model_required'));
  if (!Number.isInteger(timeout) || timeout < 5 || timeout > 300) throw Error(tr('settings:ai.timeout_invalid'));
  if (!Number.isFinite(budget) || budget <= 0 || tokens < 1000 || tokens > 1000000) throw Error(tr('settings:ai.context_invalid'));
  const ai = {
    enabled:checked('terminalAiEnabled'), provider:'openai-compatible', active_provider_id:aiProviderDraft.state.activeId,
    providers:aiProviderDraft.payload(), endpoint, model, api_type:current?.api_type ?? 'responses', timeout_seconds:timeout,
    context_tokens:tokens, terminal_ai_placement:value('terminalAiPlacement') === 'bottom' ? 'bottom' : 'right',
    terminal_ai_permission:aiPermissionSkills.permission,
    reasoning_effort:aiReasoningEfforts.find(effort => effort === value('terminalAiReasoningEffort')) ?? 'none',
    deep_thinking:checked('terminalAiDeepThinking'),
    skills_enabled:[...root.querySelectorAll<HTMLInputElement>('[data-terminal-ai-skill]:checked')].map(input => input.dataset.terminalAiSkill).filter(Boolean),
    user_skills:aiPermissionSkills.skills,
    mcp_servers:mcpDraft.servers,
    ...(current?.api_key?.trim() ? {api_key:current.api_key.trim()} : {})
  };
  return {ai, clear_api_key:current?.clear_api_key === true};
}

export async function runAiSettingsAction(kind: keyof typeof aiSettingsBusy, event: MouseEvent, tr: Translate) {
  const root = (event.currentTarget as HTMLElement | null)?.closest<HTMLElement>('#settings-ai');
  if (!root || aiSettingsBusy[kind] || aiSettingsBusy.save || (kind === 'save' && (mcpDraft.busy || aiPermissionSkills.confirming))) return;
  const target = root.closest<HTMLElement>('#view-settings');
  aiSettingsBusy[kind] = true;
  try {
    const payload = formPayload(root, tr, kind === 'test');
    if (kind === 'save') {
      const result = await api<unknown>('/api/ai/settings', {method:'PUT',body:JSON.stringify(payload)});
      runtimePreferences.snapshot = normalizeRuntimeSettingsResponse({...runtimePreferences.snapshot, ai:result, saved:{...runtimePreferences.snapshot?.saved, ai:result}});
      assistantServices.termaAssistant.mcp.clear();
      source = runtimePreferences.snapshot.saved.ai;
      aiProviderDraft.reset(runtimePreferences.snapshot.saved.ai);
      permissionsSource = mcpSource = source;
      loadAiPermissionSkills(runtimePreferences.snapshot.saved.ai);
      loadMcpDraft(runtimePreferences.snapshot.saved.ai.mcp_servers, true);
      if (target?.contains(root) && target.isConnected && !target.hidden) settingsServices.termaRefreshVueSettings?.(target, 'settings-ai');
      assistantServices.termaAssistant.syncPlacements();
      for (const [key, state] of assistantServices.termaAssistant?.entries() ?? []) {
        state.permission = runtimePreferences.snapshot.saved.ai.terminal_ai_permission;
        assistantServices.termaAssistant.paint(key);
      }
      notify(tr('settings:ai.saved'), 'success');
    } else if (kind === 'models') {
      const {active_provider_id:id, endpoint} = payload.ai;
      const result = await api<{models?:unknown[]}>('/api/ai/models', {method:'POST',body:JSON.stringify({ai:{...payload.ai,enabled:true}})});
      const models = [...new Set((Array.isArray(result?.models) ? result.models : []).map(item => String(item || '').trim()).filter(Boolean))];
      if (!models.length) throw Error(tr('settings:ai.no_models'));
      if (aiProviderDraft.state.providers.some(provider => provider.id === id && provider.endpoint.trim() === endpoint)) {
        modelsByProvider.set(id, {endpoint, models});
      }
      const current = aiProviderDraft.active();
      if (root.isConnected && current?.id === id && current.endpoint.trim() === endpoint) {
        aiProviderDraft.state.models = models;
        aiProviderDraft.state.custom = false;
        notify(tr('settings:ai.models_loaded',{count:models.length}), 'success');
      }
    } else {
      aiTestResult.visible = true;
      aiTestResult.text = '';
      await assistantServices.termaAssistant.request({message:'hi',contexts:[],mode:'chat',permission:'suggest',locale:document.documentElement.lang,
        ai:{...payload.ai,enabled:true}}, {onDelta:delta => { aiTestResult.text += delta; }});
      notify(tr('settings:ai.test_success'), 'success');
    }
  } catch (error) {
    const message = errorMessage(error, tr(`settings:ai.${kind}_failed`));
    if (kind === 'test' && aiTestResult.visible) aiTestResult.text = message;
    notify(message, 'error');
  } finally { aiSettingsBusy[kind] = false; }
}
