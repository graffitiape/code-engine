import {
  codexThreadNameSet,
  codexThreadRead,
  codexThreadStart,
  codexTurnInterrupt,
  codexTurnStart,
  type CodexThreadItem,
  type CodexTurn,
} from "../../bridge/tauri";
import { notifyWorkspaceFilesChanged } from "../../stores/workspace";
import {
  subscribeCodexEvents,
  subscribeCodexStatus,
  useAgentState,
} from "../agents/agentStore";
import { asRecord, fieldString, localImageInput, permissionForThread, permissionForTurn, textInput } from "../agents/types";
import { extractFinalAgentOutput } from "./prompt";
import type { PipelineAgentNode, PipelineTaskAttachment } from "./types";

const TURN_TIMEOUT_MS = 30 * 60 * 1_000;
const INTERRUPT_RECONCILE_ATTEMPTS = 60;
const INTERRUPT_RECONCILE_DELAY_MS = 250;

export class PipelineTurnCleanupError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PipelineTurnCleanupError";
  }
}

export interface PipelineAgentExecution {
  cwd: string;
  pipelineName: string;
  node: PipelineAgentNode;
  prompt: string;
  globalInstructions?: string;
  attachments: readonly PipelineTaskAttachment[];
  fallbackModel: string;
  fallbackEffort: string;
  signal: AbortSignal;
  onThreadStarted: (threadId: string) => void;
  onTurnStarted: (threadId: string, turnId: string) => void;
  onDelta: (text: string) => void;
}

export interface PipelineAgentResult {
  threadId: string;
  turnId: string;
  items: CodexThreadItem[];
  output: string;
}

