import { describe, expect, it } from 'vitest';

import { SERVICE_WORKER_REGISTRATION_OPTIONS } from './registerServiceWorker';

describe('service worker registration', () => {
  it('does not request a root scope', () => {
    expect(SERVICE_WORKER_REGISTRATION_OPTIONS).toEqual({});
  });
});
