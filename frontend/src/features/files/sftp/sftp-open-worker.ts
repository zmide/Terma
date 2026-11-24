import { decodeRemoteText } from './text-codec';
// Stable codes cross the worker boundary; localized UI text stays in the view process.
self.addEventListener('message', (event: MessageEvent<unknown>) => self.postMessage(decodeRemoteText(event.data)));
