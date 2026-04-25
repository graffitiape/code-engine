// Chat side-panel for an agent — replays its scripted transcript.

import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import type { AgentKey, ChatMsg, Ticket } from '../types';
import { I, chatFor } from './data';

export interface ChatPanelProps {
  agent: AgentKey;
  ticket: Ticket;
  onClose: () => void;
}

const COLOR_BY_AGENT: Record<AgentKey, string> = {
  research: 'cyan',
  coder: 'purple',
  reviewer: 'green',
};
const ICON_BY_AGENT: Record<AgentKey, string> = {
  research: 'search',
  coder: 'code',
  reviewer: 'review',
};
const LABEL_BY_AGENT: Record<AgentKey, string> = {
  research: 'Research',
  coder: 'Coder',
  reviewer: 'Reviewer',
};

export function ChatPanel(props: ChatPanelProps) {
  const data = createMemo(() => chatFor(props.agent, props.ticket));
  const [input, setInput] = createSignal('');
  let scrollRef: HTMLDivElement | undefined;

  // Auto-scroll to the bottom whenever the agent or ticket changes.
  createEffect(() => {
    void props.agent;
    void props.ticket.id;
    queueMicrotask(() => {
      if (scrollRef) scrollRef.scrollTop = scrollRef.scrollHeight;
    });
  });

  const color = () => COLOR_BY_AGENT[props.agent];
  const icon = () => ICON_BY_AGENT[props.agent];
  const label = () => LABEL_BY_AGENT[props.agent];

  return (
    <>
      <div class="chat-scrim" onClick={props.onClose} />
      <aside class={`chat chat-${color()}`}>
        <header class="chat-head">
          <div class="chat-avatar">
            <I name={icon()} s={18} />
          </div>
          <div class="chat-titles">
            <div class="chat-title">{label()} Agent</div>
            <div class="chat-sub">
              {data().role} · {data().model}
            </div>
          </div>
          <button class="chat-close" onClick={props.onClose}>
            <I name="close" s={14} />
          </button>
        </header>

        <div class="chat-body" ref={scrollRef}>
          <div class="chat-ticket">
            <span class="ct-tid">{props.ticket.id}</span>
            <span class="ct-title">{props.ticket.title}</span>
          </div>

          <For each={data().msgs}>{(m) => <ChatMessage m={m} agent={props.agent} />}</For>
        </div>

        <footer class="chat-input">
          <textarea
            placeholder={`Send a nudge to ${label()}…`}
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                setInput('');
              }
            }}
          />
          <button class="send-btn" disabled={!input().trim()}>
            <I name="send" s={14} />
          </button>
        </footer>
      </aside>
    </>
  );
}

interface ChatMessageProps {
  m: ChatMsg;
  agent: AgentKey;
}

function ChatMessage(props: ChatMessageProps) {
  return (
    <Show when={props.m}>
      {(m) => {
        const msg = m();
        if (msg.role === 'user') {
          return (
            <div class="msg user">
              <div class="msg-who">You</div>
              <div class="msg-body">{msg.content}</div>
            </div>
          );
        }
        if (msg.role === 'agent') {
          return (
            <div class="msg agent">
              <div class="msg-who">Assistant</div>
              <div class="msg-body">{msg.content}</div>
            </div>
          );
        }
        if (msg.role === 'tool') {
          return (
            <div class={`tool-block ${msg.status}`}>
              <div class="tool-head">
                <span class="t-icon">⚙</span>
                <span class="t-name">{msg.tool}</span>
                <span class="t-args">{msg.args}</span>
                <span class={`t-status s-${msg.status}`}>
                  <span class="d" />
                  {msg.status}
                </span>
              </div>
              <div class="tool-out" innerHTML={msg.result} />
            </div>
          );
        }
        if (msg.role === 'loop') {
          return (
            <div class="loop-marker">
              <span class="lm-bar" />
              <span class="lm-label">
                <I name="loop" s={11} /> {msg.label}
              </span>
              <span class="lm-text">{msg.content}</span>
            </div>
          );
        }
        if (msg.role === 'plan') {
          return (
            <div class="plan-block">
              <div class="plan-head">
                <span class="plan-dot" />
                <span class="plan-title">{msg.title}</span>
                <span class="plan-scope">{msg.scope}</span>
              </div>
              <ol class="plan-steps">
                <For each={msg.steps}>{(s) => <li>{s}</li>}</For>
              </ol>
            </div>
          );
        }
        if (msg.role === 'findings') {
          return (
            <div class="findings">
              <For each={msg.items}>
                {(f) => (
                  <div class={`finding s-${f.sev}`}>
                    <span class="f-sev">
                      {f.sev === 'ok' ? '✓' : f.sev === 'warn' ? '!' : '·'}
                    </span>
                    <div>
                      <div class="f-title">{f.title}</div>
                      <div class="f-body">{f.body}</div>
                    </div>
                  </div>
                )}
              </For>
            </div>
          );
        }
        if (msg.role === 'verdict') {
          return (
            <div class={`verdict v-${msg.status}`}>
              <I name="check" s={14} />
              <span>{msg.content}</span>
            </div>
          );
        }
        if (msg.role === 'handoff') {
          return (
            <div class="handoff">
              <span class="ho-arrow">→</span>
              <span class="ho-to">Handoff to {msg.to}</span>
              <span class="ho-body">{msg.content}</span>
            </div>
          );
        }
        return null;
      }}
    </Show>
  );
}
