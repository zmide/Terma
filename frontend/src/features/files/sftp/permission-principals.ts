export type PermissionPrincipal = { id: string; name: string };
export type PermissionPrincipals = { users: PermissionPrincipal[]; groups: PermissionPrincipal[]; available?: boolean };
export const emptyPermissionPrincipals = (): PermissionPrincipals => ({ users: [], groups: [], available: false });
export function normalizePermissionPrincipals(value: PermissionPrincipals | null | undefined): PermissionPrincipals {
  const normalize = (items: unknown) => Array.isArray(items) ? items.slice(0, 4096).filter((item): item is PermissionPrincipal =>
    !!item && typeof item.name === 'string' && typeof item.id === 'string' && /^[^\s:\x00-\x1f\x7f]{1,64}$/.test(item.name) && /^\d{1,10}$/.test(item.id) && Number(item.id) <= 4294967295) : [];
  return { users: normalize(value?.users), groups: normalize(value?.groups), available: value?.available === true };
}
export function principalLabel(value: string, items: PermissionPrincipal[], kind: 'owner' | 'group') {
  const item = items.find(item => item.id === value) || items.find(item => item.name === value);
  return item ? `${item.name} (${kind === 'owner' ? 'UID' : 'GID'} ${item.id})` : value;
}
export function principalValue(value: string, items: PermissionPrincipal[], kind: 'owner' | 'group') {
  const text = value.trim();
  return items.find(item => principalLabel(item.id, [item], kind) === text)?.id || text;
}
export function changedPrincipal(value: string, original: string, items: PermissionPrincipal[], kind: 'owner' | 'group') {
  const raw = principalValue(value, items, kind), previous = principalValue(original, items, kind);
  const canonical = (text: string) => items.find(item => item.id === text)?.id || items.find(item => item.name === text)?.id || text;
  return canonical(raw) === canonical(previous) ? '' : raw;
}
