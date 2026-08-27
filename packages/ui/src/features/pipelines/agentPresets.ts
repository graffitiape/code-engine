import type { PipelinePermission } from "./types";

export type PipelineAgentPresetId =
  | "research"
  | "implement"
  | "review"
  | "fix-review"
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

const LEGACY_RESEARCH_INSTRUCTIONS =
  "Inspect the project and task. Identify relevant files, existing patterns, constraints, risks, and a concrete recommended approach. Do not modify files. Return a focused handoff for downstream steps.";
const LEGACY_IMPLEMENT_INSTRUCTIONS =
  "Implement the task completely in the active project. Use upstream research and plans as context, preserve existing work, follow project conventions, and run focused verification for the changes you make.";
const LEGACY_REVIEW_INSTRUCTIONS =
  "Review the implementation against the original task and upstream handoffs. Inspect the diff for correctness, regressions, security issues, missing tests, and unmet acceptance criteria. Do not modify files. Return actionable findings or a clear approval.";
const LEGACY_VERIFY_INSTRUCTIONS =
  "Verify the completed work with the most relevant tests, type checks, linters, and build commands. Diagnose failures and make only focused fixes needed for this task. Report exactly what ran and the final result.";
const LEGACY_CUSTOM_INSTRUCTIONS =
  "Complete this stage using the original task and upstream handoffs. Return a clear, self-contained result for downstream steps.";
const PRE_GLOBAL_RESEARCH_INSTRUCTIONS =
  "Research only the project context needed for the original task. Identify relevant files, existing patterns, constraints, risks, and a concrete recommended approach. Do not modify files, implement the task, review a completed diff, or run tests, type checks, linters, builds, or other verification. Return a focused implementation handoff and stop.";
const PRE_GLOBAL_IMPLEMENT_INSTRUCTIONS =
  "Implement only the requested change in the active project. Use upstream Research as context, inspect only the files needed to edit, preserve existing work, follow project conventions, and make the necessary source and test-file edits. Do not run tests, type checks, linters, builds, git diff --check, or any other verification. Do not perform a separate code review or commit and push. Stop when the implementation edits are complete and report only the files changed and any blockers.";
const PRE_GLOBAL_REVIEW_INSTRUCTIONS =
  "Review only the completed implementation against the original task and upstream handoffs. Inspect the diff for correctness, regressions, security issues, missing tests, and unmet acceptance criteria. Do not modify files, implement fixes, or run tests, type checks, linters, builds, or other verification. Return actionable findings with file references, or a clear approval, and stop.";
const PRE_GLOBAL_FIX_REVIEW_INSTRUCTIONS =
  "Address only the actionable findings in the upstream Review handoff. Make the smallest necessary source or test-file edits, preserve unrelated work, and do not revisit approved areas or add unrelated refactors. Do not repeat the review, run tests, type checks, linters, builds, git diff --check, or other verification, and do not commit or push. Report which findings were addressed and which could not be resolved, then stop.";
const PRE_GLOBAL_VERIFY_INSTRUCTIONS =
  "Verify only the completed work with the most relevant tests, type checks, linters, and build commands. Do not modify source files, tests, configuration, or documentation; do not fix failures; and do not repeat implementation or code review. Diagnose failures and report the exact commands and results for a downstream fix or human, then stop.";
const PRE_GLOBAL_CUSTOM_INSTRUCTIONS =
  "Perform only the responsibility explicitly configured for this custom stage, using the original task and upstream handoffs as context. Do not assume Research, Implement, Review, Fix Review Comments, Verify, or Git responsibilities assigned to other stages. Return only this stage's result and blockers.";

