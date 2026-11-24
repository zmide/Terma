import {tr} from '@/shared/i18n/workspace-bootstrap';
import {localizedTermaUiPhrase} from '@/shared/i18n/ui-phrase';
import {icon} from '@/shared/ui/icon-service';
import {localizeConnectionExtraArgsIssue, type ConnectionValidationIssue, type ConnectionValidationTranslator} from './connection-validation-service';

type Row = {item: ConnectionValidationIssue; label: HTMLElement; message: HTMLElement; suggestion: HTMLElement};
type Report = {errors: number; rows: Row[]; summary: HTMLElement; hint: HTMLElement};
const reports = new WeakMap<HTMLFormElement, Report>();

export function openAdvancedOptions(form: HTMLFormElement) {
  const details = form.querySelector<HTMLDetailsElement>('#connAdvancedOptions');
  if (details) details.open = true;
}

export function updateAdvancedStatus(form: HTMLFormElement, openForIssues = true) {
  const status = form.querySelector<HTMLElement>('#connAdvancedStatus');
  if (!status) return;
  const report = reports.get(form);
  const errors = report?.errors ?? 0;
  const warnings = (report?.rows.length ?? 0) - errors;
  const detection = form.querySelector('#connTerminalDetectionStatus');
  const terminalError = detection?.classList.contains('error');
  const terminalWarning = detection?.classList.contains('warning');
  const parts = [];
  if (errors) parts.push(tr('connections:validation.error_count', {count: errors}));
  if (warnings) parts.push(tr('connections:validation.warning_count', {count: warnings}));
  if (terminalError) parts.push(tr('connections:validation.terminal_failed'));
  else if (terminalWarning) parts.push(tr('connections:validation.terminal_warning'));
  status.textContent = parts.join(' · ') || tr('connections:validation.summary');
  status.className = `connection-form-advanced-status${errors || terminalError ? ' error' : warnings || terminalWarning ? ' warning' : ''}`;
  if (openForIssues && parts.length) openAdvancedOptions(form);
}

export function focusExtraArgsIssue(form: HTMLFormElement, issue: ConnectionValidationIssue) {
  const editor = form.querySelector<HTMLTextAreaElement>('#conn_extra');
  if (!editor) return;
  openAdvancedOptions(form);
  const start = Math.max(0, Math.min(editor.value.length, Number(issue.start) || 0));
  const end = Math.max(start, Math.min(editor.value.length, Number(issue.end ?? start) || 0));
  editor.focus({preventScroll: true});
  editor.setSelectionRange(start, end);
  editor.scrollIntoView({block: 'center', behavior: 'smooth'});
}

export function refreshExtraArgsLanguage(form: HTMLFormElement) {
  const report = reports.get(form);
  if (report) {
    report.summary.textContent = report.errors
      ? tr('connections:validation.fix_count', {count: report.errors})
      : tr('connections:validation.warning_count', {count: report.rows.length});
    report.hint.textContent = tr('connections:validation.click_to_locate');
    for (const {item, label, message, suggestion} of report.rows) {
      const localized = localizeConnectionExtraArgsIssue(item, {tr, localizedPhrase: localizedTermaUiPhrase});
      label.textContent = tr('connections:validation.line_label', {line: Number(item.line || 1), option: localized.option});
      message.textContent = localized.message;
      suggestion.hidden = !localized.suggestion;
      suggestion.textContent = localized.suggestion;
    }
  }
  updateAdvancedStatus(form, false);
}

export function renderExtraArgsDiagnostics(form: HTMLFormElement, issues: ConnectionValidationIssue[] = []) {
  const editor = form.querySelector('#conn_extra');
  const box = form.querySelector<HTMLElement>('#connExtraDiagnostics');
  if (!editor || !box) return;
  const items = Array.isArray(issues) ? issues.filter(item => item && typeof item === 'object') : [];
  const errors = items.filter(item => item.severity === 'error').length;
  editor.setAttribute('aria-invalid', String(Boolean(errors)));
  editor.classList.toggle('has-validation-error', Boolean(errors));
  box.hidden = !items.length;
  box.className = `ssh-extra-diagnostics${items.length ? errors ? ' has-errors' : ' has-warnings' : ''}`;
  if (!items.length) {
    reports.delete(form);
    box.replaceChildren();
    updateAdvancedStatus(form);
    return;
  }
  const doc = box.ownerDocument;
  const heading = doc.createElement('div');
  heading.className = 'ssh-extra-diagnostics-head';
  const summary = doc.createElement('strong'), hint = doc.createElement('span');
  heading.append(summary, hint);
  const rows: Row[] = [];
  const fragment = doc.createDocumentFragment();
  fragment.append(heading);
  for (const item of items) {
    const warning = item.severity === 'warning';
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = `ssh-extra-issue ${warning ? 'warning' : 'error'}`;
    const title = doc.createElement('span');
    title.className = 'ssh-extra-issue-title';
    title.insertAdjacentHTML('afterbegin', icon(warning ? 'triangle-alert' : 'circle-alert'));
    const label = doc.createElement('b'), message = doc.createElement('span'), suggestion = doc.createElement('small');
    title.append(label);
    button.append(title, message, suggestion);
    button.addEventListener('click', () => focusExtraArgsIssue(form, item));
    fragment.append(button);
    rows.push({item, label, message, suggestion});
  }
  reports.set(form, {errors, rows, summary, hint});
  box.replaceChildren(fragment);
  refreshExtraArgsLanguage(form);
  openAdvancedOptions(form);
}

export function resetAdvancedOptions(form: HTMLFormElement) {
  renderExtraArgsDiagnostics(form);
  updateAdvancedStatus(form, false);
  const details = form.querySelector<HTMLDetailsElement>('#connAdvancedOptions');
  if (details) details.open = false;
}
