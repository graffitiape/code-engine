// Pipeline stage — three agent stations connected by animated wires.

import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import type { JSX } from 'solid-js';
import type {
  AgentKey,
  StationLogLine,
  StationStat,
  StationState,
  Ticket,
  WireState,
} from '../types';
import { I, STAGES, STAGE_DURATIONS } from './data';

export interface PipelineStageProps {
  ticket: Ticket;
  onOpenChat: (a: AgentKey) => void;
  openChatFor: AgentKey | null;
}

export function PipelineStage(props: PipelineStageProps) {
  const [stageIdx, setStageIdx] = createSignal(0);
  const [elapsed, setElapsed] = createSignal(0);
  let factoryRef: HTMLDivElement | undefined;
  const nodeRefs: (HTMLElement | undefined)[] = [];

  // Reset when ticket changes.
  createEffect(() => {
    props.ticket.id; // touch reactivity
    setStageIdx(0);
    setElapsed(0);
  });

  // Advance stages.
  createEffect(() => {
    const id = props.ticket.id;
    const state = props.ticket.state;
    const idx = stageIdx();
    if (state !== 'running') return;
    if (idx >= STAGES.length) return;
    void id;
    const t = setTimeout(() => setStageIdx((s) => s + 1), STAGE_DURATIONS[idx] * 1000);
    onCleanup(() => clearTimeout(t));
  });

  // Elapsed tick.
  createEffect(() => {
    const id = props.ticket.id;
    const state = props.ticket.state;
    if (state !== 'running') return;
    void id;
    const i = setInterval(() => setElapsed((e) => e + 1), 1000);
    onCleanup(() => clearInterval(i));
  });

  const stateFor = (i: number): StationState => {
    if (props.ticket.state === 'done') return 'done';
    if (props.ticket.state === 'queued') return 'pending';
    if (i < stageIdx()) return 'done';
    if (i === stageIdx()) return 'running';
    return 'pending';
  };

  const activeWire = (i: number): WireState => {
    if (props.ticket.state === 'done') return 'done';
    if (i < stageIdx()) return 'done';
    if (i === stageIdx() - 1 && stageIdx() < STAGES.length) return 'done';
    if (i === stageIdx() && props.ticket.state === 'running') return 'active';
    return 'idle';
  };

  const mm = () => Math.floor(elapsed() / 60).toString().padStart(2, '0');
  const ss = () => (elapsed() % 60).toString().padStart(2, '0');

  const wireStates = (): WireState[] => [
    props.ticket.state === 'queued' ? 'idle' : 'done', // ticket -> research
    activeWire(0),                                      // research -> coder
    activeWire(1),                                      // coder -> reviewer
    props.ticket.state === 'done' ? 'done' : 'idle',    // reviewer -> merge
  ];

  return (
    <div class="stage">
      <div class="stage-top">
        <div class="stage-ticket">
          <span class="st-tid">{props.ticket.id}</span>
          <span class="st-title">{props.ticket.title}</span>
        </div>
        <div class="stage-stats">
          <Show when={props.ticket.state === 'running'}>
            <span class="stat-pill live">
              <span class="d" /> live · {mm()}:{ss()}
            </span>
          </Show>
          <Show when={props.ticket.state === 'done'}>
            <span class="stat-pill okay">
              <I name="check" s={11} /> completed · 4m 38s
            </span>
          </Show>
          <Show when={props.ticket.state === 'queued'}>
            <span class="stat-pill idle">queued</span>
          </Show>
          <button class="stage-btn">
            <I name="refresh" s={12} /> Re-run
          </button>
        </div>
      </div>

      <div class="factory" ref={factoryRef}>
        <FactoryBg />
        <PipelineWires
          containerRef={() => factoryRef}
          nodeRefs={nodeRefs}
          wireStates={wireStates()}
        />

        {/* Source (ticket input) */}
        <div class="node-source" ref={(el) => (nodeRefs[0] = el)}>
          <div class="ns-label">TICKET</div>
          <div class="ns-id">{props.ticket.id}</div>
          <div class="ns-pulse" />
        </div>

        {/* Station: Research */}
        <Station
          innerRef={(el) => (nodeRefs[1] = el)}
          agent="research"
          title="Research"
          subtitle="Plans the work"
          model="Opus 4.6"
          state={stateFor(0)}
          onClick={() => props.onOpenChat('research')}
          open={props.openChatFor === 'research'}
          icon="search"
          color="cyan"
          current={[
            { c: 'dim',  t: '→ scanning codebase for relevant files…' },
            { c: 'fn',   t: 'grep("PaneNode|Split|Leaf")  →  14 hits' },
            { c: 'fn',   t: 'read_file("session/layout.rs")' },
            { c: 'ok',   t: '✓ plan drafted · 6 steps' },
          ]}
          stats={[
            { num: '5', lab: 'Files' },
            { num: '6', lab: 'Steps' },
            { num: '1.2K', lab: 'Tokens' },
          ]}
        />

        {/* Station: Coder */}
        <Station
          innerRef={(el) => (nodeRefs[2] = el)}
          agent="coder"
          title="Coder"
          subtitle="Writes & verifies"
          model="Sonnet 4.6"
          state={stateFor(1)}
          onClick={() => props.onOpenChat('coder')}
          open={props.openChatFor === 'coder'}
          icon="code"
          color="purple"
          loopLabel={stateFor(1) === 'running' ? 'Loop 2 · Playwright' : null}
          current={[
            { c: 'dim',  t: '→ implementing plan step 4/6…' },
            { c: 'fn',   t: 'edit_file("stores/session.ts")  +14 −3' },
            { c: 'fn',   t: 'playwright test session.spec.ts' },
            { c: 'run',  t: '  running e2e… [●] 1 / 2' },
          ]}
          stats={[
            { num: '+186', lab: 'Added' },
            { num: '−24',  lab: 'Removed' },
            { num: '2',    lab: 'Loops' },
          ]}
        />

        {/* Station: Reviewer */}
        <Station
          innerRef={(el) => (nodeRefs[3] = el)}
          agent="reviewer"
          title="Reviewer"
          subtitle="Independent review"
          model="Sonnet 4.6"
          state={stateFor(2)}
          onClick={() => props.onOpenChat('reviewer')}
          open={props.openChatFor === 'reviewer'}
          icon="review"
          color="green"
          current={[
            { c: 'dim',  t: '→ awaiting coder handoff…' },
            { c: 'dim',  t: '  will verify: lint · types · diff · spec' },
            { c: 'dim',  t: '' },
            { c: 'dim',  t: '' },
          ]}
          stats={[
            { num: '—', lab: 'Findings' },
            { num: '—', lab: 'Verdict' },
            { num: '—', lab: 'Time' },
          ]}
        />

        {/* Sink: merged */}
        <div
          class={`node-sink ${props.ticket.state === 'done' ? 'done' : ''}`}
          ref={(el) => (nodeRefs[4] = el)}
        >
          <div class="ns-label">MERGE</div>
          <div class="ns-id">{props.ticket.state === 'done' ? 'OK' : '…'}</div>
        </div>
      </div>
    </div>
  );
}

