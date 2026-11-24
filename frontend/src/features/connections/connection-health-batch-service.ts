export type ConnectionHealthBatchPort = {
  connections: readonly any[] | (() => readonly any[]);
  healthResults: Map<number, any>;
  api: (url: string, options?: Record<string, unknown>) => Promise<any>;
  tr: (key: string, values?: Record<string, unknown>) => string;
  createProgressToast: (options: Record<string, unknown>) => {
    update: (options: Record<string, unknown>) => void;
    finish: (message: string, timeout?: number) => void;
    fail: (message: string) => void;
  };
  setButtonBusy: (button: HTMLElement | null, busy: boolean, label?: string) => void;
  renderConnections: () => void;
  formatAllHealthMessage: (results: readonly any[]) => string;
};

export type ConnectionHealthBatchService = {
  checkAll(button?: HTMLElement | null): Promise<readonly any[] | null>;
};

export function createConnectionHealthBatchService(port: ConnectionHealthBatchPort): ConnectionHealthBatchService {
  let running = false;

  async function checkAll(button: HTMLElement | null = null) {
    if (running) {
      return null;
    }

    const targets = [...(typeof port.connections === 'function' ? port.connections() : port.connections)];
    if (!targets.length) {
      return null;
    }

    running = true;
    let completed = 0;
    let failed = 0;
    let cursor = 0;
    const results: any[] = new Array(targets.length);
    const progress = port.createProgressToast({
      title: port.tr('connections:health.checking_all', {defaultValue: '正在检查全部连接'}),
      detail: port.tr('connections:health.batch_initial', {
        total: targets.length,
        defaultValue: `0 / ${targets.length} · 最多同时检查 4 台`
      }),
      icon: 'activity',
      progress: 0
    });

    const worker = async () => {
      while (cursor < targets.length) {
        const index = cursor++;
        const connection = targets[index];
        let result: any;
        try {
          result = await port.api(`/api/connections/${connection.id}/health`, {method: 'POST'});
        } catch (error: any) {
          result = {
            id: connection.id,
            name: connection.name,
            ssh_user: connection.ssh_user,
            ssh_host: connection.ssh_host,
            ssh_port: connection.ssh_port,
            ok: false,
            status: 'check_failed',
            ssh: {
              ok: false,
              output: error?.message || port.tr('connections:health.request_failed', {defaultValue: '健康检查请求失败'})
            },
            forwards: []
          };
        }

        results[index] = result;
        port.healthResults.set(Number(connection.id), result);
        completed += 1;
        if (!result.ok) failed += 1;
        progress.update({
          progress: completed / targets.length * 100,
          detail: port.tr('connections:health.batch_progress', {
            completed,
            total: targets.length,
            ok: completed - failed,
            failed,
            name: connection.name,
            defaultValue: `${completed} / ${targets.length} · 正常 ${completed - failed} · 异常 ${failed} · 刚完成 ${connection.name}`
          })
        });
        port.renderConnections();
      }
    };

    port.setButtonBusy(button, true, port.tr('connections:health.checking', {defaultValue: '检查中...'}));
    try {
      await Promise.all(Array.from({length: Math.min(4, targets.length)}, () => worker()));
      const message = port.formatAllHealthMessage(results);
      if (failed) progress.fail(message);
      else progress.finish(message, 4500);
      return results;
    } catch (error: any) {
      progress.fail(error?.message || port.tr('connections:health.all_failed', {defaultValue: '全部连接健康检查失败'}));
      return null;
    } finally {
      port.renderConnections();
      running = false;
      port.setButtonBusy(button, false);
    }
  }

  return {checkAll};
}



export interface InstalledFeaturesConnectionsConnectionHealthBatchServiceServices {
  termaConnectionHealthBatch?: ConnectionHealthBatchService;
}
