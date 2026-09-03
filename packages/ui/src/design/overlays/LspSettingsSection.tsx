import { For, Show } from "solid-js";
import type { AppSettings, LspServerSettings } from "../../bridge/types";
import {
  sameWorkspacePath,
  statusForServer,
  useLspStore,
  type LspServerState,
} from "../../features/lsp";
import { updateSettings } from "../../stores/settings";
import { useWorkspace } from "../../stores/workspace";
import { SettingRow } from "./SettingRow";
import { SettingsToggle } from "./SettingsToggle";
import {
  LSP_SERVER_OPTIONS,
  normalizeLspExecutable,
  updateLspServerSettings,
  type LspServerId,
} from "./lspSettings";

export interface LspSettingsSectionProps {
  settings: AppSettings;
}

export function LspSettingsSection(props: LspSettingsSectionProps) {
  const lspState = useLspStore();
  const workspace = useWorkspace();
  const serverSettings = (id: LspServerId): LspServerSettings => (
    props.settings.lsp_servers.find((server) => server.id === id) ?? {
      id,
      enabled: true,
      executable: null,
    }
  );

  const updateServer = (
    id: LspServerId,
    patch: Partial<Pick<LspServerSettings, "enabled" | "executable">>,
  ) => {
    updateSettings({
      lsp_servers: updateLspServerSettings(props.settings.lsp_servers, id, patch),
    });
  };

  const runtimeStatus = (id: LspServerId) => {
    void lspState.statuses;
    const root = workspace.activeRoot();
    const status = statusForServer(id);
    return root && status && sameWorkspacePath(root, status.root) ? status : null;
  };

  const statusLabel = (state: LspServerState) => {
    if (state === "ready") return "Ready";
    if (state === "missing") return "Not found";
    return state[0].toUpperCase() + state.slice(1);
  };

  return (
    <>
      <div class="set-group">
        <h3>Language intelligence</h3>
        <SettingRow
          label="Language Server Protocol"
          description="Enable completion, diagnostics, hover information, and navigation from local language servers."
        >
          <SettingsToggle
            label="Language Server Protocol"
            on={props.settings.lsp_enabled}
            onToggle={() => updateSettings({ lsp_enabled: !props.settings.lsp_enabled })}
          />
        </SettingRow>
        <div class="settings-note">
          LSP is off by default. It launches installed local tools with your user permissions,
          so enable it only for projects you trust.
        </div>
      </div>

      <div class="set-group">
        <h3>Language servers</h3>
        <For each={LSP_SERVER_OPTIONS}>
          {(server) => {
            const configured = () => serverSettings(server.id);

            return (
              <SettingRow label={server.label} description={server.description}>
                <div class="settings-lsp-control">
                  <SettingsToggle
                    label={`Enable ${server.label} language server`}
                    on={configured().enabled}
                    onToggle={() => updateServer(server.id, { enabled: !configured().enabled })}
                  />
                  <Show when={runtimeStatus(server.id)}>
                    {(status) => (
                      <span
                        class={`settings-lsp-status ${status().state}`}
                        title={status().error ?? status().executable ?? undefined}
                      >
                        {statusLabel(status().state)}
                      </span>
                    )}
                  </Show>
                  <input
                    class="settings-input settings-lsp-input"
                    value={configured().executable ?? ""}
                    placeholder="Auto-detect"
                    aria-label={`${server.label} language server executable`}
                    onChange={(event) => updateServer(server.id, {
                      executable: normalizeLspExecutable(event.currentTarget.value),
                    })}
                  />
                </div>
              </SettingRow>
            );
          }}
        </For>
        <div class="settings-note">
          Leave an executable blank to auto-detect the installed language server.
          Server toggles take effect when Language Server Protocol is enabled.
        </div>
      </div>
    </>
  );
}
