import { h, type VNode } from 'vue';
import { iconDefinition, type IconDefinition } from '../../shared/ui/icon-service';

function renderIcon(definition: IconDefinition): VNode {
  return h(definition.tag, definition.attributes, typeof definition.children === 'string'
    ? definition.children
    : definition.children.map(renderIcon));
}

export function settingsIcon(name: string, label = ''): VNode {
  return renderIcon(iconDefinition(window.lucide, name, label));
}
