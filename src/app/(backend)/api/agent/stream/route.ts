import { createSSEHeaders, createSSEWriter } from '@lobechat/utils/server';
import debug from 'debug';
import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createAgentStateManager, createStreamEventManager } from '@/server/modules/AgentRuntime';
import { auth } from '@/auth';
import { ApiKeyModel } from '@/database/models/apiKey';
import { getServerDB } from '@/database/core/db-adaptor';
import { validateApiKeyFormat } from '@/utils/apiKey';
import { extractBearerToken } from '@/utils/server/auth';

const log = debug('api-route:agent:stream');
const timing = debug('lobe-server:agent-runtime:timing');

/**
 * Normalize a lastEventId that may be a legacy timestamp (pure digits) into
 * a format compatible with Redis stream IDs ("timestamp-sequence").
 * Pure numeric IDs like "1746123456789" become "1746123456789-0".
 * Already-formatted stream IDs like "1746123456789-0" pass through unchanged.
 */
const normalizeEventId = (id: string): string => (id.includes('-') ? id : `${id}-0`);

/**
 * Authenticate an SSE request using Better Auth session or API Key.
 * Returns the authenticated userId or null if unauthenticated.
 */
const authenticateRequest = async (request: NextRequest): Promise<string | null> => {
  // 1. Try Better Auth session (cookie-based)
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (session?.user?.id) {
      log('SSE auth: session user %s', session.user.id);
      return session.user.id;
    }
  } catch {
    // Session not found or invalid — fall through to API Key
  }

  // 2. Try API Key (Bearer token)
  const authorizationHeader = request.headers.get('Authorization');
  const bearerToken = extractBearerToken(authorizationHeader);
  if (bearerToken && validateApiKeyFormat(bearerToken)) {
    try {
      const db = await getServerDB();
      const apiKeyModel = new ApiKeyModel(db, '');
      const record = await apiKeyModel.findByKey(bearerToken);
      if (
        record?.enabled &&
        (!record.expiresAt || new Date() < new Date(record.expiresAt))
      ) {
        log('SSE auth: API key user %s', record.userId);
        return record.userId;
      }
    } catch (error) {
      log('SSE auth: API key lookup failed: %O', error);
    }
  }

  return null;
};

/**
 * Server-Sent Events (SSE) endpoint
 * Provides real-time Agent execution event stream for clients.
 * Requires authentication via Better Auth session or API Key.
 */
