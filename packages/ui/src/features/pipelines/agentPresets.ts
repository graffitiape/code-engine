import type { PipelinePermission } from "./types";

export type PipelineAgentPresetId =
  | "research"
  | "implement"
  | "review"
  | "verify"
  | "custom";

export interface PipelineAgentPreset {
  id: PipelineAgentPresetId;
  label: string;
  description: string;
  name: string;
  instructions: string;
  permission: PipelinePermission;
  color: string;
  icon: string;
}

export const PIPELINE_AGENT_PRESETS: readonly PipelineAgentPreset[] = [
  {
    id: "research",
    label: "Research",
    description: "Inspect the project, constraints, and relevant code without editing",
    name: "Research",
    instructions: "Inspect the project and task. Identify relevant files, existing patterns, constraints, risks, and a concrete recommended approach. Do not modify files. Return a focused handoff for downstream steps.",
    permission: "read-only",
    color: "cyan",
    icon: "search",
  },
  {
    id: "implement",
    label: "Implement",
    description: "Build the requested change and verify the implementation",
    name: "Implement",
    instructions: "Implement the task completely in the active project. Use upstream research and plans as context, preserve existing work, follow project conventions, and run focused verification for the changes you make.",
    permission: "workspace-write",
    color: "purple",
    icon: "command",
  },
  {
    id: "review",
    label: "Review",
    description: "Check correctness, regressions, security, and acceptance criteria",
    name: "Review",
    instructions: "Review the implementation against the original task and upstream handoffs. Inspect the diff for correctness, regressions, security issues, missing tests, and unmet acceptance criteria. Do not modify files. Return actionable findings or a clear approval.",
    permission: "read-only",
    color: "green",
    icon: "file",
  },
  {
    id: "verify",
    label: "Verify",
    description: "Run relevant tests and checks, then resolve focused failures",
    name: "Verify",
    instructions: "Verify the completed work with the most relevant tests, type checks, linters, and build commands. Diagnose failures and make only focused fixes needed for this task. Report exactly what ran and the final result.",
    permission: "workspace-write",
    color: "blue",
    icon: "diagWarn",
  },
  {
    id: "custom",
    label: "Custom agent",
    description: "Start with a blank general-purpose Codex step",
    name: "Custom agent",
    instructions: "Complete this stage using the original task and upstream handoffs. Return a clear, self-contained result for downstream steps.",
    permission: "read-only",
    color: "purple",
    icon: "plus",
  },
];

export function pipelineAgentPreset(id: PipelineAgentPresetId): PipelineAgentPreset {
  return PIPELINE_AGENT_PRESETS.find((preset) => preset.id === id) ?? PIPELINE_AGENT_PRESETS.at(-1)!;
}
