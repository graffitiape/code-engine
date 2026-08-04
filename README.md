# Code Engine

Code Engine is a local desktop code editor with a first-class Codex task surface. It combines a fast CodeMirror editor, project-scoped search and Git workflows, and OpenAI Codex threads authenticated through your existing ChatGPT subscription.

## What is ready

- Switch between validated project folders from the shared title bar.
- Open, edit, save, restore, rename, and safely remove project files without leaving the active workspace boundary.
- Restore editor tabs per project and protect unsaved or externally changed buffers.
- Fuzzy-open files, search and replace across the project, inspect Git diffs, stage changes, commit, stash, and switch clean local branches.
- Sign in with ChatGPT from **Agents**, choose a live Codex model and reasoning effort, stream turns, steer or interrupt work, and answer approvals or questions.
- Choose a per-turn permission preset: read-only, workspace write, or full access.
- Design project-specific, n8n-style **Pipelines** that connect multiple Codex agents into a validated acyclic workflow, then run the workflow with live stage status, approvals, retries, and a final handoff.

## Requirements

- Node.js 20 or newer
- pnpm 9 or newer (the repository pins pnpm 9.15.9)
- Current stable Rust toolchain
- [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/)
- A recent Codex CLI with `codex app-server` support for the Agents tab

Install Codex if needed:

```sh
npm install -g @openai/codex
codex app-server --help
```

Code Engine asks Codex to manage the ChatGPT login flow. It does not store your ChatGPT access token or API key.

## Run locally

```sh
pnpm install --frozen-lockfile
pnpm tauri dev
```

For browser-only UI work, use `pnpm dev`. Native file dialogs, filesystem access, Git, and Codex require the Tauri app.

## Use the app

1. Open a folder from the project selector in the title bar.
2. Use **Editor** for files, project search, source control, and settings.
3. Open **Agents**, choose **Continue with ChatGPT**, and finish the hosted sign-in if Codex is not already authenticated.
4. Select a model, reasoning effort, and permission preset before starting a task.
5. Open **Pipelines** to arrange agents on the canvas, connect their ports, configure each stage, enter a development task, and run the complete workflow.

Workspace mode disables network access and limits writes to the selected project. Read-only mode disables writes. Full access removes the sandbox and approval prompts; use it only for tasks you trust.

Pipeline designs are saved locally per project. Read-only agents in the same stage can run concurrently; write-capable agents run exclusively so they do not edit the project at the same time. Switching projects or closing the app prompts you to stop an active pipeline safely.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘/Ctrl+P` | Find a project file |
| `⌘/Ctrl+Shift+P` | Command palette |
| `⌘/Ctrl+Shift+F` | Search project |
| `⌘/Ctrl+O` | Open or switch project |
| `⌘/Ctrl+T` | New untitled file |
| `⌘/Ctrl+W` | Close active tab |
| `⌘/Ctrl+B` | Toggle Explorer |
| `⌘/Ctrl+,` | Settings |

## Verification and packaging

Run the complete repository gate:

```sh
pnpm check
cargo fmt --all -- --check
```

Build platform installers and bundles with:

```sh
pnpm tauri build
```

On Apple Silicon, the macOS artifacts are written to:

- `target/release/bundle/macos/Code Engine.app`
- `target/release/bundle/dmg/Code Engine_1.0.0_aarch64.dmg`

Local builds receive a hardened ad-hoc signature and are suitable for personal use. Distribution to other macOS users additionally requires a Developer ID signature and Apple notarization; Windows distribution similarly requires a code-signing certificate.

## Troubleshooting Agents

- **Codex CLI is required:** confirm `codex --version` and `codex app-server --help` work in a terminal, then restart Codex from the Agents screen.
- **CLI installed outside PATH:** set the absolute Codex binary path under **Settings → Agents**, then restart the Agents runtime.
- **Login does not complete:** try **Use device code**, or run `codex login status` to inspect the CLI-owned account state.
- **No models appear:** update the Codex CLI and restart its runtime. Models and supported reasoning efforts are read dynamically from the app server.

## Architecture

- `packages/ui`: SolidJS, CodeMirror, and the Tauri bridge
- `crates/ce-tauri`: native commands and the Codex app-server supervisor
- `crates/ce-fs`: bounded project search, atomic writes, and recoverable file operations
- `crates/ce-git`: repository status, diffs, staging, commits, logs, branches, and stash
- `crates/ce-core`: validated, cross-platform application settings

## License

MIT — see [LICENSE](LICENSE).
