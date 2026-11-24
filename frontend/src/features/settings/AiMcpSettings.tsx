import { defineComponent, Fragment, nextTick } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { aiMcpTransport } from './ai-settings-model';
import { applyMcpPreset, discoverMcpTools, editMcpServer, mcpDraft, mcpPresets, removeMcpServer, saveMcpEditor,
  type SettingsMcpServer } from './ai-mcp-draft';
import { settingsIcon } from './settings-icon';

type Tool = SettingsMcpServer['tools'][number];
type Translate = (key:string, options?:Record<string, unknown>) => string;
const checked = (event: Event) => (event.currentTarget as HTMLInputElement).checked;
const value = (event: Event) => (event.currentTarget as HTMLInputElement).value;
const transports = {stdio:'stdio',sse:'HTTP / SSE','streamable-http':'Streamable HTTP'} as const;

function McpTools({server, text, locked}: {server:SettingsMcpServer; text:Translate; locked:boolean}) {
  if (!server.tools.length) return <div class="terminal-ai-mcp-tools-empty muted">{text('mcp_tools_empty')}</div>;
  const toolRow = (tool: Tool) => {
    const properties = 'properties' in tool.inputSchema ? tool.inputSchema.properties : null;
    const schemaKeys = properties && typeof properties === 'object' ? Object.keys(properties).slice(0,6) : [];
    return <div class="terminal-ai-mcp-tool-row" key={tool.name}>
      <div class="terminal-ai-mcp-tool-copy">
        <strong>{settingsIcon(tool.requires_approval ? 'shield-check' : 'zap')}{tool.name}
          <em class={'terminal-ai-mcp-risk ' + tool.risk}>{text('mcp_risk_' + tool.risk)}</em></strong>
        <small>{tool.description || text('mcp_tool_no_description')}{schemaKeys.length ? ` · ${schemaKeys.join(', ')}` : ''}</small>
      </div>
      <label class="check-row compact"><input type="checkbox" data-mcp-tool-enabled checked={tool.enabled} disabled={locked}
        onChange={event => {tool.enabled = checked(event); mcpDraft.dirty = true;}}/>{text('mcp_tool_enabled')}</label>
      <label class="check-row compact"><input type="checkbox" data-mcp-tool-approval checked={tool.requires_approval} disabled={locked}
        onChange={event => {tool.requires_approval = checked(event); mcpDraft.dirty = true;}}/>{text('mcp_tool_approval')}</label>
    </div>;
  };
  return <details class="terminal-ai-mcp-tools">
    <summary><span>{settingsIcon('wrench')}<b>{text('mcp_tools')}</b></span><span class="terminal-ai-mcp-tools-count">{server.tools.length}</span></summary>
    <div class="terminal-ai-mcp-tool-list">{server.tools.map(toolRow)}</div>
  </details>;
}

function McpEditor({text, locked, onSave}: {text:Translate; locked:boolean; onSave:() => void}) {
  const {editor:d} = mcpDraft;
  const remote = d.transport !== 'stdio';
  return <div class="terminal-ai-mcp-editor" data-mcp-editing-id={d.id}>
    <input id="terminalAiMcpName" maxlength="120" value={d.name} disabled={locked} placeholder={text('mcp_name')}
      onInput={event => {d.name = value(event);}} />
    <select id="terminalAiMcpTransport" value={d.transport} disabled={locked}
      onChange={event => {d.transport = aiMcpTransport(value(event));}}>
      {Object.entries(transports).map(([id,label]) => <option key={id} value={id}>{label}</option>)}
    </select>
    <input id="terminalAiMcpCommand" data-mcp-transport-field="stdio" maxlength="300" value={d.command} placeholder={text('mcp_command')}
      hidden={remote} disabled={locked || remote} onInput={event => {d.command = value(event);}}/>
    <input id="terminalAiMcpUrl" data-mcp-transport-field="remote" maxlength="2048" value={d.url}
      placeholder={text(d.transport === 'sse' ? 'mcp_sse_url' : 'mcp_streamable_url')}
      hidden={!remote} disabled={locked || !remote} onInput={event => {d.url = value(event);}}/>
    <textarea id="terminalAiMcpArgs" data-mcp-transport-field="stdio" maxlength="10000" rows={2} spellcheck={false} value={d.args}
      placeholder={text('mcp_args')} hidden={remote} disabled={locked || remote} onInput={event => {d.args = value(event);}}/>
    <textarea id="terminalAiMcpHeaders" data-mcp-transport-field="remote" maxlength="16000" rows={3} spellcheck={false} value={d.headers}
      placeholder={text('mcp_headers')} hidden={!remote} disabled={locked || !remote} onInput={event => {d.headers = value(event);}}/>
    <div class="terminal-ai-mcp-header-hint muted" data-mcp-transport-field="remote" hidden={!remote}>{text('mcp_headers_hint')}</div>
    <label class="check-row"><input id="terminalAiMcpEnabled" type="checkbox" checked={d.enabled} disabled={locked}
      onChange={event => {d.enabled = checked(event);}}/> {text('mcp_enable')}</label>
    <div class="terminal-ai-mcp-editor-actions">
      <TermaButton type="button" data-mcp-action="save" disabled={locked} loading={mcpDraft.busy === 'editor'} onClick={onSave}>
        {settingsIcon(d.id ? 'save' : 'plus')}<span>{text(d.id ? 'mcp_update' : 'mcp_add')}</span>
      </TermaButton>
      {d.id && <TermaButton type="button" data-mcp-action="cancel" disabled={locked} onClick={() => editMcpServer()}>
        <span>{text('common:actions.cancel')}</span>
      </TermaButton>}
    </div>
  </div>;
}

