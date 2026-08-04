import { Show, createSignal } from "solid-js";
import { openExternalUrl } from "../../bridge/tauri";
import { asRecord, fieldString, safeJson } from "./types";

interface McpElicitationBodyProps {
  params: Record<string, unknown>;
  busy: boolean;
  onRespond: (response: unknown) => void;
}

export function McpElicitationBody(props: McpElicitationBodyProps) {
  const [content, setContent] = createSignal("{}");
  const [error, setError] = createSignal<string | null>(null);
  const schema = () => asRecord(props.params.requestedSchema);
  const url = () => fieldString(props.params, "url");

  const accept = () => {
    try {
      const value = JSON.parse(content());
      setError(null);
      props.onRespond({ action: "accept", content: value, _meta: null });
    } catch {
      setError("Enter valid JSON before continuing.");
    }
  };

  return (
    <div class="agent-mcp-elicitation">
      <Show when={fieldString(props.params, "message")}>
        {(message) => <p class="agent-request-reason">{message()}</p>}
      </Show>
      <Show when={url()}>
        {(value) => (
          <button class="agent-secondary" onClick={() => void openExternalUrl(value())}>
            Open secure form
          </button>
        )}
      </Show>
      <Show when={!url()}>
        <details>
          <summary>Requested response schema</summary>
          <pre class="agent-command-preview">{safeJson(schema())}</pre>
        </details>
        <label class="agent-mcp-response">
          <span>Response content (JSON)</span>
          <textarea value={content()} onInput={(event) => setContent(event.currentTarget.value)} />
        </label>
      </Show>
      <Show when={error()}>{(message) => <div class="agent-inline-error">{message()}</div>}</Show>
      <div class="agent-request-actions">
        <button disabled={props.busy} class="agent-primary" onClick={accept}>Continue</button>
        <button
          disabled={props.busy}
          class="agent-danger"
          onClick={() => props.onRespond({ action: "decline", content: null, _meta: null })}
        >
          Decline
        </button>
      </div>
    </div>
  );
}
