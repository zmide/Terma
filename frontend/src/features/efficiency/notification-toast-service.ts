export type ToastLevel = 'info' | 'success' | 'error';
export type ToastAction = Record<string, unknown>;
export interface ToastPreferences {
  info: { enabled: boolean; duration_ms: number };
  success: { enabled: boolean; duration_ms: number };
  error: { enabled: boolean; duration_ms: number };
  progress: { enabled: boolean; success_duration_ms: number | null; error_duration_ms: number };
}
export interface ProgressToastOptions {
  title?: string;
  detail?: string;
  icon?: string;
  progress?: number;
  onPauseChange?: (paused: boolean) => void;
  onCancel?: () => void;
}
export interface ProgressToastUpdate {
  title?: string;
  detail?: string;
  progress?: number;
  paused?: boolean;
  pausable?: boolean;
  cancellable?: boolean;
}
export interface ToastModel {
  id: string;
  level: ToastLevel;
  title: string;
  detail: string;
  titleKey?: string;
  detailKey?: string;
  icon: string;
  replaceKey?: string;
  action?: ToastAction;
  progress?: { value: number | null; paused: boolean; pausable: boolean; cancellable: boolean; settled: boolean; failed: boolean };
  leaving?: boolean;
}
export interface ToastPort {
  available(): boolean;
  clearNotice(): void;
  preferences(): ToastPreferences;
  paint(models: readonly ToastModel[]): void;
  leave(id: string, finish: () => void): () => void;
  defaultText(kind: 'processing' | 'done' | 'failed'): string;
  now(): number;
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(timer: unknown): void;
}

export function notificationDisplayPreferences(saved?: Partial<Record<keyof ToastPreferences, Record<string, unknown>>> | null): ToastPreferences {
  const source = saved || {};
  return {
    info: { enabled: source.info?.enabled !== false, duration_ms: Number(source.info?.duration_ms) || 3500 },
    success: { enabled: source.success?.enabled !== false, duration_ms: Number(source.success?.duration_ms) || 3500 },
    error: { enabled: source.error?.enabled !== false, duration_ms: Number(source.error?.duration_ms) || 8000 },
    progress: {
      enabled: source.progress?.enabled !== false,
      success_duration_ms: Number.isInteger(source.progress?.success_duration_ms) ? Number(source.progress!.success_duration_ms) : null,
      error_duration_ms: Number(source.progress?.error_duration_ms) || 8000
    }
  };
}

