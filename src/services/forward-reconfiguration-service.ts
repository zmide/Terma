interface ForwardReconfigurationDependencies {
  getForward(id: number): any;
  updateForward(id: number, data: any): void;
  reconfigureForwardRuntime(id: number, applyConfiguration: () => void, restoreConfiguration: () => void): Promise<any>;
}

export function createForwardReconfigurationService(dependencies: ForwardReconfigurationDependencies) {
  async function reconfigureForward(id: number, data: any) {
    const forwardId = Number(id);
    const before = dependencies.getForward(forwardId);
    return dependencies.reconfigureForwardRuntime(
      forwardId,
      () => dependencies.updateForward(forwardId, data),
      () => dependencies.updateForward(forwardId, before)
    );
  }

  return {reconfigureForward};
}
