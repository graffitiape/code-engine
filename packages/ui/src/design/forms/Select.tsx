import {
  For,
  Show,
  createEffect,
  createSignal,
  createUniqueId,
  onCleanup,
  onMount,
} from "solid-js";
import { Portal } from "solid-js/web";
import {
  edgeEnabledIndex,
  nextEnabledIndex,
  typeaheadIndex,
} from "./selectLogic";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
  class?: string;
  title?: string;
}

export function Select(props: SelectProps) {
  const listboxId = createUniqueId();
  const [open, setOpen] = createSignal(false);
  const [activeIndex, setActiveIndex] = createSignal(-1);
  const [dropUp, setDropUp] = createSignal(false);
  const [popupStyle, setPopupStyle] = createSignal<Record<string, string>>({});
  let rootRef: HTMLDivElement | undefined;
  let contentRef: HTMLDivElement | undefined;
  let typeahead = "";
  let typeaheadTimer: number | undefined;

  const selectedIndex = () => props.options.findIndex((option) => option.value === props.value);
  const selected = () => props.options[selectedIndex()];

  const openAt = (index: number) => {
    if (props.disabled || !props.options.length) return;
    setDropUp(false);
    const trigger = rootRef?.querySelector<HTMLButtonElement>(".ce-select-trigger");
    const rect = trigger?.getBoundingClientRect();
    if (rect) {
      setPopupStyle({
        left: `${Math.max(8, rect.left)}px`,
        top: `${rect.bottom + 5}px`,
        width: `${Math.max(190, rect.width)}px`,
        visibility: "hidden",
      });
    }
    const fallback = edgeEnabledIndex(props.options, "first");
    setActiveIndex(index >= 0 && !props.options[index]?.disabled ? index : fallback);
    setOpen(true);
  };

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) queueMicrotask(() => rootRef?.querySelector<HTMLButtonElement>(".ce-select-trigger")?.focus());
  };

  const choose = (index: number) => {
    const option = props.options[index];
    if (!option || option.disabled) return;
    props.onChange(option.value);
    close(true);
  };

  const move = (direction: 1 | -1) => {
    const current = activeIndex() >= 0 ? activeIndex() : selectedIndex();
    const next = nextEnabledIndex(props.options, current, direction);
    if (next >= 0) setActiveIndex(next);
  };

  const handleTypeahead = (key: string) => {
    if (typeaheadTimer !== undefined) window.clearTimeout(typeaheadTimer);
    typeahead += key;
    const next = typeaheadIndex(props.options, typeahead, activeIndex());
    if (next >= 0) setActiveIndex(next);
    typeaheadTimer = window.setTimeout(() => {
      typeahead = "";
      typeaheadTimer = undefined;
    }, 550);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (props.disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open()) openAt(selectedIndex());
      else move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const edge = edgeEnabledIndex(props.options, event.key === "Home" ? "first" : "last");
      if (!open()) openAt(edge);
      else setActiveIndex(edge);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open()) openAt(selectedIndex());
      else choose(activeIndex());
      return;
    }
    if (event.key === "Escape" && open()) {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      close();
      return;
    }
    if (event.key.length === 1 && /\S/.test(event.key)) {
      event.preventDefault();
      if (!open()) openAt(selectedIndex());
      handleTypeahead(event.key.toLocaleLowerCase());
    }
  };

  createEffect(() => {
    if (!open()) return;
    queueMicrotask(() => {
      const content = contentRef;
      const trigger = rootRef?.querySelector<HTMLButtonElement>(".ce-select-trigger");
      if (!content || !trigger) return;
      const contentRect = content.getBoundingClientRect();
      const triggerRect = trigger.getBoundingClientRect();
      const width = Math.min(Math.max(190, triggerRect.width), window.innerWidth - 16);
      const left = Math.min(Math.max(8, triggerRect.left), window.innerWidth - width - 8);
      const shouldDropUp =
        triggerRect.bottom + contentRect.height + 5 > window.innerHeight - 8 &&
        triggerRect.top > window.innerHeight - triggerRect.bottom;
      const top = shouldDropUp
        ? Math.max(8, triggerRect.top - contentRect.height - 5)
        : Math.min(triggerRect.bottom + 5, window.innerHeight - contentRect.height - 8);
      setDropUp(shouldDropUp);
      setPopupStyle({ left: `${left}px`, top: `${Math.max(8, top)}px`, width: `${width}px` });
    });
  });

  createEffect(() => {
    if (props.disabled) close();
  });

  createEffect(() => {
    if (!open()) return;
    const index = activeIndex();
    if (index < 0) return;
    queueMicrotask(() => {
      contentRef
        ?.querySelector<HTMLElement>(`#${listboxId}-option-${index}`)
        ?.scrollIntoView({ block: "nearest" });
    });
  });

  onMount(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef && !rootRef.contains(target) && !contentRef?.contains(target)) close();
    };
    const reposition = () => {
      if (!open()) return;
      const trigger = rootRef?.querySelector<HTMLButtonElement>(".ce-select-trigger");
      const content = contentRef;
      if (!trigger || !content) return;
      const triggerRect = trigger.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const width = Math.min(Math.max(190, triggerRect.width), window.innerWidth - 16);
      const left = Math.min(Math.max(8, triggerRect.left), window.innerWidth - width - 8);
      const shouldDropUp = triggerRect.bottom + contentRect.height + 5 > window.innerHeight - 8;
      setDropUp(shouldDropUp);
      setPopupStyle({
        left: `${left}px`,
        top: `${Math.max(8, shouldDropUp ? triggerRect.top - contentRect.height - 5 : triggerRect.bottom + 5)}px`,
        width: `${width}px`,
      });
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
      if (typeaheadTimer !== undefined) window.clearTimeout(typeaheadTimer);
    });
  });

  return (
    <div
      ref={rootRef}
      class={`ce-select ${open() ? "open" : ""} ${props.compact ? "compact" : ""} ${props.class ?? ""}`}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        class="ce-select-trigger"
        role="combobox"
        aria-label={props.ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-controls={listboxId}
        aria-activedescendant={open() && activeIndex() >= 0 ? `${listboxId}-option-${activeIndex()}` : undefined}
        aria-autocomplete="none"
        disabled={props.disabled}
        title={props.title}
        onClick={() => (open() ? close() : openAt(selectedIndex()))}
      >
        <span class={selected() ? "" : "placeholder"}>{selected()?.label ?? props.placeholder ?? "Select…"}</span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      <Show when={open()}>
        <Portal>
          <div
            ref={contentRef}
            id={listboxId}
            class={`ce-select-content ce-select-portal ${dropUp() ? "drop-up" : ""}`}
            style={popupStyle()}
            role="listbox"
            aria-label={props.ariaLabel}
          >
            <For each={props.options}>
              {(option, index) => (
                <button
                  id={`${listboxId}-option-${index()}`}
                  type="button"
                  role="option"
                  class={`ce-select-option ${activeIndex() === index() ? "active" : ""}`}
                  aria-selected={option.value === props.value}
                  tabIndex={-1}
                  disabled={option.disabled}
                  onPointerMove={() => !option.disabled && setActiveIndex(index())}
                  onClick={() => choose(index())}
                >
                  <span class="ce-select-check">{option.value === props.value ? "✓" : ""}</span>
                  <span class="ce-select-copy">
                    <strong>{option.label}</strong>
                    <Show when={option.description}><small>{option.description}</small></Show>
                  </span>
                </button>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </div>
  );
}
