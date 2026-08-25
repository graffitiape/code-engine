import { Show, createEffect, createSignal } from "solid-js";
import {
  gitCheckRemoteAccess,
  gitPublishBranch,
  gitRepositoryInfo,
  gitSetIdentity,
  openExternalUrl,
  type GitIdentityScope,
  type GitRemoteInfo,
  type GitRepositoryInfo,
} from "../../bridge/tauri";
import { Icon } from "../Icon";

export interface GitSetupDialogProps {
  workspaceRoot: string;
  onClose: () => void;
  onSaved?: (info: GitRepositoryInfo) => void;
}

const messageFor = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function gitProviderLabel(provider: GitRemoteInfo["provider"]): string {
  return {
    github: "GitHub",
    "azure-devops": "Azure DevOps",
    gitlab: "GitLab",
    bitbucket: "Bitbucket",
    generic: "Git remote",
  }[provider];
}

export function gitConnectionActionLabel(remote: GitRemoteInfo): string {
  if (remote.transport === "ssh") return "Check SSH access";
  if (remote.transport === "local") return "Check local remote";
  return `Sign in / check ${gitProviderLabel(remote.provider)}`;
}

function scopeFrom(info: GitRepositoryInfo): GitIdentityScope {
  return info.identity.scope === "global" ? "global" : "project";
}

