import { For, Show, createMemo, createSignal } from "solid-js";
import type { CodexServerRequest } from "../../bridge/tauri";
import { Icon, Select } from "../../design";
import { PipelineTaskComposer } from "./PipelineTaskComposer";
import { PipelineTaskRunMonitor } from "./PipelineTaskRunMonitor";
import type {
  PipelineApprovalDecision,
  PipelineDefinition,
  PipelineRun,
  PipelineTask,
} from "./types";

interface PipelineTaskBoardProps {
  tasks: readonly PipelineTask[];
  pipelines: readonly PipelineDefinition[];
  selectedTaskId: string | null;
  selectedPipelineId: string | null;
  projectPath: string;
  run: PipelineRun | null;
  requests: readonly CodexServerRequest[];
  codexReady: boolean;
  active: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  onCreate: (title: string, description: string, pipelineId: string) => void;
  onPipeline: (taskId: string, pipelineId: string) => void;
  onDelete: (taskId: string) => void;
  onRun: (taskId: string) => void;
  onStop: () => void;
  onRespond: (id: string | number, response: unknown) => Promise<void>;
  onApproval: (
    kind: "node" | "edge",
    id: string,
    decision: PipelineApprovalDecision,
  ) => void;
  onOpenAgents: () => void;
  onOpenTemplate: (pipelineId: string) => void;
  onClearError: () => void;
}

function taskStatus(task: PipelineTask, run: PipelineRun | null): string {
  return run?.taskId === task.id ? run.status : task.lastRunStatus ?? "ready";
}

