import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { type NextRequest } from 'next/server';

import { createLambdaContext } from '@/libs/trpc/lambda/context';
import { createTRPCErrorLogger } from '@/libs/trpc/utils/errorLogger';
import { prepareRequestForTRPC } from '@/libs/trpc/utils/request-adapter';
import { createResponseMeta } from '@/libs/trpc/utils/responseMeta';
import { lambdaRouter } from '@/server/routers/lambda';
import { heteroTrace } from '@/server/utils/heteroTraceLog';

/** Requests faster than this are left unlogged. */
const SLOW_HTTP_MS = 1000;

/**
 * Whole-request timing for the lambda tRPC endpoint.
 *
 * This is the outermost server-side boundary: it includes the tRPC middlewares
 * (auth, database) that the per-procedure timers cannot see. Compared against
 * the CLI's own `http:slow`/`ingest:batch:sent` lines for the same request, the
 * difference isolates transport (gateway hop, DNS/TLS) from server work.
 *
 * Temporary diagnostics, logged for slow requests only.
 */
const handler = async (req: NextRequest) => {
  // Clone the request to avoid "Response body object should not be disturbed or locked" error
  // in Next.js 16 when the body stream has been consumed by Next.js internal mechanisms
  const preparedReq = prepareRequestForTRPC(req);
  const startedAt = Date.now();
  const path = req.nextUrl.pathname;

  try {
    const response = await fetchRequestHandler({
      // Large-input queries (see the client's LARGE_INPUT_QUERY_PROCEDURES) are
      // sent as POST to dodge the GET URL length budget — let tRPC accept them.
      allowMethodOverride: true,

      /**
       * @link https://trpc.io/docs/v11/context
       */
      createContext: () => createLambdaContext(req),

      endpoint: '/trpc/lambda',

      onError: createTRPCErrorLogger('lambda'),

      req: preparedReq,
      responseMeta: createResponseMeta,
      router: lambdaRouter,
    });

    const ms = Date.now() - startedAt;
    if (ms >= SLOW_HTTP_MS) {
      heteroTrace('server-http', path, 'http:done', {
        method: req.method,
        ms,
        status: response.status,
      });
    }
    return response;
  } catch (error) {
    heteroTrace('server-http', path, 'http:failed', {
      error: error instanceof Error ? error.message : String(error),
      method: req.method,
      ms: Date.now() - startedAt,
    });
    throw error;
  }
};

export { handler as GET, handler as POST };
