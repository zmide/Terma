export interface WorkspaceRestorePort {
  detached?: () => boolean;
  detachedProfileId?: () => number;
  savedLanguage?: () => string | undefined;
  documentLanguage?: () => string | undefined;
  setLanguage: (language: string, options: { render: boolean; emit: boolean }) => void | Promise<void>;
  initDetachedVnc: (profileId: number) => void | Promise<void>;
  ensureLanguageOnboarding: () => void | Promise<void>;
  restoreTabs: () => boolean | Promise<boolean>;
  renderWelcome: () => void;
  saveTabs: () => void;
  syncResponsivePane: () => void;
  setRestorePending?: (pending: boolean) => void;
  setRestoring?: (restoring: boolean) => void;
}

export interface WorkspaceRestoreService {
  restore(): Promise<boolean>;
}

export function createWorkspaceRestoreService(port: WorkspaceRestorePort): WorkspaceRestoreService {
  return {
    async restore() {
      const detached = port.detached?.() === true;
      port.setRestoring?.(true);
      try {
        if (detached) {
          const language = port.savedLanguage?.() || port.documentLanguage?.() || '';
          if (language) await port.setLanguage(language, { render: false, emit: false });
          await port.initDetachedVnc(port.detachedProfileId?.() || 0);
          port.setRestorePending?.(false);
          return true;
        }
        await port.ensureLanguageOnboarding();
        const restored = await port.restoreTabs();
        if (!restored) port.renderWelcome();
        port.setRestorePending?.(false);
        port.saveTabs();
        port.syncResponsivePane();
        return Boolean(restored);
      } finally {
        port.setRestoring?.(false);
        port.setRestorePending?.(false);
      }
    }
  };
}

