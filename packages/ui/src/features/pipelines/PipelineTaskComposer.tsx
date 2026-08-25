import { open } from "@tauri-apps/plugin-dialog";
import { For, Show, createMemo, createSignal } from "solid-js";
import { Icon, Select } from "../../design";
import {
  MAX_PIPELINE_TASK_IMAGES,
  imageAttachment,
  normalizeImageAttachments,
} from "./pipelineTaskPersistence";
import type { PipelineDefinition, PipelineTaskAttachment } from "./types";

interface PipelineTaskComposerProps {
  pipelines: readonly PipelineDefinition[];
  initialPipelineId: string;
  initialTitle?: string;
  initialDescription?: string;
  initialAttachments?: readonly PipelineTaskAttachment[];
  mode?: "create" | "edit";
  projectPath: string;
  onSubmit: (
    title: string,
    description: string,
    pipelineId: string,
    attachments: PipelineTaskAttachment[],
  ) => boolean | void;
  onCancel: () => void;
}

export function PipelineTaskComposer(props: PipelineTaskComposerProps) {
  const [title, setTitle] = createSignal(props.initialTitle ?? "");
  const [description, setDescription] = createSignal(props.initialDescription ?? "");
  const [pipelineId, setPipelineId] = createSignal(props.initialPipelineId);
  const [attachments, setAttachments] = createSignal(
    normalizeImageAttachments(props.initialAttachments ?? []),
  );
  const editing = () => props.mode === "edit";
  const selectedPipeline = createMemo(() =>
    props.pipelines.find((pipeline) => pipeline.id === pipelineId()) ?? props.pipelines[0],
  );
  const pipelineOptions = createMemo(() => props.pipelines.map((pipeline) => {
    const agents = pipeline.nodes.filter((node) => node.type === "agent").length;
    const approvals = pipeline.edges.filter((edge) => edge.mode === "approval").length +
      pipeline.nodes.filter((node) => node.type === "approval").length;
    const integrations = pipeline.nodes.filter((node) => node.type === "integration").length;
    return {
      value: pipeline.id,
      label: pipeline.name,
      description: `${agents} Codex ${agents === 1 ? "agent" : "agents"}${approvals ? ` · ${approvals} approval ${approvals === 1 ? "gate" : "gates"}` : ""}${integrations ? ` · ${integrations} integration${integrations === 1 ? "" : "s"}` : ""}`,
    };
  }));
  const canSubmit = () => Boolean(title().trim() && selectedPipeline());
  const submit = () => {
    if (!canSubmit()) return;
    props.onSubmit(title(), description(), pipelineId(), attachments());
  };
  const pickImages = async () => {
    const selected = await open({
      multiple: true,
      directory: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    const paths = typeof selected === "string" ? [selected] : selected ?? [];
    setAttachments(normalizeImageAttachments([
      ...attachments(),
      ...paths.map(imageAttachment).filter((entry): entry is PipelineTaskAttachment => Boolean(entry)),
    ]));
  };

  return (
    <div class="pipeline-task-composer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) props.onCancel();
    }}>
      <section class="pipeline-task-composer" role="dialog" aria-modal="true" aria-label={editing() ? "Edit pipeline task" : "New pipeline task"}>
        <header>
          <span class="pipeline-task-composer-icon"><Icon name="branch" size={20} /></span>
          <div>
            <span class="pipeline-eyebrow">{editing() ? "EDIT PIPELINE TASK" : "NEW PIPELINE TASK"}</span>
            <h1>{editing() ? "Update this task" : "What should the pipeline work on?"}</h1>
            <p title={props.projectPath}>Changes are scoped to {props.projectPath}</p>
          </div>
        </header>

        <label class="pipeline-task-title-field">
          <span>Task title</span>
          <input
            autofocus
            value={title()}
            onInput={(event) => setTitle(event.currentTarget.value)}
            placeholder="e.g. Add passwordless sign in"
          />
        </label>

        <label class="pipeline-task-description-field">
          <span>Brief (optional)</span>
          <textarea
            value={description()}
            onInput={(event) => setDescription(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canSubmit()) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Add context, constraints, or acceptance criteria when they matter…"
          />
        </label>

        <div class="pipeline-task-attachments-field">
          <div>
            <span>Images</span>
            <small>{attachments().length}/{MAX_PIPELINE_TASK_IMAGES}</small>
          </div>
          <button
            type="button"
            class="pipeline-secondary-button"
            disabled={attachments().length >= MAX_PIPELINE_TASK_IMAGES}
            onClick={() => void pickImages()}
          >
            <Icon name="plus" /> Attach images
          </button>
          <Show when={attachments().length}>
            <ul>
              <For each={attachments()}>{(attachment) => (
                <li title={attachment.path}>
                  <span>{attachment.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${attachment.name}`}
                    onClick={() => setAttachments((current) => current.filter((entry) => entry.id !== attachment.id))}
                  >×</button>
                </li>
              )}</For>
            </ul>
          </Show>
        </div>

        <div class="pipeline-task-template-field">
          <span>Pipeline template</span>
          <Select
            value={pipelineId()}
            options={pipelineOptions()}
            onChange={setPipelineId}
            ariaLabel="Pipeline template"
            placeholder="Choose a pipeline"
          />
        </div>

        <Show when={selectedPipeline()}>
          {(pipeline) => (
            <div class="pipeline-task-template-preview">
              <span class="pipeline-task-template-mark"><Icon name="branch" /></span>
              <span>
                <strong>{pipeline().name}</strong>
                <small>
                  {pipeline().nodes.filter((node) => node.type === "agent").length} Codex stages · {pipeline().edges.filter((edge) => edge.mode === "approval").length + pipeline().nodes.filter((node) => node.type === "approval").length} approvals · {pipeline().nodes.filter((node) => node.type === "integration").length} integrations · reusable on every run
                </small>
              </span>
            </div>
          )}
        </Show>

        <footer>
          <span><kbd>⌘</kbd><kbd>↵</kbd> {editing() ? "save changes" : "add task"}</span>
          <div>
            <button type="button" class="pipeline-secondary-button" onClick={props.onCancel}>Cancel</button>
            <button type="button" class="pipeline-run-button" disabled={!canSubmit()} onClick={submit}>
              {editing() ? "Save changes" : "Add task"} <Icon name="chevronRight" />
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
