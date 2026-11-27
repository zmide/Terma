import { defineComponent, nextTick, ref, type PropType } from 'vue';
import type { i18n } from 'i18next';
import { ApiError, TermaApiClient } from '@/shared/api/client';
import type { LoginLanguage, LoginTranslation } from '@/shared/login-i18n';

function initialLanguage(): LoginLanguage {
  const stored = typeof localStorage === 'undefined' ? '' : localStorage.getItem('termaLoginLanguage');
  if (stored === 'zh-CN' || stored === 'en-US') return stored;
  const languages = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  const region = languages.map(value => {
    try { return new Intl.Locale(String(value).replace(/_/g, '-')).maximize().region || ''; }
    catch { return ''; }
  }).find(Boolean);
  return region === 'CN' ? 'zh-CN' : 'en-US';
}

export const LoginPage = defineComponent({
  name: 'LoginPage',
  props: {
    i18n: { type: Object as PropType<i18n>, required: true },
    fnos: { type: Boolean, default: false }
  },
  setup(props) {
    const language = ref<LoginLanguage>(initialLanguage());
    const password = ref('');
    const passwordVisible = ref(false);
    const busy = ref(false);
    const loginError = ref<unknown>(null);
    const passwordInput = ref<HTMLInputElement | null>(null);
    const tr = (key: LoginTranslation, values?: Record<string, unknown>) => {
      const fixed = props.i18n.getFixedT(language.value, 'login');
      return fixed(key, values);
    };
    const api = new TermaApiClient({
      baseUrl: String(import.meta.env.TERMA_PUBLIC_API_BASE_URL || '').trim() || undefined
    });

    const syncLanguage = (value: LoginLanguage) => {
      language.value = value;
      document.documentElement.lang = value;
      document.title = tr('title');
      localStorage.setItem('termaLoginLanguage', value);
    };
    const toggleLanguage = () => syncLanguage(language.value === 'zh-CN' ? 'en-US' : 'zh-CN');
    const togglePassword = async () => {
      const start = passwordInput.value?.selectionStart ?? null;
      const end = passwordInput.value?.selectionEnd ?? null;
      passwordVisible.value = !passwordVisible.value;
      await nextTick();
      passwordInput.value?.focus({ preventScroll: true });
      if (start !== null && end !== null) {
        try { passwordInput.value?.setSelectionRange(start, end); } catch {}
      }
    };
    const localizedError = (error: unknown) => {
      if (!(error instanceof ApiError)) return tr('failed');
      const seconds = Number(error.details.error_params && typeof error.details.error_params.seconds === 'number' ? error.details.error_params.seconds : 0) || 1;
      if (error.publicCode === 'auth_login_rate_limited') return tr('tooManyAttempts', { seconds });
      if (error.publicCode === 'auth_login_temporarily_locked') return tr('temporarilyLocked', { seconds });
      if (error.publicCode === 'auth_login_not_configured') return tr('notConfigured');
      if (error.publicCode === 'auth_login_invalid') return tr('invalid');
      const params = error.details.error_params || {};
      if (error.publicCode === 'host_not_allowed' && typeof params.host === 'string') return tr('hostNotAllowed', params);
      if (error.publicCode === 'request_origin_protocol_mismatch') return tr('protocolMismatch');
      if (error.publicCode === 'request_origin_forbidden') {
        if (params.reason === 'hostname_mismatch') return tr('originHostMismatch', params);
        if (params.reason === 'port_mismatch') return tr('originPortMismatch', params);
        if (params.reason === 'invalid_origin') return tr('originInvalid');
      }
      if (error.publicCode === 'request_origin_forbidden' || error.message === 'Forbidden') return tr('originForbidden');
      return tr('failed');
    };
    const login = async () => {
      if (busy.value || !password.value) return;
      busy.value = true;
      loginError.value = null;
      try {
        await api.login(password.value);
        window.location.assign('/');
      } catch (error) {
        loginError.value = error;
      } finally {
        busy.value = false;
      }
    };
    document.documentElement.lang = language.value;
    document.title = tr('title');
    return () => (
      <main class="terma-login-root" data-language={language.value}>
        <button type="button" class="login-language-toggle" title={tr('switchLanguage')} aria-label={tr('switchLanguage')} onClick={toggleLanguage}>文/A</button>
        <section class="login-card" aria-labelledby="login-title">
          <h1 id="login-title">{tr('title')}</h1>
          <p class="login-muted">{tr('description')}</p>
          <label class="login-label" for="login-password">{tr('credential')}</label>
          <div class="login-password-field">
            <input
              ref={passwordInput}
              id="login-password"
              type={passwordVisible.value ? 'text' : 'password'}
              autocomplete="current-password"
              autofocus
              value={password.value}
              onInput={(event) => { password.value = (event.target as HTMLInputElement).value; }}
              onKeydown={(event) => { if (event.key === 'Enter') void login(); }}
            />
            <button type="button" class="login-password-toggle" title={passwordVisible.value ? tr('hidePassword') : tr('showPassword')} aria-label={passwordVisible.value ? tr('hidePassword') : tr('showPassword')} aria-pressed={passwordVisible.value} onClick={() => { void togglePassword(); }}>
              {passwordVisible.value ? (
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c6.5 0 10 8 10 8a18.3 18.3 0 0 1-2.3 3.5" /><path d="M6.6 6.6C3.7 8.5 2 12 2 12s3.5 8 10 8a10.8 10.8 0 0 0 5.4-1.4" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
              )}
            </button>
          </div>
          <button type="button" class="login-submit" disabled={busy.value || !password.value} onClick={() => { void login(); }}>{tr('submit')}</button>
          <div class="login-error" role="alert" aria-live="polite">{loginError.value ? localizedError(loginError.value) : ''}</div>
          <p class="login-setup-hint">{tr(props.fnos ? 'fnosSetupHint' : 'setupHint')}</p>
        </section>
      </main>
    );
  }
});
