export interface SelectNavigationOption {
  label: string;
  disabled?: boolean;
}

export function nextEnabledIndex(
  options: readonly SelectNavigationOption[],
  current: number,
  direction: 1 | -1,
): number {
  if (!options.length) return -1;
  for (let step = 1; step <= options.length; step += 1) {
    const index = (current + direction * step + options.length) % options.length;
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

export function edgeEnabledIndex(
  options: readonly SelectNavigationOption[],
  edge: "first" | "last",
): number {
  const start = edge === "first" ? 0 : options.length - 1;
  const direction = edge === "first" ? 1 : -1;
  for (let index = start; index >= 0 && index < options.length; index += direction) {
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

export function typeaheadIndex(
  options: readonly SelectNavigationOption[],
  query: string,
  current: number,
): number {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle || !options.length) return -1;
  for (let offset = 1; offset <= options.length; offset += 1) {
    const index = (current + offset + options.length) % options.length;
    const option = options[index];
    if (!option?.disabled && option.label.toLocaleLowerCase().startsWith(needle)) return index;
  }
  return -1;
}
