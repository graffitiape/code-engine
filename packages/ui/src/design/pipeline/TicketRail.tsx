// Ticket rail — left column listing tickets grouped by state.

import { For, Show } from 'solid-js';
import type { Ticket } from '../types';
import { I } from './data';

export interface TicketRailProps {
  tickets: Ticket[];
  currentId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
}

interface GroupProps {
  label: string;
  list: Ticket[];
  color: string;
  currentId: string;
  onSelect: (id: string) => void;
}

function Group(props: GroupProps) {
  return (
    <div class="rail-group">
      <div class="rail-group-head">
        <span class="rail-dot" style={{ background: props.color }} />
        <span class="rail-label">{props.label}</span>
        <span class="rail-count">{props.list.length}</span>
      </div>
      <For each={props.list}>
        {(t) => (
          <div
            class={`rail-ticket ${props.currentId === t.id ? 'active' : ''} ${
              t.state === 'running' ? 'running' : ''
            } ${t.state === 'done' ? 'done' : ''}`}
            onClick={() => props.onSelect(t.id)}
          >
            <div class="rail-top">
              <span class="tid">{t.id}</span>
              <Show when={t.state === 'running'}>
                <span class="rail-live">
                  <span class="d" /> live
                </span>
              </Show>
              <Show when={t.state === 'done'}>
                <span class="rail-check">
                  <I name="check" s={11} />
                </span>
              </Show>
              <span class={`prio prio-${t.prio}`}>
                {t.prio === 'high' ? '●' : t.prio === 'med' ? '◆' : '○'}
              </span>
            </div>
            <div class="rail-title">{t.title}</div>
            <div class="rail-meta">
              <span>◇ {t.est}</span>
              <span>· {t.files} files</span>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

export function TicketRail(props: TicketRailProps) {
  const running = () => props.tickets.filter((t) => t.state === 'running');
  const queued = () => props.tickets.filter((t) => t.state === 'queued');
  const done = () => props.tickets.filter((t) => t.state === 'done');

  return (
    <aside class="rail">
      <div class="rail-head">
        <div class="rail-h-title">Tickets</div>
        <button class="rail-new" onClick={props.onNew}>
          <I name="plus" s={12} /> New
        </button>
      </div>
      <div class="rail-body">
        <Show when={running().length > 0}>
          <Group
            label="Running"
            list={running()}
            color="var(--cyan)"
            currentId={props.currentId}
            onSelect={props.onSelect}
          />
        </Show>
        <Show when={queued().length > 0}>
          <Group
            label="Queued"
            list={queued()}
            color="var(--fg-3)"
            currentId={props.currentId}
            onSelect={props.onSelect}
          />
        </Show>
        <Show when={done().length > 0}>
          <Group
            label="Done"
            list={done()}
            color="var(--green)"
            currentId={props.currentId}
            onSelect={props.onSelect}
          />
        </Show>
      </div>
    </aside>
  );
}
