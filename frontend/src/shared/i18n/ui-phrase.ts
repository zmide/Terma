import {translatedTermaPhrase} from './workspace-bootstrap';
export {normalizeTermaLanguage} from './workspace-bootstrap';
export function localizedTermaUiPhrase(value:unknown){const source=String(value??'');return source?translatedTermaPhrase(source)||source:source;}
