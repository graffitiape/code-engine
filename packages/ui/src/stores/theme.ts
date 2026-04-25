import { createSignal, createEffect } from "solid-js";

function colorToHex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

const [themeBg, setThemeBg] = createSignal("#1a1b26");
const [themeFg, setThemeFg] = createSignal("#c0caf5");

/** Update CSS custom properties from nvim default colors */
export function updateThemeColors(fg: number, bg: number) {
  const fgHex = colorToHex(fg);
  const bgHex = colorToHex(bg);

  setThemeFg(fgHex);
  setThemeBg(bgHex);

  const root = document.documentElement;
  root.style.setProperty("--ce-bg", bgHex);
  root.style.setProperty("--ce-fg", fgHex);
}

export function useTheme() {
  return { bg: themeBg, fg: themeFg };
}
