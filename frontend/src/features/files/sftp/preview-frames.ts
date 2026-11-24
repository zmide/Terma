export function createPreviewFrames(active: () => boolean) {
  const pending = new Set<number>();
  const cancel = (id: number) => { cancelAnimationFrame(id); pending.delete(id); };
  const schedule = (callback: FrameRequestCallback) => {
    const id = requestAnimationFrame(time => {
      pending.delete(id);
      if (active()) callback(time);
    });
    pending.add(id);
    return id;
  };
  const dispose = () => { for (const id of pending) cancelAnimationFrame(id); pending.clear(); };
  return { schedule, cancel, dispose };
}
