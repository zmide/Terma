/** Fit translated actions to their actual column, including manually resized columns. */
export function fitSftpRowActions(list: HTMLElement | null) {
  if (!list?.isConnected) return;
  const bars = [...list.querySelectorAll<HTMLElement>('.sftp-row-actions')];
  for (const bar of bars) {
    delete bar.dataset.sftpMoreIcon;
    for (const button of bar.querySelectorAll<HTMLElement>('[data-sftp-action-hidden]')) delete button.dataset.sftpActionHidden;
  }
  const plans = bars.map(bar => {
    const buttons = [...bar.querySelectorAll<HTMLButtonElement>('.sftp-row-action')];
    const more = buttons.find(button => button.classList.contains('sftp-row-action-more'));
    const available = bar.clientWidth;
    const gap = Number.parseFloat(getComputedStyle(bar).columnGap) || 0;
    const widths = new Map(buttons.map(button => [button, button.getBoundingClientRect().width]));
    const visible = new Set(buttons);
    const hidden: HTMLButtonElement[] = [];
    const total = () => [...visible].reduce((width, button) => width + (widths.get(button) || 0), 0) + Math.max(0, visible.size - 1) * gap;
    for (const level of ['wide', 'medium', 'core']) {
      for (const button of buttons.filter(button => button.classList.contains(`sftp-row-action-${level}`)).reverse()) {
        if (total() <= available + .5) break;
        visible.delete(button);
        hidden.push(button);
      }
    }
    return { bar, more, hidden, icon: total() > available + .5 };
  });
  for (const { bar, more, hidden, icon } of plans) {
    for (const button of hidden) button.dataset.sftpActionHidden = '1';
    if (icon) bar.dataset.sftpMoreIcon = '1';
    if (more && hidden.some(button => button === document.activeElement)) more.focus({ preventScroll: true });
  }
}