// Factory backdrop: grid + crosshatch.
function FactoryBg() {
  return <div class="factory-bg" aria-hidden />;
}

// ========= STATION =========
interface StationProps {
  innerRef: (el: HTMLDivElement | undefined) => void;
  agent: AgentKey;
  title: string;
  subtitle: string;
  model: string;
  state: StationState;
  onClick: () => void;
  open: boolean;
  icon: string;
  color: string;
  current: StationLogLine[];
  stats: StationStat[];
  loopLabel?: string | null;
}

function Station(props: StationProps) {
  return (
    <div
      ref={props.innerRef}
      class={`station st-${props.color} ${props.state} ${props.open ? 'open' : ''}`}
      onClick={props.onClick}
    >
      <span class="bolt tl" />
      <span class="bolt tr" />
      <span class="bolt bl" />
      <span class="bolt br" />

      <span class="port in" />
      <span class="port out" />

      <div class="st-head">
        <div class="st-icon">
          <I name={props.icon} s={18} />
        </div>
        <div class="st-titles">
          <div class="st-title">{props.title}</div>
          <div class="st-sub">{props.subtitle}</div>
        </div>
        <StatePill state={props.state} />
      </div>

      <div class="st-body">
        <div class="st-meta">
          <span class="model">{props.model}</span>
          <Show when={props.loopLabel}>
            <span class="loop-pill">
              <I name="loop" s={10} /> {props.loopLabel}
            </span>
          </Show>
        </div>

        <div class="log">
          <For each={props.current}>
            {(l) => <span class={`log-line ${l.c}`}>{l.t || '\u00A0'}</span>}
          </For>
          <Show when={props.state === 'running'}>
            <span class="log-cursor">▋</span>
          </Show>
        </div>
      </div>

      <div class="st-foot">
        <For each={props.stats}>
          {(s) => (
            <div class="st-stat">
              <span class="num">{props.state === 'pending' ? '—' : s.num}</span>
              <span class="lab">{s.lab}</span>
            </div>
          )}
        </For>
      </div>

      <Show when={props.state === 'running'}>
        <div class="st-aura" />
      </Show>
    </div>
  );
}

function StatePill(props: { state: StationState }) {
  const label = () =>
    props.state === 'running' ? 'RUNNING' : props.state === 'done' ? 'DONE' : 'PENDING';
  return (
    <span class={`state-pill ${props.state}`}>
      <span class="d" />
      {label()}
    </span>
  );
}

