export type PlatformMode = 'desktop' | 'browser';
export type PlatformCapability = 'native-window' | 'external-tools' | 'clipboard' | 'filesystem';

export interface PlatformAdapterPort {
  desktop(): boolean;
  nativeWindow(): boolean;
  externalTools(): boolean;
  clipboard(): boolean;
  filesystem(): boolean;
}

export interface PlatformSnapshot {
  mode: PlatformMode;
  capabilities: Record<PlatformCapability, boolean>;
}

export function createPlatformAdapterService(port: PlatformAdapterPort) {
  let disposed = false;
  function snapshot(): PlatformSnapshot {
    if (disposed) return {mode: 'browser', capabilities: {'native-window': false, 'external-tools': false, clipboard: false, filesystem: false}};
    const desktop = port.desktop() === true;
    return {
      mode: desktop ? 'desktop' : 'browser',
      capabilities: {
        'native-window': desktop && port.nativeWindow() === true,
        'external-tools': port.externalTools() === true,
        clipboard: port.clipboard() === true,
        filesystem: desktop && port.filesystem() === true
      }
    };
  }
  function mode() { return snapshot().mode; }
  function can(capability: PlatformCapability) { return snapshot().capabilities[capability] === true; }
  function dispose() { disposed = true; }
  return {snapshot, mode, can, dispose};
}



export interface InstalledFeaturesAssistantPlatformAdapterServiceServices {
  termaAssistantPlatformAdapter?: ReturnType<typeof createPlatformAdapterService>;
}