export async function GET(request: NextRequest) {
  // Authenticate the request
  const userId = await authenticateRequest(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Initialize stream event manager (uses InMemory singleton in local dev, Redis in production)
  const streamManager = createStreamEventManager();

  const { searchParams } = new URL(request.url);
  const operationId = searchParams.get('operationId');
  const rawLastEventId = searchParams.get('lastEventId') || '0-0';
  const lastEventId = normalizeEventId(rawLastEventId);
  const includeHistory = searchParams.get('includeHistory') === 'true';
  const historyLimit = Math.min(
    Math.max(parseInt(searchParams.get('historyLimit') || '200', 10) || 200, 1),
    1000,
  );

  if (!operationId) {
    return NextResponse.json(
      { error: 'operationId parameter is required' },
      { status: 400 },
    );
  }

  // Authorize: verify the authenticated user owns this operation
  try {
    const stateManager = createAgentStateManager();
    const metadata = await stateManager.getOperationMetadata(operationId);
    if (!metadata) {
      return NextResponse.json({ error: 'Operation not found' }, { status: 404 });
    }
    if (metadata.userId && metadata.userId !== userId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
  } catch (error) {
    log('SSE: failed to check operation metadata for %s: %O', operationId, error);
    // In local dev (InMemory mode), getOperationMetadata may not be available.
    // Allow the connection to proceed — the operationId is unguessable enough
    // to serve as a basic access token in that context.
  }

  log(`Starting SSE connection for operation ${operationId} from eventId ${lastEventId}`);

  // Create Server-Sent Events stream
  const stream = new ReadableStream({
    cancel(reason) {
      log(`SSE connection cancelled for operation ${operationId}:`, reason);

      // Call cleanup function
      if ((this as any)._cleanup) {
        (this as any)._cleanup();
      }
    },

    start(controller) {
      const writer = createSSEWriter(controller);

      // Send connection confirmation event
      writer.writeConnection(operationId, lastEventId);
      log(`SSE connection established for operation ${operationId}`);

      // If needed, send historical events first
      if (includeHistory) {
        streamManager
          .getStreamHistory(operationId, historyLimit)
          .then((history) => {
            // Send historical events in chronological order (earliest first)
            const sortedHistory = history.reverse();

            sortedHistory.forEach((event) => {
              // Only send events newer than lastEventId using stream ID comparison
              // Stream IDs (e.g. "1746123456789-0") are lexicographically ordered
              const eventId = event.id || undefined;
              const isNewer = !lastEventId || lastEventId === '0-0' ||
                (eventId && eventId > lastEventId) ||
                (!eventId && event.timestamp.toString() > lastEventId);
              if (isNewer) {
                try {
                  // Add SSE-specific fields, keeping format consistent with real-time events
                  const sseEvent = {
                    ...event,
                    operationId,
                    timestamp: event.timestamp || Date.now(),
                  };
                  writer.writeStreamEvent(sseEvent, eventId || operationId);
                } catch (error) {
                  console.error('[Agent Stream] Error sending history event:', error);
                }
              }
            });

            if (sortedHistory.length > 0) {
              log(`Sent ${sortedHistory.length} historical events for operation ${operationId}`);
            }
          })
          .catch((error) => {
            console.error('[Agent Stream] Failed to load history:', error);

            try {
              writer.writeError(error, operationId, 'history_loading');
            } catch (controllerError) {
              console.error('[Agent Stream] Failed to send error event:', controllerError);
            }
          });
      }

      // Create AbortController for canceling subscription
      const abortController = new AbortController();

      // Track if stream has ended (agent_runtime_end received)
      // Once set to true, no more events will be sent
      let streamEnded = false;

      // Send heartbeat periodically (every 30 seconds)
      const heartbeatInterval = setInterval(() => {
        // Skip heartbeat if stream has ended
        if (streamEnded) {
          return;
        }

        try {
          const heartbeat = {
            operationId,
            timestamp: Date.now(),
            type: 'heartbeat',
          };

          controller.enqueue(`data: ${JSON.stringify(heartbeat)}\n\n`);
        } catch (error) {
          console.error('[Agent Stream] Heartbeat error:', error);
          clearInterval(heartbeatInterval);
        }
      }, 30_000);

      // Cleanup function
      const cleanup = () => {
        abortController.abort();
        clearInterval(heartbeatInterval);
        log(`SSE connection closed for operation ${operationId}`);
      };

      // Subscribe to new streaming events
      const subscribeToEvents = async () => {
        try {
          await streamManager.subscribeStreamEvents(
            operationId,
            lastEventId,
            (events) => {
              events.forEach((event) => {
                // Skip all events if stream has ended
                if (streamEnded) {
                  return;
                }

                try {
                  // Add SSE-specific fields, preserving stream ID for client reconnect
                  const sseEvent = {
                    ...event,
                    operationId,
                    timestamp: event.timestamp || Date.now(),
                  };

                  const now = Date.now();
                  const totalLatency = now - sseEvent.timestamp;
                  writer.writeStreamEvent(sseEvent, event.id || operationId);
                  timing(
                    '[%s:%d] SSE sent %s, original timestamp %d, sent at %d, total latency %dms',
                    operationId,
                    event.stepIndex,
                    event.type,
                    sseEvent.timestamp,
                    now,
                    totalLatency,
                  );

                  // If agent_runtime_end event is received, terminate stream immediately
                  if (event.type === 'agent_runtime_end') {
                    log(
                      `Agent runtime ended for operation ${operationId}, terminating stream immediately`,
                    );

                    // Mark stream as ended to prevent any more events
                    streamEnded = true;

                    // Immediately cleanup and close connection
                    cleanup();
                    controller.close();
                    log(
                      `SSE connection closed after agent runtime end for operation ${operationId}`,
                    );
                  }
                } catch (error) {
                  console.error('[Agent Stream] Error sending event:', error);
                }
              });
            },
            abortController.signal,
          );
        } catch (error) {
          if (!abortController.signal.aborted) {
            console.error('[Agent Stream] Subscription error:', error);

            try {
              writer.writeError(error as Error, operationId, 'stream_subscription');
            } catch (controllerError) {
              console.error('[Agent Stream] Failed to send subscription error:', controllerError);
            }
          }
        }
      };

      // Start subscription
      subscribeToEvents();

      // Listen for connection close
      request.signal?.addEventListener('abort', cleanup);

      // Store cleanup function for calling during cancel
      (controller as any)._cleanup = cleanup;
    },
  });

  // Set SSE response headers
  return new Response(stream, {
    headers: createSSEHeaders(),
  });
}
