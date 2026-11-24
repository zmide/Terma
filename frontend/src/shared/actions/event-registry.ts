import {sharedServices} from '@/shared/installed-services';
export interface DelegatedActionContext {
  event: Event;
  element: Element;
  action: string;
  dataset: DOMStringMap;
}

export type DelegatedActionHandler = (context: DelegatedActionContext) => unknown | Promise<unknown>;

export interface EventRegistry {
  register(name: string, handler: DelegatedActionHandler): void;
  unregister(name: string): boolean;
  has(name: string): boolean;
  dispatch(name: string, context: DelegatedActionContext): unknown | Promise<unknown>;
  registeredActions(): string[];
}

export interface DelegatedEventPort {
  unregistered(action: string): void;
  error(error: unknown): void;
}

const delegatedEvents = [
  ['click', 'data-action'],
  ['change', 'data-change-action'],
  ['input', 'data-input-action'],
  ['dblclick', 'data-dblclick-action'],
  ['contextmenu', 'data-contextmenu-action'],
  ['pointerdown', 'data-pointerdown-action'],
  ['keydown', 'data-keydown-action'],
  ['submit', 'data-submit-action'],
  ['dragstart', 'data-dragstart-action'],
  ['dragover', 'data-dragover-action'],
  ['dragleave', 'data-dragleave-action'],
  ['drop', 'data-drop-action'],
  ['dragend', 'data-dragend-action']
] as const;

export function bindDelegatedEvents(registry: EventRegistry, port: DelegatedEventPort, doc: Document = document) {
  let alive = true;
  const report = (error: unknown) => { if (alive) port.error(error); };
  const listeners = delegatedEvents.map(([type, attribute]) => {
    const listener = (event: Event) => {
      if (!alive || !(event.target instanceof Element)) return;
      const element = event.target.closest(`[${attribute}]`);
      if (!element || !doc.documentElement.contains(element)) return;
      const action = String(element.getAttribute(attribute) || '').trim();
      if (!registry.has(action)) { port.unregistered(action); return; }
      try {
        const result = registry.dispatch(action, {event, element, action, dataset: (element as HTMLElement).dataset});
        if (event.cancelBubble) event.stopImmediatePropagation();
        void Promise.resolve(result).catch(report);
      } catch (error) {
        report(error);
      }
    };
    doc.addEventListener(type, listener);
    return {type, listener};
  });
  return () => {
    if (!alive) return;
    alive = false;
    for (const {type, listener} of listeners) doc.removeEventListener(type, listener);
  };
}

export function createEventRegistry(): EventRegistry {
  const handlers = new Map<string, DelegatedActionHandler>();
  const normalize = (name: string) => String(name || '').trim();
  return {
    register(name, handler) {
      const key = normalize(name);
      if (!key) throw new Error('事件委托 action 名称不能为空');
      if (typeof handler !== 'function') throw new Error(`事件委托 ${key} 缺少处理函数`);
      if (handlers.has(key)) throw new Error(`事件委托 action 重复注册：${key}`);
      handlers.set(key, handler);
    },
    unregister(name) {
      return handlers.delete(normalize(name));
    },
    has(name) {
      return handlers.has(normalize(name));
    },
    dispatch(name, context) {
      const handler = handlers.get(normalize(name));
      return handler?.(context);
    },
    registeredActions() {
      return [...handlers.keys()].sort();
    }
  };
}

export function installEventRegistry(port:DelegatedEventPort): EventRegistry {
  if (sharedServices.termaEventRegistry) return sharedServices.termaEventRegistry;
  const registry = createEventRegistry();
  sharedServices.termaEventRegistry = registry;
  window.dispatchEvent(new CustomEvent('terma-events-ready'));
  const dispose = bindDelegatedEvents(registry, port);
  window.addEventListener('beforeunload', dispose, {once: true});
  return registry;
}



export interface InstalledSharedActionsEventRegistryServices {
  termaEventRegistry?: EventRegistry;
}
