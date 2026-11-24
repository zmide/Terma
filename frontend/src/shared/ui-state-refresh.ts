export interface UiStateRevisionResponse {
  revision?: string | number | null;
}

export interface UiStateRefreshPort {
  requestRevision: () => Promise<UiStateRevisionResponse | string | number | null | undefined>;
  reload: () => void | Promise<void>;
  isHidden?: () => boolean;
}

export interface UiStateRefreshSnapshot {
  revision: string;
  inFlight: boolean;
  changedAt: number;
}

export interface UiStateRefreshService {
  check(options?: { force?: boolean }): Promise<boolean>;
  reset(): void;
  getSnapshot(): UiStateRefreshSnapshot;
}

function revisionFrom(value: UiStateRevisionResponse | string | number | null | undefined): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return String(value?.revision || '');
}

export function createUiStateRefreshService(port: UiStateRefreshPort): UiStateRefreshService {
  let revision = '';
  let inFlight = false;
  let changedAt = Date.now();

  const update = (nextRevision: string) => {
    revision = nextRevision;
    changedAt = Date.now();
  };

  return {
    async check(options = {}) {
      if (inFlight || port.isHidden?.() === true) return false;
      inFlight = true;
      changedAt = Date.now();
      try {
        const nextRevision = revisionFrom(await port.requestRevision());
        const first = !revision;
        const changed = Boolean(nextRevision && nextRevision !== revision);
        if (nextRevision) update(nextRevision);
        if (options.force === true || (!first && changed)) await port.reload();
        return changed;
      } catch {
        await port.reload();
        return true;
      } finally {
        inFlight = false;
        changedAt = Date.now();
      }
    },
    reset() {
      revision = '';
      inFlight = false;
      changedAt = Date.now();
    },
    getSnapshot() {
      return { revision, inFlight, changedAt };
    }
  };
}

