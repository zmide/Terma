import {filesServices} from '@/features/files/installed-services';
import { installI18nRuntime } from '../../../shared/i18n/runtime';
interface LocalizedAceEditor{renderer?:{updateFull?(force:boolean):void;enableKeyboardAccessibility?:boolean;scroller?:HTMLElement;$gutter?:HTMLElement};textInput?:{setAriaOptions?(options:{setLabel:boolean}):void};searchBox?:{updateCounter?():void}}
type LocalizedHost=HTMLElement&{__termaAceEditor?:LocalizedAceEditor};
interface LocalizationPort{tr(key:string):string;ace():{config?:{setMessages?(messages:Record<string,string>,options:{placeholders:string}):void}}|null}
export function createAceLocalization(port:LocalizationPort){const tr=port.tr;
function termaAceMessages() {
  const messageKeys = {
    "autocomplete.popup.aria-roledescription":"autocomplete_suggestions",
    "autocomplete.popup.aria-label":"autocomplete_suggestions",
    "autocomplete.popup.item.aria-roledescription":"item",
    "autocomplete.loading":"loading",
    "editor.scroller.aria-roledescription":"editor_role",
    "editor.scroller.aria-label":"editor_content",
    "editor.gutter.aria-roledescription":"gutter_role",
    "editor.gutter.aria-label":"gutter",
    "error-marker.good-state":"looks_good",
    "prompt.recently-used":"recently_used",
    "prompt.other-commands":"other_commands",
    "prompt.no-matching-commands":"no_matching_commands",
    "search-box.find.placeholder":"find_placeholder",
    "search-box.find-all.text":"find_all",
    "search-box.replace.placeholder":"replace_placeholder",
    "search-box.replace-next.text":"replace",
    "search-box.replace-all.text":"replace_all",
    "search-box.toggle-replace.title":"toggle_replace",
    "search-box.toggle-regexp.title":"regexp_search",
    "search-box.toggle-case.title":"case_sensitive",
    "search-box.toggle-whole-word.title":"whole_word",
    "search-box.toggle-in-selection.title":"in_selection",
    "search-box.search-counter":"search_counter",
    "text-input.aria-roledescription":"text_input_role",
    "text-input.aria-label":"cursor_row",
    "gutter.code-folding.range.aria-label":"fold_range",
    "gutter.code-folding.closed.aria-label":"fold_range",
    "gutter.code-folding.open.aria-label":"fold_row",
    "gutter.code-folding.closed.title":"unfold",
    "gutter.code-folding.open.title":"fold",
    "gutter.annotation.aria-label.error":"annotation_error",
    "gutter.annotation.aria-label.warning":"annotation_warning",
    "gutter.annotation.aria-label.info":"annotation_info",
    "inline-fold.closed.title":"unfold",
    "gutter-tooltip.aria-label.error.singular":"error_singular",
    "gutter-tooltip.aria-label.error.plural":"error_plural",
    "gutter-tooltip.aria-label.warning.singular":"warning_singular",
    "gutter-tooltip.aria-label.warning.plural":"warning_plural",
    "gutter-tooltip.aria-label.info.singular":"info_singular",
    "gutter-tooltip.aria-label.info.plural":"info_plural",
    "gutter.annotation.aria-label.security":"annotation_security",
    "gutter.annotation.aria-label.hint":"annotation_hint",
    "gutter-tooltip.aria-label.security.singular":"security_singular",
    "gutter-tooltip.aria-label.security.plural":"security_plural",
    "gutter-tooltip.aria-label.hint.singular":"hint_singular",
    "gutter-tooltip.aria-label.hint.plural":"hint_plural",
    "editor.tooltip.disable-editing":"editing_disabled"
  };
  return Object.fromEntries(Object.entries(messageKeys).map(([aceKey, resourceKey]) => [aceKey, tr(`sftp:ace.${resourceKey}`)]));
}

function syncTermaAceEditorChrome(editor:LocalizedAceEditor|undefined, messages:Record<string,string>) {
  if (!editor) return;
  const renderer = editor.renderer;
  renderer?.updateFull?.(true);
  if (renderer?.enableKeyboardAccessibility) {
    renderer.scroller?.setAttribute("aria-roledescription", messages["editor.scroller.aria-roledescription"]);
    renderer.scroller?.setAttribute("aria-label", messages["editor.scroller.aria-label"]);
    renderer.$gutter?.setAttribute("aria-roledescription", messages["editor.gutter.aria-roledescription"]);
    renderer.$gutter?.setAttribute("aria-label", messages["editor.gutter.aria-label"]);
    editor.textInput?.setAriaOptions?.({setLabel:true});
  }
  editor.searchBox?.updateCounter?.();
}

function syncTermaAceLocalization(root:Document|Element=document) {
  const messages = termaAceMessages();
  port.ace()?.config?.setMessages?.(messages, {placeholders:"dollarSigns"});
  const scope = root;
  scope.querySelectorAll(".ace_search").forEach(search => {
    const findInput = search.querySelector<HTMLInputElement>(".ace_search_form .ace_search_field");
    const replaceInput = search.querySelector<HTMLInputElement>(".ace_replace_form .ace_search_field");
    if (findInput) findInput.placeholder = messages["search-box.find.placeholder"];
    if (replaceInput) replaceInput.placeholder = messages["search-box.replace.placeholder"];
    const values: [string,string,'textContent'|'title'][] = [
      ["[action='findAll']", "search-box.find-all.text", "textContent"],
      ["[action='replaceAndFindNext']", "search-box.replace-next.text", "textContent"],
      ["[action='replaceAll']", "search-box.replace-all.text", "textContent"],
      ["[action='toggleReplace']", "search-box.toggle-replace.title", "title"],
      ["[action='toggleRegexpMode']", "search-box.toggle-regexp.title", "title"],
      ["[action='toggleCaseSensitive']", "search-box.toggle-case.title", "title"],
      ["[action='toggleWholeWords']", "search-box.toggle-whole-word.title", "title"],
      ["[action='searchInSelection']", "search-box.toggle-in-selection.title", "title"]
    ];
    values.forEach(([selector, key, property]) => {
      const element = search.querySelector<HTMLElement>(selector);
      if (element) element[property] = messages[key];
    });
  });
  const hosts:LocalizedHost[] = [];
  if (scope instanceof HTMLElement && scope.matches(".sftp-code-editor")) hosts.push(scope);
  hosts.push(...scope.querySelectorAll<LocalizedHost>(".sftp-code-editor"));
  hosts.forEach(host => syncTermaAceEditorChrome(host.__termaAceEditor, messages));
}


return {messages:termaAceMessages,chrome:syncTermaAceEditorChrome,sync:syncTermaAceLocalization};}
let installed = false;
export function installAceLocalization(){
  if (installed) return;
  installed = true;
  const i18n = installI18nRuntime();
  const host = window as unknown as {ace?:ReturnType<LocalizationPort['ace']>};
  const owner = createAceLocalization({tr:key=>i18n?.translate(key)||key,ace:()=>host.ace||null});
  filesServices.termaAceLocalization={create:createAceLocalization,...owner};
  i18n?.registerRenderer(()=>owner.sync());
}


export interface InstalledFeaturesFilesSftpEditorAceLocalizationServices {
  termaAceLocalization:{create:typeof createAceLocalization}&ReturnType<typeof createAceLocalization>
}
