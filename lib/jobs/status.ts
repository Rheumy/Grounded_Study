export type IngestionJobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";

const allowedTransitions: Record<IngestionJobStatus, IngestionJobStatus[]> = {
  QUEUED: ["RUNNING", "FAILED"],
  RUNNING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: []
};

export function canTransition(from: IngestionJobStatus, to: IngestionJobStatus) {
  return allowedTransitions[from].includes(to);
}

export function transition(from: IngestionJobStatus, to: IngestionJobStatus) {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid transition from ${from} to ${to}`);
  }
  return to;
}
