/**
 * KaTeX ships an official `copy-tex` contrib extension that rewrites the clipboard
 * payload of a copy made inside a rendered formula: instead of the visual text of the
 * formula, the user gets its original LaTeX source, wrapped in `$…$` for inline math
 * and `$$…$$` for display math.
 *
 * Importing the extension registers one `copy` listener on `document`, so it has to be
 * loaded once per document instead of once per rendered message.
 */
let enabled: Promise<void> | undefined;

/**
 * Enable copying the LaTeX source of rendered formulas.
 *
 * Repeat calls reuse the first import, so every message that mounts can ask for it
 * without installing a second global `copy` listener.
 */
export const enableKatexCopyTex = (): Promise<void> => {
  enabled ??= import('katex/contrib/copy-tex').then(() => undefined);

  return enabled;
};
