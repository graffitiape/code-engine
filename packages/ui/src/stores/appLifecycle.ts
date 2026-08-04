export interface AppCloseGuard {
  reason: () => string | null;
  prepare: () => void | Promise<void>;
}

const closeGuards = new Set<AppCloseGuard>();

export function registerAppCloseGuard(guard: AppCloseGuard): () => void {
  closeGuards.add(guard);
  return () => closeGuards.delete(guard);
}

export function appCloseReasons(): string[] {
  return [...closeGuards]
    .map((guard) => guard.reason())
    .filter((reason): reason is string => Boolean(reason));
}

export async function prepareForAppClose(): Promise<void> {
  for (const guard of closeGuards) {
    if (guard.reason()) await guard.prepare();
  }
}
