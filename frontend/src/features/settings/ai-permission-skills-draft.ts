import {notify} from '@/features/efficiency/notification-actions';
import { confirmModal } from '@/shared/workspace-prompts';
import { reactive } from 'vue';
import { aiPermissions, type normalizeAiSettingsResponse } from './ai-settings-model';

type AiSettings = ReturnType<typeof normalizeAiSettingsResponse>;
type Translate = NonNullable<Parameters<typeof normalizeAiSettingsResponse>[1]>;

const emptySkill = () => ({name:'',description:'',prompt:''});
export const aiSkillInput = reactive(emptySkill());
export const aiPermissionSkills = reactive({
  permission:'confirm' as AiSettings['terminal_ai_permission'], confirming:false,
  skills:[] as AiSettings['user_skills'], dirty:false
});

export function loadAiPermissionSkills(ai: AiSettings) {
  aiPermissionSkills.permission = ai.terminal_ai_permission;
  aiPermissionSkills.skills = ai.user_skills;
  aiPermissionSkills.dirty = false;
}

export async function chooseAiPermission(event: Event, tr: Translate) {
  const element = event.currentTarget as HTMLSelectElement;
  const next = aiPermissions.find(permission => permission === element.value) ?? 'confirm';
  element.value = aiPermissionSkills.permission;
  if (aiPermissionSkills.confirming || next === aiPermissionSkills.permission) return;
  if (next === 'full') {
    aiPermissionSkills.confirming = true;
    try {
      const approved = await confirmModal(tr('settings:ai.permission_full_warning'), tr('settings:ai.permission_full_title'),
        tr('settings:ai.permission_full_enable'), tr('common:actions.cancel'), true);
      if (!approved || !element.isConnected) return;
    } finally { aiPermissionSkills.confirming = false; }
  }
  aiPermissionSkills.permission = next;
  aiPermissionSkills.dirty = true;
}

export function addAiUserSkill(tr: Translate) {
  const name = aiSkillInput.name.trim();
  const prompt = aiSkillInput.prompt.trim();
  if (!name || !prompt) return notify(tr('settings:ai.skill_required'), 'error');
  const prefix = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'skill';
  const now = Date.now();
  const id = `${prefix}-${now.toString(36)}`;
  if (aiPermissionSkills.skills.some(item => item.id === id)) return;
  aiPermissionSkills.skills.push({id,name:name.slice(0,120),description:aiSkillInput.description.trim().slice(0,300),
    prompt:prompt.slice(0,12000),enabled:true});
  aiPermissionSkills.dirty = true;
  Object.assign(aiSkillInput, emptySkill());
}
