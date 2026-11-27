import {settingsServices} from '@/features/settings/installed-services';
import {tr as workspaceTranslation} from '@/shared/i18n/workspace-bootstrap';
import { computed, defineComponent, nextTick, onBeforeUnmount, onMounted, ref, watch, type PropType } from 'vue';
import type { i18n } from 'i18next';
import { TermaButton } from '@/shared/ui/TermaButton';
import { TermaLink } from '@/shared/ui/TermaLink';
import { TermaApiClient } from '@/shared/api/client';
import type { AboutLanguage, AboutTranslation } from '@/shared/about-i18n';
import { UpdatePanel } from '@/app/UpdatePanel';
import type { UpdateConfirmation, UpdateViewSnapshot } from '@/features/settings/update-status-model';
import { installDialogWindows } from '@/shared/dialog-window';

interface AboutComponent {
  name?: string;
  version?: string;
  license?: string;
  project_url?: string;
  use?: string;
}

export interface AboutInfo {
  product_name?: string;
  version?: string;
  author?: string;
  license?: string;
  license_name?: string;
  license_available?: boolean;
  license_error?: string;
  license_text?: string;
  load_error?: string;
  repository_url?: string;
  third_party_components?: AboutComponent[];
  third_party_notices_available?: boolean;
  third_party_notices_error?: string;
}

type LoadState = 'loading' | 'ready' | 'error';
type AboutPart = 'all';

interface AboutWindow extends Window {
  tr?: (key: string, options?: Record<string, unknown>) => string;
  refreshIcons?: () => void;
}

function initialUpdateSnapshot(): UpdateViewSnapshot {
  return settingsServices.termaUpdateStatus?.snapshot() || {
    update: null,
    checking: true,
    fnos: false,
    releaseUrl: ''
  };
}

