export const DEFAULT_APP_ZOOM = 1;
export const MIN_APP_ZOOM = 0.5;
export const MAX_APP_ZOOM = 2;

const APP_ZOOM_STEP = 0.1;

type AppZoomAction = "in" | "out" | "reset";

export function normalizeAppZoom(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_APP_ZOOM;
  return Math.min(MAX_APP_ZOOM, Math.max(MIN_APP_ZOOM, value));
}

export function nextAppZoom(current: number, action: AppZoomAction): number {
  if (action === "reset") return DEFAULT_APP_ZOOM;
  const direction = action === "in" ? 1 : -1;
  const next = normalizeAppZoom(current) + direction * APP_ZOOM_STEP;
  return normalizeAppZoom(Math.round(next * 10) / 10);
}

function appZoomAction(event: KeyboardEvent): AppZoomAction | null {
  if (event.defaultPrevented || event.altKey || (!event.metaKey && !event.ctrlKey)) return null;
  if (event.key === "+" || event.key === "=") return "in";
  if (event.key === "-") return "out";
  if (event.key === "0") return "reset";
  return null;
}

export function createAppZoomKeydownHandler(
  initialZoom: number,
  onZoomChange: (zoom: number) => void,
): (event: KeyboardEvent) => void {
  let currentZoom = normalizeAppZoom(initialZoom);

  return (event) => {
    const action = appZoomAction(event);
    if (!action) return;

    event.preventDefault();
    const nextZoom = nextAppZoom(currentZoom, action);
    if (nextZoom === currentZoom) return;
    currentZoom = nextZoom;
    onZoomChange(nextZoom);
  };
}
