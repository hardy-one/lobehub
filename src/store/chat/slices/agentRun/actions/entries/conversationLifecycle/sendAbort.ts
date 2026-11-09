export const throwIfSendAborted = (signal?: AbortSignal) => {
  if (!signal?.aborted) return;

  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Message send was cancelled', 'AbortError');
};
