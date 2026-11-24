export type SshHostTrustMode = 'once' | 'persist' | null;

export interface SshHostTrustChallenge {
  state?: string;
  host_label?: string;
  key_type?: string;
  fingerprint?: string;
  previous_fingerprint?: string;
}

interface SshHostTrustDialogValues {
  challenge: SshHostTrustChallenge;
  finish(value: unknown): void;
  dismiss(): void;
  initialFocus: string;
}

interface SshHostTrustDialogPort {
  mount(values: SshHostTrustDialogValues): void;
  close(): void;
}

function normalizeChallenge(value: SshHostTrustChallenge | null | undefined): SshHostTrustChallenge {
  const challenge = value && typeof value === 'object' ? value : {};
  return {
    state: challenge.state === 'changed' ? 'changed' : 'unknown',
    host_label: String(challenge.host_label || ''),
    key_type: String(challenge.key_type || ''),
    fingerprint: String(challenge.fingerprint || ''),
    previous_fingerprint: String(challenge.previous_fingerprint || '')
  };
}

export function createSshHostTrustDialogService(port: SshHostTrustDialogPort) {
  function open(input: SshHostTrustChallenge | null | undefined): Promise<SshHostTrustMode> {
    const challenge = normalizeChallenge(input);
    return new Promise<SshHostTrustMode>(resolve => {
      let settled = false;
      const dismiss = () => {
        if (settled) return;
        settled = true;
        resolve(null);
      };
      const finish = (value: unknown) => {
        if (settled) return;
        settled = true;
        const mode: SshHostTrustMode = value === 'once' || value === 'persist' ? value : null;
        port.close();
        resolve(mode);
      };
      port.mount({
        challenge,
        finish,
        dismiss,
        initialFocus: '#sshHostTrustCancel'
      });
    });
  }

  return { open };
}

