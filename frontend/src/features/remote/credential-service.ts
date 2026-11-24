import type {RemoteProfile} from './profile-model';
import {credentialPayload, type RemoteServicePort} from './profile-service';
export interface CredentialPort extends RemoteServicePort {defaultGroup: string; localize?(message: string): string;current?():boolean}
export function createCredentialService(profile: RemoteProfile, port: CredentialPort, paint: () => void, done: (id: number | null) => void) {
  const state = {username:profile.username || 'anonymous', port:String(profile.port || 21), password:'', busy:false, phase:'idle' as 'idle' | 'verifying' | 'saving' | 'error', error:'', errorKey:''};
  let alive = true;
  const controller = new AbortController();
  const fail = (key: string) => {state.errorKey = key; state.error = port.tr(key); state.phase = 'error'; paint();};
  const current=()=>{if(port.current?.()!==false)return true;alive=false;controller.abort();state.password='';state.busy=false;done(null);return false;};
  async function submit() {
    if (!alive || state.busy || !current() || !port.unlocked(port.tr('remote:credentials.repair_context'))) return;
    const username = state.username.trim(), number = Number(state.port || 21);
    if (!username) return fail('remote:credentials.user_required');
    if (!Number.isInteger(number) || number < 1 || number > 65535) return fail('common:notifications.ftp_port_invalid');
    if (!state.password) return fail('remote:credentials.password_required');
    const payload = credentialPayload(profile, username, state.password, number, port.defaultGroup);
    state.busy = true; state.phase = 'verifying'; state.error = ''; state.errorKey = ''; paint();
    const options = {method:'POST', body:JSON.stringify({username, password:payload.password, port:number}), signal:controller.signal};
    try {
      await port.api(`/api/remote-profiles/${profile.id}/test-credentials`, options); options.body = '';
      if (!alive || !current()) return;
      if (!port.unlocked(port.tr('remote:credentials.repair_context'))) {state.phase = 'idle'; return;}
      state.phase = 'saving'; paint();
      await port.api(`/api/remote-profiles/${profile.id}`, {method:'PUT', body:JSON.stringify(payload), signal:controller.signal});
      if (!alive) return;
      state.password = ''; state.busy = false; alive = false; done(Number(profile.id));
    } catch (error) {if (alive) {state.phase = 'error'; state.error = error instanceof Error ? error.message : port.tr('remote:credentials.verification_failed');}}
    finally {options.body = ''; payload.password = ''; if (alive) {state.busy = false; paint();}}
  }
  return {state, submit, cancel() {if (alive && !state.busy) {alive = false; state.password = ''; done(null);}}, dispose() {alive = false; controller.abort(); state.password = ''; state.busy = false;}};
}
