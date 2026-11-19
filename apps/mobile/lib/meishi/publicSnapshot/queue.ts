let pending: Promise<void> = Promise.resolve();

export function enqueueSnapshotOperation(
  task: () => Promise<void>,
): Promise<void> {
  const run = pending.then(task);
  pending = run.catch(() => undefined);
  return run;
}
