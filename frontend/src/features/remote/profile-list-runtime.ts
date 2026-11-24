import {remoteServices} from '@/features/remote/installed-services';
import {forwardDialog} from '../forwards/ForwardForms';
import {createRemoteListService,type RemoteListPort} from './profile-list-service';
import {createRemoteProfileMenus,type RemoteProfileMenuPort} from './profile-menu-actions';
import {remoteListHost} from './remote-host';

function createRemoteListRuntime(port: RemoteListPort & RemoteProfileMenuPort) {
  const list = createRemoteListService(port, forwardDialog(port).ask, localStorage);
  return {...list, ...createRemoteProfileMenus(port, list)};
}

export function installRemoteList() {
  let feature: ReturnType<typeof createRemoteListRuntime> | undefined;
  const current = () => feature ||= createRemoteListRuntime(remoteListHost);
  remoteServices.termaRemoteList = {
    generate: (...args) => current().generate(...args),
    favorite: (...args) => current().favorite(...args),
    duplicate: id => current().duplicate(id),
    remove: id => current().remove(id),
    toggleGroup: name => current().toggleGroup(name),
    busy: id => feature?.busy(id) || false,
    fromSsh: id => current().fromSsh(id),
    show: (event, id) => current().show(event, id),
    add: event => current().add(event),
    getSearch: () => current().getSearch(),
    setSearch: value => current().setSearch(value),
    visible: () => current().visible()
  };
}



export interface InstalledFeaturesRemoteProfileListRuntimeServices {
  termaRemoteList: ReturnType<typeof createRemoteListRuntime>;
}
