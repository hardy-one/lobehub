import { type BaseContentSearch, createContentSearchImpl } from '../contentSearch';
import type { GrepContentParams, GrepContentResult } from '../types';
import { expandTilde } from './expandTilde';
import { hasHiddenSegment } from './hasHiddenSegment';

/**
 * Simple wrapper API for content search.
 *
 * Delegates to the platform-aware fallback chain (`rg` → `ag` → `grep` →
 * nodejs) so a host without ripgrep still answers the query instead of
 * failing outright. An earlier version spawned `rg` directly here: on a
 * machine without it every search returned a bare `success: false` with no
 * `error`, which the tool pipeline collapsed to
 * "[UNKNOWN_EXEC_ERROR] Tool execution failed" — the agent could not tell a
 * missing binary from a broken pattern and retried the same call forever.
 * The chain reports its own failure reason, which the runtime surfaces
 * verbatim.
 */
let impl: BaseContentSearch | undefined;

export async function grepContent(params: GrepContentParams): Promise<GrepContentResult> {
  impl ??= createContentSearchImpl();

  // The chain reads `glob`; `filePattern` is this wrapper's legacy name for it.
  const glob = params.glob ?? params.filePattern;

  const result = await impl.grep({
    ...params,
    // The old wrapper always numbered content-mode lines; the chain only does
    // so on `-n`. Keep the wrapper's contract.
    '-n': params.output_mode === 'content' ? (params['-n'] ?? true) : params['-n'],
    glob,
    // Expand every search-root alias here: the chain only tilde-expands inside
    // its existence check, and an unexpanded `~` reaches execa's `cwd` as a
    // literal path on the actual search.
    'path': expandTilde(params.path ?? params.scope ?? params.cwd) ?? process.cwd(),
  });

  // Keep reporting the hidden-segment adjustment even when the engine itself
  // picked it up, so a zero-match dot-path search never looks like a silent
  // failure.
  if (hasHiddenSegment(glob)) {
    return {
      ...result,
      hint: `Auto-enabled hidden-file matching because filePattern contains a dot-prefixed segment.`,
    };
  }

  return result;
}
