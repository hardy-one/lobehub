import { MemorySourceType } from '@lobechat/types';
import { Client } from '@upstash/qstash';
import { serve } from '@upstash/workflow/nextjs';

import { type ListTopicsForMemoryExtractorCursor } from '@/database/models/topic';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import { type MemoryExtractionPayloadInput } from '@/server/services/memory/userMemory/extract';
import {
  buildWorkflowPayloadInput,
  MemoryExtractionExecutor,
  MemoryExtractionWorkflowService,
  normalizeMemoryExtractionPayload,
} from '@/server/services/memory/userMemory/extract';
import { forEachBatchSequential } from '@/server/services/memory/userMemory/topicBatching';

const TOPIC_PAGE_SIZE = 50;
const TOPIC_BATCH_SIZE = 4;

const { upstashWorkflowExtraHeaders } = parseMemoryExtractionConfig();

export const { POST } = serve<MemoryExtractionPayloadInput>(
  async (context) => {
    const params = normalizeMemoryExtractionPayload(context.requestPayload || {});
    console.info('[memory-user-memory][process-user-topics] Received workflow request', {
      workflowRunId: context.workflowRunId,
      sources: params.sources,
      userIds: params.userIds,
      topicIds: params.topicIds,
      topicCursor: params.topicCursor,
      from: params.from,
      to: params.to,
      asyncTaskId: params.asyncTaskId,
      forceAll: params.forceAll,
      forceTopics: params.forceTopics,
      userInitiated: params.userInitiated,
    });
    if (!params.userIds.length) {
      return { message: 'No user ids provided for topic processing.' };
    }
    if (!params.sources.includes(MemorySourceType.ChatTopic)) {
      return { message: 'No supported sources requested, skip topic processing.' };
    }

    const executor = await MemoryExtractionExecutor.create();
    console.info('[memory-user-memory][process-user-topics] MemoryExtractionExecutor created');

    const scheduleNextPage = async (userId: string, cursorCreatedAt: Date, cursorId: string) => {
      await MemoryExtractionWorkflowService.triggerProcessUserTopics(
        {
          ...buildWorkflowPayloadInput({
            ...params,
            topicCursor: {
              createdAt: cursorCreatedAt.toISOString(),
              id: cursorId,
              userId,
            },
            topicIds: [],
            userId,
            userIds: [userId],
          }),
        },
        { extraHeaders: upstashWorkflowExtraHeaders },
      );
    };

    console.info('[memory-user-memory][process-user-topics] Processing users', {
      userIds: params.userIds,
    });
    for (const userId of params.userIds) {
      console.info('[memory-user-memory][process-user-topics] Processing user', {
        userId,
        topicCursorFromParams: params.topicCursor,
      });
      const topicCursor =
        params.topicCursor && params.topicCursor.userId === userId
          ? {
              createdAt: new Date(params.topicCursor.createdAt),
              id: params.topicCursor.id,
            }
          : undefined;

      const topicsFromPayload =
        params.topicIds && params.topicIds.length > 0
          ? await context.run(
              `memory:user-memory:extract:users:${userId}:filter-topic-ids`,
              async () => {
                const filtered = await executor.filterTopicIdsForUser(userId, params.topicIds);
                return filtered.length > 0 ? filtered : undefined;
              },
            )
          : undefined;
      console.info('[memory-user-memory][process-user-topics] Topics from payload', {
        userId,
        hasTopicIdsFromParams: !!params.topicIds?.length,
        topicsFromPayloadCount: topicsFromPayload?.length || 0,
      });

      console.info('[memory-user-memory][process-user-topics] Fetching topic batch for user', {
        userId,
        topicCursorId: topicCursor?.id,
        hasTopicsFromPayload: !!topicsFromPayload?.length,
      });
      const topicBatch = await context.run<{
        cursor?: ListTopicsForMemoryExtractorCursor;
        ids: string[];
      }>(
        `memory:user-memory:extract:users:${userId}:list-topics:${topicCursor?.id || 'root'}`,
        () =>
          topicsFromPayload && topicsFromPayload.length > 0
            ? Promise.resolve({ ids: topicsFromPayload })
            : executor.getTopicsForUser(
                {
                  cursor: topicCursor,
                  forceAll: params.forceAll,
                  forceTopics: params.forceTopics,
                  from: params.from,
                  to: params.to,
                  userId,
                },
                TOPIC_PAGE_SIZE,
              ),
      );
      console.info('[memory-user-memory][process-user-topics] Topic batch fetched', {
        userId,
        topicIdsCount: topicBatch.ids.length,
        hasCursor: 'cursor' in topicBatch,
        cursorId: 'cursor' in topicBatch ? topicBatch.cursor?.id : undefined,
      });

      const ids = topicBatch.ids;
      if (!ids.length) {
        continue;
      }

      const cursor = 'cursor' in topicBatch ? topicBatch.cursor : undefined;
      console.info('[memory-user-memory][process-user-topics] Processing topic batches', {
        userId,
        totalTopics: ids.length,
        topicBatchSize: TOPIC_BATCH_SIZE,
        batchCount: Math.ceil(ids.length / TOPIC_BATCH_SIZE),
        hasCursor: !!cursor,
        cursorId: cursor?.id,
      });

      // TODO: follow the new pattern of process-topic
      // remove the batch sequential, replace it with context.invoke(...) pattern
      await forEachBatchSequential(ids, TOPIC_BATCH_SIZE, async (topicIds, batchIndex) => {
        // NOTICE: We trigger via QStash instead of context.invoke because invoke only swaps the last path
        // segment with the workflowId. If we invoked directly from /process-user-topics, child workflow
        // URLs would inherit that base and lose the desired /process-topics/workflows prefix.
        await context.run(
          `memory:user-memory:extract:users:${userId}:process-topics-batch:${batchIndex}`,
          () => {
            console.info(
              '[memory-user-memory][process-user-topics] Triggering process-topics for topic batch',
              {
                userId,
                batchIndex,
                topicIdsCount: topicIds.length,
                firstTopicId: topicIds[0],
              },
            );
            return MemoryExtractionWorkflowService.triggerProcessTopics(
              userId,
              {
                ...buildWorkflowPayloadInput(params),
                topicCursor: undefined,
                topicIds,
                userId,
                userIds: [userId],
              },
              { extraHeaders: upstashWorkflowExtraHeaders },
            );
          },
        );
      });

      if (!topicsFromPayload && cursor) {
        console.info(
          '[memory-user-memory][process-user-topics] Scheduling next topic batch with cursor',
          {
            userId,
            cursorId: cursor.id,
            cursorCreatedAt: cursor.createdAt,
          },
        );
        await context.run(
          `memory:user-memory:extract:users:${userId}:topics:${cursor.id}:schedule-next-batch`,
          () => {
            // NOTICE: Upstash Workflow only supports serializable data into plain JSON,
            // this causes the Date object to be converted into string when passed as parameter from
            // context to child workflow. So we need to convert it back to Date object here.
            const createdAt = new Date(cursor.createdAt);
            if (Number.isNaN(createdAt.getTime())) {
              throw new Error('Invalid cursor date when scheduling next topic page');
            }

            scheduleNextPage(userId, createdAt, cursor.id);
          },
        );
      }
    }

    console.info('[memory-user-memory][process-user-topics] Workflow completed successfully', {
      processedUsers: params.userIds.length,
    });
    return { processedUsers: params.userIds.length };
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
