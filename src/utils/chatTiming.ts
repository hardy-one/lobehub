/**
 * Lightweight frontend timing logger for the chat send -> stream -> render
 * pipeline. It is intentionally disabled unless
 * `NEXT_PUBLIC_CHAT_TIMING=1` is set at build time, so normal sessions are
 * not spammed with console output.
 */
const enabled = process.env.NEXT_PUBLIC_CHAT_TIMING === '1';

export const chatTiming = (
  event: string,
  metadata?: Record<string, unknown>,
): void => {
  if (!enabled) return;

  console.log(`[chat-timing] ${event}`, {
    timestamp: Date.now(),
    ...metadata,
  });
};