export function GitSetupDialog(props: GitSetupDialogProps) {
  const [info, setInfo] = createSignal<GitRepositoryInfo | null>(null);
  const [name, setName] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [scope, setScope] = createSignal<GitIdentityScope>("project");
  const [operation, setOperation] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  let generation = 0;

  async function load() {
    const root = props.workspaceRoot;
    const currentGeneration = ++generation;
    setOperation("Loading Git setup");
    setError(null);
    try {
      const snapshot = await gitRepositoryInfo(root);
      if (currentGeneration !== generation || props.workspaceRoot !== root) return;
      setInfo(snapshot);
      setName(snapshot.identity.name ?? "");
      setEmail(snapshot.identity.email ?? "");
      setScope(scopeFrom(snapshot));
    } catch (loadError) {
      if (currentGeneration === generation) setError(messageFor(loadError));
    } finally {
      if (currentGeneration === generation) setOperation(null);
    }
  }

  async function saveIdentity(event: SubmitEvent) {
    event.preventDefault();
    if (operation()) return;
    setOperation("Saving identity");
    setError(null);
    setNotice(null);
    try {
      const snapshot = await gitSetIdentity(
        props.workspaceRoot,
        name(),
        email(),
        scope(),
      );
      setInfo(snapshot);
      setNotice(scope() === "project"
        ? "Git identity saved for this project."
        : "Global Git identity saved for your account.");
      props.onSaved?.(snapshot);
    } catch (saveError) {
      setError(messageFor(saveError));
    } finally {
      setOperation(null);
    }
  }

  async function checkAccess() {
    if (operation()) return;
    setOperation("Checking remote access");
    setError(null);
    setNotice(null);
    try {
      const provider = await gitCheckRemoteAccess(props.workspaceRoot);
      setNotice(`${provider} access is ready. Credentials remain in your Git helper or SSH agent.`);
    } catch (accessError) {
      setError(messageFor(accessError));
    } finally {
      setOperation(null);
    }
  }

  async function publishBranch() {
    if (operation()) return;
    setOperation("Publishing branch");
    setError(null);
    setNotice(null);
    try {
      const branch = await gitPublishBranch(props.workspaceRoot);
      const snapshot = await gitRepositoryInfo(props.workspaceRoot);
      setInfo(snapshot);
      setNotice(`Published ${branch} and configured its upstream.`);
    } catch (publishError) {
      setError(messageFor(publishError));
    } finally {
      setOperation(null);
    }
  }

  createEffect(() => {
    void props.workspaceRoot;
    void load();
  });

  return (
    <div
      class="git-setup-backdrop"
      role="presentation"
      onClick={props.onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") props.onClose();
      }}
    >
      <section
        class="git-setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Git setup"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="git-setup-header">
          <span class="git-setup-icon"><Icon name="git" size={19} /></span>
          <div>
            <span>Repository settings</span>
            <h2>Git setup</h2>
            <p>Code Engine uses your existing Git credentials and never stores provider passwords or tokens.</p>
          </div>
          <button type="button" class="icon-btn" onClick={props.onClose} aria-label="Close Git setup">
            <Icon name="close" />
          </button>
        </header>

        <Show when={error() || notice()}>
          <div class={`git-setup-message ${error() ? "error" : "success"}`} role={error() ? "alert" : "status"}>
            {error() ?? notice()}
          </div>
        </Show>

        <div class="git-setup-content">
          <form class="git-identity-form" onSubmit={saveIdentity}>
            <div class="git-setup-section-heading">
              <div>
                <span>Commit identity</span>
                <strong>{info()?.identity.configured ? "Ready to commit" : "Required before committing"}</strong>
              </div>
              <span class={`git-setup-state ${info()?.identity.configured ? "ready" : "attention"}`}>
                {info()?.identity.configured ? "Configured" : "Missing"}
              </span>
            </div>

            <label>
              <span>Name</span>
              <input
                value={name()}
                onInput={(event) => setName(event.currentTarget.value)}
                placeholder="Your commit author name"
                autocomplete="name"
              />
            </label>
            <label>
              <span>Email</span>
              <input
                type="email"
                value={email()}
                onInput={(event) => setEmail(event.currentTarget.value)}
                placeholder="you@example.com"
                autocomplete="email"
              />
            </label>

            <fieldset class="git-identity-scope">
              <legend>Save identity</legend>
              <label class={scope() === "project" ? "selected" : ""}>
                <input
                  type="radio"
                  name="git-identity-scope"
                  checked={scope() === "project"}
                  onChange={() => setScope("project")}
                />
                <span><strong>This project</strong><small>Recommended when projects use different accounts</small></span>
              </label>
              <label class={scope() === "global" ? "selected" : ""}>
                <input
                  type="radio"
                  name="git-identity-scope"
                  checked={scope() === "global"}
                  onChange={() => setScope("global")}
                />
                <span><strong>All projects</strong><small>Updates your global Git configuration</small></span>
              </label>
            </fieldset>

            <button
              type="submit"
              class="git-setup-primary"
              disabled={!name().trim() || !email().trim() || Boolean(operation())}
            >
              {operation() === "Saving identity" ? "Saving…" : "Save Git identity"}
            </button>
          </form>

          <section class="git-remote-setup">
            <div class="git-setup-section-heading">
              <div>
                <span>Remote access</span>
                <strong>{info()?.remote ? gitProviderLabel(info()!.remote!.provider) : "No remote configured"}</strong>
              </div>
              <Show when={info()?.remote}>
                {(remote) => <span class="git-setup-state ready">{remote().transport.toUpperCase()}</span>}
              </Show>
            </div>

            <Show
              when={info()?.remote}
              fallback={
                <div class="git-setup-empty">
                  <Icon name="diagWarn" size={17} />
                  <p>Add a Git remote before publishing or checking provider access.</p>
                </div>
              }
            >
              {(remote) => (
                <>
                  <dl class="git-remote-details">
                    <div><dt>Remote</dt><dd>{remote().name}</dd></div>
                    <div><dt>Address</dt><dd title={remote().displayUrl}>{remote().displayUrl}</dd></div>
                    <div><dt>Credentials</dt><dd>{info()!.credentialHelper}</dd></div>
                    <div><dt>Upstream</dt><dd>{info()!.upstream ?? "Not published"}</dd></div>
                  </dl>

                  <div class="git-remote-actions">
                    <button
                      type="button"
                      class="git-setup-secondary"
                      disabled={Boolean(operation()) || remote().transport === "local"}
                      onClick={() => void checkAccess()}
                    >
                      {operation() === "Checking remote access" ? "Checking…" : gitConnectionActionLabel(remote())}
                    </button>
                    <Show when={!info()!.upstream}>
                      <button
                        type="button"
                        class="git-setup-primary"
                        disabled={Boolean(operation())}
                        onClick={() => void publishBranch()}
                      >
                        {operation() === "Publishing branch" ? "Publishing…" : "Publish current branch"}
                      </button>
                    </Show>
                    <Show when={remote().webUrl}>
                      {(url) => (
                        <button
                          type="button"
                          class="git-setup-link"
                          onClick={() => void openExternalUrl(url()).catch((openError) => setError(messageFor(openError)))}
                        >
                          Open on {gitProviderLabel(remote().provider)} <Icon name="chevronRight" />
                        </button>
                      )}
                    </Show>
                  </div>

                  <p class="git-credential-note">
                    HTTPS sign-in is handled by your configured Git credential helper and system keychain. SSH remotes continue to use your SSH agent and keys.
                  </p>
                </>
              )}
            </Show>
          </section>
        </div>

        <footer>
          <span>{operation() ?? "Credentials stay outside Code Engine"}</span>
          <button type="button" class="git-setup-secondary" onClick={props.onClose}>Done</button>
        </footer>
      </section>
    </div>
  );
}
