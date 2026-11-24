import { defineComponent } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { aiPermissions } from './ai-settings-model';
import { addAiUserSkill, aiPermissionSkills, aiSkillInput, chooseAiPermission } from './ai-permission-skills-draft';
import { settingsIcon } from './settings-icon';

type Translate = Parameters<typeof chooseAiPermission>[1];
const value = (event: Event) => (event.currentTarget as HTMLInputElement).value;

export const AiPermission = defineComponent({
  props:{ tr:{type:Function,required:true}, saving:Boolean },
  setup(props) {
    const text = (key:string) => props.tr(`settings:ai.${key}`);
    return () => <div data-terma-managed-fields>
      <label for="terminalAiPermission">{text('permission')}</label>
      <select id="terminalAiPermission" value={aiPermissionSkills.permission} disabled={props.saving || aiPermissionSkills.confirming}
        onChange={event => {if (!props.saving) void chooseAiPermission(event,props.tr as Translate);}}>
        {aiPermissions.map(permission => <option key={permission} value={permission}>{text(`permission_${permission}`)}</option>)}
      </select>
    </div>;
  }
});

export const AiUserSkills = defineComponent({
  props:{ tr:{type:Function,required:true}, saving:Boolean },
  setup(props) {
    const text = (key:string) => props.tr(`settings:ai.${key}`);
    const updateSkills = () => {aiPermissionSkills.dirty = true;};
    function remove(id:string) {
      aiPermissionSkills.skills = aiPermissionSkills.skills.filter(item => item.id !== id);
      updateSkills();
    }
    return () => <fieldset class="terminal-ai-skills" data-terma-managed-fields>
      <legend>{text('user_skills')}</legend>
      <div id="terminalAiUserSkillsList" class="terminal-ai-user-skills-list">
        {aiPermissionSkills.skills.map(item => <div class="terminal-ai-user-skill-row" key={item.id} data-user-skill-id={item.id}>
          <label class="check-row"><input type="checkbox" data-user-skill-enabled checked={item.enabled} disabled={props.saving}
            onChange={event => {item.enabled = (event.currentTarget as HTMLInputElement).checked;updateSkills();}}/><span>{item.name}</span></label>
          <small>{item.description}</small>
          <TermaButton type="button" class="icon-button danger" title={text('skill_remove')} aria-label={text('skill_remove')}
            disabled={props.saving} onClick={() => remove(item.id)}>{settingsIcon('trash-2')}</TermaButton>
        </div>)}
      </div>
      <div class="terminal-ai-user-skill-editor">
        <input id="terminalAiSkillName" maxlength="120" placeholder={text('skill_name')} value={aiSkillInput.name} disabled={props.saving}
          onInput={event => {aiSkillInput.name = value(event);}}/>
        <input id="terminalAiSkillDescription" maxlength="300" placeholder={text('skill_description')} value={aiSkillInput.description}
          disabled={props.saving} onInput={event => {aiSkillInput.description = value(event);}}/>
        <textarea id="terminalAiSkillPrompt" maxlength="12000" rows={2} placeholder={text('skill_prompt')} value={aiSkillInput.prompt}
          disabled={props.saving} onInput={event => {aiSkillInput.prompt = value(event);}}/>
        <TermaButton id="terminalAiSkillAdd" type="button" disabled={props.saving} onClick={() => addAiUserSkill(props.tr as Translate)}>
          {settingsIcon('plus')}<span>{text('skill_add')}</span>
        </TermaButton>
      </div>
      <div class="muted">{text('user_skills_hint')}</div>
    </fieldset>;
  }
});
