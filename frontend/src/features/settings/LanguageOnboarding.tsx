import { defineComponent, ref, type PropType } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import type { TermaLanguage } from '@/shared/i18n/runtime';
import type { SettingsDialogPort } from './settings-dialog-port';
import type { LanguageOnboardingView } from './language-settings-controller';

export const LanguageOnboarding = defineComponent({
  props: {
    view: { type: Object as PropType<LanguageOnboardingView>, required: true },
    scope: { type: Object as PropType<SettingsDialogPort>, required: true }
  },
  setup(props) {
    const selected = ref(props.view.language);
    const saving = ref(false);
    const copy = (key: string, language = selected.value) => props.scope.tr(`settings:language_onboarding.${key}`, { lng: language });

    async function submit(event: SubmitEvent) {
      event.preventDefault();
      if (saving.value) return;
      saving.value = true;
      try {
        if (await props.view.submit(selected.value) && (event.target as Element).isConnected) props.scope.closeModal();
      } finally { saving.value = false; }
    }

    function choice(language: TermaLanguage) {
      const english = language === 'en-US';
      return <label lang={language} class={['language-onboarding-option', { selected: selected.value === language }]}>
        <input type="radio" name="terma-onboarding-language" value={language} checked={selected.value === language}
          disabled={saving.value} onChange={() => { selected.value = language; }} />
        <span>
          <strong>{english ? 'English' : props.scope.tr('common:languages.zh-CN', { lng: language })}</strong>
          <small>{copy(english ? 'english_detail' : 'chinese_detail', language)}</small>
        </span>
      </label>;
    }

    return () => <form class="modal-card language-onboarding" data-i18n-skip="" data-new-user={String(props.view.isNew)}
      lang={selected.value} aria-labelledby="languageOnboardingTitle" onSubmit={submit}>
      <div class="language-onboarding-mark" aria-hidden="true">T</div>
      <div class="language-onboarding-copy">
        <h2 id="languageOnboardingTitle">{copy('title')}</h2>
        <p class="language-onboarding-message">{copy(props.view.isNew ? 'new_user_message' : 'existing_user_message')}</p>
      </div>
      <div class="language-onboarding-options">{choice('en-US')}{choice('zh-CN')}</div>
      <div class="language-onboarding-note">{copy('switch_hint')}</div>
      <div class="actions"><TermaButton class="primary" type="submit" disabled={saving.value} aria-busy={saving.value || undefined}>
        {copy(saving.value ? 'saving' : 'continue')}
      </TermaButton></div>
    </form>;
  }
});
