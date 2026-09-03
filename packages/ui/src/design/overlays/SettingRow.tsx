import { Show, type JSX } from "solid-js";

export interface SettingRowProps {
  label: string;
  description?: string;
  children: JSX.Element;
}

export function SettingRow(props: SettingRowProps) {
  return (
    <div class="set-row">
      <div class="text-left">
        <div class="label">{props.label}</div>
        <Show when={props.description}>
          <div class="desc">{props.description}</div>
        </Show>
      </div>
      <div class="control">{props.children}</div>
    </div>
  );
}
