// Pipeline icons, ticket seed data, agent chat scripts, and stage config.

import type { AgentKey, ChatData, Ticket } from '../types';

// ========= ICONS =========
export const PIcons: Record<string, string> = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6"/><path d="M15.5 15.5L21 21"/></svg>',
  code:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6l-5 6 5 6M16 6l5 6-5 6M14 4l-4 16"/></svg>',
  review: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h12M4 17h8"/><circle cx="19" cy="17" r="3"/></svg>',
  play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5 3l8 5-8 5V3z"/></svg>',
  check:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4L6 11 3 8"/></svg>',
  close:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',
  send: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2L7 9M14 2l-5 12-2-5-5-2 12-5z"/></svg>',
  refresh:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3v4h-4M3 13v-4h4"/><path d="M13 7a5 5 0 00-9-1M3 9a5 5 0 009 1"/></svg>',
  loop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 12v-2a4 4 0 014-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 12v2a4 4 0 01-4 4H3"/></svg>',
  bolt: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M9 1L3 9h4l-1 6 6-8H8l1-6z"/></svg>',
};

// Pipeline icon component (Solid).
export function I(props: { name: string; s?: number }) {
  const sz = () => props.s ?? 16;
  return (
    <span
      style={{
        display: 'inline-flex',
        width: `${sz()}px`,
        height: `${sz()}px`,
      }}
      innerHTML={PIcons[props.name] || ''}
    />
  );
}

// ========= TICKETS =========
export const TicketSeed: Ticket[] = [
  { id: 'CE-145', title: 'Session save/restore for pane layout tree', prio: 'high', files: 5, est: '3h', state: 'running' },
  { id: 'CE-142', title: 'Wire msgpack-RPC redraw events through Tauri Channel to frontend', prio: 'high', files: 6, est: '2h', state: 'queued' },
  { id: 'CE-149', title: 'Add ripgrep streaming backend for project-wide search', prio: 'med', files: 4, est: '2h', state: 'queued' },
  { id: 'CE-151', title: 'Draggable PaneDivider → nvim_ui_try_resize on release', prio: 'med', files: 3, est: '45m', state: 'queued' },
  { id: 'CE-158', title: 'Extract nvim highlight groups → CSS custom properties', prio: 'med', files: 4, est: '1.5h', state: 'queued' },
  { id: 'CE-138', title: 'Lazygit-style hunk staging in Git panel', prio: 'high', files: 8, est: '4h', state: 'done' },
  { id: 'CE-122', title: 'Tmux-style window tabs with numbered indicator + color', prio: 'med', files: 3, est: '1h', state: 'done' },
];

// ========= STAGES =========
export const STAGES: AgentKey[] = ['research', 'coder', 'reviewer'];
export const STAGE_DURATIONS = [7, 12, 6] as const; // seconds per station in the demo

// ========= CHAT TRANSCRIPTS per agent =========
const researchChat = (t: Ticket): ChatData => ({
  model: 'claude-opus-4.6',
  role: 'Plans the work',
  msgs: [
    { role: 'user', content: t.title },
    { role: 'agent', content: "Starting a codebase sweep to understand the current pane layout shape, persistence, and any existing session infrastructure I can reuse." },
    { role: 'tool', tool: 'grep', args: 'pattern: "PaneNode|Split|Leaf"', status: 'done',
      result: '6 files · 14 matches\n<span class="fp">crates/ce-core/src/session/layout.rs</span>  8 matches\n<span class="fp">packages/ui/src/stores/session.ts</span>  3 matches\n<span class="fp">packages/ui/src/components/panes/PaneContainer.tsx</span>  2 matches\n<span class="fp">docs/architecture.md</span>  1 match' },
    { role: 'tool', tool: 'read_file', args: 'crates/ce-core/src/session/layout.rs', status: 'done',
      result: '124 lines — PaneNode enum (Leaf|Split), no <span class="hit">Serialize</span>/Deserialize derives yet.' },
    { role: 'tool', tool: 'read_file', args: 'packages/ui/src/stores/session.ts', status: 'done',
      result: '64 lines — SolidJS store; handwritten JSON shape in localStorage. Field names diverge from Rust side (`left`/`right` vs `first`/`second`).' },
    { role: 'agent', content: "Writing the plan now." },
    { role: 'plan', title: 'Implementation plan',
      steps: [
        'Unify naming: Rust & TS both use `first`/`second` for split children.',
        'Add `#[derive(Serialize, Deserialize)]` on `PaneNode` with `rename_all = "camelCase"`.',
        'Generate TS types from Rust via `ts-rs` to lock the schema.',
        'Add versioned envelope `{ v: 2, tree: PaneNode }` and a v1→v2 migration.',
        'Write unit tests: round-trip save/load, migration from v1 fixture.',
        'Add e2e test: split pane 3-ways, reload, layout matches.',
      ],
      scope: '5 files · ~180 LOC',
    },
    { role: 'handoff', to: 'Coder', content: 'Plan ready. Handoff with a typed spec attached.' },
  ],
});

