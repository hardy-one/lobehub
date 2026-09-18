/**
 * Timing/transport trace for the CLI's tRPC traffic.
 *
 * The heterogeneous-agent ingest path posts one batch per ~250ms to
 * `{server}/trpc/lambda/...` (through the device gateway). When a batch takes
 * seconds, the question is always the same: is the *server* slow, or is the
 * *transport* (DNS/TCP/TLS, gateway hop, auth) slow? The server now reports its
 * own processing time (`ingest:done`, `http:done`); this wrapper reports the
 * client side of the same requests:
 *
 *   [HETERO-TRACE] side=cli-http op=… phase=http:slow detail={…}
 *
 * `ttfbMs` is time-to-response-headers (everything before the server started
 * streaming: connect + auth + processing), `bodyMs` is time to read the body.
 * Non-JSON responses are logged unconditionally — a gateway or Next.js error
 * page arriving where tRPC expects JSON is exactly the failure that used to
 * surface as an opaque `Unexpected token '<'` retry.
 *
 * Temporary diagnostics (same lifecycle as the other HETERO-TRACE lines).
 */

/** Requests faster than this are only logged when their response is not JSON. */
const SLOW_REQUEST_MS = 1000;

/** Bytes of a non-JSON body worth keeping in the log. */
const SNIPPET_LEN = 200;

const iso = (date: Date): string => date.toISOString();

const emit = (fields: Record<string, unknown>): void => {
  const at = new Date();
  const parts = ['[HETERO-TRACE]', 'side=cli-http', `at=${iso(at)}`];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(`${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
  }
  try {
    process.stderr.write(`${parts.join(' ')}\n`);
  } catch {
    /* diagnostics must never break a run */
  }
};

const requestUrlOf = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
};

const pushPhases = (input: RequestInfo | URL, init?: RequestInit): Record<string, unknown> => {
  if (typeof init?.body !== 'string') return {};
  try {
    const parsed = JSON.parse(init.body);
    // tRPC batch envelope: {"0":{"json":{...}}} — surface the operation id so
    // this line lines up with the same run's other trace lines.
    const first = Object.values(parsed ?? {})[0] as { json?: { operationId?: string } } | undefined;
    const operationId = first?.json?.operationId;
    return operationId ? { op: operationId } : {};
  } catch {
    return {};
  }
};

/**
 * Wrap `fetch` so every tRPC call reports its own timing when it is slow (or
 * answers with a non-JSON body). All other responses pass through untouched.
 */
export const tracedFetch = (): typeof fetch => {
  return async (input, init) => {
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(input, init);
    } catch (error) {
      emit({
        ...pushPhases(input, init as RequestInit | undefined),
        error: error instanceof Error ? error.message : String(error),
        method: (init as RequestInit | undefined)?.method ?? 'GET',
        ms: Date.now() - startedAt,
        phase: 'http:failed',
        url: requestUrlOf(input),
      });
      throw error;
    }

    const ttfbMs = Date.now() - startedAt;
    const contentType = response.headers.get('content-type') ?? '';
    const isJson = contentType.includes('json');
    if (response.ok && isJson && ttfbMs < SLOW_REQUEST_MS) return response;

    let bodyMs: number | undefined;
    let snippet: string | undefined;
    try {
      const bodyStartedAt = Date.now();
      snippet = (await response.clone().text()).replaceAll(/\s+/g, ' ').slice(0, SNIPPET_LEN);
      bodyMs = Date.now() - bodyStartedAt;
    } catch {
      /* the caller still owns the response */
    }

    emit({
      ...pushPhases(input, init as RequestInit | undefined),
      ...(bodyMs === undefined ? {} : { bodyMs }),
      contentType: contentType || '<none>',
      method: (init as RequestInit | undefined)?.method ?? 'GET',
      ms: Date.now() - startedAt,
      nonJson: isJson ? undefined : true,
      phase: isJson ? 'http:slow' : 'http:non-json',
      status: response.status,
      ...(snippet ? { body: snippet } : {}),
      ttfbMs,
      url: requestUrlOf(input),
    });

    return response;
  };
};