function abortError(): DOMException {
  return new DOMException("Pipeline run stopped", "AbortError");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function turnFailure(turn: CodexTurn): Error {
  const detail = turn.error ? `: ${messageOf(turn.error)}` : "";
  return new Error(`Codex turn ${turn.status}${detail}`);
}

export function isTerminalTurnStatus(
  status: unknown,
): status is Exclude<CodexTurn["status"], "inProgress"> {
  return status === "completed" || status === "failed" || status === "interrupted";
}

function completedTurn(turn: CodexTurn | null | undefined): turn is CodexTurn {
  return Boolean(turn && isTerminalTurnStatus((turn as { status?: unknown }).status));
}

export async function executePipelineAgent(
  request: PipelineAgentExecution,
): Promise<PipelineAgentResult> {
  if (request.signal.aborted) throw abortError();
  const agentState = useAgentState();
  const initialGeneration = agentState.server?.generation;
  const model = request.node.model || request.fallbackModel;
  const effort = request.node.effort || request.fallbackEffort;
  if (!model) throw new Error(`No Codex model selected for ${request.node.name}`);

  let threadId: string | null = null;
  let turnId: string | null = null;
  let interruptPromise: Promise<void> | null = null;
  let cancellationRequested = false;
  let terminalTurnObserved = false;
  let turnStartRequested = false;
  const completionState: { cachedTurn: CodexTurn | null; runtimeError: Error | null } = {
    cachedTurn: null,
    runtimeError: null,
  };
  let settleCompletion!: (turn: CodexTurn | null) => void;
  const completion = new Promise<CodexTurn | null>((resolve) => {
    settleCompletion = resolve;
  });

  const stopActiveTurn = () => {
    cancellationRequested = true;
    if (threadId && turnId && !interruptPromise) {
      interruptPromise = codexTurnInterrupt(threadId, turnId);
    }
    settleCompletion(null);
  };
  request.signal.addEventListener("abort", stopActiveTurn, { once: true });

  const unsubscribeEvents = subscribeCodexEvents((event) => {
    if (initialGeneration !== undefined && event.generation !== initialGeneration) return;
    const params = asRecord(event.params);
    if (!threadId || fieldString(params, "threadId") !== threadId) return;
    if (event.method === "item/agentMessage/delta") {
      request.onDelta(fieldString(params, "delta") ?? "");
      return;
    }
    if (event.method === "turn/started") {
      const startedTurn = params.turn as CodexTurn | undefined;
      if (startedTurn?.id && !turnId) {
        turnId = startedTurn.id;
        request.onTurnStarted(threadId, turnId);
        if (request.signal.aborted) stopActiveTurn();
      }
      return;
    }
    if (event.method === "error") {
      const error = asRecord(params.error);
      completionState.runtimeError = new Error(fieldString(error, "message") ?? "Codex turn failed");
      return;
    }
    if (event.method !== "turn/completed") return;
    const eventTurn = params.turn as CodexTurn | undefined;
    if (!eventTurn?.id) return;
    completionState.cachedTurn = eventTurn;
    if (!turnId || eventTurn.id === turnId) {
      if (completedTurn(eventTurn)) {
        terminalTurnObserved = true;
        settleCompletion(eventTurn);
      } else {
        completionState.runtimeError = new Error("Codex reported an invalid terminal turn status");
        stopActiveTurn();
      }
    }
  });
  const unsubscribeStatus = subscribeCodexStatus((status) => {
    if (
      threadId &&
      (!status.running || (initialGeneration !== undefined && status.generation !== initialGeneration))
    ) {
      completionState.runtimeError = new Error("Codex restarted while the pipeline was running");
      terminalTurnObserved = true;
      settleCompletion(null);
    }
  });

  const timeout = window.setTimeout(() => {
    completionState.runtimeError = new Error(`Codex timed out while running ${request.node.name}`);
    stopActiveTurn();
  }, TURN_TIMEOUT_MS);

  try {
    const permission = permissionForThread(request.node.permission);
    const developerInstructions = [
      request.globalInstructions?.trim()
        ? `Global pipeline instructions:\n${request.globalInstructions.trim()}`
        : "",
      request.node.instructions.trim()
        ? `Current stage instructions:\n${request.node.instructions.trim()}`
        : "",
    ].filter(Boolean).join("\n\n");
    const threadResponse = await codexThreadStart({
      cwd: request.cwd,
      model,
      ...permission,
      developerInstructions: developerInstructions || undefined,
      sessionStartSource: "startup",
    });
    threadId = threadResponse.thread.id;
    request.onThreadStarted(threadId);
    const title = `[Pipeline] ${request.pipelineName} / ${request.node.name}`.slice(0, 120);
    void codexThreadNameSet(threadId, title).catch(() => undefined);
    if (request.signal.aborted) throw abortError();

    turnStartRequested = true;
    const turnResponse = await codexTurnStart({
      threadId,
      input: [textInput(request.prompt), ...request.attachments.map((attachment) => localImageInput(attachment.path))],
      cwd: request.cwd,
      model,
      effort: effort || null,
      clientUserMessageId: globalThis.crypto?.randomUUID?.(),
      ...permissionForTurn(request.node.permission, request.cwd),
    });
    if (typeof turnResponse.turn?.id !== "string" || !turnResponse.turn.id) {
      throw new Error(`Codex did not identify the turn started for ${request.node.name}`);
    }
    if (!turnId) {
      turnId = turnResponse.turn.id;
      request.onTurnStarted(threadId, turnId);
    } else if (turnId !== turnResponse.turn.id) {
      throw new Error(`Codex started an unexpected turn for ${request.node.name}`);
    }
    if (request.signal.aborted) {
      stopActiveTurn();
      throw abortError();
    }

    let finalTurn = completedTurn(turnResponse.turn) ? turnResponse.turn : null;
    if (
      !finalTurn &&
      completionState.cachedTurn?.id === turnId &&
      completedTurn(completionState.cachedTurn)
    ) {
      finalTurn = completionState.cachedTurn;
    }
    if (!finalTurn) finalTurn = await completion;
    if (finalTurn) terminalTurnObserved = true;
    if (request.signal.aborted) throw abortError();
    if (!finalTurn) {
      throw completionState.runtimeError ?? new Error(`${request.node.name} stopped unexpectedly`);
    }
    if (finalTurn.id !== turnId) throw new Error(`Codex completed an unexpected turn for ${request.node.name}`);
    if (finalTurn.status !== "completed") throw turnFailure(finalTurn);

    let resolvedTurn = finalTurn;
    let output = extractFinalAgentOutput(resolvedTurn.items);
    if (!output?.trim()) {
      const read = await codexThreadRead(threadId, true);
      const hydrated = read.thread.turns.find((turn) => turn.id === turnId);
      if (hydrated?.status === "completed") {
        resolvedTurn = hydrated;
        output = extractFinalAgentOutput(resolvedTurn.items);
      }
    }
    if (!output?.trim()) throw new Error(`${request.node.name} completed without a final response`);
    if (request.node.permission !== "read-only") notifyWorkspaceFilesChanged(request.cwd);
    return { threadId, turnId, items: resolvedTurn.items, output };
  } finally {
    let cleanupFailure: PipelineTurnCleanupError | null = null;
    if (threadId && turnStartRequested && !turnId && !terminalTurnObserved) {
      cleanupFailure = new PipelineTurnCleanupError(
        `Could not safely stop ${request.node.name}: Codex did not confirm which turn was started`,
      );
    }
    if (threadId && turnId && !terminalTurnObserved) {
      stopActiveTurn();
    }
    if (!cleanupFailure && cancellationRequested && threadId && turnId) {
      try {
        let interruptError: unknown = null;
        try {
          await interruptPromise;
        } catch (error) {
          interruptError = error;
        }
        let terminal = completionState.cachedTurn?.id === turnId &&
          completedTurn(completionState.cachedTurn)
          ? completionState.cachedTurn
          : null;
        for (let attempt = 0; !terminal && attempt < INTERRUPT_RECONCILE_ATTEMPTS; attempt += 1) {
          const read = await codexThreadRead(threadId, true);
          const candidate = read.thread.turns.find((turn) => turn.id === turnId);
          if (completedTurn(candidate)) {
            terminal = candidate;
            break;
          }
          await new Promise((resolve) => window.setTimeout(resolve, INTERRUPT_RECONCILE_DELAY_MS));
        }
        if (!terminal) {
          throw interruptError ?? new Error("Codex did not report a terminal turn after interruption");
        }
      } catch (error) {
        cleanupFailure = new PipelineTurnCleanupError(
          `Could not safely stop ${request.node.name}: ${messageOf(error)}`,
          { cause: error },
        );
      }
    }
    window.clearTimeout(timeout);
    request.signal.removeEventListener("abort", stopActiveTurn);
    unsubscribeEvents();
    unsubscribeStatus();
    if (cleanupFailure) throw cleanupFailure;
  }
}
