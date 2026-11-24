import {settingsServices} from '@/features/settings/installed-services';
import { computed, defineComponent, nextTick, ref, watch, type PropType } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { TermaLink } from '@/shared/ui/TermaLink';
import { settingsIcon as icon } from '@/features/settings/settings-icon';
import { updateDownloadLinkRows, updateManualLinksAllowed } from '@/features/settings/update-link-model';
import { nextReleaseNotesFrame, releaseNotesPlan, renderReleaseNotes, type ReleaseNoteEntry } from '@/features/settings/release-notes-model';
import { isVerifiedUpdatePackage, selectedFnosUpdateAsset, type UpdateConfirmation, type UpdateRecord, type UpdateTranslate, type UpdateViewSnapshot } from '@/features/settings/update-status-model';

function text(value: unknown): string {
  return String(value ?? '');
}

function formatBytes(value: unknown): string {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

function formatSpeed(value: unknown): string {
  const speed = Number(value || 0);
  return Number.isFinite(speed) && speed > 0 ? `${formatBytes(speed)}/s` : '';
}

function version(value: unknown): string {
  const normalized = text(value).replace(/^v/i, '');
  return normalized ? `v${normalized}` : '';
}

function date(value: unknown, includeTime = false): string {
  if (!value) return '';
  const locale = document.documentElement.lang || 'zh-CN';
  return includeTime
    ? new Date(text(value)).toLocaleString(locale, { hour12: false })
    : new Date(text(value)).toLocaleDateString(locale);
}

export const UpdatePanel = defineComponent({
  name: 'UpdatePanel',
  props: {
    snapshot: { type: Object as PropType<UpdateViewSnapshot>, required: true },
    language: { type: String, required: true },
    translate: { type: Function as PropType<UpdateTranslate>, required: true },
    confirmAction: { type: Function as PropType<UpdateConfirmation>, default: undefined }
  },
  setup(props) {
    const notesElement = ref<HTMLDivElement | null>(null);
    const notesEntries = ref<ReleaseNoteEntry[]>([]);
    let renderedNotesKey = '';
    const ignoredVersion = ref(Boolean(props.snapshot.update?.update_ignored));
    const download = computed(() => props.snapshot.update?.download_status || {});
    const t = (key: string, options?: Record<string, unknown>) => props.translate(key, options);
    const notesPlan = computed(() => releaseNotesPlan(props.snapshot.update, props.language, t('settings:updates.notes_language_unavailable')));
    watch([() => notesPlan.value.key, () => props.snapshot.deferNotes], async ([key, defer], _previous, onCleanup) => {
      if (key === renderedNotesKey) return;
      let active = true;
      onCleanup(() => { active = false; });
      const entries = await renderReleaseNotes(notesPlan.value, t('settings:updates.no_release_notes'), () => active,
        defer ? nextReleaseNotesFrame : undefined);
      if (!active || !entries) return;
      const scrollTop = notesElement.value?.scrollTop ?? 0;
      notesEntries.value = entries;
      renderedNotesKey = key;
      await nextTick();
      if (active && notesElement.value) notesElement.value.scrollTop = scrollTop;
    }, { immediate: true });
    watch(() => props.snapshot.update?.update_ignored, value => { ignoredVersion.value = Boolean(value); });
    const checkButton = (idleKey = 'settings:auto.check_updates') => (
      <TermaButton
        id="checkUpdateBtn"
        disabled={props.snapshot.checking}
        aria-busy={props.snapshot.checking ? 'true' : undefined}
        onClick={() => { void settingsServices.termaUpdateStatus?.refresh(true); }}
      >
        {icon('refresh-cw')}
        <span>{t(props.snapshot.checking ? 'settings:updates.checking_short' : idleKey)}</span>
      </TermaButton>
    );

    const releaseLink = () => props.snapshot.releaseUrl ? (
      <TermaLink class="update-release-link" href={props.snapshot.releaseUrl} target="_blank" rel="noopener noreferrer">
        {icon('external-link')}<span>{t('settings:updates.view_release')}</span>
      </TermaLink>
    ) : null;

    const notes = () => notesEntries.value.length ? (
      <div ref={notesElement} class="update-notes">
        <strong>{t('settings:auto.recent_release_notes', { defaultValue: '最近版本更新内容' })}</strong>
        <div class="update-release-list">
          {notesEntries.value.map((entry, index) => (
            <section class="update-release-entry" key={index}>
              <div class="update-release-head">
                <b>{entry.version ? version(entry.version) : t(index === 0 ? 'settings:auto.latest_release' : 'settings:auto.previous_release')}</b>
                {index === 0 ? <span class="status-pill running">{t('settings:auto.latest_badge')}</span> : null}
                {entry.published ? <small>{entry.published}</small> : null}
              </div>
              <div class="update-release-markdown" innerHTML={entry.markdown}></div>
            </section>
          ))}
        </div>
      </div>
    ) : null;

    const manualDownloadLinks = (assetName: string) => {
      const data = props.snapshot.update;
      if (!updateManualLinksAllowed(data)) return null;
      const currentDownload = data?.download_status;
      const routes = currentDownload?.download_links || [];
      const probe = props.snapshot.probe;
      const links = updateDownloadLinkRows(routes, probe?.results || []).map(({ link, index, url, result, fastest }) => {
        const speed = result?.available ? formatSpeed(result.bytes_per_second) : '';
        const metric = probe?.running
          ? t('settings:updates.probe_running')
          : result
            ? speed
              ? fastest ? t('settings:updates.probe_fastest', { speed }) : speed
              : t('settings:updates.probe_unavailable')
            : '';
        const error = result?.error === '测速超时'
          ? t('settings:updates.probe_timeout')
          : result?.error
            ? props.snapshot.probeError || text(result.error)
            : '';
        const detail = result ? `${result.elapsed_ms || 0} ms${error ? ` · ${error}` : ''}` : '';
        const label = link.id === 'direct'
          ? t('settings:updates.github_download')
          : text(link.label || url.hostname);
        return (
          <TermaLink
            key={`${link.id || index}-${url.href}`}
            class={['update-download-link', speed && fastest ? 'is-fastest' : '']}
            href={url.href}
            target="_blank"
            rel="noopener noreferrer"
            title={[url.href, detail].filter(Boolean).join('\n')}
          >
            <span class="update-download-link-label">{icon('external-link')}<span>{label}</span></span>
            {metric ? <small class={result && !speed ? 'is-unavailable' : ''}>{metric}</small> : null}
          </TermaLink>
        );
      });
      if (!links.length) return null;
      return (
        <div class="update-download-links">
          <div class="update-download-links-head">
            <strong>{t('settings:updates.download_links')}</strong>
            <TermaButton
              id="probeUpdateDownloadLinksBtn"
              disabled={Boolean(probe?.running)}
              aria-busy={probe?.running ? 'true' : undefined}
              title={t('settings:updates.probe_hint')}
              onClick={() => { void settingsServices.termaUpdateDownloads?.probe(); }}
            >
              {icon(probe?.running ? 'loader-circle' : 'gauge')}
              <span>{t(probe?.running ? 'settings:updates.probe_running' : 'settings:updates.probe_links')}</span>
            </TermaButton>
          </div>
          <small>{assetName}</small>
          {props.snapshot.probeError ? <div class="warning">{props.snapshot.probeError}</div> : null}
          <div class="actions">{links}</div>
        </div>
      );
    };

    const fnosPanel = (update: UpdateRecord) => {
      const available = Boolean(update.update_available || update.republished_available);
      const currentVersion = version(update.current_version) || t('settings:updates.current_unknown');
      const latestVersion = version(update.latest_version);
      const asset = selectedFnosUpdateAsset(update);
      const digest = /^sha256:[a-f0-9]{64}$/i.test(text(asset?.digest)) ? text(asset?.digest).slice(7) : '';
      const statusKey = props.snapshot.checking
        ? 'settings:updates.checking_short'
        : update.error
          ? 'settings:updates.check_failed'
          : !latestVersion
            ? 'settings:auto.update_not_checked'
            : update.republished_available
              ? 'settings:auto.update_republished'
              : available
                ? 'settings:auto.update_available'
                : 'settings:auto.update_latest';
      const error = props.snapshot.statusError || props.snapshot.checkError;
      return (
        <div class="update-card fnos-update-card">
          <div class="update-card-head"><strong>{t('settings:auto.github_release_updates')}</strong><span>{t('settings:auto.current_version', { version: currentVersion })}</span></div>
          <dl class="update-details">
            <div><dt>{t('settings:updates.status')}</dt><dd><span class={['status-pill', update.error ? 'failed' : available ? 'reconnecting' : 'running']}>{t(statusKey)}</span><small>{t('settings:auto.last_checked', { status: date(update.checked_at, true) || t('settings:auto.update_not_checked') })}</small></dd></div>
            {latestVersion ? <div><dt>{t('settings:auto.latest_version')}</dt><dd><strong>{latestVersion}</strong></dd></div> : null}
            {asset ? <div><dt>{t('settings:auto.asset')}</dt><dd><strong>{asset.name}</strong><small>fnOS · {text(update.download_status?.arch)} · FPK</small>{digest ? <small class="fnos-update-digest">SHA-256: {digest}</small> : null}</dd></div> : null}
          </dl>
          {error ? <div class="warning">{error}</div> : null}
          {notes()}
          <div class="update-actions">{checkButton()}{releaseLink()}</div>
          {asset ? manualDownloadLinks(asset.name || '') : null}
          <p class="muted">{t('settings:updates.fnos_managed')}</p>
          {latestVersion && !asset ? <p class="muted">{t('settings:updates.fnos_no_asset')}</p> : null}
        </div>
      );
    };

    const updatePanel = (update: UpdateRecord) => {
      const currentVersion = version(update.current_version) || t('settings:updates.current_unknown');
      const latestVersion = version(update.latest_version) || t('settings:auto.update_no_release');
      const republished = Boolean(update.republished_available);
      const releaseAvailable = Boolean(update.update_available || republished);
      const currentDownload = releaseAvailable ? download.value : {};
      const progress = Math.max(0, Math.min(100, Number(currentDownload.progress_percent || 0)));
      const checkedAt = date(update.checked_at, true) || t('settings:auto.update_not_checked');
      const publishedAt = date(update.published_at);
      const packageLabels: Record<string, string> = {
        portable: t('settings:auto.update_portable', { defaultValue: '便携版' }),
        installer: t('settings:auto.update_installer', { defaultValue: '安装版' }),
        dmg: 'DMG', zip: 'ZIP', appimage: 'AppImage', deb: 'DEB', rpm: 'RPM'
      };
      const platformLabels: Record<string, string> = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
      const target = [
        platformLabels[text(currentDownload.platform)] || text(currentDownload.platform),
        text(currentDownload.arch),
        packageLabels[text(currentDownload.package_type)] || text(currentDownload.package_type)
      ].filter(Boolean).join(' · ');
      const progressText = currentDownload.state === 'downloading'
        ? currentDownload.phase === 'probing'
          ? t('settings:updates.testing_routes')
          : currentDownload.phase === 'verifying'
            ? t('settings:updates.verifying_sha', { progress: 100 })
            : `${Math.round(progress)}% · ${formatBytes(currentDownload.bytes_downloaded)} / ${formatBytes(currentDownload.size || currentDownload.selected_asset_size)}`
        : currentDownload.state === 'downloaded'
          ? `100% · ${formatBytes(currentDownload.size)}`
          : `${Math.round(progress)}%`;
      const sourceSpeed = formatSpeed(currentDownload.source_speed_bytes_per_second);
      const sourceLabel = currentDownload.source_id === 'direct' ? t('settings:updates.direct_route') : text(currentDownload.source_label);
      const sourceText = currentDownload.phase === 'probing'
        ? t('settings:auto.update_parallel_speed')
        : sourceLabel
          ? `${sourceLabel}${sourceSpeed ? t('settings:updates.speed_suffix', { speed: sourceSpeed }) : ''}`
          : releaseAvailable
            ? t('settings:auto.select_fastest_route')
            : '';
      const statusLabel = currentDownload.state === 'downloading'
        ? currentDownload.phase === 'probing'
          ? t('settings:auto.update_speed_test')
          : currentDownload.phase === 'verifying'
            ? t('settings:auto.update_verify')
            : t('settings:auto.update_download')
        : currentDownload.state === 'downloaded'
          ? t('settings:auto.update_downloaded')
          : currentDownload.state === 'failed'
            ? t('settings:auto.update_failed')
            : t(republished ? 'settings:auto.update_republished' : update.update_available ? 'settings:auto.update_available' : 'settings:auto.update_latest');
      const resourceName = releaseAvailable
        ? text(currentDownload.selected_asset_name || currentDownload.asset_name || t('settings:auto.update_no_asset'))
        : t('settings:auto.update_no_download', { defaultValue: '当前无需下载' });
      const downloadedCurrent = isVerifiedUpdatePackage(update, currentDownload);
      const checkError = props.snapshot.checkError;
      const downloadError = releaseAvailable ? props.snapshot.downloadError : '';
      const actionPending = Boolean(props.snapshot.downloadActionPending);
      const openDirectory = currentDownload.can_open_directory ? (
        <TermaButton onClick={() => { void settingsServices.termaUpdateDownloads?.openDirectory(props.confirmAction); }}>{icon('folder-open')}<span>{t('settings:updates.open_download_directory')}</span></TermaButton>
      ) : null;
      const redownload = downloadedCurrent ? (
        <TermaButton id="downloadUpdateBtn" disabled={props.snapshot.checking || actionPending} aria-busy={actionPending ? 'true' : undefined} onClick={() => { void settingsServices.termaUpdateDownloads?.download(true, props.confirmAction); }}>
          {icon('download')}<span>{t(actionPending ? 'settings:auto.update_speed_testing' : 'settings:auto.update_redownload')}</span>
        </TermaButton>
      ) : null;
      let downloadAction = null;
      if (releaseAvailable && downloadedCurrent) {
        if (currentDownload.package_type === 'portable') {
          downloadAction = <>{openDirectory || <span class="muted">{t('settings:updates.portable_ready_hint')}</span>}{redownload}</>;
        } else {
          downloadAction = <>{currentDownload.can_open ? <TermaButton onClick={() => { void settingsServices.termaUpdateDownloads?.openPackage(props.confirmAction); }}>{icon('package-open')}<span>{t('settings:updates.open_verified_package')}</span></TermaButton> : null}{openDirectory || (!currentDownload.can_open ? <span class="muted">{t('settings:updates.installer_ready_hint')}</span> : null)}{redownload}</>;
        }
      } else if (releaseAvailable && currentDownload.state === 'downloading') {
        downloadAction = <TermaButton id="downloadUpdateBtn" disabled aria-busy="true">{icon('download')}<span>{t(currentDownload.phase === 'probing' ? 'settings:auto.update_speed_test' : currentDownload.phase === 'verifying' ? 'settings:auto.update_verify' : 'settings:auto.update_download')}</span></TermaButton>;
      } else if (releaseAvailable) {
        downloadAction = <TermaButton id="downloadUpdateBtn" disabled={props.snapshot.checking || actionPending} aria-busy={actionPending ? 'true' : undefined} onClick={() => { void settingsServices.termaUpdateDownloads?.download(false, props.confirmAction); }}>
          {icon('download')}<span>{t(actionPending ? 'settings:auto.update_speed_testing' : currentDownload.state === 'failed' ? 'settings:updates.redownload_verify' : 'settings:auto.update_download_verify')}</span>
        </TermaButton>;
      }
      const statusError = props.snapshot.statusError;
      const republishedNotice = republished ? <div class="warning">{t('settings:updates.republished_hint', { version: latestVersion })}</div> : null;

      return (
        <div class="update-card">
          <div class="update-card-head"><strong>{t('settings:auto.github_release_updates')}</strong><span>{t('settings:auto.current_version', { version: currentVersion })}</span></div>
          <dl class="update-details">
            <div><dt>{t('settings:updates.status')}</dt><dd><span class={['status-pill', currentDownload.state === 'failed' ? 'failed' : releaseAvailable ? 'reconnecting' : 'running']}>{statusLabel}</span><small>{t('settings:auto.last_checked', { status: checkedAt })}</small></dd></div>
            <div><dt>{t('settings:auto.latest_version')}</dt><dd><strong>{latestVersion}</strong>{publishedAt ? <small>{t('settings:auto.published_at', { date: publishedAt })}</small> : null}</dd></div>
            <div><dt>{t('settings:auto.asset')}</dt><dd><strong title={resourceName}>{resourceName}</strong>{target ? <small>{target}</small> : null}</dd></div>
            {sourceText ? <div><dt>{t('settings:auto.route')}</dt><dd><strong>{sourceText}</strong><small>{t('settings:auto.route_fallback')}</small></dd></div> : null}
            <div><dt>{t('settings:auto.progress')}</dt><dd><strong>{progressText}</strong><div class="update-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress)}><i style={{ width: `${progress}%` }}></i></div></dd></div>
          </dl>
          {republishedNotice}
          {statusError ? <div class="warning">{statusError}</div> : null}
          {checkError ? <div class="warning">{checkError}</div> : null}
          {notes()}
          {downloadError ? <div class="warning">{t('settings:updates.download_failed_detail', { error: downloadError })}</div> : null}
          <div class="update-actions">{checkButton()}{downloadAction}{releaseLink()}</div>
          {manualDownloadLinks(text(download.value.download_asset_name))}
          {update.update_available ? <>
            <label class="check-row update-ignore-row"><input id="updateIgnoreCurrentVersion" type="checkbox" checked={ignoredVersion.value} disabled={props.snapshot.checking || props.snapshot.ignoreSaving} onChange={async (event: Event) => {
              const input = event.currentTarget as HTMLInputElement;
              const previous = ignoredVersion.value;
              ignoredVersion.value = input.checked;
              const saved = await settingsServices.termaUpdateStatus?.setIgnored(input.checked);
              if (saved === false) ignoredVersion.value = previous;
            }} /> {t('settings:auto.ignore_version', { version: latestVersion })}</label>
            <div class="muted update-ignore-help">{t('settings:auto.ignore_version_hint')}</div>
          </> : null}
          <div class="muted">{t('settings:auto.update_security_hint')}</div>
        </div>
      );
    };

    return () => {
      const update = props.snapshot.update;
      if (props.snapshot.fnos) return fnosPanel(update || {});
      if (!update) {
        const checking = props.snapshot.checking;
        return (
          <div class="update-card">
            <div class="update-card-head"><strong>{t('settings:auto.github_release_updates')}</strong><span>{t('settings:updates.reading_version')}</span></div>
            <div class="update-status checking"><div><strong>{t('settings:updates.checking')}</strong><span>{t('settings:updates.reading_releases')}</span></div><span class="status-pill">{t('settings:updates.checking_short')}</span></div>
            <div class="update-actions">{checkButton('settings:updates.check_again')}</div>
          </div>
        );
      }
      if (update.error) {
        return (
          <div class="update-card">
            <div class="update-card-head"><strong>{t('settings:auto.github_release_updates')}</strong><span>{t('settings:updates.check_failed')}</span></div>
            <div class="update-status failed"><div><strong>{t('settings:updates.check_unavailable')}</strong><span>{props.snapshot.statusError}</span></div><span class="status-pill failed">{t('settings:updates.failed')}</span></div>
            <div class="update-actions">{checkButton('common:actions.retry')}</div>
          </div>
        );
      }
      if (!update.latest_version) {
        return (
          <div class="update-card">
            <div class="update-card-head"><strong>{t('settings:auto.github_release_updates')}</strong><span>{version(update.current_version) || t('settings:updates.current_unknown')}</span></div>
            <div class="update-status"><div><strong>{t('settings:auto.update_not_checked')}</strong><span>{t('settings:updates.auto_refresh_hint')}</span></div><span class="status-pill">{t('settings:updates.pending_check')}</span></div>
            <div class="update-actions">{checkButton('settings:updates.check_now')}</div>
          </div>
        );
      }
      return updatePanel(update);
    };
  }
});
