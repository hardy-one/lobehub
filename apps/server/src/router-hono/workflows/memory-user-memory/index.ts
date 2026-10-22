import { withOtelMetricsForUpstashWorkflows } from '@lobechat/observability-otel/modules/upstash-workflow';
import { serve } from '@upstash/workflow/hono';
import debug from 'debug';
import { Hono } from 'hono';

import { isWorkflowAbort } from '@/server/workflows/abort';

import { createWorkflowQstashClient } from '../qstashClient';
import { hourlyWorkflowHandler, hourlyWorkflowOptions } from './workflows/hourly';
import { personaUpdateHandler, personaUpdateWorkflowOptions } from './workflows/personaUpdate';
import { processTopicHandler, processTopicWorkflowOptions } from './workflows/processTopic';
import { processTopicsHandler, processTopicsWorkflowOptions } from './workflows/processTopics';
import { processUsersHandler, processUsersWorkflowOptions } from './workflows/processUsers';
import {
  processUserTopicsHandler,
  processUserTopicsWorkflowOptions,
} from './workflows/processUserTopics';

const log = debug('lobe-server:workflows:memory-user-memory');

// NOTICE: `serve` hands every uncaught error to `onError` and defaults it to `console.error`.
// A workflow that lets a WorkflowAbort escape its own catch block therefore logs an error on every
// abort, which is a control signal, not a failure. Keep real errors at error level and demote only
// the aborts.
const onWorkflowError = (error: unknown) => {
  if (isWorkflowAbort(error)) {
    log('workflow aborted: %s', error.message);
    return;
  }

  console.error(error);
};

const app = new Hono();

app.post(
  '/call-cron-hourly-analysis',
  serve(
    withOtelMetricsForUpstashWorkflows(hourlyWorkflowHandler, {
      url: '/api/workflows/memory-user-memory/call-cron-hourly-analysis',
    }),
    {
      ...hourlyWorkflowOptions,
      onError: onWorkflowError,
      qstashClient: createWorkflowQstashClient(),
    },
  ),
);

app.post(
  '/pipelines/persona/update-writing',
  serve(
    withOtelMetricsForUpstashWorkflows(personaUpdateHandler, {
      url: '/api/workflows/memory-user-memory/pipelines/persona/update-writing',
    }),
    {
      ...personaUpdateWorkflowOptions,
      onError: onWorkflowError,
      qstashClient: createWorkflowQstashClient(),
    },
  ),
);

app.post(
  '/pipelines/chat-topic/process-users',
  serve(
    withOtelMetricsForUpstashWorkflows(processUsersHandler, {
      url: '/api/workflows/memory-user-memory/pipelines/chat-topic/process-users',
    }),
    {
      ...processUsersWorkflowOptions,
      onError: onWorkflowError,
      qstashClient: createWorkflowQstashClient(),
    },
  ),
);

app.post(
  '/pipelines/chat-topic/process-user-topics',
  serve(
    withOtelMetricsForUpstashWorkflows(processUserTopicsHandler, {
      url: '/api/workflows/memory-user-memory/pipelines/chat-topic/process-user-topics',
    }),
    {
      ...processUserTopicsWorkflowOptions,
      onError: onWorkflowError,
      qstashClient: createWorkflowQstashClient(),
    },
  ),
);

app.post(
  '/pipelines/chat-topic/process-topics',
  serve(
    withOtelMetricsForUpstashWorkflows(processTopicsHandler, {
      url: '/api/workflows/memory-user-memory/pipelines/chat-topic/process-topics',
    }),
    {
      ...processTopicsWorkflowOptions,
      onError: onWorkflowError,
      qstashClient: createWorkflowQstashClient(),
    },
  ),
);

app.post(
  '/pipelines/chat-topic/process-topic',
  serve(
    withOtelMetricsForUpstashWorkflows(processTopicHandler, {
      url: '/api/workflows/memory-user-memory/pipelines/chat-topic/process-topic',
    }),
    {
      ...processTopicWorkflowOptions,
      onError: onWorkflowError,
      qstashClient: createWorkflowQstashClient(),
    },
  ),
);

export default app;
