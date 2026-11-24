import {sharedServices} from '@/shared/installed-services';
export type BootstrapPhase =
  | 'created'
  | 'waiting-workspace'
  | 'initializing-shell'
  | 'loading-data'
  | 'restoring-tabs'
  | 'ready'
  | 'failed';

export interface BootstrapSnapshot {
  phase: BootstrapPhase;
  changedAt: number;
  detail?: Record<string, unknown>;
}

export interface BootstrapSteps {
  waitForWorkspace?: () => void | Promise<void>;
  initializeShell?: () => void | Promise<void>;
  loadData?: () => void | Promise<void>;
  restore?: () => void | Promise<void>;
}

export interface BootstrapRuntime {
  getSnapshot(): BootstrapSnapshot;
  mark(phase: BootstrapPhase, detail?: Record<string, unknown>): BootstrapSnapshot;
  run(steps: BootstrapSteps): Promise<void>;
  subscribe(listener: (snapshot: BootstrapSnapshot) => void): () => void;
}

const phases = new Set<BootstrapPhase>([
  'created',
  'waiting-workspace',
  'initializing-shell',
  'loading-data',
  'restoring-tabs',
  'ready',
  'failed'
]);

function normalizePhase(value: BootstrapPhase): BootstrapPhase {
  return phases.has(value) ? value : 'created';
}

export function createBootstrapRuntime(initial: Partial<BootstrapSnapshot> = {}): BootstrapRuntime {
  const listeners = new Set<(snapshot: BootstrapSnapshot) => void>();
  let snapshot: BootstrapSnapshot = {
    phase: normalizePhase(initial.phase || 'created'),
    changedAt: Number(initial.changedAt) || Date.now(),
    detail: initial.detail ? { ...initial.detail } : undefined
  };
  return {
    getSnapshot: () => ({ ...snapshot, detail: snapshot.detail ? { ...snapshot.detail } : undefined }),
    async run(steps) {
      this.mark('waiting-workspace');
      await steps.waitForWorkspace?.();
      this.mark('initializing-shell');
      await steps.initializeShell?.();
      this.mark('loading-data');
      await steps.loadData?.();
      this.mark('restoring-tabs');
      await steps.restore?.();
      this.mark('ready');
    },
    mark(phase, detail) {
      snapshot = {
        phase: normalizePhase(phase),
        changedAt: Date.now(),
        detail: detail ? { ...detail } : undefined
      };
      const next = { ...snapshot, detail: snapshot.detail ? { ...snapshot.detail } : undefined };
      for (const listener of [...listeners]) listener(next);
      return next;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

export function installBootstrapRuntime(): BootstrapRuntime {
  if (sharedServices.termaBootstrapRuntime) return sharedServices.termaBootstrapRuntime;
  const runtime = createBootstrapRuntime();
  sharedServices.termaBootstrapRuntime = runtime;
  window.dispatchEvent(new CustomEvent('terma-bootstrap-ready'));
  return runtime;
}



export interface InstalledSharedBootstrapRuntimeServices {
  termaBootstrapRuntime?: BootstrapRuntime;
}
