import { eq } from 'drizzle-orm';

import { messages } from '../schemas';

/**
 * Append-only v2: injected context rows (`is_injection = true`, e.g.
 * `source_key = 'todos'`) are persisted beside real conversation rows so the
 * engine can replay them, but they are runtime input, never conversation.
 *
 * Apply this predicate to every user-facing read (chat transcript, share
 * transcript, search, topic previews). Engine-side reads that assemble model
 * input must NOT use it: they have to keep seeing the injected rows.
 */
export const notInjection = () => eq(messages.isInjection, false);
