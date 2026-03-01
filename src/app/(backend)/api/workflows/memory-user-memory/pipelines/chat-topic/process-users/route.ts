import { Client } from '@upstash/qstash';
import { serve } from '@upstash/workflow/nextjs';
import { chunk } from 'es-toolkit/compat';

import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import { type MemoryExtractionPayloadInput } from '@/server/services/memory/userMemory/extract';
import {
  buildWorkflowPayloadInput,
  MemoryExtractionExecutor,
  MemoryExtractionWorkflowService,
  normalizeMemoryExtractionPayload,
} from '@/server/services/memory/userMemory/extract';

const USER_PAGE_SIZE = 50;
const USER_BATCH_SIZE = 10;

const { upstashWorkflowExtraHeaders } = parseMemoryExtractionConfig();

export const { POST } = serve<MemoryExtractionPayloadInput>(
  async (context) => {
    const params = normalizeMemoryExtractionPayload(context.requestPayload || {});
    console.info('[memory-user-memory][process-users] Received workflow request', {
      workflowRunId: context.workflowRunId,
      sources: params.sources,
      userIds: params.userIds,
      userCursor: params.userCursor,
      from: params.from,
      to: params.to,
      asyncTaskId: params.asyncTaskId,
      mode: params.mode,
      userInitiated: params.userInitiated,
    });
    if (params.sources.length === 0) {
      return { message: 'No sources provided, skip memory extraction.' };
    }

    const executor = await MemoryExtractionExecutor.create();
    console.info('[memory-user-memory][process-users] MemoryExtractionExecutor created');

    // NOTICE: Upstash Workflow only supports serializable data into plain JSON,
    // this causes the Date object to be converted into string when passed as parameter from
    // context to child workflow. So we need to convert it back to Date object here.
    const userCursor = params.userCursor
      ? { createdAt: new Date(params.userCursor.createdAt), id: params.userCursor.id }
      : undefined;
    console.info('[memory-user-memory][process-users] Fetching user batch', {
      userIdsFromParams: params.userIds,
      userCursor,
      userCursorFromParams: params.userCursor,
    });

    const userBatch = await context.run('memory:user-memory:extract:get-users', () =>
      params.userIds.length > 0
        ? { ids: params.userIds }
        : executor.getUsers(USER_PAGE_SIZE, userCursor),
    );
    console.info('[memory-user-memory][process-users] User batch fetched', {
      userIdsCount: userBatch.ids.length,
      hasCursor: 'cursor' in userBatch,
      cursorId: 'cursor' in userBatch ? userBatch.cursor?.id : undefined,
    });

    const ids = userBatch.ids;
    if (ids.length === 0) {
      return { message: 'No users to process for memory extraction.' };
    }

    const cursor = 'cursor' in userBatch ? userBatch.cursor : undefined;
    console.info('[memory-user-memory][process-users] Processing user batches', {
      totalUsers: ids.length,
      userBatchSize: USER_BATCH_SIZE,
      batchCount: Math.ceil(ids.length / USER_BATCH_SIZE),
      hasCursor: !!cursor,
      cursorId: cursor?.id,
    });

    const batches = chunk(ids, USER_BATCH_SIZE);
    await Promise.all(
      batches.map((userIds) =>
        context.run(`memory:user-memory:extract:users:process-topic-batches`, () => {
          console.info(
            '[memory-user-memory][process-users] Triggering process-user-topics for user batch',
            {
              batchUserIds: userIds,
              batchSize: userIds.length,
              firstUserId: userIds[0],
            },
          );
          return MemoryExtractionWorkflowService.triggerProcessUserTopics(
            {
              ...buildWorkflowPayloadInput(params),
              topicCursor: undefined,
              userId: userIds[0],
              userIds,
            },
            { extraHeaders: upstashWorkflowExtraHeaders },
          );
        }),
      ),
    );

    if (params.userIds.length === 0 && cursor) {
      console.info('[memory-user-memory][process-users] Scheduling next user batch with cursor', {
        cursorId: cursor.id,
        cursorCreatedAt: cursor.createdAt,
      });
      await context.run('memory:user-memory:extract:users:schedule-next-user-batch', () =>
        MemoryExtractionWorkflowService.triggerProcessUsers(
          {
            ...buildWorkflowPayloadInput({
              ...params,
              userCursor: { createdAt: cursor.createdAt.toISOString(), id: cursor.id },
            }),
          },
          { extraHeaders: upstashWorkflowExtraHeaders },
        ),
      );
    }

    console.info('[memory-user-memory][process-users] Workflow completed successfully', {
      batchesProcessed: batches.length,
      processedUsers: ids.length,
      nextCursorId: cursor ? cursor.id : null,
    });
    return {
      batches: batches.length,
      nextCursor: cursor ? cursor.id : null,
      processedUsers: ids.length,
    };
  },
  {
    // NOTICE(@nekomeowww): Here as scenarios like Vercel Deployment Protection,
    // intermediate context.run(...) won't offer customizable headers like context.trigger(...) / client.trigger(...)
    // for passing additional headers, we have to provide a custom QStash client with the required headers here.
    //
    // Refer to the doc for more details:
    // https://upstash.com/docs/workflow/troubleshooting/vercel#step-2-pass-header-when-triggering
    qstashClient: new Client({
      headers: {
        ...upstashWorkflowExtraHeaders,
      },
      token: process.env.QSTASH_TOKEN!,
    }),
  },
);