function initialLanguage(): AboutLanguage {
  const documentLanguage = typeof document === 'undefined' ? '' : document.documentElement.lang;
  return documentLanguage.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

function initialTheme(): 'light' | 'dark' {
  if (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark') return 'dark';
  if (typeof localStorage !== 'undefined' && localStorage.getItem('theme') === 'dark') return 'dark';
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

const purposeKeys: Record<string, AboutTranslation> = {
  interface_framework: 'purposeInterfaceFramework',
  interface_components: 'purposeInterfaceComponents',
  interface_theme: 'purposeInterfaceTheme',
  terminal: 'purposeTerminal',
  sftp_text_edit: 'purposeSftpTextEdit',
  sftp_diff: 'purposeSftpDiff',
  builtin_vnc: 'purposeBuiltinVnc',
  zmodem_transfer: 'purposeZmodemTransfer',
  ssh_sftp_transport: 'purposeSshSftpTransport',
  ftp_transport: 'purposeFtpTransport',
  html_sanitization: 'purposeHtmlSanitization',
  x11_protocol_client: 'purposeX11ProtocolClient',
  interface_i18n: 'purposeInterfaceI18n',
  interface_icons: 'purposeInterfaceIcons',
  desktop_runtime: 'purposeDesktopRuntime',
  desktop_pty: 'purposeDesktopPty',
  windows_x_server: 'purposeWindowsXServer',
  svg_pdf_cjk_font: 'purposeSvgPdfCjkFont'
};

export const AboutPage = defineComponent({
  name: 'AboutPage',
  props: {
    i18n: { type: Object as PropType<i18n>, required: true },
    embedded: { type: Boolean, default: false },
    part: { type: String as PropType<AboutPart>, default: 'all' },
    initialInfo: { type: Object as PropType<AboutInfo>, default: undefined }
  },
  setup(props) {
    const language = ref<AboutLanguage>(initialLanguage());
    const theme = ref<'light' | 'dark'>(initialTheme());
    const info = ref<AboutInfo | null>(props.initialInfo || null);
    const state = ref<LoadState>(props.initialInfo ? 'ready' : 'loading');
    const error = ref('');
    watch(() => props.initialInfo, value => {
      if (value) { info.value = value; state.value = 'ready'; error.value = ''; }
    });
    const licenseOpen = ref(false);
    const licenseTrigger = ref<HTMLButtonElement | null>(null);
    const licenseCloseButton = ref<HTMLButtonElement | null>(null);
    const confirmationCloseButton = ref<HTMLButtonElement | null>(null);
    const updateSnapshot = ref<UpdateViewSnapshot>(initialUpdateSnapshot());
    const confirmation = ref<{ message: string; title: string; confirm: string; cancel: string } | null>(null);
    let confirmationResolve: ((accepted: boolean) => void) | undefined;
    let confirmationTrigger: HTMLElement | null = null;
    const api = new TermaApiClient();
    let themeObserver: MutationObserver | undefined;
    const tr = (key: AboutTranslation, values?: Record<string, unknown>) => props.i18n.getFixedT(language.value, 'about')(key, values);
    for (const closeButton of [licenseCloseButton, confirmationCloseButton]) {
      watch(closeButton, (button, _previous, cleanup) => {
        const backdrop = button?.closest<HTMLElement>('.terma-about-modal-backdrop');
        if (backdrop) cleanup(installDialogWindows(backdrop, { label: () => tr('adjustDialog') }));
      });
    }
    const updateTr = computed(() => {
      const currentLanguage = language.value;
      return (key: string, values?: Record<string, unknown>) => workspaceTranslation(key, {lng:currentLanguage,defaultValue:key,...values});
    });

    const syncDocument = () => {
      if (props.embedded) return;
      document.documentElement.lang = language.value;
      document.documentElement.dataset.theme = theme.value;
      document.title = tr('title');
    };
    const toggleLanguage = () => {
      language.value = language.value === 'zh-CN' ? 'en-US' : 'zh-CN';
      syncDocument();
    };
    const toggleTheme = () => {
      theme.value = theme.value === 'dark' ? 'light' : 'dark';
      if (typeof localStorage !== 'undefined') localStorage.setItem('theme', theme.value);
      syncDocument();
    };
    const load = async () => {
      state.value = 'loading';
      error.value = '';
      try {
        info.value = await api.request<AboutInfo>('/api/about');
        state.value = 'ready';
      } catch (cause) {
        state.value = 'error';
        error.value = cause instanceof Error ? cause.message : String(cause);
      }
    };
    const closeLicense = () => {
      licenseOpen.value = false;
      void nextTick(() => licenseTrigger.value?.focus({ preventScroll: true }));
    };
    const openLicense = (event: MouseEvent) => {
      licenseTrigger.value = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null;
      licenseOpen.value = true;
      void nextTick(() => licenseCloseButton.value?.focus({ preventScroll: true }));
    };
    const finishConfirmation = (accepted: boolean) => {
      const resolve = confirmationResolve;
      confirmationResolve = undefined;
      confirmation.value = null;
      resolve?.(accepted);
      void nextTick(() => confirmationTrigger?.isConnected && confirmationTrigger.focus({ preventScroll: true }));
    };
    const confirmAction: UpdateConfirmation = (message, title, confirm, cancel) => {
      confirmationResolve?.(false);
      confirmationTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      confirmation.value = { message, title, confirm, cancel };
      void nextTick(() => confirmationCloseButton.value?.closest('[role="dialog"]')?.querySelector<HTMLElement>('#terma-about-confirm-cancel')?.focus({ preventScroll: true }));
      return new Promise(resolve => { confirmationResolve = resolve; });
    };
    const onKeydown = (event: KeyboardEvent) => {
      const dialog = (confirmation.value ? confirmationCloseButton : licenseCloseButton).value?.closest('[role="dialog"]');
      if (!dialog?.contains(document.activeElement)) return;
      if (event.key === 'Tab' && (licenseOpen.value || confirmation.value)) {
        const controls = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]') || []);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (first && last && (!dialog?.contains(document.activeElement) || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus({ preventScroll: true });
        }
      }
      if (event.key === 'Escape' && confirmation.value) {
        event.preventDefault();
        event.stopPropagation();
        finishConfirmation(false);
        return;
      }
      if (event.key === 'Escape' && licenseOpen.value) {
        event.preventDefault();
        event.stopPropagation();
        closeLicense();
      }
    };
    const onLanguageChanged = (event: Event) => {
      const next = (event as CustomEvent<{ language?: string }>).detail?.language;
      if (next === 'zh-CN' || next === 'en-US') language.value = next;
    };
    const onUpdateStatusChanged = (event: Event) => {
      const next = (event as CustomEvent<UpdateViewSnapshot>).detail;
      if (next) updateSnapshot.value = next;
    };
    const componentPurpose = (value: string | undefined) => tr(purposeKeys[value || ''] || 'purposeOther');
    const openProject = (item: AboutComponent) => /^https:\/\//i.test(String(item.project_url || '')) ? String(item.project_url) : '';

    onMounted(() => {
      window.addEventListener('keydown', onKeydown);
      if (props.embedded) {
        window.addEventListener('terma:language-changed', onLanguageChanged);
        window.addEventListener('terma:update-status-changed', onUpdateStatusChanged);
        updateSnapshot.value = initialUpdateSnapshot();
        themeObserver = new MutationObserver(() => {
          theme.value = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
        });
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      } else {
        syncDocument();
      }
      if (!props.initialInfo) void load();
    });
    onBeforeUnmount(() => {
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('terma:language-changed', onLanguageChanged);
      window.removeEventListener('terma:update-status-changed', onUpdateStatusChanged);
      themeObserver?.disconnect();
      confirmationResolve?.(false);
    });

    const productInfo = () => info.value?.product_name || 'Terma';
    const versionInfo = () => tr('version', { version: info.value?.version || tr('unknown') });
    const thirdPartyComponents = () => info.value?.third_party_components || [];
    const licenseSummary = () => `${info.value?.license_name || 'GNU General Public License v3.0 only'} (${info.value?.license || 'GPL-3.0-only'})`;
    const componentRows = () => thirdPartyComponents().map(item => {
      const project = openProject(item);
      const name = item.name || tr('unknown');
      return <div class={props.embedded ? 'about-third-party-row' : 'terma-about-row'} role="row" key={`${name}-${item.version || ''}`}><span role="cell">{project ? <a href={project} target="_blank" rel="noopener" title={tr('openProject', { name })}>{name}</a> : name}</span><code role="cell">{item.version || tr('unknown')}</code><span role="cell">{item.license || tr('unknown')}</span><span role="cell">{componentPurpose(item.use)}</span></div>;
    });

    const embeddedPage = () => {
      const notice = info.value?.third_party_notices_available
        ? tr('noticesAvailable')
        : info.value?.third_party_notices_error || tr('noticesMissing');
      return <>
        <div class="settings-group-head"><h3>{tr('title')}</h3><span>{tr('subtitle')}</span></div>
        <div class="settings-grid single">
          <section class="about-section">
        {state.value === 'loading' && !info.value ? <div class="muted" role="status">{tr('loading')}</div> : null}
        {state.value === 'error' && !info.value ? <div class="warning" role="alert">{tr('loadFailed', { error: error.value })}<TermaButton onClick={() => { void load(); }}>{tr('retry')}</TermaButton></div> : null}
        <div class="about-product"><img class="about-mark" src="/assets/terma-icon.png" alt="" aria-hidden="true" /><div><h3>{productInfo()}</h3><div class="muted">{versionInfo()}</div></div></div>
        <dl class="about-meta">
          <div><dt>{tr('license')}</dt><dd>{licenseSummary()}</dd></div>
          <div><dt>{tr('author')}</dt><dd>{info.value?.author || 'zmide'}</dd></div>
          <div><dt>{tr('copyright')}</dt><dd>Copyright (C) 2026 zmide</dd></div>
        </dl>
        {info.value?.load_error || info.value?.license_error ? <div class="warning">{info.value.load_error ? tr('loadFailed', { error: info.value.load_error }) : info.value.license_error}</div> : null}
        <div id="updateCheckArea" class="about-update-area"><UpdatePanel snapshot={updateSnapshot.value} language={language.value} translate={updateTr.value} confirmAction={confirmAction} /></div>
          <div class="muted">{tr('warranty')}</div>
          <div class="actions about-actions">
            <TermaLink id="officialWebsiteBtn" class="about-tile-link" href="http://terma.zmide.com/" target="_blank" rel="noopener"><i data-lucide="globe"></i><span>{tr('officialWebsite')}</span></TermaLink>
            <TermaLink id="githubSourceBtn" class="about-tile-link" href={info.value?.repository_url || 'https://github.com/zmide/Terma'} target="_blank" rel="noopener"><i data-lucide="external-link"></i><span>{tr('githubSource')}</span></TermaLink>
            <TermaButton id="openLicenseBtn" class="about-tile-button" disabled={!info.value?.license_available} onClick={openLicense}><i data-lucide="scroll-text"></i><span>{tr('viewLicense')}</span></TermaButton>
          </div>
          <section class="about-third-party" aria-labelledby="terma-about-components-title">
            <div class="about-third-party-head"><div><h4 id="terma-about-components-title">{tr('bundledComponents')}</h4><span>{tr('bundledComponentsHint')}</span></div><span class="status-pill">{tr('itemCount', { count: thirdPartyComponents().length })}</span></div>
            {thirdPartyComponents().length ? (
              <div class="about-third-party-list" role="table" aria-label={tr('bundledComponents')}>
                <div class="about-third-party-row about-third-party-head-row" role="row"><span role="columnheader">{tr('component')}</span><span role="columnheader">{tr('componentVersion')}</span><span role="columnheader">{tr('componentLicense')}</span><span role="columnheader">{tr('componentPurpose')}</span></div>
                {componentRows()}
              </div>
            ) : <div class="warning">{tr('noticesMissing')}</div>}
            <div class="muted about-third-party-notice">{notice}</div>
          </section>
          </section>
        </div>
        {licenseOpen.value && info.value?.license_text ? <div class="terma-about-modal-backdrop" role="presentation"><section class="terma-about-modal" role="dialog" aria-modal="true" aria-labelledby="terma-about-license-title"><div class="terma-about-modal-head"><h2 id="terma-about-license-title">{tr('license')}</h2><button ref={licenseCloseButton} type="button" class="terma-about-close" aria-label={tr('close')} title={tr('close')} onClick={closeLicense}>×</button></div><pre>{info.value.license_text}</pre><div class="terma-about-modal-actions"><TermaButton onClick={closeLicense}>{tr('close')}</TermaButton></div></section></div> : null}
        {confirmation.value ? <div class="terma-about-modal-backdrop" role="presentation"><section class="terma-about-modal terma-about-confirm" role="dialog" aria-modal="true" aria-labelledby="terma-about-confirm-title" aria-describedby="terma-about-confirm-message"><div class="terma-about-modal-head"><h2 id="terma-about-confirm-title">{confirmation.value.title}</h2><button ref={confirmationCloseButton} type="button" class="terma-about-close" title={tr('close')} aria-label={tr('close')} onClick={() => finishConfirmation(false)}>×</button></div><p id="terma-about-confirm-message" class="terma-about-confirm-message">{confirmation.value.message}</p><div class="terma-about-modal-actions"><TermaButton id="terma-about-confirm-cancel" onClick={() => finishConfirmation(false)}>{confirmation.value.cancel}</TermaButton><TermaButton onClick={() => finishConfirmation(true)}>{confirmation.value.confirm}</TermaButton></div></section></div> : null}
      </>;
    };

    const standalone = () => (
      <main class="terma-vue-root terma-about-root" data-theme={theme.value}>
        <div class="terma-about-shell">
          <header class="terma-about-header">
            <div>
              <div class="terma-about-eyebrow">Terma</div>
              <h1>{tr('title')}</h1>
              <p>{tr('subtitle')}</p>
            </div>
            <div class="terma-about-controls">
              <button type="button" class="terma-about-control" title={tr('language', { language: language.value === 'zh-CN' ? 'English' : '简体中文' })} onClick={toggleLanguage}>文/A</button>
              <button type="button" class="terma-about-control" title={tr(theme.value === 'dark' ? 'light' : 'dark')} aria-label={tr(theme.value === 'dark' ? 'light' : 'dark')} onClick={toggleTheme}>{theme.value === 'dark' ? '☼' : '◐'}</button>
            </div>
          </header>
          {state.value === 'loading' ? <section class="terma-about-card terma-about-state" role="status">{tr('loading')}</section> : null}
          {state.value === 'error' ? <section class="terma-about-card terma-about-state terma-about-error" role="alert"><p>{tr('loadFailed', { error: error.value })}</p><TermaButton onClick={() => { void load(); }}>{tr('retry')}</TermaButton></section> : null}
          {state.value === 'ready' && info.value ? (
            <section class="terma-about-card">
              <div class="terma-about-product">
                <img src="/assets/terma-icon.png" alt="" aria-hidden="true" />
                <div><h2>{info.value.product_name || 'Terma'}</h2><p>{versionInfo()}</p></div>
              </div>
              <dl class="terma-about-meta">
                <div><dt>{tr('license')}</dt><dd>{licenseSummary()}</dd></div>
                <div><dt>{tr('author')}</dt><dd>{info.value.author || tr('unknown')}</dd></div>
                <div><dt>{tr('copyright')}</dt><dd>Copyright (C) 2026 zmide</dd></div>
              </dl>
              {info.value.license_error ? <p class="terma-about-warning">{info.value.license_error}</p> : null}
              <p class="terma-about-note">{tr('warranty')}</p>
              <div class="terma-about-actions">
                <TermaLink href="http://terma.zmide.com/" target="_blank" rel="noopener">{tr('officialWebsite')}</TermaLink>
                <TermaLink href={info.value.repository_url || 'https://github.com/zmide/Terma'} target="_blank" rel="noopener">{tr('githubSource')}</TermaLink>
                <TermaButton disabled={!info.value.license_available} onClick={openLicense}>{tr('viewLicense')}</TermaButton>
              </div>
              <section class="terma-about-components" aria-labelledby="terma-about-components-title">
                <div class="terma-about-components-head"><div><h3 id="terma-about-components-title">{tr('bundledComponents')}</h3><p>{tr('bundledComponentsHint')}</p></div><span>{tr('itemCount', { count: thirdPartyComponents().length })}</span></div>
                <div class="terma-about-table" role="table" aria-label={tr('bundledComponents')}>
                  <div class="terma-about-row terma-about-row-head" role="row"><span>{tr('component')}</span><span>{tr('componentVersion')}</span><span>{tr('componentLicense')}</span><span>{tr('componentPurpose')}</span></div>
                  {componentRows().map(row => row)}
                </div>
                <p class="terma-about-note">{info.value.third_party_notices_available ? tr('noticesAvailable') : (info.value.third_party_notices_error || tr('noticesMissing'))}</p>
              </section>
            </section>
          ) : null}
        </div>
        {licenseOpen.value && info.value?.license_text ? <div class="terma-about-modal-backdrop" role="presentation"><section class="terma-about-modal" role="dialog" aria-modal="true" aria-labelledby="terma-about-license-title"><div class="terma-about-modal-head"><h2 id="terma-about-license-title">{tr('license')}</h2><button ref={licenseCloseButton} type="button" class="terma-about-close" aria-label={tr('close')} title={tr('close')} onClick={closeLicense}>×</button></div><pre>{info.value.license_text}</pre><div class="terma-about-modal-actions"><TermaButton onClick={closeLicense}>{tr('close')}</TermaButton></div></section></div> : null}
      </main>
    );

    return () => {
      if (!props.embedded) return standalone();
      return embeddedPage();
    };
  }
});
