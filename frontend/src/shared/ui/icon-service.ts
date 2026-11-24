import {sharedServices} from '@/shared/installed-services';
type IconAttributes = Record<string, string | number>;
type LucideNode = [string, IconAttributes];

export interface LucideSource {
  icons?: Record<string, LucideNode[]>;
  createIcons?: (options: { attrs: IconAttributes }) => void;
  [key: string]: unknown;
}

export interface IconDefinition {
  tag: string;
  attributes: IconAttributes;
  children: IconDefinition[] | string;
}

export function iconDefinition(source: LucideSource | undefined, value: unknown, label = ''): IconDefinition {
  const name = String(value || '');
  const accessibility: IconAttributes = label ? { 'aria-label': label } : { 'aria-hidden': 'true' };
  if (name === 'x11') {
    return {
      tag: 'span',
      attributes: { class: 'composite-icon x11-icon', ...accessibility },
      children: [iconDefinition(source, 'monitor'), { tag: 'b', attributes: {}, children: 'X11' }]
    };
  }
  const key = name.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  const nodes = source?.icons?.[key] || source?.[key];
  if (!Array.isArray(nodes)) return { tag: 'span', attributes: { class: 'icon-fallback', 'aria-hidden': 'true' }, children: [] };
  return {
    tag: 'svg',
    attributes: {
      class: `lucide lucide-${name}`, ...accessibility,
      width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    },
    children: (nodes as LucideNode[]).map(([tag, attributes]) => ({ tag, attributes, children: [] }))
  };
}

function escapeIconText(value: string | number): string {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]!);
}

export function iconHtml(definition: IconDefinition): string {
  const attributes = Object.entries(definition.attributes).map(([key, value]) => `${key}="${escapeIconText(value)}"`).join(' ');
  const children = typeof definition.children === 'string'
    ? escapeIconText(definition.children)
    : definition.children.map(iconHtml).join('');
  return `<${definition.tag}${attributes ? ' ' + attributes : ''}>${children}</${definition.tag}>`;
}

export function installIconService() {
  sharedServices.termaIcons = {
    html: (name, label = '') => iconHtml(iconDefinition(window.lucide, name, label)),
    refresh() {
      if (!window.lucide?.createIcons || !document.querySelector('i[data-lucide]')) return;
      window.lucide.createIcons({ attrs: { 'stroke-width': 1.8 } });
      document.querySelectorAll('svg[data-lucide]').forEach(svg => svg.removeAttribute('data-lucide'));
    }
  };
}

declare global {
  interface Window {
    lucide?: LucideSource;
  }
}


export const icon=(name:unknown,label='')=>sharedServices.termaIcons.html(name,label);
export const x11Icon=(label='')=>icon('x11',label);
export function refreshIcons(){sharedServices.termaFormControls?.enhancePasswords(document);sharedServices.termaIcons.refresh();}

export interface InstalledSharedUiIconServiceServices {
  termaIcons: { html(name: unknown, label?: string): string; refresh(): void };
}