const coderChat = (_t: Ticket): ChatData => ({
  model: 'claude-sonnet-4.6',
  role: 'Writes code + runs Playwright in a loop',
  msgs: [
    { role: 'agent', content: "Received plan. Starting with the Rust type, then regenerating TS bindings, then the store wiring." },
    { role: 'tool', tool: 'edit_file', args: 'crates/ce-core/src/session/layout.rs', status: 'done',
      result: '<span class="add">+42</span>  <span class="del">−8</span>  · added serde derives + ts-rs export' },
    { role: 'tool', tool: 'edit_file', args: 'crates/ce-core/src/session/manager.rs', status: 'done',
      result: '<span class="add">+61</span>  <span class="del">−4</span>  · save/load round-trip, atomic write via tempfile' },
    { role: 'tool', tool: 'run', args: 'cargo test -p ce-core session::', status: 'done',
      result: '<span class="ok">running 6 tests · 6 passed · 0 failed · 0.42s</span>' },
    { role: 'tool', tool: 'edit_file', args: 'packages/ui/src/stores/session.ts', status: 'done',
      result: '<span class="add">+58</span>  <span class="del">−11</span>  · swapped handrolled shape for generated PaneNode' },
    { role: 'loop', label: 'Loop 1', content: 'Running Playwright acceptance…' },
    { role: 'tool', tool: 'playwright', args: 'test session.spec.ts', status: 'fail',
      result: '<span class="fail">✗</span> session > restores 3-way split on reload\n  <span class="fail">expected</span> 3 panes · <span class="fail">received</span> 2\n  <span class="fp">session.spec.ts:42</span>' },
    { role: 'agent', content: "Failure on reload — the second split isn't being rehydrated. The TS store is bailing early when it sees a nested Split. Fixing the recursion." },
    { role: 'tool', tool: 'edit_file', args: 'packages/ui/src/stores/session.ts', status: 'done',
      result: '<span class="add">+14</span>  <span class="del">−3</span>  · recursive rehydrate for nested Split children' },
    { role: 'loop', label: 'Loop 2', content: 'Re-running Playwright…' },
    { role: 'tool', tool: 'playwright', args: 'test session.spec.ts', status: 'done',
      result: '<span class="ok">✓</span> session > restores 3-way split on reload  · 842ms\n<span class="ok">✓</span> session > migrates v1 fixture                · 61ms\n<span class="ok">2 passed · 0 failed</span>' },
    { role: 'agent', content: "Ticket acceptance criteria met. 2 loops, all Playwright checks green. Handing to Review." },
    { role: 'handoff', to: 'Reviewer', content: 'Code passes e2e. Handing off independent review.' },
  ],
});

const reviewerChat = (_t: Ticket): ChatData => ({
  model: 'claude-sonnet-4.6',
  role: 'Independent code review',
  msgs: [
    { role: 'agent', content: "Doing a fresh-eyes review. I'm not looking at the previous agents' internal reasoning — just the diff and test surface." },
    { role: 'tool', tool: 'git_diff', args: 'origin/main...HEAD', status: 'done',
      result: '7 files changed, <span class="add">+175</span> <span class="del">−26</span>' },
    { role: 'tool', tool: 'read_file', args: 'crates/ce-core/src/session/manager.rs', status: 'done',
      result: '203 lines · reviewed' },
    { role: 'tool', tool: 'read_file', args: 'packages/ui/src/stores/session.ts', status: 'done',
      result: '127 lines · reviewed' },
    { role: 'agent', content: 'Findings:' },
    { role: 'findings', items: [
      { sev: 'warn', title: 'Error handling in atomic write', body: '`manager.rs:84` — tempfile rename is silently ignored on error. Consider propagating via `anyhow::Result`.' },
      { sev: 'nit',  title: 'Magic schema version', body: 'Inline `2` in migration. Extract `const SCHEMA_VERSION: u32 = 2;`.' },
      { sev: 'ok',   title: 'Naming is consistent', body: 'Both sides now use `first`/`second`. Good.' },
      { sev: 'ok',   title: 'Migration is safe', body: 'v1 fixture correctly lifted into v2 envelope; fallback on parse error returns an empty root.' },
    ]},
    { role: 'verdict', status: 'approve', content: '✓ Approved with 1 warning, 1 nit. Non-blocking.' },
  ],
});

const CHAT_BUILDERS: Record<AgentKey, (t: Ticket) => ChatData> = {
  research: researchChat,
  coder: coderChat,
  reviewer: reviewerChat,
};

export function chatFor(agent: AgentKey, t: Ticket): ChatData {
  return CHAT_BUILDERS[agent](t);
}
