import { For, Show, createMemo, createSignal } from "solid-js";
import type { CodexServerRequest } from "../../bridge/tauri";
import { Icon } from "../../design";
import { McpElicitationBody } from "./McpElicitationBody";
import { asRecord, fieldString, safeJson } from "./types";

interface ServerRequestCardProps {
  request: CodexServerRequest;
  onRespond: (id: string | number, response: unknown) => Promise<void>;
}

interface InputQuestion {
  id: string;
  header?: string;
  question: string;
  isOther?: boolean;
  isSecret?: boolean;
  options?: Array<{ label: string; description?: string }> | null;
}

export function ServerRequestCard(props: ServerRequestCardProps) {
  const [answers, setAnswers] = createSignal<Record<string, string>>({});
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const params = () => asRecord(props.request.params);
  const questions = createMemo<InputQuestion[]>(() =>
    Array.isArray(params().questions) ? (params().questions as InputQuestion[]) : [],
  );
  const isCommand = () => props.request.method === "item/commandExecution/requestApproval";
  const isFileChange = () => props.request.method === "item/fileChange/requestApproval";
  const isPermissions = () => props.request.method === "item/permissions/requestApproval";
  const isInput = () => props.request.method === "item/tool/requestUserInput";
  const isMcp = () => props.request.method === "mcpServer/elicitation/request";
  const isLegacy = () =>
    props.request.method === "applyPatchApproval" ||
    props.request.method === "execCommandApproval";

  const respond = async (response: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await props.onRespond(props.request.id, response);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const permissionResponse = (scope: "turn" | "session") => {
    const requested = asRecord(params().permissions);
    const granted: Record<string, unknown> = {};
    if (requested.network) granted.network = requested.network;
    if (requested.fileSystem) granted.fileSystem = requested.fileSystem;
    return { permissions: granted, scope };
  };

  const submitAnswers = () => {
    const response: Record<string, { answers: string[] }> = {};
    for (const question of questions()) {
      const answer = answers()[question.id]?.trim();
      if (answer) response[question.id] = { answers: [answer] };
    }
    void respond({ answers: response });
  };

  return (
    <section class="agent-request-card">
      <header>
        <span class="agent-request-icon"><Icon name={isInput() ? "command" : "git"} /></span>
        <div>
          <span class="agent-eyebrow">CODEX NEEDS YOU</span>
          <strong>
            {isCommand()
              ? "Approve command"
              : isFileChange()
                ? "Approve file changes"
                : isPermissions()
                  ? "Grant additional access"
                  : isInput()
                    ? "Choose how to continue"
                    : isMcp()
                      ? `Input requested by ${fieldString(params(), "serverName") ?? "MCP"}`
                      : isLegacy()
                        ? "Approve legacy Codex action"
                    : "Review request"}
          </strong>
        </div>
      </header>

      <Show when={fieldString(params(), "reason")}>
        {(reason) => <p class="agent-request-reason">{reason()}</p>}
      </Show>

      <Show when={isCommand()}>
        <pre class="agent-command-preview">{fieldString(params(), "command") ?? "Command unavailable"}</pre>
        <Show when={fieldString(params(), "cwd")}>
          {(cwd) => <span class="agent-request-path">in {cwd()}</span>}
        </Show>
        <div class="agent-request-actions">
          <button disabled={busy()} class="agent-primary" onClick={() => respond({ decision: "accept" })}>
            Allow once
          </button>
          <button disabled={busy()} class="agent-secondary" onClick={() => respond({ decision: "acceptForSession" })}>
            Allow for session
          </button>
          <button disabled={busy()} class="agent-danger" onClick={() => respond({ decision: "decline" })}>
            Deny
          </button>
        </div>
      </Show>

      <Show when={isFileChange()}>
        <Show when={fieldString(params(), "grantRoot")}>
          {(root) => <pre class="agent-command-preview">Write access: {root()}</pre>}
        </Show>
        <div class="agent-request-actions">
          <button disabled={busy()} class="agent-primary" onClick={() => respond({ decision: "accept" })}>
            Apply changes
          </button>
          <button disabled={busy()} class="agent-secondary" onClick={() => respond({ decision: "acceptForSession" })}>
            Allow for session
          </button>
          <button disabled={busy()} class="agent-danger" onClick={() => respond({ decision: "decline" })}>
            Deny
          </button>
        </div>
      </Show>

      <Show when={isPermissions()}>
        <pre class="agent-command-preview">{safeJson(params().permissions)}</pre>
        <div class="agent-request-actions">
          <button disabled={busy()} class="agent-primary" onClick={() => respond(permissionResponse("turn"))}>
            Allow once
          </button>
          <button disabled={busy()} class="agent-secondary" onClick={() => respond(permissionResponse("session"))}>
            Allow for session
          </button>
          <button
            disabled={busy()}
            class="agent-danger"
            onClick={() => respond({ permissions: {}, scope: "turn" })}
          >
            Deny
          </button>
        </div>
      </Show>

      <Show when={isInput()}>
        <div class="agent-request-questions">
          <For each={questions()}>
            {(question) => (
              <label>
                <span class="agent-request-question-header">{question.header}</span>
                <strong>{question.question}</strong>
                <Show when={question.options?.length}>
                  <div class="agent-request-options">
                    <For each={question.options ?? []}>
                      {(option) => (
                        <button
                          type="button"
                          class={answers()[question.id] === option.label ? "selected" : ""}
                          onClick={() => setAnswers((current) => ({ ...current, [question.id]: option.label }))}
                        >
                          <span>{option.label}</span>
                          <small>{option.description}</small>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={!question.options?.length || question.isOther}>
                  <input
                    type={question.isSecret ? "password" : "text"}
                    value={answers()[question.id] ?? ""}
                    onInput={(event) =>
                      setAnswers((current) => ({ ...current, [question.id]: event.currentTarget.value }))
                    }
                    placeholder="Type your answer…"
                  />
                </Show>
              </label>
            )}
          </For>
        </div>
        <div class="agent-request-actions">
          <button disabled={busy()} class="agent-primary" onClick={submitAnswers}>Continue</button>
          <button disabled={busy()} class="agent-danger" onClick={() => respond({ answers: {} })}>Cancel</button>
        </div>
      </Show>

      <Show when={isMcp()}>
        <McpElicitationBody
          params={params()}
          busy={busy()}
          onRespond={(response) => void respond(response)}
        />
      </Show>

      <Show when={isLegacy()}>
        <pre class="agent-command-preview">
          {Array.isArray(params().command)
            ? (params().command as string[]).join(" ")
            : safeJson(params().fileChanges ?? props.request.params)}
        </pre>
        <div class="agent-request-actions">
          <button disabled={busy()} class="agent-primary" onClick={() => respond({ decision: "approved" })}>
            Allow once
          </button>
          <button disabled={busy()} class="agent-secondary" onClick={() => respond({ decision: "approved_for_session" })}>
            Allow for session
          </button>
          <button disabled={busy()} class="agent-danger" onClick={() => respond({ decision: "denied" })}>
            Deny
          </button>
        </div>
      </Show>

      <Show when={!isCommand() && !isFileChange() && !isPermissions() && !isInput() && !isMcp() && !isLegacy()}>
        <pre class="agent-command-preview">{safeJson(props.request.params)}</pre>
        <button disabled={busy()} class="agent-danger" onClick={() => respond({ decision: "cancel" })}>
          Decline request
        </button>
      </Show>

      <Show when={error()}>{(message) => <div class="agent-inline-error">{message()}</div>}</Show>
    </section>
  );
}
