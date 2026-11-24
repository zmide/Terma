import {workspaceServices} from '@/features/workspace/installed-services';
import {terminalServices} from '@/features/terminal/installed-services';
import {registerTermaI18nRenderer} from '@/shared/i18n/workspace-bootstrap';
import {translate as tr} from './i18n/runtime';
import {icon} from './ui/icon-service';
export function preferredTheme() {
  return localStorage.getItem("theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

export function syncThemeToggleControls(theme=document.documentElement.dataset.theme || preferredTheme()) {
  const text = theme === "dark"
    ? tr("common:auto.switch_to_light", {defaultValue:"切换为亮色"})
    : tr("common:auto.switch_to_dark", {defaultValue:"切换为暗色"});
  workspaceServices.termaWorkspaceShell?.refresh();
  document.querySelectorAll<HTMLElement>(".theme-toggle").forEach(btn => {
    if (btn.closest("[data-terma-shell-owned]")) return;
    btn.title = text;
    btn.setAttribute("aria-label", text);
    btn.innerHTML = icon(theme === "dark" ? "sun" : "moon");
  });
}

export function applyTheme(theme:string) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("theme", theme);
  syncThemeToggleControls(theme);
  (window.termaDesktop as {setTheme?(theme:string):unknown}|undefined)?.setTheme?.(theme);
  terminalServices.termaTerminalSettings?.applyAll();
  if (terminalServices.termaTerminalViews?.settingsActive()) terminalServices.termaTerminalViews.refreshSettings();
}

export function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}
export function installThemeRuntime(){registerTermaI18nRenderer?.(()=>syncThemeToggleControls());}