export function createNotificationToastService(port: ToastPort) {
  const models = new Map<string, ToastModel>();
  const deadlines = new Map<string, { remaining: number; startedAt: number; timer?: unknown }>();
  const pauses = new Map<string, Set<string>>();
  const exits = new Map<string, () => void>();
  const progressActions = new Map<string, { pause(): void; cancel(): void }>();
  let sequence = 0;
  const paint = () => port.paint([...models.values()]);
  const active = (id: string) => models.has(id) && !models.get(id)!.leaving;
  const clearDeadline = (id: string) => {
    const deadline = deadlines.get(id);
    if (deadline?.timer !== undefined) port.clearTimeout(deadline.timer);
    deadlines.delete(id);
  };
  function remove(id: string) {
    exits.get(id)?.();
    exits.delete(id);
    clearDeadline(id);
    pauses.delete(id);
    progressActions.delete(id);
    if (models.delete(id)) paint();
  }
  function dismiss(id?: string) {
    if (!id) { for (const key of models.keys()) dismiss(key); return; }
    if (!active(id)) return;
    models.get(id)!.leaving = true;
    clearDeadline(id);
    pauses.delete(id);
    paint();
    const cancel = port.leave(id, () => remove(id));
    if (models.has(id)) exits.set(id, cancel);
  }
  function schedule(id: string, delay: number) {
    clearDeadline(id);
    if (!active(id)) return;
    const remaining = Math.max(0, Number(delay) || 0);
    const deadline: { remaining: number; startedAt: number; timer?: unknown } = { remaining, startedAt: port.now() };
    deadlines.set(id, deadline);
    if (!pauses.get(id)?.size) deadline.timer = port.setTimeout(() => dismiss(id), remaining);
  }
  function pause(id: string, reason: string) {
    if (!active(id) || !reason) return;
    const reasons = pauses.get(id) || new Set<string>();
    if (reasons.has(reason)) return;
    pauses.set(id, reasons);
    const alreadyPaused = reasons.size > 0;
    reasons.add(reason);
    const deadline = deadlines.get(id);
    if (alreadyPaused || !deadline) return;
    deadline.remaining = Math.max(120, deadline.remaining - Math.max(0, port.now() - deadline.startedAt));
    if (deadline.timer !== undefined) port.clearTimeout(deadline.timer);
    deadline.timer = undefined;
  }
  function resume(id: string, reason: string) {
    const reasons = pauses.get(id);
    if (!reasons?.delete(reason) || reasons.size) return;
    pauses.delete(id);
    const deadline = deadlines.get(id);
    if (deadline) schedule(id, Math.max(120, deadline.remaining));
  }
  function notify(text: unknown, type = 'info', options: { replaceKey?: string; action?: ToastAction } = {}) {
    port.clearNotice();
    if (!text || !port.available()) return;
    const level: ToastLevel = type === 'success' || type === 'error' ? type : 'info';
    const preference = port.preferences()[level];
    if (!preference.enabled) return;
    const lines = String(text).split('\n');
    const replaceKey = String(options.replaceKey || '').trim();
    const existing = replaceKey ? [...models.values()].find(item => item.replaceKey === replaceKey && !item.leaving) : undefined;
    const model: ToastModel = existing || { id: `toast-${port.now()}-${++sequence}`, level, title: '', detail: '', icon: '', replaceKey, action: options.action };
    Object.assign(model, { level, title: lines.shift() || 'Terma', detail: lines.join('\n').trim(), icon: level === 'success' ? 'circle-check' : level === 'error' ? 'circle-alert' : 'info' });
    models.set(model.id, model);
    paint();
    schedule(model.id, preference.duration_ms);
  }
  function createProgress(options: ProgressToastOptions = {}) {
    const preference = port.preferences().progress;
    const model: ToastModel = {
      id: `toast-progress-${port.now()}-${++sequence}`, level: 'info',
      title: options.title || port.defaultText('processing'), detail: options.detail || '', icon: options.icon || 'loader-circle',
      titleKey: options.title ? undefined : 'common:auto.processing_now',
      progress: { value: null, paused: false, pausable: typeof options.onPauseChange === 'function', cancellable: typeof options.onCancel === 'function', settled: false, failed: false }
    };
    const progress = model.progress!;
    const enabled = port.available() && preference.enabled;
    const live = () => enabled && active(model.id) && !progress.settled;
    const controller = {
      update(next: ProgressToastUpdate = {}) {
        if (!live()) return;
        if (next.title !== undefined) { model.title = next.title || 'Terma'; model.titleKey = undefined; }
        if (next.detail !== undefined) { model.detail = next.detail || ''; model.detailKey = undefined; }
        const value = Number(next.progress);
        progress.value = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
        if (next.paused !== undefined) progress.paused = Boolean(next.paused);
        if (next.pausable !== undefined) progress.pausable = Boolean(next.pausable) && typeof options.onPauseChange === 'function';
        if (next.cancellable !== undefined) progress.cancellable = Boolean(next.cancellable) && typeof options.onCancel === 'function';
        paint();
      },
      setPaused(value: boolean) {
        if (!live()) return;
        progress.paused = Boolean(value);
        paint();
      },
      finish(message = '', linger = 2200) {
        if (!live()) return;
        progress.settled = true;
        progress.paused = false;
        progress.value = 100;
        model.level = 'success';
        model.icon = 'circle-check';
        model.detail = message || port.defaultText('done');
        model.detailKey = message ? undefined : 'common:auto.done';
        paint();
        schedule(model.id, preference.success_duration_ms === null ? linger : preference.success_duration_ms);
      },
      fail(message = '') {
        if (!live()) return;
        progress.settled = true;
        progress.paused = false;
        progress.failed = true;
        model.level = 'error';
        model.icon = 'circle-alert';
        model.detail = message || port.defaultText('failed');
        model.detailKey = message ? undefined : 'common:auto.operation_failed';
        paint();
        schedule(model.id, preference.error_duration_ms);
      },
      complete() {
        if (!live()) return;
        progress.settled = true;
        remove(model.id);
      },
      dismiss() {
        if (!enabled || !active(model.id)) return;
        const cancel = !progress.settled;
        progress.settled = true;
        dismiss(model.id);
        if (cancel) options.onCancel?.();
      }
    };
    if (enabled) {
      models.set(model.id, model);
      progressActions.set(model.id, {
        pause() {
          if (!live() || !progress.pausable) return;
          controller.setPaused(!progress.paused);
          options.onPauseChange?.(progress.paused);
        },
        cancel: controller.dismiss
      });
      controller.update({ progress: options.progress });
    }
    return controller;
  }
  function dispose() {
    for (const id of [...models.keys()]) remove(id);
  }
  return { notify, createProgress, dismiss, pause, resume, repaint: paint, dispose,
    toggleProgress: (id: string) => progressActions.get(id)?.pause(),
    cancelProgress: (id: string) => progressActions.get(id)?.cancel(),
    get size() { return models.size; },
    get timerCount() { return deadlines.size + exits.size; }
  };
}
