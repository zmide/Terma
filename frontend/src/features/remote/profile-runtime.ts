import {sharedServices} from '@/shared/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {showOperationsModal} from '../operations/operations-modal';
import {remoteCredentialsView} from './RemoteCredentialDialog';
import {createRemoteProfilePresentation,isRemoteProtocol,remoteProtocolMeta,type RemoteProfile} from './profile-model';
import {createCredentialService, type CredentialPort} from './credential-service';
import {createProfileTestService, type ProfileTestPort} from './profile-service';
import {createRemoteProfileEditor} from './profile-editor-runtime';
import type {ModalBinding} from '../operations/operations-types';
import {remoteProfileById, remoteProfileEditorHost as host} from './remote-host';
interface RepairOptions {context?: string | (() => string);current?():boolean;signal?:AbortSignal}
interface RepairRequest extends RepairOptions {error?: unknown; onSaved?(profile: RemoteProfile): unknown}
interface CredentialDialogPort extends CredentialPort {beforeOpen(): void}
let active: ReturnType<typeof createCredentialService> | null = null;
function prompt(profile: RemoteProfile, options: RepairOptions, port: CredentialDialogPort) {
  if (profile.protocol !== 'ftp' || !Number.isSafeInteger(profile.id) || Number(profile.id) < 1) return Promise.resolve(null);
  if(options.signal?.aborted||options.current?.()===false)return Promise.resolve(null);
  if (active) {port.notify(port.tr('common:notifications.credential_repair_open'), 'info'); return Promise.resolve(null);}
  if (!port.unlocked(port.tr('remote:credentials.repair_context'))) return Promise.resolve(null);
  port.beforeOpen();
  return new Promise<{saved:true; profileId:number} | null>(resolve => {
    let binding: ModalBinding | undefined, settled = false, ownedPassword: HTMLInputElement | null = null,offOwner:(()=>void)|undefined;
    const finish = (id: number | null) => {
      if (settled) return; settled = true;
      offOwner?.();
      if (ownedPassword) ownedPassword.value = '';
      service.dispose(); if (active === service) active = null; binding?.close();
      resolve(id ? {saved:true, profileId:id} : null);
    };
    const service = createCredentialService({...profile, options:{...profile.options}}, {...port,current:options.current}, () => binding?.paint(), finish);
    active = service;
    const t = (key: string) => port.tr('remote:credentials.' + key);
    binding = showOperationsModal(() => remoteCredentialsView({
      ...service.state, error:service.state.errorKey ? port.tr(service.state.errorKey) : port.localize?.(service.state.error) || service.state.error,
      host:profile.host || '', context:`${typeof options.context === 'function' ? options.context() : options.context || t('reconnect')} · ${profile.name || profile.host}`,
      labels:{title:t('repair_title'), close:port.tr('common:actions.close'), cancel:port.tr('common:actions.cancel'), hostHint:t('host_unchanged_hint'), username:t('username'), port:t('port'), password:t('password'), showPassword:port.tr('common:auto.show_password'), hidePassword:port.tr('common:auto.hide_password'), save:port.tr('remote:credentials.save_to_connection',{name:profile.name || profile.host}), hint:t('verify_hint'), verifying:t('verifying_details'), saving:t('verified_updating'), submit:t('verify_connect'), busy:t('verifying')},
      change:(field, value) => {service.state[field] = value;}, submit:() => void service.submit(), cancel:() => service.cancel()
    }), () => finish(null), () => service.state.busy);
    if (binding.alive()) ownedPassword = document.getElementById('remoteCredentialPassword') as HTMLInputElement | null;
    const cancelOwner=()=>finish(null);options.signal?.addEventListener('abort',cancelOwner,{once:true});offOwner=()=>options.signal?.removeEventListener('abort',cancelOwner);
    queueMicrotask(() => {if (binding?.alive()) document.getElementById('remoteCredentialPassword')?.focus({preventScroll:true});});
  });
}
export function installRemoteProfileRuntime() {
  function repairPrompt(profile: RemoteProfile, options: RepairOptions = {}) {
    const port = host;
    if (port.sshRepairActive()) {
      port.notify(port.tr('common:notifications.credential_repair_open'), 'info');
      return Promise.resolve(null);
    }
    return prompt(profile, options, {...port, beforeOpen: port.closeModal});
  }
  async function repair(profileId: number, options: RepairRequest = {}) {
    const port = host;
    const id = Number(profileId || (options.error as {remoteProfileId?: number} | undefined)?.remoteProfileId || 0);
    const profile = port.profile(id);
    if (!profile || !await repairPrompt(profile, options)) return false;
    await port.reload();
    const saved = port.profile(id) || profile;
    if (!options.signal?.aborted && (!options.onSaved || options.current?.() !== false)) {
      port.notify(port.tr('common:notifications.credential_verified', {protocol: profile.protocol.toUpperCase()}), 'success');
      await options.onSaved?.(saved);
    }
    return {saved: true as const, profile: saved};
  }
  const createTests = () => {
    const port = host;
    const binding: ProfileTestPort = {...port,
      repair: (id, retry, current) => repair(id, {context: () => port.tr('remote:notifications.ftp_test_auth_failed'), onSaved: retry, current})};
    return createProfileTestService(binding);
  };
  let tests: ReturnType<typeof createTests> | undefined;
  async function test(id: number, button: HTMLButtonElement | null = null, skip = false) {
    const port = host;
    const current = () => !button || (button.isConnected && button.checkVisibility?.() !== false);
    const actions = sharedServices.termaUiActions;
    if (button) actions.setButtonBusy(button, true, () => port.tr('remote:actions.testing'));
    try { return await (tests ||= createTests()).test(id, skip, current); }
    finally { if (button?.isConnected) actions.setButtonBusy(button, false); }
  }
  let editor: ReturnType<typeof createRemoteProfileEditor> | undefined;
  const presentation = createRemoteProfilePresentation(host.tr);
  function open(profile: RemoteProfile | null | undefined, options: {forceLaunch?: boolean} = {}) {
    const id = Number(profile?.id);
    if (!profile || !Number.isSafeInteger(id) || id < 1 || !isRemoteProtocol(profile.protocol)) return;
    const workspace = remoteProtocolMeta[profile.protocol].workspace;
    if (workspace === 'desktop') return remoteServices.termaRemoteDesktop.open(id, true, false, options);
    if (workspace === 'files') return remoteServices.termaRemoteTransport.ftp.open(id);
    return remoteServices.termaRemoteTransport.terminal.open(id);
  }
  remoteServices.termaRemoteProfiles = {byId: remoteProfileById, open, presentation, prompt: repairPrompt, repair, test, busy: () => Boolean(active?.state.busy), cancel: () => active?.cancel(),
    get editor() { return editor ||= createRemoteProfileEditor(host, test); }};
}


export interface InstalledFeaturesRemoteProfileRuntimeServices {
  termaRemoteProfiles: {
  byId: typeof remoteProfileById;
  open(profile: RemoteProfile | null | undefined, options?: {forceLaunch?: boolean}): unknown;
  readonly presentation: ReturnType<typeof createRemoteProfilePresentation>;
  prompt(profile: RemoteProfile, options?: RepairOptions): ReturnType<typeof prompt>;
  repair(id: number, options?: RepairRequest): Promise<{saved: true; profile: RemoteProfile} | false>;
  test(id: number, button?: HTMLButtonElement | null, skip?: boolean): Promise<unknown>;
  busy(): boolean;
  cancel(): void;
  readonly editor: ReturnType<typeof createRemoteProfileEditor>;
};
}
