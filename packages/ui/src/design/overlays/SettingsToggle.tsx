export interface SettingsToggleProps {
  on: boolean;
  onToggle: () => void;
  label: string;
}

export function SettingsToggle(props: SettingsToggleProps) {
  return (
    <button
      type="button"
      class={`switch ${props.on ? "on" : ""}`}
      role="switch"
      aria-checked={props.on}
      aria-label={props.label}
      onClick={props.onToggle}
    />
  );
}