export const AiMcpSettings = defineComponent({
  props:{tr:{type:Function,required:true}, saving:Boolean},
  setup(props) {
    const text:Translate = (key, options) => props.tr(key.includes(':') ? key : `settings:ai.${key}`, options);
    const locked = () => props.saving || Boolean(mcpDraft.busy);
    async function focusEditor(target: HTMLElement) {
      const panel = target.closest('fieldset');
      await nextTick();
      panel?.querySelector<HTMLInputElement>('#terminalAiMcpName')?.focus();
    }
    const row = (item: SettingsMcpServer) => <Fragment key={item.id}>
      <div class="terminal-ai-mcp-row" data-mcp-server-id={item.id}>
        <span>{settingsIcon('plug')}<b>{item.name}</b><small>{transports[item.transport]} · {text(item.enabled ? 'mcp_enabled' : 'mcp_disabled')}</small></span>
        <div>
          <label class="check-row compact"><input type="checkbox" data-mcp-server-enabled checked={item.enabled} disabled={locked()}
            onChange={event => {item.enabled = checked(event); mcpDraft.dirty = true;}}/>{text('mcp_enable')}</label>
          {([
            ['edit','pencil',(event: MouseEvent) => {editMcpServer(item); void focusEditor(event.currentTarget as HTMLElement);}],
            ['discover','search',() => discoverMcpTools(item,props.tr as Translate)],
            ['remove','trash-2',() => removeMcpServer(item.id)]
          ] as const).map(([action,icon,run]) => <TermaButton key={action} type="button" class={['icon-button',action === 'remove' && 'danger']}
            data-mcp-action={action} title={text('mcp_' + action)} aria-label={text('mcp_' + action)} disabled={locked()}
            loading={action === 'discover' && mcpDraft.busy === `discover:${item.id}`} onClick={run}>{settingsIcon(icon)}</TermaButton>)}
        </div>
      </div>
      <McpTools server={item} text={text} locked={locked()}/>
    </Fragment>;
    return () => <fieldset class="terminal-ai-skills" data-terma-managed-fields>
      <legend>{text('mcp')}</legend>
      <div class="terminal-ai-mcp-presets"><span>{text('mcp_presets')}</span>
        {Object.entries(mcpPresets).map(([id,preset]) => <TermaButton key={id} type="button" data-mcp-preset={id} disabled={locked()}
          onClick={(event: MouseEvent) => {applyMcpPreset(preset); void focusEditor(event.currentTarget as HTMLElement);}}>{preset.name}</TermaButton>)}
      </div>
      <div id="terminalAiMcpList" class="terminal-ai-mcp-list">{mcpDraft.servers.map(row)}</div>
      <McpEditor text={text} locked={locked()} onSave={() => {if (!locked()) void saveMcpEditor(props.tr as Translate);}}/>
      <div class="muted">{text('mcp_hint')}</div>
    </fieldset>;
  }
});