function taskStatusLabel(status: string): string {
  if (status === "needsAttention") return "Needs attention";
  if (status === "cancelling") return "Stopping";
  if (status === "validating") return "Validating";
  if (status === "queued") return "Queued";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatRunTime(value: number | null): string {
  if (!value) return "Never run";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export function PipelineTaskBoard(props: PipelineTaskBoardProps) {
  const [composerOpen, setComposerOpen] = createSignal(false);
  const selectedTask = createMemo(() =>
    props.tasks.find((task) => task.id === props.selectedTaskId) ?? null,
  );
  const selectedPipeline = createMemo(() =>
    props.pipelines.find((pipeline) => pipeline.id === selectedTask()?.pipelineId) ?? null,
  );
  const visibleRun = () => props.run?.taskId === selectedTask()?.id ? props.run : null;
  const canStart = () => props.codexReady || !selectedPipeline()?.nodes.some(
    (node) => node.type === "agent",
  );
  const pipelineOptions = createMemo(() => props.pipelines.map((pipeline) => ({
    value: pipeline.id,
    label: pipeline.name,
    description: `${pipeline.nodes.filter((node) => node.type === "agent").length} agents · ${pipeline.edges.filter((edge) => edge.mode === "approval").length + pipeline.nodes.filter((node) => node.type === "approval").length} approvals · ${pipeline.nodes.filter((node) => node.type === "integration").length} integrations`,
  })));

  return (
    <main class="pipeline-tasks-root">
      <aside class="pipeline-task-rail">
        <header>
          <div><span class="pipeline-eyebrow">WORK QUEUE</span><strong>Tasks</strong></div>
          <button type="button" class="pipeline-icon-button" disabled={props.active} onClick={() => setComposerOpen(true)} aria-label="Add task">
            <Icon name="plus" />
          </button>
        </header>
        <div class="pipeline-task-list">
          <For each={props.tasks}>
            {(task) => {
              const pipeline = () => props.pipelines.find((entry) => entry.id === task.pipelineId);
              const status = () => taskStatus(task, props.run);
              return (
                <button
                  type="button"
                  class={`pipeline-task-item ${props.selectedTaskId === task.id ? "active" : ""}`}
                  aria-current={props.selectedTaskId === task.id ? "page" : undefined}
                  disabled={props.active && props.run?.taskId !== task.id}
                  onClick={() => props.onSelect(task.id)}
                >
                  <span class={`pipeline-task-status status-${status()}`} aria-hidden="true" />
                  <span class="pipeline-task-copy">
                    <strong>{task.title}</strong>
                    <small>{pipeline()?.name ?? "Missing template"}</small>
                  </span>
                  <span class="pipeline-task-run-count">{task.runCount ? `×${task.runCount}` : "NEW"}</span>
                </button>
              );
            }}
          </For>
          <Show when={!props.tasks.length}>
            <button type="button" class="pipeline-task-empty-card" onClick={() => setComposerOpen(true)}>
              <Icon name="plus" />
              <strong>Add your first task</strong>
              <small>Choose a reusable pipeline, then run it whenever you need.</small>
            </button>
          </Show>
        </div>
        <footer>
          <span>{props.tasks.length} {props.tasks.length === 1 ? "task" : "tasks"}</span>
          <span>{props.tasks.filter((task) => task.lastRunStatus === "completed").length} completed</span>
        </footer>
      </aside>

      <Show
        when={selectedTask() && selectedPipeline()}
        fallback={
          <section class="pipeline-task-welcome">
            <span class="pipeline-empty-mark"><Icon name="branch" size={26} /></span>
            <span class="pipeline-eyebrow">REUSABLE AUTOMATION</span>
            <h1>Turn work into repeatable runs</h1>
            <p>Add tasks, assign a pipeline template to each one, and trigger or retrigger them from a single queue.</p>
            <button type="button" class="pipeline-run-button" disabled={props.active} onClick={() => setComposerOpen(true)}>
              <Icon name="plus" /> Add task
            </button>
          </section>
        }
      >
        <section class="pipeline-task-detail">
          <header class="pipeline-task-detail-head">
            <div>
              <span class="pipeline-eyebrow">TASK</span>
              <h1>{selectedTask()!.title}</h1>
              <span class={`pipeline-run-status status-${taskStatus(selectedTask()!, props.run)}`}>
                <span /> {taskStatusLabel(taskStatus(selectedTask()!, props.run))}
              </span>
            </div>
            <div>
              <Show
                when={props.active && visibleRun()}
                fallback={
                  <Show
                    when={canStart()}
                    fallback={<button type="button" class="pipeline-secondary-button" onClick={props.onOpenAgents}>Connect Codex</button>}
                  >
                    <button type="button" class="pipeline-run-button" disabled={props.active} onClick={() => props.onRun(selectedTask()!.id)}>
                      <Icon name="play" /> {selectedTask()!.runCount ? "Run again" : "Run task"}
                    </button>
                  </Show>
                }
              >
                <button type="button" class="pipeline-stop-button" onClick={props.onStop}>■ Stop run</button>
              </Show>
              <button type="button" class="pipeline-task-delete" disabled={props.active} onClick={() => props.onDelete(selectedTask()!.id)}>
                Delete
              </button>
            </div>
          </header>

          <div class="pipeline-task-overview">
            <section class="pipeline-task-brief">
              <span class="pipeline-eyebrow">BRIEF</span>
              <p>{selectedTask()!.description}</p>
            </section>
            <aside class="pipeline-task-config">
              <div>
                <span>Pipeline template</span>
                <Select
                  value={selectedTask()!.pipelineId}
                  options={pipelineOptions()}
                  onChange={(pipelineId) => props.onPipeline(selectedTask()!.id, pipelineId)}
                  ariaLabel={`Pipeline for ${selectedTask()!.title}`}
                  disabled={props.active}
                />
              </div>
              <button type="button" onClick={() => props.onOpenTemplate(selectedTask()!.pipelineId)}>
                Edit template <Icon name="chevronRight" />
              </button>
              <dl>
                <div><dt>Runs</dt><dd>{selectedTask()!.runCount}</dd></div>
                <div><dt>Last run</dt><dd>{formatRunTime(selectedTask()!.lastRunAt)}</dd></div>
              </dl>
            </aside>
          </div>

          <PipelineTaskRunMonitor
            pipeline={selectedPipeline()!}
            run={visibleRun()}
            requests={visibleRun() ? props.requests : []}
            error={props.error}
            onRespond={props.onRespond}
            onApproval={props.onApproval}
            onClearError={props.onClearError}
          />
        </section>
      </Show>

      <Show when={composerOpen()}>
        <PipelineTaskComposer
          pipelines={props.pipelines}
          initialPipelineId={props.selectedPipelineId ?? props.pipelines[0]?.id ?? ""}
          projectPath={props.projectPath}
          onCreate={(title, description, pipelineId) => {
            props.onCreate(title, description, pipelineId);
            setComposerOpen(false);
          }}
          onCancel={() => setComposerOpen(false)}
        />
      </Show>
    </main>
  );
}
