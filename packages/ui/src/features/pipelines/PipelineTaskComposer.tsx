import { Show, createMemo, createSignal } from "solid-js";
import { Icon, Select } from "../../design";
import type { PipelineDefinition } from "./types";

interface PipelineTaskComposerProps {
  pipelines: readonly PipelineDefinition[];
  initialPipelineId: string;
  projectPath: string;
  onCreate: (title: string, description: string, pipelineId: string) => void;
  onCancel: () => void;
}

export function PipelineTaskComposer(props: PipelineTaskComposerProps) {
  const [title, setTitle] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [pipelineId, setPipelineId] = createSignal(props.initialPipelineId);
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
  const canCreate = () => Boolean(title().trim() && description().trim() && selectedPipeline());
  const create = () => {
    if (!canCreate()) return;
    props.onCreate(title(), description(), pipelineId());
  };

  return (
    <div class="pipeline-task-composer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) props.onCancel();
    }}>
      <section class="pipeline-task-composer" role="dialog" aria-modal="true" aria-label="New pipeline task">
        <header>
          <span class="pipeline-task-composer-icon"><Icon name="branch" size={20} /></span>
          <div>
            <span class="pipeline-eyebrow">NEW PIPELINE TASK</span>
            <h1>What should the pipeline work on?</h1>
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
          <span>Brief</span>
          <textarea
            value={description()}
            onInput={(event) => setDescription(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canCreate()) {
                event.preventDefault();
                create();
              }
            }}
            placeholder="Describe the feature, bug, refactor, or investigation. Include acceptance criteria when they matter…"
          />
        </label>

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
          <span><kbd>⌘</kbd><kbd>↵</kbd> add task</span>
          <div>
            <button type="button" class="pipeline-secondary-button" onClick={props.onCancel}>Cancel</button>
            <button type="button" class="pipeline-run-button" disabled={!canCreate()} onClick={create}>
              Add task <Icon name="chevronRight" />
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
