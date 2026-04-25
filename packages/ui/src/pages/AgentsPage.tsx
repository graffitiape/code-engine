import { Component, createEffect, createSignal, Show } from "solid-js";
import {
  TicketRail,
  PipelineStage,
  ChatPanel,
  TicketSeed,
  PageSwitcher,
  Icon,
} from "../design";
import type { AgentKey, Ticket, PageKey } from "../design";
import { titlebarDoubleClick } from "../bridge/tauri";

function onTitleBarDblClick(e: MouseEvent) {
  if (
    e.target instanceof Element &&
    e.target.closest(
      "button, .icon-btn, .tab, .tab-new, .page-pill, .project-badge",
    )
  )
    return;
  titlebarDoubleClick().catch(() => {});
}

interface AgentsPageProps {
  activePage: PageKey;
  onNavigatePage: (page: PageKey) => void;
}

const AgentsPage: Component<AgentsPageProps> = (props) => {
  const [tickets, setTickets] = createSignal<Ticket[]>([...TicketSeed]);
  const [currentId, setCurrentId] = createSignal<string>(TicketSeed[0].id);
  const [openChat, setOpenChat] = createSignal<AgentKey | null>(null);

  createEffect(() => {
    document.documentElement.setAttribute("data-theme", "tokyonight");
  });

  const current = (): Ticket => tickets().find((t) => t.id === currentId()) || tickets()[0];

  const newTicket = () => {
    const id = "CE-" + Math.floor(200 + Math.random() * 800);
    const fresh: Ticket = {
      id,
      title: "New agent task — describe here",
      prio: "med",
      files: 1,
      est: "1h",
      state: "queued",
    };
    setTickets([fresh, ...tickets()]);
    setCurrentId(id);
  };

  return (
    <div class="desktop">
      <div class="window">
        <div class="titlebar" data-screen-label="AgentsTitleBar" onDblClick={onTitleBarDblClick}>
          <div class="traffic-lights">
            <span class="tl close" />
            <span class="tl min" />
            <span class="tl max" />
          </div>
          <div class="project-badge" title="Switch project">
            <span class="logo">
              <svg viewBox="0 0 10 10" fill="none">
                <path d="M2 3l3-2 3 2v4L5 9 2 7V3z" stroke="white" stroke-width="0.8" />
                <circle cx="5" cy="5" r="1" fill="white" />
              </svg>
            </span>
            <span class="name">code-engine</span>
            <Icon name="chevronDown" style={{ width: '10px', height: '10px', color: 'var(--fg-3)' }} />
          </div>
          <PageSwitcher active={props.activePage} onNavigate={props.onNavigatePage} />
          <div class="tabs" />
        </div>
        <div class="page-root">
          <TicketRail
            tickets={tickets()}
            currentId={currentId()}
            onSelect={(id) => {
              setCurrentId(id);
              setOpenChat(null);
            }}
            onNew={newTicket}
          />
          <PipelineStage
            ticket={current()}
            onOpenChat={(a: AgentKey) => setOpenChat(a)}
            openChatFor={openChat()}
          />
          <Show when={openChat()}>
            <ChatPanel
              agent={openChat()!}
              ticket={current()}
              onClose={() => setOpenChat(null)}
            />
          </Show>
        </div>
      </div>
    </div>
  );
};

export default AgentsPage;
