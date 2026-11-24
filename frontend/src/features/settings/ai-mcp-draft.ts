import {api} from '@/shared/api/workspace-request';
import {notify} from '@/features/efficiency/notification-actions';
import { reactive } from 'vue';
import type { SharedApiBridge } from '@/shared/api/bridge';
import { errorMessage } from '../operations/operations-types';
import { normalizeMcpServers } from './ai-settings-model';

export type SettingsMcpServer = ReturnType<typeof normalizeMcpServers>[number];
type Translate = (key:string, options?:Record<string,unknown>) => string;

export const mcpPresets = Object.freeze({
  'web-fetch':{name:'Web Fetch',command:'uvx',args:['mcp-server-fetch']},
  'brave-search':{name:'Brave Search',command:'npx',args:['-y','@brave/brave-search-mcp-server','--transport','stdio']},
  github:{name:'GitHub (read-only)',command:'github-mcp-server',args:['stdio','--read-only']},
  playwright:{name:'Playwright',command:'npx',args:['-y','@playwright/mcp@latest','--headless','--isolated']},
  memory:{name:'Memory',command:'npx',args:['-y','@modelcontextprotocol/server-memory']}
});

function editor(server?: SettingsMcpServer) {
  return {id:server?.id ?? '',name:server?.name ?? '',transport:server?.transport ?? 'stdio' as SettingsMcpServer['transport'],
    command:server?.command ?? '',url:server?.url ?? '',args:JSON.stringify(server?.args ?? []),
    headers:server && Object.keys(server.headers).length ? JSON.stringify(server.headers, null, 2) : '',
    enabled:server?.enabled ?? false,timeout_ms:server?.timeout_ms ?? 30000};
}

export const mcpDraft = reactive({servers:[] as SettingsMcpServer[], editor:editor(), dirty:false, busy:''});
export function loadMcpDraft(servers: SettingsMcpServer[], resetEditor = false) {
  mcpDraft.servers = servers;
  mcpDraft.dirty = false;
  if (resetEditor) mcpDraft.editor = editor();
}
export function editMcpServer(server?: SettingsMcpServer) { mcpDraft.editor = editor(server); }
export function applyMcpPreset(preset: typeof mcpPresets[keyof typeof mcpPresets]) {
  Object.assign(mcpDraft.editor, {name:preset.name,transport:'stdio',command:preset.command,url:'',args:JSON.stringify(preset.args),headers:''});
}
export function removeMcpServer(id: string) {
  mcpDraft.servers = mcpDraft.servers.filter(item => item.id !== id);
  if (mcpDraft.editor.id === id) editMcpServer();
  mcpDraft.dirty = true;
}

function parseArgs(value: string, tr: Translate): string[] {
  try {
    const args:unknown = value.trim() ? JSON.parse(value) : [];
    if (Array.isArray(args) && args.every(item => typeof item === 'string')) return args.slice(0,32);
  } catch { /* report the validation error below */ }
  throw Error(tr('settings:ai.mcp_args_invalid'));
}

function parseHeaders(value: string, tr: Translate): Record<string,string> {
  try {
    const headers:unknown = value.trim() ? JSON.parse(value) : {};
    if (headers && typeof headers === 'object' && !Array.isArray(headers) && Object.keys(headers).length <= 32 &&
        Object.values(headers).every(item => typeof item === 'string')) return headers as Record<string,string>;
  } catch { /* report the validation error below */ }
  throw Error(tr('settings:ai.mcp_headers_invalid'));
}

function editorPayload(tr: Translate) {
  const {id,name,transport,url,command,args,headers,enabled,timeout_ms} = mcpDraft.editor;
  const remote = transport !== 'stdio';
  if (!name.trim() || !(remote ? url.trim() : command.trim())) throw Error(tr('settings:ai.mcp_required'));
  return {id:id || `mcp-${Date.now().toString(36)}`,name:name.trim().slice(0,120),transport,enabled,timeout_ms,
    command:remote ? '' : command.trim(),args:remote ? [] : parseArgs(args,tr),
    url:remote ? url.trim() : '',headers:remote ? parseHeaders(headers,tr) : {}};
}

const mcpServersPath = '/api/ai/mcp/servers';
const mcpServerPath = (id: string) => `${mcpServersPath}/${encodeURIComponent(id)}`;

function updateMcpDraft(server: SettingsMcpServer) {
  const index = mcpDraft.servers.findIndex(item => item.id === server.id);
  if (index < 0) mcpDraft.servers.push(server);
  else mcpDraft.servers[index] = server;
  mcpDraft.dirty = true;
}

export async function saveMcpEditor(tr: Translate) {
  if (mcpDraft.busy) return;
  mcpDraft.busy = 'editor';
  const id = mcpDraft.editor.id;
  const fallback = tr('settings:ai.mcp_save_failed');
  try {
    const result = await api<{server?:unknown}>(id ? mcpServerPath(id) : mcpServersPath,
      {method:id ? 'PUT' : 'POST',body:JSON.stringify({server:editorPayload(tr)})});
    const [saved] = normalizeMcpServers([result?.server]);
    if (!saved || (id && saved.id !== id)) throw Error(fallback);
    updateMcpDraft(saved);
    editMcpServer();
    notify(tr(id ? 'settings:ai.mcp_updated' : 'settings:ai.mcp_saved'), 'success');
  } catch (error) { notify(errorMessage(error,fallback),'error'); }
  finally { mcpDraft.busy = ''; }
}

export async function discoverMcpTools(server: SettingsMcpServer, tr: Translate) {
  if (mcpDraft.busy) return;
  mcpDraft.busy = `discover:${server.id}`;
  const fallback = tr('settings:ai.mcp_discover_failed');
  const pathname = mcpServerPath(server.id);
  try {
    await api(pathname,{method:'PUT',body:JSON.stringify({server})});
    const result = await api<{server?:SettingsMcpServer;tools?:unknown[]}>(`${pathname}/discover`,{method:'POST',body:'{}'});
    const [saved] = normalizeMcpServers([{...server,...result?.server,id:server.id,tools:result?.tools ?? result?.server?.tools ?? [],
      tools_updated_at:result?.server?.tools_updated_at || Date.now()}]);
    if (!saved) throw Error(fallback);
    updateMcpDraft(saved);
    notify(tr('settings:ai.mcp_discovered',{count:saved.tools.length}), 'success');
  } catch (error) { notify(errorMessage(error,fallback),'error'); }
  finally { mcpDraft.busy = ''; }
}
