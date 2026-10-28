import {
  WorkflowAbort,
  WorkflowNonRetryableError,
  WorkflowRetryAfterError,
} from '@upstash/workflow';
import { describe, expect, it } from 'vitest';

import { isWorkflowAbort } from './abort';

describe('isWorkflowAbort', () => {
  it('detects a plain workflow abort', () => {
    expect(isWorkflowAbort(new WorkflowAbort('memory:user-memory:extract'))).toBe(true);
  });

  it.each([
    ['non-retryable abort', new WorkflowNonRetryableError('extraction failed')],
    ['retry-after abort', new WorkflowRetryAfterError('rate limited', 30)],
    ['plain error', new Error('boom')],
    ['non-error value', 'aborted'],
    ['undefined', undefined],
  ])('does not treat %s as a routine abort', (_label, error) => {
    expect(isWorkflowAbort(error)).toBe(false);
  });
});
