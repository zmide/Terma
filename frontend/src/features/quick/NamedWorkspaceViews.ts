import {quickServices} from '@/features/quick/installed-services';
import {h, type VNodeChild} from 'vue';
import {action, forwardDialog} from '../forwards/ForwardForms';
import {settingsIcon as icon} from '../settings/settings-icon';
import {bindingKey} from './named-workspace-references';
import type {NamedWorkspace, createNamedWorkspaceService} from './named-workspace-service';
import '@/styles/named-workspaces.css';

type Service = ReturnType<typeof createNamedWorkspaceService>;
type Dialog = ReturnType<typeof forwardDialog>;

export function createNamedWorkspaceViews(service: Service) {
  const {tr} = service;
  const label = (key: string, values?: Record<string, unknown>) => tr(`common:named_workspaces.${key}`, values);
  let dialog: Dialog | null = null;

  function frame(title: () => string, body: () => VNodeChild, footer: () => VNodeChild) {
    dialog?.close();
    const owner = forwardDialog(service, () => h('section', {
      class: 'named-workspace-manager', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'namedWorkspaceTitle'
    }, [
      h('header', null, [h('h2', {id: 'namedWorkspaceTitle'}, title()), action(tr('common:actions.close'), () => owner.close(), 'x', 'icon-button')]),
      body(), h('footer', null, [footer()])
    ]));
    dialog = owner;
    return owner;
  }

  const issueText = (issue: unknown) => h('p', {role: 'alert', class: 'named-workspace-error'}, service.displayError(issue));

  async function showPartial(result: {name: string; failed: number[]; serial: number}) {
    const choice = await forwardDialog(service).ask({
      title: () => label('partial_title'), message: () => label('partial_message', {name: result.name, count: result.failed.length}),
      choices: [{value: '', label: () => label('keep_current')}, {value: 'retry', label: () => label('retry_failed')}]
    });
    if (choice === 'retry') await service.retry(result);
  }

  async function managerView() {
    let items: NamedWorkspace[] = [], loading = true, busy = false, issue: unknown = null;
    async function run(work: () => unknown, refresh = false) {
      if (busy || !owner.alive()) return;
      busy = true;
      issue = null;
      owner.paint();
      try {
        if (await work() && refresh) await manager();
      } catch (error) {
        if (owner.alive()) issue = error;
        else service.notifyError(error);
      } finally {
        busy = false;
        if (owner.alive()) owner.paint();
      }
    }
    const row = (item: NamedWorkspace) => {
      const summary = service.summary(item.layout);
      return h('article', {key: item.id, 'data-workspace-id': item.id}, [
        h('span', {class: 'named-workspace-icon'}, icon('panels-top-left')),
        h('div', {class: 'named-workspace-copy'}, [
          h('strong', {title: item.name}, item.name),
          h('small', null, label('tab_count', {count: summary.tabs}) + (summary.groups > 1 ? ` · ${label('group_count', {count: summary.groups})}` : '')),
          item.description ? h('p', null, item.description) : null
        ]),
        h('div', {class: 'named-workspace-actions'}, [
          action(tr('common:auto.open'), () => preview(item.id), 'folder-open', 'primary', busy),
          action(tr('common:auto.export'), () => run(() => service.exportFile(item.id)), 'download', 'icon-button', busy),
          action(tr('common:auto.rename'), () => run(() => service.rename(item.id), true), 'pencil', 'icon-button', busy),
          action(tr('common:auto.copy'), () => run(() => service.duplicate(item.id), true), 'copy', 'icon-button', busy),
          action(tr('common:actions.delete'), () => run(() => service.remove(item.id), true), 'trash-2', 'danger icon-button', busy)
        ])
      ]);
    };
    const owner = frame(() => label('title'), () => h('div', null, [
      h('div', {class: 'named-workspace-toolbar'}, [
        h('span', null, label('count', {count: items.length})),
        h('input', {
          id: 'namedWorkspaceImportFile', type: 'file', hidden: true,
          accept: '.json,.terma-workspace.json,.tunneldesk-workspace.json,application/json',
          onChange: (event: Event) => {
            const input = event.target as HTMLInputElement;
            const file = input.files?.[0];
            input.value = '';
            if (file) void run(() => service.importFile(file, owner.alive), true);
          }
        }),
        action(tr('common:auto.import'), () => document.getElementById('namedWorkspaceImportFile')?.click(), 'upload', '', busy || loading),
        action(label('save_current'), () => { owner.close(); void save(); }, 'save', 'primary', busy)
      ]),
      loading ? h('p', {role: 'status'}, label('loading')) : null,
      issue ? h('div', {class: 'named-workspace-error'}, [issueText(issue), action(tr('common:actions.retry'), () => manager(), 'refresh-cw')]) : null,
      h('div', {class: 'named-workspace-list'}, items.map(row)),
      !loading && !issue && !items.length ? h('div', {class: 'named-workspace-empty'}, [
        h('strong', null, label('empty_title')), h('p', null, label('empty_hint'))
      ]) : null
    ]), () => action(tr('common:actions.close'), () => owner.close()));
    try { items = await service.list(); }
    catch (error) { issue = error; }
    finally { loading = false; if (owner.alive()) owner.paint(); }
  }

  function previewView(id: number) {
    const item = service.find(id);
    if (!item) return;
    let busy = false, issue: unknown = null;
    const summary = service.summary(item.layout);
    const owner = frame(() => label('open_title', {name: item.name}), () => h('div', {class: 'named-workspace-preview'}, [
      h('strong', null, label('tab_count', {count: summary.tabs})),
      h('p', null, summary.connections.join(label('connection_separator')) || label('no_connection_tabs')),
      h('p', null, (summary.groups > 1 ? `${label('group_count', {count: summary.groups})} · ` : '')
        + label(summary.forwards ? 'will_start_forwards' : 'no_forwards', {count: summary.forwards})),
      summary.missing ? h('p', {class: 'named-workspace-error'}, label('missing_references', {count: summary.missing})) : null,
      issue ? issueText(issue) : null
    ]), () => [
      action(tr('common:actions.back'), manager, 'arrow-left', '', busy),
      action(label(summary.missing ? 'repair_missing' : 'confirm_open'), async () => {
        if (busy) return;
        if (summary.missing) { repair(id); return; }
        busy = true;
        owner.paint();
        try {
          const result = await service.apply(id, owner.alive);
          if (result) await showPartial(result);
        } catch (error) {
          if (owner.alive()) issue = error;
          else service.notifyError(error);
        } finally { busy = false; if (owner.alive()) owner.paint(); }
      }, 'check', 'primary', busy)
    ]);
  }

  function repairView(id: number) {
    const item = service.find(id);
    if (!item) return;
    const rows = service.missing(item.layout);
    const values = new Map(rows.map(row => [bindingKey(row.kind, row.id), row.value]));
    let busy = false, issue: unknown = null;
    const owner = frame(() => label('repair_title'), () => h('div', {class: 'named-workspace-repair'}, [
      ...rows.map(row => {
        const key = bindingKey(row.kind, row.id);
        return h('label', {key}, [
          h('span', null, [row.name, h('small', null, row.detail)]),
          h('select', {
            'data-workspace-missing-kind': row.kind, 'data-workspace-missing-id': row.id,
            value: values.get(key) || '', disabled: busy,
            onChange: (event: Event) => values.set(key, (event.target as HTMLSelectElement).value)
          }, [
            h('option', {value: ''}, label(row.kind === 'ssh' ? 'select_existing_ssh' : 'select_matching_protocol')),
            ...row.options.map(option => h('option', {value: option.value}, option.label))
          ])
        ]);
      }),
      issue ? issueText(issue) : null
    ]), () => [
      action(tr('common:actions.back'), () => preview(id), 'arrow-left', '', busy),
      action(label('save_binding'), async () => {
        if (busy) return;
        busy = true;
        owner.paint();
        try { if (await service.repair(id, values) && owner.alive()) preview(id); }
        catch (error) { issue = error; }
        finally { busy = false; if (owner.alive()) owner.paint(); }
      }, 'save', 'primary', busy)
    ]);
  }

  const page = (key: string, open: () => unknown) => quickServices.termaCommandNavigation
    ? quickServices.termaCommandNavigation.page(key, open) : open();
  const manager = async () => { await page('workspace-manager', managerView); };
  const preview = (id: number) => { page(`workspace-preview-${id}`, () => previewView(id)); };
  const repair = (id: number) => { page(`workspace-repair-${id}`, () => repairView(id)); };
  const save = async () => { try { await page('workspace-save', service.save); } catch (error) { service.notifyError(error); } };
  return {manager, preview, repair, save, close: () => dialog?.close()};
}

export function installNamedWorkspaceViews() {
  let feature: ReturnType<typeof createNamedWorkspaceViews> | undefined;
  const current = () => feature ??= createNamedWorkspaceViews(quickServices.termaNamedWorkspacePresets);
  quickServices.termaNamedWorkspaces = {
    manager: () => current().manager(), preview: id => current().preview(id),
    repair: id => current().repair(id), save: () => current().save(), close: () => feature?.close()
  };
}


export interface InstalledFeaturesQuickNamedWorkspaceViewsServices {
  termaNamedWorkspaces: ReturnType<typeof createNamedWorkspaceViews>
}
