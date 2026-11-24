import { createHash } from 'node:crypto';

export type RemotePrincipal = { id: string; name: string };
export type RemotePrincipals = { users: RemotePrincipal[]; groups: RemotePrincipal[]; available: boolean };
const empty = (): RemotePrincipals => ({ users: [], groups: [], available: false });
// Only public account names and numeric IDs leave the remote machine.
export const PRINCIPAL_COMMAND = `printf '__TERMA_USERS__\\n'; if command -v dscl >/dev/null 2>&1; then dscl . -list /Users UniqueID 2>/dev/null | awk 'NF==2 && NR<=4096 {print $1 "\\t" $2}'; else { getent passwd 2>/dev/null || cat /etc/passwd 2>/dev/null; } | awk -F: 'NF>=3 && NR<=4096 {print $1 "\\t" $3}'; fi; printf '__TERMA_GROUPS__\\n'; if command -v dscl >/dev/null 2>&1; then dscl . -list /Groups PrimaryGroupID 2>/dev/null | awk 'NF==2 && NR<=4096 {print $1 "\\t" $2}'; else { getent group 2>/dev/null || cat /etc/group 2>/dev/null; } | awk -F: 'NF>=3 && NR<=4096 {print $1 "\\t" $3}'; fi`;

export function parseRemotePrincipals(output: string): RemotePrincipals {
  const result = empty(); let section: RemotePrincipal[] | null = null;
  for (const line of output.split(/\r?\n/)) {
    if (line === '__TERMA_USERS__') { section = result.users; continue; }
    if (line === '__TERMA_GROUPS__') { section = result.groups; continue; }
    if (!section || section.length >= 4096) continue;
    const [name, id, extra] = line.split('\t');
    if (extra !== undefined || !/^[^\s:\x00-\x1f\x7f]{1,64}$/.test(name || '') || !/^\d{1,10}$/.test(id || '') || Number(id) > 4294967295) continue;
    if (!section.some(item => item.id === String(Number(id)))) section.push({ name, id: String(Number(id)) });
  }
  result.available = Boolean(result.users.length || result.groups.length);
  return result;
}

export function createRemotePrincipalService(port: { connection(id: number): any; spawn(connection: any, command: string): any; wrap(command: string): string }, timeoutMs = 4000) {
  const cache = new Map<string, { expires: number; pending: Promise<RemotePrincipals>; settled: boolean }>();
  async function read(id: number): Promise<RemotePrincipals> {
    const connection = port.connection(id);
    if (!connection) return empty();
    // A changed connection, credential or temporary session must never reuse another target's names.
    const key = createHash('sha256').update(JSON.stringify([id, connection])).digest('hex');
    const cached = cache.get(key); if (cached && cached.expires > Date.now()) return cached.pending;
    if (cache.size >= 32 && !cache.has(key)) {
      const expired = [...cache].find(([, entry]) => entry.settled);
      if (!expired) return empty();
      cache.delete(expired[0]);
    }
    const pending = new Promise<RemotePrincipals>(resolve => {
      let child: any, timer: ReturnType<typeof setTimeout> | undefined, done = false, size = 0;
      const chunks: Buffer[] = [];
      const finish = (ok: boolean) => {
        if (done) return; done = true; if (timer) clearTimeout(timer);
        if (!ok) { try { child?.kill('SIGKILL'); } catch {} }
        resolve(ok ? parseRemotePrincipals(Buffer.concat(chunks).toString('utf8')) : empty());
      };
      try {
        child = port.spawn(connection, port.wrap(PRINCIPAL_COMMAND));
        timer = setTimeout(() => finish(false), timeoutMs);
        child.stdout.on('data', (chunk: Buffer) => { if (done) return; size += chunk.length; if (size > 256 * 1024) finish(false); else chunks.push(Buffer.from(chunk)); });
        child.stderr.on('data', () => {});
        child.once('error', () => finish(false)); child.once('close', (code: number) => finish(code === 0)); child.stdin.end();
      } catch { finish(false); }
    });
    const entry = { expires: Date.now() + 60000, pending, settled: false }; cache.set(key, entry);
    const result = await pending;
    entry.settled = true;
    if (!result.available) entry.expires = Date.now() + 5000;
    return result;
  }
  async function decorate(id: number, page: any) {
    const principals = await read(id).catch(empty);
    const find = (items: RemotePrincipal[], value: string) => items.find(item => item.id === value) || items.find(item => item.name === value);
    return { ...page, entries: (page.entries || []).map((entry: any) => {
      const owner = find(principals.users, String(entry.owner ?? '')), group = find(principals.groups, String(entry.group ?? ''));
      return { ...entry, owner_name: owner?.name || '', owner_id: owner?.id || '', group_name: group?.name || '', group_id: group?.id || '' };
    }) };
  }
  return { read, decorate };
}
