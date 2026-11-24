import {quickServices} from '@/features/quick/installed-services';
import { openSettingsDialog, unmountSettingsDialog } from '@/features/settings/settings-dialog-mount';
import { releaseQuickView } from '../quick/quick-mount';
import type { X11Port } from './x11-types';

export type X11Modal = HTMLElement & { _x11ConnectionId?: number };

export function createX11Surfaces(showError: X11Port['manager']['error']): Pick<X11Port, 'manager' | 'guide' | 'header'> {
  const modalElement = () => document.getElementById('modal') as X11Modal | null;
  const isManager = (modal: X11Modal) => Boolean(modal.querySelector('.xserver-manager'));
  return {
    manager: {
      loading: () => quickServices.termaQuickViews?.showXServerManagerLoading(),
      paint: snapshot => quickServices.termaQuickViews?.renderXServerManager(snapshot),
      error: showError,
      close() {
        const modal = modalElement();
        if (!modal || !isManager(modal)) return;
        if (modal.dataset.xServerManager !== '1' && modal.dataset.termaSettingsDialog !== 'xserver-local') return;
        delete modal.dataset.xServerManager;
        modal.hidden = true;
        unmountSettingsDialog();
        releaseQuickView(modal);
      },
      visible() {
        const modal = modalElement();
        return Boolean(modal && !modal.hidden && modal.dataset.xServerManager === '1' && isManager(modal));
      },
      canRestore: () => modalElement()?.hidden === true,
      settings: (diagnostics, error) => openSettingsDialog('xserver-local', { diagnostics, error }),
      settingsVisible() {
        const modal = modalElement();
        return Boolean(modal && !modal.hidden && modal.dataset.termaSettingsDialog === 'xserver-local' && isManager(modal));
      },
    },
    guide: {
      paint: (id, result) => quickServices.termaQuickViews?.renderX11InstallGuide(id, result),
      close() {
        const modal = modalElement();
        if (!modal?.querySelector('.x11-install-guide')) return;
        delete modal._x11ConnectionId;
        releaseQuickView(modal);
        modal.hidden = true;
        modal.onclick = null;
        modal.replaceChildren();
      },
      visible(id) {
        const modal = modalElement();
        return Boolean(modal && !modal.hidden && modal._x11ConnectionId === id && modal.querySelector('.x11-install-guide'));
      },
    },
    header: (snapshot, error) => quickServices.termaQuickViews?.renderQuickHeader(snapshot, error),
  };
}
