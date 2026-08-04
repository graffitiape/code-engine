import { Show } from "solid-js";
import { Icon } from "../../design";
import { openExternalUrl } from "../../bridge/tauri";
import {
  cancelAgentLogin,
  loginWithChatgpt,
  restartCodex,
  type useAgentState,
} from "./agentStore";

type AgentState = ReturnType<typeof useAgentState>;

interface AgentOnboardingProps {
  state: AgentState;
  hasProject: boolean;
  onOpenEditor: () => void;
}

export function AgentOnboarding(props: AgentOnboardingProps) {
  const loginUrl = () => props.state.login?.authUrl ?? props.state.login?.verificationUrl;

  return (
    <main class="agent-onboarding">
      <div class="agent-onboarding-card">
        <div class="agent-onboarding-mark">
          <Icon name="command" />
        </div>

        <Show when={!props.hasProject}>
          <h1>Open a project first</h1>
          <p>Codex tasks are always bound to a project folder so file access stays explicit.</p>
          <button class="agent-primary" onClick={props.onOpenEditor}>
            Open Editor
          </button>
        </Show>

        <Show when={props.hasProject && props.state.booting}>
          <span class="agent-spinner" />
          <h1>Starting Codex</h1>
          <p>Connecting to the local app server and restoring your project threads…</p>
        </Show>

        <Show when={props.hasProject && !props.state.booting && props.state.server?.state === "missing"}>
          <h1>Codex CLI is required</h1>
          <p>
            Install the Codex CLI, then restart this connection. Code Engine reuses its ChatGPT
            sign-in and never stores your subscription credentials.
          </p>
          <code class="agent-install-command">npm install -g @openai/codex</code>
          <button class="agent-primary" onClick={restartCodex}>Check again</button>
        </Show>

        <Show when={props.hasProject && !props.state.booting && props.state.server?.state === "failed"}>
          <h1>Codex could not start</h1>
          <p>{props.state.server?.lastError ?? "The local app server exited unexpectedly."}</p>
          <button class="agent-primary" onClick={restartCodex}>Restart Codex</button>
        </Show>

        <Show when={props.hasProject && !props.state.booting && props.state.server?.state === "stopping"}>
          <span class="agent-spinner" />
          <h1>Restarting Codex</h1>
          <p>Waiting for the previous app-server process to stop…</p>
        </Show>

        <Show
          when={
            props.hasProject &&
            !props.state.booting &&
            props.state.server?.ready &&
            !props.state.account?.account
          }
        >
          <Show
            when={props.state.login}
            fallback={
              <>
                <h1>Connect your OpenAI account</h1>
                <p>
                  Sign in with ChatGPT to use the Codex models included with your subscription.
                </p>
                <div class="agent-onboarding-actions">
                  <button
                    class="agent-primary"
                    disabled={props.state.submitting}
                    onClick={() => loginWithChatgpt(false)}
                  >
                    Continue with ChatGPT
                  </button>
                  <button
                    class="agent-secondary"
                    disabled={props.state.submitting}
                    onClick={() => loginWithChatgpt(true)}
                  >
                    Use device code
                  </button>
                </div>
              </>
            }
          >
            <h1>Finish signing in</h1>
            <Show when={props.state.login?.userCode}>
              <p>Enter this one-time code after opening the sign-in page:</p>
              <button
                class="agent-device-code"
                title="Copy device code"
                onClick={() => navigator.clipboard.writeText(props.state.login?.userCode ?? "")}
              >
                {props.state.login?.userCode}
              </button>
            </Show>
            <p>The account status updates here automatically when sign-in completes.</p>
            <div class="agent-onboarding-actions">
              <Show when={loginUrl()}>
                {(url) => (
                  <button class="agent-primary" onClick={() => openExternalUrl(url())}>
                    Open sign-in page
                  </button>
                )}
              </Show>
              <button class="agent-secondary" onClick={cancelAgentLogin}>Cancel</button>
            </div>
          </Show>
        </Show>

        <Show when={props.state.error}>
          <div class="agent-inline-error">{props.state.error}</div>
        </Show>
      </div>
    </main>
  );
}

