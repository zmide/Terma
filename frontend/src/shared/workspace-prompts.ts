type PromptText = string | (() => string);

interface Choice<Value> {
  label: PromptText;
  value: Value;
  className?: string;
}

interface WorkspacePromptHost {
  open(kind: 'choice' | 'input', values: Record<string, unknown>): void;
  close(): void;
  page<Value>(key: string, open: () => Promise<Value>): Promise<Value>;
  text(key: string, options: {defaultValue: string}): string;
  phrase(text: string): string;
  selectInput(): void;
}

let host: WorkspacePromptHost | undefined;

function promptHost(): WorkspacePromptHost {
  if (!host) throw new Error('Workspace prompts are not installed');
  return host;
}

function localized(text: PromptText): string {
  return promptHost().phrase(typeof text === 'function' ? text() : text);
}

function showPrompt<Value>(kind: 'choice' | 'input', localize: () => Record<string, unknown>, cancelled: Value, fields: Record<string, unknown> = {}): Promise<Value> {
  return new Promise(resolve => {
    const current = promptHost();
    let finished = false;
    const complete = (value: Value, close: boolean) => {
      if (finished) return;
      finished = true;
      if (close) current.close();
      resolve(value);
    };
    current.open(kind, { ...fields, ...localize(), localize,
      finish: (value: Value) => complete(value, true), dismiss: () => complete(cancelled, false) });
    if (kind === 'input') current.selectInput();
  });
}

export function chooseModal<Value>(title: PromptText, message: PromptText, actions: readonly Choice<Value>[]): Promise<Value | undefined> {
  return showPrompt('choice', () => ({ title: localized(title), message: localized(message),
    actions: actions.map(item => ({ ...item, label: localized(item.label) })) }), actions.find(item => item.value === false)?.value);
}

export async function inputModal(title: PromptText, label: PromptText, defaultValue = ''): Promise<string> {
  return promptHost().page('input:' + String(title || ''), () => showPrompt('input',
    () => ({ title: localized(title), label: localized(label) }), '', { defaultValue }));
}

export async function confirmModal(message: PromptText, title: PromptText = '', confirmText: PromptText = '', cancelText: PromptText = '', danger = false): Promise<boolean> {
  const current = promptHost();
  return (await current.page('confirm:' + String(title || ''), () => chooseModal<boolean>(title, message, [
    { label: confirmText || current.text('common:auto.confirm', {defaultValue:'确定'}), value: true, className: danger ? 'danger' : 'primary' },
    { label: cancelText || current.text('common:actions.cancel', {defaultValue:'取消'}), value: false }
  ]))) === true;
}

export function installWorkspacePrompts(port: WorkspacePromptHost) {
  host = port;
}
