import {tr} from '@/shared/i18n/workspace-bootstrap';
export const DEFAULT_CONNECTION_GROUP = '默认分组';

export function connectionGroupDisplayName(name: string) {
  const value = String(name || DEFAULT_CONNECTION_GROUP);
  return value === DEFAULT_CONNECTION_GROUP
    ? tr('connections:auto.default_group', {defaultValue: DEFAULT_CONNECTION_GROUP})
    : value;
}
