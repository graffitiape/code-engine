export type PipelineRunTone =
  | "idle"
  | "ready"
  | "active"
  | "attention"
  | "success"
  | "failed"
  | "cancelled";

export function pipelineRunTone(status: string | undefined): PipelineRunTone {
  switch (status) {
    case "needsAttention":
      return "attention";
    case "validating":
    case "queued":
      return "active";
    case "cancelling":
      return "cancelled";
    case "ready":
      return "ready";
    case "starting":
    case "running":
      return "active";
    case "waitingForApproval":
      return "attention";
    case "completed":
      return "success";
    case "failed":
      return "failed";
    case "cancelled":
    case "skipped":
      return "cancelled";
    default:
      return "idle";
  }
}

export function pipelineRunLabel(status: string | undefined): string {
  switch (status) {
    case "needsAttention":
      return "Needs attention";
    case "validating":
      return "Validating";
    case "queued":
      return "Queued";
    case "cancelling":
      return "Stopping";
    case "waitingForApproval":
      return "Needs approval";
    case "starting":
      return "Starting";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "skipped":
      return "Skipped";
    case "ready":
      return "Ready";
    case "pending":
      return "Pending";
    default:
      return "Idle";
  }
}