// ========= PIPELINE WIRES =========
interface WirePath {
  d: string;
  state: WireState;
}

interface PipelineWiresProps {
  containerRef: () => HTMLDivElement | undefined;
  nodeRefs: (HTMLElement | undefined)[];
  wireStates: WireState[];
}

function PipelineWires(props: PipelineWiresProps) {
  const [paths, setPaths] = createSignal<WirePath[]>([]);
  const [size, setSize] = createSignal({ w: 0, h: 0 });

  const compute = () => {
    const container = props.containerRef();
    if (!container) return;
    const crect = container.getBoundingClientRect();
    const sx = container.scrollLeft;
    const sy = container.scrollTop;

    const nodes = props.nodeRefs.filter(Boolean) as HTMLElement[];
    if (nodes.length < 2) return;

    const W = container.scrollWidth;
    const H = container.scrollHeight;
    setSize({ w: W, h: H });

    const boxes = nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return {
        x: r.left - crect.left + sx,
        y: r.top - crect.top + sy,
        w: r.width,
        h: r.height,
        cx: r.left - crect.left + sx + r.width / 2,
        cy: r.top - crect.top + sy + r.height / 2,
      };
    });

    const newPaths: WirePath[] = [];
    for (let i = 0; i < boxes.length - 1; i++) {
      const a = boxes[i];
      const b = boxes[i + 1];
      const sameRow = Math.abs(a.cy - b.cy) < Math.min(a.h, b.h) * 0.6;

      let d: string;
      if (sameRow && b.x > a.x) {
        const x1 = a.x + a.w;
        const y1 = a.cy;
        const x2 = b.x;
        const y2 = b.cy;
        d = `M ${x1} ${y1} L ${x2} ${y2}`;
      } else {
        const margin = 24;
        const x1 = a.x + a.w;
        const y1 = a.cy;
        const x2 = b.x;
        const y2 = b.cy;
        const midY = (y1 + y2) / 2;
        if (b.x < a.x) {
          const turnX = Math.min(a.x + a.w + margin, W - 8);
          const leftX = Math.max(b.x - margin, 8);
          d = `M ${x1} ${y1} L ${turnX} ${y1} L ${turnX} ${midY} L ${leftX} ${midY} L ${leftX} ${y2} L ${x2} ${y2}`;
        } else {
          d = `M ${a.cx} ${a.y + a.h} L ${a.cx} ${midY} L ${b.cx} ${midY} L ${b.cx} ${b.y}`;
        }
      }
      newPaths.push({ d, state: props.wireStates[i] || 'idle' });
    }
    setPaths(newPaths);
  };

  // Recompute when wireStates change. Touching props.wireStates inside the
  // effect plus joining the array ensures Solid tracks both array identity
  // and any per-element shifts.
  createEffect(() => {
    const states = props.wireStates;
    states.join('|');
    compute();
  });

  onMount(() => {
    const ro = new ResizeObserver(() => compute());
    const container = props.containerRef();
    if (container) ro.observe(container);
    props.nodeRefs.forEach((n) => n && ro.observe(n));
    const onResize = () => compute();
    window.addEventListener('resize', onResize);
    compute();
    onCleanup(() => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
    });
  });

  return (
    <svg
      class="pipeline-wires"
      width={size().w}
      height={size().h}
      style={{
        position: 'absolute',
        inset: '0',
        'pointer-events': 'none',
        width: `${size().w}px`,
        height: `${size().h}px`,
      }}
      aria-hidden
    >
      <defs>
        <marker id="pw-arrow-idle" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--border-strong)" />
        </marker>
        <marker id="pw-arrow-done" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--green)" />
        </marker>
        <marker id="pw-arrow-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--cyan)" />
        </marker>
      </defs>
      <For each={paths()}>
        {(p) => {
          const color = () =>
            p.state === 'done'
              ? 'var(--green)'
              : p.state === 'active'
              ? 'var(--cyan)'
              : 'var(--border-strong)';
          const marker = () =>
            `url(#pw-arrow-${p.state === 'done' ? 'done' : p.state === 'active' ? 'active' : 'idle'})`;
          const baseStyle = (): JSX.CSSProperties => ({
            filter: p.state !== 'idle' ? `drop-shadow(0 0 6px ${color()})` : 'none',
          });
          return (
            <g>
              <path
                d={p.d}
                fill="none"
                stroke={color()}
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
                marker-end={marker()}
                opacity={p.state === 'idle' ? 0.55 : 1}
                style={baseStyle()}
              />
              <Show when={p.state === 'active'}>
                <path
                  d={p.d}
                  fill="none"
                  stroke="#ffffff"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-dasharray="3 10"
                  class="pw-flow"
                  style={{ filter: 'drop-shadow(0 0 3px #fff)' }}
                />
              </Show>
            </g>
          );
        }}
      </For>
    </svg>
  );
}
