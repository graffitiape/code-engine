import { Show } from "solid-js";
import type {
  CodexAccountResponse,
  CodexRateLimitSnapshot,
  CodexRateLimitsResponse,
  CodexServerStatus,
} from "../../bridge/tauri";
import { Icon } from "../../design";

interface AgentRuntimeBarProps {
  server: CodexServerStatus;
  account: CodexAccountResponse;
  limits: CodexRateLimitsResponse | null;
  projectPath: string;
  onRestart: () => void;
  onLogout: () => void;
}

function activeLimit(limits: CodexRateLimitsResponse | null): CodexRateLimitSnapshot | null {
  if (!limits) return null;
  return limits.rateLimitsByLimitId?.codex ?? limits.rateLimits;
}

function accountLabel(account: CodexAccountResponse): string {
  const value = account.account;
  if (!value) return "Not signed in";
  if (value.type === "chatgpt") return value.email ?? `ChatGPT ${value.planType}`;
  if (value.type === "apiKey") return "OpenAI API key";
  return "Amazon Bedrock";
}

export function AgentRuntimeBar(props: AgentRuntimeBarProps) {
  const limit = () => activeLimit(props.limits);
  const used = () => limit()?.primary?.usedPercent;

  return (
    <div class="agent-runtime-bar">
      <div class="agent-runtime-project" title={props.projectPath}>
        <span class="agent-runtime-dot" />
        <span>{props.projectPath}</span>
      </div>
      <div class="agent-runtime-spacer" />
      <Show when={typeof used() === "number"}>
        <div class="agent-limit" title="Current Codex rate-limit window">
          <span>Usage {Math.round(used() ?? 0)}%</span>
          <span class="agent-limit-track">
            <span style={{ width: `${Math.min(100, used() ?? 0)}%` }} />
          </span>
        </div>
      </Show>
      <div class="agent-account" title={accountLabel(props.account)}>
        <span class="agent-account-avatar">{accountLabel(props.account).slice(0, 1).toUpperCase()}</span>
        <span>{accountLabel(props.account)}</span>
      </div>
      <button class="agent-icon-button" onClick={props.onRestart} title="Restart Codex app server">
        <Icon name="chevronDown" />
      </button>
      <button class="agent-text-button" onClick={props.onLogout}>Sign out</button>
      <span class="agent-version">{props.server.version ?? "Codex"}</span>
    </div>
  );
}

