import {sharedServices} from '@/shared/installed-services';
export interface StateSource {
  owners?: Record<string, readonly string[]>;
  snapshot(): unknown;
}

export interface StateRegistry {
  owners: Readonly<Record<string, readonly string[]>>;
  snapshot(): unknown;
  subscribe(listener: (snapshot: unknown) => void): () => void;
  notify(snapshot?: unknown): void;
}

export function createStateRegistry(source: StateSource): StateRegistry {
  const listeners = new Set<(snapshot: unknown) => void>();
  const owners = Object.freeze({ ...(source.owners || {}) });
  return {
    owners,
    snapshot: () => source.snapshot(),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify(snapshot = source.snapshot()) {
      for (const listener of [...listeners]) listener(snapshot);
    }
  };
}

export function installStateRegistry(source:StateSource): StateRegistry {
  if (sharedServices.termaStateRegistry) return sharedServices.termaStateRegistry;
  const registry = createStateRegistry(source);
  sharedServices.termaStateRegistry = registry;
  window.dispatchEvent(new CustomEvent('terma-state-ready'));
  return registry;
}



export interface InstalledSharedStateStateRegistryServices {
  termaStateRegistry?: StateRegistry;
}
