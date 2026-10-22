import type { ModelRuntimeHooks } from './ModelRuntime';

const mergePair = (a?: ModelRuntimeHooks, b?: ModelRuntimeHooks): ModelRuntimeHooks | undefined => {
  if (!a) return b;
  if (!b) return a;

  const merged: ModelRuntimeHooks = { ...a };

  for (const key of Object.keys(b) as (keyof ModelRuntimeHooks)[]) {
    const existing = merged[key];
    const next = b[key];
    if (!existing) {
      (merged[key] as unknown) = next;
      continue;
    }
    (merged[key] as unknown) = async (...args: unknown[]) => {
      await (existing as (...args: unknown[]) => Promise<unknown>)(...args);
      await (next as (...args: unknown[]) => Promise<unknown>)(...args);
    };
  }

  return merged;
};

/**
 * Compose any number of `ModelRuntimeHooks` layers, chaining handlers that
 * share a key so every layer fires in argument order. Designed for stacking
 * concerns at the `ModelRuntime` construction site (e.g. billing hooks +
 * tracing hooks + request mirroring).
 *
 * - Returns `undefined` only when every input is empty.
 * - Chained hooks run sequentially; a layer only runs if the ones before it
 *   resolved. Place load-bearing hooks (the ones whose failure should abort the
 *   call) first.
 */
export const mergeModelRuntimeHooks = (
  ...hooks: (ModelRuntimeHooks | undefined)[]
): ModelRuntimeHooks | undefined =>
  hooks.reduce<ModelRuntimeHooks | undefined>(mergePair, undefined);
