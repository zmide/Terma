import {tr} from '@/shared/i18n/workspace-bootstrap';
import {localizedTermaUiPhrase} from '@/shared/i18n/ui-phrase';

export function connectionIdentityUnsafeFallback() {
  return tr('connections:identity.unsafe_fallback', {defaultValue: '私钥已不在安全目录，请编辑连接并导入 Terma 密钥目录或用户 ~/.ssh 顶层。'});
}

function identityWarning(status?: string, message?: string) {
  if (status !== 'unsafe') return '';
  const text = message || connectionIdentityUnsafeFallback();
  return typeof localizedTermaUiPhrase === 'function' ? String(localizedTermaUiPhrase(text)) : text;
}

export function connectionIdentityWarningMessage(connection?: {identity_file_status?: string; identity_file_message?: string} | null) {
  return identityWarning(connection?.identity_file_status, connection?.identity_file_message);
}

export function connectionFormIdentityWarning(form?: Pick<HTMLFormElement, 'dataset'> | null) {
  return identityWarning(form?.dataset.identityFileStatus, form?.dataset.identityFileMessage);
}