export const PIPELINE_AGENT_PRESETS: readonly PipelineAgentPreset[] = [
  {
    id: "research",
    label: "Research",
    description: "Inspect the project, constraints, and relevant code without editing",
    name: "Research",
    instructions: "Research only the project context needed for the assigned task. Identify relevant files, existing patterns, constraints, risks, and a concrete recommended approach. Do not modify files, implement the task, review a completed diff, or run tests, type checks, linters, builds, or other verification. Return a focused implementation handoff and stop.",
    permission: "read-only",
    color: "cyan",
    icon: "search",
  },
  {
    id: "implement",
    label: "Implement",
    description: "Make the requested code changes without reviewing or verifying",
    name: "Implement",
    instructions: "Implement only the requested change in the active project. Inspect only the files needed to edit, preserve existing work, follow project conventions, and make the necessary source and test-file edits. Do not run tests, type checks, linters, builds, git diff --check, or any other verification. Do not perform a separate code review or commit and push. Stop when the implementation edits are complete and report only the files changed and any blockers.",
    permission: "workspace-write",
    color: "purple",
    icon: "command",
  },
  {
    id: "review",
    label: "Review",
    description: "Check correctness, regressions, security, and acceptance criteria",
    name: "Review",
    instructions: "Review only the completed implementation against the assigned task and acceptance criteria. Inspect the diff for correctness, regressions, security issues, missing tests, and unmet requirements. Do not modify files, implement fixes, or run tests, type checks, linters, builds, or other verification. Return actionable findings with file references, or a clear approval, and stop.",
    permission: "read-only",
    color: "green",
    icon: "file",
  },
  {
    id: "fix-review",
    label: "Fix review comments",
    description: "Apply only the findings reported by the Review stage",
    name: "Fix Review Comments",
    instructions: "Address only the actionable findings provided to this stage. Make the smallest necessary source or test-file edits, preserve unrelated work, and do not revisit approved areas or add unrelated refactors. Do not repeat the review, run tests, type checks, linters, builds, git diff --check, or other verification, and do not commit or push. Report which findings were addressed and which could not be resolved, then stop.",
    permission: "workspace-write",
    color: "yellow",
    icon: "command",
  },
  {
    id: "verify",
    label: "Verify",
    description: "Run relevant tests and checks without changing the implementation",
    name: "Verify",
    instructions: "Verify only the completed work with the most relevant tests, type checks, linters, and build commands. Do not modify source files, tests, configuration, or documentation; do not fix failures; and do not repeat implementation or code review. Diagnose failures and report the exact commands and results for a downstream fix or human, then stop.",
    permission: "workspace-write",
    color: "blue",
    icon: "diagWarn",
  },
  {
    id: "custom",
    label: "Custom agent",
    description: "Start with a blank general-purpose Codex step",
    name: "Custom agent",
    instructions: "Perform only the responsibility explicitly configured for this custom stage. Return this stage's result and any blockers in a concise handoff.",
    permission: "read-only",
    color: "purple",
    icon: "plus",
  },
];

export function pipelineAgentPreset(id: PipelineAgentPresetId): PipelineAgentPreset {
  return PIPELINE_AGENT_PRESETS.find((preset) => preset.id === id) ?? PIPELINE_AGENT_PRESETS.at(-1)!;
}

/**
 * Upgrade untouched built-in instructions while leaving user-authored prompts
 * alone. Renamed legacy custom steps are migrated only when their role is
 * unambiguous.
 */
export function migratePipelineAgentPreset(
  name: string,
  instructions: string,
  permission: PipelinePermission,
): Pick<PipelineAgentPreset, "instructions" | "permission"> {
  const legacyPreset = new Map<string, PipelineAgentPresetId>([
    [LEGACY_RESEARCH_INSTRUCTIONS, "research"],
    [LEGACY_IMPLEMENT_INSTRUCTIONS, "implement"],
    [LEGACY_REVIEW_INSTRUCTIONS, "review"],
    [LEGACY_VERIFY_INSTRUCTIONS, "verify"],
    [PRE_GLOBAL_RESEARCH_INSTRUCTIONS, "research"],
    [PRE_GLOBAL_IMPLEMENT_INSTRUCTIONS, "implement"],
    [PRE_GLOBAL_REVIEW_INSTRUCTIONS, "review"],
    [PRE_GLOBAL_FIX_REVIEW_INSTRUCTIONS, "fix-review"],
    [PRE_GLOBAL_VERIFY_INSTRUCTIONS, "verify"],
    [PRE_GLOBAL_CUSTOM_INSTRUCTIONS, "custom"],
  ]).get(instructions);
  if (legacyPreset) {
    return {
      instructions: pipelineAgentPreset(legacyPreset).instructions,
      permission,
    };
  }

  if (instructions !== LEGACY_CUSTOM_INSTRUCTIONS) {
    return { instructions, permission };
  }
  const normalizedName = name.trim().toLocaleLowerCase();
  if (normalizedName === "fix review comments") {
    const preset = pipelineAgentPreset("fix-review");
    return { instructions: preset.instructions, permission: preset.permission };
  }
  if (normalizedName === "custom agent") {
    return {
      instructions: pipelineAgentPreset("custom").instructions,
      permission,
    };
  }
  return { instructions, permission };
}
