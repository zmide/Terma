import {sharedServices} from '@/shared/installed-services';
import {efficiencyServices} from '@/features/efficiency/installed-services';
export interface ActionPalette {
  register(action: unknown): unknown;
  list(context?: Record<string, unknown>): unknown;
  action(id: string): unknown;
  runAction(id: string, context?: Record<string, unknown>): unknown;
}

export interface ActionRegistry extends ActionPalette {}

export function createActionRegistry(palette: ActionPalette): ActionRegistry {
  return {
    register: action => palette.register(action),
    list: context => palette.list(context),
    action: id => palette.action(String(id || '')),
    runAction: (id, context = {}) => palette.runAction(String(id || ''), context)
  };
}

export function installActionRegistry(): ActionRegistry | undefined {
  if (sharedServices.termaActionRegistry) return sharedServices.termaActionRegistry;
  const palette = efficiencyServices.termaEfficiency?.palette;
  if (!palette) return undefined;
  const registry = createActionRegistry(palette);
  sharedServices.termaActionRegistry = registry;
  window.dispatchEvent(new CustomEvent('terma-action-registry-ready'));
  return registry;
}





export interface InstalledSharedActionsActionRegistryServices {
  termaActionRegistry?: ActionRegistry;
}
