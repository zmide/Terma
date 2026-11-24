import { createDirectoryRefreshQueue, type DirectoryRefreshPort } from './directory-refresh';
import { createSftpTaskCompletion, type CompletionJob } from './sftp-task-completion';
import { createSftpTaskLifecycle, type SftpPollPort } from './sftp-task-poller';

interface TransferLifecyclePort {
  directories: DirectoryRefreshPort;
  polling: Omit<SftpPollPort, 'now' | 'setTimer' | 'clearTimer'>;
  jobs(): CompletionJob[];
  localDelivery(job: CompletionJob): void;
  changed(): void;
}

export function createSftpTransferLifecycle(port: TransferLifecyclePort) {
  const directories = createDirectoryRefreshQueue(port.directories);
  const completion = createSftpTaskCompletion({
    jobs: port.jobs,
    queueDirectory: directories.enqueue,
    flushDirectories: directories.flush,
    localDelivery: port.localDelivery,
    changed: port.changed
  });
  const polling = createSftpTaskLifecycle({
    ...port.polling,
    now: Date.now,
    setTimer: (callback, delay) => setTimeout(callback, delay),
    clearTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>)
  });
  return { directories, completion, polling };
}



export interface InstalledFeaturesFilesSftpTransferLifecycleServices {
  termaSftpTransferLifecycle: ReturnType<typeof createSftpTransferLifecycle>;
}
